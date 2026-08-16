import { app } from 'electron'
import { createLogger } from '../../core/logger'
import { toast } from '../../core/events'

const log = createLogger('updater')

/**
 * Self-updating.
 *
 * This is deliberately best-effort and completely silent when no release feed
 * is configured — which is the default. `electron-builder.yml` ships with
 * `publish: null`, so a build made from a fresh clone has nothing to check
 * against, and pestering the user with update errors in that state would be
 * noise rather than information.
 *
 * To enable it, point `publish` at a provider (GitHub releases is the usual
 * choice), publish a release, and this starts working with no code changes.
 */

let started = false

export async function initAutoUpdate(): Promise<void> {
  if (started) return
  started = true

  // In development there is no packaged app to replace, and electron-updater
  // refuses to run against an unpackaged build.
  if (!app.isPackaged) {
    log.info('skipping the update check: not a packaged build')
    return
  }

  let autoUpdater: import('electron-updater').AppUpdater
  try {
    ;({ autoUpdater } = await import('electron-updater'))
  } catch (err) {
    log.warn('electron-updater is not available:', (err as Error).message)
    return
  }

  autoUpdater.logger = {
    info: (message: unknown) => log.info(String(message)),
    warn: (message: unknown) => log.warn(String(message)),
    error: (message: unknown) => log.error(String(message)),
    debug: (message: unknown) => log.debug(String(message))
  }

  // Downloads happen in the background; the swap only occurs on quit, so a
  // running game is never disturbed.
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info) => {
    log.info(`update available: ${info.version}`)
    toast('info', `Version ${info.version} is available`, 'Downloading it in the background.')
  })

  autoUpdater.on('update-downloaded', (info) => {
    log.info(`update downloaded: ${info.version}`)
    toast('success', `Version ${info.version} is ready`, 'It will be installed the next time you close NexusCraft.')
  })

  autoUpdater.on('error', (err) => {
    // A missing or unreachable feed is the normal state for self-built copies,
    // so this stays in the log rather than becoming a user-facing error.
    log.warn('update check failed:', err?.message ?? String(err))
  })

  try {
    await autoUpdater.checkForUpdates()
  } catch (err) {
    log.info('no update feed configured, or it could not be reached')
  }
}
