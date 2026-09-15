import type { AdvancementPack } from '@shared/advancements'
import type { IpcChannel, EventChannel } from '@shared/ipc'
import type { BannerBrain, BannerDesign } from '@shared/banners'
import type { IconArt } from '@shared/icons'
import type { BuiltPack, PackHostStatus, ResourcePackDraft } from '@shared/resourcePacks'
import type { PackForwarding } from '@shared/resourcePacks'
import type { TextureRecipe } from '@shared/textureRecipe'
import type { SiteConfig, SiteStatus } from '@shared/serverSite'
import type { FireworkDesign, ItemDesign, LogoDesign, MotdDesign, RecipePack, LootPack } from '@shared/creations'
import type { OutsideCheck } from '@shared/types'
import type { DomainCheck, Trouble } from '@shared/types'
import type { PaletteBlock } from '@shared/blocks'
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
  CreationKind,
  SavedCreation,
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

/** One mod this launcher ships, as the Mods screen sees it. */
export interface BundledModStatus {
  id: string
  name: string
  blurb: string
  icon: 'ghost' | 'flame' | 'eye'
  wantsModel: boolean
  /** What it needs, already phrased for the pill — "Fabric 1.21.11". */
  requires: string
  available: boolean
  compatible: boolean
  installed: boolean
  reason: string | null
  hasFabricApi: boolean
  suggestedModel: string | null
  compatibleInstances: string[]
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
    recentTrouble: (limit?: number) =>
      call<Trouble[]>('app:recentTrouble', limit === undefined ? undefined : { limit }),
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
    deleteSnapshot: (id: string, snapshotId: string) => call<boolean>('instances:deleteSnapshot', { id, snapshotId }),
    diffSnapshot: (id: string, snapshotId: string) => call<SnapshotDiff>('instances:diffSnapshot', { id, snapshotId }),
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
    applyUpdate: (instanceId: string, update: ModUpdate) => call<boolean>('mods:applyUpdate', { instanceId, update }),
    changelog: (instanceId: string, update: ModUpdate) =>
      call<ModChangelog[]>('mods:changelog', { instanceId, update }),
    autoUpdateSettings: () => call<ModAutoUpdateSettings>('mods:autoUpdateSettings', {}),
    setAutoUpdateSettings: (patch: Partial<Omit<ModAutoUpdateSettings, 'lastCheck'>>) =>
      call<ModAutoUpdateSettings>('mods:setAutoUpdateSettings', { patch }),
    bundledStatus: (instanceId: string) => call<BundledModStatus[]>('mods:bundledStatus', { instanceId }),
    installBundled: (instanceId: string, modId: string) =>
      call<{
        id: string
        name: string
        installedJar: boolean
        wroteConfig: boolean
        model: string | null
        warning: string | null
      }>('mods:installBundled', { instanceId, modId }),
    checkAllNow: () => call<ModUpdateSweep>('mods:checkAllNow', {}),
    rollbacks: (instanceId: string) => call<ModRollback[]>('mods:rollbacks', { instanceId }),
    rollback: (instanceId: string, fileName: string) => call<ModRollback>('mods:rollback', { instanceId, fileName }),
    setEnabled: (instanceId: string, fileName: string, enabled: boolean) =>
      call<boolean>('mods:setEnabled', { instanceId, fileName, enabled }),
    remove: (instanceId: string, fileName: string) => call<boolean>('mods:delete', { instanceId, fileName }),
    import: (instanceId: string, files: string[]) => call<{ imported: number }>('mods:import', { instanceId, files }),
    openFolder: (instanceId: string) => call<boolean>('mods:openFolder', { instanceId })
  },

  /*
   * The offline voice.
   *
   * Synthesis runs in the main process and comes back as bytes, because the
   * renderer is held to `connect-src 'self'` and cannot fetch a model, and
   * because the same loaded model also answers Minecraft. Playing the sound is
   * the renderer's job and only the renderer's.
   */
  voice: {
    status: () =>
      call<{
        state: 'idle' | 'loading' | 'ready' | 'failed'
        build?: 'q4' | 'q8'
        voices?: string[]
        message?: string
        servingToGame: boolean
        builds: Record<'q4' | 'q8', { dtype: string; downloadMb: number; typicalMs: number }>
      }>('voice:status', undefined),
    prepare: (build?: 'q4' | 'q8') =>
      call<{ state: string; voices?: string[]; message?: string }>('voice:prepare', { build }),
    speak: (text: string, voice?: string, build?: 'q4' | 'q8') =>
      call<{ wav: string }>('voice:speak', { text, voice, build }),
    serveToGame: (on: boolean) => call<{ running: boolean }>('voice:serveToGame', { on })
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
    setMicrophone: (wanted: boolean) => call<{ wanted: boolean }>('companion:setMicrophone', { wanted }),
    toolSizes: () =>
      call<{ full: number; core: number; fullTokens: number; coreTokens: number }>('companion:toolSizes', {}),
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
    update: (id: string, patch: { name?: string; memberIds?: string[] }) => call<Crew>('crew:update', { id, patch }),
    remove: (id: string) => call<boolean>('crew:delete', { id }),
    start: (id: string) =>
      call<{ started: string[]; failed: Array<{ username: string; reason: string }> }>('crew:start', { id }),
    stop: (id: string) => call<string[]>('crew:stop', { id }),
    notes: (id: string) => call<CrewNote[]>('crew:notes', { id }),
    clearNotes: (id: string) => call<boolean>('crew:clearNotes', { id })
  },

  /** The blocks the studio can place, with the game's own faces on them. */
  blocks: {
    palette: (minecraftVersion: string) => call<PaletteBlock[]>('blocks:palette', { minecraftVersion }),
    exportBuild: (payload: {
      name: string
      cells: { x: number; y: number; z: number; block: string }[]
      width: number
      depth: number
      layers: number
      instanceId?: string
      serverId?: string
      format: 'schem' | 'nbt'
    }) => call<unknown>('studio:export', payload)
  },

  host: {
    installModrinth: (id: string, versionId: string, kind: string) =>
      call<ModrinthInstallResult>('host:installModrinth', { id, versionId, kind }),
    installCurseForge: (id: string, projectId: string, fileId: string, kind: string) =>
      call<ModrinthInstallResult>('host:installCurseForge', { id, projectId, fileId, kind }),
    share: (id: string) => call<ServerShareDetails>('host:share', { id }),
    checkOutside: (id: string) => call<OutsideCheck>('host:checkOutside', { id }),
    forwardStatus: (id: string) =>
      call<{
        available: boolean
        open: boolean
        externalAddress: string | null
        router: string | null
        reason: string | null
        firewall?: {
          allowed: boolean
          alreadyThere: boolean
          reason: string | null
          manualCommand: string | null
        }
      }>('host:forwardStatus', { id }),
    openPort: (id: string, acceptUnverified?: boolean) =>
      call<{
        available: boolean
        open: boolean
        externalAddress: string | null
        router: string | null
        reason: string | null
        firewall?: {
          allowed: boolean
          alreadyThere: boolean
          reason: string | null
          manualCommand: string | null
        }
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
    sendCircuit: (serverId: string, name: string, player: string, pieces: string[]) =>
      call<{ sent: boolean; blocks: number }>('host:sendCircuit', { serverId, name, player, pieces }),
    setDomain: (serverId: string, domain: string) =>
      call<{ address: string | null }>('host:setDomain', { serverId, domain }),
    checkDomain: (serverId: string, domain: string) => call<DomainCheck>('host:checkDomain', { serverId, domain }),
    discordWebhook: (serverId: string, url: string) =>
      call<{ written: boolean; told: boolean }>('host:discordWebhook', { serverId, url }),
    punishments: (serverId: string) =>
      call<{ kind: string; name: string; by: string; reason: string; at: number; until: number }[]>(
        'host:punishments',
        { serverId }
      ),
    knownPlayers: (serverId: string) => call<string[]>('host:knownPlayers', { serverId }),
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
    map: (instanceId: string, folderName: string) => call<WorldMapData>('worlds:map', { instanceId, folderName }),
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
    add: (name: string, address: string, port: number) => call<SavedServer>('directory:add', { name, address, port }),
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

  mapArt: {
    writeServer: (serverId: string, tiles: number[][], across: number, down: number) =>
      call<{ world: string; ids: number[]; across: number; down: number; commands: string[] }>('mapart:writeServer', {
        serverId,
        tiles,
        across,
        down
      }),
    write: (instanceId: string, worldFolder: string, tiles: number[][], across: number, down: number) =>
      call<{ world: string; ids: number[]; across: number; down: number; commands: string[] }>('mapart:write', {
        instanceId,
        worldFolder,
        tiles,
        across,
        down
      })
  },

  resourcePack: {
    build: (draft: ResourcePackDraft, minecraftVersion: string, path: string) =>
      call<BuiltPack>('resourcepack:build', { draft, minecraftVersion, path }),
    install: (instanceId: string, draft: ResourcePackDraft) =>
      call<BuiltPack>('resourcepack:install', { instanceId, draft }),
    /** What the server is handing out now, and whether it outlives this machine. */
    current: (serverId: string) =>
      call<{ url: string; published: boolean }>('resourcepack:current', { serverId }),

    /** Puts the server's leaderboards and player list where the public site can read them. */
    publishStatus: (serverId: string, repo: string, tag: string) =>
      call<{ url: string; boards: number; players: number }>('site:publishStatus', {
        serverId,
        repo,
        tag
      }),

    /** Whether this machine can upload to GitHub, and as whom. */
    githubStatus: () =>
      call<{ installed: boolean; account: string | null; canWrite: boolean; why: string | null }>(
        'github:status',
        {}
      ),

    /** Builds the pack, puts it on a release, and points the server at it. */
    publish: (payload: {
      serverId: string
      draft: ResourcePackDraft
      repo: string
      tag: string
      assetName: string
      required: boolean
    }) =>
      call<{
        url: string
        sha1: string
        bytes: number
        created: boolean
        /** Whether the file could be fetched back without signing in. */
        reachable: boolean
        pluginTook: boolean
      }>('resourcepack:publish', payload),

    serve: (serverId: string, draft: ResourcePackDraft, port: number, required: boolean, address?: string) =>
      call<
        BuiltPack & {
          url: string
          port: number
          address: string
          /** Whether that url answered when the launcher tried it. */
          reachable: boolean
          /** A local url that did answer, when the published one did not. */
          alternative: string | null
          /** Whether the running server was told, so no restart is needed. */
          offering: boolean
        }
      >('resourcepack:serve', {
        serverId,
        draft,
        port,
        required,
        address
      }),
    hostStatus: () => call<PackHostStatus>('resourcepack:hostStatus'),
    stopHost: () => call<PackHostStatus>('resourcepack:stopHost'),
    attach: (serverId: string, url: string, sha1: string, required: boolean) =>
      call<{ ok: boolean }>('resourcepack:attach', { serverId, url, sha1, required }),
    detach: (serverId: string) => call<{ ok: boolean }>('resourcepack:detach', { serverId }),
    openPort: (port: number) => call<PackForwarding>('resourcepack:openPort', { port }),
    closePort: (port: number) => call<PackForwarding>('resourcepack:closePort', { port }),
    portStatus: (port: number) => call<PackForwarding>('resourcepack:portStatus', { port }),
    textures: (minecraftVersion: string) => call<string[]>('resourcepack:textures', { minecraftVersion }),
    texture: (minecraftVersion: string, path: string) =>
      call<string | null>('resourcepack:texture', { minecraftVersion, path }),
    open: (file: string) =>
      call<{
        name: string
        description: string
        textures: { path: string; image: string }[]
        panorama: string[] | null
        logo: string | null
        ignored: number
      }>('resourcepack:open', { file }),
    saveSound: (name: string, base64: string) =>
      call<{ path: string; bytes: number }>('resourcepack:saveSound', { name, base64 }),
    remember: (draft: ResourcePackDraft) => call<{ ok: boolean }>('resourcepack:remember', { draft }),
    recall: () => call<ResourcePackDraft | null>('resourcepack:recall')
  },

  site: {
    config: (serverId: string) => call<SiteConfig>('site:config', { serverId }),
    save: (config: SiteConfig) => call<SiteConfig>('site:save', { config }),
    start: (serverId: string, port: number) => call<SiteStatus>('site:start', { serverId, port }),
    stop: () => call<SiteStatus>('site:stop'),
    status: () => call<SiteStatus>('site:status'),
    votifierPort: (serverId: string, open: boolean) =>
      call<PackForwarding & { port: number }>('site:votifierPort', { serverId, open }),
    votifierInfo: (serverId: string) =>
      call<{ port: number; token: string; publicKey: string; enabled: boolean }>('site:votifierInfo', { serverId })
  },

  banners: {
    brains: () => call<BannerBrain[]>('banners:brains'),
    design: (prompt: string, companionId: string, current?: unknown) =>
      call<{ design: BannerDesign; dropped: string[]; model: string }>('banners:design', {
        prompt,
        companionId,
        current
      }),
    designRecipe: (prompt: string, companionId: string) =>
      call<{ recipe: TextureRecipe; model: string }>('banners:designRecipe', {
        prompt,
        companionId
      }),
    designIcon: (prompt: string, companionId: string, current?: unknown) =>
      call<{ art: IconArt; dropped: number; model: string }>('banners:designIcon', {
        prompt,
        companionId,
        current
      }),
    designMotd: (prompt: string, companionId: string, current?: unknown) =>
      call<{ design: MotdDesign; model: string }>('banners:designMotd', { prompt, companionId, current }),
    designLogo: (prompt: string, companionId: string, current?: unknown) =>
      call<{ design: LogoDesign; model: string }>('banners:designLogo', { prompt, companionId, current }),
    designFirework: (prompt: string, companionId: string, current?: unknown) =>
      call<{ design: FireworkDesign; dropped: number; model: string }>('banners:designFirework', {
        prompt,
        companionId,
        current
      }),
    designItem: (prompt: string, companionId: string, current?: unknown) =>
      call<{ design: ItemDesign; dropped: string[]; model: string }>('banners:designItem', {
        prompt,
        companionId,
        current
      }),
    applyMotd: (serverId: string, design: MotdDesign) =>
      call<{ motd: string }>('banners:applyMotd', { serverId, design }),
    designRecipes: (prompt: string, companionId: string, current?: unknown) =>
      call<{ pack: RecipePack; dropped: string[]; model: string }>('banners:designRecipes', {
        prompt,
        companionId,
        current
      }),
    installRecipes: (serverId: string, pack: RecipePack) =>
      call<{
        path: string
        fileCount: number
        packFormat: number
        world: string
        reloadNeeded: boolean
      }>('banners:installRecipes', { serverId, pack }),
    designAdvancements: (prompt: string, companionId?: string, current?: AdvancementPack) =>
      call<{ pack: AdvancementPack; dropped: string[]; model: string }>('banners:designAdvancements', {
        prompt,
        companionId,
        current
      }),
    installAdvancements: (serverId: string, pack: AdvancementPack) =>
      call<{ world: string; fileCount: number }>('banners:installAdvancements', {
        serverId,
        pack
      }),
    installAdvancementsWorld: (instanceId: string, worldFolder: string, pack: AdvancementPack) =>
      call<{ world: string; fileCount: number }>('banners:installAdvancementsWorld', {
        instanceId,
        worldFolder,
        pack
      }),
    exportAdvancements: (path: string, pack: AdvancementPack, minecraftVersion: string) =>
      call<{ path: string; packFormat: number }>('banners:exportAdvancements', {
        path,
        pack,
        minecraftVersion
      }),
    designLoot: (prompt: string, companionId?: string, current?: LootPack) =>
      call<{ pack: LootPack; dropped: string[]; model: string }>('banners:designLoot', {
        prompt,
        companionId,
        current
      }),
    installLoot: (serverId: string, pack: LootPack) =>
      call<{ world: string; fileCount: number; skipped: string[] }>('banners:installLoot', {
        serverId,
        pack
      }),
    installLootWorld: (instanceId: string, worldFolder: string, pack: LootPack) =>
      call<{ world: string; fileCount: number; skipped: string[] }>('banners:installLootWorld', {
        instanceId,
        worldFolder,
        pack
      }),
    exportLoot: (path: string, pack: LootPack, minecraftVersion: string) =>
      call<{ path: string; packFormat: number; skipped: string[] }>('banners:exportLoot', {
        path,
        pack,
        minecraftVersion
      }),
    installRecipesWorld: (instanceId: string, worldFolder: string, pack: RecipePack) =>
      call<{
        path: string
        fileCount: number
        packFormat: number
        world: string
        reloadNeeded: boolean
      }>('banners:installRecipesWorld', { instanceId, worldFolder, pack }),
    exportRecipes: (path: string, pack: RecipePack, minecraftVersion: string) =>
      call<{ path: string; packFormat: number }>('banners:exportRecipes', {
        path,
        pack,
        minecraftVersion
      }),
    variations: (kind: CreationKind, prompt: string, companionId: string, count: number) =>
      call<{ results: unknown[]; asked: number }>('banners:variations', {
        kind,
        prompt,
        companionId,
        count
      }),
    giveDesigned: (serverId: string, command: string) =>
      call<{ command: string; sent: boolean }>('banners:giveDesigned', { serverId, command }),
    icon: (serverId: string, png: string) =>
      call<{ path: string; restartNeeded: boolean }>('banners:icon', { serverId, png }),
    save: (path: string, png: string) => call<{ path: string }>('banners:save', { path, png }),
    give: (serverId: string, target: string, design: BannerDesign) =>
      call<{ command: string; sent: boolean }>('banners:give', { serverId, target, design })
  },

  creations: {
    list: (kind?: CreationKind) => call<SavedCreation[]>('creations:list', { kind }),
    save: (input: { id?: string | null; kind: CreationKind; name: string; data: unknown; thumbnail?: string | null }) =>
      call<SavedCreation>('creations:save', input),
    remove: (id: string) => call<boolean>('creations:delete', { id }),
    rename: (id: string, name: string) => call<SavedCreation>('creations:rename', { id, name })
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
