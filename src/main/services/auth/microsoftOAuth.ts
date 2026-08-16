import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { shell } from 'electron'
import { request, safeUrl } from '../../core/http'
import { LauncherError } from '../../core/errors'
import { createLogger } from '../../core/logger'
import type { DeviceCodePrompt } from '@shared/types'

const log = createLogger('ms-oauth')

/**
 * Microsoft identity platform, `consumers` tenant (personal Microsoft accounts,
 * which is what Minecraft: Java Edition uses).
 *
 * Both flows implemented here are official OAuth 2.0 flows in which the user
 * types their credentials into Microsoft's own web page. The launcher never
 * sees, requests, or stores a Microsoft password.
 */
const AUTHORITY = 'https://login.microsoftonline.com/consumers/oauth2/v2.0'
const DEVICE_CODE_URL = `${AUTHORITY}/devicecode`
const TOKEN_URL = `${AUTHORITY}/token`
const AUTHORIZE_URL = `${AUTHORITY}/authorize`

/** `offline_access` is what allows silent renewal without re-prompting. */
const SCOPE = 'XboxLive.signin offline_access'

export interface MsTokens {
  accessToken: string
  refreshToken: string | null
  expiresAt: number
}

interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
  token_type: string
}

interface OAuthErrorResponse {
  error: string
  error_description?: string
}

function assertClientId(clientId: string): void {
  if (!clientId || clientId.trim().length < 10) {
    throw new LauncherError('AUTH_NOT_CONFIGURED', 'no client id configured')
  }
}

function mapOAuthError(error: string, description?: string): LauncherError {
  switch (error) {
    case 'authorization_declined':
    case 'access_denied':
      return new LauncherError('AUTH_DECLINED', description)
    case 'expired_token':
    case 'code_expired':
      return new LauncherError('AUTH_TIMEOUT', description)
    case 'invalid_client':
    case 'unauthorized_client':
      return new LauncherError('AUTH_NOT_CONFIGURED', description, {
        title: 'Microsoft rejected this application ID',
        message:
          'Microsoft did not recognise the Azure application (client) ID, or the app is not set up for public client sign-in.',
        actions: [
          'Check the client ID in Settings → Account for typos',
          'In Azure, open the app → Authentication → enable "Allow public client flows"',
          'Make sure the app supports "Personal Microsoft accounts"'
        ]
      })
    case 'invalid_grant':
      return new LauncherError('TOKEN_EXPIRED', description)
    default:
      return new LauncherError('AUTH_FAILED', `${error}: ${description ?? ''}`)
  }
}

async function postForm(url: string, form: Record<string, string>, signal?: AbortSignal): Promise<TokenResponse> {
  const response = await request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
    retries: 1,
    signal
  })

  const text = await response.text()
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new LauncherError('AUTH_FAILED', `${safeUrl(url)} returned a non-JSON response (HTTP ${response.status})`)
  }

  if (!response.ok) {
    const err = parsed as OAuthErrorResponse
    throw mapOAuthError(err.error ?? 'unknown', err.error_description)
  }
  return parsed as TokenResponse
}

function toTokens(response: TokenResponse): MsTokens {
  return {
    accessToken: response.access_token,
    refreshToken: response.refresh_token ?? null,
    // Renew a minute early so a request never races the expiry.
    expiresAt: Date.now() + Math.max(0, response.expires_in - 60) * 1000
  }
}

/* --------------------------------------------------------- device code flow */

interface DeviceCodeResponse {
  device_code: string
  user_code: string
  verification_uri: string
  expires_in: number
  interval: number
  message: string
}

/**
 * Device code flow. The user opens a Microsoft page and types a short code —
 * ideal for a desktop app because it needs no redirect URI registration and
 * keeps credential entry entirely inside Microsoft's browser session.
 */
export async function deviceCodeFlow(
  clientId: string,
  onPrompt: (prompt: DeviceCodePrompt) => void,
  signal: AbortSignal
): Promise<MsTokens> {
  assertClientId(clientId)

  const response = await request(DEVICE_CODE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, scope: SCOPE }).toString(),
    signal,
    retries: 1
  })

  const text = await response.text()
  if (!response.ok) {
    let parsed: OAuthErrorResponse
    try {
      parsed = JSON.parse(text) as OAuthErrorResponse
    } catch {
      throw new LauncherError('AUTH_FAILED', `device code request failed with HTTP ${response.status}`)
    }
    throw mapOAuthError(parsed.error ?? 'unknown', parsed.error_description)
  }

  const device = JSON.parse(text) as DeviceCodeResponse
  const expiresAt = Date.now() + device.expires_in * 1000

  onPrompt({
    userCode: device.user_code,
    verificationUri: device.verification_uri,
    expiresAt,
    message: device.message
  })

  // Microsoft dictates the poll interval; polling faster earns a `slow_down`.
  let intervalMs = Math.max(1, device.interval || 5) * 1000

  for (;;) {
    if (signal.aborted) throw new LauncherError('AUTH_DECLINED', 'cancelled by user')
    if (Date.now() > expiresAt) throw new LauncherError('AUTH_TIMEOUT', 'device code expired')

    await new Promise((resolve) => setTimeout(resolve, intervalMs))
    if (signal.aborted) throw new LauncherError('AUTH_DECLINED', 'cancelled by user')

    const pollResponse = await request(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        client_id: clientId,
        device_code: device.device_code
      }).toString(),
      signal,
      retries: 0
    })

    const pollText = await pollResponse.text()
    let parsed: unknown
    try {
      parsed = JSON.parse(pollText)
    } catch {
      continue // transient gateway noise; keep polling until the code expires
    }

    if (pollResponse.ok) {
      log.info('device code flow completed')
      return toTokens(parsed as TokenResponse)
    }

    const err = parsed as OAuthErrorResponse
    if (err.error === 'authorization_pending') continue
    if (err.error === 'slow_down') {
      intervalMs += 5000
      continue
    }
    throw mapOAuthError(err.error ?? 'unknown', err.error_description)
  }
}

/* ------------------------------------------------- authorization code + PKCE */

function base64Url(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const CALLBACK_HTML = (heading: string, body: string, accent: string): string => `<!doctype html>
<html><head><meta charset="utf-8"><title>NexusCraft</title><style>
  body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;
       background:#0b0f14;color:#e8eef5;font-family:system-ui,-apple-system,Segoe UI,sans-serif}
  .card{text-align:center;padding:48px 56px;border-radius:20px;background:#121a23;
        border:1px solid #1e2a36;box-shadow:0 24px 60px rgba(0,0,0,.5)}
  h1{margin:0 0 12px;font-size:24px;color:${accent}}
  p{margin:0;color:#93a4b5;font-size:15px}
</style></head>
<body><div class="card"><h1>${heading}</h1><p>${body}</p></div></body></html>`

/** Builds the URL the system browser is sent to, and opens it. */
async function openAuthorizeUrl(clientId: string, redirectUri: string, challenge: string, state: string): Promise<void> {
  const url = `${AUTHORIZE_URL}?${new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    response_mode: 'query',
    scope: SCOPE,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account'
  })}`
  await shell.openExternal(url)
}

function listenOnLoopback(): Promise<{ server: Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.on('error', reject)
    // Port 0 asks the OS for a free port; binding to 127.0.0.1 keeps the
    // callback listener off the network entirely.
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new LauncherError('AUTH_FAILED', 'could not bind loopback listener'))
        return
      }
      resolve({ server, port: address.port })
    })
  })
}

/* --------------------------------------------------------------- refreshing */

export async function refreshTokens(clientId: string, refreshToken: string): Promise<MsTokens> {
  assertClientId(clientId)
  const response = await postForm(TOKEN_URL, {
    client_id: clientId,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: SCOPE
  })
  return toTokens(response)
}

/**
 * Authorization code flow with PKCE against a loopback redirect. The system
 * browser handles credential entry; the launcher only ever receives the
 * one-time authorization code on 127.0.0.1.
 */
export async function startBrowserRedirectFlow(clientId: string, signal: AbortSignal): Promise<MsTokens> {
  assertClientId(clientId)
  const verifier = base64Url(randomBytes(32))
  const challenge = base64Url(createHash('sha256').update(verifier).digest())
  const state = base64Url(randomBytes(16))
  const { server, port } = await listenOnLoopback()
  const redirectUri = `http://127.0.0.1:${port}/callback`

  const codePromise = new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new LauncherError('AUTH_TIMEOUT', 'no redirect within 5 minutes')), 300_000)
    const settle = (fn: () => void): void => {
      clearTimeout(timeout)
      fn()
    }
    signal.addEventListener('abort', () => settle(() => reject(new LauncherError('AUTH_DECLINED', 'cancelled'))), {
      once: true
    })
    server.on('request', (req, res) => {
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)
      if (url.pathname !== '/callback') {
        res.writeHead(404).end()
        return
      }
      const respond = (heading: string, body: string, accent: string, status = 200): void => {
        res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(CALLBACK_HTML(heading, body, accent))
      }
      if (url.searchParams.get('state') !== state) {
        respond('Sign-in rejected', 'The response did not match this sign-in request.', '#f87171', 400)
        settle(() => reject(new LauncherError('AUTH_FAILED', 'state mismatch on redirect')))
        return
      }
      const error = url.searchParams.get('error')
      if (error) {
        respond('Sign-in cancelled', 'You can close this tab and return to NexusCraft.', '#f87171', 400)
        settle(() => reject(mapOAuthError(error, url.searchParams.get('error_description') ?? undefined)))
        return
      }
      const authCode = url.searchParams.get('code')
      if (!authCode) {
        respond('Sign-in failed', 'No authorization code was returned.', '#f87171', 400)
        settle(() => reject(new LauncherError('AUTH_FAILED', 'redirect carried no authorization code')))
        return
      }
      respond('You are signed in', 'You can close this tab and return to NexusCraft.', '#5eead4')
      settle(() => resolve(authCode))
    })
  })

  try {
    await openAuthorizeUrl(clientId, redirectUri, challenge, state)
    const code = await codePromise
    const tokens = await postForm(
      TOKEN_URL,
      {
        client_id: clientId,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        code_verifier: verifier,
        scope: SCOPE
      },
      signal
    )
    return toTokens(tokens)
  } finally {
    server.close()
  }
}
