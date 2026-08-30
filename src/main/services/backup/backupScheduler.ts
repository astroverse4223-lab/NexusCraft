import { existsSync } from 'node:fs'
import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { BackupInfo, HostedServer } from '@shared/types'
import { db } from '../../core/database'
import { emit, toast } from '../../core/events'
import { notifyDesktop } from '../../core/notifications'
import { LauncherError } from '../../core/errors'
import { createLogger } from '../../core/logger'
import { assertInside, ensureDir } from '../../core/paths'
import { zipDirectory } from './zipWriter'
import {
  getHostedServer,
  hostedServerDir,
  isHostedServerRunning,
  listHostedServers,
  sendHostedServerCommand
} from '../servers/hostService'

const log = createLogger('backups')

/**
 * Automatic world snapshots for hosted servers.
 *
 * A launcher-hosted world had no backups at all: the instance world backup
 * only covers single-player saves. That is the world friends actually play on,
 * and the one a creeper, a mis-typed `/fill`, or a chunk-corrupting mod update
 * takes out — so it is the one that most needs restore points.
 *
 * Snapshots are taken through the server console rather than off the running
 * process's files: `save-off` then `save-all flush` gets the world onto disk
 * and holds writes while it is copied, which is the only way to copy a live
 * world without risking a half-written region file. Saving is always turned
 * back on, including when the copy fails.
 */

const SETTINGS_KEY = 'server-backup-settings'

export interface ServerBackupSettings {
  /** Take snapshots on a timer while the server runs. */
  enabled: boolean
  /** Minutes between snapshots. */
  intervalMinutes: number
  /** How many snapshots to keep; the oldest are deleted beyond this. */
  keep: number
  /** Take one automatically when the server stops. */
  onStop: boolean
}

const DEFAULTS: ServerBackupSettings = {
  enabled: false,
  intervalMinutes: 60,
  keep: 8,
  onStop: true
}

type SettingsMap = Record<string, ServerBackupSettings>

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

export function serverBackupSettings(serverId: string): ServerBackupSettings {
  return { ...DEFAULTS, ...readAll()[serverId] }
}

export function setServerBackupSettings(
  serverId: string,
  patch: Partial<ServerBackupSettings>
): ServerBackupSettings {
  const all = readAll()
  const next: ServerBackupSettings = {
    ...DEFAULTS,
    ...all[serverId],
    ...patch
  }

  // Anything under 5 minutes copies the world more often than anyone plays it.
  next.intervalMinutes = Math.min(Math.max(Math.round(next.intervalMinutes), 5), 1440)
  next.keep = Math.min(Math.max(Math.round(next.keep), 1), 50)

  all[serverId] = next
  db().kvSet(SETTINGS_KEY, JSON.stringify(all))

  reschedule(serverId)
  return next
}

/* ---------------------------------------------------------------- paths */

/** Where a hosted server's snapshots live, outside the server folder itself. */
export function serverBackupsDir(serverId: string): string {
  return ensureDir(join(hostedServerDir(serverId), 'backups'))
}

/**
 * The world folder a server actually writes to.
 *
 * `level-name` in server.properties decides this and defaults to "world";
 * a modpack server often sets something else.
 */
async function worldFolder(server: HostedServer): Promise<string> {
  const dir = hostedServerDir(server.id)
  try {
    const { readFile } = await import('node:fs/promises')
    const properties = await readFile(join(dir, 'server.properties'), 'utf8')
    const match = /^level-name=(.*)$/m.exec(properties)
    const name = match?.[1]?.trim()
    if (name && !name.includes('/') && !name.includes('\\') && name !== '..') return name
  } catch {
    /* no properties file yet — the default is right */
  }
  return 'world'
}

function timestamp(): string {
  const now = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`
}

/* ------------------------------------------------------------ snapshots */

/** Serialises snapshots per server: two at once would copy a moving target. */
const inFlight = new Set<string>()

export async function backupHostedServer(serverId: string, reason = 'manual'): Promise<BackupInfo> {
  if (inFlight.has(serverId)) {
    throw new LauncherError('ALREADY_RUNNING', 'a snapshot of that server is already being taken')
  }

  const server = getHostedServer(serverId)
  const folder = await worldFolder(server)
  const source = join(hostedServerDir(serverId), folder)

  if (!existsSync(source)) {
    throw new LauncherError('NOT_FOUND', 'that server has no world yet', {
      title: 'There is no world to back up',
      message: `${server.name} has not generated its world yet. Start it once and let it finish loading.`,
      actions: ['Press Start and wait for "Ready for players"']
    })
  }

  const live = isHostedServerRunning(serverId)
  inFlight.add(serverId)

  try {
    if (live) {
      // Flush the world to disk and stop writing to it while it is copied.
      sendHostedServerCommand(serverId, 'save-off')
      sendHostedServerCommand(serverId, 'save-all flush')
      // The console gives no completion signal, so allow the flush a moment.
      await new Promise((resolve) => setTimeout(resolve, 3000))
    }

    const dir = serverBackupsDir(serverId)
    await mkdir(dir, { recursive: true })
    const fileName = `${folder}_${timestamp()}.zip`
    const output = join(dir, fileName)

    log.info(`backing up "${server.name}" (${reason})`)

    const result = await zipDirectory(source, output, (progress) => {
      // Reuse the download progress channel so the UI shows one familiar bar.
      emit('download:progress', {
        taskId: `server-backup:${serverId}`,
        instanceId: null,
        phase: 'verifying',
        label: `Backing up ${server.name}`,
        currentFile: progress.file,
        completedFiles: progress.completed,
        totalFiles: progress.total,
        downloadedBytes: 0,
        totalBytes: 0,
        speedBps: 0,
        etaSeconds: null,
        paused: false,
        errors: [],
        active: progress.completed < progress.total
      })
    })

    const info: BackupInfo = {
      fileName,
      path: output,
      sizeBytes: result.bytes,
      createdAt: Date.now(),
      worldName: folder
    }

    await pruneOldBackups(serverId)
    log.info(`snapshot of "${server.name}": ${fileName} (${result.entries} files)`)
    return info
  } finally {
    // Always, even if zipping threw: a server left with saving off silently
    // loses everything played after this point.
    if (live && isHostedServerRunning(serverId)) {
      try {
        sendHostedServerCommand(serverId, 'save-on')
      } catch (err) {
        log.error(`could not turn saving back on for "${server.name}"`, err)
        toast(
          'error',
          'Saving may still be off on your server',
          `Type "save-on" in the ${server.name} console to be sure.`
        )
      }
    }
    inFlight.delete(serverId)
  }
}

export async function listServerBackups(serverId: string): Promise<BackupInfo[]> {
  const dir = serverBackupsDir(serverId)
  let names: string[]
  try {
    names = (await readdir(dir)).filter((name) => name.endsWith('.zip'))
  } catch {
    return []
  }

  const backups: BackupInfo[] = []
  for (const name of names) {
    try {
      const info = await stat(join(dir, name))
      backups.push({
        fileName: name,
        path: join(dir, name),
        sizeBytes: info.size,
        createdAt: info.mtimeMs,
        worldName: name.replace(/_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.zip$/, '')
      })
    } catch {
      /* skip anything unreadable */
    }
  }

  backups.sort((a, b) => b.createdAt - a.createdAt)
  return backups
}

export async function deleteServerBackup(serverId: string, fileName: string): Promise<void> {
  const dir = serverBackupsDir(serverId)
  await rm(assertInside(dir, join(dir, fileName)), { force: true })
}

/** Drops the oldest snapshots past the keep limit. */
async function pruneOldBackups(serverId: string): Promise<void> {
  const { keep } = serverBackupSettings(serverId)
  const backups = await listServerBackups(serverId)
  for (const old of backups.slice(keep)) {
    await rm(old.path, { force: true }).catch(() => undefined)
    log.info(`pruned old snapshot ${old.fileName}`)
  }
}

/**
 * Puts a snapshot back over the live world.
 *
 * Refused while the server runs: replacing the files under a running server
 * corrupts both the world and whatever the server flushes on the way out.
 */
export async function restoreServerBackup(serverId: string, fileName: string): Promise<void> {
  if (isHostedServerRunning(serverId)) {
    throw new LauncherError('ALREADY_RUNNING', 'that server is running', {
      title: 'Stop the server first',
      message: 'A world cannot be replaced while the server has it open.',
      actions: ['Press Stop, wait for it to say stopped, then restore']
    })
  }

  const server = getHostedServer(serverId)
  const dir = serverBackupsDir(serverId)
  const archive = assertInside(dir, join(dir, fileName))
  if (!existsSync(archive)) throw new LauncherError('NOT_FOUND', 'that snapshot no longer exists')

  const folder = await worldFolder(server)
  const destination = join(hostedServerDir(serverId), folder)

  /*
   * Read the archive into memory before anything is deleted.
   *
   * The pre-restore snapshot below prunes to the keep limit, and at that limit
   * the snapshot it adds evicts the oldest — which, when the oldest is the one
   * being restored, deleted both the live world and the backup meant to
   * replace it. Holding the bytes first makes that ordering impossible.
   */
  const AdmZip = (await import('adm-zip')).default
  const { readFile, writeFile } = await import('node:fs/promises')
  const zip = new AdmZip(await readFile(archive))

  // Snapshot what is there now, so restoring the wrong point is itself undoable.
  if (existsSync(destination)) {
    await backupHostedServer(serverId, 'before restore').catch((err) => {
      log.warn(`could not snapshot before restoring: ${(err as Error).message}`)
    })
    await rm(destination, { recursive: true, force: true })
  }

  await mkdir(destination, { recursive: true })
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory || entry.entryName.includes('..')) continue
    const target = assertInside(destination, join(destination, ...entry.entryName.split('/')))
    await mkdir(join(target, '..'), { recursive: true })
    await writeFile(target, entry.getData())
  }

  log.info(`restored "${server.name}" from ${fileName}`)
}

/* ------------------------------------------------------------ scheduling */

const timers = new Map<string, NodeJS.Timeout>()

function clearTimer(serverId: string): void {
  const timer = timers.get(serverId)
  if (timer) clearInterval(timer)
  timers.delete(serverId)
}

/**
 * Starts or stops a server's timer to match its settings and whether it is
 * running. Called whenever either of those changes.
 */
function reschedule(serverId: string): void {
  clearTimer(serverId)

  const settings = serverBackupSettings(serverId)
  if (!settings.enabled || !isHostedServerRunning(serverId)) return

  const timer = setInterval(
    () => {
      if (!isHostedServerRunning(serverId)) {
        clearTimer(serverId)
        return
      }
      void backupHostedServer(serverId, 'scheduled').catch((err) => {
        log.warn(`scheduled snapshot failed: ${(err as Error).message}`)
      })
    },
    settings.intervalMinutes * 60_000
  )

  timer.unref()
  timers.set(serverId, timer)
  log.info(`snapshots every ${settings.intervalMinutes} minutes for server ${serverId}`)
}

/**
 * Ties the schedule to server lifecycle. Registered once at startup.
 *
 * `onHostedServerEvent` is imported lazily so this module does not force the
 * host service to load before the app is ready.
 */
export function initBackupScheduler(): void {
  void import('../servers/hostService').then(({ onHostedServerEvent }) => {
    onHostedServerEvent((event, serverId) => {
      if (event === 'ready') {
        reschedule(serverId)
        return
      }

      if (event === 'stopped') {
        clearTimer(serverId)
        const settings = serverBackupSettings(serverId)
        if (!settings.enabled || !settings.onStop) return

        // The server has released the world by now, so this is a clean copy.
        void backupHostedServer(serverId, 'on stop')
          .then((info) => {
            notifyDesktop({
              title: 'World backed up',
              body: `A snapshot of ${getHostedServer(serverId).name} was saved as the server shut down.`
            })
            log.info(`shutdown snapshot: ${info.fileName}`)
          })
          .catch((err) => log.warn(`shutdown snapshot failed: ${(err as Error).message}`))
      }
    })
  })

  // A server already running when this loads (there is none at startup today,
  // but the scheduler should not depend on that) still gets its timer.
  for (const server of listHostedServers()) {
    if (isHostedServerRunning(server.id)) reschedule(server.id)
  }

  log.info('server backup scheduler ready')
}
