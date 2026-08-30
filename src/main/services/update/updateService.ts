import { app } from 'electron'
import type { AppUpdater } from 'electron-updater'
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

  /*
   * Reaching `autoUpdater` is fiddlier than it looks.
   *
   * electron-updater is CommonJS and defines `autoUpdater` as a lazy getter on
   * its exports. Node's named-export detection for CJS is static and cannot see
   * getters, so the name is missing from the ES module namespace even though
   * its siblings (AppUpdater, NsisUpdater, …) are present. Destructuring it
   * therefore yielded `undefined`, and the next line — assigning `.logger` —
   * threw, once per launch, as an unhandled rejection in the main process.
   *
   * The object itself is still reachable through the CJS namespace under
   * `default`, so try both and give up quietly if neither has it.
   */
  let autoUpdater: AppUpdater | undefined

  try {
    const module = (await import('electron-updater')) as unknown as {
      autoUpdater?: AppUpdater
      default?: { autoUpdater?: AppUpdater }
    }
    autoUpdater = module.autoUpdater ?? module.default?.autoUpdater
  } catch (err) {
    log.warn('electron-updater is not available:', (err as Error).message)
    return
  }

  if (!autoUpdater) {
    log.warn('electron-updater loaded but exposed no autoUpdater; skipping the update check')
    return
  }

  /*
   * `publish: null` is the shipped default, so a build with no release feed has
   * no `app-update.yml` beside it and electron-updater reports that as an
   * error on every single launch. That is the expected state for this app, not
   * a fault, and logging it at error level put a red line in the log of every
   * ordinary run — which is exactly the noise this whole fix set out to remove.
   * Genuine failures still come through untouched.
   */
  const noFeedConfigured = /app-update\.yml|ENOENT|not packed|dev-app-update/i

  autoUpdater.logger = {
    info: (message: unknown) => log.info(String(message)),
    warn: (message: unknown) => log.warn(String(message)),
    error: (message: unknown) => {
      const text = String(message)
      if (noFeedConfigured.test(text)) log.info(`no update feed configured (${text.slice(0, 80)})`)
      else log.error(text)
    },
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
    const message = err?.message ?? String(err)
    if (noFeedConfigured.test(message)) log.info('no update feed is configured; self-updating is off')
    else log.warn('update check failed:', message)
  })

  try {
    await autoUpdater.checkForUpdates()
  } catch (err) {
    log.info('no update feed configured, or it could not be reached')
  }
}
