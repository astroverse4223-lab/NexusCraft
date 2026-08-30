import { BrowserWindow, Notification } from 'electron'
import { getSettings } from '../services/settings/settingsService'

/**
 * Native desktop notifications, for the moments the user is not looking at the
 * launcher: the window is hidden in the tray, minimised, or behind the game.
 *
 * These come from the main process, so the renderer's permission policy — which
 * denies web notifications — is not involved. Windows shows them as toasts
 * against the app identity set by `setAppUserModelId`.
 */

/** True when a launcher window is visible and focused — the user can see toasts. */
function launcherInView(): boolean {
  return BrowserWindow.getAllWindows().some(
    (w) => !w.isDestroyed() && w.isVisible() && !w.isMinimized() && w.isFocused()
  )
}

export interface DesktopNotice {
  title: string
  body?: string
  /**
   * Only notify when the launcher is hidden, minimised or unfocused. Defaults
   * to true: while the window is in view, the in-app toast already says it.
   */
  onlyWhenAway?: boolean
}

export function notifyDesktop(notice: DesktopNotice): void {
  if (!getSettings().desktopNotifications) return
  if (!Notification.isSupported()) return
  if ((notice.onlyWhenAway ?? true) && launcherInView()) return

  const notification = new Notification({
    title: notice.title,
    body: notice.body ?? ''
  })

  // Clicking a notification is a request to come back to the launcher.
  notification.on('click', () => {
    const window = BrowserWindow.getAllWindows()[0]
    if (!window || window.isDestroyed()) return
    if (!window.isVisible()) window.show()
    if (window.isMinimized()) window.restore()
    window.focus()
  })

  notification.show()
}
