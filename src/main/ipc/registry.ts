import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { IpcRequestSchemas, type IpcChannel } from '@shared/ipc'
import type { Result } from '@shared/types'
import { toErrorPayload } from '../core/errors'
import { createLogger } from '../core/logger'

const log = createLogger('ipc')

type Handler = (payload: never, event: IpcMainInvokeEvent) => unknown | Promise<unknown>

const registered = new Set<IpcChannel>()

/**
 * Only web contents the launcher itself created may call into the main process.
 * A frame that somehow ended up hosting foreign content gets no IPC surface.
 */
const trusted = new WeakSet<WebContents>()

export function trustWebContents(contents: WebContents): void {
  trusted.add(contents)
}

/**
 * Registers a validated handler.
 *
 * Every request payload is parsed with the channel's zod schema before the
 * handler runs, and every handler result is wrapped in a `Result` so the
 * renderer receives structured errors rather than raw exceptions.
 */
export function handle<C extends IpcChannel>(
  channel: C,
  handler: (payload: never, event: IpcMainInvokeEvent) => unknown | Promise<unknown>
): void {
  const schema = IpcRequestSchemas[channel]
  if (!schema) throw new Error(`refusing to register unknown IPC channel "${channel}"`)
  if (registered.has(channel)) throw new Error(`IPC channel "${channel}" is already registered`)
  registered.add(channel)

  ipcMain.handle(channel, async (event, rawPayload): Promise<Result<unknown>> => {
    if (!trusted.has(event.sender)) {
      log.warn(`rejected an IPC call to "${channel}" from an untrusted frame`)
      return { ok: false, error: toErrorPayload(new Error('untrusted sender')) }
    }

    const parsed = schema.safeParse(rawPayload)
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')
      log.warn(`rejected "${channel}": ${issues}`)
      return {
        ok: false,
        error: {
          code: 'INVALID_INPUT',
          title: 'That request was not valid',
          message: 'The launcher sent a request the main process could not accept. This is a bug.',
          actions: ['Try the action again', 'Restart NexusCraft if it keeps happening'],
          detail: issues.slice(0, 500)
        }
      }
    }

    try {
      const data = await (handler as Handler)(parsed.data as never, event)
      return { ok: true, data: data ?? null }
    } catch (err) {
      const payload = toErrorPayload(err)
      // The `detail` field carries the status codes and response bodies that
      // make a failure diagnosable, and it is already redacted. Logging only
      // the message and stack throws away the useful half.
      log.error(
        `"${channel}" failed [${payload.code}] ${payload.title}` +
          (payload.detail ? `\n  detail: ${payload.detail}` : '') +
          (err instanceof Error && err.stack ? `\n  at: ${err.stack.split('\n').slice(1, 4).join(' | ').trim()}` : '')
      )
      return { ok: false, error: payload }
    }
  })
}

export function registeredChannels(): IpcChannel[] {
  return [...registered]
}

/** Fails loudly at startup if a channel in the contract has no handler. */
export function assertAllChannelsHandled(): void {
  const missing = (Object.keys(IpcRequestSchemas) as IpcChannel[]).filter((channel) => !registered.has(channel))
  if (missing.length > 0) {
    log.error(`these IPC channels have no handler: ${missing.join(', ')}`)
  }
}
