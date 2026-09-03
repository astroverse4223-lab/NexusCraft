import type { IpcChannel, EventChannel } from '@shared/ipc'
import type {
  Account,
  AppSettings,
  BackupInfo,
  ContentPack,
  CrashAutopsy,
  CrashFix,
  CreateInstanceInput,
  DownloadProgress,
  GameLogLine,
  Instance,
  InstanceSnapshot,
  InstanceStats,
  SnapshotDiff,
  JavaInstallation,
  LauncherErrorPayload,
  LaunchState,
  LoaderId,
  LoaderVersion,
  ModInfo,
  ContentKindId,
  ModrinthSearchResult,
  ModrinthVersion,
  ModrinthInstallResult,
  ModpackInfo,
  ModpackInstallResult,
  ModpackServerInstallResult,
  ModUpdate,
  ModUpdateSweep,
  ModChangelog,
  ModRollback,
  InstanceExportInfo,
  DataPackDefinition,
  DataPackOptionValues,
  DataPackInstallResult,
  ForeignInstanceInfo,
  InstalledDataPack,
  Result,
  SavedServer,
  SavedSkin,
  ServerInvite,
  ServerShareDetails,
  ServerStatus,
  DirectoryListing,
  DirectoryLookup,
  DirectoryCompatibility,
  DirectoryJoinTargets,
  VersionManifestInfo,
  WorldInfo,
  WorldMapData
} from '@shared/types'
import type {
  BlueprintSummary,
  BuildSummary,
  CompanionUsage,
  Companion,
  CompanionSettings,
  CompanionState,
  Crew,
  CrewNote,
  RoutineInfo
} from '@shared/companion'
import type {
  HostedServer,
  HostedServerConsoleLine,
  HostedServerState,
  SaveHostedServerInput,
  ServerSoftwareInfo
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
/** Mirrors the main process's ModUpdateSettings, minus what the UI cannot set. */
export interface ModAutoUpdateSettings {
  mode: 'off' | 'notify' | 'install'
  everyHours: number
  reviewRisky: boolean
  lastCheck: number | null
}

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
  scratchData: boolean
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

/** The relay agent a server uses when its router cannot forward a port. */
export interface TunnelSettings {
  agentPath: string
  provider: 'playit' | 'custom'
  args: string
}

export interface TunnelState {
  serverId: string
  status: 'stopped' | 'starting' | 'running' | 'error'
  address: string | null
  detail: string
  output: string[]
}

/** How often a hosted server snapshots its world, and how many it keeps. */
export interface ServerBackupSettings {
  enabled: boolean
  intervalMinutes: number
  keep: number
  onStop: boolean
}

/** What a modpack-as-server install may override. All optional. */
export interface ModpackServerOptions {
  name?: string
  port?: number
  memoryMb?: number
}

export const api = {
  app: {
    info: () => call<AppInfo>('app:info'),
    openExternal: (url: string) => call<boolean>('app:openExternal', { url }),
    openPath: (path: string) => call<boolean>('app:openPath', { path }),
    pickDirectory: (title?: string) => call<string | null>('app:pickDirectory', { title }),
    pickFiles: (opts?: { title?: string; extensions?: string[]; multi?: boolean }) =>
      call<string[]>('app:pickFiles', opts ?? {}),
    pickSavePath: (opts: { title?: string; defaultName?: string; extensions?: string[] }) =>
      call<string | null>('app:pickSavePath', opts),
    window: (action: 'minimize' | 'maximize' | 'close') => call<boolean>('app:window', { action }),
    memory: () => call<MemoryInfo>('app:systemMemory'),
    diagnostics: (outputPath: string, opts: { instanceId?: string; note?: string } = {}) =>
      call<{ path: string; bytes: number; files: number }>('app:diagnostics', { outputPath, ...opts })
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
    repair: (id: string) => call<{ versionId: string; javaPath: string }>('instances:repair', { id }),
    export: (id: string, outputPath: string, includeWorlds: boolean, includeScreenshots: boolean) =>
      call<{ path: string; bytes: number; entries: number }>('instances:export', {
        id,
        outputPath,
        includeWorlds,
        includeScreenshots
      }),
    inspectArchive: (filePath: string) => call<InstanceExportInfo>('instances:inspectArchive', { filePath }),
    importArchive: (filePath: string, name?: string) => call<Instance>('instances:import', { filePath, name }),
    findForeign: () => call<ForeignInstanceInfo[]>('instances:findForeign'),
    importForeign: (id: string, name?: string) =>
      call<{ instanceId: string; name: string; copiedFolders: string[]; skipped: string[] }>(
        'instances:importForeign',
        { id, name }
      ),
    snapshots: (id: string) => call<InstanceSnapshot[]>('instances:snapshots', { id }),
    snapshot: (id: string, name: string, note?: string) =>
      call<InstanceSnapshot>('instances:snapshot', { id, name, note }),
    restoreSnapshot: (id: string, snapshotId: string) =>
      call<InstanceSnapshot>('instances:restoreSnapshot', { id, snapshotId }),
    deleteSnapshot: (id: string, snapshotId: string) =>
      call<boolean>('instances:deleteSnapshot', { id, snapshotId }),
    diffSnapshot: (id: string, snapshotId: string) =>
      call<SnapshotDiff>('instances:diffSnapshot', { id, snapshotId }),
    exportPack: (
      id: string,
      outputPath: string,
      options: {
        name?: string
        version?: string
        summary?: string
        includeConfigs?: boolean
        includeWorlds?: boolean
      } = {}
    ) =>
      call<{ path: string; bytes: number; linked: number; overrides: number; unmatched: string[] }>(
        'instances:exportPack',
        { id, outputPath, ...options }
      )
  },

  launch: {
    start: (instanceId: string, serverAddress?: string) =>
      call<LaunchState>('launch:start', { instanceId, serverAddress }),
    stop: (instanceId: string) => call<boolean>('launch:stop', { instanceId }),
    states: () => call<LaunchState[]>('launch:state'),
    logs: (instanceId: string, limit?: number) => call<GameLogLine[]>('launch:logs', { instanceId, limit }),
    autopsyAvailable: () => call<{ available: boolean }>('launch:autopsyAvailable'),
    autopsy: (instanceId: string) => call<CrashAutopsy>('launch:autopsy', { instanceId }),
    applyFix: (instanceId: string, fix: CrashFix) =>
      call<{ applied: string; maxRamMb?: number }>('launch:applyFix', { instanceId, fix })
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
    checkUpdates: (instanceId: string) => call<ModUpdate[]>('mods:checkUpdates', { instanceId }),
    applyUpdate: (instanceId: string, update: ModUpdate) =>
      call<boolean>('mods:applyUpdate', { instanceId, update }),
    changelog: (instanceId: string, update: ModUpdate) =>
      call<ModChangelog[]>('mods:changelog', { instanceId, update }),
    autoUpdateSettings: () => call<ModAutoUpdateSettings>('mods:autoUpdateSettings', {}),
    setAutoUpdateSettings: (patch: Partial<Omit<ModAutoUpdateSettings, 'lastCheck'>>) =>
      call<ModAutoUpdateSettings>('mods:setAutoUpdateSettings', { patch }),
    hollowStatus: (instanceId: string) =>
      call<{
        available: boolean
        compatible: boolean
        installed: boolean
        reason: string | null
        hasFabricApi: boolean
        suggestedModel: string | null
        compatibleInstances: string[]
      }>('mods:hollowStatus', { instanceId }),
    installHollow: (instanceId: string) =>
      call<{ installedJar: boolean; wroteConfig: boolean; model: string | null; warning: string | null }>(
        'mods:installHollow',
        { instanceId }
      ),
    checkAllNow: () => call<ModUpdateSweep>('mods:checkAllNow', {}),
    rollbacks: (instanceId: string) => call<ModRollback[]>('mods:rollbacks', { instanceId }),
    rollback: (instanceId: string, fileName: string) =>
      call<ModRollback>('mods:rollback', { instanceId, fileName }),
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

  modrinth: {
    search: (input: {
      query: string
      kind: ContentKindId
      gameVersion?: string | null
      loader?: string | null
      offset?: number
      limit?: number
      instanceId?: string | null
    }) => call<ModrinthSearchResult>('modrinth:search', input),
    versions: (projectId: string, kind: ContentKindId, gameVersion?: string | null, loader?: string | null) =>
      call<ModrinthVersion[]>('modrinth:versions', { projectId, kind, gameVersion, loader }),
    install: (instanceId: string, versionId: string, kind: ContentKindId) =>
      call<ModrinthInstallResult>('modrinth:install', { instanceId, versionId, kind }),
    project: (projectId: string) => call<{ body: string; title: string }>('modrinth:project', { projectId })
  },

  curseforge: {
    status: () => call<{ configured: boolean }>('curseforge:status'),
    verify: (key?: string) => call<{ ok: boolean; reason: string }>('curseforge:verify', { key }),
    search: (input: {
      query: string
      kind: ContentKindId
      gameVersion?: string | null
      loader?: string | null
      offset?: number
      limit?: number
      instanceId?: string | null
    }) => call<ModrinthSearchResult>('curseforge:search', input),
    files: (projectId: string, kind: ContentKindId, gameVersion?: string | null, loader?: string | null) =>
      call<ModrinthVersion[]>('curseforge:files', { projectId, kind, gameVersion, loader }),
    install: (instanceId: string, projectId: string, fileId: string, kind: ContentKindId) =>
      call<ModrinthInstallResult>('curseforge:install', { instanceId, projectId, fileId, kind })
  },

  companion: {
    routines: () => call<RoutineInfo[]>('companion:routines'),
    list: () => call<Companion[]>('companion:list'),
    setMicrophone: (wanted: boolean) =>
      call<{ wanted: boolean }>('companion:setMicrophone', { wanted }),
    toolSizes: () =>
      call<{ full: number; core: number; fullTokens: number; coreTokens: number }>(
        'companion:toolSizes',
        {}
      ),
    states: () => call<CompanionState[]>('companion:states'),
    create: (name?: string) => call<Companion>('companion:create', { name }),
    remove: (id: string) => call<boolean>('companion:delete', { id }),
    settings: (id: string) => call<Companion>('companion:settings', { id }),
    updateSettings: (id: string, patch: Partial<CompanionSettings> & { apiKey?: string }) =>
      call<Companion>('companion:updateSettings', { id, patch }),
    start: (id: string) => call<CompanionState>('companion:start', { id }),
    stop: (id: string) => call<CompanionState>('companion:stop', { id }),
    state: (id: string) => call<CompanionState>('companion:state', { id }),
    instruct: (id: string, text: string) => call<boolean>('companion:instruct', { id, text }),
    clearMemory: (id: string) => call<boolean>('companion:clearMemory', { id }),
    camera: (id: string, on: boolean) => call<boolean>('companion:camera', { id, on }),
    interrupt: (id: string) => call<boolean>('companion:interrupt', { id }),
    usage: () => call<Record<string, CompanionUsage>>('companion:usage'),
    resetUsage: (id?: string) => call<boolean>('companion:resetUsage', { id }),
    builds: () => call<BuildSummary[]>('companion:builds'),
    undoBuild: (buildId: string, companionId?: string) =>
      call<boolean>('companion:undoBuild', { buildId, companionId }),
    blueprints: () => call<BlueprintSummary[]>('companion:blueprints'),
    importSchematic: (filePath: string) => call<BlueprintSummary>('companion:importSchematic', { filePath }),
    build: (id: string, blueprintId: string) => call<boolean>('companion:build', { id, blueprintId }),
    exportBlueprint: (
      blueprintId: string,
      target: { instanceId?: string; serverId?: string },
      format: 'schem' | 'nbt'
    ) =>
      call<{ path: string; format: string; bytes: number }>('blueprints:export', {
        blueprintId,
        ...target,
        format
      }),
    setupLitematica: (instanceId: string) =>
      call<{ installed: string[]; missing: string[] }>('blueprints:setupLitematica', { instanceId }),
    listModels: (id: string) => call<string[]>('companion:listModels', { id }),
    testModel: (id: string) =>
      call<{ ok: boolean; ms: number; model: string; reply: string }>('companion:testModel', { id })
  },

  crews: {
    list: () => call<Crew[]>('crew:list'),
    create: (name: string, foremanId: string, memberIds: string[]) =>
      call<Crew>('crew:create', { name, foremanId, memberIds }),
    update: (id: string, patch: { name?: string; memberIds?: string[] }) =>
      call<Crew>('crew:update', { id, patch }),
    remove: (id: string) => call<boolean>('crew:delete', { id }),
    start: (id: string) =>
      call<{ started: string[]; failed: Array<{ username: string; reason: string }> }>('crew:start', { id }),
    stop: (id: string) => call<string[]>('crew:stop', { id }),
    notes: (id: string) => call<CrewNote[]>('crew:notes', { id }),
    clearNotes: (id: string) => call<boolean>('crew:clearNotes', { id })
  },

  host: {
    installModrinth: (id: string, versionId: string, kind: string) =>
      call<ModrinthInstallResult>('host:installModrinth', { id, versionId, kind }),
    installCurseForge: (id: string, projectId: string, fileId: string, kind: string) =>
      call<ModrinthInstallResult>('host:installCurseForge', { id, projectId, fileId, kind }),
    share: (id: string) => call<ServerShareDetails>('host:share', { id }),
    forwardStatus: (id: string) =>
      call<{
        available: boolean
        open: boolean
        externalAddress: string | null
        router: string | null
        reason: string | null
      }>('host:forwardStatus', { id }),
    openPort: (id: string, acceptUnverified?: boolean) =>
      call<{
        available: boolean
        open: boolean
        externalAddress: string | null
        router: string | null
        reason: string | null
      }>('host:openPort', { id, acceptUnverified }),
    closePort: (id: string) => call<{ closed: boolean }>('host:closePort', { id }),
    list: () => call<HostedServer[]>('host:list'),
    states: () => call<HostedServerState[]>('host:states'),
    console: (id: string) => call<HostedServerConsoleLine[]>('host:console', { id }),
    eulaUrl: () => call<string>('host:eulaUrl'),
    software: () => call<ServerSoftwareInfo[]>('host:software'),
    mods: (id: string) => call<ModInfo[]>('host:mods', { id }),
    importMods: (id: string) => call<number>('host:importMods', { id }),
    toggleMod: (id: string, fileName: string, enabled: boolean) =>
      call<boolean>('host:toggleMod', { id, fileName, enabled }),
    deleteMod: (id: string, fileName: string) => call<boolean>('host:deleteMod', { id, fileName }),
    installMod: (id: string, versionId: string) => call<unknown>('host:installMod', { id, versionId }),
    joinTargets: (id: string) => call<Instance[]>('host:joinTargets', { id }),
    stewards: (id: string) => call<Companion[]>('host:stewards', { id }),
    deploySteward: (id: string, companionId?: string) =>
      call<{ companion: Companion; created: boolean; warning: string | null }>('host:deploySteward', {
        id,
        companionId
      }),
    dismissSteward: (companionId: string) => call<Companion>('host:dismissSteward', { companionId }),
    backups: (id: string) => call<BackupInfo[]>('host:backups', { id }),
    backup: (id: string) => call<BackupInfo>('host:backup', { id }),
    restoreBackup: (id: string, fileName: string) => call<boolean>('host:restoreBackup', { id, fileName }),
    deleteBackup: (id: string, fileName: string) => call<boolean>('host:deleteBackup', { id, fileName }),
    restartSettings: (id: string) =>
      call<{
        enabled: boolean
        intervalHours: number
        warnMinutes: number
        skipIfPlayers: boolean
        nextAt: number | null
      }>('host:restartSettings', { id }),
    setRestartSettings: (
      id: string,
      patch: Partial<{ enabled: boolean; intervalHours: number; warnMinutes: number; skipIfPlayers: boolean }>
    ) =>
      call<{
        enabled: boolean
        intervalHours: number
        warnMinutes: number
        skipIfPlayers: boolean
        nextAt: number | null
      }>('host:setRestartSettings', { id, patch }),
    backupSettings: (id: string) => call<ServerBackupSettings>('host:backupSettings', { id }),
    inviteLink: (id: string) =>
      call<{ link: string; address: string; isPublic: boolean; note: string | null }>('host:inviteLink', { id }),
    tunnelSettings: (id: string) => call<TunnelSettings>('host:tunnelSettings', { id }),
    setTunnelSettings: (id: string, patch: Partial<TunnelSettings>) =>
      call<TunnelSettings>('host:setTunnelSettings', { id, patch }),
    tunnelState: (id: string) => call<TunnelState>('host:tunnelState', { id }),
    startTunnel: (id: string) => call<TunnelState>('host:startTunnel', { id }),
    stopTunnel: (id: string) => call<TunnelState>('host:stopTunnel', { id }),
    setBackupSettings: (id: string, patch: Partial<ServerBackupSettings>) =>
      call<ServerBackupSettings>('host:setBackupSettings', { id, patch }),
    join: (id: string, instanceId?: string) => call<unknown>('host:join', { id, instanceId }),
    openFolder: (id: string) => call<boolean>('host:openFolder', { id }),
    syncMods: (id: string, instanceId: string) =>
      call<{ copied: string[]; alreadyPresent: string[]; instanceName: string }>('host:syncMods', {
        id,
        instanceId
      }),
    save: (input: SaveHostedServerInput) => call<HostedServer>('host:save', input),
    remove: (id: string, deleteWorld: boolean) => call<boolean>('host:delete', { id, deleteWorld }),
    install: (id: string) => call<HostedServer>('host:install', { id }),
    acceptEula: (id: string) => call<HostedServer>('host:acceptEula', { id }),
    start: (id: string) => call<HostedServerState>('host:start', { id }),
    stop: (id: string) => call<HostedServerState>('host:stop', { id }),
    command: (id: string, command: string) => call<boolean>('host:command', { id, command })
  },

  datapacks: {
    list: () => call<DataPackDefinition[]>('datapacks:list'),
    preview: (instanceId: string, packId: string, options: DataPackOptionValues) =>
      call<{
        fileName: string
        packFormat: number
        formatSource: string
        files: Array<{ path: string; content: string }>
      }>('datapacks:preview', { instanceId, packId, options }),
    install: (instanceId: string, worldFolder: string, packId: string, options: DataPackOptionValues) =>
      call<DataPackInstallResult>('datapacks:install', { instanceId, worldFolder, packId, options }),
    installed: (instanceId: string, worldFolder: string) =>
      call<InstalledDataPack[]>('datapacks:installed', { instanceId, worldFolder }),
    remove: (instanceId: string, worldFolder: string, fileName: string) =>
      call<boolean>('datapacks:remove', { instanceId, worldFolder, fileName }),
    export: (instanceId: string, packId: string, options: DataPackOptionValues, outputPath: string) =>
      call<{ path: string; packFormat: number }>('datapacks:export', { instanceId, packId, options, outputPath })
  },

  modpacks: {
    inspect: (filePath: string) => call<ModpackInfo>('modpack:inspect', { filePath }),
    installFromCurseForge: (projectId: string, fileId: string, name?: string) =>
      call<ModpackInstallResult>('modpack:installCurseForge', { projectId, fileId, name }),
    installFile: (filePath: string, name?: string) =>
      call<ModpackInstallResult>('modpack:installFile', { filePath, name }),
    installFromModrinth: (versionId: string, name?: string) =>
      call<ModpackInstallResult>('modpack:installModrinth', { versionId, name }),

    /* The same three sources, installed as a server to host instead. */
    serverFromFile: (filePath: string, options: ModpackServerOptions = {}) =>
      call<ModpackServerInstallResult>('modpack:serverFromFile', { filePath, ...options }),
    serverFromModrinth: (versionId: string, options: ModpackServerOptions = {}) =>
      call<ModpackServerInstallResult>('modpack:serverFromModrinth', { versionId, ...options }),
    serverFromCurseForge: (projectId: string, fileId: string, options: ModpackServerOptions = {}) =>
      call<ModpackServerInstallResult>('modpack:serverFromCurseForge', { projectId, fileId, ...options })
  },

  worlds: {
    list: (instanceId: string) => call<WorldInfo[]>('worlds:list', { instanceId }),
    openFolder: (instanceId: string, folderName?: string) =>
      call<boolean>('worlds:openFolder', { instanceId, folderName }),
    backup: (instanceId: string, folderName: string) => call<BackupInfo>('worlds:backup', { instanceId, folderName }),
    map: (instanceId: string, folderName: string) =>
      call<WorldMapData>('worlds:map', { instanceId, folderName }),
    listBackups: (instanceId: string) => call<BackupInfo[]>('worlds:listBackups', { instanceId }),
    deleteBackup: (instanceId: string, fileName: string) =>
      call<boolean>('worlds:deleteBackup', { instanceId, fileName }),
    restore: (instanceId: string, fileName: string) => call<WorldInfo>('worlds:restore', { instanceId, fileName }),
    importArchive: (instanceId: string, filePath: string) => call<WorldInfo>('worlds:import', { instanceId, filePath }),
    remove: (instanceId: string, folderName: string) => call<BackupInfo>('worlds:delete', { instanceId, folderName })
  },

  directory: {
    list: () => call<DirectoryListing>('directory:list'),
    refresh: (force = false) => call<ServerStatus[]>('directory:refresh', { force }),
    ping: (id: string) => call<ServerStatus>('directory:ping', { id }),
    lookup: (address: string) => call<DirectoryLookup>('directory:lookup', { address }),
    add: (name: string, address: string, port: number) =>
      call<SavedServer>('directory:add', { name, address, port }),
    compatibility: () => call<Record<string, DirectoryCompatibility>>('directory:compatibility'),
    joinTargets: (address: string, port: number) =>
      call<DirectoryJoinTargets>('directory:joinTargets', { address, port }),
    join: (address: string, port: number, instanceId?: string) =>
      call<LaunchState>('directory:join', { address, port, instanceId })
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

  links: {
    pendingInvite: () => call<ServerInvite | null>('links:pendingInvite'),
    acceptInvite: (invite: {
      host: string
      port: number
      name?: string | null
      minecraftVersion?: string | null
      loader?: string | null
      packVersionId?: string | null
      instanceId?: string | null
    }) => call<{ instanceId: string; instanceName: string; address: string }>('links:acceptInvite', invite)
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
