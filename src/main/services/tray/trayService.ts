import { app, Menu, Tray, nativeImage } from 'electron'
import { join } from 'node:path'
import { createLogger } from '../../core/logger'
import { runningInstanceIds } from '../launch/launchService'
import { activeTasks } from '../downloads/downloadManager'
import { allHostedServerStates } from '../servers/hostService'

const log = createLogger('tray')

/**
 * The system tray presence that makes "close to tray" honest: with the window
 * hidden, this is the only sign the launcher is still running, so it has to
 * say what it is doing — games up, servers hosting, downloads in flight — and
 * offer the two actions that matter, open and quit.
 */

let tray: Tray | null = null
let refreshTimer: NodeJS.Timeout | null = null

interface TrayHooks {
  showWindow: () => void
  quit: () => void
}

let hooks: TrayHooks | null = null

function trayIconPath(): string {
  // The .ico ships beside the app in a packaged build (extraResources) and
  // lives in build/ in a source checkout.
  return app.isPackaged
    ? join(process.resourcesPath, 'icon.ico')
    : join(app.getAppPath(), 'build', 'icon.ico')
}

/** One line per activity, or a quiet "Idle" when nothing is happening. */
function statusLines(): string[] {
  const lines: string[] = []

  const games = runningInstanceIds().length
  if (games > 0) lines.push(`${games} game${games === 1 ? '' : 's'} running`)

  const servers = allHostedServerStates().filter(
    (s) => s.status === 'running' || s.status === 'starting'
  ).length
  if (servers > 0) lines.push(`${servers} server${servers === 1 ? '' : 's'} hosting`)

  const downloads = activeTasks().filter((t) => t.active && !t.paused)
  if (downloads.length > 0) {
    const pct =
      downloads[0].totalBytes > 0
        ? ` ${Math.floor((downloads[0].downloadedBytes / downloads[0].totalBytes) * 100)}%`
        : ''
    lines.push(
      downloads.length === 1 ? `Downloading ${downloads[0].label}${pct}` : `${downloads.length} downloads active`
    )
  }

  return lines.length > 0 ? lines : ['Idle']
}

function rebuildMenu(): void {
  if (!tray || !hooks) return

  const status = statusLines()
  tray.setToolTip(['NexusCraft', ...status].join('\n'))

  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open NexusCraft', click: () => hooks?.showWindow() },
      { type: 'separator' },
      ...status.map((label) => ({ label, enabled: false })),
      { type: 'separator' },
      { label: 'Quit NexusCraft', click: () => hooks?.quit() }
    ])
  )
}

export function initTray(newHooks: TrayHooks): void {
  if (tray) return
  hooks = newHooks

  const image = nativeImage.createFromPath(trayIconPath())
  if (image.isEmpty()) {
    log.warn('tray icon could not be loaded; the tray will use a blank icon')
  }

  tray = new Tray(image)
  tray.on('click', () => hooks?.showWindow())
  tray.on('double-click', () => hooks?.showWindow())
  rebuildMenu()

  // The menu shows live counts, so it has to follow them. Polling every few
  // seconds is simpler than threading a callback through every service and is
  // invisible at this scale.
  refreshTimer = setInterval(rebuildMenu, 4000)
  refreshTimer.unref()

  log.info('tray icon ready')
}

export function destroyTray(): void {
  if (refreshTimer) clearInterval(refreshTimer)
  refreshTimer = null
  tray?.destroy()
  tray = null
  hooks = null
}
