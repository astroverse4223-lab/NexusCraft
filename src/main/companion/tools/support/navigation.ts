/**
 * Getting the bot from where it is to where it needs to be.
 *
 * This is the largest piece of the companion by some margin, and the one that
 * fails most often: pathfinding gives up, the bot gets wedged in a hole, flight
 * silently does nothing on a server that forbids it. Each of those has its own
 * recovery here rather than one generic retry.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ToolContext } from '../types'
import { ACTION_TIMEOUT_MS, FLIGHT_RETRY_AFTER_MS, FLIGHT_TIMEOUT_MS, LIQUID_COST, MAX_FLIGHT_FAILURES, PATH_THINK_TIMEOUT_MS, STUCK_MOVED_BLOCKS, STUCK_SAMPLE_MS } from '../constants'
import { nearbyPlayers, withTimeout } from './players'
import { isCreative, isReplaceable } from './world'
import { equipBestTool } from './equipment'
import { TOOL_ITEM } from '../constants'

/**
 * Consecutive creative-flight failures. Flight is only abandoned after several
 * in a row: giving up after a single one meant a momentary hiccup — a chunk not
 * loaded yet — permanently grounded the bot, and it then tried to *walk* up to
 * blocks it was placing, which cannot work.
 */
let flightFailures = 0
let flightPausedUntil = 0

/**
 * Walks a path, and notices when it is not actually getting anywhere.
 *
 * The pathfinder reports a route it is following, not whether the body is
 * moving, so a bot wedged against a block would stand perfectly still until the
 * action timed out two minutes later. From outside it looked frozen — the owner
 * had to break the offending block by hand before it would carry on.
 *
 * Progress is therefore watched directly. A bot that has not moved for a few
 * seconds is nudged with a jump, which clears the usual causes: a step it did
 * not commit to, a corner it clipped. If that fails it breaks whatever is
 * directly in front of it, which is the same thing a player does. Blocks are
 * only broken after jumping has failed twice, so ordinary travel never digs
 * through anything.
 */
export async function pathTo(
  context: ToolContext,
  goal: any,
  timeoutMs: number,
  what: string
): Promise<void> {
  const { bot, signal } = context

  const journey = bot.pathfinder.goto(goal)
  let finished = false
  // A second handle on the same promise, so nothing is left unhandled if the
  // path fails while the watchdog is still looking at it.
  void journey.then(
    () => {
      finished = true
    },
    () => {
      finished = true
    }
  )

  const watchdog = (async (): Promise<void> => {
    let last = bot.entity.position.clone()
    let stillFor = 0

    while (!finished && !signal.aborted) {
      await new Promise((r) => setTimeout(r, STUCK_SAMPLE_MS))
      if (finished) break

      const moved = bot.entity.position.distanceTo(last)
      last = bot.entity.position.clone()

      if (moved > STUCK_MOVED_BLOCKS) {
        stillFor = 0
        continue
      }

      stillFor++
      if (stillFor === 3 || stillFor === 6) {
        // A jump clears a step, a fence post, or a corner it clipped.
        bot.setControlState('jump', true)
        await new Promise((r) => setTimeout(r, 350))
        bot.setControlState('jump', false)
      } else if (stillFor >= 9) {
        const freed = await breakWhateverIsInTheWay(context)
        if (freed) {
          context.log(`broke ${freed} to get moving again`)
        } else {
          /*
           * Nothing in front means the trouble is not in front.
           *
           * Snagging half-way up a wall or a tower is the common case, and
           * there the obstruction is under the feet or over the head, so
           * looking straight ahead reports "nothing to break" over and over
           * while the bot stays exactly where it is. Going up and away is what
           * actually clears it.
           */
          const escaped = await escapeUpwards(context)
          context.log(escaped ? `climbed clear (${escaped})` : 'stuck, and nothing to break or climb')
        }
        stillFor = 0
      }
    }
  })()

  try {
    await withTimeout(journey, timeoutMs, what)
  } finally {
    finished = true

    /*
     * Call the walk off, not just the waiting for it.
     *
     * This is what left the bot shoving at a wall for minutes on end. A timeout
     * only abandons the promise; the pathfinder keeps its goal and carries on
     * driving the controls towards somewhere it cannot get to, forever. From
     * outside it is a bot walking on the spot, and breaking the block in its way
     * "fixes" it only because that finally lets the route complete.
     *
     * Proved by hand: the bot was jittering between two blocks with no tool of
     * ours running at all, and a single stop_moving — which does exactly this —
     * stilled it at once.
     */
    try {
      bot.pathfinder.setGoal(null)
    } catch {
      /* no goal to clear */
    }
    try {
      bot.clearControlStates()
    } catch {
      /* not moving anyway */
    }

    await watchdog.catch(() => {})
  }
}

/**
 * Gets clear of something the bot is snagged on vertically.
 *
 * In creative there is no reason to dig: rising a few blocks lifts it off
 * whatever it has caught on. Otherwise the block over its head is the one
 * pinning it, so that comes out and it jumps up onto the obstruction instead of
 * fighting it.
 */
export async function escapeUpwards(context: ToolContext): Promise<string | null> {
  const { bot } = context
  const { Vec3 } = require('vec3')

  if (isCreative(bot)) {
    try {
      await bot.creative.startFlying()
      const up = bot.entity.position.offset(0, 5, 0)
      const flight = bot.creative.flyTo(up)
      void flight.catch(() => {})
      for (let tick = 0; tick < 30; tick++) {
        if (bot.entity.position.distanceTo(up) <= 2) return 'flew up'
        await new Promise((r) => setTimeout(r, 100))
      }
      return bot.entity.position.y > up.y - 3 ? 'flew up' : null
    } catch {
      return null
    }
  }

  // Take the ceiling out, then step up onto whatever was blocking the way.
  const overhead = bot.blockAt(bot.entity.position.offset(0, 2, 0))
  if (overhead && !isReplaceable(overhead) && overhead.name !== 'bedrock') {
    try {
      await equipBestTool(bot, overhead)
      await withTimeout(bot.dig(overhead), 20_000, 'digging upwards')
      bot.setControlState('jump', true)
      await new Promise((r) => setTimeout(r, 400))
      bot.setControlState('jump', false)
      return `dug out ${overhead.name} above`
    } catch {
      return null
    }
  }

  // Nothing overhead: a jump with some forward momentum clears most ledges.
  bot.setControlState('jump', true)
  bot.setControlState('forward', true)
  await new Promise((r) => setTimeout(r, 600))
  bot.setControlState('jump', false)
  bot.setControlState('forward', false)
  return 'hopped forward'
}

/** Breaks the block the bot is walking into, at chest height then at its feet. */
export async function breakWhateverIsInTheWay(context: ToolContext): Promise<string | null> {
  const { bot } = context
  const { Vec3 } = require('vec3')

  const yaw = bot.entity.yaw
  const ahead = new Vec3(-Math.sin(yaw), 0, -Math.cos(yaw))
  const eye = bot.entity.position.offset(0, 1.0, 0)

  for (const height of [0, -1, 1]) {
    const at = eye.offset(ahead.x, height, ahead.z).floored()
    const block = bot.blockAt(at)
    if (!block || isReplaceable(block)) continue
    // Never dig into what cannot be dug, and never open a hole into a fluid.
    if (block.name.includes('water') || block.name.includes('lava')) continue
    if (block.hardness == null || block.name === 'bedrock') continue

    try {
      await equipBestTool(bot, block)
      await withTimeout(bot.dig(block), 20_000, 'clearing the way')
      return block.name
    } catch {
      /* try the next height */
    }
  }

  return null
}

/**
 * Walks to within reach of a specific block, so it can be broken.
 *
 * `GoalNear` is the wrong goal for a buried block: it asks the bot to stand
 * within a couple of blocks of a position that is itself solid rock, and since
 * no such standable spot exists the search runs until it times out. Ore four
 * blocks away was costing two minutes and then failing. `GoalBreakBlock` asks
 * the right question — get somewhere this block can be mined from — and lets
 * the pathfinder tunnel there.
 */
export async function goToBlock(context: ToolContext, x: number, y: number, z: number, timeoutMs = ACTION_TIMEOUT_MS): Promise<void> {
  const { bot, goals, Movements } = context
  const movements = new Movements(bot)
  movements.allowSprinting = true
  movements.liquidCost = LIQUID_COST
  bot.pathfinder.setMovements(movements)
  bot.pathfinder.thinkTimeout = PATH_THINK_TIMEOUT_MS
  /*
   * GoalGetToBlock: end when standing directly beside the block. The two goals
   * that sound more apt are both unusable here —
   *
   *   GoalBreakBlock  drops the `node` argument when delegating, so the inner
   *                   isEnd(undefined) throws inside the physics tick and kills
   *                   the whole bot process.
   *   GoalLookAtBlock line-of-sight checks with world.raycast(), which is async
   *                   in prismarine-world; the promise it returns has no
   *                   `.position`, so isEnd is never satisfied and the path
   *                   simply runs until it times out.
   *
   * GoalGetToBlock is plain arithmetic and does neither.
   */
  await pathTo(context, new goals.GoalGetToBlock(x, y, z), timeoutMs, 'digging through to it')
}

/**
 * Flies to a point the way a player does: up, across, then down.
 *
 * Two things had to be worked around. `creative.flyTo` travels in a dead
 * straight line and moves the bot by writing its position directly, so any
 * terrain on that line is flown into rather than over — which is how the
 * companion ended up "half-climbed on a tower", wedged and confusing its own
 * pathing. Climbing to a clear height first, crossing, and only then coming
 * down keeps the line empty.
 *
 * And it never reports arrival. Its last act is `once(bot, 'move')` with no
 * timeout, waiting for a movement event from a bot that has just been placed
 * exactly on its destination and is now perfectly still. The flight finishes
 * and the promise never settles, which every caller saw as "flying there took
 * too long". So arrival is judged by distance instead, and the promise is left
 * to its own devices.
 */
export async function flyThere(
  context: ToolContext,
  x: number,
  y: number,
  z: number,
  budgetMs: number
): Promise<boolean> {
  const { bot, signal } = context
  const { Vec3 } = require('vec3')

  /*
   * One leg of the flight, stepped by hand.
   *
   * `creative.flyTo` cannot be used a leg at a time. Its loop keeps writing the
   * bot's position towards its own destination until it gets there, so starting
   * a second one while the first is still running has the two of them writing
   * opposite positions every fifty milliseconds — the bot climbed, then hung in
   * the air making no horizontal progress whatever while they fought. Stepping
   * it here means one loop, a real time limit, and an honest answer about
   * whether it arrived.
   *
   * The mechanism is the same one the library uses: with gravity off, the
   * position is advanced half a block every fifty milliseconds, which is the
   * ten blocks a second a flying player manages.
   */
  const flyLeg = async (target: any, allowMs: number, tolerance = 0.5): Promise<boolean> => {
    const { Vec3: V } = require('vec3')
    const step = 0.5
    const deadline = Date.now() + allowMs

    while (Date.now() < deadline && !signal.aborted) {
      const gap = target.minus(bot.entity.position)
      const span = gap.norm()
      if (span <= step) break

      bot.physics.gravity = 0
      bot.entity.velocity = new V(0, 0, 0)
      bot.entity.position.add(gap.scaled(step / span))
      await new Promise((r) => setTimeout(r, 50))
    }

    const left = target.minus(bot.entity.position).norm()
    if (left <= step) {
      bot.entity.position = target.clone()
      return true
    }

    /*
     * Close enough counts. The destination for the last leg is usually a player,
     * who is both moving and standing in the very spot being flown to — so the
     * bot would hover a few blocks off, call the flight a failure, and fall back
     * to walking from mid-air, which cannot path at all. Arriving beside someone
     * is arriving.
     */
    return left <= tolerance
  }

  try {
    await bot.creative.startFlying()
  } catch {
    /* already flying, or the server refused — the legs below will show which */
  }

  const here = bot.entity.position
  const destination = new Vec3(x, y, z)

  /*
   * A height with nothing in it, found by looking rather than assuming: the
   * highest of where we are and where we are going, plus clearance, nudged up
   * while there is something solid in the way.
   */
  let cruise = Math.max(here.y, y) + 4
  for (let lift = 0; lift < 12; lift++) {
    const overHere = bot.blockAt(new Vec3(Math.floor(here.x), Math.floor(cruise), Math.floor(here.z)))
    const overThere = bot.blockAt(new Vec3(Math.floor(x), Math.floor(cruise), Math.floor(z)))
    const clear = (b: any): boolean => !b || isReplaceable(b)
    if (clear(overHere) && clear(overThere)) break
    cruise += 2
  }
  cruise = Math.min(cruise, 250)

  // A third of the budget per leg, so no single one can eat the lot.
  const perLeg = Math.max(4_000, Math.floor(budgetMs / 3))

  const climbed = await flyLeg(new Vec3(here.x, cruise, here.z), perLeg)
  if (!climbed && !signal.aborted) return false

  const crossed = await flyLeg(new Vec3(x, cruise, z), perLeg, 4)
  if (!crossed && !signal.aborted) return false

  return await flyLeg(destination, perLeg, 3)
}

/** Walks to a position, giving up rather than hanging if the path fails. */
export async function goTo(
  context: ToolContext,
  x: number,
  y: number,
  z: number,
  range = 2,
  timeoutMs = ACTION_TIMEOUT_MS
): Promise<void> {
  const { bot, goals, Movements } = context

  /*
   * In creative, fly. The pathfinder only walks, and walking is why the bot was
   * seen bridging block by block across an ocean instead of going over it — it
   * has no concept of boats, and in creative it does not need one.
   *
   * `flyTo` will not move a bot that is not already airborne, so flight has to
   * be switched on first. Without that it failed instantly and everything fell
   * back to walking, which is what made building crawl.
   */
  if (isCreative(bot) && Date.now() >= flightPausedUntil) {
    try {
      const { Vec3 } = require('vec3')
      if (!bot.physics?.gravity || bot.entity?.onGround) {
        try {
          await bot.creative.startFlying()
        } catch {
          /* already flying, or the server refused; flyTo reports the real problem */
        }
      }
      /*
       * Budget the flight by how far it actually is. A flat allowance meant
       * short hops were fine while any long one timed out every time — and
       * three of those in a row switched flight off for the rest of the
       * session, leaving the bot walking everywhere.
       */
      const distance = bot.entity.position.distanceTo(new Vec3(x, y, z))
      // It flies half a block every 50ms, so a block takes about 100ms; this is
      // several times that, plus room for the climb and the descent.
      const budget = Math.min(timeoutMs, Math.max(FLIGHT_TIMEOUT_MS, distance * 400 + 6_000))

      const landed = await flyThere(context, x, y, z, budget)
      if (!landed) throw new Error('could not get there by air')

      flightFailures = 0
      return
    } catch (err) {
      /*
       * Stop trying after the first failure. A server that will not let the bot
       * fly will not let it fly on the next block either, and re-attempting it
       * every time added the flight timeout to every single placement.
       */
      flightFailures++
      let note = ''
      if (flightFailures >= MAX_FLIGHT_FAILURES) {
        // A pause, not a permanent stop: switching flight off for the session
        // left the bot walking everywhere, unable to climb to blocks it was
        // placing or cross the terrain flight existed to avoid.
        flightPausedUntil = Date.now() + FLIGHT_RETRY_AFTER_MS
        flightFailures = 0
        note = ' and pausing flight for a minute'
      }
      context.log(`creative flight failed (${(err as Error).message}); walking instead${note}`)
    }
  }

  const movements = new Movements(bot)
  movements.allowSprinting = true
  /*
   * Deliberately NOT enabling canOpenDoors.
   *
   * It looks like the fix for a companion that cannot walk into a house, but
   * the library sets it false itself with the note "Causes issues. Probably due
   * to none paper servers", and its openable set only ever contains fence
   * gates — never doors. Turning it on bought nothing and coincided with the
   * pathfinder failing to plan routes across open ground.
   *
   * Doors are handled properly by the model instead: open one with use_block,
   * then walk through.
   */
  /*
   * Make water expensive rather than free.
   *
   * At the default cost the pathfinder happily routes straight across open
   * water, and a long swim drowns the bot — it has no notion of air. Going
   * round costs a few seconds; going through costs everything it is carrying.
   * Water is still passable when there is genuinely no way around.
   */
  movements.liquidCost = LIQUID_COST
  bot.pathfinder.setMovements(movements)
  /*
   * The pathfinder's default five-second think budget gives up on ordinary
   * terrain — a tree a few blocks away was enough to trigger "Took to long to
   * decide path to goal!". Failing to plan is not the same as there being
   * nothing there, and the bot looked broken because the two were conflated.
   */
  bot.pathfinder.thinkTimeout = PATH_THINK_TIMEOUT_MS
  await pathTo(context, new goals.GoalNear(x, y, z, range), timeoutMs, 'walking there')
}

/**
 * Walks over dropped items near a point to collect them.
 *
 * Mining across several blocks leaves a trail of drops behind: the bot only
 * picks up what it physically walks over, so a ten-log job was landing three
 * logs in the inventory and leaving seven on the forest floor.
 */
export async function collectDropsNear(
  context: ToolContext,
  radius = 12,
  from?: any,
  minePlainly = false
): Promise<number> {
  const { bot, signal } = context
  const centre = from ?? bot.entity.position

  /*
   * Leave other people's things alone — but not so eagerly that the bot
   * abandons its own work.
   *
   * The first version skipped any drop closer to another player than to the
   * bot, which meant that with the owner standing nearby watching, every log
   * the bot felled counted as somebody else's and was left on the floor.
   *
   * `minePlainly` marks the case where the drop demonstrably came from the
   * bot's own action a moment ago, and ownership is not in question. Otherwise
   * only drops sitting right on top of a player are left alone: that is a death
   * pile or something they deliberately dropped, not scatter from mining.
   */
  const others = minePlainly
    ? []
    : nearbyPlayers(bot)
        .map((name) => bot.players[name]?.entity)
        .filter(Boolean)

  const drops = (Object.values(bot.entities) as any[])
    .filter((e) => e.name === 'item' && e.position.distanceTo(centre) < radius)
    .filter((e) => !others.some((player: any) => e.position.distanceTo(player.position) < 2.5))
    .slice(0, 16)

  let collected = 0
  for (const drop of drops) {
    if (signal.aborted) break
    try {
      await goTo(context, drop.position.x, drop.position.y, drop.position.z, 1)
      collected++
    } catch {
      /* despawned or unreachable; the rest are still worth trying */
    }
  }
  return collected
}

/**
 * Builds a tower up from under the bot's own feet — the standard way out of a
 * fight that cannot be walked away from.
 *
 * Running from a zombie does not work: they move at very nearly a player's
 * walking speed, so a bot at low health that tried to flee across open ground
 * was simply chased down and killed. Three blocks of height puts it out of
 * reach of anything on the ground, which buys the time that running never did.
 */
export async function pillarUp(bot: any, height = 3): Promise<number> {
  const { Vec3 } = require('vec3')

  // A full block, not a torch, slab or sapling — the tower has to be stood on.
  const solid = (name: string): boolean => {
    const block = (bot.registry.blocksByName as any)[name]
    return Boolean(block && block.boundingBox === 'block')
  }

  const stackable = bot.inventory
    .items()
    .find((i: any) => i.count >= height && solid(i.name) && !TOOL_ITEM.test(i.name))
  if (!stackable) return 0

  try {
    await bot.equip(stackable, 'hand')
  } catch {
    return 0
  }

  let built = 0
  for (let level = 0; level < height; level++) {
    const footing = bot.blockAt(bot.entity.position.offset(0, -1, 0))
    if (!footing) break

    try {
      bot.setControlState('jump', true)
      await new Promise((r) => setTimeout(r, 120))
      // Place into the gap under the bot at the top of the jump.
      await bot.placeBlock(footing, new Vec3(0, 1, 0))
      built++
    } catch {
      // A missed jump is normal; keep trying the remaining levels.
    } finally {
      bot.setControlState('jump', false)
      await new Promise((r) => setTimeout(r, 220))
    }
  }

  return built
}
