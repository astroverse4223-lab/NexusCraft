/**
 * Crops and animals.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { ACTION_TIMEOUT_MS, MAX_ANIMAL_APPROACH_MS, MINE_APPROACH_TIMEOUT_MS, REACH_BLOCKS } from '../constants'
import { CROPS, TILLABLE, isRipe } from '../support/farming'
import type { Tool } from '../types'
import { collectDropsNear, goToBlock } from '../support/navigation'
import { isReplaceable } from '../support/world'
import { itemCounts, withTimeout } from '../support/players'

export const TOOLS: Tool[] = [
  {
    schema: {
      name: 'plant_crop',
      description:
        'Till ground and plant seeds to start a farm. Needs a hoe and seeds. Plant near water so the soil stays wet.',
      parameters: {
        type: 'object',
        properties: {
          seed: { type: 'string', description: 'Seed item, e.g. wheat_seeds, carrot, potato' },
          count: { type: 'number', description: 'How many to plant (max 32)' }
        },
        required: ['seed']
      }
    },
    execute: async (context, { seed, count }) => {
      const { bot, signal } = context
      const { Vec3 } = require('vec3')

      const name = String(seed ?? '').replace(/^minecraft:/, '')
      const crop = CROPS[name]
      if (!crop) {
        return `${name || 'that'} is not something you can plant. Try: ${Object.keys(CROPS).join(', ')}`
      }

      const seeds = bot.inventory.items().find((i: any) => i.name === name)
      if (!seeds) return `no ${name} to plant. Carrying: ${itemCounts(bot)}`

      const hoe = bot.inventory.items().find((i: any) => /_hoe$/.test(i.name))
      if (!hoe) return 'no hoe. Craft one from two sticks and two planks first — ground has to be tilled before anything grows.'

      const wanted = Math.max(1, Math.min(Number(count) || seeds.count, seeds.count, 32))
      const base = bot.entity.position.floored()

      let planted = 0
      let failure = ''

      // A compact patch around the bot rather than a long line, so the whole
      // thing stays within reach of one spot.
      for (let dx = -3; dx <= 3 && planted < wanted; dx++) {
        for (let dz = -3; dz <= 3 && planted < wanted; dz++) {
          if (signal.aborted) break

          /*
           * Look for the surface, do not assume it. Checking only the level one
           * block below the bot's feet meant any ground that was not perfectly
           * flat produced "no tillable ground within reach" while standing in a
           * field of grass.
           */
          let spot: any = null
          let ground: any = null
          for (const dy of [-1, -2, 0, -3]) {
            const candidate = base.offset(dx, dy, dz)
            const block = bot.blockAt(candidate)
            const over = bot.blockAt(candidate.offset(0, 1, 0))
            if (!block || !over) continue
            if (!isReplaceable(over)) continue
            if (!TILLABLE.has(block.name) && block.name !== 'farmland') continue
            spot = candidate
            ground = block
            break
          }
          if (!spot || !ground) continue

          try {
            if (ground.name !== 'farmland') {
              await bot.equip(hoe, 'hand')
              await bot.activateBlock(ground)
            }

            const tilled = bot.blockAt(spot)
            if (!tilled || tilled.name !== 'farmland') continue

            const carrying = bot.inventory.items().find((i: any) => i.name === name)
            if (!carrying) break
            await bot.equip(carrying, 'hand')
            await bot.placeBlock(tilled, new Vec3(0, 1, 0))
            planted++
          } catch (err) {
            failure = (err as Error).message
          }
        }
      }

      if (planted === 0) {
        return `could not plant any ${crop.label}${failure ? `: ${failure}` : ' — no tillable ground within reach'}`
      }
      return `planted ${planted}x ${crop.label}. They need light and water nearby, and time to grow.`
    }
  },

  {
    schema: {
      name: 'harvest_crop',
      description:
        'Harvest fully grown crops nearby and replant them, so the farm keeps producing. Leaves unripe crops alone.',
      parameters: {
        type: 'object',
        properties: {
          crop: { type: 'string', description: 'Crop block to harvest, e.g. wheat, carrots, potatoes' }
        }
      }
    },
    execute: async (context, { crop }) => {
      const { bot, mcData, signal } = context
      const { Vec3 } = require('vec3')

      const wanted = crop ? String(crop).replace(/^minecraft:/, '') : null
      const cropBlocks = wanted ? [wanted] : Object.values(CROPS).map((c) => c.block)

      const ids = cropBlocks.map((n) => mcData.blocksByName[n]?.id).filter((id) => id != null)
      if (ids.length === 0) return `${wanted} is not a crop I know about`

      const positions: any[] = bot.findBlocks({ matching: ids, maxDistance: 24, count: 128 })
      if (positions.length === 0) return 'no crops planted nearby'

      let harvested = 0
      let replanted = 0
      let unripe = 0

      for (const position of positions) {
        if (signal.aborted || harvested >= 64) break

        const block = bot.blockAt(position)
        if (!block) continue
        if (!isRipe(block)) {
          unripe++
          continue
        }

        try {
          if (bot.entity.position.distanceTo(position) > REACH_BLOCKS) {
            await goToBlock(context, position.x, position.y, position.z, MINE_APPROACH_TIMEOUT_MS)
          }
          await withTimeout(bot.dig(block), ACTION_TIMEOUT_MS, 'harvesting')
          harvested++

          // Pick the drops up before replanting, or the seed may not be to hand.
          await collectDropsNear(context, 4)

          // Replant so the farm is not a one-off.
          const seedName = Object.keys(CROPS).find((k) => CROPS[k].block === block.name)
          const seed = seedName ? bot.inventory.items().find((i: any) => i.name === seedName) : null
          const soil = bot.blockAt(position.offset(0, -1, 0))
          if (seed && soil && soil.name === 'farmland') {
            try {
              await bot.equip(seed, 'hand')
              await bot.placeBlock(soil, new Vec3(0, 1, 0))
              replanted++
            } catch {
              /* replanting is a bonus; the harvest still counts */
            }
          }
        } catch (err) {
          context.log(`could not harvest at ${position.x} ${position.y} ${position.z}: ${(err as Error).message}`)
        }
      }

      if (harvested === 0) {
        return unripe > 0
          ? `${unripe} crops nearby but none are ripe yet — leave them to grow`
          : 'nothing ready to harvest'
      }
      return `harvested ${harvested}, replanted ${replanted}${unripe > 0 ? `, left ${unripe} still growing` : ''}. Inventory: ${itemCounts(bot)}`
    }
  },

  {
    schema: {
      name: 'use_on_animal',
      description:
        'Use the held item on an animal, the way a player right-clicks it: shears on a sheep for wool, a bucket on a cow for milk, wheat or seeds to breed a pair, a saddle on a pig. Say which animal and what to hold.',
      parameters: {
        type: 'object',
        properties: {
          animal: { type: 'string', description: 'Animal to use it on, e.g. sheep, cow, pig' },
          item: { type: 'string', description: 'What to hold first, e.g. shears, bucket, wheat' },
          times: { type: 'number', description: 'How many separate animals to do this to (max 8)' }
        },
        required: ['animal']
      }
    },
    execute: async (context, { animal, item, times }) => {
      const { bot, signal } = context

      const wanted = String(animal ?? '').replace(/^minecraft:/, '')
      if (!wanted) return 'use_on_animal needs an animal name'

      if (item) {
        const name = String(item).replace(/^minecraft:/, '')
        const held = bot.inventory.items().find((i: any) => i.name === name)
        if (!held) return `no ${name} to use. Carrying: ${itemCounts(bot)}`
        try {
          await bot.equip(held, 'hand')
        } catch (err) {
          return `could not hold the ${name}: ${(err as Error).message}`
        }
      }

      const count = Math.max(1, Math.min(Number(times) || 1, 8))
      const done: string[] = []
      let failure = ''

      for (let i = 0; i < count; i++) {
        if (signal.aborted) break

        /*
         * Pick a different animal each time. Using the same one repeatedly is
         * pointless — a sheared sheep has no wool left, and breeding needs two
         * separate animals rather than one fed twice.
         */
        const target = (Object.values(bot.entities) as any[])
          .filter((e) => e.name === wanted && e.position && !done.includes(String(e.id)))
          .sort(
            (a, b) =>
              a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position)
          )[0]

        if (!target) {
          if (done.length === 0) return `no ${wanted} nearby`
          break
        }

        try {
          /*
           * Animals wander, so chase with a goal that follows them rather than
           * pathing to where one stood a moment ago — the same mistake that made
           * every fight end in "walking there took too long" without a blow.
           */
          if (bot.entity.position.distanceTo(target.position) > 3) {
            const { goals } = context
            bot.pathfinder.setGoal(new goals.GoalFollow(target, 2), true)

            /*
             * Budget by distance. A flat allowance meant the nearest sheep
             * being ninety blocks off failed every time, however reachable it
             * was — the same mistake as the fixed flight budget.
             */
            const away = bot.entity.position.distanceTo(target.position)
            const deadline = Date.now() + Math.min(MAX_ANIMAL_APPROACH_MS, away * 500 + 8_000)
            while (
              target.isValid &&
              Date.now() < deadline &&
              !signal.aborted &&
              bot.entity.position.distanceTo(target.position) > 3
            ) {
              await new Promise((r) => setTimeout(r, 250))
            }
            bot.pathfinder.setGoal(null)

            if (bot.entity.position.distanceTo(target.position) > 4) {
              failure = `could not get to the ${wanted} (still ${Math.round(bot.entity.position.distanceTo(target.position))} blocks away)`
              break
            }
          }

          await bot.lookAt(target.position.offset(0, target.height * 0.5, 0))
          await bot.useOn(target)
          done.push(String(target.id))

          /*
           * Pick up what it produced. Shearing drops wool on the floor, so
           * without this the bot sheared three sheep and walked away with
           * nothing — the action succeeded and the point of it was lost.
           */
          await new Promise((r) => setTimeout(r, 400))
          await collectDropsNear(context, 6)
        } catch (err) {
          bot.pathfinder.setGoal(null)
          failure = (err as Error).message
          break
        }
      }

      if (done.length === 0) {
        return `could not use anything on the ${wanted}${failure ? `: ${failure}` : ''}`
      }
      // "3 sheeps" is not a word; count first reads correctly for every animal.
      return `used it on ${done.length}x ${wanted}. Carrying: ${itemCounts(bot)}`
    }
  }
]
