/**
 * Domain types shared between the main process, the preload bridge and the renderer.
 * Nothing in here may contain secrets: everything defined here can cross the IPC
 * boundary and end up in the renderer.
 */

/* ------------------------------------------------------------------ accounts */

export type LoaderId = 'vanilla' | 'fabric' | 'forge' | 'neoforge' | 'quilt'

/**
 * A signed-in Microsoft account. Deliberately contains NO tokens — access and
 * refresh tokens never leave the main process.
 */
export interface Account {
  /** Minecraft profile UUID (no dashes), stable per account. */
  id: string
  /** Minecraft username, i.e. the in-game name. */
  username: string
  /** Xbox gamertag, when the Xbox Live profile exposes one. */
  gamertag: string | null
  /** Xbox user id. Passed to the game as `--xuid`. */
  xuid: string | null
  /** True when the account owns / has access to Minecraft: Java Edition. */
  ownsMinecraft: boolean
  /** How access was granted, when the entitlement API tells us. */
  entitlementSource: 'purchase' | 'game_pass' | 'unknown' | 'none'
  /** Data URL of the rendered face, or null while it is still being fetched. */
  avatarDataUrl: string | null
  /** Data URL of the full skin texture. */
  skinDataUrl: string | null
  skinVariant: 'classic' | 'slim'
  capes: Cape[]
  /** Unix ms at which the current Minecraft token expires. */
  expiresAt: number
  isActive: boolean
  addedAt: number
}

export interface Cape {
  id: string
  name: string
  state: 'ACTIVE' | 'INACTIVE'
  /** Data URL, resolved in the main process so the renderer loads no remote images. */
  imageDataUrl: string | null
}

export interface DeviceCodePrompt {
  userCode: string
  verificationUri: string
  expiresAt: number
  message: string
}

export type AuthStage =
  | 'idle'
  | 'awaiting-user'
  | 'polling'
  | 'xbox-live'
  | 'xsts'
  | 'minecraft'
  | 'entitlements'
  | 'profile'
  | 'done'
  | 'error'

export interface AuthProgress {
  stage: AuthStage
  message: string
}

/* ----------------------------------------------------------------- instances */

export interface InstanceWindowSettings {
  width: number
  height: number
  fullscreen: boolean
}

export interface InstanceJavaSettings {
  /** Absolute path to a java executable, or null to auto-select a runtime. */
  javaPath: string | null
  minRamMb: number
  maxRamMb: number
  jvmArgs: string
}

export interface Instance {
  id: string
  name: string
  /** Vanilla Minecraft version id, e.g. "1.21.4". */
  minecraftVersion: string
  loader: LoaderId
  /** Loader version, e.g. a Fabric loader build. Null for vanilla. */
  loaderVersion: string | null
  /**
   * The version id actually launched. For vanilla this equals `minecraftVersion`;
   * for modded it is the loader's generated profile id.
   */
  resolvedVersionId: string | null
  /** Absolute path to this instance's isolated game directory. */
  gameDir: string
  java: InstanceJavaSettings
  window: InstanceWindowSettings
  iconColor: string
  notes: string
  createdAt: number
  lastPlayedAt: number | null
  totalPlaytimeMs: number
  /** True once every required file has been verified on disk at least once. */
  installed: boolean
}

export interface CreateInstanceInput {
  name: string
  minecraftVersion: string
  loader: LoaderId
  loaderVersion?: string | null
  maxRamMb?: number
  iconColor?: string
}

export interface InstanceStats {
  mods: number
  worlds: number
  resourcePacks: number
  shaderPacks: number
  screenshots: number
  diskBytes: number
}

/* ------------------------------------------------------------------ versions */

export interface VersionSummary {
  id: string
  type: 'release' | 'snapshot' | 'old_beta' | 'old_alpha'
  releaseTime: string
  /** True when the client json + jar + assets are present and verified locally. */
  installed: boolean
  /** Java major version the version manifest asks for (e.g. 21). */
  javaMajor: number | null
}

export interface VersionManifestInfo {
  latestRelease: string
  latestSnapshot: string
  versions: VersionSummary[]
  /** Unix ms when the manifest was fetched; null if only a cached copy exists. */
  fetchedAt: number | null
  /** True when the list came from the on-disk cache because the network failed. */
  fromCache: boolean
}

export interface LoaderVersion {
  version: string
  stable: boolean
  recommended: boolean
}

/* ----------------------------------------------------------------- downloads */

export type DownloadPhase =
  | 'idle'
  | 'manifest'
  | 'version-json'
  | 'client-jar'
  | 'libraries'
  | 'assets'
  | 'natives'
  | 'java-runtime'
  | 'loader'
  | 'verifying'
  | 'done'
  | 'error'
  | 'cancelled'
  | 'paused'

export interface DownloadProgress {
  /** Task id — one install job. */
  taskId: string
  instanceId: string | null
  phase: DownloadPhase
  /** Human label for the phase, e.g. "Downloading assets". */
  label: string
  /** File currently being written. */
  currentFile: string
  completedFiles: number
  totalFiles: number
  downloadedBytes: number
  totalBytes: number
  /** Bytes per second, smoothed. */
  speedBps: number
  /** Estimated seconds remaining, or null when unknown. */
  etaSeconds: number | null
  paused: boolean
  errors: DownloadError[]
  active: boolean
}

export interface DownloadError {
  file: string
  message: string
  attempts: number
}

/* --------------------------------------------------------------------- java */

export interface JavaInstallation {
  path: string
  /** Full version string reported by the runtime, e.g. "21.0.3". */
  version: string
  majorVersion: number
  vendor: string
  arch: string
  /** Where it was found. */
  source: 'managed' | 'java-home' | 'path' | 'registry' | 'common-dir' | 'manual'
  /** Managed runtimes are downloaded by the launcher from Mojang. */
  managed: boolean
}

/* --------------------------------------------------------------------- mods */

export interface ModInfo {
  /** Absolute path of the jar on disk. */
  path: string
  fileName: string
  /** Mod id declared in the jar metadata, when readable. */
  modId: string | null
  name: string
  version: string | null
  description: string | null
  authors: string[]
  /** Loaders this jar declares support for. */
  loaders: LoaderId[]
  /** Minecraft version range the mod declares, when present. */
  mcVersionRange: string | null
  enabled: boolean
  sizeBytes: number
  /** Data URL of the mod's embedded icon, when it has one. */
  iconDataUrl: string | null
  /** Problems detected against the owning instance. */
  issues: ModIssue[]
}

export interface ModIssue {
  severity: 'error' | 'warning'
  code:
    | 'loader-mismatch'
    | 'duplicate-mod-id'
    | 'unreadable'
    | 'mc-version-mismatch'
    | 'missing-dependency'
    | 'not-a-jar'
  message: string
}

/* ------------------------------------------------------------------ content */

export interface ContentPack {
  path: string
  fileName: string
  name: string
  description: string | null
  /** pack.png as a data URL when the archive has one. */
  iconDataUrl: string | null
  /** Resource pack format number from pack.mcmeta. */
  packFormat: number | null
  enabled: boolean
  isDirectory: boolean
  sizeBytes: number
}

/* ------------------------------------------------------------------- worlds */

export interface WorldInfo {
  folderName: string
  path: string
  name: string
  lastPlayed: number | null
  gameVersion: string | null
  gameMode: string | null
  hardcore: boolean
  /** icon.png as a data URL when present. */
  iconDataUrl: string | null
  sizeBytes: number
  /** True when level.dat could not be parsed. */
  corrupt: boolean
}

export interface BackupInfo {
  fileName: string
  path: string
  sizeBytes: number
  createdAt: number
  worldName: string
}

/* ------------------------------------------------------------------ servers */

export interface SavedServer {
  id: string
  name: string
  address: string
  port: number
  /** Version the user recorded for this server; informational only. */
  notedVersion: string | null
  description: string | null
  favorite: boolean
  /** Instance to launch when joining, or null to use the selected one. */
  preferredInstanceId: string | null
  lastJoinedAt: number | null
  createdAt: number
  sortOrder: number
}

export interface ServerStatus {
  serverId: string
  /** null while unknown — never rendered as "online". */
  online: boolean | null
  checkedAt: number
  latencyMs: number | null
  playersOnline: number | null
  playersMax: number | null
  versionName: string | null
  protocol: number | null
  motd: string | null
  faviconDataUrl: string | null
  error: string | null
}

/* --------------------------------------------------------------------- skins */

export interface SavedSkin {
  id: string
  name: string
  variant: 'classic' | 'slim'
  /** Data URL of the 64x64 skin texture. */
  dataUrl: string
  favorite: boolean
  addedAt: number
}

/* ---------------------------------------------------------------- modrinth */

export type ContentKindId = 'mod' | 'resourcepack' | 'shader' | 'modpack'

/** A search result from Modrinth. */
export interface ModrinthProject {
  projectId: string
  slug: string
  title: string
  description: string
  author: string
  downloads: number
  follows: number
  /** Resolved in the main process so the renderer loads nothing remotely. */
  iconDataUrl: string | null
  categories: string[]
  projectType: string
  /** True when this project is already present in the target instance. */
  installed: boolean
}

export interface ModrinthVersion {
  versionId: string
  name: string
  versionNumber: string
  gameVersions: string[]
  loaders: string[]
  versionType: 'release' | 'beta' | 'alpha'
  datePublished: string
  downloads: number
  fileName: string
  fileSizeBytes: number
  /** Projects this version needs; required ones are installed alongside it. */
  requiredDependencies: number
}

export interface ModrinthSearchResult {
  projects: ModrinthProject[]
  total: number
  offset: number
}

export interface ModrinthInstallResult {
  installed: string[]
  /** Required dependencies pulled in automatically. */
  dependencies: string[]
  skipped: string[]
}

/* ------------------------------------------------------------------ launch */

export type LaunchStage =
  | 'preparing'
  | 'verifying'
  | 'downloading'
  | 'resolving-java'
  | 'building-args'
  | 'starting'
  | 'running'
  | 'exited'
  | 'error'

export interface LaunchState {
  instanceId: string
  stage: LaunchStage
  message: string
  pid: number | null
  startedAt: number | null
  exitCode: number | null
  /** Populated when the game exits abnormally. */
  crashReport: string | null
  /** Minecraft's own crash report, parsed into something actionable. */
  crash: CrashDiagnosis | null
}

/** A parsed Minecraft crash report. */
export interface CrashDiagnosis {
  reportPath: string | null
  /** The exception Minecraft blamed. */
  cause: string | null
  /** Minecraft's one-line description of what it was doing. */
  description: string | null
  /** Plain-language explanation, when the cause is recognised. */
  explanation: string | null
  actions: string[]
  excerpt: string | null
}

export interface GameLogLine {
  instanceId: string
  stream: 'stdout' | 'stderr' | 'launcher'
  line: string
  at: number
}

/* ------------------------------------------------------------------ settings */

export interface AppSettings {
  /** Root directory holding instances, versions, assets, libraries and runtimes. */
  dataDir: string
  defaultMaxRamMb: number
  defaultMinRamMb: number
  defaultJvmArgs: string
  javaPath: string | null
  closeLauncherOnLaunch: boolean
  /** Bring the launcher back to the front when the game exits. */
  restoreOnGameExit: boolean
  keepLauncherOpen: boolean
  maxConcurrentDownloads: number
  showSnapshots: boolean
  authFlow: 'device-code' | 'browser-redirect'
  /** Azure application (client) id. Empty until the user configures one. */
  clientId: string
  animatedBackground: boolean
  particles: boolean
  accentColor: string
  onboardingComplete: boolean
  selectedInstanceId: string | null
}

/* ------------------------------------------------------------------- errors */

export type LauncherErrorCode =
  | 'CANCELLED'
  | 'AUTH_NOT_CONFIGURED'
  | 'APP_NOT_APPROVED'
  | 'AUTH_DECLINED'
  | 'AUTH_TIMEOUT'
  | 'AUTH_FAILED'
  | 'XBOX_NO_ACCOUNT'
  | 'XBOX_CHILD_ACCOUNT'
  | 'XBOX_REGION_BLOCKED'
  | 'NO_MINECRAFT_ENTITLEMENT'
  | 'NO_MINECRAFT_PROFILE'
  | 'TOKEN_EXPIRED'
  | 'NETWORK_ERROR'
  | 'DOWNLOAD_FAILED'
  | 'CHECKSUM_MISMATCH'
  | 'JAVA_NOT_FOUND'
  | 'JAVA_VERSION_MISMATCH'
  | 'INSTANCE_CORRUPT'
  | 'MISSING_LIBRARIES'
  | 'LOADER_INSTALL_FAILED'
  | 'MOD_CONFLICT'
  | 'LAUNCH_FAILED'
  | 'GAME_CRASHED'
  | 'ALREADY_RUNNING'
  | 'NOT_FOUND'
  | 'INVALID_INPUT'
  | 'UNKNOWN'

/** Serialisable error shape returned by every IPC call that can fail. */
export interface LauncherErrorPayload {
  code: LauncherErrorCode
  /** Short, human readable headline. */
  title: string
  /** Full explanation written for a player, not a developer. */
  message: string
  /** Concrete next steps. */
  actions: string[]
  /** Safe technical detail (never contains tokens). */
  detail: string | null
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: LauncherErrorPayload }

/* -------------------------------------------------------------- ipc events */

export interface EventMap {
  'auth:progress': AuthProgress
  'auth:device-code': DeviceCodePrompt
  'auth:accounts-changed': Account[]
  'download:progress': DownloadProgress
  'launch:state': LaunchState
  'launch:log': GameLogLine
  'instances:changed': Instance[]
  'servers:status': ServerStatus
  'settings:changed': AppSettings
  'toast': { kind: 'info' | 'success' | 'warning' | 'error'; title: string; message?: string }
}
