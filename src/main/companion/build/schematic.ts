/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFile } from 'node:fs/promises'
import type { Blueprint } from './blueprint'

/**
 * Reading structures other people built.
 *
 * WorldEdit, Litematica, Amulet and every schematic site on the internet speak
 * the Sponge schematic format, so a launcher that can build a blueprint should
 * be able to build one of those too — it is the difference between "the model
 * draws you a hut" and "build the cathedral you downloaded".
 *
 * Two things are deliberately lost on the way in, and both are worth knowing:
 * block *states* (which way a stair faces, whether a door is open) are dropped,
 * because the placement tool takes a block name and nothing else; and entities
 * and tile-entity contents (chest inventories, sign text) are ignored. What you
 * get is the shape in the right blocks, not a byte-perfect paste.
 */

/** Characters usable as palette keys in the internal blueprint format. */
const PALETTE_CHARS =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!#$%&*+/:;<=>?@^_~[]{}()|'

/** Refuse anything that would take hours to place or exhaust memory. */
const MAX_BLOCKS = 60_000
const MAX_EDGE = 128

export interface SchematicInfo {
  name: string
  width: number
  height: number
  length: number
  /** Non-air blocks the structure actually contains. */
  blockCount: number
  /** Distinct block types, most common first. */
  materials: Array<{ block: string; count: number }>
  /** Anything the reader had to give up on, in plain words. */
  notes: string[]
}

export interface LoadedSchematic {
  info: SchematicInfo
  blueprint: Blueprint
}

/** Strips "minecraft:" and any [state=...] suffix down to a plain block name. */
function plainBlockName(id: string): string {
  return id.replace(/^minecraft:/, '').replace(/\[.*$/, '').trim()
}

/**
 * Reads the varint-per-block stream Sponge uses for block data.
 *
 * The indices are LEB128, not fixed-width bytes, because a schematic with more
 * than 128 distinct blocks would otherwise need two bytes for every block in
 * it. Bytes arrive signed from the NBT reader, hence the mask.
 */
function readVarIntArray(data: ArrayLike<number>, expected: number): number[] {
  const out: number[] = []
  let index = 0

  while (index < data.length && out.length < expected) {
    let value = 0
    let shift = 0
    for (;;) {
      if (index >= data.length) return out
      const byte = data[index++] & 0xff
      value |= (byte & 0x7f) << shift
      if ((byte & 0x80) === 0) break
      shift += 7
      if (shift > 35) return out
    }
    out.push(value)
  }
  return out
}

/** Pulls a number out of whatever shape the NBT simplifier produced. */
function num(value: any): number {
  if (typeof value === 'number') return value
  if (Array.isArray(value)) return Number(value[0]) || 0
  if (value && typeof value === 'object' && 'value' in value) return Number((value as any).value) || 0
  return Number(value) || 0
}

/**
 * Turns a parsed schematic into the internal blueprint format.
 *
 * Blueprints index a palette by single character, so a structure using more
 * distinct blocks than there are characters has its rarest materials dropped
 * rather than the whole file being refused — a cathedral missing four of its
 * ninety block types is still a cathedral.
 */
function toBlueprint(
  name: string,
  width: number,
  height: number,
  length: number,
  blockAt: (x: number, y: number, z: number) => string | null
): { blueprint: Blueprint; info: SchematicInfo } {
  const counts = new Map<string, number>()
  for (let y = 0; y < height; y += 1) {
    for (let z = 0; z < length; z += 1) {
      for (let x = 0; x < width; x += 1) {
        const block = blockAt(x, y, z)
        if (!block || block === 'air' || block === 'cave_air' || block === 'void_air') continue
        counts.set(block, (counts.get(block) ?? 0) + 1)
      }
    }
  }

  const ordered = [...counts.entries()].sort((a, b) => b[1] - a[1])
  const notes: string[] = []

  const kept = ordered.slice(0, PALETTE_CHARS.length)
  if (ordered.length > PALETTE_CHARS.length) {
    const dropped = ordered.slice(PALETTE_CHARS.length)
    notes.push(
      `${dropped.length} rare block type${dropped.length === 1 ? '' : 's'} were left out — the format holds ` +
        `${PALETTE_CHARS.length} at once`
    )
  }

  const charFor = new Map<string, string>()
  const palette: Record<string, string> = {}
  kept.forEach(([block], index) => {
    const character = PALETTE_CHARS[index]
    charFor.set(block, character)
    palette[character] = block
  })

  const layers: string[][] = []
  for (let y = 0; y < height; y += 1) {
    const rows: string[] = []
    for (let z = 0; z < length; z += 1) {
      let row = ''
      for (let x = 0; x < width; x += 1) {
        const block = blockAt(x, y, z)
        row += (block && charFor.get(block)) || '.'
      }
      rows.push(row)
    }
    layers.push(rows)
  }

  const blockCount = kept.reduce((total, [, count]) => total + count, 0)

  return {
    blueprint: { name, palette, layers, description: `Imported schematic, ${width}x${height}x${length}` },
    info: {
      name,
      width,
      height,
      length,
      blockCount,
      materials: kept.slice(0, 24).map(([block, count]) => ({ block, count })),
      notes
    }
  }
}

/**
 * Loads a `.schem` (Sponge v1–v3) or `.nbt` structure file.
 *
 * The legacy MCEdit `.schematic` format is refused on purpose rather than half
 * supported: it stores pre-1.13 numeric block ids, and mapping those to modern
 * names needs a conversion table that would be wrong often enough to produce
 * buildings made of the wrong material without saying so.
 */
export async function loadSchematic(filePath: string, displayName?: string): Promise<LoadedSchematic> {
  const buffer = await readFile(filePath)

  const nbt = require('prismarine-nbt')
  const { parsed } = await nbt.parse(buffer)
  const root = nbt.simplify(parsed) as Record<string, any>

  // Sponge v3 nests everything under "Schematic"; v1 and v2 are at the root.
  const schematic = (root.Schematic ?? root) as Record<string, any>

  const width = num(schematic.Width)
  const height = num(schematic.Height)
  const length = num(schematic.Length)

  if (!width || !height || !length) {
    if (schematic.Blocks && schematic.Data && !schematic.Palette) {
      throw new Error(
        'that is a legacy MCEdit .schematic, which stores numeric block ids from before 1.13. ' +
          'Open it in WorldEdit or Amulet and save it as a .schem first.'
      )
    }
    throw new Error('that file does not look like a schematic — no width, height or length in it')
  }

  if (width > MAX_EDGE || height > MAX_EDGE || length > MAX_EDGE) {
    throw new Error(`that schematic is ${width}x${height}x${length}; the limit is ${MAX_EDGE} blocks along any edge`)
  }
  if (width * height * length > MAX_BLOCKS * 4) {
    throw new Error(`that schematic has ${width * height * length} block positions, which is too many to build`)
  }

  /*
   * v3 moved the palette and data into a "Blocks" compound. Both spellings are
   * in the wild — files exported a year apart differ — so both are accepted.
   */
  const blocks = schematic.Blocks ?? schematic
  const rawPalette = (blocks.Palette ?? schematic.Palette) as Record<string, any> | undefined
  const rawData = (blocks.Data ?? blocks.BlockData ?? schematic.BlockData) as ArrayLike<number> | undefined

  if (!rawPalette || !rawData) {
    throw new Error('that schematic has no block palette — it may be a Litematica file, which is a different format')
  }

  // The palette maps a block id to its index; invert it.
  const byIndex = new Map<number, string>()
  for (const [id, index] of Object.entries(rawPalette)) {
    byIndex.set(num(index), plainBlockName(id))
  }

  const indices = readVarIntArray(rawData, width * height * length)

  // Sponge order is y, then z, then x.
  const blockAt = (x: number, y: number, z: number): string | null => {
    const position = (y * length + z) * width + x
    const index = indices[position]
    if (index === undefined) return null
    return byIndex.get(index) ?? null
  }

  const name = (displayName ?? String(schematic.Metadata?.Name ?? 'Imported structure')).slice(0, 60)
  const { blueprint, info } = toBlueprint(name, width, height, length, blockAt)

  if (info.blockCount === 0) throw new Error('that schematic is empty — every position in it is air')
  if (info.blockCount > MAX_BLOCKS) {
    throw new Error(`that schematic needs ${info.blockCount} blocks placed; the limit is ${MAX_BLOCKS}`)
  }

  return { blueprint, info }
}
