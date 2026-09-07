import { describe, expect, it } from 'vitest'
import { loaderAccepts, versionSatisfies } from '../../src/main/services/mods/modMetadata'

/**
 * "Zombie Invade 100 Days" is a Forge 1.20.1 pack that ships Sinytra Connector,
 * Connector Extras and the Forgified Fabric API — the whole point of which is
 * running Fabric mods on Forge. The launcher refused to start it, calling
 * eleven of its mods fatal for being Fabric mods on a Forge instance.
 *
 * The same pack turned up a second fault: `movesubtitles` declares
 * ">=1.20 <=1.20.2" and was warned about on 1.20.1, which is plainly inside it.
 */
describe('Fabric mods on a Forge instance', () => {
  it('is fatal when nothing can load them', () => {
    expect(loaderAccepts('forge', ['fabric'])).toBe('no')
  })

  it('is fine when the pack ships Connector', () => {
    expect(loaderAccepts('forge', ['fabric'], true)).toBe('yes')
  })

  it('does not let Connector excuse an unrelated mismatch', () => {
    // Connector bridges Fabric to Forge, nothing else.
    expect(loaderAccepts('fabric', ['forge'], true)).toBe('no')
    expect(loaderAccepts('neoforge', ['fabric'], true)).toBe('no')
  })

  it('leaves the loaders that already matched alone', () => {
    expect(loaderAccepts('forge', ['forge'], true)).toBe('yes')
    expect(loaderAccepts('quilt', ['fabric'])).toBe('yes')
    expect(loaderAccepts('forge', ['neoforge'])).toBe('maybe')
  })
})

describe('version ranges with more than one clause', () => {
  it('accepts the range from the pack', () => {
    // movesubtitles: this is the exact string that produced the false warning.
    expect(versionSatisfies('1.20.1', '>=1.20 <=1.20.2')).toBe(true)
  })

  it('accepts the other shapes Fabric mods use', () => {
    expect(versionSatisfies('1.20.1', '>=1.20.1 <1.21')).toBe(true)
    expect(versionSatisfies('1.20.1', '>=1.20 <1.21')).toBe(true)
    expect(versionSatisfies('1.21.11', '>=1.21 <1.22')).toBe(true)
    expect(versionSatisfies('1.20.1', '>=1.20, <1.21')).toBe(true)
  })

  it('still rejects a version genuinely outside the range', () => {
    expect(versionSatisfies('1.21.0', '>=1.20 <=1.20.2')).toBe(false)
    expect(versionSatisfies('1.19.4', '>=1.20 <=1.20.2')).toBe(false)
    expect(versionSatisfies('1.21.0', '>=1.20 <1.21')).toBe(false)
  })

  it('has not broken the single-clause forms', () => {
    expect(versionSatisfies('1.20.1', '>=1.20')).toBe(true)
    expect(versionSatisfies('1.20.1', '<=1.20.2')).toBe(true)
    expect(versionSatisfies('1.20.1', '1.20.x')).toBe(true)
    expect(versionSatisfies('1.20.1', '*')).toBe(true)
    expect(versionSatisfies('1.19.2', '>=1.20')).toBe(false)
  })

  it('has not broken Maven ranges, whose comma is part of the syntax', () => {
    expect(versionSatisfies('1.20.1', '[1.20,1.20.2]')).toBe(true)
    expect(versionSatisfies('1.20.1', '[1.20,1.21)')).toBe(true)
    expect(versionSatisfies('1.21.0', '[1.20,1.21)')).toBe(false)
    expect(versionSatisfies('1.19.4', '[1.20,1.21)')).toBe(false)
  })
})
