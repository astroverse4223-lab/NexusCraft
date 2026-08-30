import { describe, expect, it } from 'vitest'
import { rankInstancesForServer, versionsForProtocol } from '../../src/main/services/servers/joinMatch'
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
