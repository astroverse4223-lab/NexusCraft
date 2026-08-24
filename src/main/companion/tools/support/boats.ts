/**
 * Water crossings.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { isReplaceable } from './world'

export const BOAT_NAMES = /(^|_)boat$|_raft$/

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
export function openWaterNear(bot: any, radius = 7): Array<{ at: any; distance: number }> {
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
export async function leaveBoat(bot: any): Promise<boolean> {
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
