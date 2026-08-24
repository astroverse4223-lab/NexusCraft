/**
 * Questions about blocks and space: what can be replaced, where the bot can
 * stand, and what game mode it is in.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Whether a block can be built straight over. A block with an empty bounding
 * box takes up no space, which is exactly the set the game lets you replace.
 */
export function isReplaceable(block: any): boolean {
  if (!block) return true
  if (block.name === 'air' || block.name.includes('water')) return true
  return block.boundingBox === 'empty'
}

export function isCreative(bot: any): boolean {
  const listed = bot.players?.[bot.username]?.gamemode
  if (typeof listed === 'number') return listed === 1
  if (typeof listed === 'string') return listed === 'creative'
  return bot.game?.gameMode === 'creative'
}

/** The current game mode by the same reckoning, for reporting. */
export function gameModeName(bot: any): string {
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
export async function freeSpotBeside(bot: any): Promise<any | null> {
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
export function freeSpotsBeside(bot: any): any[] {
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
export function standingSpotNear(bot: any, target: any): any | null {
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
 * Whether the held tool will actually yield drops for this block.
 *
 * Minecraft silently gives nothing for stone broken by hand or ore broken with
 * the wrong tier. The bot happily reported "mined 10x stone" having collected
 * precisely nothing, which reads as success and is not.
 */
export function canHarvest(bot: any, block: any): boolean {
  const needed = block.harvestTools
  if (!needed) return true
  const held = bot.heldItem
  return Boolean(held && needed[held.type])
}
