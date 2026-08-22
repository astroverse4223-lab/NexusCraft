import type { ToolSchema } from './llm'

/**
 * The complete set of things the companion can do.
 *
 * The model never issues raw Minecraft commands — it picks from this list and
 * the implementations below drive mineflayer. That keeps the blast radius of a
 * confused model to "did something useless" rather than "ran /kill @a".
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface ToolContext {
  bot: any
  mcData: any
  goals: any
  Movements: any
  /** Player the companion treats as its owner, for "come here" and similar. */
  owner: string | null
  log: (message: string) => void
  addMemory: (note: string) => void
  setGoal: (goal: string | null) => void
  /** Aborts long-running actions when the user stops the bot. */
  signal: AbortSignal
}

export interface Tool {
  schema: ToolSchema
  /** `memory` is passed so a tool can read notes the bot has written itself. */
  execute: (context: ToolContext, args: Record<string, any>, memory?: string[]) => Promise<string>
}

const MAX_MINE = 64
const ACTION_TIMEOUT_MS = 120_000
/** How long the pathfinder may spend planning before it gives up. */
const PATH_THINK_TIMEOUT_MS = 20_000
/** Blocks already within reach are dug directly rather than pathed to. */
const REACH_BLOCKS = 4
/** Moving into range for one block should fail fast, not stall a whole build. */
const MOVE_TO_PLACE_TIMEOUT_MS = 12_000
/** Flight covers short hops quickly; a long wait here means it is not working. */
const FLIGHT_TIMEOUT_MS = 6_000
/** Travelling to a player or place: long enough to cross terrain, short enough to report back. */
const TRAVEL_TIMEOUT_MS = 45_000
/** Travel budgets to spend before giving up, while ground is still being covered. */
const TRAVEL_ATTEMPTS = 4
/** How much dearer a block of water is than a block of ground when routing. */
const LIQUID_COST = 12
/** Health at which a fight is abandoned rather than lost. */
const RETREAT_HEALTH = 8
/** Damage taken during a job before it is abandoned. */
const DAMAGE_BEFORE_STOPPING = 6
/** How far to back off when breaking from a fight. */
const FLEE_DISTANCE = 14
/** Ceiling on closing the distance to a wandering animal. */
const MAX_ANIMAL_APPROACH_MS = 70_000
/** Ceiling on one boat crossing before it is abandoned. */
const BOAT_TRAVEL_MS = 120_000
/** How far the boat is advanced each tick — under a real boat's top speed. */
const BOAT_STEP_BLOCKS = 0.28
/** How often the boat's new position is reported. */
const BOAT_TICK_MS = 50
/** Items worth eating when hurt. */
const EDIBLE = /cooked_|bread|apple|carrot|potato|beetroot|melon_slice|steak|mutton|rabbit|stew|berries/
/** Items that can meaningfully speed up breaking a block. */
const TOOL_ITEM = /_(pickaxe|axe|shovel|hoe|sword)$|^shears$/
/** Tool materials, worst to best, for breaking ties the dig time cannot. */
const MATERIAL_TIER = ['wooden', 'golden', 'stone', 'iron', 'diamond', 'netherite']

function materialTier(name: string): number {
  return MATERIAL_TIER.findIndex((material) => name.startsWith(`${material}_`))
}
/** Consecutive unreachable blocks before a mining job gives up. */
const MAX_UNREACHABLE = 4
/** How much dearer a block of height is than a block of ground when choosing what to mine. */
const VERTICAL_PENALTY = 4
/** How often to check that a walk is actually making progress. */
const STUCK_SAMPLE_MS = 1_200
/** Movement below this over one sample counts as standing still. */
const STUCK_MOVED_BLOCKS = 0.35
/** Reaching one block to mine it; a whole job should not hinge on a single stubborn one. */
const MINE_APPROACH_TIMEOUT_MS = 20_000
/** Commands the companion will never run, however it is asked. */
const FORBIDDEN_COMMANDS = new Set([
  'stop', 'ban', 'ban-ip', 'banlist', 'pardon', 'pardon-ip', 'kick',
  'op', 'deop', 'whitelist', 'save-off', 'setidletimeout',
  'forceload', 'reload', 'debug', 'perf', 'jfr'
])
/** The way the bot last wandered, so a random explore does not double back. */
let lastHeading = ''
/**
 * Consecutive creative-flight failures. Flight is only abandoned after several
 * in a row: giving up after a single one meant a momentary hiccup — a chunk not
 * loaded yet — permanently grounded the bot, and it then tried to *walk* up to
 * blocks it was placing, which cannot work.
 */
let flightFailures = 0
let flightPausedUntil = 0
const MAX_FLIGHT_FAILURES = 3
/** Flight is retried after a pause; abandoning it for the session was worse. */
const FLIGHT_RETRY_AFTER_MS = 60_000

function itemCounts(bot: any): string {
  const items = bot.inventory.items()
  if (items.length === 0) return 'nothing'
  const totals = new Map<string, number>()
  for (const item of items) totals.set(item.name, (totals.get(item.name) ?? 0) + item.count)
  return [...totals].map(([name, count]) => `${count}x ${name}`).join(', ')
}

function nearbyPlayers(bot: any): string[] {
  return Object.keys(bot.players).filter((name) => name !== bot.username)
}

/** Resolves the player a command refers to, falling back to the owner. */
function resolvePlayer(context: ToolContext, username?: string): any | null {
  const name = username ?? context.owner ?? nearbyPlayers(context.bot)[0]
  if (!name) return null
  return context.bot.players[name]?.entity ?? null
}

/**
 * Explains why a player could not be reached.
 *
 * "Cannot see that player" reads as "they are not here", but the usual cause is
 * that they are online and simply beyond render distance, where the server
 * sends no entity. The model needs to tell those apart: one means give up, the
 * other means go and look.
 */
function explainMissingPlayer(context: ToolContext, username?: string): string {
  const { bot } = context
  const name = username ?? context.owner ?? nearbyPlayers(bot)[0]
  if (!name) return 'nobody else is on the server'

  const listed = bot.players[name]
  if (!listed) {
    const others = nearbyPlayers(bot)
    return others.length
      ? `${name} is not on the server. Online: ${others.join(', ')}`
      : `${name} is not on the server, and nobody else is either`
  }

  return `${name} is online but too far away to locate — the server only sends positions for players nearby. Explore towards them, or ask them where they are.`
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} took too long`)), ms))
  ])
}

/**
 * Whether a block can be built straight over. A block with an empty bounding
 * box takes up no space, which is exactly the set the game lets you replace.
 */
function isReplaceable(block: any): boolean {
  if (!block) return true
  if (block.name === 'air' || block.name.includes('water')) return true
  return block.boundingBox === 'empty'
}

/**
 * True when the server has the bot in creative mode.
 *
 * `bot.game.gameMode` is set at login and does not reliably follow a later
 * `/gamemode` change — it kept reporting creative while blocks were plainly
 * dropping, which is survival behaviour. The player list entry is updated by
 * the server whenever the mode changes, so it is trusted first.
 */
/**
 * Whether an entity is something that attacks the player.
 *
 * mineflayer's `type` is 'mob' for every living creature, passive ones
 * included, so it cannot be used to decide what is safe to hit. `kind` carries
 * the category when the version data provides it; the name list covers the rest.
 */
const HOSTILE_NAMES = new Set([
  'zombie', 'husk', 'drowned', 'zombie_villager', 'zombified_piglin',
  'skeleton', 'stray', 'bogged', 'wither_skeleton',
  'creeper', 'spider', 'cave_spider', 'enderman', 'endermite',
  'witch', 'slime', 'magma_cube', 'blaze', 'ghast', 'phantom',
  'pillager', 'vindicator', 'evoker', 'ravager', 'vex', 'illusioner',
  'silverfish', 'guardian', 'elder_guardian', 'shulker', 'hoglin', 'zoglin',
  'piglin_brute', 'warden', 'breeze', 'creaking'
])

export function isHostile(entity: any): boolean {
  if (!entity || entity.type === 'player') return false
  if (typeof entity.kind === 'string' && entity.kind.toLowerCase().includes('hostile')) return true
  return HOSTILE_NAMES.has(String(entity.name ?? '').replace(/^minecraft:/, ''))
}

/** Picks the hardest-hitting weapon carried, ranked by material and type. */
const WEAPON_TIER = ['wooden', 'golden', 'stone', 'iron', 'diamond', 'netherite']

export function bestWeapon(bot: any): any | null {
  const score = (name: string): number => {
    const tier = WEAPON_TIER.findIndex((material) => name.startsWith(`${material}_`))
    if (tier < 0) return -1
    // A sword of a given material out-damages the axe of that material for
    // sustained fighting, so it wins ties.
    if (name.endsWith('_sword')) return tier * 2 + 1
    if (name.endsWith('_axe')) return tier * 2
    return -1
  }

  let best: any = null
  let bestScore = 0
  for (const item of bot.inventory.items()) {
    const value = score(item.name)
    if (value > bestScore) {
      bestScore = value
      best = item
    }
  }
  return best
}

function isCreative(bot: any): boolean {
  const listed = bot.players?.[bot.username]?.gamemode
  if (typeof listed === 'number') return listed === 1
  if (typeof listed === 'string') return listed === 'creative'
  return bot.game?.gameMode === 'creative'
}

/** The current game mode by the same reckoning, for reporting. */
function gameModeName(bot: any): string {
  const listed = bot.players?.[bot.username]?.gamemode
  const byNumber = ['survival', 'creative', 'adventure', 'spectator']
  if (typeof listed === 'number') return byNumber[listed] ?? String(listed)
  if (typeof listed === 'string') return listed
  return bot.game?.gameMode ?? 'unknown'
}

/**
 * Finds a spot beside the bot that a block can actually be placed into: empty
 * itself, and with solid ground beneath to build against.
 */
async function freeSpotBeside(bot: any): Promise<any | null> {
  return freeSpotsBeside(bot)[0] ?? null
}

/**
 * Every spot beside the bot a block could go, nearest first.
 *
 * One candidate is not enough: placement fails for reasons that have nothing to
 * do with the spot being legal — a missed block update, a mob standing there —
 * and giving up after a single attempt meant the bot crafted a table, failed to
 * put it down, and then reported it had nothing to make one from.
 */
function freeSpotsBeside(bot: any): any[] {
  const { Vec3 } = require('vec3')
  const base = bot.entity.position.floored()
  const offsets = [
    new Vec3(1, 0, 0),
    new Vec3(-1, 0, 0),
    new Vec3(0, 0, 1),
    new Vec3(0, 0, -1),
    new Vec3(1, 0, 1),
    new Vec3(-1, 0, -1),
    new Vec3(1, 0, -1),
    new Vec3(-1, 0, 1),
    new Vec3(2, 0, 0),
    new Vec3(-2, 0, 0),
    new Vec3(0, 0, 2),
    new Vec3(0, 0, -2)
  ]

  const spots: any[] = []
  for (const offset of offsets) {
    const spot = base.plus(offset)
    const here = bot.blockAt(spot)
    const under = bot.blockAt(spot.offset(0, -1, 0))
    if (isReplaceable(here) && under && under.boundingBox === 'block') spots.push(spot)
  }
  return spots
}

/**
 * A place the bot could stand from which `target` is within reach.
 *
 * Needs room for the bot itself — two blocks of air with something solid
 * underneath — which is why a fixed offset does not do: beside a wall under
 * construction, "two blocks over" is usually inside the wall.
 */
function standingSpotNear(bot: any, target: any): any | null {
  const { Vec3 } = require('vec3')
  const candidates: any[] = []

  for (const dx of [-2, -1, 0, 1, 2]) {
    for (const dz of [-2, -1, 0, 1, 2]) {
      if (dx === 0 && dz === 0) continue
      for (const dy of [0, 1, -1]) {
        candidates.push(new Vec3(target.x + dx, target.y + dy, target.z + dz))
      }
    }
  }

  // Nearest first, so the bot moves as little as possible.
  candidates.sort((a, b) => bot.entity.position.distanceTo(a) - bot.entity.position.distanceTo(b))

  for (const spot of candidates) {
    const feet = bot.blockAt(spot)
    const head = bot.blockAt(spot.offset(0, 1, 0))
    const under = bot.blockAt(spot.offset(0, -1, 0))
    if (!feet || !head || !under) continue
    if (!isReplaceable(feet) || !isReplaceable(head)) continue
    if (under.boundingBox !== 'block') continue
    if (spot.distanceTo(target) > 4.2) continue
    return spot
  }
  return null
}

/**
 * Armour ranked the way the game ranks it, worst first.
 *
 * The bot could craft a full set and then fight in its shirt: the only way to
 * wear anything was for the model to call `equip` four times with the right
 * destination for each piece, which it never thought to do.
 */
const ARMOUR_TIER = ['leather', 'golden', 'chainmail', 'iron', 'diamond', 'netherite']

const ARMOUR_SLOTS: Array<{ suffix: string; destination: string; label: string }> = [
  { suffix: '_helmet', destination: 'head', label: 'head' },
  { suffix: '_chestplate', destination: 'torso', label: 'chest' },
  { suffix: '_leggings', destination: 'legs', label: 'legs' },
  { suffix: '_boots', destination: 'feet', label: 'feet' }
]

function armourRank(name: string): number {
  // Must actually be a piece of armour: matching the material alone counted an
  // iron pickaxe as iron armour, so the bot reported it was already wearing
  // "the best armour carried" while standing there in nothing at all.
  if (!ARMOUR_SLOTS.some((slot) => name.endsWith(slot.suffix))) return -1
  return ARMOUR_TIER.findIndex((material) => name.startsWith(`${material}_`))
}

/**
 * What the bot is wearing, slot by slot.
 *
 * Nothing could see this before. `equip_armor` only ever looked in the
 * inventory, so a bot in a full set of iron reported "no armour to wear" —
 * equipped armour is not carried armour — and a model reading that would go and
 * mine more iron for a set it was already standing in. Nor did looking around
 * mention armour at all, so there was no way to find out short of guessing.
 */
function wornArmour(bot: any): string[] {
  const on: string[] = []
  for (const slot of ARMOUR_SLOTS) {
    try {
      const piece = bot.inventory.slots[bot.getEquipmentDestSlot(slot.destination)]
      if (piece?.name && armourRank(piece.name) >= 0) on.push(piece.name)
    } catch {
      /* a slot that cannot be read is simply not reported */
    }
  }
  return on
}

/** Wears the best piece carried for each slot. Returns what it put on. */
async function wearBestArmour(bot: any): Promise<string[]> {
  const worn: string[] = []

  for (const slot of ARMOUR_SLOTS) {
    const candidates = bot.inventory
      .items()
      .filter((item: any) => item.name.endsWith(slot.suffix) && armourRank(item.name) >= 0)
      .sort((a: any, b: any) => armourRank(b.name) - armourRank(a.name))

    const best = candidates[0]
    if (!best) continue

    // Already wearing something at least as good? Leave it alone.
    const current = bot.inventory.slots[bot.getEquipmentDestSlot(slot.destination)]
    if (current && armourRank(current.name) >= armourRank(best.name)) continue

    try {
      await bot.equip(best, slot.destination)
      worn.push(best.name)
    } catch {
      /* a piece that will not go on is not worth failing the whole set over */
    }
  }

  return worn
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
async function pathTo(
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
async function escapeUpwards(context: ToolContext): Promise<string | null> {
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
async function breakWhateverIsInTheWay(context: ToolContext): Promise<string | null> {
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

async function goToBlock(context: ToolContext, x: number, y: number, z: number, timeoutMs = ACTION_TIMEOUT_MS): Promise<void> {
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
async function flyThere(
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
async function goTo(
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
 * Holds the fastest tool in the inventory for a given block.
 *
 * mineflayer does not equip anything on its own, so `bot.dig` uses whatever
 * happens to be in hand. Bare-handed mining of stone or ore either takes long
 * enough to hit the action timeout or drops nothing at all, which is why the
 * companion looked incapable of gathering anything for itself.
 *
 * Rather than hard-coding a tool-to-material table, every item is asked how
 * long it would take to break this block and the quickest wins. That stays
 * correct across Minecraft versions and handles enchanted tools for free.
 */
/**
 * How long to allow for breaking one block, from how long it should take.
 *
 * Every dig was given the same two-minute allowance as any other action, so a
 * block the bot could not actually break — the wrong tool for it, or nothing in
 * hand at all — meant two solid minutes of swinging on the spot before anything
 * gave up. From outside that is indistinguishable from a hung bot, and it is
 * what the owner kept seeing.
 *
 * prismarine-block already knows what the held item would do against this
 * block, so the allowance is three times that, with a floor for latency and a
 * ceiling well under the old one.
 */
function digAllowanceMs(bot: any, block: any): number {
  try {
    const held = bot.heldItem?.type ?? null
    const expected = block.digTime(held, false, false, false)
    if (Number.isFinite(expected) && expected > 0) {
      return Math.min(45_000, Math.max(8_000, Math.ceil(expected * 3)))
    }
  } catch {
    /* fall through to the default */
  }
  return 15_000
}

async function equipBestTool(bot: any, block: any): Promise<string | null> {
  const items = bot.inventory.items()
  if (items.length === 0) return null

  let best: any = null
  let bestTime = Number.POSITIVE_INFINITY

  // The empty hand is the baseline every tool has to beat. If that cannot be
  // measured, every item looks like an improvement — which is how the bot ended
  // up "mining oak_log using oak_log", holding a log as though it were an axe.
  let baseline: number | null = null
  try {
    const bare = block.digTime(null, false, false, false)
    if (Number.isFinite(bare)) baseline = bare
  } catch {
    baseline = null
  }
  if (baseline != null) bestTime = baseline

  /*
   * Prefer a tool that will actually yield the block's drops, then the fastest
   * among those. Ranking on speed alone chose a stone pickaxe over an iron one
   * for iron ore, and a wooden pickaxe for obsidian — which cannot mine it at
   * all. Speed is only worth comparing between tools that work.
   */
  const harvests = (item: any): boolean => {
    const needed = block.harvestTools
    return !needed || Boolean(needed[item.type])
  }

  /*
   * Whether this block needs a tool at all to give up its drops.
   *
   * Logs, dirt and wool have no requirement, so every tool "harvests" them —
   * and the rule below that a harvesting tool beats a non-harvesting one then
   * matched the first tool in the bag regardless of speed. That is how the bot
   * came to chop trees with a stone pickaxe: a pickaxe is no faster on wood
   * than an empty hand, so it wore the pickaxe out for nothing. Where nothing
   * is required, a tool has to earn its place by actually being quicker.
   */
  const needsTool = Boolean(block.harvestTools)

  let bestHarvests = false

  for (const item of items) {
    // Only actual tools are worth holding; nothing else beats a bare hand.
    if (!TOOL_ITEM.test(item.name)) continue
    try {
      const time = block.digTime(item.type, false, false, false)
      if (!Number.isFinite(time)) continue

      const works = harvests(item)

      // A tool that yields drops always beats one that does not, however slow —
      // but only where the block actually demands one.
      if (needsTool && works && !bestHarvests) {
        bestHarvests = true
        bestTime = time
        best = item
        continue
      }
      if (needsTool && works !== bestHarvests) continue

      // Nothing required: the bare hand is the thing to beat, and matching it
      // is not beating it.
      if (!needsTool && baseline != null && time >= baseline) continue

      /*
       * Break ties by material. prismarine-block reports an identical dig time
       * for every pickaxe tier that can harvest iron ore, so a straight speed
       * comparison kept a stone pickaxe over an iron one. In the game the
       * better material really is faster; when the numbers cannot tell them
       * apart, the tier can.
       */
      if (time < bestTime || (time === bestTime && best && materialTier(item.name) > materialTier(best.name))) {
        bestTime = time
        best = item
      }
    } catch {
      /* an item that cannot be evaluated simply does not win */
    }
  }

  // Reporting whatever happens to be in hand made the bot claim it was
  // "mining oak_log using oak_log". Nothing chosen means nothing to report.
  if (!best) return null
  if (bot.heldItem?.type === best.type) return best.name

  try {
    await bot.equip(best, 'hand')
    return best.name
  } catch {
    return null
  }
}

/**
 * Walks over dropped items near a point to collect them.
 *
 * Mining across several blocks leaves a trail of drops behind: the bot only
 * picks up what it physically walks over, so a ten-log job was landing three
 * logs in the inventory and leaving seven on the forest floor.
 */
async function collectDropsNear(
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

/* ------------------------------------------------------------- farming */

/** Seed item -> the crop block it becomes, and what it drops when grown. */
const CROPS: Record<string, { block: string; label: string }> = {
  wheat_seeds: { block: 'wheat', label: 'wheat' },
  carrot: { block: 'carrots', label: 'carrots' },
  potato: { block: 'potatoes', label: 'potatoes' },
  beetroot_seeds: { block: 'beetroots', label: 'beetroots' },
  melon_seeds: { block: 'melon_stem', label: 'melons' },
  pumpkin_seeds: { block: 'pumpkin_stem', label: 'pumpkins' }
}

/** Ground a hoe will turn into farmland. */
const TILLABLE = new Set(['grass_block', 'dirt', 'coarse_dirt', 'rooted_dirt', 'dirt_path'])

/**
 * Whether a crop has finished growing.
 *
 * Harvesting early destroys the crop for a fraction of the yield, so age is
 * checked rather than assumed. Most crops finish at age 7; beetroot at 3.
 */
function isRipe(block: any): boolean {
  try {
    const age = Number(block.getProperties?.().age)
    if (Number.isNaN(age)) return false
    return block.name === 'beetroots' ? age >= 3 : age >= 7
  } catch {
    return false
  }
}

/**
 * Notices when the bot dies part-way through a job.
 *
 * Nothing in the tools watched for this, so a bot that died while gathering
 * carried on running the loop for another eighty seconds and then reported
 * "mined 38x short_grass" with an empty inventory — everything it had was lying
 * on the ground where it was killed. Dying invalidates whatever the job was
 * doing, and the model needs to be told rather than handed a false success.
 */
function watchForDeath(bot: any): { died: () => boolean; stop: () => void } {
  let dead = false
  const onDeath = (): void => {
    dead = true
  }
  bot.on('death', onDeath)
  return {
    died: () => dead,
    stop: () => bot.removeListener('death', onDeath)
  }
}

/* ------------------------------------------------------------ containers */

/**
 * Opens a container, making sure the bot is beside it rather than on top of it.
 *
 * A chest placed right where the bot was standing cannot be opened at all — the
 * server never sends the window, and it surfaces as a twenty-second timeout with
 * no hint of the cause.
 */
async function openContainerNearby(context: ToolContext, block: any): Promise<any> {
  const { bot } = context
  const distance = bot.entity.position.distanceTo(block.position)

  if (distance < 1.2) {
    // Standing in it: step aside before trying.
    const spot = standingSpotNear(bot, block.position)
    if (spot) {
      try {
        await goTo(context, spot.x, spot.y, spot.z, 1, MOVE_TO_PLACE_TIMEOUT_MS)
      } catch {
        /* if it cannot move, opening will fail with its own message */
      }
    }
  } else if (distance > REACH_BLOCKS) {
    await goToBlock(context, block.position.x, block.position.y, block.position.z, MINE_APPROACH_TIMEOUT_MS)
  }

  await bot.lookAt(block.position.offset(0.5, 0.5, 0.5))
  return await bot.openContainer(block)
}


/** Blocks that hold items and can be opened the same way. */
const CONTAINERS = ['chest', 'trapped_chest', 'barrel', 'shulker_box', 'ender_chest']

/**
 * Finds a container to use, placing one from the inventory if none is near.
 * Returns the block, or null with the reason it could not be arranged.
 */
async function findOrPlaceContainer(
  context: ToolContext,
  allowPlacing: boolean
): Promise<{ block: any | null; reason: string }> {
  const { bot, mcData } = context

  const ids = CONTAINERS.map((n) => mcData.blocksByName[n]?.id).filter((id) => id != null)
  let block = bot.findBlock({ matching: ids, maxDistance: 16 })
  if (block) return { block, reason: '' }

  if (!allowPlacing) return { block: null, reason: 'no chest or barrel within 16 blocks' }

  const carried = bot.inventory.items().find((i: any) => CONTAINERS.includes(i.name))
  if (!carried) {
    return { block: null, reason: 'no chest nearby and none carried. Craft one from 8 planks.' }
  }

  const spot = await freeSpotBeside(bot)
  if (!spot) return { block: null, reason: 'no room beside me to put a chest down' }

  const placed = await findTool('place_block')!.execute(context, {
    block: carried.name,
    x: spot.x,
    y: spot.y,
    z: spot.z
  })
  context.log(`chest: ${placed}`)

  block = bot.findBlock({ matching: ids, maxDistance: 16 })
  return block ? { block, reason: '' } : { block: null, reason: `could not place a chest: ${placed}` }
}

/**
 * Whether the held tool will actually yield drops for this block.
 *
 * Minecraft silently gives nothing for stone broken by hand or ore broken with
 * the wrong tier. The bot happily reported "mined 10x stone" having collected
 * precisely nothing, which reads as success and is not.
 */
function canHarvest(bot: any, block: any): boolean {
  const needed = block.harvestTools
  if (!needed) return true
  const held = bot.heldItem
  return Boolean(held && needed[held.type])
}

/**
 * Watches for the bot being hurt part-way through a long job.
 *
 * Without this the bot mined placidly on while something chewed it from full
 * health to nothing — it noticed the death afterwards but never the attack. A
 * job is not worth finishing if it kills you; stopping lets the model fight,
 * flee or shelter while there is still health to spend.
 */
function watchForDanger(bot: any): { hurt: () => boolean; damage: () => number; stop: () => void } {
  let lowest = bot.health ?? 20
  const start = bot.health ?? 20
  const onHealth = (): void => {
    if (bot.health < lowest) lowest = bot.health
  }
  bot.on('health', onHealth)
  return {
    hurt: () => start - lowest >= DAMAGE_BEFORE_STOPPING || bot.health <= RETREAT_HEALTH,
    damage: () => Math.round(start - lowest),
    stop: () => bot.removeListener('health', onHealth)
  }
}

/** Hostiles close enough to be the reason. */
function nearbyThreats(bot: any): string[] {
  return (Object.values(bot.entities) as any[])
    .filter((e) => isHostile(e) && e.position && e.position.distanceTo(bot.entity.position) < 16)
    .map((e) => `${e.name} at ${Math.round(e.position.distanceTo(bot.entity.position))}m`)
    .slice(0, 4)
}

/* ---------------------------------------------------------------- home */

/**
 * Where the bot considers home.
 *
 * Kept in memory as well as here: this variable dies with the process, and a
 * companion that forgot the base every restart would be no use. The written
 * note is the durable copy and is parsed back on first use.
 */
let homePosition: { x: number; y: number; z: number } | null = null

const HOME_NOTE = /home is at (-?\d+) (-?\d+) (-?\d+)/i

function rememberedHome(memory: string[]): { x: number; y: number; z: number } | null {
  for (const note of [...memory].reverse()) {
    const match = HOME_NOTE.exec(note)
    if (match) return { x: Number(match[1]), y: Number(match[2]), z: Number(match[3]) }
  }
  return null
}

/**
 * How long to wait between swings, by what is being held.
 *
 * Minecraft has charged attacks: a swing before the cooldown has recharged does
 * a fraction of full damage. The bot was hitting every 400ms and landing weak
 * blows all fight — busy, and barely hurting anything. These are the recharge
 * times for each weapon class.
 */
function swingInterval(bot: any): number {
  const held = bot.heldItem?.name ?? ''
  if (/_sword$/.test(held)) return 640
  if (/_axe$/.test(held)) return 1_120
  if (/_pickaxe$/.test(held)) return 850
  if (/_shovel$/.test(held)) return 1_020
  if (/_hoe$/.test(held)) return 500
  return 280
}

/**
 * Strikes on the way down from a jump — a critical hit, worth 1.5x damage.
 *
 * Only from the ground, and only when not already falling, since a crit needs
 * downward motion that the jump itself provides. If the timing does not come
 * together the blow still lands, just without the bonus.
 */
async function criticalStrike(bot: any, target: any): Promise<boolean> {
  if (!bot.entity.onGround) return false

  bot.setControlState('jump', true)
  await new Promise((r) => setTimeout(r, 90))
  bot.setControlState('jump', false)

  // Wait for the descent, but never long enough to miss the swing entirely.
  for (let tick = 0; tick < 12; tick++) {
    if (bot.entity.velocity.y < -0.08) {
      bot.attack(target)
      return true
    }
    await new Promise((r) => setTimeout(r, 40))
  }

  bot.attack(target)
  return false
}

/* ---------------------------------------------------------------- boats */

const BOAT_NAMES = /(^|_)boat$|_raft$/

/**
 * Every stretch of open water in reach, furthest away first.
 *
 * A boat is 1.375 blocks wide and will not be placed where the hull would clip
 * terrain, so the water needs water on all four sides. Distance matters just as
 * much, and in the opposite direction to intuition: the game puts the boat
 * where your line of sight meets the water, and standing at the bank looking
 * steeply down puts that point hard against the shore. Sighting along the
 * surface at water further out lands it in the open. The owner hit exactly this
 * playing by hand — a boat could not be placed at the bank at all without
 * "looking up almost".
 */
function openWaterNear(bot: any, radius = 7): Array<{ at: any; distance: number }> {
  const base = bot.entity.position.floored()

  const isWater = (at: any): boolean => {
    const block = bot.blockAt(at)
    return Boolean(block && block.name.includes('water'))
  }

  const found: Array<{ at: any; distance: number }> = []
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dy = 0; dy >= -2; dy--) {
        const at = base.offset(dx, dy, dz)
        if (!isWater(at)) continue

        const above = bot.blockAt(at.offset(0, 1, 0))
        if (!above || !isReplaceable(above)) continue

        const elbowRoom = [
          at.offset(1, 0, 0),
          at.offset(-1, 0, 0),
          at.offset(0, 0, 1),
          at.offset(0, 0, -1)
        ].filter(isWater).length
        if (elbowRoom < 4) continue

        const distance = bot.entity.position.distanceTo(at)
        // Placing is done by looking at it, so it stays within arm's reach.
        if (distance > 4.5) continue

        found.push({ at, distance })
      }
    }
  }

  return found.sort((a, b) => b.distance - a.distance)
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
async function pillarUp(bot: any, height = 3): Promise<number> {
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

/**
 * What a recipe still needs that the inventory cannot cover, for `runs` of it.
 *
 * Counting a single run was not enough: asking for three boats made planks for
 * one, then failed on the second with "missing ingredient". What is made has to
 * cover every run of the recipe that is about to happen.
 */
function missingIngredients(bot: any, recipe: any, runs = 1): Array<{ id: number; count: number }> {
  const needed = new Map<number, number>()
  for (const part of recipe.delta ?? []) {
    // Negative entries are what the recipe consumes.
    if (part.count >= 0) continue
    needed.set(part.id, (needed.get(part.id) ?? 0) + -part.count * runs)
  }

  const short: Array<{ id: number; count: number }> = []
  for (const [id, count] of needed) {
    const have = bot.inventory.count(id, null)
    if (have < count) short.push({ id, count: count - have })
  }
  return short
}

/**
 * Makes the parts a recipe is short of, so the recipe itself becomes possible.
 *
 * `recipesFor` only reports what can be built from what is already in the bag,
 * so a pickaxe with logs but no planks looked flatly impossible — the bot stood
 * over a crafting table holding three oak logs and reported no recipe for a
 * wooden pickaxe. A player would make planks and sticks first.
 *
 * Every wood has its own version of a recipe, and they all look equally far off
 * when the bag is empty of all of them. Picking the first and giving up when it
 * failed meant reaching for acacia planks while carrying oak, so each version is
 * tried in turn until one actually comes together.
 */
async function supplyIngredients(
  context: ToolContext,
  itemType: any,
  table: any,
  depth = 2,
  runs = 1
): Promise<string[]> {
  const { bot, mcData } = context
  const made: string[] = []
  if (depth <= 0) return made

  const all = bot.recipesAll(itemType.id, null, table ?? null)
  if (!all || all.length === 0) return made

  // Closest to possible first, so the likeliest version is tried before the rest.
  const ranked = [...all].sort(
    (a: any, b: any) => missingIngredients(bot, a, runs).length - missingIngredients(bot, b, runs).length
  )

  for (const recipe of ranked) {
    if (context.signal.aborted) break

    /*
     * Several passes, because making one part can eat another.
     *
     * A wooden pickaxe wants three planks and two sticks. Working the shortfall
     * once turned a log into four planks and then spent two of them on sticks,
     * leaving two planks where three were needed — everything asked for had
     * been made, and the pickaxe was still impossible. Re-reckoning what is
     * missing after each pass makes the second one top the planks back up.
     */
    for (let pass = 0; pass < 3; pass++) {
      if (context.signal.aborted) break

      const shortfall = missingIngredients(bot, recipe, runs)
      if (shortfall.length === 0) return made

      let progressed = false

      for (const part of shortfall) {
        if (context.signal.aborted) break
        const sub = mcData.items[part.id]
        if (!sub) break

        let subRecipes = bot.recipesFor(sub.id, null, 1, table ?? null)
        if (!subRecipes || subRecipes.length === 0) {
          // The part itself may need making first.
          made.push(...(await supplyIngredients(context, sub, table, depth - 1, part.count)))
          subRecipes = bot.recipesFor(sub.id, null, 1, table ?? null)
        }
        if (!subRecipes || subRecipes.length === 0) continue

        const perCraft = Math.max(1, subRecipes[0].result?.count ?? 1)
        const batches = Math.max(1, Math.ceil(part.count / perCraft))
        try {
          await withTimeout(
            bot.craft(subRecipes[0], batches, table ?? null),
            ACTION_TIMEOUT_MS,
            `crafting ${sub.name}`
          )
          await new Promise((r) => setTimeout(r, 150))
          made.push(`${batches * perCraft}x ${sub.name}`)
          progressed = true
        } catch {
          continue
        }
      }

      // Did that make the thing we actually came for possible?
      const now = bot.recipesFor(itemType.id, null, 1, table ?? null)
      if (now && now.length > 0) return made

      // Nothing was made this pass, so another will not help either.
      if (!progressed) break
    }
  }

  return made
}

/**
 * Gets out of a boat.
 *
 * Leaving is a sneak, and mineflayer's own `dismount` sends the input packet
 * with the jump flag set instead of the shift flag. The right packet is sent
 * here first, with the library call kept as a fallback.
 *
 * Success is judged by whether the bot can walk, not by `bot.vehicle`, which
 * stayed set after every method tried even while the bot plainly walked around
 * under its own steam — a passenger cannot move independently of its boat, so
 * taking a step is the honest test.
 */
async function leaveBoat(bot: any): Promise<boolean> {
  const canWalk = async (): Promise<boolean> => {
    const from = bot.entity.position.clone()
    bot.setControlState('forward', true)
    await new Promise((r) => setTimeout(r, 600))
    bot.setControlState('forward', false)
    await new Promise((r) => setTimeout(r, 200))
    return bot.entity.position.distanceTo(from) > 0.35
  }

  const attempts: Array<() => Promise<void>> = [
    async () => {
      // Sneak, which in 1.21.6+ is the shift flag on the input packet.
      bot.setControlState('sneak', true)
      await new Promise((r) => setTimeout(r, 400))
      bot.setControlState('sneak', false)
    },
    async () => {
      for (let n = 0; n < 4; n++) {
        bot._client.write('player_input', { inputs: { shift: true } })
        await new Promise((r) => setTimeout(r, 120))
      }
      bot._client.write('player_input', { inputs: {} })
    },
    async () => bot.dismount()
  ]

  for (const attempt of attempts) {
    try {
      await attempt()
    } catch {
      continue
    }
    await new Promise((r) => setTimeout(r, 500))
    if (await canWalk()) return true
  }

  return false
}

/**
 * How many items one unit of each fuel will smelt, best first.
 *
 * The old code took whichever of four fuels it happened to be carrying and put
 * in `wanted / 8 + 1` of it, on the assumption that every fuel smelts eight
 * items. Coal does; wood does not. Asked for five iron with two oak planks in
 * the bag, the bot burned both planks — three items' worth — smelted three and
 * reported success, leaving the rest sitting in the furnace.
 *
 * Lava buckets and coal blocks are deliberately absent: both work, but neither
 * is worth spending on a handful of ingots.
 */
const FUEL_YIELD: Array<{ match: RegExp; smelts: number }> = [
  { match: /^(coal|charcoal)$/, smelts: 8 },
  { match: /^blaze_rod$/, smelts: 12 },
  { match: /^dried_kelp_block$/, smelts: 20 },
  { match: /_(log|wood|stem|hyphae)$/, smelts: 1.5 },
  { match: /_planks$/, smelts: 1.5 },
  { match: /^(bamboo|stick)$/, smelts: 0.5 }
]

/** The best fuel carried, and how much of it this job needs. */
function chooseFuel(bot: any, wanted: number): { item: any; use: number; smelts: number } | null {
  for (const kind of FUEL_YIELD) {
    const item = bot.inventory.items().find((i: any) => kind.match.test(i.name))
    if (!item) continue

    const needed = Math.ceil(wanted / kind.smelts)
    const use = Math.min(item.count, needed)
    return { item, use, smelts: Math.floor(use * kind.smelts) }
  }
  return null
}

export const TOOLS: Tool[] = [
  {
    schema: {
      name: 'say',
      description: 'Say something in Minecraft chat so the player can read it. Use this to reply, ask questions, or report what you are doing.',
      parameters: {
        type: 'object',
        properties: { message: { type: 'string', description: 'What to say. Keep it short and natural.' } },
        required: ['message']
      }
    },
    execute: async ({ bot }, { message }) => {
      const text = String(message ?? '').slice(0, 240)
      if (!text) return 'nothing to say'
      bot.chat(text)
      return `said: ${text}`
    }
  },

  {
    schema: {
      name: 'look_around',
      description: 'Observe the surroundings: position, health, time of day, nearby players, mobs and notable blocks. Use this when you need to know what is going on.',
      parameters: { type: 'object', properties: {} }
    },
    execute: async ({ bot }) => {
      const pos = bot.entity.position
      const entities = Object.values(bot.entities) as any[]

      const mobs = entities
        .filter((e) => e.type === 'mob' && e.position.distanceTo(pos) < 24)
        .map((e) => `${e.name} at ${Math.round(e.position.distanceTo(pos))}m`)
        .slice(0, 8)

      const players = nearbyPlayers(bot)
        .map((name) => {
          const entity = bot.players[name]?.entity
          return entity ? `${name} at ${Math.round(entity.position.distanceTo(pos))}m` : `${name} (out of range)`
        })
        .slice(0, 6)

      const drops = entities.filter((e) => e.name === 'item' && e.position.distanceTo(pos) < 16).length

      /*
       * Say what is being worn. Armour was invisible to the model: it never
       * appeared here, and it is not in the inventory once equipped, so the
       * only way to find out was to try putting some on and read the reply.
       */
      const armour = wornArmour(bot)

      return [
        `position ${Math.round(pos.x)} ${Math.round(pos.y)} ${Math.round(pos.z)}`,
        `health ${Math.round(bot.health)}/20, food ${Math.round(bot.food)}/20`,
        armour.length > 0 ? `wearing ${armour.join(', ')}` : 'wearing no armour',
        `time ${bot.time.timeOfDay < 12000 ? 'day' : 'night'}`,
        // Game mode changes what is even possible: creative drops nothing when
        // you mine, so the model needs to know which world it is in.
        `mode ${gameModeName(bot)}`,
        // Night with hostiles about is the single most useful thing to know,
        // and "time night" alone did not say whether anything was hunting.
        ...(() => {
          const threats = nearbyThreats(bot)
          if (threats.length > 0) return [`THREATS: ${threats.join(', ')}`]
          if (bot.time.timeOfDay >= 12000) return ['no hostiles in sight, but it is night — they spawn in the dark']
          return []
        })(),
        `players: ${players.length ? players.join(', ') : 'none nearby'}`,
        `mobs: ${mobs.length ? mobs.join(', ') : 'none nearby'}`,
        `dropped items nearby: ${drops}`,
        `inventory: ${itemCounts(bot)}`
      ].join('\n')
    }
  },

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
      name: 'collect_nearby_items',
      description: 'Walk over and pick up dropped items lying on the ground nearby.',
      parameters: { type: 'object', properties: {} }
    },
    execute: async (context) => {
      const collected = await collectDropsNear(context, 24)
      if (collected === 0) return 'no dropped items nearby'
      return `walked over ${collected} dropped item stacks. Inventory: ${itemCounts(context.bot)}`
    }
  },

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

      try {
        await withTimeout(bot.craft(recipes[0], batches, table ?? null), ACTION_TIMEOUT_MS, 'crafting')
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

        return `crafted ${batches * perCraft}x ${name}. Inventory: ${itemCounts(bot)}`
      } catch (err) {
        return `crafting ${name} failed: ${(err as Error).message}`
      }
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
      name: 'attack_nearest',
      description: 'Attack the nearest hostile mob, or a named mob type. Equips the best weapon first.',
      parameters: {
        type: 'object',
        properties: { mob: { type: 'string', description: 'Optional mob name, e.g. zombie' } }
      }
    },
    execute: async (context, { mob }) => {
      const { bot, signal } = context
      const wanted = mob ? String(mob).replace(/^minecraft:/, '') : null

      /*
       * Only hostiles are attacked unless a mob is named outright. Matching on
       * `type === 'mob'` swept in cows, sheep and villagers, so an unqualified
       * "defend me" could have the companion slaughtering the player's own farm.
       */
      const target = bot.nearestEntity(
        (e: any) =>
          (wanted ? e.name === wanted : isHostile(e)) && e.position.distanceTo(bot.entity.position) < 24
      )
      if (!target) return wanted ? `no ${wanted} nearby` : 'no hostile mobs nearby'

      const weapon = bestWeapon(bot)
      if (weapon) {
        try {
          await bot.equip(weapon, 'hand')
        } catch (err) {
          context.log(`could not draw ${weapon.name}: ${(err as Error).message}`)
        }
      }

      // Armour first. Fighting in a shirt while carrying a full set is the
      // single most common way for the bot to die pointlessly.
      const worn = await wearBestArmour(bot)
      if (worn.length > 0) context.log(`put on ${worn.join(', ')} before fighting`)

      let problem = ''
      let brokeOff = false
      let healthAtBreak = 20
      let hits = 0
      let crits = 0
      const deadline = Date.now() + 20_000

      /*
       * Chase with a goal that tracks the target rather than pathing to where
       * it stood a moment ago.
       *
       * Walking to a fixed position is hopeless against anything that moves:
       * the bot arrived at empty ground, the path expired, and every fight
       * ended "could not finish the skeleton: walking there took too long"
       * without a blow landed. GoalFollow is recomputed as the target moves,
       * and runs in the background while this loop swings whenever in range.
       */
      const { goals } = context
      bot.pathfinder.setGoal(new goals.GoalFollow(target, 2), true)

      try {
        while (target.isValid && Date.now() < deadline && !signal.aborted) {
          /*
           * Know when to stop. Without this the bot fought to the death every
           * time, because nothing in the loop ever looked at its own health.
           */
          if (bot.health <= RETREAT_HEALTH) {
            // Capture it now: by the time this is reported the bot has fled and
            // eaten, so reading it later claimed it broke off at full health.
            brokeOff = true
            healthAtBreak = bot.health
            break
          }

          let waited = 200

          if (bot.entity.position.distanceTo(target.position) <= 3.5) {
            try {
              await bot.lookAt(target.position.offset(0, target.height * 0.5, 0))
              const crit = await criticalStrike(bot, target)
              if (crit) crits++
              hits++
              // Wait out the cooldown before swinging again, or the next blow
              // lands for a fraction of its damage.
              waited = swingInterval(bot)
            } catch (err) {
              problem = (err as Error).message
            }
          }

          await new Promise((r) => setTimeout(r, waited))
        }
      } finally {
        // Always drop the chase goal, or the bot keeps trailing the mob after
        // the tool has returned and looks possessed.
        bot.pathfinder.setGoal(null)
      }

      if (brokeOff) {
        /*
         * Actually leave. Stopping the attack loop and telling the model to
         * "get away" is not the same as getting away — the mob carries on
         * hitting a bot that is standing still deciding what to do next.
         */
        let fled = 0
        try {
          const here = bot.entity.position
          const away = here.minus(target.position).normalize().scaled(FLEE_DISTANCE)
          await goTo(context, here.x + away.x, here.y, here.z + away.z, 2, MOVE_TO_PLACE_TIMEOUT_MS)
          fled = Math.round(bot.entity.position.distanceTo(target.position))
        } catch {
          /* cornered on foot — going up is the way out */
        }

        /*
         * If backing away did not work, build upwards instead. Zombies keep
         * pace with a walking player, so a cornered bot that only knew how to
         * run was killed every time; three blocks of tower puts it beyond
         * anything that cannot climb.
         */
        let tower = 0
        if (fled < 4) {
          tower = await pillarUp(bot, 3)
          if (tower > 0) context.log(`walled up ${tower} blocks high to break contact`)
        }

        // Then eat, so the next decision is made at better health.
        const food = bot.inventory.items().find((i: any) => EDIBLE.test(i.name))
        if (food && bot.food < 20) {
          try {
            await bot.equip(food, 'hand')
            await bot.consume()
          } catch {
            /* eating can fail mid-fight; the retreat still stands */
          }
        }

        const health = Math.round(healthAtBreak)
        if (fled >= 4) return `broke off the fight with ${target.name} at ${health}/20 health and backed off ${fled} blocks.`
        if (tower > 0) {
          return `broke off the fight with ${target.name} at ${health}/20 health and towered ${tower} blocks up out of reach. Heal, then come down.`
        }
        return `broke off the fight with ${target.name} at ${health}/20 health but could not get clear and had nothing to build with — cornered.`
      }

      if (!target.isValid) {
        return `killed ${target.name}${weapon ? ` with ${weapon.name}` : ' bare-handed'} — ${hits} hits, ${crits} of them critical`
      }
      return problem
        ? `could not finish the ${target.name}: ${problem}`
        : `fought ${target.name} but it is still alive`
    }
  },

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
  },

  {
    schema: {
      name: 'run_command',
      description:
        'Run a Minecraft command, such as "time set day", "weather clear" or "tp Steve". Only works if the server has made this bot an operator. Do not use it to obtain items or win fights in survival — mine and craft instead.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The command without the leading slash, e.g. time set day' }
        },
        required: ['command']
      }
    },
    execute: async ({ bot }, { command }) => {
      const text = String(command ?? '')
        .trim()
        .replace(/^\//, '')
      if (!text) return 'run_command needs a command'

      const verb = text.split(/\s+/)[0].toLowerCase()

      /*
       * Administrative and irreversible commands are refused outright. The model
       * is not malicious, but it is confused often enough that "it seemed like a
       * good idea" should not be able to ban a player, wipe a world or strip the
       * owner's operator status.
       */
      if (FORBIDDEN_COMMANDS.has(verb)) {
        return `refusing to run "${verb}" — that one can lock people out or destroy things that cannot be undone. Ask the player to run it themselves.`
      }

      if (text.length > 200) return 'that command is too long'

      bot.chat(`/${text}`)
      /*
       * The server replies in chat rather than to the sender, and there is no
       * acknowledgement packet to await, so this reports what was sent rather
       * than claiming it worked.
       */
      return `sent "/${text}". If nothing changed, this bot is probably not an operator on the server.`
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
          toY: { type: 'number', description: 'Depth to stop at, e.g. 12 for diamonds or -20 for deepslate' }
        },
        required: ['toY']
      }
    },
    execute: async (context, { toY }) => {
      const { bot, signal } = context
      const { Vec3 } = require('vec3')

      const target = Math.max(-60, Math.min(Number(toY), 320))
      const start = Math.floor(bot.entity.position.y)
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

      homePosition = home
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

      const home = homePosition ?? rememberedHome(memory ?? [])
      if (!home) return 'no home set. Stand somewhere worth returning to and use set_home.'
      homePosition = home

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
      name: 'inventory',
      description: 'List everything currently carried.',
      parameters: { type: 'object', properties: {} }
    },
    execute: async ({ bot }) => `carrying: ${itemCounts(bot)}`
  },

  {
    schema: {
      name: 'remember',
      description: 'Save a durable note — a base location, a promise made, something learned. Notes survive restarts and are shown to you every turn.',
      parameters: {
        type: 'object',
        properties: { note: { type: 'string', description: 'A short fact worth keeping' } },
        required: ['note']
      }
    },
    execute: async ({ addMemory }, { note }) => {
      const text = String(note ?? '').slice(0, 200)
      if (!text) return 'nothing to remember'
      addMemory(text)
      return `remembered: ${text}`
    }
  },

  {
    schema: {
      name: 'set_goal',
      description: 'Record what you are currently working towards, so you keep track across turns. Set it to an empty string when finished.',
      parameters: {
        type: 'object',
        properties: { goal: { type: 'string', description: 'The current objective' } },
        required: ['goal']
      }
    },
    execute: async ({ setGoal }, { goal }) => {
      const text = String(goal ?? '').slice(0, 160)
      setGoal(text || null)
      return text ? `working towards: ${text}` : 'goal cleared'
    }
  },

  {
    schema: {
      name: 'wait',
      description: 'Do nothing for a few seconds. Use when there is genuinely nothing worth doing.',
      parameters: {
        type: 'object',
        properties: { seconds: { type: 'number', description: 'How long to wait, up to 30' } }
      }
    },
    execute: async ({ signal }, { seconds }) => {
      const ms = Math.max(1, Math.min(Number(seconds) || 5, 30)) * 1000
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, ms)
        signal.addEventListener('abort', () => {
          clearTimeout(timer)
          resolve(null)
        }, { once: true })
      })
      return 'waited'
    }
  }
]

export const TOOL_SCHEMAS: ToolSchema[] = TOOLS.map((t) => t.schema)

/* ------------------------------------------------------------ tool sets */

/**
 * A smaller set of tools for smaller models.
 *
 * The full set is thirty tools and roughly 2,300 tokens of schema on every
 * request, before any conversation. Large hosted models cope; a 7B local model
 * given that many choices tends to stall, invent tool names, or mix up
 * arguments. These fourteen cover the whole survival loop — look, move, gather,
 * craft, build, fight, eat — and leave out the specialist ones a small model
 * rarely picks correctly anyway.
 */
export const CORE_TOOL_NAMES = [
  'say',
  'look_around',
  'inventory',
  'come_to_player',
  'follow_player',
  'explore',
  'mine_block',
  'collect_nearby_items',
  'craft_item',
  'place_block',
  'equip',
  'attack_nearest',
  'eat_food',
  'set_goal'
]

export type ToolSetName = 'full' | 'core'

export function schemasFor(set: ToolSetName): ToolSchema[] {
  if (set !== 'core') return TOOL_SCHEMAS
  return TOOL_SCHEMAS.filter((schema) => CORE_TOOL_NAMES.includes(schema.name))
}

export function findTool(name: string): Tool | undefined {
  return TOOLS.find((t) => t.schema.name === name)
}
