import { describe, expect, it } from 'vitest'
import { REDSTONE_LIBRARY } from '../../src/main/companion/build/redstone'
import { baseBlockName, blueprintBlocks } from '../../src/main/companion/build/blueprint'

/**
 * Does each circuit actually conduct?
 *
 * The library test checks that a blueprint is a well-formed box of real blocks.
 * That says nothing about whether it works: a lamp one block too far from the
 * dust is a perfectly valid structure that never lights. This test walks the
 * grid and asks, of every component that needs power, whether anything could
 * possibly deliver it.
 *
 * It models two ways power arrives: straight from an adjacent source, or
 * through one solid block that a source is attached to (a button on a wall
 * powering the dust on the far side). It deliberately does NOT model
 * quasi-connectivity, so a build that leans on it will fail here — which is the
 * right outcome, because QC is not something to rely on in a shared blueprint.
 *
 * A pass is not proof the circuit works. A failure is proof it does not.
 */

const SINKS = new Set([
  'redstone_lamp',
  'piston',
  'sticky_piston',
  'dispenser',
  'dropper',
  'note_block',
  'iron_trapdoor',
  'iron_door',
  'powered_rail',
  'bell',
  'tnt'
])

const SOURCES = new Set([
  'redstone_wire',
  'lever',
  'repeater',
  'comparator',
  'observer',
  'redstone_block',
  'redstone_torch',
  'redstone_wall_torch',
  'daylight_detector',
  'sculk_sensor',
  'target'
])

function isSource(name: string): boolean {
  return SOURCES.has(name) || name.endsWith('_button') || name.endsWith('_pressure_plate')
}

/** Solid enough to carry power from a source attached to it. */
function isSolid(name: string): boolean {
  return !isSource(name) && !SINKS.has(name) && !['air', 'water', 'lava', 'rail', 'detector_rail'].includes(name)
}

const NEIGHBOURS = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1]
] as const

describe.each(REDSTONE_LIBRARY.map((entry) => [entry.id, entry] as const))('%s', (_id, entry) => {
  const grid = new Map<string, string>()
  for (const block of blueprintBlocks(entry.blueprint)) {
    grid.set(`${block.dx},${block.dy},${block.dz}`, baseBlockName(block.id))
  }

  const around = (x: number, y: number, z: number): string[] =>
    NEIGHBOURS.map(([dx, dy, dz]) => grid.get(`${x + dx},${y + dy},${z + dz}`)).filter(
      (name): name is string => Boolean(name)
    )

  /**
   * How far the signal actually gets.
   *
   * Adjacency is not enough: dust loses a step of strength per block and dies
   * after fifteen, so a lamp can sit right against a wire that carries nothing
   * by the time it arrives. Sources seed their neighbouring dust at 15 and it
   * falls away from there; a repeater anywhere in the run restores it, which is
   * the whole reason to spend a block on one.
   */
  const strength = new Map<string, number>()
  {
    const queue: Array<[string, number]> = []
    for (const [key, name] of grid) {
      // A repeater is a source in its own right: whatever reaches it leaves at full.
      if (!isSource(name)) continue
      const [x, y, z] = key.split(',').map(Number)
      for (const [dx, dy, dz] of NEIGHBOURS) {
        const at = `${x + dx},${y + dy},${z + dz}`
        if (grid.get(at) !== 'redstone_wire') continue
        if ((strength.get(at) ?? 0) >= 15) continue
        strength.set(at, 15)
        queue.push([at, 15])
      }
    }
    while (queue.length > 0) {
      const [key, level] = queue.shift()!
      if (level <= 1) continue
      const [x, y, z] = key.split(',').map(Number)
      for (const [dx, dy, dz] of NEIGHBOURS) {
        const at = `${x + dx},${y + dy},${z + dz}`
        if (grid.get(at) !== 'redstone_wire') continue
        if ((strength.get(at) ?? 0) >= level - 1) continue
        strength.set(at, level - 1)
        queue.push([at, level - 1])
      }
    }
  }

  const liveWire = (key: string): boolean =>
    grid.get(key) === 'redstone_wire' && (strength.get(key) ?? 0) > 0

  it('every stretch of dust still carries a signal at the far end', () => {
    const dead: string[] = []
    for (const [key, name] of grid) {
      if (name !== 'redstone_wire') continue
      if ((strength.get(key) ?? 0) > 0) continue
      dead.push(key)
    }
    expect(dead).toEqual([])
  })

  it('every component that needs power can reach one', () => {
    const stranded: string[] = []

    for (const [key, name] of grid) {
      if (!SINKS.has(name)) continue
      const [x, y, z] = key.split(',').map(Number)

      /*
       * A door is one object wearing two blocks. Power reaching either half
       * opens both, so the upper half is judged on the pair — otherwise every
       * correctly built door fails here, since only the lower half is ever
       * within reach of a plate on the ground.
       */
      const cells: Array<[number, number, number]> = [[x, y, z]]
      if (name === 'iron_door') {
        if (grid.get(`${x},${y - 1},${z}`) === 'iron_door') cells.push([x, y - 1, z])
        if (grid.get(`${x},${y + 1},${z}`) === 'iron_door') cells.push([x, y + 1, z])
      }

      /*
       * Dust only counts if something still reaches this end of it. A wire
       * touching the component proves nothing on its own.
       */
      const live = cells.some(([cx, cy, cz]) =>
        NEIGHBOURS.some(([dx, dy, dz]) => liveWire(`${cx + dx},${cy + dy},${cz + dz}`))
      )
      if (live) continue

      const adjacent = cells.flatMap(([cx, cy, cz]) => around(cx, cy, cz))
      if (adjacent.some((name) => isSource(name) && name !== 'redstone_wire')) continue

      // Or through one solid block with a source stuck to it.
      const throughBlock = cells.some(([cx, cy, cz]) =>
        NEIGHBOURS.some(([dx, dy, dz]) => {
          const neighbour = grid.get(`${cx + dx},${cy + dy},${cz + dz}`)
          if (!neighbour || !isSolid(neighbour)) return false
          return around(cx + dx, cy + dy, cz + dz).some(isSource)
        })
      )
      if (throughBlock) continue

      stranded.push(`${name} at ${key}`)
    }

    expect(stranded).toEqual([])
  })
})
