/**
 * Crafting tables and furnaces.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { findTool } from '../registry'
import { ACTION_TIMEOUT_MS, MINE_APPROACH_TIMEOUT_MS } from '../constants'
import type { Tool } from '../types'
import { chooseFuel, missingIngredients, supplyIngredients } from '../support/crafting'
import { collectDropsNear, goToBlock } from '../support/navigation'
import { equipBestTool } from '../support/equipment'
import { freeSpotBeside, freeSpotsBeside } from '../support/world'
import { itemCounts, withTimeout } from '../support/players'

export const TOOLS: Tool[] = [
  {
    schema: {
      name: 'craft_item',
      description: 'Craft an item. Works for hand crafting; for recipes needing a crafting table, one must be within reach.',
      parameters: {
        type: 'object',
        properties: {
          item: { type: 'string', description: 'Item name, e.g. stick or wooden_pickaxe' },
          count: { type: 'number', description: 'How many to craft' }
        },
        required: ['item']
      }
    },
    execute: async (context, { item, count }) => {
      const { bot, mcData } = context
      const name = String(item ?? '').replace(/^minecraft:/, '')
      const wanted = Math.max(1, Math.min(Number(count) || 1, 64))
      const itemType = mcData.itemsByName[name]
      if (!itemType) return `there is no item called "${name}"`

      let table = bot.findBlock({ matching: mcData.blocksByName.crafting_table?.id, maxDistance: 4 })

      /*
       * Walk to a table that already exists before making another one. Only
       * looking four blocks out meant the bot built a fresh table almost every
       * time it crafted somewhere new, and left every one of them standing —
       * the world ended up littered with abandoned crafting tables.
       */
      if (!table) {
        const nearby = bot.findBlock({ matching: mcData.blocksByName.crafting_table?.id, maxDistance: 24 })
        if (nearby) {
          try {
            await goToBlock(context, nearby.position.x, nearby.position.y, nearby.position.z, MINE_APPROACH_TIMEOUT_MS)
            table = bot.findBlock({ matching: mcData.blocksByName.crafting_table?.id, maxDistance: 4 })
            if (table) context.log('walked to a crafting table that was already there')
          } catch {
            /* out of reach; fall through to putting one down */
          }
        }
      }

      /*
       * Anything past sticks and planks needs a crafting table, and refusing
       * unless one already stood nearby left the bot unable to bootstrap: it
       * could not craft a pickaxe without a table, and never put down the table
       * it was carrying. If one is in the inventory, place it and carry on.
       */
      // Tracked so a table the bot put down can be taken away again.
      let placedTableHere: any = null

      if (!table) {
        let carried = bot.inventory.items().find((i: any) => i.name === 'crafting_table')

        /*
         * Make one if there are planks for it. Only ever placing a table it
         * already carried meant the bootstrap worked exactly once: after the
         * first table was put down somewhere and the bot walked away, every
         * later recipe failed asking for a table it was perfectly capable of
         * building.
         */
        if (!carried) {
          const tableType = mcData.itemsByName.crafting_table

          /*
           * Turn logs into planks first if that is what is missing.
           *
           * `recipesFor` only reports what the bag can build right now, so a bot
           * carrying four oak logs — four tables' worth of wood — was told there
           * was nothing to make a crafting table from, and the whole chain
           * stopped there.
           */
          let handRecipe = tableType ? bot.recipesFor(tableType.id, null, 1, null)?.[0] : null
          if (!handRecipe && tableType) {
            const made = await supplyIngredients(context, tableType, null, 2, 1)
            if (made.length > 0) {
              context.log(`made ${made.join(', ')} for a crafting table`)
              handRecipe = bot.recipesFor(tableType.id, null, 1, null)?.[0] ?? null
            }
          }

          if (handRecipe) {
            try {
              await withTimeout(bot.craft(handRecipe, 1, null), ACTION_TIMEOUT_MS, 'crafting a table')
              carried = bot.inventory.items().find((i: any) => i.name === 'crafting_table')
              context.log('crafted a crafting table to work at')
            } catch (err) {
              context.log(`could not craft a crafting table: ${(err as Error).message}`)
            }
          }
        }

        if (carried) {
          /*
           * Reuse place_block rather than hand-rolling the placement, and work
           * through every legal spot. A single attempt failed often enough —
           * usually a missed block update — that the bot regularly ended up
           * holding a table it could not put down.
           */
          const spots = freeSpotsBeside(bot)
          for (const spot of spots.slice(0, 4)) {
            const result = await findTool('place_block')!.execute(context, {
              block: 'crafting_table',
              x: spot.x,
              y: spot.y,
              z: spot.z
            })
            context.log(`crafting table: ${result}`)
            table = bot.findBlock({ matching: mcData.blocksByName.crafting_table?.id, maxDistance: 4 })
            if (table) {
              placedTableHere = table
              break
            }
          }
          if (!table && spots.length === 0) {
            context.log('no free spot beside the bot to put a crafting table')
          }
        }
      }

      let recipes = bot.recipesFor(itemType.id, null, 1, table ?? null)

      // Short of a part rather than incapable? Make the part.
      if (!recipes || recipes.length === 0) {
        /*
         * Work out how many runs of the recipe are wanted before making
         * anything, so the parts cover all of them rather than just the first.
         */
        const possible = bot.recipesAll(itemType.id, null, table ?? null)
        const yieldPerRun = Math.max(1, possible?.[0]?.result?.count ?? 1)
        const runs = Math.max(1, Math.ceil(wanted / yieldPerRun))

        const made = await supplyIngredients(context, itemType, table, 2, runs)
        if (made.length > 0) {
          context.log(`made ${made.join(', ')} first`)
          recipes = bot.recipesFor(itemType.id, null, 1, table ?? null)
        }
      }

      if (!recipes || recipes.length === 0) {
        return table
          ? `no recipe for ${name} with the materials on hand. Inventory: ${itemCounts(bot)}`
          : bot.inventory.items().some((i: any) => i.name === 'crafting_table')
            ? `${name} needs a crafting table, and I am carrying one but could not find anywhere to put it down. Move somewhere more open.`
            : `${name} needs a crafting table within 4 blocks, and there was nothing to make one from. Carrying: ${itemCounts(bot)}`
      }

      /*
       * `count` means how many items are wanted, not how many times to run the
       * recipe. One craft of torches yields four, so asking for eight torches
       * was running the recipe eight times and failing on ingredients — while
       * "4 planks" quietly produced twelve.
       */
      const perCraft = Math.max(1, recipes[0].result?.count ?? 1)
      const batches = Math.max(1, Math.ceil(wanted / perCraft))

      /*
       * Enough for one is not enough for the number asked for.
       *
       * The top-up above only runs when the recipe is flatly impossible, and
       * `recipesFor` answers as soon as a single one can be made. So asking for
       * two stone pickaxes with sticks for exactly one looked entirely possible,
       * skipped the top-up, and then failed on the second with "missing
       * ingredient" — having quietly made the first. What is short for the whole
       * job is worked out here and made before any of it starts.
       */
      if (batches > 1) {
        const short = missingIngredients(bot, recipes[0], batches)
        if (short.length > 0) {
          const made = await supplyIngredients(context, itemType, table, 2, batches)
          if (made.length > 0) {
            context.log(`made ${made.join(', ')} to cover all ${batches}`)
            recipes = bot.recipesFor(itemType.id, null, 1, table ?? null)
            if (!recipes || recipes.length === 0) {
              return `ran out of materials part way through ${name}. Inventory: ${itemCounts(bot)}`
            }
          }
        }
      }

      /*
       * One run at a time.
       *
       * Asking the library for four runs in a single call is all or nothing as
       * far as its error handling goes, but not as far as the inventory goes:
       * a request for sixteen torches made twelve, threw "missing ingredient"
       * on the last run, and was reported as a failure while a dozen torches
       * sat in the bag. Running them one at a time means a stumble part way
       * through costs only that run, and what actually got made is what gets
       * reported.
       */
      let done = 0
      let stumble = ''

      try {
        for (let run = 0; run < batches; run++) {
          const still = bot.recipesFor(itemType.id, null, 1, table ?? null)
          if (!still || still.length === 0) {
            stumble = 'ran out of materials'
            break
          }

          try {
            await withTimeout(bot.craft(still[0], 1, table ?? null), ACTION_TIMEOUT_MS, 'crafting')
            done++
            await new Promise((r) => setTimeout(r, 120))
          } catch (err) {
            stumble = (err as Error).message
            break
          }
        }

        if (done === 0) throw new Error(stumble || 'nothing could be made')
        // Let the inventory settle before reporting it: read immediately, the
        // counts come back stale and the message understates what was made.
        await new Promise((r) => setTimeout(r, 250))

        /*
         * Take back a table the bot put down for this job. Leaving it behind is
         * how the world filled up with abandoned crafting tables — and carrying
         * one means the next craft needs no wood at all.
         */
        if (placedTableHere) {
          try {
            const still = bot.blockAt(placedTableHere.position)
            if (still && still.name === 'crafting_table') {
              await equipBestTool(bot, still)
              await withTimeout(bot.dig(still), ACTION_TIMEOUT_MS, 'picking the table back up')
              await collectDropsNear(context, 4)
              context.log('picked the crafting table back up')
            }
          } catch (err) {
            context.log(`left the crafting table behind: ${(err as Error).message}`)
          }
        }

        const made = done * perCraft
        const shortfall = done < batches ? `, ${stumble || 'stopped early'} before the rest` : ''
        return `crafted ${made}x ${name}${shortfall}. Inventory: ${itemCounts(bot)}`
      } catch (err) {
        return `crafting ${name} failed: ${(err as Error).message}`
      }
    }
  },

  {
    schema: {
      name: 'smelt',
      description:
        'Smelt items in a furnace — raw iron into iron ingots, sand into glass, food into cooked food. Builds and places a furnace if there is not one nearby. Uses coal or charcoal as fuel, or wood if there is no coal.',
      parameters: {
        type: 'object',
        properties: {
          item: { type: 'string', description: 'What to smelt, e.g. raw_iron' },
          count: { type: 'number', description: 'How many to smelt' }
        },
        required: ['item']
      }
    },
    execute: async (context, { item, count }) => {
      const { bot, mcData } = context
      const name = String(item ?? '').replace(/^minecraft:/, '')
      if (!name) return 'smelt needs an item name'

      const input = bot.inventory.items().find((i: any) => i.name === name)
      if (!input) return `no ${name} to smelt. Carrying: ${itemCounts(bot)}`

      const wanted = Math.max(1, Math.min(Number(count) || input.count, input.count))

      // Coal first, then charcoal, then wood — the same order a player would use.
      const burning = chooseFuel(bot, wanted)
      if (!burning) return `nothing to burn as fuel. Carrying: ${itemCounts(bot)}`
      const fuel = burning.item

      // Say so up front rather than quietly smelting less than was asked for.
      const reachable = Math.min(wanted, burning.smelts)
      if (reachable < wanted) {
        context.log(`only enough ${fuel.name} to smelt ${reachable} of ${wanted}`)
      }

      let furnace = bot.findBlock({ matching: mcData.blocksByName.furnace?.id, maxDistance: 6 })

      // Build one if there is not a furnace to hand; eight cobblestone is cheap.
      if (!furnace) {
        let carried = bot.inventory.items().find((i: any) => i.name === 'furnace')
        if (!carried) {
          const result = await findTool('craft_item')!.execute(context, { item: 'furnace', count: 1 })
          context.log(`furnace: ${result}`)
          carried = bot.inventory.items().find((i: any) => i.name === 'furnace')
        }
        if (!carried) return `could not get a furnace. Carrying: ${itemCounts(bot)}`

        const spot = await freeSpotBeside(bot)
        if (!spot) return 'no free spot beside me to put a furnace'
        await findTool('place_block')!.execute(context, {
          block: 'furnace',
          x: spot.x,
          y: spot.y,
          z: spot.z
        })
        furnace = bot.findBlock({ matching: mcData.blocksByName.furnace?.id, maxDistance: 6 })
        if (!furnace) return 'placed a furnace but cannot find it again'
      }

      let opened: any
      try {
        opened = await bot.openFurnace(furnace)
      } catch (err) {
        return `could not use the furnace: ${(err as Error).message}`
      }

      try {
        await opened.putFuel(fuel.type, null, burning.use)
        await opened.putInput(input.type, null, Math.min(wanted, input.count))

        /*
         * Smelting takes ten seconds an item and the furnace reports progress
         * rather than completion, so the output is drained as it appears until
         * the expected count arrives or it stops making progress.
         */
        let taken = 0
        let idle = 0
        while (taken < reachable && idle < 12 && !context.signal.aborted) {
          await new Promise((r) => setTimeout(r, 2500))
          const output = opened.outputItem()
          if (output && output.count > 0) {
            await opened.takeOutput()
            taken += output.count
            idle = 0
          } else {
            idle++
          }
        }

        /*
         * Empty the furnace before walking away. Anything left in it — ore that
         * never got its turn, fuel that was not burned — is simply gone as far
         * as the bot is concerned, and it will happily mine more to replace it.
         */
        for (const recover of ['takeInput', 'takeFuel'] as const) {
          try {
            const still = recover === 'takeInput' ? opened.inputItem() : opened.fuelItem()
            if (still && still.count > 0) await opened[recover]()
          } catch {
            /* nothing of that kind left, which is the usual case */
          }
        }

        opened.close()
        if (taken === 0) return `the furnace produced nothing in the time allowed. Carrying: ${itemCounts(bot)}`
        const shortfall = wanted > reachable ? `, short of ${wanted} for want of fuel` : ''
        return `smelted ${taken}x ${name}${shortfall}. Inventory: ${itemCounts(bot)}`
      } catch (err) {
        try {
          opened.close()
        } catch {
          /* already closed */
        }
        return `smelting ${name} failed: ${(err as Error).message}`
      }
    }
  }
]
