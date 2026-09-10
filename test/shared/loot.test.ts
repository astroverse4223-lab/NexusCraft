import { describe, expect, it } from 'vitest'
import { lootPool, readLoot, type LootDrop } from '../../src/shared/creations'

describe('readLoot', () => {
  it('keeps a rule that names a real item and a real table path', () => {
    const read = readLoot({
      name: 'Richer zombies',
      rules: [
        { id: 'zombie_emeralds', table: 'entities/zombie', drops: [
          { item: 'emerald', min: 1, max: 2, chance: 0.05 }
        ] }
      ]
    })

    expect(read).not.toBeNull()
    expect(read?.pack.rules).toHaveLength(1)
    expect(read?.pack.rules[0].drops[0]).toEqual({
      item: 'emerald',
      min: 1,
      max: 2,
      chance: 0.05
    })
  })

  /*
   * The table path becomes a file name inside the pack, so a rule that tries to
   * climb out of the folder has to be refused rather than tidied up.
   */
  it('refuses a table path that could escape the pack folder', () => {
    const read = readLoot({
      rules: [
        { id: 'bad', table: '../../../etc/passwd', drops: [{ item: 'emerald', chance: 1 }] },
        { id: 'ok', table: 'entities/zombie', drops: [{ item: 'emerald', chance: 1 }] }
      ]
    })

    expect(read?.pack.rules.map((r) => r.id)).toEqual(['ok'])
    expect(read?.dropped.join(' ')).toContain('bad')
  })

  it('drops an item the game does not have, and says so', () => {
    const read = readLoot({
      rules: [
        { id: 'made_up', table: 'entities/zombie', drops: [{ item: 'unobtainium', chance: 1 }] }
      ]
    })

    expect(read).toBeNull()
  })

  it('never lets min exceed max, whatever it was sent', () => {
    const read = readLoot({
      rules: [
        { id: 'backwards', table: 'entities/zombie', drops: [
          { item: 'emerald', min: 9, max: 2, chance: 1 }
        ] }
      ]
    })

    const drop = read?.pack.rules[0].drops[0] as LootDrop
    expect(drop.min).toBeLessThanOrEqual(drop.max)
  })

  it('clamps a chance above one rather than writing it out', () => {
    const read = readLoot({
      rules: [
        { id: 'certain', table: 'entities/zombie', drops: [
          { item: 'emerald', min: 1, max: 1, chance: 4 }
        ] }
      ]
    })

    expect(read?.pack.rules[0].drops[0].chance).toBe(1)
  })
})

describe('lootPool', () => {
  it('writes a chance condition only when it is not certain', () => {
    const sometimes = lootPool({ item: 'emerald', min: 1, max: 1, chance: 0.05 })
    const always = lootPool({ item: 'emerald', min: 1, max: 1, chance: 1 })

    expect(sometimes.conditions).toBeDefined()
    expect(always.conditions).toBeUndefined()
  })

  it('writes a count function only when more than one can drop', () => {
    const range = lootPool({ item: 'emerald', min: 1, max: 3, chance: 1 })
    const single = lootPool({ item: 'emerald', min: 1, max: 1, chance: 1 })

    const rangeEntry = (range.entries as Record<string, unknown>[])[0]
    const singleEntry = (single.entries as Record<string, unknown>[])[0]

    expect(rangeEntry.functions).toBeDefined()
    expect(singleEntry.functions).toBeUndefined()
  })

  it('names the item with its namespace, which the game requires', () => {
    const pool = lootPool({ item: 'emerald', min: 1, max: 1, chance: 1 })
    const entry = (pool.entries as Record<string, unknown>[])[0]

    expect(entry.name).toBe('minecraft:emerald')
  })
})
