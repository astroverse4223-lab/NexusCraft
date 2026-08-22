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

const log = createLogger('main')

const isDev = !app.isPackaged

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

  // Nothing in this app needs camera, microphone, geolocation or notifications.
  // Writing to the clipboard is the one exception: the sign-in screen offers a
  // "Copy code" button, and sanitized-write only permits content this page
  // already controls.
  const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write'])

  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => {
    const allowed = ALLOWED_PERMISSIONS.has(permission)
    if (!allowed) log.warn(`denied a "${permission}" permission request`)
    callback(allowed)
  })
  session.defaultSession.setPermissionCheckHandler((_contents, permission) =>
    ALLOWED_PERMISSIONS.has(permission)
  )

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

// Two launchers sharing one data directory would corrupt instances.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
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

    mainWindow = createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
    })

    // Renewing the session in the background means the Play button is usable
    // immediately instead of after a sign-in round trip.
    void restoreSession()

    // Checked a few seconds in so it never competes with startup work.
    setTimeout(() => void initAutoUpdate(), 8000)
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    log.info('shutting down')
    cancelAll()
    // The companion is a child process; it must not outlive the launcher.
    shutdownCompanion()
    // A hosted server must never outlive the launcher that started it.
    void shutdownHostedServers()
    // Minecraft keeps running deliberately: closing the launcher should not
    // kill a game the user is in the middle of.
    closeDatabase()
    closeLogger()
  })
}

process.on('uncaughtException', (err) => {
  log.error('uncaught exception in the main process', err)
})

process.on('unhandledRejection', (reason) => {
  log.error('unhandled promise rejection in the main process', reason)
})

export { stopAll }
