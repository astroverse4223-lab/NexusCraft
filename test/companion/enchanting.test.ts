import { describe, expect, it } from 'vitest'
import { TOOLS } from '../../src/main/companion/tools/sets/enchanting'

/**
 * Spending levels the player earned.
 *
 * Experience and lapis do not come back. The dangerous outcome is not a failed
 * enchant, it is a successful one on the wrong item or at a cost the player
 * could not afford — so the refusals are what these tests are about.
 */

const enchant = TOOLS.find((tool) => tool.schema.name === 'enchant_item')!
const repair = TOOLS.find((tool) => tool.schema.name === 'repair_item')!

function fakeBot(options: {
  items?: Array<{ name: string }>
  level?: number
  table?: boolean
  anvil?: boolean
  offers?: Array<{ level: number }>
} = {}) {
  const enchanted: number[] = []
  const combined: unknown[] = []
  const items = options.items ?? [{ name: 'diamond_pickaxe' }, { name: 'lapis_lazuli' }]

  return {
    enchanted,
    combined,
    bot: {
      experience: { level: options.level ?? 30 },
      inventory: { items: () => items },
      entity: { position: { x: 0, y: 0, z: 0, distanceTo: () => 1 } },
      // Enough of the pathfinder for goToBlock to be a no-op.
      pathfinder: {
        goto: async () => {},
        setGoal: () => {},
        setMovements: () => {},
        thinkTimeout: 0
      },
      findBlock: ({ matching }: { matching: (b: unknown) => boolean }) => {
        const table = { name: 'enchanting_table', position: { x: 1, y: 1, z: 1 } }
        const anvil = { name: 'anvil', position: { x: 1, y: 1, z: 1 } }
        if (options.table !== false && matching(table)) return table
        if (options.anvil !== false && matching(anvil)) return anvil
        return null
      },
      openEnchantmentTable: async () => ({
        enchantments: options.offers ?? [{ level: 5 }, { level: 12 }, { level: 30 }],
        putTargetItem: async () => {},
        putLapis: async () => {},
        takeTargetItem: async () => {},
        enchant: async (index: number) => void enchanted.push(index),
        close: () => {}
      }),
      openAnvil: async () => ({
        combine: async (a: unknown, b: unknown) => void combined.push([a, b]),
        close: () => {}
      })
    }
  }
}

function ctx(bot: unknown) {
  return {
    bot,
    mcData: {},
    goals: {
      GoalNear: class {},
      GoalBlock: class {},
      GoalLookAtBlock: class {},
      GoalGetToBlock: class {}
    },
    Movements: class {},
    owner: 'Error420s',
    log: () => {},
    addMemory: () => {},
    setGoal: () => {},
    signal: new AbortController().signal
  } as never
}

describe('enchant_item', () => {
  it('refuses without lapis rather than opening the table', async () => {
    const { bot, enchanted } = fakeBot({ items: [{ name: 'diamond_pickaxe' }] })
    expect(await enchant.execute(ctx(bot), { item: 'diamond_pickaxe' })).toMatch(/lapis/i)
    expect(enchanted).toHaveLength(0)
  })

  it('refuses when the item is not carried', async () => {
    const { bot } = fakeBot({ items: [{ name: 'lapis_lazuli' }] })
    expect(await enchant.execute(ctx(bot), { item: 'netherite_sword' })).toMatch(/do not have/i)
  })

  it('says how short the levels are instead of failing silently', async () => {
    const { bot, enchanted } = fakeBot({ level: 3 })
    const out = await enchant.execute(ctx(bot), { item: 'diamond_pickaxe' })
    expect(out).toMatch(/Not enough experience/)
    expect(out).toMatch(/level 5/)
    expect(enchanted).toHaveLength(0)
  })

  it('takes the best option the player can actually afford', async () => {
    // Level 12 affordable, 30 not — it must not reach for the strongest.
    const { bot, enchanted } = fakeBot({ level: 12 })
    await enchant.execute(ctx(bot), { item: 'diamond_pickaxe' })
    expect(enchanted).toEqual([1])
  })

  it('honours an explicit choice', async () => {
    const { bot, enchanted } = fakeBot({ level: 30 })
    await enchant.execute(ctx(bot), { item: 'diamond_pickaxe', slot: 0 })
    expect(enchanted).toEqual([0])
  })
})

describe('repair_item', () => {
  it('explains that a second copy is needed, rather than just refusing', async () => {
    const { bot, combined } = fakeBot({ items: [{ name: 'diamond_pickaxe' }] })
    const out = await repair.execute(ctx(bot), { item: 'diamond_pickaxe' })
    expect(out).toMatch(/two/i)
    expect(out).toMatch(/second one/i)
    expect(combined).toHaveLength(0)
  })

  it('combines two worn copies', async () => {
    const { bot, combined } = fakeBot({
      items: [{ name: 'diamond_pickaxe' }, { name: 'diamond_pickaxe' }]
    })
    await repair.execute(ctx(bot), { item: 'diamond_pickaxe' })
    expect(combined).toHaveLength(1)
  })
})
