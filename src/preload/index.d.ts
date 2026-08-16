import type { IpcChannel, EventChannel } from '@shared/channels'

declare global {
  interface Window {
    nexus: {
      invoke(channel: IpcChannel, payload?: unknown): Promise<unknown>
      on(channel: EventChannel, listener: (payload: unknown) => void): () => void
      platform: string
      channels: readonly string[]
    }
  }
}

export {}
