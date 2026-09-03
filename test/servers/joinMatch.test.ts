import { describe, expect, it } from 'vitest'
import { rankInstancesForServer, versionsForProtocol, versionsFromName } from '../../src/main/services/servers/joinMatch'
import type { Instance, LoaderId, ServerStatus } from '../../src/shared/types'

/**
 * Regression cover for the bug these exist because of: joining any public
 * server launched whichever instance happened to be selected, so a 1.21.1
 * Fabric pack was sent at every server regardless of what it spoke.
 */

function instance(name: string, minecraftVersion: string, loader: LoaderId = 'vanilla'): Instance {
  return {
    id: name,
    name,
    minecraftVersion,
    loader,
    loaderVersion: loader === 'vanilla' ? null : '0.16.0',
    resolvedVersionId: minecraftVersion,
    gameDir: `/instances/${name}`,
    java: { javaPath: null, minRamMb: 1024, maxRamMb: 4096, jvmArgs: '' },
    window: { width: 854, height: 480, fullscreen: false },
    iconColor: '#fff',
    notes: '',
    createdAt: 0,
    lastPlayedAt: null,
    totalPlaytimeMs: 0,
    installed: true
  }
}

function status(protocol: number | null, versionName = 'Paper'): ServerStatus {
  return {
    serverId: 'test',
    online: true,
    checkedAt: Date.now(),
    latencyMs: 20,
    playersOnline: 1,
    playersMax: 20,
    versionName,
    protocol,
    motd: null,
    faviconDataUrl: null,
    error: null
  }
}

describe('versionsForProtocol', () => {
  it('maps 767 to the 1.21.1 / 1.21 pair', () => {
    const versions = versionsForProtocol(767)
    expect(versions).toContain('1.21.1')
    expect(versions).toContain('1.21')
  })

  it('maps 754 to 1.16.5', () => {
    expect(versionsForProtocol(754)).toContain('1.16.5')
  })

  it('returns nothing for a null protocol', () => {
    expect(versionsForProtocol(null)).toEqual([])
  })

  it('returns nothing for a protocol no release uses', () => {
    expect(versionsForProtocol(999_999)).toEqual([])
  })
})

describe('rankInstancesForServer', () => {
  it('picks the version the server speaks, not whatever was selected', () => {
    // The exact shape of the reported bug: a Fabric 1.21.1 pack sitting next to
    // a correct 1.16.5 instance, against a 1.16.5 server.
    const instances = [instance('Cobblemon', '1.21.1', 'fabric'), instance('Old vanilla', '1.16.5')]
    const { candidates } = rankInstancesForServer(status(754), instances)

    expect(candidates[0].instance.name).toBe('Old vanilla')
  })

  it('prefers vanilla over a modded pack on the same version', () => {
    const instances = [instance('Modded', '1.21.1', 'fabric'), instance('Plain', '1.21.1')]
    const { candidates } = rankInstancesForServer(status(767), instances)

    expect(candidates[0].instance.name).toBe('Plain')
    expect(candidates).toHaveLength(2)
  })

  it('still offers a modded instance when it is the only match', () => {
    const instances = [instance('Modded', '1.21.1', 'fabric')]
    const { candidates } = rankInstancesForServer(status(767), instances)

    expect(candidates).toHaveLength(1)
    expect(candidates[0].instance.name).toBe('Modded')
  })

  it('accepts a same-major version as a fallback, ranked below an exact match', () => {
    // 1.21.4 is not 1.21.1, but shares the 1.21 line, so it is offered last.
    const instances = [instance('Point four', '1.21.4'), instance('Exact', '1.21.1')]
    const { candidates } = rankInstancesForServer(status(767), instances)

    expect(candidates[0].instance.name).toBe('Exact')
    expect(candidates.map((c) => c.instance.name)).toContain('Point four')
  })

  it('returns no candidates when nothing is close, rather than guessing', () => {
    const instances = [instance('Cobblemon', '1.21.1', 'fabric')]
    const { candidates, serverVersions } = rankInstancesForServer(status(754), instances)

    expect(candidates).toEqual([])
    expect(serverVersions).toContain('1.16.5')
  })

  it('returns no candidates when the server reported no protocol', () => {
    const instances = [instance('Anything', '1.21.1')]
    expect(rankInstancesForServer(status(null), instances).candidates).toEqual([])
  })

  it('handles having no instances at all', () => {
    expect(rankInstancesForServer(status(767), []).candidates).toEqual([])
  })

  it('reports the versions the server speaks for the error message', () => {
    const { serverVersions } = rankInstancesForServer(status(767), [])
    expect(serverVersions).toContain('1.21.1')
  })
})


/**
 * Proxies. A large public server almost always sits behind Velocity or
 * BungeeCord, and those do not answer the protocol question — the launcher
 * pings with -1 meaning "any version" and Velocity echoes the -1 straight back.
 * DonutSMP is the case that surfaced this: real protocol -1, name
 * "Velocity 1.7.2-26.2", and every instance on the machine refused.
 */
describe('proxy version names', () => {
  it('reads a range and includes both ends', () => {
    const range = versionsFromName('Velocity 1.7.2-26.2')
    expect(range).toContain('26.2')
    expect(range).toContain('1.7.2')
    expect(range).toContain('1.21.1')
    // Newest first, so the first entry is the top of the range.
    expect(range[0]).toBe('26.2')
  })

  it('reads a single version as itself', () => {
    expect(versionsFromName('Paper 1.21.1')).toEqual(['1.21.1'])
  })

  it('ignores decoration around the numbers', () => {
    expect(versionsFromName('§f§fWe support: 1.20-1.21')).toContain('1.21')
  })

  it('gives nothing for a name with no version in it', () => {
    expect(versionsFromName('Requires MC')).toEqual([])
    expect(versionsFromName(null)).toEqual([])
  })

  it('matches instances against a proxy that reports protocol -1', () => {
    const status = {
      serverId: 'donut', online: true as const, checkedAt: Date.now(), latencyMs: 30,
      playersOnline: 27709, playersMax: 999999,
      versionName: 'Velocity 1.7.2-26.2', protocol: -1, motd: null, faviconDataUrl: null, error: null
    }
    const instances = [
      instance('Cobblemon', '1.21.1', 'fabric'),
      instance('TestWorlds', '1.21.11', 'fabric'),
      instance('Kings', '26.2')
    ]
    const { candidates } = rankInstancesForServer(status, instances)

    expect(candidates.length).toBe(3)
    // Vanilla at the newest end of the advertised range wins.
    expect(candidates[0].instance.name).toBe('Kings')
  })

  it('prefers the newest accepted version when several are vanilla', () => {
    const status = {
      serverId: 'donut', online: true as const, checkedAt: Date.now(), latencyMs: 30,
      playersOnline: 1, playersMax: 10,
      versionName: 'Velocity 1.7.2-26.2', protocol: -1, motd: null, faviconDataUrl: null, error: null
    }
    // Alphabetically "Ancient" sorts first; newness must beat that.
    const instances = [instance('Ancient', '1.8.9'), instance('Zebra', '1.21.1')]
    const { candidates } = rankInstancesForServer(status, instances)
    expect(candidates[0].instance.name).toBe('Zebra')
  })

  it('still refuses when the name names no version at all', () => {
    const status = {
      serverId: 'x', online: true as const, checkedAt: Date.now(), latencyMs: 1,
      playersOnline: 0, playersMax: 1,
      versionName: 'Some Proxy', protocol: -1, motd: null, faviconDataUrl: null, error: null
    }
    const { candidates, serverVersions } = rankInstancesForServer(status, [instance('Any', '1.21.1')])
    expect(serverVersions).toEqual([])
    expect(candidates).toEqual([])
  })
})
