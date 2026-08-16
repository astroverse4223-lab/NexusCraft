import { BrowserWindow } from 'electron'
import type { EventMap } from '@shared/types'

/**
 * One-way main -> renderer notifications. Kept in a single place so every
 * broadcast goes through the same typed, window-safe path.
 */
export function emit<K extends keyof EventMap>(channel: K, payload: EventMap[K]): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send(channel, payload)
    }
  }
}

export function toast(
  kind: 'info' | 'success' | 'warning' | 'error',
  title: string,
  message?: string
): void {
  emit('toast', { kind, title, message })
}
