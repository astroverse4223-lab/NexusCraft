import { describe, expect, it } from 'vitest'
import { matchLibraryBlueprint } from '../../src/main/companion/build/library'

/**
 * Turning a request into a structure, or declining to.
 *
 * Observed: a companion said it would put up "a small welcome outpost/house",
 * then called the library with `well` and built one — a stone well with a
 * bucket — and reported success. Matching has to be forgiving enough to be
 * useful and strict enough to refuse a guess like that.
 */
describe('matching a request to a library structure', () => {
  it('takes an exact id', () => {
    const match = matchLibraryBlueprint('cottage')
    expect(match?.entry.id).toBe('cottage')
    expect(match?.exact).toBe(true)
  })

  it('ignores case and stray spaces', () => {
    expect(matchLibraryBlueprint('  Watchtower ')?.entry.id).toBe('watchtower')
  })

  it('reads a plain description', () => {
    expect(matchLibraryBlueprint('a small oak cottage')?.entry.id).toBe('cottage')
    expect(matchLibraryBlueprint('build me a stone watchtower')?.entry.id).toBe('watchtower')
  })

  it('finds the new houses by name', () => {
    expect(matchLibraryBlueprint('spruce a-frame')?.entry.id).toBe('a-frame')
    expect(matchLibraryBlueprint('modern villa')?.entry.id).toBe('villa')
    expect(matchLibraryBlueprint('brick townhouse')?.entry.id).toBe('townhouse')
    expect(matchLibraryBlueprint('a hut on stilts')?.entry.id).toBe('stilt-hut')
  })

  it('does not turn a house into a well', () => {
    // The actual failure. "welcome" must not reach `well`, and a house request
    // must never come back as a water feature.
    const match = matchLibraryBlueprint('a small welcome outpost/house near here')
    expect(match?.entry.id).not.toBe('well')
  })

  it('refuses a request that matches nothing in particular', () => {
    expect(matchLibraryBlueprint('something nice')).toBeNull()
    expect(matchLibraryBlueprint('')).toBeNull()
    expect(matchLibraryBlueprint('a big')).toBeNull()
  })

  it('still finds a well when a well is what was asked for', () => {
    expect(matchLibraryBlueprint('village well')?.entry.id).toBe('well')
    expect(matchLibraryBlueprint('well')?.entry.id).toBe('well')
  })

  it('marks an inexact match as inexact, so it can be reported', () => {
    const match = matchLibraryBlueprint('a small oak cottage')
    expect(match?.exact).toBe(false)
  })
})
