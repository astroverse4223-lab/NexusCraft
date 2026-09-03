import { existsSync } from 'node:fs'
import { readdir, readFile, rm, stat, mkdir, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { BackupInfo, Instance, WorldInfo, WorldMapData } from '@shared/types'
import { LauncherError } from '../../core/errors'
import { createLogger } from '../../core/logger'
import { assertInside, instanceDir, ensureDir } from '../../core/paths'
import { instanceSubdir } from '../instances/instanceService'
import { nbtCompound, nbtNumber, nbtString, parseNbt } from './nbt'
import { zipDirectory } from '../backup/zipWriter'
import { readWorldMap } from './regionReader'
import { emit } from '../../core/events'

const log = createLogger('worlds')

/**
 * A drawable height map for one world.
 *
 * Downsampled here rather than in the interface: a big world is millions of
 * columns, and the point of the cap is to keep what crosses the IPC boundary
 * and sits in the renderer's memory bounded regardless of how long the world
 * has been played.
 */
export async function worldMap(instance: Instance, folderName: string): Promise<WorldMapData | null> {
  const regionDir = join(savesDir(instance), folderName, 'region')
  const map = await readWorldMap(regionDir)
  if (!map) return null

  // At most ~900 px on the long side; a whole-world view is not a blueprint.
  const step = Math.max(1, Math.ceil(Math.max(map.width, map.height) / 900))
  const width = Math.floor(map.width / step)
  const height = Math.floor(map.height / step)
  const out = new Int16Array(width * height)

  for (let z = 0; z < height; z += 1) {
    for (let x = 0; x < width; x += 1) {
      /*
       * Take the highest column in each cell rather than an average. A mean
       * blurs a one-block wall into the ground it stands on, which is exactly
       * the thing a player is looking for on their own map.
       */
      let best = -1
      for (let dz = 0; dz < step; dz += 1) {
        for (let dx = 0; dx < step; dx += 1) {
          const value = map.heights[(z * step + dz) * map.width + (x * step + dx)]
          if (value > best) best = value
        }
      }
      out[z * width + x] = best
    }
  }

  return {
    minX: map.minX,
    minZ: map.minZ,
    width,
    height,
    step,
    low: map.low,
    high: map.high,
    chunks: map.chunks,
    regions: map.regions,
    heights: new Uint8Array(out.buffer, out.byteOffset, out.byteLength)
  }
}

export function savesDir(instance: Instance): string {
  return instanceSubdir(instance, 'saves')
}

export function backupsDir(instance: Instance): string {
  return ensureDir(join(instanceDir(instance.id), 'backups'))
}

const GAME_MODES: Record<number, string> = {
  0: 'Survival',
  1: 'Creative',
  2: 'Adventure',
  3: 'Spectator'
}

async function directorySize(dir: string): Promise<number> {
  let total = 0
  try {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) total += await directorySize(full)
      else if (entry.isFile()) total += (await stat(full)).size.valueOf()
    }
  } catch {
    /* unreadable */
  }
  return total
}

/**
 * Reads a world's level.dat. A world whose level.dat is missing or unparseable
 * is reported as corrupt rather than hidden, so the user can act on it.
 */
async function readWorld(savesRoot: string, folderName: string): Promise<WorldInfo | null> {
  const path = join(savesRoot, folderName)
  let info: Awaited<ReturnType<typeof stat>>
  try {
    info = await stat(path)
  } catch {
    return null
  }
  if (!info.isDirectory()) return null

  const world: WorldInfo = {
    folderName,
    path,
    name: folderName,
    lastPlayed: null,
    gameVersion: null,
    gameMode: null,
    hardcore: false,
    iconDataUrl: null,
    sizeBytes: 0,
    corrupt: false
  }

  const iconPath = join(path, 'icon.png')
  if (existsSync(iconPath)) {
    try {
      const data = await readFile(iconPath)
      if (data.byteLength > 0 && data.byteLength < 2 * 1024 * 1024) {
        world.iconDataUrl = `data:image/png;base64,${data.toString('base64')}`
      }
    } catch {
      /* icon is optional */
    }
  }

  const levelDat = join(path, 'level.dat')
  if (!existsSync(levelDat)) {
    world.corrupt = true
    return world
  }

  try {
    const root = await parseNbt(await readFile(levelDat))
    const data = nbtCompound(root.Data)
    if (!data) throw new Error('level.dat has no Data compound')

    world.name = nbtString(data.LevelName) ?? folderName
    world.lastPlayed = nbtNumber(data.LastPlayed)
    world.hardcore = nbtNumber(data.hardcore) === 1

    const gameType = nbtNumber(data.GameType)
    world.gameMode = gameType != null ? (GAME_MODES[gameType] ?? null) : null

    const version = nbtCompound(data.Version)
    world.gameVersion = version ? nbtString(version.Name) : null
  } catch (err) {
    log.warn(`could not read level.dat for "${folderName}": ${(err as Error).message}`)
    world.corrupt = true
  }

  world.sizeBytes = await directorySize(path)
  return world
}

export async function listWorlds(instance: Instance): Promise<WorldInfo[]> {
  const root = savesDir(instance)
  let entries: string[]
  try {
    entries = await readdir(root)
  } catch {
    return []
  }

  const worlds: WorldInfo[] = []
  for (const name of entries) {
    if (name.startsWith('.')) continue
    const world = await readWorld(root, name)
    if (world) worlds.push(world)
  }

  worlds.sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0) || a.name.localeCompare(b.name))
  return worlds
}

/* -------------------------------------------------------------- backups */

function timestamp(): string {
  const now = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`
}

/** Sanitises a world folder name into something safe for a file name. */
function safeName(name: string): string {
  return name.replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 60) || 'world'
}

export async function backupWorld(instance: Instance, folderName: string): Promise<BackupInfo> {
  const saves = savesDir(instance)
  const source = assertInside(saves, join(saves, folderName))
  if (!existsSync(source)) throw new LauncherError('NOT_FOUND', 'that world no longer exists')

  const dir = backupsDir(instance)
  await mkdir(dir, { recursive: true })
  const fileName = `${safeName(folderName)}_${timestamp()}.zip`
  const output = join(dir, fileName)

  log.info(`backing up world "${folderName}" from ${instance.name}`)

  const result = await zipDirectory(source, output, (progress) => {
    // Reuse the download progress channel so the UI shows one consistent bar.
    emit('download:progress', {
      taskId: `backup:${instance.id}`,
      instanceId: instance.id,
      phase: 'verifying',
      label: `Backing up ${folderName}`,
      currentFile: progress.file,
      completedFiles: progress.completed,
      totalFiles: progress.total,
      downloadedBytes: 0,
      totalBytes: 0,
      speedBps: 0,
      etaSeconds: null,
      paused: false,
      errors: [],
      active: progress.completed < progress.total
    })
  })

  log.info(`backup complete: ${fileName} (${result.entries} files, ${result.bytes} bytes)`)

  return {
    fileName,
    path: output,
    sizeBytes: result.bytes,
    createdAt: Date.now(),
    worldName: folderName
  }
}

export async function listBackups(instance: Instance): Promise<BackupInfo[]> {
  const dir = backupsDir(instance)
  let names: string[]
  try {
    names = (await readdir(dir)).filter((name) => name.endsWith('.zip'))
  } catch {
    return []
  }

  const backups: BackupInfo[] = []
  for (const name of names) {
    try {
      const info = await stat(join(dir, name))
      backups.push({
        fileName: name,
        path: join(dir, name),
        sizeBytes: info.size,
        createdAt: info.mtimeMs,
        // Everything before the timestamp suffix is the world folder name.
        worldName: name.replace(/_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.zip$/, '')
      })
    } catch {
      /* skip */
    }
  }

  backups.sort((a, b) => b.createdAt - a.createdAt)
  return backups
}

export async function deleteBackup(instance: Instance, fileName: string): Promise<void> {
  const dir = backupsDir(instance)
  const target = assertInside(dir, join(dir, fileName))
  await rm(target, { force: true })
}

/**
 * Turns a zip into a world folder under `saves`.
 *
 * Minecraft world archives come in two shapes: the world folder zipped up (so
 * every entry sits under `MyWorld/`) and the *contents* zipped up (`level.dat`
 * at the root). Both are common, so the level.dat is located first and whatever
 * directory holds it becomes the world root.
 */
export async function importWorldArchive(instance: Instance, filePath: string): Promise<WorldInfo> {
  const AdmZip = (await import('adm-zip')).default

  let zip: InstanceType<typeof AdmZip>
  try {
    zip = new AdmZip(filePath)
  } catch {
    throw new LauncherError('INVALID_INPUT', 'not a readable zip archive', {
      title: 'That file is not a world archive',
      message: 'A Minecraft world is a folder containing level.dat, usually shared as a .zip.',
      actions: ['Check the file downloaded completely', 'Drop the .zip you received rather than an extracted folder']
    })
  }

  const entries = zip.getEntries().filter((entry) => !entry.isDirectory)

  // The shallowest level.dat wins: a world may contain another world in a
  // backups folder, and the outer one is the world being imported.
  const levelEntry = entries
    .filter((entry) => entry.entryName.toLowerCase().endsWith('level.dat'))
    .sort((a, b) => a.entryName.split('/').length - b.entryName.split('/').length)[0]

  if (!levelEntry) {
    throw new LauncherError('INVALID_INPUT', 'no level.dat in the archive', {
      title: 'That archive is not a Minecraft world',
      message: 'It contains no level.dat, which every world has at its root.',
      actions: ['Make sure you are importing a world, not a modpack or resource pack']
    })
  }

  // Everything above level.dat is the prefix to strip from each entry.
  const prefix = levelEntry.entryName.slice(0, levelEntry.entryName.length - 'level.dat'.length)

  const suggested =
    safeName(prefix.replace(/\/$/, '').split('/').pop() || basename(filePath).replace(/\.zip$/i, '')) || 'Imported world'

  const saves = savesDir(instance)
  await mkdir(saves, { recursive: true })

  // Never overwrite an existing world; suffix until the name is free.
  let folderName = suggested
  let suffix = 2
  while (existsSync(join(saves, folderName))) {
    folderName = `${suggested} (${suffix})`
    suffix += 1
  }

  const destination = assertInside(saves, join(saves, folderName))
  await mkdir(destination, { recursive: true })

  let written = 0
  try {
    for (const entry of entries) {
      if (prefix && !entry.entryName.startsWith(prefix)) continue
      const relative = entry.entryName.slice(prefix.length)
      if (!relative || relative.includes('..')) continue

      const target = assertInside(destination, join(destination, ...relative.split('/')))
      await mkdir(join(target, '..'), { recursive: true })
      await writeFile(target, entry.getData())
      written += 1
    }
  } catch (err) {
    // A half-extracted world is worse than none: Minecraft would list it and
    // then fail to open it.
    await rm(destination, { recursive: true, force: true }).catch(() => undefined)
    throw err
  }

  log.info(`imported world "${folderName}" into ${instance.name} (${written} files)`)

  const world = await readWorld(saves, folderName)
  if (!world) throw new LauncherError('INSTANCE_CORRUPT', 'the imported world could not be read back')
  return world
}

/**
 * Puts a backup back, replacing the world it came from.
 *
 * The world being replaced is itself backed up first, so restoring the wrong
 * restore point is undoable — which is the whole point of restore points.
 */
export async function restoreBackup(instance: Instance, fileName: string): Promise<WorldInfo> {
  const dir = backupsDir(instance)
  const archive = assertInside(dir, join(dir, fileName))
  if (!existsSync(archive)) throw new LauncherError('NOT_FOUND', 'that backup no longer exists')

  const AdmZip = (await import('adm-zip')).default
  const zip = new AdmZip(archive)
  const entries = zip.getEntries().filter((entry) => !entry.isDirectory)

  /*
   * Which world this goes back into.
   *
   * Backups are written from inside the world folder, so level.dat is at the
   * archive root and the folder name has to come from the file name — but that
   * name went through `safeName`, which replaces anything outside a small
   * character set. Restoring "My World!" by its sanitised name would create a
   * folder called "My World_" beside the original and leave the real world
   * untouched, having promised to replace it. So the sanitised name is matched
   * back against the folders that actually exist.
   */
  const stamped = fileName.replace(/_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.zip$/, '')
  const saves = savesDir(instance)

  let existing: string[] = []
  try {
    existing = (await readdir(saves, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    /* no saves folder yet; the world is being restored into an empty instance */
  }

  const worldName =
    existing.find((folder) => folder === stamped) ??
    existing.find((folder) => safeName(folder) === stamped) ??
    stamped

  const destination = assertInside(saves, join(saves, worldName))

  if (existsSync(destination)) {
    await backupWorld(instance, worldName)
    await rm(destination, { recursive: true, force: true })
  }

  await mkdir(destination, { recursive: true })
  for (const entry of entries) {
    if (entry.entryName.includes('..')) continue
    const target = assertInside(destination, join(destination, ...entry.entryName.split('/')))
    await mkdir(join(target, '..'), { recursive: true })
    await writeFile(target, entry.getData())
  }

  log.info(`restored "${worldName}" in ${instance.name} from ${fileName}`)

  const world = await readWorld(saves, worldName)
  if (!world) throw new LauncherError('INSTANCE_CORRUPT', 'the restored world could not be read back')
  return world
}

/**
 * Deletes a world. A backup is always taken first — losing a world to a
 * mis-click is not a recoverable mistake otherwise.
 */
export async function deleteWorld(instance: Instance, folderName: string): Promise<BackupInfo> {
  const saves = savesDir(instance)
  const target = assertInside(saves, join(saves, folderName))
  if (!existsSync(target)) throw new LauncherError('NOT_FOUND', 'that world no longer exists')

  const backup = await backupWorld(instance, folderName)
  await rm(target, { recursive: true, force: true })
  log.info(`deleted world "${folderName}" (backup kept at ${backup.fileName})`)
  return backup
}
