import { describe, expect, it } from 'vitest'

import { packSummary } from '../../src/shared/resourcePacks'

/**
 * What the Built panel says a pack holds.
 *
 * It printed `contents.items` and labelled it "texture". A pack carrying 3,416
 * restyled textures and one cosmetic hat therefore announced itself as
 * "1 texture, 0 sounds", which reads as a build that quietly dropped
 * everything - and the zip beside it was correct the whole time.
 *
 * A summary that disagrees with the file is worse than no summary, because it
 * sends somebody looking for a bug that is not there.
 */

const contents = (over: Partial<Parameters<typeof packSummary>[0]> = {}): Parameters<typeof packSummary>[0] => ({
  textures: 0,
  items: 0,
  sounds: 0,
  panorama: false,
  logo: false,
  ...over
})

describe('what a built pack says it holds', () => {
  it('counts textures as textures', () => {
    expect(packSummary(contents({ textures: 3416 }))).toBe('3,416 textures')
  })

  it('does not let one item stand in for every texture', () => {
    // The exact shape of the bug: 3,416 textures and one hat.
    expect(packSummary(contents({ textures: 3416, items: 1 }))).toBe('3,416 textures, 1 item')
  })

  it('leaves out what is not there', () => {
    expect(packSummary(contents({ items: 2 }))).toBe('2 items')
  })

  it('names the menu pieces', () => {
    expect(packSummary(contents({ textures: 1, panorama: true, logo: true }))).toBe(
      '1 texture, a menu background, a logo'
    )
  })

  it('says singular for one of a thing', () => {
    expect(packSummary(contents({ textures: 1, items: 1, sounds: 1 }))).toBe('1 texture, 1 item, 1 sound')
  })

  it('has something to say about an empty pack', () => {
    expect(packSummary(contents())).toBe('nothing')
  })
})
