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
  toVanillaStructure
} from '../../src/main/companion/build/schematicExport'
import { loadSchematic } from '../../src/main/companion/build/schematic'
import { blueprintSize, billOfMaterials } from '../../src/main/companion/build/blueprint'
import { BLUEPRINT_LIBRARY } from '../../src/main/companion/build/library'

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
