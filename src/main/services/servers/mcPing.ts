import { Socket } from 'node:net'
import { resolveSrv } from 'node:dns/promises'
import { createLogger } from '../../core/logger'

const log = createLogger('mc-ping')

/**
 * Minecraft's Server List Ping, as spoken by the game's own multiplayer screen.
 *
 * Nothing here guesses: a server is only reported online if it completes the
 * handshake and returns a status payload.
 */

/* ------------------------------------------------------------- varint io */

function writeVarInt(value: number): Buffer {
  const bytes: number[] = []
  let remaining = value >>> 0
  do {
    let byte = remaining & 0x7f
    remaining >>>= 7
    if (remaining !== 0) byte |= 0x80
    bytes.push(byte)
  } while (remaining !== 0)
  return Buffer.from(bytes)
}

function writeString(value: string): Buffer {
  const data = Buffer.from(value, 'utf8')
  return Buffer.concat([writeVarInt(data.length), data])
}

interface VarIntResult {
  value: number
  size: number
}

function readVarInt(buffer: Buffer, offset = 0): VarIntResult | null {
  let value = 0
  let size = 0
  for (;;) {
    if (offset + size >= buffer.length) return null // need more bytes
    const byte = buffer[offset + size]
    value |= (byte & 0x7f) << (7 * size)
    size++
    if ((byte & 0x80) === 0) break
    if (size > 5) return null // malformed
  }
  return { value: value >>> 0, size }
}

function packet(id: number, ...payload: Buffer[]): Buffer {
  const body = Buffer.concat([writeVarInt(id), ...payload])
  return Buffer.concat([writeVarInt(body.length), body])
}

/* ------------------------------------------------------------- responses */

export interface PingResult {
  online: true
  latencyMs: number | null
  versionName: string | null
  protocol: number | null
  playersOnline: number | null
  playersMax: number | null
  motd: string | null
  faviconDataUrl: string | null
}

export interface PingFailure {
  online: false
  error: string
}

interface StatusResponse {
  version?: { name?: string; protocol?: number }
  players?: { max?: number; online?: number }
  description?: unknown
  favicon?: string
}

/** Minecraft descriptions are either a plain string or a JSON text component. */
function flattenDescription(value: unknown, depth = 0): string {
  if (depth > 12) return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map((v) => flattenDescription(v, depth + 1)).join('')
  if (value && typeof value === 'object') {
    const node = value as { text?: string; extra?: unknown[]; translate?: string }
    const own = node.text ?? node.translate ?? ''
    const extra = (node.extra ?? []).map((v) => flattenDescription(v, depth + 1)).join('')
    return `${own}${extra}`
  }
  return ''
}

/** Strips Minecraft's §-prefixed colour codes for display. */
export function stripFormatting(text: string): string {
  return text.replace(/§[0-9a-fk-orA-FK-OR]/g, '')
}

/**
 * Resolves the SRV record Minecraft uses, so "play.example.com" reaches the
 * real host and port the same way the game would.
 */
export async function resolveServerAddress(host: string, port: number): Promise<{ host: string; port: number }> {
  // The game only performs the SRV lookup when no explicit port was given.
  if (port !== 25565) return { host, port }
  try {
    const records = await resolveSrv(`_minecraft._tcp.${host}`)
    if (records.length > 0) {
      const best = records.sort((a, b) => a.priority - b.priority || b.weight - a.weight)[0]
      return { host: best.name, port: best.port }
    }
  } catch {
    // No SRV record is the common case, not an error.
  }
  return { host, port }
}

export async function pingServer(
  rawHost: string,
  rawPort: number,
  timeoutMs = 5000
): Promise<PingResult | PingFailure> {
  const { host, port } = await resolveServerAddress(rawHost, rawPort)

  return await new Promise((resolve) => {
    const socket = new Socket()
    let buffer = Buffer.alloc(0)
    let statusReceived = false
    let pingSentAt = 0
    let settled = false
    let result: PingResult | null = null

    const finish = (value: PingResult | PingFailure): void => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(value)
    }

    const fail = (message: string): void => finish({ online: false, error: message })

    socket.setTimeout(timeoutMs)
    socket.on('timeout', () => fail('The server did not respond in time.'))
    socket.on('error', (err) => {
      const code = (err as NodeJS.ErrnoException).code
      switch (code) {
        case 'ENOTFOUND':
          fail('That address could not be found.')
          break
        case 'ECONNREFUSED':
          fail('The server refused the connection.')
          break
        case 'ETIMEDOUT':
          fail('The server did not respond in time.')
          break
        case 'ECONNRESET':
          fail('The server closed the connection.')
          break
        default:
          fail('Could not reach the server.')
      }
    })

    socket.on('close', () => {
      // A server that answers status but ignores the ping still counts as online.
      if (!settled && result) finish(result)
      else if (!settled) fail('The connection closed before a reply arrived.')
    })

    socket.connect(port, host, () => {
      const handshake = packet(
        0x00,
        // -1 asks the server to reply without caring about our version.
        writeVarInt(0xffffffff),
        writeString(host),
        (() => {
          const portBuffer = Buffer.alloc(2)
          portBuffer.writeUInt16BE(port)
          return portBuffer
        })(),
        writeVarInt(1) // next state: status
      )
      socket.write(handshake)
      socket.write(packet(0x00)) // status request
    })

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk])

      for (;;) {
        const length = readVarInt(buffer)
        if (!length) return // wait for more
        if (buffer.length < length.size + length.value) return

        const body = buffer.subarray(length.size, length.size + length.value)
        buffer = buffer.subarray(length.size + length.value)

        const packetId = readVarInt(body)
        if (!packetId) return
        const payload = body.subarray(packetId.size)

        if (packetId.value === 0x00 && !statusReceived) {
          statusReceived = true
          const stringLength = readVarInt(payload)
          if (!stringLength) return fail('The server sent a malformed status reply.')

          const json = payload.subarray(stringLength.size, stringLength.size + stringLength.value).toString('utf8')
          let status: StatusResponse
          try {
            status = JSON.parse(json) as StatusResponse
          } catch {
            return fail('The server sent a status reply that could not be read.')
          }

          const motd = stripFormatting(flattenDescription(status.description)).trim()
          const favicon =
            typeof status.favicon === 'string' && status.favicon.startsWith('data:image/png;base64,')
              ? status.favicon.slice(0, 200_000)
              : null

          result = {
            online: true,
            latencyMs: null,
            versionName: status.version?.name ?? null,
            protocol: status.version?.protocol ?? null,
            playersOnline: typeof status.players?.online === 'number' ? status.players.online : null,
            playersMax: typeof status.players?.max === 'number' ? status.players.max : null,
            motd: motd.length > 0 ? motd.slice(0, 300) : null,
            faviconDataUrl: favicon
          }

          // Round-trip a ping packet to measure real latency.
          pingSentAt = Date.now()
          const payloadBuffer = Buffer.alloc(8)
          payloadBuffer.writeBigInt64BE(BigInt(pingSentAt))
          socket.write(packet(0x01, payloadBuffer))
          continue
        }

        if (packetId.value === 0x01 && result) {
          result.latencyMs = Date.now() - pingSentAt
          return finish(result)
        }
      }
    })
  })
}
