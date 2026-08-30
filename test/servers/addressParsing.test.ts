import { describe, expect, it, vi } from 'vitest'

/**
 * The address box on the Discover screen takes whatever a person pastes out of
 * a Discord message, so these cover the shapes that actually turn up rather
 * than only the tidy one.
 */

// The module reaches settings (and through it the database) at import time via
// its other exports, so the two leaf modules are stubbed. The parser itself is
// pure and is what is under test here.
vi.mock('../../src/main/core/database', () => ({ db: () => ({ kvGet: () => null, kvSet: () => undefined }) }))
vi.mock('../../src/main/core/events', () => ({ emit: () => undefined, toast: () => undefined }))
vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }))

const { parseServerAddress } = await import('../../src/main/services/servers/directoryService')

describe('parseServerAddress', () => {
  it('defaults to the Minecraft port when none is given', () => {
    expect(parseServerAddress('play.example.com')).toEqual({ host: 'play.example.com', port: 25565 })
  })

  it('reads an explicit port', () => {
    expect(parseServerAddress('play.example.com:25566')).toEqual({ host: 'play.example.com', port: 25566 })
  })

  it('accepts a bare IPv4 address', () => {
    expect(parseServerAddress('192.168.1.20')).toEqual({ host: '192.168.1.20', port: 25565 })
  })

  it('accepts an IPv4 address with a port', () => {
    expect(parseServerAddress('192.168.1.20:19132')).toEqual({ host: '192.168.1.20', port: 19132 })
  })

  it('trims surrounding whitespace', () => {
    expect(parseServerAddress('  play.example.com:25565  ')).toEqual({
      host: 'play.example.com',
      port: 25565
    })
  })

  it('strips a pasted minecraft:// scheme', () => {
    expect(parseServerAddress('minecraft://play.example.com:25570')).toEqual({
      host: 'play.example.com',
      port: 25570
    })
  })

  it('strips a trailing slash picked up from a web page', () => {
    expect(parseServerAddress('play.example.com/')).toEqual({ host: 'play.example.com', port: 25565 })
  })

  it('keeps the colons in a bracketed IPv6 literal', () => {
    expect(parseServerAddress('[::1]')).toEqual({ host: '::1', port: 25565 })
  })

  it('reads the port after a bracketed IPv6 literal', () => {
    expect(parseServerAddress('[2001:db8::1]:25577')).toEqual({ host: '2001:db8::1', port: 25577 })
  })

  it('rejects an empty address', () => {
    expect(() => parseServerAddress('   ')).toThrow()
  })

  it('rejects a port above the valid range', () => {
    expect(() => parseServerAddress('play.example.com:70000')).toThrow()
  })

  it('rejects port zero', () => {
    expect(() => parseServerAddress('play.example.com:0')).toThrow()
  })

  it('rejects an address containing a space', () => {
    expect(() => parseServerAddress('play example com')).toThrow()
  })

  it('rejects an unbracketed address with several colons, which is ambiguous', () => {
    // Bare IPv6 without brackets cannot be told apart from a typo, so it is
    // refused rather than silently read as host "2001" on port 0.
    expect(() => parseServerAddress('2001:db8::1')).toThrow()
  })
})
