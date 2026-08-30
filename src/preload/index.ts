import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import { IPC_CHANNELS, EVENT_CHANNELS, type IpcChannel, type EventChannel } from '@shared/channels'

/**
 * The only bridge between the renderer and the main process.
 *
 * The renderer gets exactly two capabilities: invoke a channel from the shared
 * contract, and subscribe to an event from the shared contract. It has no
 * access to Node, to `ipcRenderer` itself, or to any channel not on these lists.
 *
 * This file imports from `@shared/channels` rather than `@shared/ipc` on
 * purpose: the preload runs sandboxed, where `require` is restricted to
 * Electron's own modules, so it must not pull in third-party code.
 */

const invokable = new Set<string>(IPC_CHANNELS)
const subscribable = new Set<string>(EVENT_CHANNELS)

const api = {
  /** Calls a main-process handler. Always resolves to a `Result`. */
  invoke(channel: IpcChannel, payload?: unknown): Promise<unknown> {
    if (!invokable.has(channel)) {
      return Promise.resolve({
        ok: false,
        error: {
          code: 'INVALID_INPUT',
          title: 'Unknown request',
          message: `The launcher tried to call "${channel}", which is not part of its interface.`,
          actions: ['Restart NexusCraft'],
          detail: null
        }
      })
    }
    return ipcRenderer.invoke(channel, payload)
  },

  /** Subscribes to a main-process event. Returns an unsubscribe function. */
  on(channel: EventChannel, listener: (payload: unknown) => void): () => void {
    if (!subscribable.has(channel)) return () => undefined

    // The event object is deliberately not forwarded: it exposes `sender`.
    const wrapped = (_event: IpcRendererEvent, payload: unknown): void => listener(payload)
    ipcRenderer.on(channel, wrapped)
    return () => ipcRenderer.removeListener(channel, wrapped)
  },

  /**
   * The on-disk path of a dropped file.
   *
   * Electron removed the non-standard `File.path` property, and a sandboxed
   * renderer cannot ask the filesystem anything itself, so a dropped file is
   * otherwise unusable by the importers — which all take paths. `webUtils`
   * answers only for files the user actually dropped or picked, so this hands
   * out nothing the user did not choose to give.
   */
  filePath(file: File): string {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return ''
    }
  },

  /** Static values the UI needs before its first IPC round trip. */
  platform: process.platform,
  channels: IPC_CHANNELS as readonly string[]
}

contextBridge.exposeInMainWorld('nexus', api)

export type NexusApi = typeof api
