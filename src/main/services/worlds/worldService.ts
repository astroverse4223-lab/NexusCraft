import { existsSync } from 'node:fs'
import { readdir, readFile, rm, stat, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { BackupInfo, Instance, WorldInfo } from '@shared/types'
import { LauncherError } from '../../core/errors'
import { createLogger } from '../../core/logger'
import { assertInside, instanceDir, ensureDir } from '../../core/paths'
import { instanceSubdir } from '../instances/instanceService'
import { nbtCompound, nbtNumber, nbtString, parseNbt } from './nbt'
import { zipDirectory } from '../backup/zipWriter'
import { emit } from '../../core/events'

const log = createLogger('worlds')

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
