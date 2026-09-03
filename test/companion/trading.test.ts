import { describe, expect, it } from 'vitest'
import { TOOLS } from '../../src/main/companion/tools/sets/trading'

/**
 * Spending someone else's emeralds.
 *
 * The risk here is not that a trade fails — it is that one succeeds sixty-four
 * times because a model read "buy some books" as a large number. There is no
 * undo for an emptied villager, so the cap is the safety rail and is tested
 * rather than trusted.
 */

const list = TOOLS.find((tool) => tool.schema.name === 'villager_trades')!
const trade = TOOLS.find((tool) => tool.schema.name === 'trade_with_villager')!

/** A bot with one villager and a couple of offers. */
function fakeBot(options: { trades?: unknown[]; distance?: number; villager?: boolean } = {}) {
  const traded: Array<{ index: number; times: number }> = []
  const distance = options.distance ?? 1
  const entity = { name: 'villager', position: { distanceTo: () => distance, x: 0, y: 0, z: 0 } }

  return {
    traded,
    bot: {
      entity: { position: { distanceTo: () => distance, x: 0, y: 0, z: 0 } },
      nearestEntity: () => (options.villager === false ? null : entity),
      openVillager: async () => ({
        trades:
          options.trades ??
          [
            {
              inputItem1: { name: 'emerald', count: 5 },
              inputItem2: null,
              outputItem: { name: 'book', count: 1 },
              tradeDisabled: false,
              nbTradeUses: 0,
              maximumNbTradeUses: 12
            }
          ],
        close: () => {}
      }),
      trade: async (_w: unknown, index: number, times: number) => {
        traded.push({ index, times })
      }
    }
  }
}

function ctx(bot: unknown) {
  return {
    bot,
    mcData: {},
    goals: {},
    Movements: {},
    owner: 'Error420s',
    log: () => {},
    addMemory: () => {},
    setGoal: () => {},
    signal: new AbortController().signal
  } as never
}

describe('villager trading', () => {
  it('says so plainly when there is nobody to trade with', async () => {
    const { bot } = fakeBot({ villager: false })
    expect(await list.execute(ctx(bot), {})).toMatch(/No villager/)
  })

  it('lists offers with the numbers the other tool takes', async () => {
    const { bot } = fakeBot()
    const out = await list.execute(ctx(bot), {})
    expect(out).toContain('[0]')
    expect(out).toContain('emerald')
    expect(out).toContain('book')
  })

  it('flags an offer that is out of stock', async () => {
    const { bot } = fakeBot({
      trades: [
        {
          inputItem1: { name: 'emerald', count: 5 },
          outputItem: { name: 'book', count: 1 },
          tradeDisabled: true,
          nbTradeUses: 12,
          maximumNbTradeUses: 12
        }
      ]
    })
    expect(await list.execute(ctx(bot), {})).toMatch(/out of stock/)
  })

  it('caps how many times it will trade at once', async () => {
    const { bot, traded } = fakeBot()
    await trade.execute(ctx(bot), { offer: 0, times: 64 })
    // Eight, not sixty-four — there is no undo for spent emeralds.
    expect(traded[0].times).toBe(8)
  })

  it('never trades fewer than once for a valid request', async () => {
    const { bot, traded } = fakeBot()
    await trade.execute(ctx(bot), { offer: 0, times: 0 })
    expect(traded[0].times).toBe(1)
  })

  it('refuses an offer number that does not exist', async () => {
    const { bot, traded } = fakeBot()
    const out = await trade.execute(ctx(bot), { offer: 7 })
    expect(out).toMatch(/no offer 7/i)
    expect(traded).toHaveLength(0)
  })

  it('will not trade something the villager has run out of', async () => {
    const { bot, traded } = fakeBot({
      trades: [{ inputItem1: {}, outputItem: {}, tradeDisabled: true, nbTradeUses: 12, maximumNbTradeUses: 12 }]
    })
    expect(await trade.execute(ctx(bot), { offer: 0 })).toMatch(/out of stock/)
    expect(traded).toHaveLength(0)
  })

  it('trades only what is left when stock is short', async () => {
    const { bot, traded } = fakeBot({
      trades: [
        {
          inputItem1: { name: 'emerald', count: 5 },
          outputItem: { name: 'book', count: 1 },
          tradeDisabled: false,
          nbTradeUses: 10,
          maximumNbTradeUses: 12
        }
      ]
    })
    await trade.execute(ctx(bot), { offer: 0, times: 8 })
    expect(traded[0].times).toBe(2)
  })
})
