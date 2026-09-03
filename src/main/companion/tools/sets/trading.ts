/**
 * Trading with villagers.
 *
 * A gap worth closing: the companion could mine, farm, fight, craft and build,
 * and could not buy a single thing. Villagers are how a survival world turns
 * effort into equipment — an emerald economy, mending books, a librarian worth
 * rerolling — and none of it was reachable.
 *
 * The shape here is look-then-act, in two tools rather than one. A single
 * "trade for X" would have to guess which villager and which offer, and guessing
 * with someone's emeralds is not a thing to do quietly. `villager_trades` shows
 * what is on offer; `trade_with_villager` takes an index the model has actually
 * seen.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Tool } from '../types'
import { goTo } from '../support/navigation'
import { withTimeout } from '../support/players'
import { ACTION_TIMEOUT_MS } from '../constants'

/** How far to look for someone to trade with. */
const SEARCH_RADIUS = 24

/** Villagers must be reachable; a trade needs the window open. */
const TRADE_RANGE = 3

function describeItem(item: any): string {
  if (!item) return ''
  const name = String(item.displayName ?? item.name ?? 'something').replace(/_/g, ' ')
  return `${item.count ?? 1} ${name}`
}

/**
 * One offer, as a line a model can act on.
 *
 * The index is first and explicit, because it is the only part the other tool
 * consumes and a model that has to count list positions gets it wrong.
 */
function describeTrade(trade: any, index: number): string {
  const cost = [describeItem(trade.inputItem1), describeItem(trade.inputItem2)]
    .filter(Boolean)
    .join(' + ')
  const left = Math.max(0, (trade.maximumNbTradeUses ?? 0) - (trade.nbTradeUses ?? 0))

  const notes: string[] = []
  if (trade.tradeDisabled) notes.push('out of stock')
  else if (left <= 2) notes.push(`only ${left} left today`)

  return `[${index}] ${cost} -> ${describeItem(trade.outputItem)}${
    notes.length ? ` (${notes.join(', ')})` : ''
  }`
}

function nearestVillager(bot: any): any {
  return bot.nearestEntity(
    (entity: any) =>
      (entity.name === 'villager' || entity.name === 'wandering_trader') &&
      entity.position.distanceTo(bot.entity.position) < SEARCH_RADIUS
  )
}

export const TOOLS: Tool[] = [
  {
    schema: {
      name: 'villager_trades',
      description:
        'Walk to the nearest villager and read out what it will trade. Always use this before trading, so you know the offer numbers.',
      parameters: { type: 'object', properties: {} }
    },
    execute: async (context) => {
      const { bot, signal } = context
      const villager = nearestVillager(bot)
      if (!villager) return `No villager within ${SEARCH_RADIUS} blocks.`

      if (villager.position.distanceTo(bot.entity.position) > TRADE_RANGE) {
        await goTo(context, villager.position.x, villager.position.y, villager.position.z, 2)
        if (signal.aborted) return 'Stopped on the way to the villager.'
      }

      let window: any
      try {
        window = await withTimeout(bot.openVillager(villager), ACTION_TIMEOUT_MS, 'opening the trade')
      } catch (err) {
        return `Could not trade with that villager: ${(err as Error).message}`
      }

      try {
        const trades: any[] = window.trades ?? []
        if (trades.length === 0) return 'That villager has nothing to offer — it has no profession yet.'

        const lines = trades.map((trade, index) => describeTrade(trade, index))
        return `That villager offers:\n${lines.join('\n')}`
      } finally {
        // Always close it. A window left open blocks every later interaction,
        // and the failure looks like the bot having frozen.
        try {
          window.close()
        } catch {
          /* already gone */
        }
      }
    }
  },

  {
    schema: {
      name: 'trade_with_villager',
      description:
        'Make a trade with the nearest villager, using an offer number from villager_trades. Check the offers first.',
      parameters: {
        type: 'object',
        properties: {
          offer: { type: 'number', description: 'The [n] number from villager_trades' },
          times: { type: 'number', description: 'How many times to repeat it (default 1)' }
        },
        required: ['offer']
      }
    },
    execute: async (context, { offer, times }) => {
      const { bot, signal } = context
      const index = Math.max(0, Math.floor(Number(offer) || 0))
      // Capped low on purpose: a model that reads "buy some" as 64 would empty
      // the player's emeralds in one call, and there is no undo for that.
      const count = Math.min(Math.max(Math.floor(Number(times) || 1), 1), 8)

      const villager = nearestVillager(bot)
      if (!villager) return `No villager within ${SEARCH_RADIUS} blocks.`

      if (villager.position.distanceTo(bot.entity.position) > TRADE_RANGE) {
        await goTo(context, villager.position.x, villager.position.y, villager.position.z, 2)
        if (signal.aborted) return 'Stopped on the way to the villager.'
      }

      let window: any
      try {
        window = await withTimeout(bot.openVillager(villager), ACTION_TIMEOUT_MS, 'opening the trade')
      } catch (err) {
        return `Could not trade with that villager: ${(err as Error).message}`
      }

      try {
        const trades: any[] = window.trades ?? []
        const trade = trades[index]
        if (!trade) return `There is no offer ${index}. It has ${trades.length} offer(s).`
        if (trade.tradeDisabled) return `Offer ${index} is out of stock for today.`

        const left = Math.max(1, (trade.maximumNbTradeUses ?? 1) - (trade.nbTradeUses ?? 0))
        const doing = Math.min(count, left)

        await withTimeout(bot.trade(window, index, doing), ACTION_TIMEOUT_MS * 2, 'trading')

        const got = describeItem(trade.outputItem)
        const paid = [describeItem(trade.inputItem1), describeItem(trade.inputItem2)]
          .filter(Boolean)
          .join(' + ')
        return doing < count
          ? `Traded ${doing} time(s) for ${got} — that was all it had left today. Paid ${paid} each time.`
          : `Traded ${doing} time(s): ${paid} for ${got} each.`
      } catch (err) {
        // Nearly always "not enough of the input item"; say so plainly rather
        // than reporting a stack trace to a player.
        return `The trade did not go through: ${(err as Error).message}`
      } finally {
        try {
          window.close()
        } catch {
          /* already gone */
        }
      }
    }
  }
]
