/**
 * Hosting a Minecraft server from inside the launcher.
 *
 * This exists so a player can get a persistent world — one the AI companion can
 * join as a second player — without downloading a server jar by hand, editing
 * server.properties in a text editor, or keeping a console window open. The
 * launcher owns the whole lifecycle: fetch the official server jar from Mojang,
 * provision a Java runtime, write the configuration, run the process, and stream
 * its console back to the UI.
 *
 * Two things are deliberately NOT automated:
 *
 *  - The Minecraft EULA is never accepted on the user's behalf. `eula.txt` is
 *    written only after an explicit call to `acceptEula`, which the UI wires to
 *    a checkbox next to the real agreement link. Ticking a legal agreement for
 *    someone is not a convenience worth having.
 *  - `online-mode` defaults to true. Turning it off is offered, because a bot
 *    joining your own private world otherwise needs a second paid account, but
 *    it is presented with what it actually means rather than set quietly.
 */

import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { networkInterfaces } from 'node:os'
import { existsSync } from 'node:fs'
import { readFile, writeFile, mkdir, rm, copyFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  ServerReachability,
  ServerShareDetails,
  Instance,
  LoaderId,
  ModInfo,
  ModrinthInstallResult,
  HostedServer,
  HostedServerConsoleLine,
  HostedServerState,
  HostedServerStatus,
  SaveHostedServerInput
} from '@shared/types'
import { db, Collections } from '../../core/database'
import { emit } from '../../core/events'
import { LauncherError } from '../../core/errors'
import { createLogger } from '../../core/logger'
import { discoverGateway, closePort, externalAddress } from './portForwarding'
import { pingServer } from './mcPing'
import { dataRoot, ensureDir } from '../../core/paths'
import { createTask } from '../downloads/downloadManager'
import { ensureVersionJson } from '../minecraft/versionService'
import { resolveJavaForVersion } from '../java/javaService'
import { getSettings } from '../settings/settingsService'
import {
  analyseModsIn,
  deleteModIn,
  importModsIn,
  setModEnabledIn,
  type ModTarget
} from '../mods/modService'
import { installVersionToDir } from '../content/modrinthService'
import { instanceSubdir } from '../instances/instanceService'
import { SOFTWARE, launchPlan, provision, runServerInstaller, softwareLabel } from './serverSoftware'

const log = createLogger('host')

/** Kept small: the console is a live view, not an archive. */
const MAX_CONSOLE_LINES = 500

/** How long a polite `stop` gets before the process is killed. */
const STOP_GRACE_MS = 20_000

export const MINECRAFT_EULA_URL = 'https://aka.ms/MinecraftEULA'

/* ------------------------------------------------------------------ paths */

export function hostedServersRoot(): string {
  return join(dataRoot(), 'servers')
}

export function hostedServerDir(id: string): string {
  return join(hostedServersRoot(), id)
}

/**
 * Whether the server directory still needs provisioning. Forge and NeoForge
 * leave no `server.jar` at all, so presence of that file cannot be the test.
 */
function needsInstall(server: HostedServer): boolean {
  if (server.installedVersion !== server.minecraftVersion) return true
  const dir = hostedServerDir(server.id)
  if (server.software === 'forge' || server.software === 'neoforge') {
    return !existsSync(join(dir, 'libraries'))
  }
  return !existsSync(join(dir, 'server.jar'))
}

/** The server implementations the launcher can install, for the UI to offer. */
export function listServerSoftware(): typeof SOFTWARE {
  return SOFTWARE
}

/* ------------------------------------------------------------ live state */

interface Running {
  child: ChildProcess
  state: HostedServerState
  console: HostedServerConsoleLine[]
  lineId: number
  /** Resolves once the process has fully exited. */
  exited: Promise<void>
}

const running = new Map<string, Running>()

function blankState(id: string): HostedServerState {
  return { id, status: 'stopped', detail: '', players: [], pid: null, startedAt: null, address: '' }
}

export function getHostedServerState(id: string): HostedServerState {
  const base = running.get(id)?.state ?? blankState(id)

  /*
   * Fill the address in on the way out rather than when the state was made:
   * the machine's LAN address can change between a server being configured and
   * somebody trying to connect to it, and a stale one is exactly as useless as
   * the wrong one.
   */
  const server = listHostedServers().find((entry) => entry.id === id)
  return { ...base, address: server ? connectAddress(server) : base.address }
}

export function allHostedServerStates(): HostedServerState[] {
  return listHostedServers().map((server) => getHostedServerState(server.id))
}

export function getHostedServerConsole(id: string): HostedServerConsoleLine[] {
  return [...(running.get(id)?.console ?? [])]
}

export function isHostedServerRunning(id: string): boolean {
  return running.has(id)
}

/**
 * Lifecycle notifications for anything that has to follow a server without
 * this module having to know about it.
 *
 * The resident companion is the reason this exists: it must join when the
 * server is ready and leave when it stops, and wiring that in here directly
 * would make servers depend on companions, which is backwards.
 */
export type HostedServerEvent = 'ready' | 'stopped' | 'player-joined' | 'player-left'

type HostedServerListener = (event: HostedServerEvent, serverId: string, player?: string) => void

const lifecycleListeners = new Set<HostedServerListener>()

export function onHostedServerEvent(listener: HostedServerListener): () => void {
  lifecycleListeners.add(listener)
  return () => lifecycleListeners.delete(listener)
}

function notifyLifecycle(event: HostedServerEvent, serverId: string, player?: string): void {
  for (const listener of lifecycleListeners) {
    try {
      listener(event, serverId, player)
    } catch (err) {
      log.warn(`a hosted-server listener threw: ${(err as Error).message}`)
    }
  }
}

function setState(id: string, patch: Partial<HostedServerState>): void {
  const entry = running.get(id)
  const next = { ...(entry?.state ?? blankState(id)), ...patch }
  if (entry) entry.state = next
  emit('host:state', next)
}

function pushConsole(id: string, text: string, stream: HostedServerConsoleLine['stream']): void {
  const entry = running.get(id)
  if (!entry) return
  const line: HostedServerConsoleLine = { id: ++entry.lineId, serverId: id, at: Date.now(), text, stream }
  entry.console.push(line)
  if (entry.console.length > MAX_CONSOLE_LINES) entry.console.shift()
  emit('host:console', line)
}

/* --------------------------------------------------------------- records */

export function listHostedServers(): HostedServer[] {
  return db()
    .all<HostedServer>(Collections.hostedServers)
    .sort((a, b) => (b.lastStartedAt ?? 0) - (a.lastStartedAt ?? 0) || a.name.localeCompare(b.name))
}

export function getHostedServer(id: string): HostedServer {
  const server = db().get<HostedServer>(Collections.hostedServers, id)
  if (!server) throw new LauncherError('NOT_FOUND', `hosted server ${id} does not exist`)
  return server
}

/** Clamped to what a server can actually use, mirroring the launcher's RAM rules. */
function clampMemory(mb: number): number {
  if (!Number.isFinite(mb)) return 2048
  return Math.max(512, Math.min(16384, Math.round(mb)))
}

function clampPort(port: number): number {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new LauncherError('INVALID_INPUT', `port ${port} is out of range`, {
      title: 'That port will not work',
      message: 'Pick a port between 1024 and 65535. The Minecraft default is 25565.',
      actions: ['Use 25565 unless something else already has it']
    })
  }
  return port
}

export function saveHostedServer(input: SaveHostedServerInput): HostedServer {
  const name = input.name.trim()
  if (!name) {
    throw new LauncherError('INVALID_INPUT', 'a server needs a name', {
      title: 'Give the server a name',
      message: 'It is only used to tell your servers apart in the launcher.'
    })
  }

  const port = clampPort(input.port)

  // A port clash between two of your own servers is worth catching before the
  // process starts and fails with a stack trace.
  const clash = listHostedServers().find((s) => s.id !== input.id && s.port === port)
  if (clash) {
    throw new LauncherError('INVALID_INPUT', `port ${port} is already used by ${clash.name}`, {
      title: 'That port is already taken',
      message: `Your server "${clash.name}" is set to port ${port}.`,
      actions: ['Pick a different port, for example 25566']
    })
  }

  const existing = input.id ? getHostedServer(input.id) : null

  if (existing && isHostedServerRunning(existing.id)) {
    throw new LauncherError('ALREADY_RUNNING', 'cannot reconfigure a running server', {
      title: 'Stop the server first',
      message: 'Settings are written when the server starts, so they cannot change while it is running.',
      actions: ['Press Stop, change the settings, then Start again']
    })
  }

  const record: HostedServer = {
    id: existing?.id ?? randomUUID(),
    name,
    minecraftVersion: input.minecraftVersion,
    software: input.software,
    // Cleared when the software or version changes, so a stale build is never claimed.
    softwareVersion:
      existing && existing.software === input.software && existing.minecraftVersion === input.minecraftVersion
        ? existing.softwareVersion
        : null,
    port,
    onlineMode: input.onlineMode,
    reachability: input.reachability,
    memoryMb: clampMemory(input.memoryMb),
    motd: input.motd.slice(0, 59),
    difficulty: input.difficulty,
    gameMode: input.gameMode,
    maxPlayers: Math.max(1, Math.min(100, Math.round(input.maxPlayers))),
    allowCheats: input.allowCheats,
    operators: [...new Set(input.operators.map((name) => name.trim()).filter(Boolean))],

    /*
     * World and gameplay settings, each falling back to what a fresh Minecraft
     * server would use so a server saved before these existed is unchanged by
     * being opened and saved again.
     */
    levelSeed: (input.levelSeed ?? existing?.levelSeed ?? '').trim().slice(0, 120),
    pvp: input.pvp ?? existing?.pvp ?? true,
    hardcore: input.hardcore ?? existing?.hardcore ?? false,
    allowFlight: input.allowFlight ?? existing?.allowFlight ?? false,
    spawnProtection: clampWhole(input.spawnProtection ?? existing?.spawnProtection ?? 16, 0, 256),
    viewDistance: clampWhole(input.viewDistance ?? existing?.viewDistance ?? 10, 3, 32),
    simulationDistance: clampWhole(input.simulationDistance ?? existing?.simulationDistance ?? 10, 3, 32),
    spawnMonsters: input.spawnMonsters ?? existing?.spawnMonsters ?? true,
    spawnAnimals: input.spawnAnimals ?? existing?.spawnAnimals ?? true,
    whitelist: input.whitelist ?? existing?.whitelist ?? false,
    // Accepting the EULA is a separate, explicit act — never carried in on a save.
    eulaAcceptedAt: existing?.eulaAcceptedAt ?? null,
    installedVersion:
      existing && existing.software === input.software && existing.minecraftVersion === input.minecraftVersion
        ? existing.installedVersion
        : null,
    createdAt: existing?.createdAt ?? Date.now(),
    lastStartedAt: existing?.lastStartedAt ?? null
  }

  db().put(Collections.hostedServers, record.id, record)
  emit('host:changed', listHostedServers())
  log.info(`${existing ? 'updated' : 'created'} hosted server ${record.name} (${record.minecraftVersion})`)
  return record
}

export async function deleteHostedServer(id: string, deleteWorld: boolean): Promise<void> {
  if (isHostedServerRunning(id)) await stopHostedServer(id)
  const server = getHostedServer(id)
  db().remove(Collections.hostedServers, id)
  if (deleteWorld) await rm(hostedServerDir(id), { recursive: true, force: true })
  emit('host:changed', listHostedServers())
  log.info(`deleted hosted server ${server.name}${deleteWorld ? ' and its files' : ''}`)
}

/* ------------------------------------------------------------------ eula */

/**
 * Records that the user accepted the Minecraft EULA and writes the file the
 * server reads. Called only from an explicit UI action showing the real link.
 */
export async function acceptEula(id: string): Promise<HostedServer> {
  const server = getHostedServer(id)
  const dir = ensureDir(hostedServerDir(id))
  const accepted = Date.now()

  await writeFile(
    join(dir, 'eula.txt'),
    [
      '# Accepted through the NexusCraft Launcher.',
      `# ${MINECRAFT_EULA_URL}`,
      `# Accepted at ${new Date(accepted).toISOString()}`,
      'eula=true',
      ''
    ].join('\n'),
    'utf8'
  )

  const next: HostedServer = { ...server, eulaAcceptedAt: accepted }
  db().put(Collections.hostedServers, next.id, next)
  emit('host:changed', listHostedServers())
  log.info(`EULA accepted for ${server.name}`)
  return next
}

/* -------------------------------------------------------------- install */

/**
 * Downloads the official server jar for the configured version. The download
 * goes through the shared manager, so it is hash-verified on disk like every
 * other file the launcher fetches.
 */
export async function installHostedServer(id: string): Promise<HostedServer> {
  const server = getHostedServer(id)
  const dir = ensureDir(hostedServerDir(id))

  setState(id, { status: 'installing', detail: `Fetching Minecraft ${server.minecraftVersion}…` })

  const version = await ensureVersionJson(server.minecraftVersion)
  const label = softwareLabel(server.software)

  setState(id, { status: 'installing', detail: `Working out which ${label} build to use…` })
  const plan = await provision(server.software, server.minecraftVersion, version.downloads?.server?.url ?? null)

  const task = createTask({ label: `Installing ${server.name}`, phase: 'libraries' })
  task.add([
    {
      url: plan.url,
      destination: join(dir, plan.fileName),
      // Only Mojang publishes a hash for its jar; the other projects do not
      // expose one on the download endpoint, so size is the only check there.
      // Mojang publishes a sha1; the other projects publish sha256 or nothing,
      // and the download manager verifies sha1, so size is the check there.
      sha1: server.software === 'vanilla' ? (version.downloads?.server?.sha1 ?? null) : null,
      size: server.software === 'vanilla' ? (version.downloads?.server?.size ?? null) : (plan.size ?? null),
      label: `${label} ${plan.softwareVersion}`
    }
  ])
  await task.run()

  // Provision the JDK the server needs, reusing the launcher's runtime manager.
  const settings = getSettings()
  const javaTask = createTask({ label: 'Java runtime', phase: 'java-runtime' })
  await resolveJavaForVersion(version, null, settings.javaPath ?? null, javaTask)

  if (plan.isInstaller) {
    setState(id, { status: 'installing', detail: `Running the ${label} installer…` })
    await runServerInstaller(dir, plan.fileName, version.javaVersion?.majorVersion ?? 17, javaTask)
  }

  const next: HostedServer = { ...server, installedVersion: server.minecraftVersion, softwareVersion: plan.softwareVersion }
  db().put(Collections.hostedServers, next.id, next)
  emit('host:changed', listHostedServers())

  setState(id, { status: 'stopped', detail: `${label} ${plan.softwareVersion} installed and ready to start.` })
  log.info(`installed ${label} ${plan.softwareVersion} for ${server.name} (${server.minecraftVersion}) into ${dir}`)
  return next
}

/* ------------------------------------------------------- server.properties */

/**
 * Merges the launcher's settings into server.properties without discarding
 * anything else the file holds. A player who hand-edits view-distance should
 * not lose it because they renamed their server here.
 */
/** Keeps a whole-number setting inside what the server will accept. */
function clampWhole(value: number, low: number, high: number): number {
  if (!Number.isFinite(value)) return low
  return Math.max(low, Math.min(high, Math.round(value)))
}

async function writeServerProperties(server: HostedServer): Promise<void> {
  const file = join(hostedServerDir(server.id), 'server.properties')

  const properties = new Map<string, string>()
  if (existsSync(file)) {
    const text = await readFile(file, 'utf8')
    for (const line of text.split(/\r?\n/)) {
      if (!line || line.startsWith('#')) continue
      const eq = line.indexOf('=')
      if (eq > 0) properties.set(line.slice(0, eq), line.slice(eq + 1))
    }
  }

  const managed: Record<string, string> = {
    'server-port': String(server.port),
    'online-mode': String(server.onlineMode),
    motd: server.motd,
    difficulty: server.difficulty,
    gamemode: server.gameMode,
    'max-players': String(server.maxPlayers),
    // There is no server-wide "cheats" switch — a dedicated server grants that
    // through operator status, which is handled separately. This key is the
    // only real one behind the setting.
    'enable-command-block': String(server.allowCheats),
    // Which interface to listen on. Empty means every one of them.
    'server-ip': bindAddress(server.reachability),

    /*
     * World and gameplay. Written every time so the file matches what the
     * settings screen shows — editing server.properties by hand and then saving
     * from the launcher should not leave the two disagreeing.
     *
     * `simulation-distance` is held at or under the view distance because the
     * server quietly ignores a larger one, which would make the setting look
     * broken.
     */
    pvp: String(server.pvp ?? true),
    hardcore: String(server.hardcore ?? false),
    'allow-flight': String(server.allowFlight ?? false),
    'spawn-protection': String(server.spawnProtection ?? 16),
    'view-distance': String(server.viewDistance ?? 10),
    'simulation-distance': String(Math.min(server.simulationDistance ?? 10, server.viewDistance ?? 10)),
    'spawn-monsters': String(server.spawnMonsters ?? true),
    'spawn-animals': String(server.spawnAnimals ?? true),
    'white-list': String(server.whitelist ?? false),
    'level-seed': server.levelSeed ?? ''
  }
  for (const [key, value] of Object.entries(managed)) properties.set(key, value)

  const body = [...properties.entries()].map(([key, value]) => `${key}=${value}`).sort()
  await writeFile(
    file,
    ['#Minecraft server properties', '#Managed by the NexusCraft Launcher', ...body, ''].join('\n'),
    'utf8'
  )
}

/**
 * The interface a server should listen on for a given reachability.
 *
 * Binding to the machine's LAN address is what makes "my local network" mean
 * what it says: reachable from other machines at home, but not from the wider
 * internet even if a router happens to forward the port.
 */
function bindAddress(reachability: ServerReachability): string {
  if (reachability === 'anyone') return ''
  if (reachability === 'local') return '127.0.0.1'

  const lan = localNetworkAddress()
  if (lan) return lan
  // No usable LAN address — fall back to loopback rather than silently
  // exposing the server on every interface.
  log.warn('no local network address found; binding to loopback instead')
  return '127.0.0.1'
}

/**
 * The machine's address on the real local network.
 *
 * Taking the first private IPv4 found is wrong on any developer machine: this
 * one reports a Hyper-V switch on 172.20.16.1 and a WSL adapter on 172.29.112.1
 * before its actual Wi-Fi address of 192.168.22.12. Binding to a virtual switch
 * would leave the server unreachable from the network the user meant, with
 * nothing to explain why — so real adapters are ranked ahead of virtual ones.
 */
export function localNetworkAddress(): string | null {
  const VIRTUAL = /vethernet|hyper-?v|wsl|virtualbox|vmware|docker|loopback|tap-|tunnel|bluetooth/i

  const rank = (name: string, address: string): number => {
    if (VIRTUAL.test(name)) return -1
    // 192.168/16 is the usual home network. 10/8 is common in larger ones.
    // 172.16/12 is where virtualisation tends to live, so it ranks last.
    if (/^192\.168\./.test(address)) return 3
    if (/^10\./.test(address)) return 2
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) return 1
    return -1
  }

  let best: string | null = null
  let bestRank = 0

  for (const [name, entries] of Object.entries(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== 'IPv4' || entry.internal) continue
      const score = rank(name, entry.address)
      if (score > bestRank) {
        bestRank = score
        best = entry.address
      }
    }
  }
  return best
}

/** The address to hand out for this server, given how it is bound. */
export function connectAddress(server: HostedServer): string {
  if (server.reachability === 'local') return `127.0.0.1:${server.port}`
  const lan = localNetworkAddress()
  return lan ? `${lan}:${server.port}` : `127.0.0.1:${server.port}`
}

/* ----------------------------------------------------------------- start */

/** Fails fast with a clear message rather than letting Java bind and crash. */
async function assertPortFree(port: number, reachability: ServerReachability): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const probe = createServer()
    probe.once('error', (err: NodeJS.ErrnoException) => {
      probe.close()
      if (err.code === 'EADDRINUSE') {
        reject(
          new LauncherError('ALREADY_RUNNING', `port ${port} is in use`, {
            title: `Something is already using port ${port}`,
            message: 'Another Minecraft server, or a world you opened to LAN, is holding that port.',
            actions: ['Close the other server', 'Or give this one a different port in its settings']
          })
        )
      } else {
        resolve() // Not a conflict we can diagnose; let the server try.
      }
    })
    probe.once('listening', () => probe.close(() => resolve()))
    probe.listen(port, bindAddress(reachability) || '0.0.0.0')
  })
}

export async function startHostedServer(id: string): Promise<HostedServerState> {
  if (running.has(id)) return getHostedServerState(id)

  const server = getHostedServer(id)

  if (!server.eulaAcceptedAt) {
    throw new LauncherError('INVALID_INPUT', 'the Minecraft EULA has not been accepted', {
      title: 'Accept the Minecraft EULA first',
      message: 'Mojang requires every server operator to agree to the End User Licence Agreement before the server will run.',
      actions: [`Read it at ${MINECRAFT_EULA_URL}`, 'Then tick the box on the server to accept']
    })
  }

  if (needsInstall(server)) {
    await installHostedServer(id)
  }

  await assertPortFree(server.port, server.reachability)
  await writeServerProperties(server)

  const version = await ensureVersionJson(server.minecraftVersion)
  const settings = getSettings()
  const java = await resolveJavaForVersion(version, null, settings.javaPath ?? null, null)

  const dir = hostedServerDir(id)
  await mkdir(dir, { recursive: true })

  const plan = await launchPlan(dir, server.software)
  const args = [`-Xmx${server.memoryMb}M`, `-Xms${Math.min(server.memoryMb, 1024)}M`, ...plan.args]

  log.info(`starting ${server.name} on port ${server.port} with ${java.path} (Java ${java.majorVersion})`)

  const child = spawn(java.path, args, {
    cwd: dir,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  })

  let resolveExit: () => void = () => undefined
  const exited = new Promise<void>((resolve) => {
    resolveExit = resolve
  })

  const entry: Running = {
    child,
    state: {
      id,
      status: 'starting',
      detail: `Starting Minecraft ${server.minecraftVersion}…`,
      players: [],
      pid: child.pid ?? null,
      startedAt: Date.now(),
      address: connectAddress(server)
    },
    console: [],
    lineId: 0,
    exited
  }
  running.set(id, entry)
  emit('host:state', entry.state)

  const consume = (chunk: Buffer, stream: HostedServerConsoleLine['stream']): void => {
    for (const raw of chunk.toString('utf8').split(/\r?\n/)) {
      const text = raw.trimEnd()
      if (!text) continue
      pushConsole(id, text, stream)
      interpret(id, text)
    }
  }
  child.stdout?.on('data', (chunk: Buffer) => consume(chunk, 'out'))
  child.stderr?.on('data', (chunk: Buffer) => consume(chunk, 'err'))

  child.on('error', (err) => {
    setState(id, { status: 'error', detail: `could not start Java: ${err.message}` })
    running.delete(id)
    resolveExit()
    emit('host:state', blankState(id))
  })

  child.on('exit', (code, signal) => {
    const wasStopping = running.get(id)?.state.status === 'stopping'
    running.delete(id)
    resolveExit()
    const detail = wasStopping
      ? 'Stopped.'
      : code === 0
        ? 'The server shut down.'
        : `The server exited unexpectedly (code ${code ?? signal}).`
    emit('host:state', { ...blankState(id), status: wasStopping || code === 0 ? 'stopped' : 'error', detail })
    notifyLifecycle('stopped', id)
    log.info(`${server.name} exited with code ${code ?? signal}`)
  })

  db().put(Collections.hostedServers, server.id, { ...server, lastStartedAt: Date.now() })
  emit('host:changed', listHostedServers())

  return entry.state
}

/**
 * Reads meaning out of the server console.
 *
 * The server has no machine-readable status channel, so its log is the only
 * signal available. Only lines with a stable format across versions are matched.
 */
function interpret(id: string, text: string): void {
  const entry = running.get(id)
  if (!entry) return

  if (/Done \([\d.]+s\)! For help/.test(text)) {
    setState(id, { status: 'running', detail: 'Ready for players.' })
    grantOperators(id)
    notifyLifecycle('ready', id)
    return
  }

  if (/FAILED TO BIND TO PORT/i.test(text)) {
    setState(id, { status: 'error', detail: 'Could not claim the port — something else is using it.' })
    return
  }

  if (/You need to agree to the EULA/i.test(text)) {
    setState(id, { status: 'error', detail: 'The server refused to start until the EULA is accepted.' })
    return
  }

  const joined = /\]: ([A-Za-z0-9_]{3,16}) joined the game/.exec(text)
  if (joined) {
    const players = [...new Set([...entry.state.players, joined[1]])]
    setState(id, { players })
    notifyLifecycle('player-joined', id, joined[1])
    return
  }

  const left = /\]: ([A-Za-z0-9_]{3,16}) left the game/.exec(text)
  if (left) {
    setState(id, { players: entry.state.players.filter((p) => p !== left[1]) })
    notifyLifecycle('player-left', id, left[1])
  }
}

/**
 * Grants operator status through the server console once it is accepting
 * commands. Done this way rather than by writing ops.json because that file
 * needs each player's UUID, which differs between online and offline mode and
 * would have to be fetched or derived; `op <name>` is always correct.
 */
function grantOperators(id: string): void {
  const server = db().get<HostedServer>(Collections.hostedServers, id)
  const names = server?.operators ?? []
  if (names.length === 0) return

  for (const name of names) {
    try {
      sendHostedServerCommand(id, `op ${name}`)
    } catch (err) {
      log.warn(`could not op ${name}: ${(err as Error).message}`)
    }
  }
}

/* ------------------------------------------------------------------ stop */

export async function stopHostedServer(id: string): Promise<HostedServerState> {
  const entry = running.get(id)
  if (!entry) return blankState(id)

  setState(id, { status: 'stopping', detail: 'Saving the world and shutting down…' })

  /*
   * Shut the door on the way out.
   *
   * A port forwarded for a server that is no longer running is just an opening
   * in someone's router that nothing is listening behind, and nobody would ever
   * think to go and close it by hand. Left to run on its own: finding the
   * gateway takes a few seconds and stopping the server should not wait on the
   * router, and the mapping's own lease expires regardless.
   */
  void (async () => {
    try {
      const server = getHostedServer(id)
      const gateway = await discoverGateway()
      if (!gateway) return
      if (await closePort(gateway, server.port)) {
        log.info(`closed the forwarded port ${server.port} now "${server.name}" has stopped`)
      }
    } catch (err) {
      log.warn(`could not close the forwarded port: ${(err as Error).message}`)
    }
  })()

  // `stop` lets the server flush chunks; killing it outright risks the world.
  try {
    entry.child.stdin?.write('stop\n')
  } catch {
    /* the pipe is already gone; the timer below handles it */
  }

  const killer = setTimeout(() => {
    if (!entry.child.killed) {
      log.warn(`server ${id} ignored stop for ${STOP_GRACE_MS}ms; terminating`)
      entry.child.kill()
    }
  }, STOP_GRACE_MS)

  await entry.exited
  clearTimeout(killer)
  return getHostedServerState(id)
}

export function sendHostedServerCommand(id: string, command: string): void {
  const entry = running.get(id)
  if (!entry) {
    throw new LauncherError('NOT_FOUND', 'that server is not running', {
      title: 'The server is not running',
      message: 'Start it before sending commands.'
    })
  }
  const text = command.trim().replace(/^\//, '')
  if (!text) return
  pushConsole(id, `> ${text}`, 'in')
  entry.child.stdin?.write(`${text}\n`)
}

/* ------------------------------------------------------------ server mods */

/**
 * The hosted server's mods folder, described the same way an instance's is so
 * the shared mod code can analyse it. Paper and Purpur take plugins rather than
 * mods, so the folder differs — putting a mod in a plugin folder does nothing,
 * and vice versa.
 */
/**
 * Which content site "loader" to search a server's add-ons under.
 *
 * Distinct from `ModTarget.loader`, which describes what a *jar* must be built
 * against and so only has the five real mod loaders to choose from. Paper and
 * Purpur load Bukkit-style plugins, which are not built against any of them —
 * calling them "forge", as this did, offered a Paper owner Forge mods and put
 * the jars they picked into `plugins/`, where nothing would ever load them.
 */
export function serverSearchLoader(software: HostedServer['software']): string {
  switch (software) {
    case 'fabric':
    case 'neoforge':
    case 'forge':
    case 'paper':
    case 'purpur':
      return software
    default:
      // Vanilla loads neither mods nor plugins; no facet means no filter.
      return 'vanilla'
  }
}

/**
 * The mod loader a server's jars must be built against.
 *
 * A plugin is not built against one at all, so a plugin server answers
 * 'vanilla' — meaning "impose no loader requirement". Saying 'forge', as this
 * did, made every plugin look mismatched to the jar analyser.
 */
function serverJarLoader(software: HostedServer['software']): LoaderId {
  switch (software) {
    case 'fabric':
      return 'fabric'
    case 'forge':
      return 'forge'
    case 'neoforge':
      return 'neoforge'
    default:
      return 'vanilla'
  }
}

export function serverModTarget(server: HostedServer): ModTarget {
  const usesPlugins = server.software === 'paper' || server.software === 'purpur'
  return {
    dir: join(hostedServerDir(server.id), usesPlugins ? 'plugins' : 'mods'),
    loader: serverJarLoader(server.software),
    minecraftVersion: server.minecraftVersion,
    description: 'this server'
  }
}

/** True when this software takes Bukkit-style plugins instead of mod jars. */
export function serverUsesPlugins(server: HostedServer): boolean {
  return server.software === 'paper' || server.software === 'purpur'
}

export async function listServerMods(id: string): Promise<ModInfo[]> {
  const server = getHostedServer(id)
  const target = serverModTarget(server)
  await mkdir(target.dir, { recursive: true })
  return await analyseModsIn(target)
}

export async function importServerMods(id: string, files: string[]): Promise<number> {
  const server = getHostedServer(id)
  const target = serverModTarget(server)
  const added = await importModsIn(target.dir, files)
  if (added > 0) log.info(`added ${added} file(s) to ${server.name}`)
  return added
}

export async function setServerModEnabled(id: string, fileName: string, enabled: boolean): Promise<void> {
  await setModEnabledIn(serverModTarget(getHostedServer(id)).dir, fileName, enabled)
}

export async function deleteServerMod(id: string, fileName: string): Promise<void> {
  await deleteModIn(serverModTarget(getHostedServer(id)).dir, fileName)
}

export async function installServerModFromModrinth(id: string, versionId: string): Promise<ModrinthInstallResult> {
  const server = getHostedServer(id)
  const target = serverModTarget(server)
  await mkdir(target.dir, { recursive: true })
  return await installVersionToDir(
    { dir: target.dir, taskId: server.id, loader: target.loader, minecraftVersion: server.minecraftVersion },
    versionId,
    'mod'
  )
}

/**
 * Instances that could actually join this server. Loader and Minecraft version
 * both have to line up — a vanilla client cannot join a Forge server, and a
 * version mismatch is refused at the door.
 */
export function instancesThatCanJoin(server: HostedServer, instances: Instance[]): Instance[] {
  const needed =
    server.software === 'fabric'
      ? 'fabric'
      : server.software === 'forge'
        ? 'forge'
        : server.software === 'neoforge'
          ? 'neoforge'
          : null // vanilla, Paper and Purpur all accept a vanilla client

  return instances.filter((instance) => {
    if (instance.minecraftVersion !== server.minecraftVersion) return false
    return needed ? instance.loader === needed : true
  })
}

/**
 * The address a client on this machine should connect to.
 *
 * Loopback is not always right, which is what made Join fail with "connection
 * refused" on a server that was plainly running. A server set to "my local
 * network" binds to the machine's LAN address alone — deliberately, so it is
 * not exposed on every interface — and nothing is then listening on 127.0.0.1.
 * Handing the game loopback anyway meant it knocked on a door that was not
 * there.
 *
 * So the address has to match how the server was actually bound: loopback when
 * it is bound to loopback or to everything, and the LAN address when that is
 * the only interface it is on.
 */
export function serverAddress(server: HostedServer): string {
  // 'anyone' listens on every interface, so loopback is both valid and the
  // shortest path; 'local' is loopback by definition.
  if (server.reachability === 'anyone' || server.reachability === 'local') {
    return `127.0.0.1:${server.port}`
  }
  return connectAddress(server)
}

export interface ModSyncResult {
  copied: string[]
  alreadyPresent: string[]
  instanceName: string
}

/**
 * Copies the server's enabled mods into a client instance.
 *
 * Joining a modded server means running the same mods client-side, and doing
 * that by hand — find the folder, copy the jars, keep them in step — is the
 * dullest part of running one. Only enabled jars are copied, and anything the
 * instance already has is left alone rather than duplicated.
 */
export async function syncServerModsToInstance(id: string, instance: Instance): Promise<ModSyncResult> {
  const server = getHostedServer(id)

  if (serverUsesPlugins(server)) {
    throw new LauncherError('INVALID_INPUT', 'plugins are server-side only', {
      title: 'Plugins do not go on the client',
      message: `${softwareLabel(server.software)} plugins run entirely on the server. Players join with an ordinary client and need nothing installed.`,
      actions: ['Nothing to copy — just press Join']
    })
  }

  const target = serverModTarget(server)
  const mods = await analyseModsIn(target)
  const enabled = mods.filter((mod) => mod.enabled && mod.fileName.toLowerCase().endsWith('.jar'))

  const destination = instanceSubdir(instance, 'mods')
  await mkdir(destination, { recursive: true })
  const existing = new Set((await analyseModsIn({ ...target, dir: destination })).map((m) => m.fileName))

  const copied: string[] = []
  const alreadyPresent: string[] = []

  for (const mod of enabled) {
    if (existing.has(mod.fileName)) {
      alreadyPresent.push(mod.fileName)
      continue
    }
    await copyFile(join(target.dir, mod.fileName), join(destination, mod.fileName))
    copied.push(mod.fileName)
  }

  log.info(`copied ${copied.length} mod(s) from ${server.name} to ${instance.name}`)
  return { copied, alreadyPresent, instanceName: instance.name }
}

/** Called on app shutdown so a server never outlives the launcher silently. */
export async function shutdownHostedServers(): Promise<void> {
  await Promise.all([...running.keys()].map((id) => stopHostedServer(id).catch(() => undefined)))
}

/**
 * Gathers what a server listing asks for, and checks the address really works.
 *
 * The reachability test pings the public address from this machine. A success
 * is proof: something answered the Minecraft handshake on that address and
 * port. A failure is weaker evidence than it looks — many routers will not let
 * a machine inside the network reach its own public address, so a server that
 * is perfectly reachable from outside can fail this test. The distinction is
 * spelled out rather than reported as a flat "offline", which would send
 * someone off to fix a working server.
 */
export async function shareDetails(id: string): Promise<ServerShareDetails> {
  const server = getHostedServer(id)
  const localAddress = connectAddress(server)

  const gateway = await discoverGateway()
  const external = gateway ? await externalAddress(gateway) : null
  const publicAddress = external ? `${external}:${server.port}` : null

  let reachable: boolean | null = null
  let note: string | null = null

  if (!publicAddress) {
    note =
      'No public address yet. Open the port with "Play with friends online", or forward it in the router, and ' +
      'the address will appear here.'
  } else {
    const result = await pingServer(external as string, server.port, 6_000)
    if (result.online) {
      reachable = true
    } else {
      reachable = false
      note =
        'Your public address did not answer from this machine. That often means nothing is wrong: many routers ' +
        'refuse to let a device inside the network reach its own public address. Ask someone outside the house ' +
        'to try it before changing anything — and check the server is actually running.'
    }
  }

  return {
    publicAddress,
    localAddress,
    reachable,
    note,
    motd: server.motd,
    minecraftVersion: server.minecraftVersion,
    software: softwareLabel(server.software),
    maxPlayers: server.maxPlayers
  }
}
