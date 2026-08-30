import { connect, type Socket } from 'node:net'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { createLogger } from '../../core/logger'

const log = createLogger('discord-rpc')

/**
 * A minimal client for Discord's local IPC socket.
 *
 * Discord exposes rich presence over a named pipe (`\\.\pipe\discord-ipc-N` on
 * Windows, a unix socket under the runtime dir elsewhere), speaking a simple
 * framed protocol: a 4-byte little-endian opcode, a 4-byte little-endian
 * length, then UTF-8 JSON. That is the entire surface presence needs, so this
 * implements it directly rather than pulling in a native-dependency library
 * for two message types.
 *
 * Everything here is best-effort by design. Discord not running, a user who
 * closed it mid-session, a pipe that refuses the connection — none of that is
 * an error worth surfacing, so failures only ever reach the log.
 */

const OP_HANDSHAKE = 0
const OP_FRAME = 1
const OP_CLOSE = 2
const OP_PING = 3
const OP_PONG = 4

/** Where Discord listens, by platform. Up to ten clients may be running. */
function socketPath(index: number): string {
  if (process.platform === 'win32') return `\\\\?\\pipe\\discord-ipc-${index}`
  const base =
    process.env.XDG_RUNTIME_DIR ?? process.env.TMPDIR ?? process.env.TMP ?? process.env.TEMP ?? '/tmp'
  return `${base.replace(/\/$/, '')}/discord-ipc-${index}`
}

export interface PresenceActivity {
  /** The bold first line, e.g. the modpack or instance name. */
  details?: string
  /** The second line, e.g. "In the main menu" or a server address. */
  state?: string
  /** Unix ms; Discord renders the elapsed time itself. */
  startTimestamp?: number
  largeImageKey?: string
  largeImageText?: string
  smallImageKey?: string
  smallImageText?: string
}

export class DiscordRpcClient extends EventEmitter {
  private socket: Socket | null = null
  private buffer = Buffer.alloc(0)
  private connected = false
  private readonly clientId: string

  constructor(clientId: string) {
    super()
    this.clientId = clientId
  }

  get isConnected(): boolean {
    return this.connected
  }

  /**
   * Tries each of Discord's ten possible sockets in turn. Resolves false when
   * none answered, which simply means Discord is not running.
   */
  async connect(): Promise<boolean> {
    if (this.connected) return true

    for (let index = 0; index < 10; index += 1) {
      const socket = await this.tryOne(socketPath(index))
      if (!socket) continue

      this.socket = socket
      socket.on('data', (chunk) => this.onData(chunk))
      socket.on('close', () => this.onClose())
      socket.on('error', () => this.onClose())

      this.write(OP_HANDSHAKE, { v: 1, client_id: this.clientId })
      this.connected = true
      log.info(`connected to Discord on socket ${index}`)
      return true
    }

    return false
  }

  private tryOne(path: string): Promise<Socket | null> {
    return new Promise((resolve) => {
      let settled = false
      const socket = connect(path)

      const finish = (value: Socket | null): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (!value) socket.destroy()
        resolve(value)
      }

      const timer = setTimeout(() => finish(null), 1500)
      socket.once('connect', () => finish(socket))
      socket.once('error', () => finish(null))
    })
  }

  private write(op: number, payload: unknown): void {
    if (!this.socket || this.socket.destroyed) return
    try {
      const json = Buffer.from(JSON.stringify(payload), 'utf8')
      const header = Buffer.alloc(8)
      header.writeInt32LE(op, 0)
      header.writeInt32LE(json.length, 4)
      this.socket.write(Buffer.concat([header, json]))
    } catch (err) {
      log.warn(`could not write to the Discord socket: ${(err as Error).message}`)
    }
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk])

    // Frames arrive back to back; drain every complete one in the buffer.
    while (this.buffer.length >= 8) {
      const op = this.buffer.readInt32LE(0)
      const length = this.buffer.readInt32LE(4)
      if (this.buffer.length < 8 + length) break

      const body = this.buffer.subarray(8, 8 + length).toString('utf8')
      this.buffer = this.buffer.subarray(8 + length)

      if (op === OP_PING) {
        // Discord expects the payload echoed back verbatim.
        try {
          this.write(OP_PONG, JSON.parse(body))
        } catch {
          /* a malformed ping is not worth reacting to */
        }
        continue
      }
      if (op === OP_CLOSE) {
        this.onClose()
        return
      }
      if (op === OP_FRAME) {
        try {
          this.emit('message', JSON.parse(body))
        } catch {
          /* ignore frames we cannot parse */
        }
      }
    }
  }

  private onClose(): void {
    if (!this.connected && !this.socket) return
    this.connected = false
    this.socket?.destroy()
    this.socket = null
    this.buffer = Buffer.alloc(0)
    this.emit('disconnected')
  }

  /** Publishes an activity, or clears it when given null. */
  setActivity(activity: PresenceActivity | null): void {
    if (!this.connected) return

    const payload = activity
      ? {
          details: activity.details,
          state: activity.state,
          timestamps: activity.startTimestamp ? { start: Math.floor(activity.startTimestamp) } : undefined,
          assets: {
            large_image: activity.largeImageKey,
            large_text: activity.largeImageText,
            small_image: activity.smallImageKey,
            small_text: activity.smallImageText
          }
        }
      : null

    this.write(OP_FRAME, {
      cmd: 'SET_ACTIVITY',
      args: { pid: process.pid, activity: payload },
      nonce: randomUUID()
    })
  }

  destroy(): void {
    if (this.socket && this.connected) {
      // Clearing first stops a stale "Playing…" lingering in Discord.
      this.setActivity(null)
    }
    this.connected = false
    this.socket?.destroy()
    this.socket = null
  }
}
