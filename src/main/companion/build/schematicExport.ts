import { gzipSync } from 'node:zlib'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Blueprint } from './blueprint'
import { blueprintBlocks, blueprintSize } from './blueprint'

/**
 * Writing blueprints out as files the game and its build mods can read.
 *
 * This is the half that lets you build a structure *yourself* rather than watch
 * a bot do it. The launcher cannot draw a hologram inside Minecraft — that
 * needs code running in the game's own renderer, which is what Litematica is —
 * but it can hand Litematica exactly the file it wants, in the folder it
 * already looks in. From there the ghost projection is Litematica's job and it
 * is very good at it.
 *
 * Two formats, because they cover different ground:
 *
 *   .schem  Sponge v2. What WorldEdit writes and Litematica reads. No size
 *           limit worth worrying about, and it is the exact inverse of the
 *           reader in `schematic.ts`, so imports round-trip.
 *
 *   .nbt    The vanilla structure format. Litematica reads it too, but the
 *           point is that a *structure block* reads it — so a small build can
 *           be placed with no mods installed at all.
 */

/**
 * The world version stamped into exports.
 *
 * Both formats carry one so the game can migrate block names across versions.
 * 1.21.1's value is used rather than the running server's: a blueprint is not
 * tied to a world, and a stamp that is a little old makes the game upgrade
 * names, where one from the future makes it refuse the file outright.
 */
const DATA_VERSION = 3955

/** Sponge stores palette indices as a LEB128 varint per block. */
function toVarInts(values: number[]): number[] {
  const out: number[] = []
  for (const value of values) {
    let remaining = value >>> 0
    do {
      let byte = remaining & 0x7f
      remaining >>>= 7
      if (remaining !== 0) byte |= 0x80
      out.push(byte)
    } while (remaining !== 0)
  }
  return out
}

/** Every distinct block in a blueprint, with the grid resolved to a lookup. */
function indexBlueprint(blueprint: Blueprint): {
  width: number
  height: number
  depth: number
  names: string[]
  at: (x: number, y: number, z: number) => number
} {
  const { width, height, depth } = blueprintSize(blueprint)

  // Index 0 is always air, so an empty cell needs no special case later.
  const names = ['minecraft:air']
  const indexFor = new Map<string, number>([['minecraft:air', 0]])

  const grid = new Int32Array(width * height * depth)

  for (const block of blueprintBlocks(blueprint)) {
    const id = `minecraft:${block.block.replace(/^minecraft:/, '')}`
    let index = indexFor.get(id)
    if (index === undefined) {
      index = names.length
      names.push(id)
      indexFor.set(id, index)
    }
    grid[(block.dy * depth + block.dz) * width + block.dx] = index
  }

  return {
    width,
    height,
    depth,
    names,
    at: (x, y, z) => grid[(y * depth + z) * width + x]
  }
}

/** A Sponge v2 `.schem`, gzipped, as WorldEdit and Litematica expect. */
export function toSpongeSchematic(blueprint: Blueprint): Buffer {
  const nbt = require('prismarine-nbt')
  const { width, height, depth, names, at } = indexBlueprint(blueprint)

  const data: number[] = []
  for (let y = 0; y < height; y += 1) {
    for (let z = 0; z < depth; z += 1) {
      for (let x = 0; x < width; x += 1) data.push(at(x, y, z))
    }
  }

  const palette: Record<string, unknown> = {}
  names.forEach((name, index) => {
    palette[name] = nbt.int(index)
  })

  const tag = nbt.comp({
    Version: nbt.int(2),
    DataVersion: nbt.int(DATA_VERSION),
    Width: nbt.short(width),
    Height: nbt.short(height),
    Length: nbt.short(depth),
    PaletteMax: nbt.int(names.length),
    Palette: nbt.comp(palette as never),
    BlockData: nbt.byteArray(toVarInts(data)),
    Metadata: nbt.comp({ Name: nbt.string(blueprint.name) })
  })

  return gzipSync(nbt.writeUncompressed({ ...tag, name: 'Schematic' } as never))
}

/**
 * A vanilla structure `.nbt`, gzipped.
 *
 * Air is left out entirely rather than listed: the vanilla format treats an
 * absent position as "do not touch", which is what a blueprint's dots mean, and
 * listing them would make a structure block wipe the ground it is placed on.
 */
export function toVanillaStructure(blueprint: Blueprint): Buffer {
  const nbt = require('prismarine-nbt')
  const { width, height, depth, names, at } = indexBlueprint(blueprint)

  /*
   * A list of compounds holds the members' *fields*, not compounds wrapped by
   * `nbt.comp` — wrapping each entry produces a tag the writer silently drops,
   * which is how the first version of this wrote files with no palette in them.
   */
  // The vanilla palette has no air entry, so indices shift down by one.
  const palette = names.slice(1).map((name) => ({ Name: nbt.string(name) }))

  const blocks: unknown[] = []
  for (let y = 0; y < height; y += 1) {
    for (let z = 0; z < depth; z += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = at(x, y, z)
        if (index === 0) continue
        blocks.push({
          pos: nbt.list(nbt.int([x, y, z])),
          state: nbt.int(index - 1)
        })
      }
    }
  }

  const tag = nbt.comp({
    DataVersion: nbt.int(DATA_VERSION),
    size: nbt.list(nbt.int([width, height, depth])),
    palette: nbt.list(nbt.comp(palette as never)),
    blocks: nbt.list(nbt.comp(blocks as never)),
    entities: nbt.list(nbt.comp([] as never))
  })

  return gzipSync(nbt.writeUncompressed({ ...tag, name: '' } as never))
}

/** Strips a name down to something safe to use as a file name. */
export function safeFileName(name: string): string {
  const cleaned = name
    .replace(/[^a-zA-Z0-9 _-]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 48)
  return cleaned || 'structure'
}

export interface ExportResult {
  path: string
  format: 'schem' | 'nbt'
  bytes: number
}

/**
 * Writes a blueprint where a build mod will find it.
 *
 * Litematica reads from `schematics/` inside the game directory, so exporting
 * there means the file is already in the browser when the game opens — no
 * copying files around, which is the step that makes this kind of thing feel
 * like homework.
 */
export async function exportBlueprint(
  blueprint: Blueprint,
  targetPath: string,
  format: 'schem' | 'nbt'
): Promise<ExportResult> {
  const data = format === 'schem' ? toSpongeSchematic(blueprint) : toVanillaStructure(blueprint)
  await mkdir(dirname(targetPath), { recursive: true })
  await writeFile(targetPath, data)
  return { path: targetPath, format, bytes: data.length }
}

/** Where Litematica looks: `<gameDir>/schematics`. */
export function schematicsDir(gameDir: string): string {
  return join(gameDir, 'schematics')
}

/**
 * Where a structure block reads from.
 *
 * Not the same place as Litematica, and not even the same machine: a structure
 * block on a server loads out of that server's world folder, so a file written
 * into the client's instance is invisible to it. Getting this wrong produces a
 * structure block that reports the name as unknown with no clue why.
 */
export function structuresDir(worldDir: string): string {
  return join(worldDir, 'generated', 'minecraft', 'structures')
}

/**
 * The world a server is configured to run, from its own properties file.
 * Defaults to `world`, which is what a fresh server uses.
 */
export async function serverWorldName(serverDir: string): Promise<string> {
  try {
    const { readFile } = await import('node:fs/promises')
    const text = await readFile(join(serverDir, 'server.properties'), 'utf8')
    const match = /^level-name\s*=\s*(.+)$/m.exec(text)
    const name = match?.[1]?.trim()
    // A level-name is a folder name; anything that could climb out of the
    // server directory is refused in favour of the default.
    const unsafe = !name || name.includes('..') || /[/\\]/.test(name)
    return unsafe ? 'world' : name
  } catch {
    return 'world'
  }
}
