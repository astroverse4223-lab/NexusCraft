/**
 * Whether the bot is standing where it is trying to build.
 *
 * Minecraft refuses to place a block inside a player's collision box, exactly
 * as it refuses when you try it yourself. The builder had no idea: it walked
 * into the footprint, tried to fill the space it was occupying, got a refusal,
 * and — because nothing moved it — every later pass tried the same block from
 * the same spot and failed the same way. The result was a wall with a
 * bot-shaped hole in it that no amount of retrying would close.
 *
 * The geometry is kept here, away from mineflayer, so it can be tested against
 * plain numbers rather than a live server.
 */

/** A player is 0.6 across and 1.8 tall, standing with feet at `position`. */
export const PLAYER_WIDTH = 0.6
export const PLAYER_HEIGHT = 1.8

export interface Point {
  x: number
  y: number
  z: number
}

/**
 * Every block the bot's body currently intrudes into.
 *
 * The box is taken as slightly smaller than the true hitbox. A player standing
 * exactly on a block boundary technically touches the neighbouring column, and
 * counting that would rule out placements the server accepts perfectly well.
 */
export function occupiedBlocks(position: Point): Point[] {
  const half = PLAYER_WIDTH / 2 - 0.001
  const top = PLAYER_HEIGHT - 0.001

  const xs = new Set([Math.floor(position.x - half), Math.floor(position.x + half)])
  const zs = new Set([Math.floor(position.z - half), Math.floor(position.z + half)])
  const ys = new Set([Math.floor(position.y), Math.floor(position.y + top)])

  // A block between feet and head counts too, though at 1.8 tall there is
  // never more than one — kept general so a taller entity does not slip past.
  for (let y = Math.floor(position.y); y <= Math.floor(position.y + top); y += 1) ys.add(y)

  const blocks: Point[] = []
  for (const x of xs) for (const y of ys) for (const z of zs) blocks.push({ x, y, z })
  return blocks
}

/** True when `target` is inside the bot's own body. */
export function standingIn(position: Point, target: Point): boolean {
  const tx = Math.floor(target.x)
  const ty = Math.floor(target.y)
  const tz = Math.floor(target.z)
  return occupiedBlocks(position).some(
    (block) => block.x === tx && block.y === ty && block.z === tz
  )
}

/**
 * Candidate spots to step aside to, nearest first.
 *
 * Ordered by how far the bot has to move, then by distance from the target, so
 * it shuffles a step sideways rather than crossing the site — and stays close
 * enough that the block is still within arm's reach afterwards.
 *
 * Reach is measured from the eyes, but 4.0 from the feet is comfortably inside
 * the server's limit and leaves room for the bot to be standing a little off
 * the block centre.
 */
export function stepAsideSpots(position: Point, target: Point, reach = 4): Point[] {
  const from = { x: Math.floor(position.x), y: Math.floor(position.y), z: Math.floor(position.z) }
  const spots: Point[] = []

  for (let dx = -3; dx <= 3; dx += 1) {
    for (let dz = -3; dz <= 3; dz += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const spot = { x: from.x + dx, y: from.y + dy, z: from.z + dz }

        // Standing here must not put the body back inside the target.
        const centre = { x: spot.x + 0.5, y: spot.y, z: spot.z + 0.5 }
        if (standingIn(centre, target)) continue

        const dist = Math.hypot(centre.x - (target.x + 0.5), centre.y - target.y, centre.z - (target.z + 0.5))
        if (dist > reach) continue

        spots.push(spot)
      }
    }
  }

  const moved = (spot: Point): number =>
    Math.hypot(spot.x - position.x, spot.y - position.y, spot.z - position.z)
  const near = (spot: Point): number =>
    Math.hypot(spot.x - target.x, spot.y - target.y, spot.z - target.z)

  spots.sort((a, b) => moved(a) - moved(b) || near(a) - near(b))
  return spots
}
