import { LauncherError } from './errors'
import { createLogger } from './logger'

const log = createLogger('http')

export const USER_AGENT = 'NexusCraftLauncher/1.0.0 (+https://github.com/nexuscraft/launcher)'

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'DELETE' | 'PUT'
  headers?: Record<string, string>
  body?: string | Buffer | FormData
  timeoutMs?: number
  /** How many times to retry transient failures (network errors, 5xx, 429). */
  retries?: number
  signal?: AbortSignal
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504])

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new LauncherError('CANCELLED', 'aborted while waiting to retry'))
      },
      { once: true }
    )
  })
}

/**
 * fetch with a timeout, bounded exponential backoff and caller-supplied
 * cancellation. Response bodies are never logged — only status codes are.
 */
export async function request(url: string, opts: RequestOptions = {}): Promise<Response> {
  const { method = 'GET', headers = {}, body, timeoutMs = 30_000, retries = 3, signal } = opts
  let lastError: unknown

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (signal?.aborted) throw new LauncherError('CANCELLED', 'aborted')
    const controller = new AbortController()
    const onAbort = (): void => controller.abort()
    signal?.addEventListener('abort', onAbort, { once: true })
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetch(url, {
        method,
        headers: { 'User-Agent': USER_AGENT, ...headers },
        // Node's fetch accepts strings, Buffers and FormData; the DOM BodyInit
        // type is not available in a Node-targeted lib.
        body: body as never,
        signal: controller.signal,
        redirect: 'follow'
      })

      if (RETRYABLE_STATUS.has(response.status) && attempt < retries) {
        const retryAfter = Number(response.headers.get('retry-after'))
        const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt
        log.warn(`HTTP ${response.status} for ${safeUrl(url)}; retrying in ${wait}ms`)
        await sleep(Math.min(wait, 15_000), signal)
        continue
      }
      return response
    } catch (err) {
      lastError = err
      // An abort we asked for is not retryable.
      if (signal?.aborted) throw new LauncherError('CANCELLED', 'aborted')
      if (attempt >= retries) break
      const wait = 500 * 2 ** attempt
      log.warn(`request to ${safeUrl(url)} failed (${(err as Error).message}); retrying in ${wait}ms`)
      await sleep(wait, signal)
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
  }

  throw new LauncherError('NETWORK_ERROR', `${safeUrl(url)}: ${(lastError as Error)?.message ?? 'unknown'}`)
}

/** Strips query strings so tokens in URLs never reach a log line. */
export function safeUrl(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.origin}${parsed.pathname}`
  } catch {
    return '[invalid url]'
  }
}

export async function getJson<T>(url: string, opts: RequestOptions = {}): Promise<T> {
  const response = await request(url, opts)
  if (!response.ok) {
    throw new LauncherError('NETWORK_ERROR', `GET ${safeUrl(url)} -> HTTP ${response.status}`)
  }
  return (await response.json()) as T
}

export async function getBuffer(url: string, opts: RequestOptions = {}): Promise<Buffer> {
  const response = await request(url, opts)
  if (!response.ok) {
    throw new LauncherError('NETWORK_ERROR', `GET ${safeUrl(url)} -> HTTP ${response.status}`)
  }
  return Buffer.from(await response.arrayBuffer())
}

export async function getText(url: string, opts: RequestOptions = {}): Promise<string> {
  const response = await request(url, opts)
  if (!response.ok) {
    throw new LauncherError('NETWORK_ERROR', `GET ${safeUrl(url)} -> HTTP ${response.status}`)
  }
  return await response.text()
}

/** Converts a fetched image into a data URL so the renderer loads no remote content. */
export async function fetchImageAsDataUrl(url: string, opts: RequestOptions = {}): Promise<string | null> {
  try {
    const response = await request(url, { retries: 1, timeoutMs: 15_000, ...opts })
    if (!response.ok) return null
    const type = response.headers.get('content-type') ?? 'image/png'
    if (!type.startsWith('image/')) return null
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.byteLength > 4 * 1024 * 1024) return null
    return `data:${type};base64,${buffer.toString('base64')}`
  } catch {
    return null
  }
}
