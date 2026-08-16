import { createWriteStream, WriteStream } from 'node:fs'
import { join } from 'node:path'
import { logsRoot, ensureDir } from './paths'

/**
 * Patterns for values that must never reach a log file, the console or the
 * renderer. Anything matching is replaced before the line is emitted.
 *
 * This is defence in depth: the code paths that handle tokens already avoid
 * logging them, but a stray `JSON.stringify(response)` in future maintenance
 * would otherwise leak a bearer token into a file users routinely paste into
 * support threads.
 */
const REDACTIONS: Array<[RegExp, string]> = [
  // JSON fields carrying secrets
  [/("(?:access_token|refresh_token|id_token|accessToken|refreshToken|Token|device_code|RpsTicket|client_secret)"\s*:\s*)"[^"]*"/gi, '$1"[redacted]"'],
  // Authorization headers, incl. the Minecraft XBL3.0 scheme
  [/\b(Authorization|Bearer|XBL3\.0 x=)\s*[:=]?\s*\S+/gi, '$1 [redacted]'],
  // JWTs anywhere in free text
  [/\bey[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/g, '[redacted-jwt]'],
  // Long opaque MSA tokens
  [/\bM\.[A-Za-z0-9._~-]{20,}/g, '[redacted-token]'],
  // Query-string secrets
  [/([?&](?:code|access_token|refresh_token|token)=)[^&\s]+/gi, '$1[redacted]']
]

export function redact(input: unknown): string {
  let text: string
  if (typeof input === 'string') text = input
  else if (input instanceof Error) text = `${input.name}: ${input.message}\n${input.stack ?? ''}`
  else {
    try {
      text = JSON.stringify(input)
    } catch {
      text = String(input)
    }
  }
  for (const [pattern, replacement] of REDACTIONS) text = text.replace(pattern, replacement)
  return text
}

type Level = 'debug' | 'info' | 'warn' | 'error'

let stream: WriteStream | null = null

function openStream(): WriteStream | null {
  if (stream) return stream
  try {
    ensureDir(logsRoot())
    stream = createWriteStream(join(logsRoot(), 'launcher.log'), { flags: 'a' })
  } catch {
    stream = null
  }
  return stream
}

function write(level: Level, scope: string, parts: unknown[]): void {
  const line = `${new Date().toISOString()} [${level.toUpperCase()}] [${scope}] ${parts.map(redact).join(' ')}`
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
  openStream()?.write(line + '\n')
}

export interface Logger {
  debug(...parts: unknown[]): void
  info(...parts: unknown[]): void
  warn(...parts: unknown[]): void
  error(...parts: unknown[]): void
}

export function createLogger(scope: string): Logger {
  return {
    debug: (...p) => write('debug', scope, p),
    info: (...p) => write('info', scope, p),
    warn: (...p) => write('warn', scope, p),
    error: (...p) => write('error', scope, p)
  }
}

export function closeLogger(): void {
  stream?.end()
  stream = null
}
