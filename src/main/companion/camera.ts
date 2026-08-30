/* eslint-disable @typescript-eslint/no-explicit-any */
import type { CameraFrame } from '@shared/companion'

/**
 * Bot cam: what the companion can see, sampled from the world it already knows.
 *
 * The bot keeps a loaded chunk cache in order to path and place blocks at all,
 * so a view costs a walk over that cache rather than anything new — no GL
 * context, no texture atlas, no extra process. What comes out is the same
 * information the bot navigates by, which is the honest thing to show for a
 * feature called "see what your companion sees".
 */

/** Edge length of the sampled square. Odd, so the bot has a true centre. */
const DEFAULT_SIZE = 41

/** How far down from the bot to look for a surface before giving up. */
const PROBE_DOWN = 24

/** How far up, so a bot in a cave still sees the ceiling it is under. */
const PROBE_UP = 8

/** Mobs that are worth marking in red. */
const HOSTILE = new Set([
  'zombie', 'skeleton', 'creeper', 'spider', 'enderman', 'witch', 'drowned', 'husk',
  'stray', 'phantom', 'pillager', 'vindicator', 'ravager', 'blaze', 'ghast',
  'zombified_piglin', 'piglin', 'hoglin', 'zoglin', 'slime', 'magma_cube',
  'cave_spider', 'silverfish', 'endermite', 'guardian', 'elder_guardian',
  'shulker', 'vex', 'evoker', 'warden', 'breeze', 'bogged'
])

function entityKind(entity: any): CameraFrame['entities'][number]['kind'] {
  if (entity.type === 'player') return 'player'
  if (entity.type === 'object' || entity.name === 'item') return 'item'
  const name = String(entity.name ?? '').toLowerCase()
  if (HOSTILE.has(name)) return 'hostile'
  if (entity.type === 'mob' || entity.type === 'animal') return 'passive'
  return 'other'
}

/**
 * Builds one frame.
 *
 * Column sampling starts at the bot's own feet and searches up first, then
 * down. Searching only downward drew a bot standing in a trench as if it were
 * on open ground, because the walls beside it were above the sample line.
 */
export function captureFrame(bot: any, size = DEFAULT_SIZE): CameraFrame | null {
  const position = bot.entity?.position
  if (!position) return null

  const { Vec3 } = require('vec3')

  const centreX = Math.floor(position.x)
  const centreY = Math.floor(position.y)
  const centreZ = Math.floor(position.z)
  const radius = Math.floor(size / 2)

  const columns: string[] = new Array(size * size).fill('')
  const heights: number[] = new Array(size * size).fill(centreY)

  for (let dz = -radius; dz <= radius; dz += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const index = (dz + radius) * size + (dx + radius)
      const x = centreX + dx
      const z = centreZ + dz

      let found = ''
      let foundY = centreY

      // Above the bot first — walls, overhangs, the roof of a cave.
      for (let y = centreY + PROBE_UP; y >= centreY - PROBE_DOWN; y -= 1) {
        const block = bot.blockAt(new Vec3(x, y, z))
        if (!block) continue
        const name = block.name
        if (!name || name === 'air' || name === 'cave_air' || name === 'void_air') continue
        found = name
        foundY = y
        break
      }

      columns[index] = found
      heights[index] = foundY
    }
  }

  const entities: CameraFrame['entities'] = []
  for (const entity of Object.values(bot.entities ?? {}) as any[]) {
    if (!entity?.position || entity.id === bot.entity.id) continue
    const dx = Math.round(entity.position.x - centreX)
    const dz = Math.round(entity.position.z - centreZ)
    if (Math.abs(dx) > radius || Math.abs(dz) > radius) continue

    entities.push({
      dx,
      dz,
      name: String(entity.username ?? entity.displayName ?? entity.name ?? 'something').slice(0, 24),
      kind: entityKind(entity)
    })
    if (entities.length >= 40) break
  }

  const held = bot.heldItem ?? bot.inventory?.slots?.[bot.quickBarSlot + 36]

  return {
    size,
    origin: { x: centreX, y: centreY, z: centreZ },
    columns,
    heights,
    yaw: typeof bot.entity.yaw === 'number' ? bot.entity.yaw : 0,
    entities,
    health: Math.round(bot.health ?? 0),
    food: Math.round(bot.food ?? 0),
    holding: held?.name ?? null,
    at: Date.now()
  }
}
