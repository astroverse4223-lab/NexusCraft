/**
 * Breaking, placing and using blocks.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { MAX_MINE, MAX_UNREACHABLE, MINE_APPROACH_TIMEOUT_MS, MOVE_TO_PLACE_TIMEOUT_MS, REACH_BLOCKS, VERTICAL_PENALTY } from '../constants'
import type { Tool } from '../types'
import { canHarvest, isCreative, isReplaceable, standingSpotNear } from '../support/world'
import { collectDropsNear, goTo, goToBlock } from '../support/navigation'
import { digAllowanceMs, equipBestTool } from '../support/equipment'
import { itemCounts, withTimeout } from '../support/players'
import { nearbyThreats, watchForDanger } from '../support/combat'
import { watchForDeath } from '../support/farming'

export const TOOLS: Tool[] = [
  {
    schema: {
      name: 'mine_block',
      description: 'Find and mine a specific block type, repeating until the requested count is collected. Use exact Minecraft block names such as oak_log, stone, iron_ore.',
      parameters: {
        type: 'object',
        properties: {
          block: { type: 'string', description: 'Block name, e.g. oak_log' },
          count: { type: 'number', description: 'How many to mine (max 64)' }
        },
        required: ['block']
      }
    },
    execute: async (context, { block, count }) => {
      const { bot, mcData, signal } = context
      const name = String(block ?? '').replace(/^minecraft:/, '')
      const wanted = Math.max(1, Math.min(Number(count) || 1, MAX_MINE))

      if (!name) {
        return 'mine_block needs a block name, for example oak_log, stone, or iron_ore'
      }

      const blockType = mcData.blocksByName[name]
      if (!blockType) {
        // A bare rejection sends the model guessing; naming what is actually
        // underfoot lets it correct itself on the next step.
        const seen = new Set<string>()
        bot.findBlocks({ matching: () => true, maxDistance: 16, count: 60 }).forEach((position: any) => {
          const found = bot.blockAt(position)
          if (found && found.name !== 'air') seen.add(found.name)
        })
        const nearby = [...seen].slice(0, 12).join(', ')
        return `there is no block called "${name}"${nearby ? `. Blocks near you: ${nearby}` : ''}`
      }

      let mined = 0
      let failure = ''
      let used = ''
      let unreachable = 0

      /*
       * What the bag held before any of this, so an entirely fruitless job can
       * be told apart from a productive one.
       *
       * mineflayer breaks blocks optimistically: it plays the dig out locally
       * and reports success whatever the server makes of it. Where the server
       * refuses — spawn protection, a claim plugin, a locked region — it simply
       * puts the block back, silently, and the bot announces it mined six of
       * them while nothing dropped and the bag stayed empty. Watching what was
       * gained is the honest test, and unlike the block state it cannot be
       * fooled by the client's own optimism.
       */
      const heldAtStart = bot.inventory.items().reduce((total: number, item: any) => total + item.count, 0)

      /*
       * Work through a list of candidates rather than repeatedly asking for the
       * single nearest one. `findBlock` returns the same buried block every
       * time, and the old loop gave up entirely on the first pathing failure —
       * so one unreachable block underground aborted the whole job even with
       * plenty of reachable ones in sight.
       */
      /*
       * Prefer blocks at roughly the bot's own level.
       *
       * findBlocks sorts by straight-line distance, which rates a log ten
       * blocks up a cliff the same as one ten blocks along flat ground. The bot
       * spent its entire budget failing to climb to the three nearest trees
       * while a hundred reachable ones stood at its feet. Height difference
       * costs several times what horizontal distance does.
       */
      const here = bot.entity.position
      const found: any[] = bot.findBlocks({ matching: blockType.id, maxDistance: 48, count: 128 }).slice()

      /*
       * Distance from the bot, counting height as dearer than ground. Used to
       * choose where to start, because a log ten blocks up a cliff is nothing
       * like one ten blocks away on the flat.
       */
      const costFromBot = (p: any): number =>
        Math.hypot(p.x - here.x, p.z - here.z) + Math.abs(p.y - here.y) * VERTICAL_PENALTY

      const candidates = [...found].sort((a, b) => costFromBot(a) - costFromBot(b))
      const sawBlock = candidates.length > 0
      const death = watchForDeath(bot)
      const danger = watchForDanger(bot)

      /*
       * Finish what you start.
       *
       * Sorting purely by distance from the bot meant taking one log from six
       * different trees and walking between them — nobody mines like that. A
       * player fells one tree, then moves to the next; ore comes in veins and
       * is worked the same way. After each block, whatever is left is reordered
       * around the one just broken, so the cluster gets finished first.
       */
      const remaining = [...candidates]

      while (remaining.length > 0) {
        const position = remaining.shift() as any
        if (signal.aborted || mined >= wanted) break
        if (death.died()) {
          death.stop()
          danger.stop()
          return `died after mining ${mined}x ${name}. Everything carried was dropped where it happened — go back for it.`
        }
        if (danger.hurt()) {
          const threats = nearbyThreats(bot)
          death.stop()
          danger.stop()
          return `stopped mining — took ${danger.damage()} damage, now on ${Math.round(bot.health)}/20${
            threats.length ? ` (${threats.join(', ')})` : ''
          }. Mined ${mined}x ${name} first. Fight back, or get somewhere safe.`
        }
        // Repeated failures usually mean the whole seam is walled off; stop
        // rather than spending the timeout on each of a hundred candidates.
        if (unreachable >= MAX_UNREACHABLE) break

        const block = bot.blockAt(position)
        if (!block || block.name !== name) continue

        try {
          // Walking to a block already within arm's reach is a needless way to
          // fail, so only path when it is actually out of range.
          if (bot.entity.position.distanceTo(position) > REACH_BLOCKS) {
            await goToBlock(context, position.x, position.y, position.z, MINE_APPROACH_TIMEOUT_MS)
          }

          // The block may have changed while walking there.
          const still = bot.blockAt(position)
          if (!still || still.name !== name) continue

          // Hold the right tool first — digging with an empty hand is what made
          // gathering fail, not the finding or the walking.
          const tool = await equipBestTool(bot, still)
          if (tool && used !== tool) used = tool

          // Breaking it would destroy it for nothing; say so rather than
          // grinding through the whole job and returning empty-handed.
          if (!canHarvest(bot, still)) {
            death.stop()
            return `${name} needs a better tool — breaking it with what I am holding destroys it and drops nothing. Mined ${mined} so far.`
          }

          await withTimeout(bot.dig(still), digAllowanceMs(bot, still), 'digging')

          mined++
          unreachable = 0

          // Pull the rest of this tree or vein to the front of the queue.
          remaining.sort(
            (a, b) =>
              Math.hypot(a.x - position.x, a.y - position.y, a.z - position.z) -
              Math.hypot(b.x - position.x, b.y - position.y, b.z - position.z)
          )

          // Collect straight away rather than at the end: by then the bot has
          // wandered off and the drops are scattered behind it. This drop came
          // from the block just broken, so ownership is not in question.
          if (!isCreative(bot)) await collectDropsNear(context, 5, position, true)

          /*
           * Several blocks in with nothing to show for it means the digs are
           * not landing. Creative is exempt, where mining is meant to yield
           * nothing at all.
           */
          if (!isCreative(bot) && mined >= 4) {
            const heldNow = bot.inventory.items().reduce((total: number, item: any) => total + item.count, 0)
            if (heldNow <= heldAtStart) {
              death.stop()
              return (
                `something here will not let me break blocks. I have swung at ${mined}x ${name} and collected ` +
                'nothing at all, which usually means spawn protection or a claimed area — the server puts every ' +
                'block straight back. Try somewhere further from spawn.'
              )
            }
          }
        } catch (err) {
          failure = (err as Error).message
          unreachable++
          context.log(`could not mine the ${name} at ${position.x} ${position.y} ${position.z}: ${failure}`)
        }
      }

      death.stop()
      danger.stop()

      // A final sweep for anything that rolled out of reach mid-job.
      if (mined > 0 && !isCreative(bot)) await collectDropsNear(context, 12)

      if (mined === 0) {
        // Saying "there is none" when the problem was reaching it sends the
        // model off searching for something that is right in front of it.
        return sawBlock
          ? `found ${candidates.length}x ${name} nearby but could not reach any: ${failure || 'the path did not work out'}. If it is underground, dig down to it first.`
          : `could not find any ${name} within 48 blocks`
      }
      // Creative breaks blocks without dropping them, so an empty inventory
      // after a successful dig is the game working as intended, not a failure.
      const drops = isCreative(bot)
        ? 'creative mode, so nothing dropped'
        : `Inventory: ${itemCounts(bot)}`
      return `mined ${mined}x ${name}${used ? ` using ${used}` : ' by hand'}. ${drops}`
    }
  },

  {
    schema: {
      name: 'place_block',
      description:
        'Place a block from the inventory. Give x, y and z to build at specific coordinates — that is how you build walls, floors and shelters. Leave them out to place one at your feet.',
      parameters: {
        type: 'object',
        properties: {
          block: { type: 'string', description: 'Block name to place, e.g. oak_planks' },
          x: { type: 'number', description: 'Target position; omit to place beneath yourself' },
          y: { type: 'number' },
          z: { type: 'number' }
        },
        required: ['block']
      }
    },
    execute: async (context, { block, x, y, z }) => {
      const { bot } = context
      const name = String(block ?? '').replace(/^minecraft:/, '')
      const held = bot.inventory.items().find((i: any) => i.name === name)
      if (!held) return `no ${name} in the inventory. Carrying: ${itemCounts(bot)}`

      const { Vec3 } = require('vec3')

      // No coordinates: the old behaviour, placing at the bot's feet.
      if (x == null || y == null || z == null) {
        const below = bot.blockAt(bot.entity.position.offset(0, -1, 0))
        if (!below) return 'nothing to place against'
        try {
          await bot.equip(held, 'hand')
          await bot.placeBlock(below, new Vec3(0, 1, 0))
          return `placed ${name} at your feet`
        } catch (err) {
          return `could not place ${name}: ${(err as Error).message}`
        }
      }

      const target = new Vec3(Math.floor(Number(x)), Math.floor(Number(y)), Math.floor(Number(z)))
      const existing = bot.blockAt(target)
      /*
       * Grass, ferns, snow and leaf litter are replaceable — you place straight
       * into them, as any player does. Treating every non-air block as an
       * obstruction made most ground-level spots look occupied and blocked
       * building on any vegetated terrain.
       */
      if (existing && !isReplaceable(existing)) {
        return `${existing.name} is already at ${target.x} ${target.y} ${target.z}`
      }

      /*
       * Minecraft places blocks against the face of an existing one, so a
       * target in mid-air needs a solid neighbour to build off. Without this
       * the tool could only ever place at the bot's feet, which is why the
       * companion reported that building "was not cooperating".
       */
      const faces = [
        new Vec3(0, -1, 0),
        new Vec3(0, 1, 0),
        new Vec3(-1, 0, 0),
        new Vec3(1, 0, 0),
        new Vec3(0, 0, -1),
        new Vec3(0, 0, 1)
      ]

      let reference: any = null
      let face: any = null
      for (const offset of faces) {
        const neighbour = bot.blockAt(target.plus(offset))
        if (neighbour && neighbour.name !== 'air' && neighbour.boundingBox === 'block') {
          reference = neighbour
          // The face vector points from the neighbour back towards the target.
          face = new Vec3(-offset.x, -offset.y, -offset.z)
          break
        }
      }

      if (!reference) {
        return `nothing solid next to ${target.x} ${target.y} ${target.z} to build against — place a block beside it first`
      }

      /*
       * Blocks can only be placed within arm's reach, so close the distance —
       * but briefly. Using the full two-minute action timeout here meant a
       * single unreachable spot froze the bot for two minutes, and a build of
       * a few hundred blocks looked like it had hung after placing one.
       */
      if (bot.entity.position.distanceTo(target) > 4) {
        /*
         * Stand somewhere that actually exists. Approaching from a fixed offset
         * beside the target sounded safe but frequently aimed at a spot inside
         * the wall being built, so two thirds of a hut failed with "could not
         * get close enough" — the bot was pathing into solid stone.
         */
        const spot = standingSpotNear(bot, target)
        if (!spot) {
          return `nowhere to stand near ${target.x} ${target.y} ${target.z} to place ${name} from`
        }
        try {
          await goTo(context, spot.x, spot.y, spot.z, 2, MOVE_TO_PLACE_TIMEOUT_MS)
        } catch (err) {
          return `could not get close enough to place ${name}: ${(err as Error).message}`
        }
      }

      try {
        await bot.equip(held, 'hand')
        await bot.placeBlock(reference, face)
        return `placed ${name} at ${target.x} ${target.y} ${target.z}`
      } catch (err) {
        const message = (err as Error).message

        /*
         * The server occasionally does not send the block update mineflayer
         * waits for, even though the placement was fine. Treating that as a
         * failure left holes in otherwise complete builds, so it gets one
         * retry — and a check of what is actually there before retrying.
         */
        if (/blockUpdate.*did not fire/i.test(message)) {
          const landed = bot.blockAt(target)
          if (landed && landed.name === name) {
            return `placed ${name} at ${target.x} ${target.y} ${target.z}`
          }
          try {
            await bot.placeBlock(reference, face)
            return `placed ${name} at ${target.x} ${target.y} ${target.z} (needed a second try)`
          } catch {
            /* fall through to the report below */
          }
        }

        return `could not place ${name} at ${target.x} ${target.y} ${target.z}: ${message}`
      }
    }
  },

  {
    schema: {
      name: 'use_block',
      description:
        'Use a block the way a player right-clicks it: open or close a door, gate or trapdoor, flip a lever, press a button, or ring a bell. Give coordinates, or a block name to find the nearest one.',
      parameters: {
        type: 'object',
        properties: {
          block: { type: 'string', description: 'Block name to look for, e.g. oak_door or lever' },
          x: { type: 'number', description: 'Exact position instead of searching' },
          y: { type: 'number' },
          z: { type: 'number' }
        }
      }
    },
    execute: async (context, { block, x, y, z }) => {
      const { bot, mcData } = context
      const { Vec3 } = require('vec3')

      let target: any = null

      if (x != null && y != null && z != null) {
        target = bot.blockAt(new Vec3(Math.floor(Number(x)), Math.floor(Number(y)), Math.floor(Number(z))))
        if (!target) return `nothing loaded at ${x} ${y} ${z}`
      } else {
        const name = String(block ?? '').replace(/^minecraft:/, '')
        if (!name) return 'use_block needs a block name or coordinates'
        const type = mcData.blocksByName[name]
        if (!type) return `there is no block called "${name}"`
        target = bot.findBlock({ matching: type.id, maxDistance: 16 })
        if (!target) return `no ${name} within 16 blocks`
      }

      try {
        if (bot.entity.position.distanceTo(target.position) > REACH_BLOCKS) {
          await goToBlock(context, target.position.x, target.position.y, target.position.z, MINE_APPROACH_TIMEOUT_MS)
        }
        await bot.lookAt(target.position.offset(0.5, 0.5, 0.5))
        await bot.activateBlock(target)
        return `used the ${target.name} at ${target.position.x} ${target.position.y} ${target.position.z}`
      } catch (err) {
        return `could not use the ${target.name}: ${(err as Error).message}`
      }
    }
  },

  {
    schema: {
      name: 'collect_nearby_items',
      description: 'Walk over and pick up dropped items lying on the ground nearby.',
      parameters: { type: 'object', properties: {} }
    },
    execute: async (context) => {
      const collected = await collectDropsNear(context, 24)
      if (collected === 0) return 'no dropped items nearby'
      return `walked over ${collected} dropped item stacks. Inventory: ${itemCounts(context.bot)}`
    }
  }
]
