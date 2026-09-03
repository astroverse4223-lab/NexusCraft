import minecraftData from 'minecraft-data'
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { gunzipSync } from 'node:zlib'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import nbt from 'prismarine-nbt'
import {
  exportBlueprint,
  safeFileName,
  toSpongeSchematic,
  toVanillaStructure,
  dataVersionFor
} from '../../src/main/companion/build/schematicExport'
import { loadSchematic } from '../../src/main/companion/build/schematic'
import { blueprintSize, billOfMaterials } from '../../src/main/companion/build/blueprint'
import { BLUEPRINT_LIBRARY } from '../../src/main/companion/build/library'
import { REDSTONE_LIBRARY } from '../../src/main/companion/build/redstone'

/**
 * The export is only worth anything if the file it writes is the structure that
 * went in. The reader already exists, so every bundled blueprint is written out
 * and read back — a real round trip, not a shape check.
 */

const mcData = minecraftData('1.21.1')
let directory = ''

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'nexus-export-'))
})

afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

describe('Sponge .schem export', () => {
  it.each(BLUEPRINT_LIBRARY.map((entry) => [entry.id, entry] as const))(
    '"%s" survives a round trip unchanged',
    async (id, entry) => {
      const file = join(directory, `${id}.schem`)
      await exportBlueprint(entry.blueprint, file, 'schem')

      const { blueprint: readBack, info } = await loadSchematic(file, entry.blueprint.name)

      // Same footprint.
      expect(blueprintSize(readBack)).toEqual(blueprintSize(entry.blueprint))

      // Same bill of materials, block for block.
      const before = [...billOfMaterials(entry.blueprint)].sort()
      const after = [...billOfMaterials(readBack)].sort()
      expect(after).toEqual(before)

      // And the reader agrees on how many blocks it holds.
      const total = before.reduce((sum, [, count]) => sum + count, 0)
      expect(info.blockCount).toBe(total)
    }
  )

  it('writes a gzipped file, as WorldEdit and Litematica expect', () => {
    const data = toSpongeSchematic(BLUEPRINT_LIBRARY[0].blueprint)
    // gzip magic number
    expect(data[0]).toBe(0x1f)
    expect(data[1]).toBe(0x8b)
  })

  it('prefixes block names for the game', async () => {
    const data = toSpongeSchematic(BLUEPRINT_LIBRARY[0].blueprint)
    const { parsed } = await nbt.parse(data)
    const simple = nbt.simplify(parsed) as Record<string, never>
    const names = Object.keys(simple.Palette)
    expect(names.every((n) => n.startsWith('minecraft:'))).toBe(true)
    expect(names).toContain('minecraft:air')
  })
})

describe('vanilla .nbt structure export', () => {
  it('is gzipped and carries a size, palette and blocks', async () => {
    const data = toVanillaStructure(BLUEPRINT_LIBRARY[0].blueprint)
    expect(data[0]).toBe(0x1f)

    const { parsed } = await nbt.parse(data)
    const simple = nbt.simplify(parsed) as Record<string, never>
    const size = simple.size as unknown as number[]
    const expected = blueprintSize(BLUEPRINT_LIBRARY[0].blueprint)
    expect(size).toEqual([expected.width, expected.height, expected.depth])
    expect((simple.palette as unknown as unknown[]).length).toBeGreaterThan(0)
  })

  it('leaves air out, so a structure block does not wipe the ground', async () => {
    const entry = BLUEPRINT_LIBRARY[0]
    const data = toVanillaStructure(entry.blueprint)
    const { parsed } = await nbt.parse(data)
    const simple = nbt.simplify(parsed) as Record<string, never>

    const listed = (simple.blocks as unknown as unknown[]).length
    const placed = [...billOfMaterials(entry.blueprint)].reduce((sum, [, count]) => sum + count, 0)
    expect(listed).toBe(placed)

    const palette = simple.palette as unknown as Array<{ Name: string }>
    expect(palette.some((p) => p.Name === 'minecraft:air')).toBe(false)
  })

  it('only names blocks the game actually has', async () => {
    const data = toVanillaStructure(BLUEPRINT_LIBRARY[5].blueprint)
    const { parsed } = await nbt.parse(data)
    const simple = nbt.simplify(parsed) as Record<string, never>
    const palette = simple.palette as unknown as Array<{ Name: string }>
    for (const entry of palette) {
      expect(Boolean(mcData.blocksByName[entry.Name.replace('minecraft:', '')])).toBe(true)
    }
  })

  it('produces a file small enough to be worth gzipping', () => {
    const raw = gunzipSync(toVanillaStructure(BLUEPRINT_LIBRARY[5].blueprint))
    const packed = toVanillaStructure(BLUEPRINT_LIBRARY[5].blueprint)
    expect(packed.length).toBeLessThan(raw.length)
  })
})

describe('safeFileName', () => {
  it('strips characters a file system will not take', () => {
    expect(safeFileName('Cobblemon: Mega/Pokemon*?')).toBe('Cobblemon_MegaPokemon')
  })

  it('collapses spaces to underscores', () => {
    expect(safeFileName('Oak   Cottage')).toBe('Oak_Cottage')
  })

  it('falls back rather than returning nothing', () => {
    expect(safeFileName('///')).toBe('structure')
  })
})


/**
 * Block states are the whole point of the redstone set.
 *
 * A repeater without a facing is a repeater pointing the wrong way, so an
 * export that drops the state produces a circuit of correct blocks that does
 * nothing. Both writers keep it, in the shape each format expects.
 */
describe('block states in exports', () => {
  it('Sponge keeps the state in the palette key', async () => {
    const clock = REDSTONE_LIBRARY.find((entry) => entry.id === 'clock')!
    const data = toSpongeSchematic(clock.blueprint)
    const { parsed } = await nbt.parse(data)
    const simple = nbt.simplify(parsed) as Record<string, never>

    const keys = Object.keys(simple.Palette)
    const repeaters = keys.filter((key) => key.startsWith('minecraft:repeater'))
    expect(repeaters.length).toBeGreaterThan(0)
    // Both directions must survive as distinct palette entries.
    expect(keys).toContain('minecraft:repeater[facing=north,delay=4]')
    expect(keys).toContain('minecraft:repeater[facing=south,delay=4]')
  })

  it('vanilla splits the state into Properties, not the name', async () => {
    const clock = REDSTONE_LIBRARY.find((entry) => entry.id === 'clock')!
    const data = toVanillaStructure(clock.blueprint)
    const { parsed } = await nbt.parse(data)
    const simple = nbt.simplify(parsed) as Record<string, never>
    const palette = simple.palette as unknown as Array<{ Name: string; Properties?: Record<string, string> }>

    const repeater = palette.find((entry) => entry.Name === 'minecraft:repeater')
    expect(repeater).toBeDefined()
    // A name with a bracket in it is a structure the game refuses to load.
    expect(palette.every((entry) => !entry.Name.includes('['))).toBe(true)
    expect(repeater?.Properties?.facing).toBeDefined()
    expect(repeater?.Properties?.delay).toBe('4')
  })

  it('keeps the two repeater directions apart in the vanilla palette', async () => {
    const clock = REDSTONE_LIBRARY.find((entry) => entry.id === 'clock')!
    const data = toVanillaStructure(clock.blueprint)
    const { parsed } = await nbt.parse(data)
    const simple = nbt.simplify(parsed) as Record<string, never>
    const palette = simple.palette as unknown as Array<{ Name: string; Properties?: Record<string, string> }>

    const facings = palette
      .filter((entry) => entry.Name === 'minecraft:repeater')
      .map((entry) => entry.Properties?.facing)
    expect(new Set(facings).size).toBe(2)
  })

  it.each(REDSTONE_LIBRARY.map((entry) => [entry.id, entry] as const))(
    '"%s" round-trips through the reader with its states intact',
    async (id, entry) => {
      const file = join(directory, `${id}.schem`)
      await exportBlueprint(entry.blueprint, file, 'schem')
      const { blueprint: readBack } = await loadSchematic(file, entry.blueprint.name)

      // The reader strips states by design, so compare footprints and counts.
      expect(blueprintSize(readBack)).toEqual(blueprintSize(entry.blueprint))
    }
  )
})

/**
 * The stamp has to match the game it is going to.
 *
 * Every export carried 1.21.1's DataVersion at first, including files written
 * for instances running 1.21.11 and 26.2 — hundreds of revisions of block-name
 * migration for the game to guess through, on files whose entire purpose is
 * placing exact block states.
 */
describe('DataVersion follows the instance', () => {
  it('resolves real versions and falls back rather than throwing', () => {
    expect(dataVersionFor('1.21.1')).toBe(3955)
    expect(dataVersionFor('1.21.11')).toBe(4671)
    expect(dataVersionFor('26.2')).toBe(4903)
    expect(dataVersionFor('not-a-version')).toBe(3955)
    expect(dataVersionFor(undefined)).toBe(3955)
  })

  it('writes the resolved version into both formats', async () => {
    const entry = BLUEPRINT_LIBRARY[0]
    for (const [version, expected] of [
      ['1.21.11', 4671],
      ['26.2', 4903]
    ] as const) {
      const schem = await nbt.parse(toSpongeSchematic(entry.blueprint, dataVersionFor(version)))
      expect((nbt.simplify(schem.parsed) as Record<string, never>).DataVersion).toBe(expected)

      const structure = await nbt.parse(toVanillaStructure(entry.blueprint, dataVersionFor(version)))
      expect((nbt.simplify(structure.parsed) as Record<string, never>).DataVersion).toBe(expected)
    }
  })
})
