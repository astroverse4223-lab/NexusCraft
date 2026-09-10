import { describe, expect, it, vi } from 'vitest'

vi.mock('node:dns/promises', () => ({
  resolve4: vi.fn(),
  resolveSrv: vi.fn()
}))

import { resolve4, resolveSrv } from 'node:dns/promises'
import { checkDomain, tidyDomain } from '../../src/main/services/servers/domainService'
import { IpcRequestSchemas } from '../../src/shared/ipc'

/**
 * Checking a domain, because every way it fails is silent.
 *
 * Not propagated, pointed at the wrong IP, no SRV record - from a player's
 * chair all three are the same thing: they type the name and Minecraft says it
 * cannot connect. Nothing anywhere says which. So the value of this is not
 * that it resolves a name, it is that it can tell the four apart.
 */

const asA = (addresses: string[]): void => {
  vi.mocked(resolve4).mockResolvedValue(addresses)
}

const noSrv = (): void => {
  vi.mocked(resolveSrv).mockRejectedValue(new Error('ENOTFOUND'))
}

describe('tidying what somebody pasted', () => {
  it('takes a bare domain unchanged', () => {
    expect(tidyDomain('play.example.com')).toBe('play.example.com')
  })

  it('strips the things people paste by habit', () => {
    expect(tidyDomain('https://play.example.com/')).toBe('play.example.com')
    expect(tidyDomain('  PLAY.Example.com  ')).toBe('play.example.com')

    // The port belongs to the server, not the name - leaving it on would make
    // every record written below say play.example.com:25566.
    expect(tidyDomain('play.example.com:25566')).toBe('play.example.com')
  })
})

describe('whether a domain points at this server', () => {
  it('says so when it does', async () => {
    asA(['203.0.113.7'])
    noSrv()

    const result = await checkDomain('play.example.com', '203.0.113.7', 25566)

    expect(result.verdict).toBe('ok')
    expect(result.bare).toBe(false)
    expect(result.note).toContain('play.example.com:25566')
  })

  it('names the wrong address rather than saying it is broken', async () => {
    asA(['198.51.100.4'])
    noSrv()

    const result = await checkDomain('play.example.com', '203.0.113.7', 25566)

    expect(result.verdict).toBe('wrong-ip')
    expect(result.note).toContain('198.51.100.4')
    expect(result.note).toContain('203.0.113.7')
  })

  it('tells a record that does not exist from one that is wrong', async () => {
    vi.mocked(resolve4).mockRejectedValue(new Error('ENOTFOUND'))
    noSrv()

    const result = await checkDomain('play.example.com', '203.0.113.7', 25566)

    expect(result.verdict).toBe('not-found')
    expect(result.note).toContain('203.0.113.7')
  })

  it('accepts any of several addresses, because a domain may have more than one', async () => {
    asA(['198.51.100.4', '203.0.113.7'])
    noSrv()

    expect((await checkDomain('play.example.com', '203.0.113.7', 25566)).verdict).toBe('ok')
  })

  it('notices an SRV record, which is what drops the port', async () => {
    asA(['203.0.113.7'])
    vi.mocked(resolveSrv).mockResolvedValue([{ name: 'play.example.com', port: 25566, priority: 0, weight: 0 }])

    const result = await checkDomain('play.example.com', '203.0.113.7', 25566)

    expect(result.bare).toBe(true)
    expect(result.srv).toEqual({ target: 'play.example.com', port: 25566 })
    expect(result.note).toContain('just the name')
  })

  it('does not claim a mismatch when there is nothing to compare against', async () => {
    asA(['203.0.113.7'])
    noSrv()

    // No public IP means the router could not be asked - saying "wrong" here
    // would send somebody to edit a record that is perfectly correct.
    expect((await checkDomain('play.example.com', null, 25566)).verdict).toBe('no-public-ip')
  })
})

describe('what the launcher will accept as a domain', () => {
  const ok = (domain: string): boolean =>
    IpcRequestSchemas['host:setDomain'].safeParse({
      serverId: '2db55584-1555-46e9-8cdc-cd60f5b64347',
      domain
    }).success

  it('takes a hostname, and empty to go back to the IP', () => {
    expect(ok('play.example.com')).toBe(true)
    expect(ok('example.co.uk')).toBe(true)
    expect(ok('')).toBe(true)
  })

  it('refuses what is not one', () => {
    expect(ok('not a domain')).toBe(false)
    expect(ok('https://play.example.com')).toBe(false)
    expect(ok('play.example.com/path')).toBe(false)
    expect(ok('localhost')).toBe(false)
  })
})
