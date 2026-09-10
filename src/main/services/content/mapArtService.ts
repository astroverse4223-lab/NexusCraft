import { existsSync } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { MAP_SIZE } from '@shared/mapArt'
import type { Instance } from '@shared/types'
import { LauncherError } from '../../core/errors'
import { createLogger } from '../../core/logger'
import { assertInside } from '../../core/paths'
import { instanceSubdir } from '../instances/instanceService'

const log = createLogger('mapart')

/**
 * Writing map art into a world.
 *
 * A map is a file in the world's `data` folder holding 128 by 128 colour bytes
 * and nothing much else. Making map art is therefore not a mod or a datapack -
 * it is writing those files and then handing somebody the maps that point at
 * them. Where exactly they go depends on the version; see `mapLayout`.
 *
 * The format here was read off a real map the game wrote, rather than assumed:
 *
 *   { data: { xCenter, zCenter, dimension, colors: byte[16384] }, DataVersion }
 *
 * which is why `scale` and `locked` are written too. They are optional and the
 * game omits them when they are default, but a map that is not locked redraws
 * itself from the ground the moment somebody holds it - which erases the
 * picture. Locking is the whole difference between map art and a blank map.
 */

/** What the world says it is, so a map written into it is not from the future. */
async function dataVersionOf(world: string): Promise<number> {
  const level = join(world, 'level.dat')

  if (existsSync(level)) {
    try {
      const nbt = require('prismarine-nbt')
      const parsed = await nbt.parse(await readFile(level))
      const simple = nbt.simplify(parsed.parsed) as { Data?: { DataVersion?: number } }

      const version = simple?.Data?.DataVersion
      if (typeof version === 'number' && version > 0) return version
    } catch (err) {
      log.warn(`could not read DataVersion from level.dat: ${(err as Error).message}`)
    }
  }

  /*
   * A guess only when the world will not say.
   *
   * Too low and the game upgrades the file, which is harmless; too high and it
   * refuses to read it at all, so the fallback is deliberately not the newest
   * number known.
   */
  return 3953
}

/**
 * Where a world keeps its saved data.
 *
 * 26 moved every saved file into a folder named after its namespace. What was
 * `data/scoreboard.dat` is now `data/minecraft/scoreboard.dat`, and a map that
 * was `data/map_7.dat` is `data/minecraft/maps/7.dat` with the counter beside
 * it at `data/minecraft/maps/last_id.dat`.
 *
 * This matters more than a moved file usually would, because the server does
 * not look in the old place at all and does not complain about it either. The
 * give succeeds, the item frame holds a real filled map, and the client draws
 * the little rolled-up map icon instead of the picture - because it is never
 * sent any map data for an id nothing ever loaded. Nothing in the log says so.
 *
 * Read off the world rather than guessed from a version string, because the
 * world is the thing that has to read it back afterwards.
 */
export interface MapLayout {
  mapFile: (id: number) => string
  counter: string
  folder: string
  namespaced: boolean
}

export function mapLayout(dataDir: string, minecraftVersion: string): MapLayout {
  const namespaced: MapLayout = {
    mapFile: (id) => join(dataDir, 'minecraft', 'maps', `${id}.dat`),
    counter: join(dataDir, 'minecraft', 'maps', 'last_id.dat'),
    folder: join(dataDir, 'minecraft', 'maps'),
    namespaced: true
  }

  const flat: MapLayout = {
    mapFile: (id) => join(dataDir, `map_${id}.dat`),
    counter: join(dataDir, 'idcounts.dat'),
    folder: dataDir,
    namespaced: false
  }

  // A world that has ever run says which one it is, and is never wrong.
  if (existsSync(join(dataDir, 'minecraft'))) return namespaced
  if (
    existsSync(join(dataDir, 'idcounts.dat')) ||
    existsSync(join(dataDir, 'scoreboard.dat')) ||
    existsSync(join(dataDir, 'random_sequences.dat'))
  ) {
    return flat
  }

  // A world that has never been opened does not, so the version decides. 1.21
  // and below are flat; 26 and above are namespaced.
  return majorOf(minecraftVersion) >= 26 ? namespaced : flat
}

function majorOf(versionId: string): number {
  const major = parseInt(versionId.split('.')[0] ?? '', 10)
  return Number.isFinite(major) ? major : 0
}

/** The next free map id, and the file that decides it. */
async function nextMapId(layout: MapLayout): Promise<number> {
  const nbt = require('prismarine-nbt')

  let next = 0

  if (existsSync(layout.counter)) {
    try {
      const parsed = await nbt.parse(await readFile(layout.counter))
      const simple = nbt.simplify(parsed.parsed) as { data?: { map?: number } }

      // The stored number is the last id handed out, so the next one is after
      // it. Reading it as "the next" would overwrite whatever map that is.
      const last = simple?.data?.map
      if (typeof last === 'number') next = last + 1
    } catch (err) {
      log.warn(`could not read ${layout.counter}: ${(err as Error).message}`)
    }
  }

  /*
   * And past anything already sitting in the folder.
   *
   * The counter is missing in a world that has never made a map, and missing
   * again in a folder maps have just been moved into - so trusting it on its
   * own hands out an id that already has a picture on it and writes over it.
   */
  try {
    const pattern = layout.namespaced ? /^(\d+)\.dat$/ : /^map_(\d+)\.dat$/

    for (const name of await readdir(layout.folder)) {
      const match = pattern.exec(name)
      if (match) next = Math.max(next, Number(match[1]) + 1)
    }
  } catch {
    /* A folder that will not list is one with nothing in it to avoid. */
  }

  return next
}

async function writeIdCounts(
  layout: MapLayout,
  last: number,
  dataVersion: number
): Promise<void> {
  const nbt = require('prismarine-nbt')

  const tag = nbt.comp({
    data: nbt.comp({ map: nbt.int(last) }),
    DataVersion: nbt.int(dataVersion)
  })

  await writeFile(layout.counter, gzipSync(nbt.writeUncompressed({ ...tag, name: '' } as never)))
}

function mapFile(colours: Uint8Array, dataVersion: number): Buffer {
  const nbt = require('prismarine-nbt')

  const tag = nbt.comp({
    data: nbt.comp({
      scale: nbt.byte(0),
      dimension: nbt.string('minecraft:overworld'),
      trackingPosition: nbt.byte(0),
      unlimitedTracking: nbt.byte(0),
      // Without this the map redraws from the ground under whoever holds it,
      // which replaces the picture with a picture of the floor.
      locked: nbt.byte(1),
      xCenter: nbt.int(0),
      zCenter: nbt.int(0),
      banners: nbt.list(nbt.comp([])),
      frames: nbt.list(nbt.comp([])),
      colors: nbt.byteArray(Array.from(colours, (b) => (b > 127 ? b - 256 : b)))
    }),
    DataVersion: nbt.int(dataVersion)
  })

  return gzipSync(nbt.writeUncompressed({ ...tag, name: '' } as never))
}

export interface MapArtResult {
  world: string
  ids: number[]
  across: number
  down: number
  commands: string[]
}

/**
 * Writes every tile as a map, and says how to get them.
 *
 * The give commands come back rather than being run, because the world is very
 * often not open - and a list somebody can paste works whether the game is
 * running or not.
 */
/**
 * The same maps, into a server's world instead of a save.
 *
 * A hosted server keeps its world beside its jar rather than under saves, and
 * the launcher runs the one this is most likely to be wanted on - so writing
 * only into singleplayer worlds made the feature useless for exactly the case
 * it was asked for.
 */
export async function writeMapArtToServer(
  serverDir: string,
  worldFolder: string,
  minecraftVersion: string,
  tiles: number[][],
  across: number,
  down: number
): Promise<MapArtResult> {
  const world = join(serverDir, worldFolder)

  if (!existsSync(world)) {
    throw new LauncherError('NOT_FOUND', `world ${worldFolder} does not exist`, {
      title: 'That world is not there',
      message: 'The server has not generated its world yet. Start it once, then try again.'
    })
  }

  return await writeInto(world, worldFolder, minecraftVersion, tiles, across, down)
}

export async function writeMapArt(
  instance: Instance,
  worldFolder: string,
  tiles: number[][],
  across: number,
  down: number
): Promise<MapArtResult> {
  const saves = instanceSubdir(instance, 'saves')
  const world = assertInside(saves, join(saves, worldFolder))

  if (!existsSync(world)) {
    throw new LauncherError('NOT_FOUND', `world ${worldFolder} does not exist`, {
      title: 'That world no longer exists',
      message: 'The world you chose has been deleted or renamed.',
      actions: ['Pick a different world']
    })
  }

  return await writeInto(world, worldFolder, instance.minecraftVersion, tiles, across, down)
}

/** Everything both of them do once the world folder is known. */
async function writeInto(
  world: string,
  worldFolder: string,
  minecraftVersion: string,
  tiles: number[][],
  across: number,
  down: number
): Promise<MapArtResult> {
  /*
   * Checked here, where both callers pass through.
   *
   * It used to be checked in the singleplayer path alone, so the server path
   * added later would have written whatever it was handed - and a tile of the
   * wrong length is a map file the game cannot read.
   */
  if (tiles.length === 0) {
    throw new LauncherError('INVALID_INPUT', 'no tiles', {
      title: 'There was nothing to write',
      message: 'The picture produced no map tiles.'
    })
  }

  for (const tile of tiles) {
    if (tile.length !== MAP_SIZE * MAP_SIZE) {
      throw new LauncherError('INVALID_INPUT', 'a tile was the wrong size', {
        title: 'That picture did not come out right',
        message: `A map has to be ${MAP_SIZE} by ${MAP_SIZE}. One tile was ${tile.length} bytes.`
      })
    }
  }

  const dataDir = join(world, 'data')
  await mkdir(dataDir, { recursive: true })

  const layout = mapLayout(dataDir, minecraftVersion)
  await mkdir(layout.folder, { recursive: true })

  if (layout.namespaced) await rescueOldMaps(dataDir, layout)

  const dataVersion = await dataVersionOf(world)
  const first = await nextMapId(layout)

  const ids: number[] = []

  for (let i = 0; i < tiles.length; i++) {
    const id = first + i
    await writeFile(layout.mapFile(id), mapFile(Uint8Array.from(tiles[i]), dataVersion))
    ids.push(id)
  }

  await writeIdCounts(layout, first + tiles.length - 1, dataVersion)

  /*
   * Components rather than the old tag, from 1.20.5 onwards.
   *
   * `{map:3}` was silently ignored from that version, which produces a blank
   * map and no error - so the version decides which form is written.
   */
  const modern = isModern(minecraftVersion)

  const commands = ids.map((id) =>
    modern
      ? `/give @p minecraft:filled_map[minecraft:map_id=${id}]`
      : `/give @p filled_map{map:${id}} 1`
  )

  log.info(`wrote ${ids.length} map(s) into ${worldFolder}, ids ${ids[0]}-${ids[ids.length - 1]}`)

  return { world: worldFolder, ids, across, down, commands }
}

/**
 * Maps left behind in the old place, put where the server reads them.
 *
 * Anything written before the layout was understood sits at `data/map_N.dat`
 * in a world that only reads `data/minecraft/maps/N.dat`, which is a wall of
 * item frames showing the map icon and no way to tell why. Copying keeps the
 * ids, so frames that are already hung start showing their picture rather than
 * having to be taken down and replaced.
 *
 * Only ever copies into a gap. A map the world already has in the new place is
 * the real one and is never touched.
 */
async function rescueOldMaps(dataDir: string, layout: MapLayout): Promise<void> {
  let moved = 0

  try {
    for (const name of await readdir(dataDir)) {
      const match = /^map_(\d+)\.dat$/.exec(name)
      if (!match) continue

      const id = Number(match[1])
      const to = layout.mapFile(id)
      if (existsSync(to)) continue

      await copyFile(join(dataDir, name), to)
      moved++
    }
  } catch (err) {
    // A rescue that does not happen leaves the old files exactly as they were.
    log.warn(`could not move old maps across: ${(err as Error).message}`)
    return
  }

  if (moved > 0) log.info(`moved ${moved} map(s) into ${layout.folder}`)
}

/** Whether this version wants item components rather than NBT tags. */
function isModern(versionId: string): boolean {
  const parts = versionId.split('.').map((n) => parseInt(n, 10))

  if (parts[0] >= 26) return true
  if (parts[0] !== 1) return true
  if (parts[1] > 20) return true
  if (parts[1] === 20) return (parts[2] ?? 0) >= 5

  return false
}
