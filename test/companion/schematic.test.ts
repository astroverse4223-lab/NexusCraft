import minecraftData from 'minecraft-data'
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import nbt from 'prismarine-nbt'
import { loadSchematic } from '../../src/main/companion/build/schematic'
import { blueprintSize, validateBlueprint } from '../../src/main/companion/build/blueprint'

/**
 * Round-trips a real Sponge schematic through the reader.
 *
 * The file is built here rather than checked in as a fixture so the test states
 * its own input: the varint block stream and the y/z/x ordering are the two
 * things most likely to be got wrong, and both are visible in the construction.
 */

const mcData = minecraftData('1.21.1')
let directory = ''

/** Encodes palette indices the way Sponge does: one LEB128 varint per block. */
function varints(values: number[]): number[] {
  const out: number[] = []
  for (const value of values) {
    let remaining = value
    do {
      let byte = remaining & 0x7f
      remaining >>>= 7
      if (remaining !== 0) byte |= 0x80
      out.push(byte)
    } while (remaining !== 0)
  }
  return out
}

/** A 3x2x3 box: a stone floor with an oak plank pillar at one corner. */
async function writeSchematic(file: string): Promise<void> {
  const width = 3
  const height = 2
  const length = 3

  // 0 = air, 1 = stone, 2 = oak_planks
  const data: number[] = []
  for (let y = 0; y < height; y += 1) {
    for (let z = 0; z < length; z += 1) {
      for (let x = 0; x < width; x += 1) {
        if (y === 0) data.push(1) // floor
        else data.push(x === 0 && z === 0 ? 2 : 0) // one pillar
      }
    }
  }

  const tag = nbt.comp({
    Version: nbt.int(2),
    DataVersion: nbt.int(3953),
    Width: nbt.short(width),
    Height: nbt.short(height),
    Length: nbt.short(length),
    PaletteMax: nbt.int(3),
    Palette: nbt.comp({
      'minecraft:air': nbt.int(0),
      'minecraft:stone': nbt.int(1),
      // A block state, to prove the suffix is stripped.
      'minecraft:oak_planks[waterlogged=false]': nbt.int(2)
    }),
    BlockData: nbt.byteArray(varints(data))
  })

  await writeFile(file, nbt.writeUncompressed({ ...tag, name: 'Schematic' } as never))
}

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'nexus-schem-'))
  await writeSchematic(join(directory, 'box.schem'))
})

afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

describe('loadSchematic', () => {
  it('reads the declared dimensions', async () => {
    const { info } = await loadSchematic(join(directory, 'box.schem'), 'Box')
    expect(info.width).toBe(3)
    expect(info.height).toBe(2)
    expect(info.length).toBe(3)
  })

  it('counts only the non-air blocks', async () => {
    // 9 floor + 1 pillar
    const { info } = await loadSchematic(join(directory, 'box.schem'), 'Box')
    expect(info.blockCount).toBe(10)
  })

  it('strips block states and the minecraft: prefix', async () => {
    const { info } = await loadSchematic(join(directory, 'box.schem'), 'Box')
    const names = info.materials.map((m) => m.block)
    expect(names).toContain('stone')
    expect(names).toContain('oak_planks')
    expect(names.some((n) => n.includes('[') || n.includes('minecraft:'))).toBe(false)
  })

  it('produces a blueprint that passes the normal validator', async () => {
    const { blueprint } = await loadSchematic(join(directory, 'box.schem'), 'Box')
    const problems = validateBlueprint(blueprint, (name) => Boolean(mcData.blocksByName[name]))
    expect(problems.map((p) => p.message)).toEqual([])
  })

  it('keeps the layer ordering, so the floor is the bottom layer', async () => {
    const { blueprint } = await loadSchematic(join(directory, 'box.schem'), 'Box')
    const size = blueprintSize(blueprint)
    expect(size).toEqual({ width: 3, height: 2, depth: 3 })

    // Bottom layer is solid stone; the layer above has exactly one block.
    const bottom = blueprint.layers[0].join('')
    const top = blueprint.layers[1].join('')
    expect(bottom.split('').filter((c) => c !== '.')).toHaveLength(9)
    expect(top.split('').filter((c) => c !== '.')).toHaveLength(1)
  })

  it('puts the pillar at the corner it was written to', async () => {
    const { blueprint } = await loadSchematic(join(directory, 'box.schem'), 'Box')
    // x=0, z=0 in the upper layer.
    const upper = blueprint.layers[1]
    expect(upper[0][0]).not.toBe('.')
    expect(upper[0][1]).toBe('.')
    expect(upper[1][0]).toBe('.')
  })

  it('refuses a file that is not a schematic', async () => {
    const bad = join(directory, 'not-a-schematic.schem')
    await writeFile(bad, nbt.writeUncompressed({ ...nbt.comp({ Hello: nbt.int(1) }), name: 'X' } as never))
    await expect(loadSchematic(bad)).rejects.toThrow()
  })
})
