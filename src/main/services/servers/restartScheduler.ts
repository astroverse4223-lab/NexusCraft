import { db } from '../../core/database'
import { createLogger } from '../../core/logger'
import { notifyDesktop } from '../../core/notifications'
import {
  getHostedServer,
  isHostedServerRunning,
  listHostedServers,
  sendHostedServerCommand,
  startHostedServer,
  stopHostedServer
} from './hostService'

const log = createLogger('restarts')

/**
 * Restarting a hosted server on a schedule.
 *
 * A long-running modded server leaks memory, accumulates entities, and slows
 * down over days until someone notices and restarts it by hand — usually while
 * people are on it. Doing it deliberately at a quiet hour is the difference
 * between a planned twenty seconds and an unplanned ten minutes.
 *
 * Players are warned in chat on the way down. A restart that drops people
 * mid-sentence to save a minute of typing is worse than no restart at all.
 */

const SETTINGS_KEY = 'server-restart-settings'

export interface ServerRestartSettings {
  enabled: boolean
  /** Hours between restarts, measured from when the server last started. */
  intervalHours: number
  /** Minutes of warning given in chat before it goes down. */
  warnMinutes: number
  /** Skip the restart when anyone is connected. */
  skipIfPlayers: boolean
}

const DEFAULTS: ServerRestartSettings = {
  enabled: false,
  intervalHours: 12,
  warnMinutes: 5,
  skipIfPlayers: true
}

type SettingsMap = Record<string, ServerRestartSettings>

function readAll(): SettingsMap {
  const raw = db().kvGet(SETTINGS_KEY)
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as SettingsMap
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function serverRestartSettings(serverId: string): ServerRestartSettings {
  return { ...DEFAULTS, ...readAll()[serverId] }
}

export function setServerRestartSettings(
  serverId: string,
  patch: Partial<ServerRestartSettings>
): ServerRestartSettings {
  const all = readAll()
  const next: ServerRestartSettings = { ...DEFAULTS, ...all[serverId], ...patch }

  // An hour is the shortest that is a maintenance restart rather than a loop.
  next.intervalHours = Math.min(Math.max(Math.round(next.intervalHours), 1), 168)
  next.warnMinutes = Math.min(Math.max(Math.round(next.warnMinutes), 0), 30)

  all[serverId] = next
  db().kvSet(SETTINGS_KEY, JSON.stringify(all))

  reschedule(serverId)
  return next
}

/* --------------------------------------------------------------- timers */

interface Scheduled {
  /** Fires the warning countdown. */
  timer: NodeJS.Timeout
  /** When the restart is due, so the interface can show it. */
  dueAt: number
}

const scheduled = new Map<string, Scheduled>()

export function nextRestartAt(serverId: string): number | null {
  return scheduled.get(serverId)?.dueAt ?? null
}

function clearTimer(serverId: string): void {
  const entry = scheduled.get(serverId)
  if (entry) clearTimeout(entry.timer)
  scheduled.delete(serverId)
}

/** Counts down in chat, then stops and starts the server. */
async function performRestart(serverId: string): Promise<void> {
  const settings = serverRestartSettings(serverId)

  let server
  try {
    server = getHostedServer(serverId)
  } catch {
    return
  }

  if (!isHostedServerRunning(serverId)) {
    log.info(`${server.name} is not running; skipping its restart`)
    return
  }

  /*
   * Skipping while people are on is the default, because an automatic restart
   * exists to prevent a problem, and interrupting a session is a worse problem
   * than the one being prevented. The timer simply comes round again.
   */
  if (settings.skipIfPlayers) {
    const state = listHostedServers().find((entry) => entry.id === serverId)
    if (state) {
      const { allHostedServerStates } = await import('./hostService')
      const live = allHostedServerStates().find((entry) => entry.id === serverId)
      if (live && live.players.length > 0) {
        log.info(`${server.name} has ${live.players.length} player(s) on; postponing the restart`)
        reschedule(serverId)
        return
      }
    }
  }

  const warn = settings.warnMinutes
  if (warn > 0) {
    const say = (text: string): void => {
      try {
        sendHostedServerCommand(serverId, `say ${text}`)
      } catch {
        /* the server may have gone down on its own mid-countdown */
      }
    }

    say(`Server restarting in ${warn} minute${warn === 1 ? '' : 's'}.`)

    // A final warning near the end, when it matters most.
    const finalWarnAt = Math.max(0, warn * 60_000 - 30_000)
    await new Promise((resolve) => setTimeout(resolve, finalWarnAt))
    say('Server restarting in 30 seconds — find somewhere safe.')
    await new Promise((resolve) => setTimeout(resolve, 30_000))
  }

  try {
    log.info(`restarting ${server.name} on schedule`)
    await stopHostedServer(serverId)
    // The port needs a moment to be released before anything can claim it.
    await new Promise((resolve) => setTimeout(resolve, 4000))
    await startHostedServer(serverId)

    notifyDesktop({
      title: `${server.name} restarted`,
      body: 'The scheduled restart finished and the server is starting again.'
    })
  } catch (err) {
    log.warn(`scheduled restart of ${server.name} failed: ${(err as Error).message}`)
    notifyDesktop({
      title: `${server.name} did not restart`,
      body: (err as Error).message,
      onlyWhenAway: false
    })
  }
}

function reschedule(serverId: string): void {
  clearTimer(serverId)

  const settings = serverRestartSettings(serverId)
  if (!settings.enabled || !isHostedServerRunning(serverId)) return

  // The countdown is part of the interval, not added to it.
  const delay = Math.max(60_000, settings.intervalHours * 3_600_000 - settings.warnMinutes * 60_000)
  const timer = setTimeout(() => {
    void performRestart(serverId)
  }, delay)
  timer.unref()

  scheduled.set(serverId, { timer, dueAt: Date.now() + delay + settings.warnMinutes * 60_000 })
  log.info(`next restart for ${serverId} in ${Math.round(delay / 60_000)} min`)
}

export function initRestartScheduler(): void {
  void import('./hostService').then(({ onHostedServerEvent }) => {
    onHostedServerEvent((event, serverId) => {
      if (event === 'ready') reschedule(serverId)
      else if (event === 'stopped') clearTimer(serverId)
    })
  })

  for (const server of listHostedServers()) {
    if (isHostedServerRunning(server.id)) reschedule(server.id)
  }

  log.info('server restart scheduler ready')
}
