/**
 * Going places.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { findTool } from '../registry'
import { ACTION_TIMEOUT_MS, BOAT_STEP_BLOCKS, BOAT_TICK_MS, BOAT_TRAVEL_MS, MINE_APPROACH_TIMEOUT_MS, MOVE_TO_PLACE_TIMEOUT_MS, REACH_BLOCKS, TRAVEL_ATTEMPTS, TRAVEL_TIMEOUT_MS } from '../constants'
import { BOAT_NAMES, leaveBoat, openWaterNear } from '../support/boats'
import type { Tool } from '../types'
import { equipBestTool } from '../support/equipment'
import { explainMissingPlayer, itemCounts, resolvePlayer, withTimeout } from '../support/players'
import { freeSpotsBeside, isReplaceable } from '../support/world'
import { goTo, goToBlock } from '../support/navigation'
import { getHome, rememberedHome, setHome } from '../support/home'
import { watchForDanger } from '../support/combat'
import { watchForDeath } from '../support/farming'

/** The way the bot last wandered, so a random explore does not double back. */
let lastHeading = ''

export const TOOLS: Tool[] = [
  {
    schema: {
      name: 'follow_player',
      description: 'Follow a player around continuously until told to stop.',
      parameters: {
        type: 'object',
        properties: { username: { type: 'string', description: 'Who to follow. Defaults to your owner.' } }
      }
    },
    execute: async (context, { username }) => {
      const target = resolvePlayer(context, username)
      if (!target) return explainMissingPlayer(context, username)
      const { bot, goals, Movements } = context
      bot.pathfinder.setMovements(new Movements(bot))
      // A dynamic goal keeps re-pathing as the player moves.
      bot.pathfinder.setGoal(new goals.GoalFollow(target, 2), true)
      return `now following ${target.username ?? 'them'}`
    }
  },

  {
    schema: {
      name: 'come_to_player',
      description: 'Walk to a player once and stop there. Use for "come here".',
      parameters: {
        type: 'object',
        properties: { username: { type: 'string', description: 'Who to walk to. Defaults to your owner.' } }
      }
    },
    execute: async (context, { username }) => {
      const target = resolvePlayer(context, username)
      if (!target) return explainMissingPlayer(context, username)

      const who = target.username ?? username ?? 'them'
      const start = context.bot.entity.position.distanceTo(target.position)
      let problem = ''

      /*
       * Keep going while ground is being covered. One travel budget is not
       * enough to cross a couple of hundred blocks, and the first version
       * simply stopped part-way and left it to the model to notice and ask
       * again — which it usually did not.
       */
      for (let attempt = 0; attempt < TRAVEL_ATTEMPTS; attempt++) {
        if (context.signal.aborted) break
        const before = context.bot.entity.position.distanceTo(target.position)
        if (before <= 3) break

        try {
          const p = target.position
          await goTo(context, p.x, p.y, p.z, 2, TRAVEL_TIMEOUT_MS)
          problem = ''
          break
        } catch (err) {
          problem = (err as Error).message
          const after = context.bot.entity.position.distanceTo(target.position)
          // No ground covered means the route is blocked, not merely long.
          if (before - after < 5) break
        }
      }

      const left = context.bot.entity.position.distanceTo(target.position)
      if (left <= 4) return `arrived next to ${who}`
      return `could not reach ${who}: ${problem || 'the path ran out'}. Closed ${Math.round(start - left)} blocks, still ${Math.round(left)} away.`
    }
  },

  {
    schema: {
      name: 'go_to',
      description: 'Walk to specific coordinates.',
      parameters: {
        type: 'object',
        properties: {
          x: { type: 'number' },
          y: { type: 'number' },
          z: { type: 'number' }
        },
        required: ['x', 'y', 'z']
      }
    },
    execute: async (context, { x, y, z }) => {
      await goTo(context, Number(x), Number(y), Number(z), 2)
      return `arrived at ${Math.round(Number(x))} ${Math.round(Number(y))} ${Math.round(Number(z))}`
    }
  },

  {
    schema: {
      name: 'explore',
      description:
        'Walk a set distance in a compass direction, or wander somewhere new. Use this for "go north", "look around over there", or exploring when there is no specific destination.',
      parameters: {
        type: 'object',
        properties: {
          direction: {
            type: 'string',
            description: 'north, south, east, west, or random',
            enum: ['north', 'south', 'east', 'west', 'random']
          },
          distance: { type: 'number', description: 'How many blocks to travel (max 128)' }
        },
        required: ['direction']
      }
    },
    execute: async (context, { direction, distance }) => {
      const { bot } = context
      const blocks = Math.max(4, Math.min(Number(distance) || 24, 128))

      // Minecraft's axes: north is -Z, south is +Z, east is +X, west is -X.
      const OFFSETS: Record<string, [number, number]> = {
        north: [0, -1],
        south: [0, 1],
        east: [1, 0],
        west: [-1, 0]
      }

      let heading = String(direction ?? 'random').toLowerCase()
      if (heading === 'random' || !OFFSETS[heading]) {
        /*
         * Deriving the direction from the bot's position looked deterministic
         * and tidy, but it made exploring oscillate: walk south, and the new
         * position points north, straight back to where it came from. Picking
         * at random while excluding the last heading actually covers ground.
         */
        /*
         * Rule out the way it came *and* the reverse. Excluding only the last
         * heading still let it alternate south-north-south forever, covering
         * no new ground at all.
         */
        const REVERSE: Record<string, string> = { north: 'south', south: 'north', east: 'west', west: 'east' }
        const options = Object.keys(OFFSETS).filter(
          (option) => option !== lastHeading && option !== REVERSE[lastHeading]
        )
        const choices = options.length > 0 ? options : Object.keys(OFFSETS)
        heading = choices[Math.floor(Math.random() * choices.length)]
      }
      lastHeading = heading

      const death = watchForDeath(bot)
      const danger = watchForDanger(bot)
      const [dx, dz] = OFFSETS[heading]
      const from = bot.entity.position
      const target = {
        x: Math.round(from.x + dx * blocks),
        y: Math.round(from.y),
        z: Math.round(from.z + dz * blocks)
      }

      try {
        await goTo(context, target.x, target.y, target.z, 3)
      } catch (err) {
        // Terrain often makes the exact spot unreachable; report how far it got.
        const now = bot.entity.position
        const moved = Math.round(Math.hypot(now.x - from.x, now.z - from.z))
        const killed = death.died()
        death.stop()
        if (killed) return `died while exploring ${heading}. Everything carried was dropped where it happened.`
        return `headed ${heading} but the path ran out after ${moved} blocks (${(err as Error).message})`
      }

      const now = bot.entity.position
      const wasKilled = death.died()
      death.stop()

      if (wasKilled) {
        return `died while exploring ${heading} — drowning or a fall, most likely. Everything carried was dropped where it happened.`
      }
      return `travelled ${heading} to ${Math.round(now.x)} ${Math.round(now.y)} ${Math.round(now.z)}`
    }
  },

  {
    schema: {
      name: 'stop_moving',
      description: 'Stop whatever movement is in progress and stand still.',
      parameters: { type: 'object', properties: {} }
    },
    execute: async ({ bot }) => {
      bot.pathfinder.setGoal(null)
      bot.clearControlStates()
      return 'stopped'
    }
  },

  {
    schema: {
      name: 'dig_down',
      description:
        'Dig down to a depth as a staircase you can walk back up, which is how you reach ores and caves. Stops on its own if it breaks into a cave, or if lava or water is below. Use a negative depth for deepslate levels.',
      parameters: {
        type: 'object',
        properties: {
          toY: { type: 'number', description: 'Height to stop at, e.g. 12 for diamonds or -20 for deepslate' },
          depth: { type: 'number', description: 'Or simply how many blocks to go down from here' }
        },
        required: []
      }
    },
    execute: async (context, { toY, depth }) => {
      const { bot, signal } = context
      const { Vec3 } = require('vec3')

      const start = Math.floor(bot.entity.position.y)

      /*
       * Take a height to stop at, or a number of blocks to go down.
       *
       * "Dig down 5" and "dig down to y 5" are both natural ways to ask, and
       * only one of them was understood. The other arrived as `undefined`,
       * became NaN, and quietly failed the loop's own condition — so the tool
       * reported "dug down 0 blocks" and looked broken while doing exactly what
       * it was told. A wrong argument should say so.
       */
      const asked = Number(toY ?? NaN)
      const relative = Number(depth ?? NaN)

      const wanted = Number.isFinite(asked)
        ? asked
        : Number.isFinite(relative)
          ? start - Math.abs(relative)
          : NaN

      if (!Number.isFinite(wanted)) {
        return 'dig_down needs either toY (a height to stop at) or depth (how many blocks to go down).'
      }

      const target = Math.max(-60, Math.min(wanted, 320))
      if (target >= start) return `already at y ${start}, which is at or below ${target}`

      let dug = 0
      let torchesLeft = bot.inventory.items().find((i: any) => i.name === 'torch')?.count ?? 0
      const death = watchForDeath(bot)
      const danger = watchForDanger(bot)

      /*
       * Descend as a staircase rather than a pit.
       *
       * A vertical shaft is a one-way trip: the bot dug sixty blocks down and
       * then could not climb out, spending minutes towering back up a 1x1 hole.
       * Stepping one block sideways every level leaves something walkable in
       * both directions, which is what a player would dig for the same reason.
       */
      const STEP = [
        { dx: 1, dz: 0 },
        { dx: 0, dz: 1 },
        { dx: -1, dz: 0 },
        { dx: 0, dz: -1 }
      ]
      let stepIndex = 0

      while (Math.floor(bot.entity.position.y) > target && !signal.aborted) {
        if (death.died()) {
          death.stop()
          danger.stop()
          return `died while digging, ${dug} blocks down. Everything carried is at the bottom of the shaft.`
        }
        if (danger.hurt()) {
          death.stop()
          danger.stop()
          return `stopped digging at y ${Math.floor(bot.entity.position.y)} — took ${danger.damage()} damage, now on ${Math.round(bot.health)}/20. Dug ${dug} blocks. Something is attacking, or that was a fall.`
        }
        const feet = bot.entity.position.floored()

        // Clear the step ahead so the staircase stays walkable.
        const step = STEP[stepIndex % STEP.length]
        for (const dy of [0, 1]) {
          const ahead = bot.blockAt(feet.offset(step.dx, dy, step.dz))
          if (ahead && ahead.boundingBox === 'block') {
            try {
              await equipBestTool(bot, ahead)
              await withTimeout(bot.dig(ahead), ACTION_TIMEOUT_MS, 'cutting the step')
            } catch {
              /* a step that will not cut is not fatal; the descent continues */
            }
          }
        }
        stepIndex++

        const below = bot.blockAt(feet.offset(0, -1, 0))
        if (!below) break

        /*
         * Digging blind into lava is the classic way to lose everything, and a
         * bot cannot see it coming. The block underfoot is checked before every
         * swing, along with the one below that, since a single layer of stone
         * over lava gives no warning at all.
         */
        const under = bot.blockAt(feet.offset(0, -2, 0))
        const hazard = [below, under].find(
          (b) => b && (b.name.includes('lava') || b.name.includes('water'))
        )
        if (hazard) {
          death.stop()
          danger.stop()
          return `stopped at y ${Math.floor(bot.entity.position.y)}: ${hazard.name} below. Dug ${dug} blocks.`
        }

        if (below.name === 'air' || below.name === 'cave_air') {
          /*
           * A single air block is a pocket, not a cave, and stopping for one
           * meant the tool almost never reached the depth it was asked for.
           * Three in a column is a space worth climbing down into.
           */
          const gap = [1, 2, 3].filter((d) => {
            const b = bot.blockAt(feet.offset(0, -1 - d, 0))
            return b && (b.name === 'air' || b.name === 'cave_air')
          }).length

          if (gap >= 2) {
            return `broke into open space at y ${Math.floor(bot.entity.position.y)} after ${dug} blocks — a cave, most likely`
          }

          // Drop through the pocket and carry on downwards.
          await new Promise((r) => setTimeout(r, 300))
          continue
        }

        if (below.boundingBox !== 'block') break

        try {
          await equipBestTool(bot, below)
          await withTimeout(bot.dig(below), ACTION_TIMEOUT_MS, 'digging down')
          dug++
        } catch (err) {
          return `stopped digging at y ${Math.floor(bot.entity.position.y)}: ${(err as Error).message}. Dug ${dug} blocks.`
        }

        /*
         * Wait to actually fall into the hole. Reading the position straight
         * after the swing gives the old one, so the block just dug looks like
         * open space underfoot and every dig reported "broke into a cave" after
         * exactly one block.
         */
        const wasAt = Math.floor(bot.entity.position.y)
        for (let tick = 0; tick < 20 && Math.floor(bot.entity.position.y) >= wasAt; tick++) {
          await new Promise((r) => setTimeout(r, 50))
        }

        // A torch every so often, so the shaft is not a mob spawner.
        if (dug % 8 === 0 && torchesLeft > 0) {
          const wall = bot.blockAt(feet.offset(1, 0, 0))
          if (wall && wall.boundingBox === 'block') {
            try {
              const torch = bot.inventory.items().find((i: any) => i.name === 'torch')
              if (torch) {
                await bot.equip(torch, 'hand')
                await bot.placeBlock(wall, new Vec3(-1, 0, 0))
                torchesLeft--
              }
            } catch {
              /* a torch that will not stick is not worth failing the dig over */
            }
          }
        }
      }

      death.stop()
      danger.stop()
      return `dug down ${dug} blocks to y ${Math.floor(bot.entity.position.y)}. Inventory: ${itemCounts(bot)}`
    }
  },

  {
    schema: {
      name: 'set_home',
      description:
        'Mark somewhere as home — a base, a shelter, wherever you keep things. Defaults to where you are standing. You can return to it later with go_home.',
      parameters: {
        type: 'object',
        properties: {
          x: { type: 'number', description: 'Position to mark; leave out for where you are' },
          y: { type: 'number' },
          z: { type: 'number' }
        }
      }
    },
    execute: async (context, { x, y, z }) => {
      const { bot } = context
      const here = bot.entity.position

      const wanted = {
        x: Math.round(x == null ? here.x : Number(x)),
        y: Math.round(y == null ? here.y : Number(y)),
        z: Math.round(z == null ? here.z : Number(z))
      }

      /*
       * Snap to solid ground. Recording the bot's exact position captured it
       * mid-fall — home ended up four blocks in the air, and every attempt to
       * return failed to plan a route to a place nothing can stand.
       */
      const { Vec3 } = require('vec3')
      let ground = wanted.y
      for (let dy = 0; dy >= -6; dy--) {
        const under = bot.blockAt(new Vec3(wanted.x, wanted.y + dy - 1, wanted.z))
        const at = bot.blockAt(new Vec3(wanted.x, wanted.y + dy, wanted.z))
        if (under && under.boundingBox === 'block' && at && isReplaceable(at)) {
          ground = wanted.y + dy
          break
        }
      }

      const home = { x: wanted.x, y: ground, z: wanted.z }

      setHome(home)
      // Written down as well, so it survives a restart.
      context.addMemory(`Home is at ${home.x} ${home.y} ${home.z}`)
      return `home is now ${home.x} ${home.y} ${home.z}`
    }
  },

  {
    schema: {
      name: 'go_home',
      description:
        'Travel back to the place marked as home. Useful when night falls, when hurt, or when carrying things worth storing.',
      parameters: { type: 'object', properties: {} }
    },
    execute: async (context, _args, memory) => {
      const { bot } = context

      const home = getHome() ?? rememberedHome(memory ?? [])
      if (!home) return 'no home set. Stand somewhere worth returning to and use set_home.'
      setHome(home)

      const start = bot.entity.position.distanceTo(new (require('vec3').Vec3)(home.x, home.y, home.z))
      if (start <= 4) return `already home, at ${home.x} ${home.y} ${home.z}`

      let problem = ''
      for (let attempt = 0; attempt < TRAVEL_ATTEMPTS; attempt++) {
        if (context.signal.aborted) break
        const before = bot.entity.position.distanceTo(new (require('vec3').Vec3)(home.x, home.y, home.z))
        if (before <= 4) break
        try {
          await goTo(context, home.x, home.y, home.z, 2, TRAVEL_TIMEOUT_MS)
          problem = ''
          break
        } catch (err) {
          problem = (err as Error).message
          const after = bot.entity.position.distanceTo(new (require('vec3').Vec3)(home.x, home.y, home.z))
          if (before - after < 5) break
        }
      }

      const left = bot.entity.position.distanceTo(new (require('vec3').Vec3)(home.x, home.y, home.z))
      if (left <= 4) return `home, at ${home.x} ${home.y} ${home.z}`
      return `could not get home: ${problem || 'the path ran out'}. Closed ${Math.round(start - left)} blocks, still ${Math.round(left)} away.`
    }
  },

  {
    schema: {
      name: 'travel_by_boat',
      description:
        'Cross water in a boat instead of bridging over it. Crafts a boat if needed, puts it on the water, gets in, steers to the destination and gets out. Give coordinates or a player to head towards.',
      parameters: {
        type: 'object',
        properties: {
          x: { type: 'number', description: 'Where to head for' },
          y: { type: 'number' },
          z: { type: 'number' },
          username: { type: 'string', description: 'Or head towards this player instead' }
        }
      }
    },
    execute: async (context, { x, y, z, username }) => {
      const { bot, signal } = context
      const { Vec3 } = require('vec3')

      /* ---- where are we going ----------------------------------------- */
      let destination: any = null
      if (x != null && z != null) {
        destination = new Vec3(Number(x), Number(y ?? bot.entity.position.y), Number(z))
      } else {
        const player = resolvePlayer(context, username)
        if (!player) return explainMissingPlayer(context, username)
        destination = player.position.clone()
      }

      /* ---- a boat to travel in ---------------------------------------- */
      let boatItem = bot.inventory.items().find((i: any) => BOAT_NAMES.test(i.name))
      if (!boatItem) {
        const result = await findTool('craft_item')!.execute(context, { item: 'oak_boat', count: 1 })
        context.log(`boat: ${result}`)
        boatItem = bot.inventory.items().find((i: any) => BOAT_NAMES.test(i.name))
        if (!boatItem) return `no boat, and could not make one: ${result}`
      }

      /* ---- water to put it on ----------------------------------------- */
      const candidates = openWaterNear(bot, 7)
      if (candidates.length === 0) {
        return 'no open water with room for a boat within reach — move to the edge of a wider stretch of water'
      }

      /** So a newly placed boat can be told from one that was already there. */
      const boatsAround = (): any[] =>
        (Object.values(bot.entities) as any[]).filter(
          (e) => e?.name && BOAT_NAMES.test(e.name) && e.position
        )

      const before = new Set(boatsAround().map((e) => e.id))

      /*
       * Put the boat in the water.
       *
       * Two things had to be right and both were wrong. `bot.placeEntity`
       * cannot be used here at all: it writes the `use_item` packet with only a
       * `hand` field, and since 1.21.3 that packet also carries `sequence` and
       * `rotation`, so it fails to serialise and never leaves the client. That
       * is why nothing whatsoever happened for so long — no rejection from the
       * server, because the server was never told. `activateItem` builds the
       * same packet properly.
       *
       * The aim then has to be right as well. Sighting at the top face of the
       * water does not work; the mark is just under the surface, along the line
       * of sight to water further out. Neither part is guessable from the API,
       * so each candidate is tried at a few depths and the first that takes it
       * wins.
       */
      let placed: any = null
      let tried = 0

      for (const { at } of candidates.slice(0, 4)) {
        if (placed || signal.aborted) break

        for (const depth of [0.85, 1.0, 0.6, 1.2]) {
          if (placed || signal.aborted) break
          tried++
          try {
            await bot.equip(boatItem, 'hand')
            await bot.lookAt(at.offset(0.5, depth, 0.5), true)
            await new Promise((r) => setTimeout(r, 200))
            bot.activateItem()
            await new Promise((r) => setTimeout(r, 400))
          } catch {
            continue
          }

          placed = boatsAround().find((e) => !before.has(e.id)) ?? null
        }
      }

      /* ---- get in ------------------------------------------------------ */
      const boat = placed
      if (!boat) {
        const nearest = candidates[0]
        return `could not launch the boat after ${tried} tries — the nearest open water is at ${nearest.at.x} ${nearest.at.y} ${nearest.at.z}, ${Math.round(
          nearest.distance
        )} blocks off. Move to a more open stretch and try again.`
      }

      try {
        if (bot.entity.position.distanceTo(boat.position) > 3) {
          await goTo(context, boat.position.x, boat.position.y, boat.position.z, 1, MOVE_TO_PLACE_TIMEOUT_MS)
        }
        // Getting in is a right click on the boat.
        bot.mount(boat)
        await new Promise((r) => setTimeout(r, 900))
      } catch (err) {
        return `could not get into the boat: ${(err as Error).message}`
      }

      if (!bot.vehicle) return 'got to the boat but could not get in'

      /* ---- steer ------------------------------------------------------- */
      /*
       * Row the boat ourselves.
       *
       * A boat is simulated by the client, which then tells the server where it
       * ended up with a `vehicle_move` packet. mineflayer has no boat physics
       * and never sends that packet, so every steering call it offers is heard
       * and ignored — measured against the boat's own position, holding forward
       * moved it 0.00 blocks every time, while stepping it along by hand moved
       * it nearly ten. The server is simply waiting to be told where the boat
       * went, which is exactly what a real client does.
       */
      let at = (bot.vehicle?.position ?? bot.entity.position).clone()
      const launchedFrom = at.clone()
      let beached = false

      const deadline = Date.now() + BOAT_TRAVEL_MS
      while (Date.now() < deadline && !signal.aborted) {
        const toGo = destination.minus(at)
        toGo.y = 0
        if (toGo.norm() <= 3) break

        const next = at.plus(toGo.normalize().scaled(BOAT_STEP_BLOCKS))
        const beneath = bot.blockAt(new Vec3(Math.floor(next.x), Math.floor(next.y), Math.floor(next.z)))

        // Stop at the shore rather than sailing the boat onto dry land.
        if (!beneath || !beneath.name.includes('water')) {
          beached = true
          break
        }
        at = next

        const yaw = Math.atan2(-toGo.x, -toGo.z)
        try {
          bot._client.write('vehicle_move', {
            x: at.x,
            y: at.y,
            z: at.z,
            yaw: (yaw * 180) / Math.PI,
            pitch: 0,
            onGround: false
          })
          // Paddling, so the boat is seen to be rowed rather than gliding.
          bot._client.write('steer_boat', { leftPaddle: true, rightPaddle: true })
        } catch (err) {
          return `the boat stopped answering: ${(err as Error).message}`
        }

        await new Promise((r) => setTimeout(r, BOAT_TICK_MS))
      }

      /*
       * Measure the boat, not the passenger. A rider's own position lags behind
       * the vehicle carrying it, so reading it here reported a crossing of some
       * fourteen blocks as "rowed 0 blocks".
       */
      const travelled = at.distanceTo(launchedFrom)
      const left = at.distanceTo(destination)

      const gotOut = await leaveBoat(bot)
      if (!gotOut) context.log('could not get out of the boat')

      if (beached && left > 6) {
        return `rowed ${Math.round(travelled)} blocks and reached the far bank, still ${Math.round(
          left
        )} short of the destination. Carry on over land from here.`
      }

      if (left <= 6) return `crossed by boat and arrived, ${Math.round(travelled)} blocks rowed`
      return `rowed ${Math.round(travelled)} blocks but stopped ${Math.round(
        left
      )} short — the water ran out or the way was blocked. Carry on over land, or launch again.`
    }
  },

  {
    schema: {
      name: 'sleep_in_bed',
      description:
        'Sleep through the night in a bed, which skips to morning and sets your respawn point. Places a bed from the inventory if there is not one nearby. Only works at night or during a thunderstorm.',
      parameters: { type: 'object', properties: {} }
    },
    execute: async (context) => {
      const { bot, mcData } = context

      if (bot.isSleeping) return 'already asleep'

      // Any colour of bed will do, and there are sixteen of them.
      const bedIds = Object.values(mcData.blocksByName as Record<string, { id: number; name: string }>)
        .filter((b) => b.name.endsWith('_bed'))
        .map((b) => b.id)

      let bed = bot.findBlock({ matching: bedIds, maxDistance: 16 })

      if (!bed) {
        const carried = bot.inventory.items().find((i: any) => i.name.endsWith('_bed'))
        if (!carried) {
          return `no bed nearby and none carried. Craft one from 3 wool and 3 planks. Carrying: ${itemCounts(bot)}`
        }

        /*
         * A bed occupies two blocks, so a spot with no free neighbour cannot
         * take one however clear it looks — the placement is simply refused.
         * Candidates are filtered for a companion space, then tried in turn,
         * because a single attempt failed often enough to look like a bug.
         */
        const { Vec3 } = require('vec3')
        const roomy = freeSpotsBeside(bot).filter((spot: any) =>
          [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)].some((d) => {
            const neighbour = bot.blockAt(spot.plus(d))
            const under = bot.blockAt(spot.plus(d).offset(0, -1, 0))
            return isReplaceable(neighbour) && under && under.boundingBox === 'block'
          })
        )

        if (roomy.length === 0) return 'no room beside me to put a bed down — a bed needs two blocks of space'

        let placed = ''
        for (const spot of roomy.slice(0, 4)) {
          placed = await findTool('place_block')!.execute(context, {
            block: carried.name,
            x: spot.x,
            y: spot.y,
            z: spot.z
          })
          context.log(`bed: ${placed}`)
          bed = bot.findBlock({ matching: bedIds, maxDistance: 16 })
          if (bed) break
        }
        if (!bed) return `could not put the bed down: ${placed}`
      }

      try {
        if (bot.entity.position.distanceTo(bed.position) > REACH_BLOCKS) {
          await goToBlock(context, bed.position.x, bed.position.y, bed.position.z, MINE_APPROACH_TIMEOUT_MS)
        }
        await bot.sleep(bed)
        return 'asleep — the night will pass and this bed is now the respawn point'
      } catch (err) {
        /*
         * Mineflayer's refusals are accurate but terse, and each one means
         * something different to do next: wait, fight, or move.
         */
        const message = (err as Error).message
        if (/not night|not.*storming/i.test(message)) return 'cannot sleep yet — it is not night'
        if (/monsters/i.test(message)) return 'cannot sleep: monsters nearby. Deal with them first, or wall the bed in.'
        if (/occupied/i.test(message)) return 'that bed is occupied'
        if (/too far/i.test(message)) return 'the bed is too far away to get into'
        return `could not sleep: ${message}`
      }
    }
  }
]
