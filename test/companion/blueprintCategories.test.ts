import { describe, expect, it } from 'vitest'
import { BLUEPRINT_LIBRARY } from '../../src/main/companion/build/library'

/**
 * The Blueprints screen groups cards by `category`. A blueprint with no
 * category is not lost — it falls back to "Houses & buildings" — but a redstone
 * contraption filed under houses is exactly the clutter the sections exist to
 * remove, so the categories are checked here rather than by eye.
 */
describe('blueprint categories', () => {
  it('gives every entry a category', () => {
    const missing = BLUEPRINT_LIBRARY.filter((entry) => !entry.category).map((entry) => entry.id)
    expect(missing).toEqual([])
  })

  it('only uses categories the screen has a section for', () => {
    const sections = new Set(['building', 'redstone', 'farm'])
    const stray = BLUEPRINT_LIBRARY.filter((entry) => !sections.has(entry.category!)).map(
      (entry) => `${entry.id}: ${entry.category}`
    )
    expect(stray).toEqual([])
  })

  it('fills every section, so none renders empty', () => {
    for (const category of ['building', 'redstone', 'farm']) {
      const inSection = BLUEPRINT_LIBRARY.filter((entry) => entry.category === category)
      expect(inSection.length, `${category} is empty`).toBeGreaterThan(0)
    }
  })

  it('files the houses under buildings, which is what people look for', () => {
    const houses = ['cottage', 'a-frame', 'villa', 'townhouse', 'stilt-hut']
    for (const id of houses) {
      const entry = BLUEPRINT_LIBRARY.find((candidate) => candidate.id === id)
      expect(entry, `${id} is missing from the library`).toBeTruthy()
      expect(entry!.category, `${id} is filed wrong`).toBe('building')
    }
  })

  it('files the farms under farms', () => {
    const farms = ['sugar-farm', 'auto-smelter', 'item-sorter']
    for (const id of farms) {
      const entry = BLUEPRINT_LIBRARY.find((candidate) => candidate.id === id)
      expect(entry, `${id} is missing from the library`).toBeTruthy()
      expect(entry!.category, `${id} is filed wrong`).toBe('farm')
    }
  })
})
