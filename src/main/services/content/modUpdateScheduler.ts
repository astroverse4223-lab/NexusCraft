import { db } from '../../core/database'
import { emit, toast } from '../../core/events'
import { createLogger } from '../../core/logger'
import { notifyDesktop } from '../../core/notifications'
import { listInstances } from '../instances/instanceService'
import { isRunning } from '../launch/launchService'
import { applyModUpdate, checkModUpdates } from './modrinthService'
import type { ModUpdate, ModUpdateSweep } from '@shared/types'

const log = createLogger('mod-updates')

/**
 * Checking for mod updates without being asked.
 *
 * The manual updater is the good part of this feature and nothing here
 * replaces it: the review screen shows changelogs, flags major version jumps,
 * and every applied update can be undone. What it cannot do is tell you an
 * update exists while you are not looking at it, which is how mods sit a year
 * out of date on a machine that has had a working updater the whole time.
 *
 * So the default is `notify`. A background check touches no files — it hashes
 * the jars, asks Modrinth, and says how many have something newer. Deciding
 * what to do about it stays where it was.
 *
 * `install` exists for people who would rather not decide, and it deliberately
 * does less than its name suggests: it applies only the safe half and leaves
 * the rest for review. See `isRisky`.
 */

const SETTINGS_KEY = 'mod-update-settings'

export type ModUpdateMode = 'off' | 'notify' | 'install'

export interface ModUpdateSettings {
  /**
   * `off` never looks. `notify` checks and tells you. `install` also applies
   * the updates it considers safe.
   */
  mode: ModUpdateMode
  /** Hours between checks. */
  everyHours: number
  /**
   * Whether `install` should hold back major version jumps and pre-release
   * builds for you to look at. Turning this off makes it apply everything.
   */
  reviewRisky: boolean
  /** When the last check finished, so a restart does not re-run it at once. */
  lastCheck: number | null
}

const DEFAULTS: ModUpdateSettings = {
  mode: 'notify',
  everyHours: 12,
  reviewRisky: true,
  lastCheck: null
}

export function modUpdateSettings(): ModUpdateSettings {
  const raw = db().kvGet(SETTINGS_KEY)
  if (!raw) return { ...DEFAULTS }
  try {
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<ModUpdateSettings>) }
  } catch {
    // A corrupt blob is not worth failing a startup over.
    return { ...DEFAULTS }
  }
}

export function setModUpdateSettings(patch: Partial<ModUpdateSettings>): ModUpdateSettings {
  const next: ModUpdateSettings = { ...modUpdateSettings(), ...patch }
  next.everyHours = Math.min(Math.max(Math.round(next.everyHours), 1), 168)
  db().kvSet(SETTINGS_KEY, JSON.stringify(next))
  reschedule()
  return next
}

/**
 * An update worth a human's attention before it lands.
 *
 * A major version bump is where a mod drops a config format, renames its
 * blocks, or stops reading the world the same way, and a beta build is not
 * something to install into a world you care about while you are not at the
 * keyboard. Both are exactly what the manual review screen is good at showing,
 * so they are handed back to it rather than applied.
 */
function isRisky(update: ModUpdate): boolean {
  return Boolean(update.majorJump) || (Boolean(update.versionType) && update.versionType !== 'release')
}

/** Stops two checks overlapping — the scan is slow and hits the network. */
let checking = false

/**
 * Checks every instance once.
 *
 * Instances that are running are skipped rather than queued: replacing a jar
 * under a live game gets you a crash on the next world load at best, and the
 * check itself reads the whole mods folder, which is not free while the game
 * is using it.
 */
export async function sweepForModUpdates(reason: string): Promise<ModUpdateSweep> {
  const settings = modUpdateSettings()
  const sweep: ModUpdateSweep = { checked: 0, skipped: 0, found: 0, installed: 0, heldBack: 0 }

  if (checking) {
    log.info('a check is already running; skipping this one')
    return sweep
  }
  checking = true

  try {
    for (const instance of listInstances()) {
      if (isRunning(instance.id)) {
        sweep.skipped += 1
        continue
      }

      let updates: ModUpdate[] = []
      try {
        updates = await checkModUpdates(instance)
      } catch (err) {
        // One unreachable instance must not stop the rest of the sweep.
        log.warn(`could not check ${instance.name}: ${(err as Error).message}`)
        continue
      }

      sweep.checked += 1
      if (updates.length === 0) continue
      sweep.found += updates.length

      if (settings.mode !== 'install') continue

      const safe = settings.reviewRisky ? updates.filter((update) => !isRisky(update)) : updates
      sweep.heldBack += updates.length - safe.length

      for (const update of safe) {
        // One at a time. These write into the same folder, and a failure
        // partway through should leave the rest of the folder untouched.
        try {
          await applyModUpdate(instance, update)
          sweep.installed += 1
        } catch (err) {
          log.warn(`could not update ${update.fileName}: ${(err as Error).message}`)
        }
      }

    }

    setModUpdateSettings({ lastCheck: Date.now() })
    log.info(
      `${reason}: checked ${sweep.checked} instance(s), ${sweep.found} update(s), ` +
        `${sweep.installed} installed, ${sweep.heldBack} held for review`
    )
    return sweep
  } finally {
    checking = false
  }
}

/** Says what was found, once per sweep rather than once per mod. */
function announce(sweep: ModUpdateSweep): void {
  if (sweep.found === 0) return

  const mods = `${sweep.found} mod${sweep.found === 1 ? '' : 's'}`

  if (sweep.installed > 0) {
    const held = sweep.heldBack > 0 ? ` ${sweep.heldBack} held back for review.` : ''
    toast(
      'success',
      `Updated ${sweep.installed} mod${sweep.installed === 1 ? '' : 's'}`,
      `Every update can be undone from Mods & Packs.${held}`
    )
    notifyDesktop({
      title: 'Mods updated',
      body: `${sweep.installed} updated automatically.${held}`
    })
    return
  }

  toast('info', `${mods} have updates`, 'Open Mods & Packs to review and install them.')
  notifyDesktop({ title: 'Mod updates available', body: `${mods} have a newer version.` })
}

let timer: NodeJS.Timeout | null = null

function clearTimer(): void {
  if (timer) clearInterval(timer)
  timer = null
}

async function run(reason: string): Promise<void> {
  try {
    const sweep = await sweepForModUpdates(reason)
    emit('mods:updateSweep', sweep)
    announce(sweep)
  } catch (err) {
    log.warn(`sweep failed: ${(err as Error).message}`)
  }
}

function reschedule(): void {
  clearTimer()
  const settings = modUpdateSettings()
  if (settings.mode === 'off') {
    log.info('automatic mod update checks are off')
    return
  }

  const every = settings.everyHours * 3_600_000
  const next = setInterval(() => void run('scheduled check'), every)
  // Never hold the app open just to check for mod updates.
  next.unref()
  timer = next
  log.info(`checking for mod updates every ${settings.everyHours}h (${settings.mode})`)
}

/**
 * Starts the schedule. Called once at startup.
 *
 * The first check is delayed rather than run immediately: startup is already
 * busy, and hashing every jar in every instance while the window is still
 * painting is the sort of thing that gets blamed on the launcher being slow.
 * It is also skipped entirely if one ran recently, so restarting the launcher
 * a few times does not mean re-scanning a few times.
 */
export function initModUpdateScheduler(): void {
  reschedule()

  const settings = modUpdateSettings()
  if (settings.mode === 'off') return

  const due =
    settings.lastCheck === null || Date.now() - settings.lastCheck >= settings.everyHours * 3_600_000
  if (!due) {
    log.info('last check was recent; waiting for the next interval')
    return
  }

  const first = setTimeout(() => void run('startup check'), 2 * 60_000)
  first.unref()
}
