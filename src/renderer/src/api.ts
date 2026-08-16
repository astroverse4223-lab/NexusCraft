import type { IpcChannel, EventChannel } from '@shared/ipc'
import type {
  Account,
  AppSettings,
  BackupInfo,
  ContentPack,
  CreateInstanceInput,
  DownloadProgress,
  GameLogLine,
  Instance,
  InstanceStats,
  JavaInstallation,
  LauncherErrorPayload,
  LaunchState,
  LoaderId,
  LoaderVersion,
  ModInfo,
  Result,
  SavedServer,
  SavedSkin,
  ServerStatus,
  VersionManifestInfo,
  WorldInfo
} from '@shared/types'

/** An error that already carries a user-readable explanation from the main process. */
export class ApiError extends Error {
  readonly payload: LauncherErrorPayload

  constructor(payload: LauncherErrorPayload) {
    super(payload.title)
    this.name = 'ApiError'
    this.payload = payload
  }
}

/**
 * True when the failure was a cancellation rather than a fault — a superseded
 * sign-in, a stopped download. Screens use this to stay silent instead of
 * showing an alarming error card for something the user or the app chose to do.
 */
export function isCancellation(err: unknown): boolean {
  const code = err instanceof ApiError ? err.payload.code : null
  return code === 'CANCELLED' || code === 'AUTH_DECLINED'
}

/** Anything thrown out of an API call, normalised into a displayable payload. */
export function toPayload(err: unknown): LauncherErrorPayload {
  if (err instanceof ApiError) return err.payload
  return {
    code: 'UNKNOWN',
    title: 'Something went wrong',
    message: err instanceof Error ? err.message : 'An unexpected problem occurred in the launcher interface.',
    actions: ['Try again', 'Restart NexusCraft if it keeps happening'],
    detail: null
  }
}

async function call<T>(channel: IpcChannel, payload?: unknown): Promise<T> {
  const result = (await window.nexus.invoke(channel, payload)) as Result<T>
  if (!result || typeof result !== 'object' || !('ok' in result)) {
    throw new ApiError({
      code: 'UNKNOWN',
      title: 'The launcher did not respond',
      message: 'The main process returned an unexpected reply.',
      actions: ['Restart NexusCraft'],
      detail: null
    })
  }
  if (!result.ok) throw new ApiError(result.error)
  return result.data
}

export interface AppInfo {
  version: string
  electron: string
  node: string
  chrome: string
  platform: string
  arch: string
  dataDir: string
  logsDir: string
  secureStorage: boolean
  isPackaged: boolean
}

export interface MemoryInfo {
  totalMb: number
  freeMb: number
  min: number
  max: number
  ceiling: number
  systemMb: number
}

export interface InstalledVersion {
  id: string
  type: string
  javaMajor: number | null
  releaseTime: string | null
  isLoaderProfile: boolean
}

export interface Screenshot {
  fileName: string
  path: string
  takenAt: number
  sizeBytes: number
  dataUrl: string | null
}

export const api = {
  app: {
    info: () => call<AppInfo>('app:info'),
    openExternal: (url: string) => call<boolean>('app:openExternal', { url }),
    openPath: (path: string) => call<boolean>('app:openPath', { path }),
    pickDirectory: (title?: string) => call<string | null>('app:pickDirectory', { title }),
    pickFiles: (opts?: { title?: string; extensions?: string[]; multi?: boolean }) =>
      call<string[]>('app:pickFiles', opts ?? {}),
    window: (action: 'minimize' | 'maximize' | 'close') => call<boolean>('app:window', { action }),
    memory: () => call<MemoryInfo>('app:systemMemory')
  },

  settings: {
    get: () => call<AppSettings>('settings:get'),
    update: (patch: Partial<AppSettings>) => call<AppSettings>('settings:update', patch)
  },

  auth: {
    begin: () => call<Account>('auth:begin'),
    cancel: () => call<boolean>('auth:cancel'),
    list: () => call<Account[]>('auth:list'),
    setActive: (accountId: string) => call<Account>('auth:setActive', { accountId }),
    logout: (accountId: string) => call<boolean>('auth:logout', { accountId }),
    refresh: (accountId: string) => call<Account>('auth:refresh', { accountId })
  },

  versions: {
    manifest: (refresh = false) => call<VersionManifestInfo>('versions:manifest', { refresh }),
    installed: () => call<InstalledVersion[]>('versions:installed'),
    loaderVersions: (loader: LoaderId, minecraftVersion: string) =>
      call<LoaderVersion[]>('versions:loaderVersions', { loader, minecraftVersion }),
    remove: (versionId: string) => call<boolean>('versions:delete', { versionId })
  },

  instances: {
    list: () => call<Instance[]>('instances:list'),
    create: (input: CreateInstanceInput) => call<Instance>('instances:create', input),
    update: (id: string, patch: Record<string, unknown>) => call<Instance>('instances:update', { id, patch }),
    remove: (id: string, deleteFiles: boolean) => call<boolean>('instances:delete', { id, deleteFiles }),
    duplicate: (id: string, name: string) => call<Instance>('instances:duplicate', { id, name }),
    stats: (id: string) => call<InstanceStats>('instances:stats', { id }),
    openFolder: (id: string, sub?: string) => call<boolean>('instances:openFolder', { id, sub }),
    install: (id: string) => call<{ versionId: string; javaPath: string }>('instances:install', { id }),
    repair: (id: string) => call<{ versionId: string; javaPath: string }>('instances:repair', { id })
  },

  launch: {
    start: (instanceId: string, serverAddress?: string) =>
      call<LaunchState>('launch:start', { instanceId, serverAddress }),
    stop: (instanceId: string) => call<boolean>('launch:stop', { instanceId }),
    states: () => call<LaunchState[]>('launch:state'),
    logs: (instanceId: string, limit?: number) => call<GameLogLine[]>('launch:logs', { instanceId, limit })
  },

  downloads: {
    state: () => call<DownloadProgress[]>('downloads:state'),
    pause: (taskId: string) => call<boolean>('downloads:pause', { taskId }),
    resume: (taskId: string) => call<boolean>('downloads:resume', { taskId }),
    cancel: (taskId: string) => call<boolean>('downloads:cancel', { taskId }),
    retry: (taskId: string) => call<boolean>('downloads:retry', { taskId })
  },

  java: {
    list: (refresh = false) => call<JavaInstallation[]>('java:list', { refresh }),
    test: (path: string) => call<JavaInstallation>('java:test', { path }),
    installRuntime: (majorVersion: number) =>
      call<{ path: string; component: string }>('java:installRuntime', { majorVersion }),
    recommend: (minecraftVersion: string) =>
      call<{ majorVersion: number | null; component: string | null }>('java:recommend', { minecraftVersion })
  },

  mods: {
    list: (instanceId: string) => call<ModInfo[]>('mods:list', { instanceId }),
    setEnabled: (instanceId: string, fileName: string, enabled: boolean) =>
      call<boolean>('mods:setEnabled', { instanceId, fileName, enabled }),
    remove: (instanceId: string, fileName: string) => call<boolean>('mods:delete', { instanceId, fileName }),
    import: (instanceId: string, files: string[]) => call<{ imported: number }>('mods:import', { instanceId, files }),
    openFolder: (instanceId: string) => call<boolean>('mods:openFolder', { instanceId })
  },

  content: {
    list: (instanceId: string, kind: 'resourcepacks' | 'shaderpacks') =>
      call<ContentPack[]>('content:list', { instanceId, kind }),
    import: (instanceId: string, kind: 'resourcepacks' | 'shaderpacks', files: string[]) =>
      call<{ imported: number }>('content:import', { instanceId, kind, files }),
    setEnabled: (instanceId: string, kind: 'resourcepacks' | 'shaderpacks', fileName: string, enabled: boolean) =>
      call<boolean>('content:setEnabled', { instanceId, kind, fileName, enabled }),
    remove: (instanceId: string, kind: 'resourcepacks' | 'shaderpacks', fileName: string) =>
      call<boolean>('content:delete', { instanceId, kind, fileName }),
    openFolder: (instanceId: string, kind: 'resourcepacks' | 'shaderpacks' | 'screenshots') =>
      call<boolean>('content:openFolder', { instanceId, kind }),
    screenshots: (instanceId: string) => call<Screenshot[]>('content:screenshots', { instanceId })
  },

  worlds: {
    list: (instanceId: string) => call<WorldInfo[]>('worlds:list', { instanceId }),
    openFolder: (instanceId: string, folderName?: string) =>
      call<boolean>('worlds:openFolder', { instanceId, folderName }),
    backup: (instanceId: string, folderName: string) => call<BackupInfo>('worlds:backup', { instanceId, folderName }),
    listBackups: (instanceId: string) => call<BackupInfo[]>('worlds:listBackups', { instanceId }),
    deleteBackup: (instanceId: string, fileName: string) =>
      call<boolean>('worlds:deleteBackup', { instanceId, fileName }),
    remove: (instanceId: string, folderName: string) => call<BackupInfo>('worlds:delete', { instanceId, folderName })
  },

  servers: {
    list: () => call<{ servers: SavedServer[]; statuses: ServerStatus[] }>('servers:list'),
    save: (input: {
      id: string | null
      name: string
      address: string
      port: number
      notedVersion?: string | null
      description?: string | null
      favorite?: boolean
      preferredInstanceId?: string | null
    }) => call<SavedServer>('servers:save', input),
    remove: (id: string) => call<boolean>('servers:delete', { id }),
    favorite: (id: string, favorite: boolean) => call<SavedServer>('servers:favorite', { id, favorite }),
    ping: (id: string) => call<ServerStatus>('servers:ping', { id }),
    pingAll: () => call<ServerStatus[]>('servers:pingAll'),
    import: (instanceId: string) => call<{ imported: number }>('servers:import', { instanceId })
  },

  skins: {
    list: () => call<SavedSkin[]>('skins:list'),
    import: (filePath: string, name: string, variant: 'classic' | 'slim') =>
      call<SavedSkin>('skins:import', { filePath, name, variant }),
    remove: (id: string) => call<boolean>('skins:delete', { id }),
    favorite: (id: string, favorite: boolean) => call<SavedSkin>('skins:favorite', { id, favorite }),
    apply: (id: string) => call<Account>('skins:apply', { id }),
    reset: () => call<Account>('skins:resetToCurrent')
  }
}

export function subscribe(channel: EventChannel, listener: (payload: never) => void): () => void {
  return window.nexus.on(channel, listener as (payload: unknown) => void)
}
