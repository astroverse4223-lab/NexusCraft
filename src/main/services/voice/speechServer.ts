import { createServer, type Server } from 'node:http'
import { transcribe } from './whisper'
import { speak, DEFAULT_VOICE, type BuildName } from './kokoro'

/**
 * The voice, offered to Minecraft over HTTP.
 *
 * The Hollow mod already speaks OpenAI's `POST /v1/audio/speech`, which is the
 * same call Kokoro's own server implements — so rather than teaching the mod a
 * private protocol, the launcher simply answers that call. Point the mod's
 * `speechUrl` here and the companion in the game speaks with the same voice as
 * the companions in the app.
 *
 * The alternative was for the mod to run its own copy of Kokoro. That means a
 * second download of a few hundred megabytes, a second copy resident while
 * Minecraft is already using the memory, and two places to keep in step. One
 * model, two consumers, is the whole reason this exists.
 *
 * Bound to 127.0.0.1 and nothing else. This is a local convenience for a game
 * running on the same machine; a text-to-speech endpoint reachable from the
 * network is a service, and nobody asked for one.
 */

/** The port the mod's default configuration points at. */
export const SPEECH_PORT = 8880

let server: Server | null = null

/** How the audio is asked for, in the shape OpenAI defined. */
interface SpeechRequest {
  input?: string
  voice?: string
  model?: string
  response_format?: string
}

function readBody(request: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    let size = 0
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      // A line of dialogue is a sentence. Anything larger is a mistake or an
      // attempt at one, and there is no reason to buffer it.
      if (size > 64_000) {
        reject(new Error('request too large'))
        request.destroy()
        return
      }
      body += chunk
    })
    request.on('end', () => resolve(body))
    request.on('error', reject)
  })
}

export function isRunning(): boolean {
  return server !== null
}

export async function start(build: BuildName = 'q4'): Promise<void> {
  if (server) return

  server = createServer((request, response) => {
    void (async () => {
      if (request.method !== 'POST') {
        response.writeHead(404).end()
        return
      }

      /*
       * Speech to text, for a companion listening to a microphone.
       *
       * Same server as the voice on purpose: one address for the mod to know,
       * and one switch that turns both directions on at once.
       */
      if (request.url?.endsWith('/audio/transcriptions')) {
        try {
          const { file, fields } = parseMultipart(await readRawBody(request), request.headers['content-type'] ?? '')
          if (!file) {
            response.writeHead(400, { 'Content-Type': 'application/json' })
              .end(JSON.stringify({ error: 'no audio file in the request' }))
            return
          }

          const text = await transcribe(file, fields.language || undefined)
          response.writeHead(200, { 'Content-Type': 'application/json' })
          response.end(JSON.stringify({ text }))
        } catch (error) {
          response
            .writeHead(500, { 'Content-Type': 'application/json' })
            .end(JSON.stringify({ error: error instanceof Error ? error.message : 'transcription failed' }))
        }
        return
      }

      if (!request.url?.endsWith('/audio/speech')) {
        response.writeHead(404).end()
        return
      }

      try {
        const body = JSON.parse(await readBody(request)) as SpeechRequest
        const line = (body.input ?? '').slice(0, 400)
        if (!line.trim()) {
          response.writeHead(400).end()
          return
        }

        const wav = await speak(line, body.voice || DEFAULT_VOICE, build)
        response.writeHead(200, {
          'Content-Type': 'audio/wav',
          'Content-Length': String(wav.length)
        })
        response.end(wav)
      } catch (error) {
        // The mod treats any non-2xx as "engine unavailable" and falls back to
        // the game's narrator, so a failure here costs a voice, not a line.
        response
          .writeHead(500, { 'Content-Type': 'text/plain' })
          .end(error instanceof Error ? error.message : 'speech failed')
      }
    })()
  })

  await new Promise<void>((resolve, reject) => {
    server?.once('error', (error: NodeJS.ErrnoException) => {
      server = null
      /*
       * Already in use is not an error worth surfacing. It usually means the
       * user is running Kokoro-FastAPI themselves on the same port, in which
       * case the mod reaches a working engine either way and there is nothing
       * to fix.
       */
      if (error.code === 'EADDRINUSE') {
        resolve()
        return
      }
      reject(error)
    })
    // Loopback only.
    server?.listen(SPEECH_PORT, '127.0.0.1', resolve)
  })
}

export async function stop(): Promise<void> {
  const running = server
  server = null
  if (!running) return
  await new Promise<void>((resolve) => running.close(() => resolve()))
}


/** The whole body as bytes, for a request that is not text. */
async function readRawBody(request: import('node:http').IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks)
}

/**
 * Pulls the file and the plain fields out of a multipart body.
 *
 * Hand-written because this server accepts exactly one shape of upload from
 * exactly one caller, and a parsing dependency for that is more surface than it
 * saves. Works on bytes throughout — decoding a WAV as text corrupts it.
 */
export function parseMultipart(
  body: Buffer,
  contentType: string
): { file: Buffer | null; fields: Record<string, string> } {
  const marker = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType)
  const boundary = marker?.[1] ?? marker?.[2]
  if (!boundary) return { file: null, fields: {} }

  const separator = Buffer.from(`--${boundary}`)
  const fields: Record<string, string> = {}
  let file: Buffer | null = null

  let at = body.indexOf(separator)
  while (at !== -1) {
    const start = at + separator.length
    // The trailing "--" marks the end of the body.
    if (body.toString('ascii', start, start + 2) === '--') break

    const next = body.indexOf(separator, start)
    if (next === -1) break

    const part = body.subarray(start, next)
    const headerEnd = part.indexOf('\r\n\r\n')
    if (headerEnd !== -1) {
      const headers = part.toString('utf8', 0, headerEnd)
      // Minus the CRLF that belongs to the separator, not the content.
      const content = part.subarray(headerEnd + 4, part.length - 2)

      const named = /name="([^"]+)"/i.exec(headers)
      const name = named?.[1]

      if (name) {
        if (/filename="/i.test(headers)) file = content
        else fields[name] = content.toString('utf8').trim()
      }
    }

    at = next
  }

  return { file, fields }
}
