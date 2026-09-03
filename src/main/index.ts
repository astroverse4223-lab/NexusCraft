import { app, BrowserWindow, session, shell } from 'electron'
import { join } from 'node:path'
import { readBootstrap } from './core/bootstrap'
import { initPaths } from './core/paths'
import { initDatabase, closeDatabase } from './core/database'
import { createLogger, closeLogger } from './core/logger'
import { getSettings } from './services/settings/settingsService'
import { restoreSession } from './services/auth/accountService'
import { registerIpcHandlers } from './ipc/handlers'
import { trustWebContents } from './ipc/registry'
import { stopAll } from './services/launch/launchService'
import { cancelAll } from './services/downloads/downloadManager'
import { initAutoUpdate } from './services/update/updateService'
import { shutdownCompanion } from './services/companion/companionService'
import { shutdownHostedServers } from './services/servers/hostService'
import { initTray, destroyTray } from './services/tray/trayService'
import { initPresence, shutdownPresence } from './services/presence/presenceService'
import { initStewards } from './services/companion/stewardService'
import { initBackupScheduler } from './services/backup/backupScheduler'
import { initRestartScheduler } from './services/servers/restartScheduler'
import { initModUpdateScheduler } from './services/content/modUpdateScheduler'
import { initTunnels, shutdownTunnels } from './services/servers/tunnelService'
import { registerProtocol, findLinkInArgv } from './services/links/deepLinks'
import { handleDeepLink } from './services/links/linkActions'

const log = createLogger('main')

const isDev = !app.isPackaged

/**
 * Whether the user has switched voice input on.
 *
 * Kept here rather than read from settings so the permission handler stays
 * synchronous, which is what Electron requires of it.
 */
let wantsMicrophone = false

export function setMicrophoneWanted(wanted: boolean): void {
  wantsMicrophone = wanted
}

function microphoneWanted(): boolean {
  return wantsMicrophone
}

/* ------------------------------------------------------------- security */

/**
 * The renderer is a local, first-party page only. These policies make that a
 * guarantee rather than an assumption:
 *   - context isolation and sandbox on, node integration off
 *   - a strict CSP with no remote origins at all
 *   - navigation and window.open blocked outright
 *   - permission requests denied by default
 */
const CSP = [
  "default-src 'self'",
  // Vite injects styles at runtime in both dev and production builds.
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  // Images are inlined as data URLs by the main process; nothing remote loads.
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  isDev ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'" : "script-src 'self'",
  // The renderer never talks to the network directly — only the main process does.
  isDev ? "connect-src 'self' ws://localhost:* http://localhost:*" : "connect-src 'self'",
  "object-src 'none'",
  "frame-src 'none'",
  "worker-src 'self' blob:",
  "base-uri 'self'",
  "form-action 'none'"
].join('; ')

function applySecurityPolicies(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [CSP],
        'X-Content-Type-Options': ['nosniff']
      }
    })
  })

  // Nothing in this app needs camera, geolocation or notifications. Writing to
  // the clipboard is one exception: the sign-in screen offers a "Copy code"
  // button, and sanitized-write only permits content this page already controls.
  const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write'])

  /*
   * The microphone is the other, and it is off until asked for.
   *
   * Talking to a companion needs it, and nothing else here does. Adding 'media'
   * to the set above would grant it for the life of the process whether or not
   * the feature was ever switched on, which is not a thing to do quietly with a
   * microphone. The renderer raises this flag when the user turns voice input
   * on and drops it when they turn it off.
   */
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => {
    const isMedia = permission === 'media'
    const allowed = ALLOWED_PERMISSIONS.has(permission) || (isMedia && microphoneWanted())
    if (!allowed) log.warn(`denied a "${permission}" permission request`)
    callback(allowed)
  })
  session.defaultSession.setPermissionCheckHandler((_contents, permission) => {
    const isMedia = permission === 'media'
    return ALLOWED_PERMISSIONS.has(permission) || (isMedia && microphoneWanted())
  })

  // Refuse any attempt to attach a webview.
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => {
      log.warn('blocked a webview attachment')
      event.preventDefault()
    })

    contents.setWindowOpenHandler(({ url }) => {
      // External links go to the real browser, never into an app window.
      if (url.startsWith('https://')) void shell.openExternal(url)
      return { action: 'deny' }
    })

    contents.on('will-navigate', (event, url) => {
      const isDevServer = isDev && url.startsWith(process.env.ELECTRON_RENDERER_URL ?? 'http://localhost')
      if (!isDevServer && !url.startsWith('file://')) {
        log.warn(`blocked navigation to ${new URL(url).origin}`)
        event.preventDefault()
      }
    })
  })
}

/* -------------------------------------------------------------- window */

let mainWindow: BrowserWindow | null = null

/**
 * Set once the app has decided to exit. Until then, closing the window is —
 * when the setting says so — a request to keep working from the tray, not to
 * stop: downloads keep going, hosted servers stay up, and closing the launcher
 * no longer takes a running game's log pipes with it.
 */
let quitting = false

/** Brings the (possibly tray-hidden) window back into view. */
function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createWindow()
    return
  }
  if (!mainWindow.isVisible()) mainWindow.show()
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1040,
    minHeight: 680,
    show: false,
    backgroundColor: '#070a10',
    // A frameless window lets the launcher draw its own title bar.
    frame: false,
    titleBarStyle: 'hidden',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      // Blocks file:// pages from reading arbitrary local files.
      webSecurity: true,
      spellcheck: false
    }
  })

  trustWebContents(window.webContents)

  // A renderer that dies takes the UI with it and leaves an empty window. These
  // handlers make sure that never happens silently.
  window.webContents.on('render-process-gone', (_event, details) => {
    log.error(`the renderer process stopped: reason=${details.reason} exitCode=${details.exitCode}`)
  })
  window.webContents.on('unresponsive', () => log.warn('the renderer stopped responding'))
  window.webContents.on('preload-error', (_event, preloadPath, error) => {
    log.error(`the preload script failed to load (${preloadPath})`, error)
  })
  window.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    // Only surface real errors; routine console noise stays in DevTools.
    if (level >= 3) log.error(`renderer console: ${message} (${sourceId}:${line})`)
  })

  window.once('ready-to-show', () => {
    window.show()
    if (isDev) window.webContents.openDevTools({ mode: 'detach' })
  })

  // Closing hides to the tray unless the app is actually quitting or the user
  // turned the tray off. Hiding — not closing — is what keeps downloads,
  // hosted servers and companions alive with no window on screen.
  window.on('close', (event) => {
    if (quitting || !getSettings().closeToTray) return
    event.preventDefault()
    window.hide()
  })

  window.on('closed', () => {
    mainWindow = null
  })

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}

/* --------------------------------------------------------------- boot */

/*
 * Two launchers sharing one data directory would corrupt instances — but that
 * is the only case worth blocking, and the lock is global to the application.
 *
 * A copy told to use its own data directory is a separate launcher by
 * definition: a portable build, or a test run. Letting the global lock stop it
 * does not protect anything, and it actively misleads, because the running copy
 * answers by showing ITS window — so launching your real launcher while a copy
 * on a scratch directory is open silently presents you with an empty one, and
 * it looks like every instance you own has been deleted.
 */
const separateDataDir = Boolean(process.env.NEXUSCRAFT_DATA_DIR?.trim())
const gotLock = separateDataDir || app.requestSingleInstanceLock()

if (!gotLock) {
  app.quit()
} else {
  /*
   * A second launch is how Windows delivers a `nexuscraft://` link once the
   * launcher is already open: the shell starts the app again with the URL on
   * its command line, the single-instance lock sends us here, and the running
   * copy is the one that has to act on it.
   */
  app.on('second-instance', (_event, argv) => {
    showMainWindow()
    const link = findLinkInArgv(argv)
    if (link) void handleDeepLink(link).catch((err) => log.error('a link could not be handled', err))
  })

  // macOS delivers links through an event rather than argv.
  app.on('open-url', (event, url) => {
    event.preventDefault()
    showMainWindow()
    void handleDeepLink(url).catch((err) => log.error('a link could not be handled', err))
  })

  app.whenReady().then(async () => {
    // Groups the launcher's windows correctly on the Windows taskbar.
    if (process.platform === 'win32') app.setAppUserModelId('com.nexuscraft.launcher')

    const bootstrap = readBootstrap()
    const root = initPaths(bootstrap.dataDir ?? null)
    log.info(`NexusCraft starting — data directory: ${root}`)

    initDatabase()
    getSettings() // materialise defaults on first run

    applySecurityPolicies()
    registerIpcHandlers()
    initStewards()
    initBackupScheduler()
    initRestartScheduler()
    initModUpdateScheduler()
    initTunnels()

    mainWindow = createWindow()

    initTray({
      showWindow: showMainWindow,
      quit: () => app.quit()
    })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
    })

    // Renewing the session in the background means the Play button is usable
    // immediately instead of after a sign-in round trip.
    void restoreSession()

    // Checked a few seconds in so it never competes with startup work.
    // Never let an update problem surface as an unhandled rejection.
    setTimeout(() => {
      void initAutoUpdate().catch((err) => log.warn('the update check failed to start:', err))
    }, 8000)
    initPresence()
    registerProtocol()

    /*
     * A link that started the launcher from cold arrives on our own command
     * line. It waits for the window: the invite prompt and the install toasts
     * both need a renderer listening, and there is not one yet.
     */
    const startupLink = findLinkInArgv(process.argv)
    if (startupLink) {
      mainWindow.webContents.once('did-finish-load', () => {
        void handleDeepLink(startupLink).catch((err) => log.error('a startup link could not be handled', err))
      })
    }
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    quitting = true
    log.info('shutting down')
    destroyTray()
    shutdownPresence()
    cancelAll()
    // The companion is a child process; it must not outlive the launcher.
    shutdownCompanion()
    // A hosted server must never outlive the launcher that started it, and
    // neither may the relay agent that was making it reachable.
    void shutdownHostedServers()
    shutdownTunnels()
    // Minecraft keeps running deliberately: closing the launcher should not
    // kill a game the user is in the middle of.
    closeDatabase()
    closeLogger()

    /*
     * Make sure we actually go.
     *
     * Stopping a hosted server is asynchronous and deliberately not waited on,
     * so a slow or wedged shutdown could leave the process alive after every
     * window had gone — and an app that will not close is one an installer
     * cannot replace, which is how a routine update turns into "NexusCraft
     * Launcher cannot be closed". This gives the tidying a few seconds and then
     * leaves regardless. Unreferenced, so it never keeps the process up itself.
     */
    setTimeout(() => {
      log.info('shutdown took too long; exiting anyway')
      process.exit(0)
    }, 5_000).unref()
  })
}

process.on('uncaughtException', (err) => {
  log.error('uncaught exception in the main process', err)
})

process.on('unhandledRejection', (reason) => {
  log.error('unhandled promise rejection in the main process', reason)
})

export { stopAll }
