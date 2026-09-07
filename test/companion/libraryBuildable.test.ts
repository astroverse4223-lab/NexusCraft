import { describe, expect, it, vi } from 'vitest'
import { BLUEPRINT_LIBRARY } from '../../src/main/companion/build/library'

/**
 * Every blueprint in the library, actually built.
 *
 * Validation checks a blueprint is well formed; this checks it can be put up.
 * They are different questions, and the difference is where the reported bug
 * lived: the Oak Cottage was perfectly valid and still came out as "placed 56
 * of 168 blocks; 99 failed", because blocks whose support came later in the
 * order had nowhere to attach.
 *
 * The world below is a fake carrying Minecraft's real placement rule — a block
 * needs something solid already touching the spot — over flat ground. It cannot
 * tell you a build looks good, but it will tell you if it is impossible.
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
const { blueprintSize } = await import('../../src/main/companion/build/blueprint')

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

describe('every library blueprint can be built on flat ground', () => {
  it.each(BLUEPRINT_LIBRARY.map((entry) => [entry.id, entry] as const))(
    '"%s" goes up complete',
    async (_id, entry) => {
      const size = blueprintSize(entry.blueprint)

      solid.clear()
      for (let x = -2; x <= size.width + 2; x += 1) {
        for (let z = -2; z <= size.depth + 2; z += 1) solid.add(key(x, GROUND - 1, z))
      }

      const result = await buildBlueprint(context(), entry.blueprint, {
        origin: { x: 0, y: GROUND, z: 0 }
      })

      expect(result.stoppedBecause).toBeNull()
      expect(
        result.placed + result.skipped,
        `${result.failed} of ${result.total} blocks had nowhere to attach`
      ).toBe(result.total)
    }
  )
})
