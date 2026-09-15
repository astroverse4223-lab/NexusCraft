import { describe, expect, it } from 'vitest'
import { chooseInstance, serverVersions } from '../../src/shared/joinMatch'
import type { Instance, ServerStatus } from '../../src/shared/types'

/**
 * Picking the instance a server actually needs.
 *
 * Join used to launch whichever instance was selected on the Instances screen,
 * which is the last one played - so joining a 1.12.2 server after an evening
 * on 1.21 launched 1.21 at it and the connection was refused with nothing on
 * screen saying why.
 *
 * The failure to avoid is not "picks nothing". It is "picks confidently and
 * wrongly", because that is the one that looks like the server being broken.
 */

function instance(over: Partial<Instance> = {}): Instance {
  return {
    id: 'i1',
    name: 'One',
    minecraftVersion: '1.21.4',
    loader: 'vanilla',
    loaderVersion: null,
    resolvedVersionId: null,
    gameDir: '',
    java: {} as Instance['java'],
    window: {} as Instance['window'],
    iconColor: '#fff',
    notes: '',
    createdAt: 0,
    lastPlayedAt: null,
    totalPlaytimeMs: 0,
    ...over
  } as Instance
}

function status(versionName: string | null): ServerStatus {
  return {
    serverId: 's1',
    online: true,
    checkedAt: 0,
    latencyMs: 20,
    playersOnline: 1,
    playersMax: 20,
    versionName,
    protocol: null,
    motd: null,
    faviconDataUrl: null,
    error: null
  }
}

describe('working out what version a server is', () => {
  it('reads a plain version', () => {
    expect(serverVersions(status('1.12.2'), null)).toEqual(['1.12.2'])
  })

  it('finds the version inside the server software name', () => {
    // "Paper 1.20.1" and "Spigot 1.8.9" are both ordinary.
    expect(serverVersions(status('Paper 1.20.1'), null)).toEqual(['1.20.1'])
  })

  it('takes every version a proxy announces', () => {
    // A proxy in front of several backends says so, and any of them may fit.
    expect(serverVersions(status('1.8-1.21'), null)).toEqual(['1.8', '1.21'])
  })

  it('reads the newer numbering too', () => {
    expect(serverVersions(status('Paper 26.2'), null)).toEqual(['26.2'])
  })

  it('falls back to what the owner wrote down', () => {
    // A server that has never answered still has whatever was typed in.
    expect(serverVersions(null, '1.16.5')).toEqual(['1.16.5'])
  })

  it('finds nothing in a name that is only a name', () => {
    expect(serverVersions(status('Bob&apos;s Server'), null)).toEqual([])
  })
})

describe('choosing an instance', () => {
  it('uses the one the server names, above everything else', () => {
    const chosen = instance({ id: 'chosen', minecraftVersion: '1.7.10' })
    const fits = instance({ id: 'fits', minecraftVersion: '1.12.2' })

    const choice = chooseInstance(
      { preferredInstanceId: 'chosen', notedVersion: null },
      status('1.12.2'),
      [chosen, fits]
    )

    // An explicit choice is a decision already made; version matching does not
    // get to overrule it.
    expect(choice).toEqual({ kind: 'preferred', instance: chosen })
  })

  it('ignores a named instance that has since been deleted', () => {
    const fits = instance({ id: 'fits', minecraftVersion: '1.12.2' })

    const choice = chooseInstance(
      { preferredInstanceId: 'long-gone', notedVersion: null },
      status('1.12.2'),
      [fits]
    )

    expect(choice.kind).toBe('matched')
  })

  it('matches the version rather than whatever was played last', () => {
    /* The whole point. */
    const recent = instance({ id: 'recent', minecraftVersion: '1.21.4', lastPlayedAt: 999 })
    const right = instance({ id: 'right', minecraftVersion: '1.12.2', lastPlayedAt: 1 })

    const choice = chooseInstance({ preferredInstanceId: null, notedVersion: null }, status('1.12.2'), [
      recent,
      right
    ])

    expect(choice).toEqual({ kind: 'matched', instance: right, version: '1.12.2' })
  })

  it('prefers an exact version to a near one', () => {
    const near = instance({ id: 'near', minecraftVersion: '1.20.4' })
    const exact = instance({ id: 'exact', minecraftVersion: '1.20.1' })

    const choice = chooseInstance({ preferredInstanceId: null, notedVersion: null }, status('1.20.1'), [
      near,
      exact
    ])

    expect((choice as { instance: Instance }).instance.id).toBe('exact')
  })

  it('takes a near version when nothing matches outright', () => {
    // 1.20 and 1.20.1 talk to each other often enough to be worth trying.
    const near = instance({ id: 'near', minecraftVersion: '1.20.1' })

    const choice = chooseInstance({ preferredInstanceId: null, notedVersion: null }, status('1.20'), [near])

    expect(choice.kind).toBe('matched')
  })

  it('breaks a tie with whichever was played most recently', () => {
    const older = instance({ id: 'older', minecraftVersion: '1.12.2', lastPlayedAt: 10 })
    const newer = instance({ id: 'newer', minecraftVersion: '1.12.2', lastPlayedAt: 200 })

    const choice = chooseInstance({ preferredInstanceId: null, notedVersion: null }, status('1.12.2'), [
      older,
      newer
    ])

    expect((choice as { instance: Instance }).instance.id).toBe('newer')
  })

  it('says what is missing when nothing fits', () => {
    const wrong = instance({ minecraftVersion: '1.21.4' })

    const choice = chooseInstance({ preferredInstanceId: null, notedVersion: null }, status('1.12.2'), [
      wrong
    ])

    // Named, so the offer to make one can say which.
    expect(choice).toEqual({ kind: 'none', wanted: '1.12.2' })
  })

  it('will not guess when there are several and no version to go on', () => {
    /*
     * Two instances and nothing known about the server is exactly where the
     * old behaviour went wrong. Saying so is better than picking one.
     */
    const a = instance({ id: 'a', minecraftVersion: '1.21.4', lastPlayedAt: 900 })
    const b = instance({ id: 'b', minecraftVersion: '1.12.2' })

    const choice = chooseInstance({ preferredInstanceId: null, notedVersion: null }, status(null), [a, b])

    expect(choice).toEqual({ kind: 'none', wanted: null })
  })

  it('uses the only instance there is when nothing is known', () => {
    const only = instance({ id: 'only' })

    const choice = chooseInstance({ preferredInstanceId: null, notedVersion: null }, status(null), [only])

    expect(choice).toEqual({ kind: 'only', instance: only })
  })

  it('says none rather than only when there is nothing at all', () => {
    expect(chooseInstance({ preferredInstanceId: null, notedVersion: null }, status('1.12.2'), [])).toEqual({
      kind: 'none',
      wanted: '1.12.2'
    })
  })
})
