import type { ToolContext } from './tools'
import { findTool } from './tools'

/**
 * Workers that follow a script instead of thinking.
 *
 * A language model is wonderful when the job is open-ended and hopeless when it
 * is not: chopping wood for an hour needs no judgement, and paying a model to
 * rediscover that every thirty seconds is slow, costly and less reliable than a
 * loop. These drive exactly the same tools the companion uses, with a routine in
 * place of the model — no API key, no latency, and the same thing every time.
 *
 * A routine is deliberately simple: a name, a description, and a step that gets
 * called over and over until it is told to stop. Anything it wants to remember
 * between steps lives in its own closure.
 */

export interface RoutineContext extends ToolContext {
  /** Says something in chat, sparingly — nobody wants a narrating robot. */
  announce: (text: string) => void
}

export interface Routine {
  id: string
  label: string
  /** What it does, in a sentence, for the interface. */
  description: string
  /** What it needs to be useful, if anything. */
  needs?: string
  /**
   * One pass of the work. Returning 'stop' ends the routine; anything else and
   * it is called again after a breath.
   */
  step: (context: RoutineContext, memory: Record<string, unknown>) => Promise<'again' | 'stop'>
}

/** Runs a tool by name, returning its message. */
async function use(
  context: RoutineContext,
  name: string,
  args: Record<string, unknown> = {}
): Promise<string> {
  const tool = findTool(name)
  if (!tool) return `no tool called ${name}`
  try {
    return String(await tool.execute(context, args))
  } catch (err) {
    return `failed: ${(err as Error).message}`
  }
}

/** Whether a tool's reply reads like it got nowhere. */
function failed(reply: string): boolean {
  return /^(failed|could not|no |nothing|there is no)/i.test(reply.trim())
}

/**
 * Makes sure the worker is holding the tool its job needs, making one if not.
 *
 * Both of the gathering routines used to assume someone had handed them a tool.
 * Without one the miner spent a hundred seconds reporting that iron ore "needs a
 * better tool" over and over and came back with two dirt, which is a poor sort
 * of worker. A person given an axe-less morning would go and make an axe.
 *
 * Wood first, because everything else follows from it: logs become planks,
 * planks and sticks become a wooden tool, and stone found along the way becomes
 * a better one.
 */
async function ensureTool(context: RoutineContext, kind: 'pickaxe' | 'axe'): Promise<boolean> {
  const has = (suffix: string): boolean =>
    context.bot.inventory.items().some((item: any) => item.name.endsWith(suffix))

  if (has(`_${kind}`)) return true

  context.log(`no ${kind} — making one`)

  // Wood, if there is none in the bag already.
  if (!has('_log') && !has('_planks')) {
    const woods = ['oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log']
    let got = false
    for (const wood of woods) {
      const reply = await use(context, 'mine_block', { block: wood, count: 4 })
      if (!failed(reply)) {
        got = true
        break
      }
    }
    if (!got) {
      await use(context, 'explore', { distance: 50 })
      return false
    }
  }

  // A wooden one is enough to start; stone follows once there is cobblestone.
  const wooden = await use(context, 'craft_item', { item: `wooden_${kind}`, count: 1 })
  if (failed(wooden)) {
    context.log(`could not make a wooden ${kind}: ${wooden}`)
    return false
  }
  context.log(wooden)

  /*
   * Upgrade straight away when the stone is there. A wooden pickaxe cannot
   * harvest iron at all, so a miner that stops at wood has not really been
   * equipped — it will mine ore and collect nothing, which is the very failure
   * this exists to prevent.
   */
  const stone = await use(context, 'mine_block', { block: 'stone', count: 6 })
  if (!failed(stone)) {
    const upgraded = await use(context, 'craft_item', { item: `stone_${kind}`, count: 1 })
    if (!failed(upgraded)) context.log(upgraded)
  }

  return has(`_${kind}`)
}

/**
 * Makes sure the worker has something to fight with.
 *
 * A bare fist does one point of damage. A spider has sixteen, so a guard with
 * empty hands swings for twenty seconds, runs out of time and reports that it
 * "fought spider but it is still alive" — which is exactly what happened, three
 * engagements running, while the spider walked away each time. A stone sword
 * does seven and ends the argument in three hits.
 */
async function ensureWeapon(context: RoutineContext): Promise<boolean> {
  const has = (suffix: string): boolean =>
    context.bot.inventory.items().some((item: any) => item.name.endsWith(suffix))

  if (has('_sword') || has('_axe')) return true

  context.log('nothing to fight with — making a sword')

  if (!has('_log') && !has('_planks')) {
    const woods = ['oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log']
    let got = false
    for (const wood of woods) {
      if (!failed(await use(context, 'mine_block', { block: wood, count: 3 }))) {
        got = true
        break
      }
    }
    if (!got) return false
  }

  const wooden = await use(context, 'craft_item', { item: 'wooden_sword', count: 1 })
  if (failed(wooden)) {
    context.log(`could not make a sword: ${wooden}`)
    return false
  }
  context.log(wooden)

  // Stone is worth the extra minute: five damage against a wooden sword's four,
  // and it lasts more than twice as long.
  if (!failed(await use(context, 'mine_block', { block: 'stone', count: 4 }))) {
    const better = await use(context, 'craft_item', { item: 'stone_sword', count: 1 })
    if (!failed(better)) context.log(better)
  }

  return has('_sword')
}

/* ------------------------------------------------------------- routines */

const lumberjack: Routine = {
  id: 'lumberjack',
  label: 'Lumberjack',
  description: 'Chops down trees, replants a sapling where each one stood, and keeps going.',
  needs: 'An axe helps but is not required.',

  async step(context, memory) {
    // An axe roughly triples the rate, and chopping by hand times out on the
    // harder woods.
    if (!memory.toolChecked) {
      memory.toolChecked = await ensureTool(context, 'axe')
      return 'again'
    }

    const woods = ['oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log']
    const canopy = [
      'oak_leaves',
      'birch_leaves',
      'spruce_leaves',
      'jungle_leaves',
      'acacia_leaves',
      'dark_oak_leaves'
    ]

    for (const wood of woods) {
      const reply = await use(context, 'mine_block', { block: wood, count: 16 })

      if (!failed(reply)) {
        context.log(reply)

        // Put something back. A lumberjack who clears the forest is a one-off.
        const sapling = wood.replace('_log', '_sapling')
        const planted = await use(context, 'plant_crop', { crop: sapling })
        if (!failed(planted)) context.log(planted)

        memory.trees = ((memory.trees as number) ?? 0) + 1
        return 'again'
      }

      /*
       * Trees found but none reachable means the canopy is in the way.
       *
       * Felling a trunk leaves its leaves hanging in the air, and the logs
       * further up are then behind a wall of them — the bot stands underneath
       * shuffling at a branch it cannot get to. A real lumberjack cuts through
       * the leaves; so does this one, and they give back saplings and sticks
       * for the trouble.
       */
      if (/could not reach|found \d+x/i.test(reply)) {
        context.log('canopy in the way — clearing leaves')
        for (const leaves of canopy) {
          const cut = await use(context, 'mine_block', { block: leaves, count: 12 })
          if (!failed(cut)) {
            context.log(cut)
            return 'again'
          }
        }
      }
    }

    // Nothing in reach: go and look somewhere else.
    context.log('no trees nearby, moving on')
    await use(context, 'explore', { distance: 60 })
    return 'again'
  }
}

const miner: Routine = {
  id: 'miner',
  label: 'Miner',
  description: 'Digs down to ore height, works whatever veins it finds, and brings the lot back up.',
  needs: 'A stone pickaxe or better.',

  async step(context, memory) {
    const ores = [
      'diamond_ore',
      'deepslate_diamond_ore',
      'iron_ore',
      'deepslate_iron_ore',
      'gold_ore',
      'coal_ore',
      'deepslate_coal_ore',
      'copper_ore'
    ]

    // Without a pickaxe there is no point going anywhere: ore mined by hand
    // drops nothing at all.
    if (!memory.toolChecked) {
      memory.toolChecked = await ensureTool(context, 'pickaxe')
      return 'again'
    }

    // Get down to where the ore is, once.
    if (!memory.descended) {
      const here = context.bot.entity.position.y
      if (here > 20) {
        // Down to where the ore is, rather than a fixed number of blocks.
        context.log(await use(context, 'dig_down', { toY: 12 }))
      }
      memory.descended = true
      return 'again'
    }

    for (const ore of ores) {
      const reply = await use(context, 'mine_block', { block: ore, count: 24 })
      if (!failed(reply)) {
        context.log(reply)
        return 'again'
      }
    }

    // Nothing left in reach — tunnel a little further along and look again.
    context.log('no ore in reach, moving along the seam')
    await use(context, 'explore', { distance: 30 })
    return 'again'
  }
}

const farmer: Routine = {
  id: 'farmer',
  label: 'Farmer',
  description: 'Harvests crops that are ready and replants them, round and round.',
  needs: 'A field with something growing, and seeds to put back.',

  async step(context, memory) {
    const harvested = await use(context, 'harvest_crop', {})
    if (!failed(harvested)) {
      context.log(harvested)
      memory.harvests = ((memory.harvests as number) ?? 0) + 1
      memory.reportedEmpty = false

      const planted = await use(context, 'plant_crop', {})
      if (!failed(planted)) context.log(planted)
      return 'again'
    }

    /*
     * Nothing ripe. Say so once rather than standing in silence — a farmer with
     * no field looks identical to a broken one, and the test run produced a
     * single line of output in eighty seconds.
     */
    if (!memory.reportedEmpty) {
      context.log(`nothing ready to harvest: ${harvested}`)
      memory.reportedEmpty = true
    }

    // Crops take their time; waiting costs nothing and trudging about does.
    await use(context, 'wait', { seconds: 20 })
    return 'again'
  }
}

const guard: Routine = {
  id: 'guard',
  label: 'Guard',
  description: 'Sticks close to you and attacks anything hostile that comes near.',
  needs: 'A sword and armour, ideally.',

  async step(context, memory) {
    // A guard with nothing to hit things with is just a witness.
    if (!memory.armed) {
      memory.armed = await ensureWeapon(context)
      if (memory.armed) return 'again'
    }

    // Armour first, every time — it may have been picked up since the last pass.
    await use(context, 'equip_armor', {})

    // Hold the weapon, not whatever the last job left in hand.
    const weapon = context.bot.inventory
      .items()
      .find((item: any) => item.name.endsWith('_sword') || item.name.endsWith('_axe'))
    if (weapon && context.bot.heldItem?.name !== weapon.name) {
      try {
        await context.bot.equip(weapon, 'hand')
      } catch {
        /* it will still swing with whatever it is holding */
      }
    }

    const fight = await use(context, 'attack_nearest', {})
    if (!failed(fight)) {
      context.log(fight)
      return 'again'
    }

    // Nothing to fight: get back to the person being guarded.
    const owner = context.owner
    if (owner) {
      const near = await use(context, 'come_to_player', { username: owner })
      if (failed(near)) context.log(near)
    }

    await use(context, 'wait', { seconds: 3 })
    return 'again'
  }
}

const porter: Routine = {
  id: 'porter',
  label: 'Porter',
  description: 'Follows you, picks up anything dropped nearby, and puts it in a chest when full.',
  needs: 'A chest somewhere near where it started.',

  async step(context, memory) {
    const picked = await use(context, 'collect_nearby_items', {})
    if (!failed(picked)) context.log(picked)

    // A full bag is no use to anyone; empty it and carry on.
    const slotsUsed = context.bot.inventory.items().length
    if (slotsUsed >= 30) {
      const stored = await use(context, 'store_items', {})
      context.log(stored)
      memory.trips = ((memory.trips as number) ?? 0) + 1
    }

    const owner = context.owner
    if (owner) await use(context, 'come_to_player', { username: owner })
    await use(context, 'wait', { seconds: 4 })
    return 'again'
  }
}

const nightWatch: Routine = {
  id: 'night-watch',
  label: 'Night watch',
  description: 'Lights the area with torches and deals with anything that spawns in the dark.',
  needs: 'Torches, or coal and sticks to make them.',

  async step(context, memory) {
    // Same problem as the guard: without a weapon it swings all night and kills
    // nothing.
    if (!memory.armed) {
      memory.armed = await ensureWeapon(context)
      if (memory.armed) return 'again'
    }

    const fight = await use(context, 'attack_nearest', {})
    if (!failed(fight)) {
      context.log(fight)
      return 'again'
    }

    // Quiet: put a torch down. Light is what stops the next one arriving.
    const torches = context.bot.inventory.items().find((item: any) => item.name === 'torch')
    if (!torches) {
      /*
       * Torches need coal and sticks, and a watchman who waits to be handed
       * them lights nothing at all — the routine reported "nothing to make one
       * from" every ten seconds for the whole test. Fetch the parts first.
       */
      const hasCoal = context.bot.inventory.items().some((i: any) => i.name === 'coal' || i.name === 'charcoal')
      if (!hasCoal) {
        const coal = await use(context, 'mine_block', { block: 'coal_ore', count: 4 })
        if (failed(coal)) {
          context.log('no coal about — cannot make torches yet')
          await use(context, 'wait', { seconds: 15 })
          return 'again'
        }
        context.log(coal)
      }

      const made = await use(context, 'craft_item', { item: 'torch', count: 16 })
      if (failed(made)) {
        await use(context, 'wait', { seconds: 10 })
        return 'again'
      }
      context.log(made)
    }

    const here = context.bot.entity.position
    const placed = await use(context, 'place_block', {
      block: 'torch',
      x: Math.floor(here.x) + 2,
      y: Math.floor(here.y),
      z: Math.floor(here.z)
    })
    if (!failed(placed)) context.log(placed)

    await use(context, 'explore', { distance: 12 })
    return 'again'
  }
}

export const ROUTINES: Routine[] = [lumberjack, miner, farmer, guard, porter, nightWatch]

export function findRoutine(id: string): Routine | undefined {
  return ROUTINES.find((routine) => routine.id === id)
}

/**
 * Drives a routine until it is told to stop.
 *
 * Each pass is wrapped, because a routine that throws should pause and try
 * again rather than take the whole worker down — a tree that turned out to be
 * unreachable is not a reason to stop being a lumberjack.
 */
export class RoutineRunner {
  private stopped = false
  private readonly memory: Record<string, unknown> = {}

  constructor(
    private readonly routine: Routine,
    private readonly context: RoutineContext,
    private readonly onError: (message: string) => void
  ) {}

  /** Which routine this is following, for messages about what it can accept. */
  get routineId(): string {
    return this.routine.id
  }

  async run(): Promise<void> {
    this.context.log(`started as a ${this.routine.label.toLowerCase()}`)

    while (!this.stopped) {
      try {
        const verdict = await this.routine.step(this.context, this.memory)
        if (verdict === 'stop') break
      } catch (err) {
        this.onError(`${this.routine.label} stumbled: ${(err as Error).message}`)
        await new Promise((resolve) => setTimeout(resolve, 5_000))
      }

      // A breath between passes, so a routine that finds nothing to do does not
      // spin the process at full tilt.
      await new Promise((resolve) => setTimeout(resolve, 1_200))
    }

    this.context.log(`stopped being a ${this.routine.label.toLowerCase()}`)
  }

  stop(): void {
    this.stopped = true
  }
}
