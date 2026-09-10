import { describe, expect, it } from 'vitest'
import { ideaCount, ideasFor } from '../../src/shared/promptIdeas'
import type { Generator } from '../../src/shared/examples'

const KINDS: Generator[] = [
  'banner',
  'icon',
  'motd',
  'logo',
  'firework',
  'item',
  'recipes',
  'loot'
]

describe('prompt ideas', () => {
  it('has thousands of them for every generator', () => {
    for (const kind of KINDS) {
      expect(ideaCount(kind), `${kind} should have plenty`).toBeGreaterThan(1000)
    }
  })

  it('never leaves a slot unfilled', () => {
    for (const kind of KINDS) {
      for (const idea of ideasFor(kind, 40, 0)) {
        expect(idea, `${kind}: "${idea}"`).not.toMatch(/[{}]/)
        expect(idea.trim().length).toBeGreaterThan(8)
      }
    }
  })

  it('gives the number asked for', () => {
    for (const kind of KINDS) {
      expect(ideasFor(kind, 3, 0)).toHaveLength(3)
      expect(ideasFor(kind, 6, 17)).toHaveLength(6)
    }
  })

  /*
   * The point of the whole thing: pressing refresh has to keep producing new
   * ideas rather than cycling through five.
   */
  it('keeps finding new ones as you press refresh', () => {
    for (const kind of KINDS) {
      const seen = new Set<string>()

      for (let press = 0; press < 30; press++) {
        for (const idea of ideasFor(kind, 3, press * 3)) seen.add(idea)
      }

      // Thirty presses of three would be ninety if none ever repeated. Allow
      // some overlap, but it must be nothing like a list of five.
      expect(seen.size, `${kind} only produced ${seen.size}`).toBeGreaterThan(60)
    }
  })

  it('does not repeat within a single row', () => {
    for (const kind of KINDS) {
      for (let offset = 0; offset < 20; offset++) {
        const row = ideasFor(kind, 3, offset)
        expect(new Set(row).size).toBe(row.length)
      }
    }
  })

  it('is stable: the same offset gives the same ideas', () => {
    expect(ideasFor('banner', 3, 9)).toEqual(ideasFor('banner', 3, 9))
  })
})
