import { describe, expect, it, vi } from 'vitest'

/**
 * Redaction is the last thing standing between a Microsoft token and a log file
 * that users routinely paste into support threads. Every pattern gets a test,
 * and each one asserts on the secret's absence rather than on the exact
 * replacement text, so tightening a pattern later cannot silently pass.
 */

// `logger` pulls in `paths`, which reaches for Electron's `app` at import time.
vi.mock('electron', () => ({ app: { getPath: () => 'C:\\tmp' } }))

const { redact } = await import('@main/core/logger')
const { LauncherError, toErrorPayload } = await import('@main/core/errors')

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk'
const MSA = 'M.C528_BAY.0.U.-Cq8kJ1abcdefghijklmnopqrstuvwxyz0123456789'

describe('redact', () => {
  it('redacts secret-bearing JSON fields', () => {
    const body = JSON.stringify({ access_token: 'secret-a', refresh_token: 'secret-b', expires_in: 86400 })
    const out = redact(body)
    expect(out).not.toContain('secret-a')
    expect(out).not.toContain('secret-b')
    // Non-secret fields must survive, or the logs stop being useful.
    expect(out).toContain('expires_in')
    expect(out).toContain('86400')
  })

  it('redacts the camelCase spellings the launcher uses internally', () => {
    const out = redact(JSON.stringify({ accessToken: 'secret-a', refreshToken: 'secret-b' }))
    expect(out).not.toContain('secret-a')
    expect(out).not.toContain('secret-b')
  })

  it('redacts the Xbox device code and RPS ticket', () => {
    const out = redact(JSON.stringify({ device_code: 'dev-secret', RpsTicket: 'rps-secret' }))
    expect(out).not.toContain('dev-secret')
    expect(out).not.toContain('rps-secret')
  })

  it('redacts Authorization headers', () => {
    expect(redact('Authorization: Bearer abc123def456')).not.toContain('abc123def456')
  })

  it("redacts Minecraft's XBL3.0 authorization scheme", () => {
    const out = redact('Authorization: XBL3.0 x=userhash;tokenvalue')
    expect(out).not.toContain('tokenvalue')
  })

  it('redacts a bare JWT in free text', () => {
    const out = redact(`the request failed with token ${JWT} attached`)
    expect(out).not.toContain(JWT)
    expect(out).toContain('[redacted-jwt]')
    expect(out).toContain('the request failed')
  })

  it('redacts a long opaque MSA token', () => {
    expect(redact(`code=${MSA}`)).not.toContain(MSA)
  })

  it('redacts query-string secrets while keeping the rest of the URL', () => {
    const out = redact('https://login.live.com/oauth20?client_id=abc&code=SUPERSECRET&state=xyz')
    expect(out).not.toContain('SUPERSECRET')
    expect(out).toContain('login.live.com')
    expect(out).toContain('state=xyz')
  })

  it('redacts every occurrence, not only the first', () => {
    const out = redact(`${JWT} and again ${JWT}`)
    expect(out).not.toContain(JWT)
  })

  it('reads an Error as its name, message and stack', () => {
    const out = redact(new Error('boom'))
    expect(out).toContain('Error: boom')
  })

  it('redacts a secret carried inside an Error message', () => {
    expect(redact(new Error(`request failed: ${JWT}`))).not.toContain(JWT)
  })

  it('serialises plain objects', () => {
    expect(redact({ a: 1 })).toContain('"a":1')
  })

  it('survives a circular object instead of throwing', () => {
    const circular: Record<string, unknown> = { name: 'x' }
    circular.self = circular
    expect(() => redact(circular)).not.toThrow()
  })

  it('handles null and undefined', () => {
    expect(() => redact(null)).not.toThrow()
    expect(() => redact(undefined)).not.toThrow()
  })

  it('leaves ordinary log lines untouched', () => {
    const line = 'installed 12 file(s) into C:\\data\\instances\\inst-1\\mods'
    expect(redact(line)).toBe(line)
  })
})

describe('LauncherError', () => {
  it('produces a user-readable payload from the catalogue', () => {
    const payload = new LauncherError('NETWORK_ERROR').toPayload()
    expect(payload.code).toBe('NETWORK_ERROR')
    expect(payload.title).toBeTruthy()
    expect(payload.message).toBeTruthy()
    expect(Array.isArray(payload.actions)).toBe(true)
  })

  it('lets overrides replace the catalogue defaults', () => {
    const payload = new LauncherError('UNKNOWN', null, { title: 'Custom', actions: ['Do a thing'] }).toPayload()
    expect(payload.title).toBe('Custom')
    expect(payload.actions).toEqual(['Do a thing'])
  })

  it('redacts the detail it is given', () => {
    const payload = new LauncherError('UNKNOWN', `failed with ${JWT}`).toPayload()
    expect(payload.detail).not.toContain(JWT)
  })

  it('caps the detail so a huge response body cannot flood the UI', () => {
    const payload = new LauncherError('UNKNOWN', 'x'.repeat(10_000)).toPayload()
    expect(payload.detail!.length).toBeLessThanOrEqual(2000)
  })

  it('leaves detail null when none was given', () => {
    expect(new LauncherError('UNKNOWN').toPayload().detail).toBeNull()
    expect(new LauncherError('UNKNOWN', null).toPayload().detail).toBeNull()
  })
})

describe('toErrorPayload', () => {
  it('passes a LauncherError through unchanged', () => {
    const payload = toErrorPayload(new LauncherError('NOT_FOUND', 'missing'))
    expect(payload.code).toBe('NOT_FOUND')
  })

  it.each(['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'ENETUNREACH', 'EAI_AGAIN', 'ECONNRESET'])(
    'maps %s onto a network error',
    (code) => {
      const err = Object.assign(new Error('socket failed'), { code })
      expect(toErrorPayload(err).code).toBe('NETWORK_ERROR')
    }
  )

  it('maps ENOENT onto a not-found error', () => {
    const err = Object.assign(new Error('no such file'), { code: 'ENOENT' })
    expect(toErrorPayload(err).code).toBe('NOT_FOUND')
  })

  it('falls back to UNKNOWN for anything else', () => {
    expect(toErrorPayload(new Error('who knows')).code).toBe('UNKNOWN')
    expect(toErrorPayload('a bare string').code).toBe('UNKNOWN')
    expect(toErrorPayload(undefined).code).toBe('UNKNOWN')
  })

  it('never leaks a token through the fallback path', () => {
    const payload = toErrorPayload(new Error(`upstream said ${JWT}`))
    expect(JSON.stringify(payload)).not.toContain(JWT)
  })
})
