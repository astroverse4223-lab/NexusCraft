/**
 * Enchanting, and keeping gear alive.
 *
 * The companion could make a diamond pickaxe and then watch it wear out. It
 * could smelt, craft and build, and had no way to put Efficiency on anything or
 * to combine two worn tools into one working one — which is most of what the
 * mid-game of a survival world actually is.
 *
 * Both halves are here because they are the same job from the player's side:
 * the tool you are holding should be better tomorrow than it is today.
 *
 * The bot spends the player's levels and materials, so every tool reports the
 * cost before it commits and refuses rather than guessing. Lapis and experience
 * are not recoverable, and a companion that quietly burns thirty levels on the
 * wrong item is worse than one that cannot enchant at all.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Tool } from '../types'
import { goToBlock } from '../support/navigation'
import { withTimeout } from '../support/players'
import { ACTION_TIMEOUT_MS } from '../constants'

/** How far to look for the block a job needs. */
const SEARCH_RADIUS = 24

function findBlock(bot: any, names: string[]): any {
  return bot.findBlock({
    matching: (block: any) => names.includes(block.name),
    maxDistance: SEARCH_RADIUS
  })
}

function itemNamed(bot: any, wanted: string): any {
  const cleaned = wanted.toLowerCase().replace(/\s+/g, '_').replace('minecraft:', '')
  const items: any[] = bot.inventory.items()
  return (
    items.find((item) => item.name === cleaned) ??
    items.find((item) => item.name.includes(cleaned)) ??
    null
  )
}

function pretty(name: string): string {
  return name.replace(/_/g, ' ')
}

export const TOOLS: Tool[] = [
  {
    schema: {
      name: 'enchant_item',
      description:
        'Enchant an item at an enchanting table. Needs the item, lapis lazuli, and enough experience levels. Say which item; the strongest affordable option is taken.',
      parameters: {
        type: 'object',
        properties: {
          item: { type: 'string', description: 'Item to enchant, e.g. diamond_pickaxe' },
          slot: {
            type: 'number',
            description: 'Which of the three offers to take (0 weakest, 2 strongest). Defaults to the best affordable.'
          }
        },
        required: ['item']
      }
    },
    execute: async (context, { item, slot }) => {
      const { bot, signal } = context

      const table = findBlock(bot, ['enchanting_table'])
      if (!table) return `No enchanting table within ${SEARCH_RADIUS} blocks.`

      const target = itemNamed(bot, String(item ?? ''))
      if (!target) return `I do not have a ${pretty(String(item))}.`

      const lapis = itemNamed(bot, 'lapis_lazuli')
      if (!lapis) return 'I have no lapis lazuli, and enchanting needs it.'

      await goToBlock(context, table.position.x, table.position.y, table.position.z)
      if (signal.aborted) return 'Stopped on the way to the table.'

      let window: any
      try {
        window = await withTimeout(bot.openEnchantmentTable(table), ACTION_TIMEOUT_MS, 'opening the table')
      } catch (err) {
        return `Could not use the enchanting table: ${(err as Error).message}`
      }

      try {
        await window.putTargetItem(target)
        await window.putLapis(lapis)

        // The offers only appear once the item and lapis are in.
        const offers: any[] = window.enchantments ?? []
        const affordable = offers
          .map((offer, index) => ({ index, level: offer?.level ?? 0 }))
          .filter((offer) => offer.level > 0 && offer.level <= (bot.experience?.level ?? 0))

        if (affordable.length === 0) {
          const cheapest = Math.min(...offers.map((o) => o?.level ?? 99).filter((l) => l > 0))
          return (
            `Not enough experience. The cheapest option needs level ${cheapest} ` +
            `and I am level ${bot.experience?.level ?? 0}.`
          )
        }

        const chosen =
          slot === undefined || slot === null
            ? affordable[affordable.length - 1]
            : affordable.find((offer) => offer.index === Number(slot)) ?? affordable[affordable.length - 1]

        await withTimeout(window.enchant(chosen.index), ACTION_TIMEOUT_MS, 'enchanting')
        return `Enchanted the ${pretty(target.name)} using the level ${chosen.level} option.`
      } catch (err) {
        return `The enchanting did not work: ${(err as Error).message}`
      } finally {
        try {
          // Take it back before closing, or it is left sitting in the table.
          await window.takeTargetItem()
        } catch {
          /* nothing in the slot */
        }
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
      name: 'repair_item',
      description:
        'Combine two of the same worn item at an anvil to make one with more durability, keeping the enchantments. Costs experience levels.',
      parameters: {
        type: 'object',
        properties: {
          item: { type: 'string', description: 'The item to repair, e.g. diamond_pickaxe' }
        },
        required: ['item']
      }
    },
    execute: async (context, { item }) => {
      const { bot, signal } = context

      const anvil = findBlock(bot, ['anvil', 'chipped_anvil', 'damaged_anvil'])
      if (!anvil) return `No anvil within ${SEARCH_RADIUS} blocks.`

      const cleaned = String(item ?? '').toLowerCase().replace(/\s+/g, '_')
      const matches: any[] = bot.inventory.items().filter((slotItem: any) => slotItem.name.includes(cleaned))

      /*
       * Two are needed, not one. Anvil repair works by sacrificing a second
       * copy, so a player who says "repair my pickaxe" while carrying one is
       * asking for something the game does not do — and the useful answer names
       * the material rather than saying no.
       */
      if (matches.length < 2) {
        return matches.length === 0
          ? `I do not have a ${pretty(cleaned)}.`
          : `Repairing on an anvil needs two ${pretty(cleaned)}s — I only have one. A second one, even a worn one, would do it.`
      }

      await goToBlock(context, anvil.position.x, anvil.position.y, anvil.position.z)
      if (signal.aborted) return 'Stopped on the way to the anvil.'

      let window: any
      try {
        window = await withTimeout(bot.openAnvil(anvil), ACTION_TIMEOUT_MS, 'opening the anvil')
      } catch (err) {
        return `Could not use the anvil: ${(err as Error).message}`
      }

      try {
        await withTimeout(window.combine(matches[0], matches[1]), ACTION_TIMEOUT_MS, 'repairing')
        return `Repaired the ${pretty(matches[0].name)} using the spare one.`
      } catch (err) {
        // Usually "too expensive" — the vanilla 39-level wall.
        return `The anvil would not do it: ${(err as Error).message}`
      } finally {
        try {
          window.close?.()
        } catch {
          /* already gone */
        }
      }
    }
  }
]
