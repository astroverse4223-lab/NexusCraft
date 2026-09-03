import { readdir, readFile } from 'node:fs/promises'
import { inflateSync, gunzipSync } from 'node:zlib'
import { join } from 'node:path'

/**
 * Reading Minecraft's region files well enough to draw a map.
 *
 * A region file holds up to 1024 chunks in a sector-addressed archive: an 8 KiB
 * header of offsets, then each chunk separately compressed. What is drawn from
 * them here is the surface *height* rather than the surface block, and that is a
 * deliberate trade. Heights live in the `Heightmaps` compound as a packed long
 * array and cost almost nothing to read; block colours would mean decoding every
 * section's palette and block-state array for every chunk, which is an order of
 * magnitude more work for a picture that is barely more legible at map scale.
 *
 * Shaded relief plus a water line turns out to read very well: terrain, cliffs,
 * rivers, and anything the player has built all stand out.
 */

/** Sectors are 4 KiB, and the header is the first two of them. */
const SECTOR_BYTES = 4096

/** Chunks are 16x16, and a heightmap has one entry per column. */
const CHUNK_SIZE = 16

export interface ChunkHeights {
  /** Chunk coordinates, in chunks not blocks. */
  chunkX: number
  chunkZ: number
  /** 256 surface heights, row-major (z outer, x inner). */
  heights: Int16Array
}

export interface RegionMap {
  /** Region coordinates, each covering 32x32 chunks. */
  regionX: number
  regionZ: number
  chunks: ChunkHeights[]
}

/**
 * Unpacks Minecraft's bit-packed long arrays.
 *
 * Since 1.16 entries never straddle a long: each 64-bit word holds
 * `floor(64 / bits)` entries and the leftover high bits are padding. Reading
 * these as a continuous bit stream — which is how it worked before 1.16 — yields
 * heights that drift further out of true with every word, and a map that looks
 * like corrugated iron.
 */
function unpackLongs(values: bigint[], bits: number, count: number): Int16Array {
  const out = new Int16Array(count)
  if (bits <= 0) return out

  const perLong = Math.floor(64 / bits)
  const mask = (1n << BigInt(bits)) - 1n

  let index = 0
  for (const word of values) {
    for (let slot = 0; slot < perLong && index < count; slot += 1) {
      out[index++] = Number((word >> BigInt(slot * bits)) & mask)
    }
    if (index >= count) break
  }
  return out
}

/** Decompresses one chunk's payload, whichever scheme the file used. */
function decompress(scheme: number, payload: Buffer): Buffer | null {
  try {
    if (scheme === 1) return gunzipSync(payload)
    if (scheme === 2) return inflateSync(payload)
    if (scheme === 3) return payload
  } catch {
    /* a chunk that will not decompress is skipped rather than fatal */
  }
  return null
}

/**
 * Reads the surface heights out of one region file.
 *
 * Anything unreadable — a truncated chunk, a version whose heightmap is missing
 * — is skipped rather than thrown, because a single bad chunk should not cost
 * the user the other thousand.
 */
export async function readRegion(filePath: string): Promise<RegionMap | null> {
  const name = /r\.(-?\d+)\.(-?\d+)\.mca$/.exec(filePath)
  if (!name) return null

  const regionX = Number(name[1])
  const regionZ = Number(name[2])

  let data: Buffer
  try {
    data = await readFile(filePath)
  } catch {
    return null
  }
  if (data.length < SECTOR_BYTES * 2) return null

  const nbt = require('prismarine-nbt')
  const chunks: ChunkHeights[] = []

  for (let entry = 0; entry < 1024; entry += 1) {
    const headerAt = entry * 4
    const offsetSectors = (data[headerAt] << 16) | (data[headerAt + 1] << 8) | data[headerAt + 2]
    const sectorCount = data[headerAt + 3]
    if (offsetSectors === 0 || sectorCount === 0) continue

    const start = offsetSectors * SECTOR_BYTES
    if (start + 5 > data.length) continue

    const length = data.readUInt32BE(start)
    const scheme = data[start + 4]
    const payload = data.subarray(start + 5, start + 4 + length)
    if (payload.length === 0) continue

    const raw = decompress(scheme, payload)
    if (!raw) continue

    let simple: Record<string, unknown> & { Level?: unknown }
    try {
      /*
       * `parse` rather than `parseUncompressed`: it detects the framing itself,
       * and the uncompressed variant rejected every chunk in a real save.
       */
      const { parsed } = await nbt.parse(raw)
      simple = nbt.simplify(parsed)
    } catch {
      continue
    }

    // 1.18+ has the chunk at the root; older versions nest it under Level.
    const chunk = (simple.Level ?? simple) as Record<string, unknown>
    const heightmaps = chunk.Heightmaps as Record<string, unknown> | undefined
    // MOTION_BLOCKING treats leaves and water as surface, which is what a map
    // wants — WORLD_SURFACE puts the reader under every tree canopy.
    const packed = heightmaps?.MOTION_BLOCKING ?? heightmaps?.WORLD_SURFACE
    if (!packed) continue

    const words: bigint[] = (packed as unknown[]).map((value) => {
      // prismarine-nbt gives longs as [high, low] pairs of signed 32-bit ints.
      if (Array.isArray(value)) {
        const [high, low] = value as [number, number]
        return (BigInt(high) << 32n) | BigInt(low >>> 0)
      }
      return BigInt(value as number)
    })

    // 384 world height needs 9 bits per entry; older 256-height worlds use 9 too.
    const heights = unpackLongs(words, 9, CHUNK_SIZE * CHUNK_SIZE)

    // Heights are stored relative to the world's floor.
    const floor = typeof chunk.yPos === 'number' ? chunk.yPos * 16 : 0
    if (floor !== 0) {
      for (let i = 0; i < heights.length; i += 1) heights[i] += floor
    }

    chunks.push({
      chunkX: regionX * 32 + (entry % 32),
      chunkZ: regionZ * 32 + Math.floor(entry / 32),
      heights
    })
  }

  return chunks.length > 0 ? { regionX, regionZ, chunks } : null
}

export interface WorldMap {
  /** Block coordinates of the top-left corner. */
  minX: number
  minZ: number
  width: number
  height: number
  /** Surface height per block column; -1 where nothing is generated. */
  heights: Int16Array
  chunks: number
  regions: number
  /** Lowest and highest generated surface, for shading. */
  low: number
  high: number
}

/**
 * Builds one height grid covering every region in a world.
 *
 * Capped by region count rather than by area: a long-played world can hold
 * thousands of region files, and reading them all would take minutes and
 * hundreds of megabytes for a picture nobody can read at that scale.
 */
export async function readWorldMap(regionDir: string, maxRegions = 64): Promise<WorldMap | null> {
  let names: string[]
  try {
    names = (await readdir(regionDir)).filter((file) => file.endsWith('.mca'))
  } catch {
    return null
  }
  if (names.length === 0) return null

  /*
   * Prefer the regions nearest the origin. Spawn is there, so is almost
   * everything a player builds early, and it keeps the cap from selecting a
   * scattering of disconnected exploration on the far edges of the world.
   */
  const ordered = names
    .map((file) => {
      const match = /r\.(-?\d+)\.(-?\d+)\.mca$/.exec(file)
      return match ? { file, x: Number(match[1]), z: Number(match[2]) } : null
    })
    .filter((entry): entry is { file: string; x: number; z: number } => entry !== null)
    .sort((a, b) => a.x * a.x + a.z * a.z - (b.x * b.x + b.z * b.z))
    .slice(0, maxRegions)

  const regions: RegionMap[] = []
  for (const entry of ordered) {
    const region = await readRegion(join(regionDir, entry.file))
    if (region) regions.push(region)
  }
  if (regions.length === 0) return null

  let minChunkX = Infinity
  let maxChunkX = -Infinity
  let minChunkZ = Infinity
  let maxChunkZ = -Infinity
  for (const region of regions) {
    for (const chunk of region.chunks) {
      if (chunk.chunkX < minChunkX) minChunkX = chunk.chunkX
      if (chunk.chunkX > maxChunkX) maxChunkX = chunk.chunkX
      if (chunk.chunkZ < minChunkZ) minChunkZ = chunk.chunkZ
      if (chunk.chunkZ > maxChunkZ) maxChunkZ = chunk.chunkZ
    }
  }

  const width = (maxChunkX - minChunkX + 1) * CHUNK_SIZE
  const height = (maxChunkZ - minChunkZ + 1) * CHUNK_SIZE
  const heights = new Int16Array(width * height).fill(-1)

  let low = Infinity
  let high = -Infinity
  let chunkCount = 0

  for (const region of regions) {
    for (const chunk of region.chunks) {
      chunkCount += 1
      const baseX = (chunk.chunkX - minChunkX) * CHUNK_SIZE
      const baseZ = (chunk.chunkZ - minChunkZ) * CHUNK_SIZE

      for (let z = 0; z < CHUNK_SIZE; z += 1) {
        for (let x = 0; x < CHUNK_SIZE; x += 1) {
          const value = chunk.heights[z * CHUNK_SIZE + x]
          heights[(baseZ + z) * width + (baseX + x)] = value
          if (value < low) low = value
          if (value > high) high = value
        }
      }
    }
  }

  return {
    minX: minChunkX * CHUNK_SIZE,
    minZ: minChunkZ * CHUNK_SIZE,
    width,
    height,
    heights,
    chunks: chunkCount,
    regions: regions.length,
    low: Number.isFinite(low) ? low : 0,
    high: Number.isFinite(high) ? high : 0
  }
}
