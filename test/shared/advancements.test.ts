import { describe, expect, it } from 'vitest'
import { advancementJson, readAdvancements, rootJson } from '../../src/shared/advancements'

const one = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'slayer',
  title: 'Slayer',
  description: 'Kill the Gaoler',
  icon: 'diamond_sword',
  frame: 'challenge',
  trigger: 'kill',
  target: 'wither_skeleton',
  experience: 100,
  hidden: false,
  ...over
})

describe('readAdvancements', () => {
  it('keeps a well-formed one', () => {
    const read = readAdvancements({ name: 'Nexus', advancements: [one()] })

    expect(read?.pack.advancements).toHaveLength(1)
    expect(read?.pack.advancements[0].frame).toBe('challenge')
  })

  it('drops one whose icon is not an item', () => {
    expect(readAdvancements({ advancements: [one({ icon: 'unobtainium' })] })).toBeNull()
  })

  it('drops an obtain whose target is not an item', () => {
    const read = readAdvancements({
      advancements: [one({ trigger: 'obtain', target: 'moon_rock' }), one({ id: 'ok' })]
    })

    expect(read?.pack.advancements.map((a) => a.id)).toEqual(['ok'])
  })

  /*
   * Two files with one name would overwrite each other inside the pack, so the
   * second is refused rather than silently replacing the first.
   */
  it('refuses the same id twice', () => {
    const read = readAdvancements({ advancements: [one(), one({ title: 'Other' })] })

    expect(read?.pack.advancements).toHaveLength(1)
    expect(read?.dropped.join(' ')).toContain('twice')
  })

  it('falls back to a task frame when given nonsense', () => {
    const read = readAdvancements({ advancements: [one({ frame: 'sparkly' })] })
    expect(read?.pack.advancements[0].frame).toBe('task')
  })

  it('keeps experience within reach', () => {
    const read = readAdvancements({ advancements: [one({ experience: 999999 })] })
    expect(read?.pack.advancements[0].experience).toBeLessThanOrEqual(1000)
  })
})

describe('advancementJson', () => {
  const parse = (design: Record<string, unknown>): Record<string, unknown> => {
    const read = readAdvancements({ advancements: [one(design)] })
    return JSON.parse(advancementJson(read!.pack.advancements[0], 'nexus', 'root'))
  }

  /*
   * The spellings below are the ones Minecraft 26.2 actually uses, read out of
   * its own jar. Each of them changed at some point, and a pack using the old
   * one loads without complaint and never fires.
   */
  it('writes the icon as id, not item', () => {
    const body = parse({}) as { display: { icon: Record<string, unknown> } }

    expect(body.display.icon).toEqual({ id: 'minecraft:diamond_sword' })
    expect(body.display.icon.item).toBeUndefined()
  })

  it('writes a kill as an entity predicate', () => {
    const body = parse({ trigger: 'kill', target: 'blaze' }) as {
      criteria: Record<string, { trigger: string; conditions: { entity: unknown[] } }>
    }

    const criterion = Object.values(body.criteria)[0]
    expect(criterion.trigger).toBe('minecraft:player_killed_entity')
    expect(criterion.conditions.entity).toHaveLength(1)
  })

  it('writes an obtain with items inside items', () => {
    const body = parse({ trigger: 'obtain', target: 'diamond' }) as {
      criteria: Record<string, { trigger: string; conditions: { items: { items: string }[] } }>
    }

    const criterion = Object.values(body.criteria)[0]
    expect(criterion.trigger).toBe('minecraft:inventory_changed')
    expect(criterion.conditions.items[0].items).toBe('minecraft:diamond')
  })

  it('uses impossible for one only a command can grant', () => {
    const body = parse({ trigger: 'command' }) as {
      criteria: Record<string, { trigger: string }>
    }

    expect(Object.values(body.criteria)[0].trigger).toBe('minecraft:impossible')
  })

  it('names every criterion in requirements, or none of them count', () => {
    const body = parse({}) as { criteria: Record<string, unknown>; requirements: string[][] }

    expect(body.requirements).toEqual([Object.keys(body.criteria)])
  })

  it('hangs off the pack root rather than becoming its own tab', () => {
    const body = parse({}) as { parent: string }
    expect(body.parent).toBe('nexus:root')
  })

  it('leaves rewards out when there is no experience', () => {
    const body = parse({ experience: 0 }) as { rewards?: unknown }
    expect(body.rewards).toBeUndefined()
  })
})

describe('rootJson', () => {
  it('carries a background, which is what makes it a tab', () => {
    const body = JSON.parse(rootJson('Nexus', 'grass_block')) as {
      display: { background: string }
      parent?: string
    }

    expect(body.display.background).toContain('backgrounds')
    expect(body.parent).toBeUndefined()
  })
})
