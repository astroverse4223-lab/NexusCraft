import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { db } from '../../core/database'
import { emit, toast } from '../../core/events'
import { LauncherError } from '../../core/errors'
import { createLogger } from '../../core/logger'

const log = createLogger('tunnel')

/**
 * Reaching a hosted server when the router will not help.
 *
 * UPnP covers most homes and none of the hard cases: carrier-grade NAT, where
 * the "public" address is shared with a thousand other subscribers and no port
 * can be forwarded at all; student halls; anywhere the router is not yours.
 * For those, the only thing that works is a relay — a machine on the open
 * internet that accepts connections and passes them down a tunnel the host
 * opened outwards.
 *
 * The launcher does not run a relay, and it will not download and execute a
 * binary from the internet on the user's behalf. What it does instead is drive
 * an agent the user has installed themselves: it starts it, reads the address
 * out of its output, keeps it alive alongside the server, and stops it
 * afterwards. That is the part that is genuinely tedious to do by hand, and it
 * involves no trust the user has not already given.
 */

export type TunnelProvider = 'playit' | 'custom'

export interface TunnelSettings {
  /** Absolute path to the agent executable the user installed. */
  agentPath: string
  provider: TunnelProvider
  /** Extra arguments, for a custom agent that needs them. */
  args: string
}

export interface TunnelState {
  serverId: string
  status: 'stopped' | 'starting' | 'running' | 'error'
  /** The address to give friends, once the agent has reported one. */
  address: string | null
  detail: string
  /** The last few lines the agent printed, so a failure is diagnosable. */
  output: string[]
}

const SETTINGS_KEY = 'server-tunnel-settings'
const MAX_OUTPUT_LINES = 60

interface RunningTunnel {
  child: ChildProcess
  state: TunnelState
}

const running = new Map<string, RunningTunnel>()

/* ------------------------------------------------------------- settings */

function readAll(): Record<string, TunnelSettings> {
  const raw = db().kvGet(SETTINGS_KEY)
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as Record<string, TunnelSettings>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

const DEFAULTS: TunnelSettings = { agentPath: '', provider: 'playit', args: '' }

export function tunnelSettings(serverId: string): TunnelSettings {
  return { ...DEFAULTS, ...readAll()[serverId] }
}

export function setTunnelSettings(serverId: string, patch: Partial<TunnelSettings>): TunnelSettings {
  const all = readAll()
  const next: TunnelSettings = { ...tunnelSettings(serverId), ...patch }

  if (next.agentPath && !existsSync(next.agentPath)) {
    throw new LauncherError('NOT_FOUND', 'no file at that path', {
      title: 'That file is not there',
      message: `NexusCraft could not find anything at ${next.agentPath}.`,
      actions: ['Browse to the agent you downloaded', 'On Windows it is usually a .exe in your Downloads folder']
    })
  }

  all[serverId] = next
  db().kvSet(SETTINGS_KEY, JSON.stringify(all))
  return next
}

/* ---------------------------------------------------------------- state */

function blankState(serverId: string): TunnelState {
  return { serverId, status: 'stopped', address: null, detail: '', output: [] }
}

export function tunnelState(serverId: string): TunnelState {
  return running.get(serverId)?.state ?? blankState(serverId)
}

function setState(serverId: string, patch: Partial<TunnelState>): void {
  const entry = running.get(serverId)
  const next = { ...(entry?.state ?? blankState(serverId)), ...patch }
  if (entry) entry.state = next
  emit('tunnel:state', next)
}

/**
 * Finds the joinable address in whatever the agent printed.
 *
 * Agents announce their assigned address in prose, and the wording differs
 * between them and between versions, so this looks for the shape rather than
 * the sentence: a hostname with a port, or a bare hostname on a line that
 * mentions tunnels or addresses.
 */
export function addressFromOutput(line: string): string | null {
  // host:port — the common case, and unambiguous.
  const withPort = /\b((?:[a-z0-9-]+\.)+[a-z]{2,}:\d{2,5})\b/i.exec(line)
  if (withPort) return withPort[1]

  // A bare hostname, only on a line that is clearly announcing one.
  if (/tunnel|address|connect|endpoint|assigned/i.test(line)) {
    const host = /\b((?:[a-z0-9-]+\.)+(?:gg|com|net|io|org|dev|xyz))\b/i.exec(line)
    if (host) return host[1]
  }

  return null
}

/* ---------------------------------------------------------------- control */

export function startTunnel(serverId: string, serverPort: number): TunnelState {
  if (running.has(serverId)) return tunnelState(serverId)

  const settings = tunnelSettings(serverId)
  if (!settings.agentPath) {
    throw new LauncherError('INVALID_INPUT', 'no tunnel agent configured', {
      title: 'No relay agent is set up',
      message:
        'A relay makes your server reachable when your router cannot forward a port — on carrier-grade NAT, for ' +
        'instance. NexusCraft drives an agent you install yourself rather than downloading one for you.',
      actions: [
        'Get the playit.gg agent from playit.gg, install it, and sign in once',
        'Then point NexusCraft at it with "Choose the agent"'
      ]
    })
  }

  if (!existsSync(settings.agentPath)) {
    throw new LauncherError('NOT_FOUND', 'the agent is gone', {
      title: 'The relay agent is no longer there',
      message: `Nothing is at ${settings.agentPath} any more.`,
      actions: ['Point NexusCraft at the agent again']
    })
  }

  /*
   * The agent's own arguments, split on whitespace outside quotes. `--local
   * 127.0.0.1:PORT` is what a custom agent usually wants; playit's agent reads
   * its tunnels from the account it was signed into, so it takes none.
   */
  const extra = settings.args
    .match(/"[^"]*"|\S+/g)
    ?.map((argument) => argument.replace(/^"|"$/g, '').replace('{port}', String(serverPort))) ?? []

  log.info(`starting the relay agent for server ${serverId}`)

  const child = spawn(settings.agentPath, extra, {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  })

  const entry: RunningTunnel = {
    child,
    state: {
      serverId,
      status: 'starting',
      address: null,
      detail: 'Starting the relay agent…',
      output: []
    }
  }
  running.set(serverId, entry)
  emit('tunnel:state', entry.state)

  const consume = (chunk: Buffer): void => {
    for (const raw of chunk.toString('utf8').split(/\r?\n/)) {
      const text = raw.trimEnd()
      if (!text) continue

      const output = [...entry.state.output, text].slice(-MAX_OUTPUT_LINES)

      // The first address the agent announces is the one to hand out.
      const address = entry.state.address ?? addressFromOutput(text)
      const becameReady = address && !entry.state.address

      setState(serverId, {
        output,
        address,
        status: address ? 'running' : entry.state.status,
        detail: address ? 'Friends can join at this address.' : entry.state.detail
      })

      if (becameReady) {
        log.info(`the relay is up at ${address}`)
        toast('success', 'Your server is reachable', `Friends can join at ${address}.`)
      }
    }
  }

  child.stdout?.on('data', consume)
  child.stderr?.on('data', consume)

  child.on('error', (err) => {
    running.delete(serverId)
    log.error('the relay agent could not be started', err)
    emit('tunnel:state', {
      ...blankState(serverId),
      status: 'error',
      detail: `Could not start the agent: ${err.message}`
    })
  })

  child.on('exit', (code, signal) => {
    const wasRunning = running.get(serverId)?.state.status === 'running'
    const output = running.get(serverId)?.state.output ?? []
    running.delete(serverId)

    const clean = code === 0 || signal === 'SIGTERM'
    emit('tunnel:state', {
      ...blankState(serverId),
      status: clean ? 'stopped' : 'error',
      detail: clean
        ? 'The relay was stopped.'
        : `The agent exited unexpectedly (code ${code ?? signal}). Its last words: ${output.slice(-2).join(' / ') || 'nothing'}`,
      output
    })

    if (!clean && wasRunning) {
      toast('warning', 'The relay stopped', 'Your server is no longer reachable from outside your network.')
    }
    log.info(`the relay agent exited with code ${code ?? signal}`)
  })

  return entry.state
}

export function stopTunnel(serverId: string): TunnelState {
  const entry = running.get(serverId)
  if (!entry) return blankState(serverId)

  setState(serverId, { status: 'stopped', detail: 'Stopping…' })
  entry.child.kill('SIGTERM')

  /*
   * Agents that ignore a polite request still have to go.
   *
   * The test is whether the process is still registered — the exit handler is
   * what removes it. `child.killed` only means a signal was sent, so checking
   * it here meant the escalation never fired for exactly the process it was
   * written for: one that had been signalled and ignored it.
   */
  setTimeout(() => {
    if (running.has(serverId)) entry.child.kill('SIGKILL')
  }, 5000).unref()

  return tunnelState(serverId)
}

export function isTunnelRunning(serverId: string): boolean {
  return running.has(serverId)
}

/** Nothing may outlive the launcher, least of all something holding a port open. */
export function shutdownTunnels(): void {
  for (const [serverId, entry] of running) {
    entry.child.kill('SIGTERM')
    running.delete(serverId)
  }
}

/**
 * Ties a relay to its server, so it goes down with it.
 *
 * A relay pointing at a stopped server is worse than no relay: the address
 * still resolves, so a friend gets a connection refused rather than a server
 * that is plainly offline.
 */
export function initTunnels(): void {
  void import('./hostService').then(({ onHostedServerEvent }) => {
    onHostedServerEvent((event, serverId) => {
      if (event === 'stopped' && running.has(serverId)) {
        log.info(`server ${serverId} stopped; closing its relay`)
        stopTunnel(serverId)
      }
    })
  })
}
