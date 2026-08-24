/**
 * Moving items between the bot, the ground, players and containers.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { ARMOUR_SLOTS, armourRank, wearBestArmour, wornArmour } from '../support/equipment'
import { EDIBLE } from '../constants'
import type { Tool } from '../types'
import { findOrPlaceContainer, openContainerNearby } from '../support/containers'
import { goTo } from '../support/navigation'
import { isCreative } from '../support/world'
import { itemCounts, resolvePlayer, withTimeout } from '../support/players'

export const TOOLS: Tool[] = [
  {
    schema: {
      name: 'eat_food',
      description: 'Eat something from the inventory to restore hunger.',
      parameters: { type: 'object', properties: {} }
    },
    execute: async ({ bot }) => {
      const food = bot.inventory.items().find((i: any) => (bot.registry.foods as any)[i.type])
      if (!food) return 'no food in the inventory'
      try {
        await bot.equip(food, 'hand')
        await withTimeout(bot.consume(), 15_000, 'eating')
        return `ate ${food.name}, food now ${Math.round(bot.food)}/20`
      } catch (err) {
        return `could not eat: ${(err as Error).message}`
      }
    }
  },

  {
    schema: {
      name: 'give_to_player',
      description: 'Throw items to a player so they can pick them up.',
      parameters: {
        type: 'object',
        properties: {
          item: { type: 'string', description: 'Item name to give' },
          count: { type: 'number', description: 'How many' },
          username: { type: 'string', description: 'Who to give it to. Defaults to your owner.' }
        },
        required: ['item']
      }
    },
    execute: async (context, { item, count, username }) => {
      const { bot } = context
      const name = String(item ?? '').replace(/^minecraft:/, '')

      const stacks = bot.inventory.items().filter((i: any) => i.name === name)
      if (stacks.length === 0) return `no ${name} in the inventory. Carrying: ${itemCounts(bot)}`

      const target = resolvePlayer(context, username)
      if (target) {
        try {
          await goTo(context, target.position.x, target.position.y, target.position.z, 2)
          await bot.lookAt(target.position.offset(0, 1, 0))
        } catch {
          /* throw from where we stand if the walk fails */
        }
      }

      /*
       * Items sit in stacks of up to 64, so 67 cobblestone is two stacks. Tossing
       * from whichever stack matched first meant a request for 64 threw 3 — the
       * size of the partial stack — and silently kept the rest.
       */
      const total = stacks.reduce((sum: number, stack: any) => sum + stack.count, 0)
      const wanted = Math.max(1, Math.min(Number(count) || total, total))

      let thrown = 0
      try {
        for (const stack of stacks) {
          if (thrown >= wanted) break
          const take = Math.min(stack.count, wanted - thrown)
          if (take === stack.count) await bot.tossStack(stack)
          else await bot.toss(stack.type, null, take)
          thrown += take
        }
      } catch (err) {
        return `threw ${thrown}x ${name} before failing: ${(err as Error).message}`
      }

      const who = target ? ` to ${username ?? context.owner ?? 'you'}` : ''
      return `threw ${thrown}x ${name}${who}`
    }
  },

  {
    schema: {
      name: 'equip',
      description:
        'Hold an item from the inventory — a tool, weapon, or block. Mining and fighting use whatever is held, so equip before doing either.',
      parameters: {
        type: 'object',
        properties: {
          item: { type: 'string', description: 'Item name, e.g. iron_pickaxe or oak_planks' },
          destination: {
            type: 'string',
            description: 'Where to put it: hand, head, torso, legs, feet, or off-hand',
            enum: ['hand', 'head', 'torso', 'legs', 'feet', 'off-hand']
          }
        },
        required: ['item']
      }
    },
    execute: async ({ bot }, { item, destination }) => {
      const name = String(item ?? '').replace(/^minecraft:/, '')
      if (!name) return 'equip needs an item name'

      const found = bot.inventory.items().find((i: any) => i.name === name)
      if (!found) return `no ${name} in the inventory. Carrying: ${itemCounts(bot)}`

      const where = String(destination ?? 'hand')
      try {
        await bot.equip(found, where)
        return `holding ${name}${where === 'hand' ? '' : ` (${where})`}`
      } catch (err) {
        return `could not equip ${name}: ${(err as Error).message}`
      }
    }
  },

  {
    schema: {
      name: 'get_item',
      description:
        'Creative mode only: take an item straight from the creative inventory. Does nothing in survival, where items have to be gathered or crafted.',
      parameters: {
        type: 'object',
        properties: {
          item: { type: 'string', description: 'Item name, e.g. diamond_pickaxe or oak_planks' },
          count: { type: 'number', description: 'How many (max 64)' }
        },
        required: ['item']
      }
    },
    execute: async ({ bot, mcData }, { item, count }) => {
      if (!isCreative(bot)) {
        return 'get_item only works in creative mode. In survival, mine or craft it instead.'
      }

      const name = String(item ?? '').replace(/^minecraft:/, '')
      const itemType = mcData.itemsByName[name]
      if (!itemType) return `there is no item called "${name}"`

      const wanted = Math.max(1, Math.min(Number(count) || 1, 64))
      const slot = bot.inventory.firstEmptyInventorySlot()
      if (slot == null) return 'the inventory is full'

      try {
        // prismarine-item exports a factory taking the protocol version.
        const ItemClass = require('prismarine-item')(bot.version)
        await bot.creative.setInventorySlot(slot, new ItemClass(itemType.id, wanted))
        return `took ${wanted}x ${name} from the creative inventory. Carrying: ${itemCounts(bot)}`
      } catch (err) {
        return `could not take ${name}: ${(err as Error).message}`
      }
    }
  },

  {
    schema: {
      name: 'drop_item',
      description:
        'Throw items on the ground to free up space, or to leave something for another player to pick up. Omit count to drop the whole stack.',
      parameters: {
        type: 'object',
        properties: {
          item: { type: 'string', description: 'Item name, e.g. cobblestone' },
          count: { type: 'number', description: 'How many to drop; leave out to drop all of them' }
        },
        required: ['item']
      }
    },
    execute: async ({ bot }, { item, count }) => {
      const name = String(item ?? '').replace(/^minecraft:/, '')
      if (!name) return 'drop_item needs an item name'

      const matches = bot.inventory.items().filter((i: any) => i.name === name)
      if (matches.length === 0) return `no ${name} to drop. Carrying: ${itemCounts(bot)}`

      const total = matches.reduce((sum: number, i: any) => sum + i.count, 0)
      const wanted = count == null ? total : Math.max(1, Math.min(Number(count) || 1, total))

      let dropped = 0
      try {
        for (const stack of matches) {
          if (dropped >= wanted) break
          const take = Math.min(stack.count, wanted - dropped)
          // tossStack empties the slot; toss takes a specific amount from it.
          if (take === stack.count) await bot.tossStack(stack)
          else await bot.toss(stack.type, null, take)
          dropped += take
        }
      } catch (err) {
        return `dropped ${dropped}x ${name} before failing: ${(err as Error).message}`
      }

      return `dropped ${dropped}x ${name}. Carrying: ${itemCounts(bot)}`
    }
  },

  {
    schema: {
      name: 'equip_armor',
      description:
        'Put on the best armour you are carrying, in every slot. Do this before fighting or exploring anywhere dangerous — carrying armour protects nothing.',
      parameters: { type: 'object', properties: {} }
    },
    execute: async ({ bot }) => {
      const worn = await wearBestArmour(bot)
      const already = wornArmour(bot)

      if (worn.length === 0) {
        const carried = bot.inventory.items().filter((i: any) => armourRank(i.name) >= 0)
        if (carried.length > 0) return `already wearing the best armour carried: ${already.join(', ')}`
        if (already.length > 0) {
          const bare = ARMOUR_SLOTS.filter(
            (slot) => !already.some((piece) => piece.endsWith(slot.suffix))
          ).map((slot) => slot.label)
          return bare.length > 0
            ? `wearing ${already.join(', ')}; nothing carried for ${bare.join(', ')}`
            : `already in a full set: ${already.join(', ')}`
        }
        return `no armour, and none carried to put on. Carrying: ${itemCounts(bot)}`
      }

      return `put on ${worn.join(', ')}. Now wearing ${already.join(', ')}`
    }
  },

  {
    schema: {
      name: 'store_items',
      description:
        'Put items into a nearby chest or barrel, placing one from the inventory if there is none. Do this before anything risky — dying scatters everything you are carrying.',
      parameters: {
        type: 'object',
        properties: {
          item: { type: 'string', description: 'Item to store. Leave out to store everything except tools, weapons, armour and food.' },
          count: { type: 'number', description: 'How many; leave out for all of them' }
        }
      }
    },
    execute: async (context, { item, count }) => {
      const { bot } = context

      const { block, reason } = await findOrPlaceContainer(context, true)
      if (!block) return reason

      const name = item ? String(item).replace(/^minecraft:/, '') : null

      /*
       * Storing "everything" keeps what the bot needs to keep working. Handing
       * over its pickaxe and food along with the cobblestone would leave it
       * standing beside a full chest unable to do anything.
       */
      const KEEP = /_(pickaxe|axe|shovel|hoe|sword|helmet|chestplate|leggings|boots)$|^shears$|^torch$/
      const candidates = bot.inventory
        .items()
        .filter((i: any) => (name ? i.name === name : !KEEP.test(i.name) && !EDIBLE.test(i.name)))

      if (candidates.length === 0) {
        return name ? `no ${name} to store` : 'nothing worth storing — only tools, armour and food are carried'
      }

      let chest: any
      try {
        chest = await openContainerNearby(context, block)
      } catch (err) {
        return `could not open the chest: ${(err as Error).message}`
      }

      let stored = 0
      const kinds = new Set<string>()
      try {
        let left = count == null ? Infinity : Math.max(1, Number(count))
        for (const stack of candidates) {
          if (left <= 0) break
          const take = Math.min(stack.count, left)
          await chest.deposit(stack.type, null, take)
          stored += take
          kinds.add(stack.name)
          left -= take
        }
      } catch (err) {
        // A full chest is the usual cause, and it is worth saying so.
        chest.close()
        return stored > 0
          ? `stored ${stored} items then stopped: ${(err as Error).message}`
          : `could not store anything: ${(err as Error).message}`
      }

      chest.close()
      return `stored ${stored} items (${[...kinds].join(', ')}). Still carrying: ${itemCounts(bot)}`
    }
  },

  {
    schema: {
      name: 'take_items',
      description: 'Take items out of a nearby chest or barrel.',
      parameters: {
        type: 'object',
        properties: {
          item: { type: 'string', description: 'Item to take. Leave out to see what is inside.' },
          count: { type: 'number', description: 'How many; leave out for all of them' }
        }
      }
    },
    execute: async (context, { item, count }) => {
      const { bot } = context

      const { block, reason } = await findOrPlaceContainer(context, false)
      if (!block) return reason

      let chest: any
      try {
        chest = await openContainerNearby(context, block)
      } catch (err) {
        return `could not open the chest: ${(err as Error).message}`
      }

      const contents = chest.containerItems()
      if (contents.length === 0) {
        chest.close()
        return 'the chest is empty'
      }

      // No item named: report what is in there rather than guessing.
      if (!item) {
        const totals = new Map<string, number>()
        for (const i of contents) totals.set(i.name, (totals.get(i.name) ?? 0) + i.count)
        chest.close()
        return `the chest holds: ${[...totals].map(([n, c]) => `${c}x ${n}`).join(', ')}`
      }

      const name = String(item).replace(/^minecraft:/, '')
      const matching = contents.filter((i: any) => i.name === name)
      if (matching.length === 0) {
        const totals = new Map<string, number>()
        for (const i of contents) totals.set(i.name, (totals.get(i.name) ?? 0) + i.count)
        chest.close()
        return `no ${name} in there. It holds: ${[...totals].map(([n, c]) => `${c}x ${n}`).join(', ')}`
      }

      let taken = 0
      try {
        let left = count == null ? Infinity : Math.max(1, Number(count))
        for (const stack of matching) {
          if (left <= 0) break
          const grab = Math.min(stack.count, left)
          await chest.withdraw(stack.type, null, grab)
          taken += grab
          left -= grab
        }
      } catch (err) {
        chest.close()
        return taken > 0
          ? `took ${taken}x ${name} then stopped: ${(err as Error).message}`
          : `could not take ${name}: ${(err as Error).message}`
      }

      chest.close()
      return `took ${taken}x ${name}. Carrying: ${itemCounts(bot)}`
    }
  }
]
