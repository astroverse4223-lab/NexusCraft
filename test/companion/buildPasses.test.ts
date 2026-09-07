import { describe, expect, it, vi } from 'vitest'
import type { Blueprint } from '../../src/main/companion/build/blueprint'

/**
 * Building something whose blocks do not come in a placeable order.
 *
 * The reported failure: "Oak Cottage: placed 56 of 168 blocks; 99 failed;
 * stopped: 12 placements in a row failed — nothing solid next to 223 77 1222
 * to build against". Every one of those refusals was a block whose support came
 * later in the blueprint, and the builder never went back for them.
 *
 * The world here is a small fake carrying Minecraft's actual rule: a block may
 * only be placed where something solid already touches the spot.
 */

const solid = new Set<string>()
const key = (x: number, y: number, z: number): string => `${x},${y},${z}`

function touching(x: number, y: number, z: number): boolean {
  return (
    solid.has(key(x, y - 1, z)) ||
    solid.has(key(x, y + 1, z)) ||
    solid.has(key(x - 1, y, z)) ||
    solid.has(key(x + 1, y, z)) ||
    solid.has(key(x, y, z - 1)) ||
    solid.has(key(x, y, z + 1))
  )
}

// Hoisted above the import of the builder, so it sees the fake tool. The
// builder reaches for the registry directly, so that is what must be replaced.
vi.mock('../../src/main/companion/tools/registry', () => ({
  registerTools: () => {},
  findTool: (name: string) =>
    name === 'place_block'
      ? {
          schema: { name: 'place_block', description: '', parameters: {} },
          execute: async (_context: unknown, args: Record<string, number>) => {
            const { x, y, z } = args
            if (solid.has(key(x, y, z))) return `stone is already at ${x} ${y} ${z}`
            if (!touching(x, y, z)) return `nothing solid next to ${x} ${y} ${z} to build against`
            solid.add(key(x, y, z))
            return `placed stone at ${x} ${y} ${z}`
          }
        }
      : undefined,
  allTools: () => []
}))

const { buildBlueprint } = await import('../../src/main/companion/build/builder')

const GROUND = 64

function context(): any {
  return {
    bot: {
      version: '1.21.11',
      game: { gameMode: 'survival' },
      entity: { position: { x: 0, y: GROUND, z: 0, distanceTo: () => 1 } },
      inventory: { items: () => [], firstEmptyInventorySlot: () => 0 },
      blockAt: (pos: { x: number; y: number; z: number }) => {
        const there = solid.has(key(pos.x, pos.y, pos.z))
        return { name: there ? 'stone' : 'air', position: pos, boundingBox: there ? 'block' : 'empty' }
      }
    },
    mcData: {},
    goals: null,
    Movements: null,
    owner: null,
    log: () => {},
    addMemory: () => {},
    setGoal: () => {},
    signal: new AbortController().signal,
    llm: null
  }
}

function floor(): void {
  solid.clear()
  for (let x = -3; x <= 5; x += 1) {
    for (let z = -3; z <= 5; z += 1) solid.add(key(x, GROUND - 1, z))
  }
}

/**
 * An overhang listed before the pillar that ends up holding it.
 *
 * Layer order is bottom-up, and within a layer it is row by row — so the far
 * side of the top course is reached before the near pillar exists to hang it
 * from. Exactly the shape that failed in the cottage roof.
 */
const AWKWARD: Blueprint = {
  name: 'Awkward Arch',
  description: 'An overhang listed before its support',
  palette: { s: 'stone' },
  layers: [['s.s'], ['s.s'], ['sss']]
}

describe('building blocks whose support comes later', () => {
  it('completes the shape rather than giving up part-built', async () => {
    floor()
    const result = await buildBlueprint(context(), AWKWARD, { origin: { x: 0, y: GROUND, z: 0 } })

    expect(result.placed + result.skipped).toBe(result.total)
    expect(result.stoppedBecause).toBeNull()
  })

  it('reports honestly when the ground genuinely cannot be built on', async () => {
    // No floor at all: nothing anywhere for the first course to sit against.
    solid.clear()
    const result = await buildBlueprint(context(), AWKWARD, { origin: { x: 0, y: GROUND, z: 0 } })

    expect(result.placed).toBe(0)
    expect(result.stoppedBecause).toMatch(/nothing solid next to|mid-air/)
  })

  it('does not report a failure count for blocks a later pass placed', async () => {
    floor()
    const result = await buildBlueprint(context(), AWKWARD, { origin: { x: 0, y: GROUND, z: 0 } })

    // The old behaviour counted every attempt, so a finished build could still
    // claim ninety-nine failures.
    expect(result.failed).toBe(0)
  })
})
