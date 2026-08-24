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

/* ------------------------------------------------------------ hosted servers */

/**
 * Who can reach a hosted server.
 *
 * Kept separate from `onlineMode` on purpose. Tying the two together forced a
 * choice between letting the AI companion join and letting friends join, which
 * are unrelated questions: one is about authentication, the other about which
 * network interface the server listens on.
 */
export type ServerReachability = 'local' | 'network' | 'anyone'

/** Which server implementation to run. */
export type ServerSoftware = 'vanilla' | 'paper' | 'purpur' | 'fabric' | 'forge' | 'neoforge'

export interface ServerSoftwareInfo {
  id: ServerSoftware
  label: string
  blurb: string
  plugins: boolean
  mods: boolean
}

export type HostedServerStatus = 'stopped' | 'installing' | 'starting' | 'running' | 'stopping' | 'error'

/** A Minecraft server the launcher installs, configures, and runs itself. */
export interface HostedServer {
  id: string
  name: string
  minecraftVersion: string
  software: ServerSoftware
  /** Build or loader version of the server software, filled in on install. */
  softwareVersion: string | null
  port: number
  /**
   * Whether Mojang verifies that joining players own the game. True is the
   * default. Turning it off lets the AI companion join without a second paid
   * account, at the cost of the server trusting whatever name a client claims —
   * which is why the launcher also binds it to loopback when it is off.
   */
  onlineMode: boolean
  /** Which network interface the server binds to. */
  reachability: ServerReachability
  memoryMb: number
  motd: string
  difficulty: 'peaceful' | 'easy' | 'normal' | 'hard'
  gameMode: 'survival' | 'creative' | 'adventure'
  maxPlayers: number
  /** Enables command blocks. Player cheats come from being an operator. */
  allowCheats: boolean

  /* --------------------------------------------------- world and gameplay
   *
   * These map onto server.properties keys of the same meaning. They are all
   * optional so that servers created before they existed keep working — each
   * falls back to the same default a fresh Minecraft server would use.
   */

  /** Seed for world generation. Empty means let the server pick one. */
  levelSeed?: string
  /** Whether players can hurt each other. */
  pvp?: boolean
  /** One life: death bans the player from the world. */
  hardcore?: boolean
  /** Allows flight for players in survival, for use with mods that grant it. */
  allowFlight?: boolean
  /** Radius in blocks around spawn that only operators may build in. */
  spawnProtection?: number
  /** How many chunks are sent to players. The biggest lever on performance. */
  viewDistance?: number
  /** How many chunks actually tick. Never larger than the view distance. */
  simulationDistance?: number
  /** Whether hostile mobs spawn. */
  spawnMonsters?: boolean
  /** Whether animals spawn. */
  spawnAnimals?: boolean
  /** Only players on the whitelist may join. */
  whitelist?: boolean
  /**
   * Players granted operator status when the server starts. Without this a
   * launcher-hosted server has no operator at all, so nobody can run /gamemode,
   * /time or any other command on their own world.
   */
  operators: string[]
  /** When the user accepted the Minecraft EULA, or null if they have not. */
  eulaAcceptedAt: number | null
  /** Version whose server jar is actually on disk. */
  installedVersion: string | null
  createdAt: number
  lastStartedAt: number | null
}

export interface HostedServerState {
  id: string
  status: HostedServerStatus
  detail: string
  /** Players currently connected, read from the server console. */
  players: string[]
  pid: number | null
  startedAt: number | null
  /**
   * Where to actually connect, as `host:port`.
   *
   * Not always loopback: a server set to "my local network" binds to the
   * machine's LAN address alone, and nothing answers on 127.0.0.1. Everything
   * that needs to reach the server — the Join button, the companions — has to
   * be told this rather than assuming.
   */
  address: string
}

export interface HostedServerConsoleLine {
  id: number
  serverId: string
  at: number
  text: string
  stream: 'out' | 'err' | 'in'
}

export interface SaveHostedServerInput {
  id: string | null
  name: string
  minecraftVersion: string
  software: ServerSoftware
  port: number
  onlineMode: boolean
  reachability: ServerReachability
  memoryMb: number
  motd: string
  difficulty: HostedServer['difficulty']
  gameMode: HostedServer['gameMode']
  maxPlayers: number
  allowCheats: boolean
  operators: string[]

  /* World and gameplay. Optional so older callers keep compiling. */
  levelSeed?: string
  pvp?: boolean
  hardcore?: boolean
  allowFlight?: boolean
  spawnProtection?: number
  viewDistance?: number
  simulationDistance?: number
  spawnMonsters?: boolean
  spawnAnimals?: boolean
  whitelist?: boolean
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

/* --------------------------------------------------------------- datapacks */

export type DataPackOptionValue = string | number | boolean
export type DataPackOptionValues = Record<string, DataPackOptionValue>

export interface DataPackOption {
  key: string
  label: string
  type: 'boolean' | 'number' | 'select'
  default: DataPackOptionValue
  min?: number
  max?: number
  choices?: Array<{ value: string; label: string }>
}

/** A pack the launcher can generate, with the knobs it exposes. */
export interface DataPackDefinition {
  id: string
  name: string
  tagline: string
  description: string
  icon: string
  /** Groups packs in the interface, e.g. "Survival" or "Crafting". */
  category: string
  options: DataPackOption[]
}

export interface DataPackInstallResult {
  world: string
  fileName: string
  path: string
  packFormat: number
  fileCount: number
}

export interface InstalledDataPack {
  fileName: string
  sizeBytes: number
  /** True when this launcher generated it. */
  generated: boolean
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
  /**
   * False when the author has opted out of third-party distribution, so no
   * launcher may download it. CurseForge only; Modrinth has no such flag.
   */
  distributionAllowed?: boolean
  source?: 'modrinth' | 'curseforge'
  pageUrl?: string
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
  /** False when the file cannot be fetched automatically (author opt-out). */
  downloadable?: boolean
}

/** A newer build of an installed mod, found by matching its file hash. */
export interface ModUpdate {
  fileName: string
  modName: string
  projectId: string
  currentVersion: string | null
  newVersionId: string
  newVersion: string
  newFileName: string
  sizeBytes: number
  enabled: boolean
}

export interface ModrinthSearchResult {
  projects: ModrinthProject[]
  total: number
  offset: number
}

/** Summary of an exported instance archive, shown before importing it. */
export interface InstanceExportInfo {
  name: string
  minecraftVersion: string
  loader: LoaderId
  loaderVersion: string | null
  exportedAt: number
  includesWorlds: boolean
  fileCount: number
  modCount: number
  sizeBytes: number
}

export interface ModpackInfo {
  name: string
  version: string
  summary: string | null
  minecraftVersion: string
  loader: LoaderId
  loaderVersion: string | null
  fileCount: number
  overrideCount: number
  /** Which modpack container this came from. */
  format: 'modrinth' | 'curseforge'
}

export interface ModpackInstallResult {
  instance: Instance
  installedFiles: number
  overrides: number
  /** Files skipped because no download host was allowed. */
  skipped: string[]
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
  /** CurseForge API key. Optional — Modrinth needs none. */
  curseForgeApiKey: string
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

import type { Companion, CompanionEvent, CompanionStatus } from './companion'

export interface EventMap {
  'companion:event': CompanionEvent
  'companion:status': {
    companionId: string
    status: CompanionStatus
    detail: string
    goal: string | null
    connectedVersion: string | null
    /** Whether a bot process exists, which `status` alone does not tell you. */
    alive: boolean
  }
  'companion:memory': { companionId: string; notes: string[] }
  'companion:list': Companion[]
  'host:changed': HostedServer[]
  'host:state': HostedServerState
  'host:console': HostedServerConsoleLine
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

/** Everything needed to advertise a hosted server somewhere. */
export interface ServerShareDetails {
  /** What people outside the network type in, once the port is forwarded. */
  publicAddress: string | null
  /** What people in the house type in. */
  localAddress: string
  /**
   * Whether the public address answered a Minecraft ping.
   *
   * `null` means it could not be tested rather than that it failed — there is
   * no public address yet, or the port is not forwarded.
   */
  reachable: boolean | null
  /** Why a test failed, in words worth reading. */
  note: string | null
  /** The line players see in their server list. */
  motd: string
  minecraftVersion: string
  software: string
  maxPlayers: number
}
