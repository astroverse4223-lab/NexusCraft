import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { cp, link, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import type { Dirent } from 'node:fs'
import type { InstanceSnapshot, SnapshotDiff, SnapshotDiffEntry } from '@shared/types'
import { LauncherError } from '../../core/errors'
import { createLogger } from '../../core/logger'
import { assertInside, instanceDir } from '../../core/paths'
import { getInstance, updateInstance } from './instanceService'
import { isRunning } from '../launch/launchService'

const log = createLogger('snapshots')

/**
 * Restore points for an instance's setup.
 *
 * Updating a 200-mod pack is a coin flip, and the way people cope today is
 * duplicating the whole instance — tens of gigabytes copied to avoid losing a
 * configuration. A snapshot captures the part that actually defines the setup
 * (mods, configs, packs, options) and leaves out the part that dominates the
 * size and is never what you want to roll back (worlds, screenshots, the
 * version files that are shared anyway).
 *
 * Files are hard-linked rather than copied where the filesystem allows it, so
 * a snapshot of a 3 GB mods folder costs kilobytes. A hard link is the same
 * bytes under two names, which is only safe because mod jars are replaced
 * wholesale — installing or updating a mod writes a new file and deletes the
 * old one, it never edits a jar in place.
 */

/**
 * Folders safe to hard-link.
 *
 * A hard link is the same bytes under two names, so it is only safe for files
 * that are never edited in place. Mod jars and pack zips qualify: installing or
 * updating one writes a new file and deletes the old, so the snapshot's link
 * keeps pointing at the bytes that were captured.
 */
const LINKED_DIRS = ['mods', 'resourcepacks', 'shaderpacks']

/**
 * Folders that must be copied.
 *
 * Config files are rewritten in place — a mod opens its own config, truncates
 * it and writes — and a hard link would carry that edit straight into the
 * snapshot, so restoring would hand back the very state the snapshot was meant
 * to protect against. They are also small, so copying costs nothing that
 * matters.
 */
const COPIED_DIRS = ['config', 'defaultconfigs', 'kubejs', 'scripts']

/** What a snapshot captures. Everything else is left alone. */
const TRACKED = [...LINKED_DIRS, ...COPIED_DIRS]

/** Individual files worth keeping. Rewritten in place by the game, so copied. */
const TRACKED_FILES = ['options.txt', 'servers.dat', 'optionsof.txt', 'optionsshaders.txt']

function snapshotsRoot(instanceId: string): string {
  return join(instanceDir(instanceId), 'snapshots')
}

function snapshotDir(instanceId: string, snapshotId: string): string {
  return assertInside(snapshotsRoot(instanceId), join(snapshotsRoot(instanceId), snapshotId))
}

const INDEX_FILE = 'snapshots.json'

async function readIndex(instanceId: string): Promise<InstanceSnapshot[]> {
  try {
    const raw = await readFile(join(snapshotsRoot(instanceId), INDEX_FILE), 'utf8')
    const parsed = JSON.parse(raw) as InstanceSnapshot[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function writeIndex(instanceId: string, entries: InstanceSnapshot[]): Promise<void> {
  await mkdir(snapshotsRoot(instanceId), { recursive: true })
  await writeFile(join(snapshotsRoot(instanceId), INDEX_FILE), JSON.stringify(entries, null, 2), 'utf8')
}

/** Every file under `dir`, relative to it, with its size. */
async function walk(dir: string): Promise<Map<string, number>> {
  const found = new Map<string, number>()

  async function visit(current: string): Promise<void> {
    let entries: Dirent[]
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        await visit(full)
      } else if (entry.isFile()) {
        try {
          found.set(relative(dir, full).split(sep).join('/'), (await stat(full)).size)
        } catch {
          /* vanished mid-walk */
        }
      }
    }
  }

  await visit(dir)
  return found
}

/**
 * Copies a tree, hard-linking each file when `mode` allows it.
 *
 * Linking falls back to a real copy per file: hard links fail across volumes
 * and on filesystems that do not support them, and a snapshot that costs disk
 * is far better than no snapshot.
 */
async function copyTree(
  from: string,
  to: string,
  mode: 'link' | 'copy'
): Promise<{ files: number; bytes: number; linked: boolean }> {
  let files = 0
  let bytes = 0
  let allLinked = mode === 'link'

  const entries = await walk(from)
  for (const [relativePath, size] of entries) {
    const source = join(from, ...relativePath.split('/'))
    const target = join(to, ...relativePath.split('/'))
    await mkdir(join(target, '..'), { recursive: true })

    let placed = false
    if (mode === 'link') {
      try {
        await link(source, target)
        placed = true
      } catch {
        allLinked = false
      }
    }

    if (!placed) {
      try {
        await cp(source, target)
      } catch (err) {
        log.warn(`could not snapshot ${relativePath}: ${(err as Error).message}`)
        continue
      }
    }

    files += 1
    bytes += size
  }

  return { files, bytes, linked: allLinked }
}

/** Whether a tracked folder holds files that are replaced rather than edited. */
function modeFor(folder: string): 'link' | 'copy' {
  return LINKED_DIRS.includes(folder) ? 'link' : 'copy'
}

export async function listSnapshots(instanceId: string): Promise<InstanceSnapshot[]> {
  const entries = await readIndex(instanceId)
  // Only offer what is actually still on disk.
  return entries
    .filter((entry) => existsSync(snapshotDir(instanceId, entry.id)))
    .sort((a, b) => b.createdAt - a.createdAt)
}

export async function createSnapshot(
  instanceId: string,
  name: string,
  note = ''
): Promise<InstanceSnapshot> {
  const instance = getInstance(instanceId)

  if (isRunning(instanceId)) {
    throw new LauncherError('ALREADY_RUNNING', 'the game is running', {
      title: 'Close Minecraft first',
      message: 'A snapshot taken while the game is running can capture half-written config files.',
      actions: ['Quit Minecraft, then take the snapshot']
    })
  }

  const id = randomUUID()
  const target = snapshotDir(instanceId, id)
  await mkdir(target, { recursive: true })

  let files = 0
  let bytes = 0
  let linked = true

  try {
    for (const folder of TRACKED) {
      const source = join(instance.gameDir, folder)
      if (!existsSync(source)) continue
      const result = await copyTree(source, join(target, folder), modeFor(folder))
      files += result.files
      bytes += result.bytes
      if (modeFor(folder) === 'link' && !result.linked) linked = false
    }

    for (const fileName of TRACKED_FILES) {
      const source = join(instance.gameDir, fileName)
      if (!existsSync(source)) continue
      // Always a real copy: the game rewrites these in place, and a link would
      // let the next launch edit the snapshot.
      await cp(source, join(target, fileName)).catch(() => undefined)
      files += 1
      bytes += (await stat(source).catch(() => ({ size: 0 }))).size
    }
  } catch (err) {
    // A half-written snapshot would restore a broken instance.
    await rm(target, { recursive: true, force: true }).catch(() => undefined)
    throw err
  }

  const snapshot: InstanceSnapshot = {
    id,
    instanceId,
    name: name.trim().slice(0, 60) || 'Snapshot',
    note: note.slice(0, 300),
    createdAt: Date.now(),
    files,
    bytes,
    /** False when the filesystem made us copy, which is worth telling the user. */
    linked,
    minecraftVersion: instance.minecraftVersion,
    loader: instance.loader,
    loaderVersion: instance.loaderVersion
  }

  const entries = await readIndex(instanceId)
  await writeIndex(instanceId, [snapshot, ...entries])

  log.info(
    `snapshot "${snapshot.name}" of ${instance.name}: ${files} files, ${(bytes / 1024 / 1024).toFixed(1)} MB ${linked ? 'linked' : 'copied'}`
  )
  return snapshot
}

export async function deleteSnapshot(instanceId: string, snapshotId: string): Promise<void> {
  await rm(snapshotDir(instanceId, snapshotId), { recursive: true, force: true })
  await writeIndex(
    instanceId,
    (await readIndex(instanceId)).filter((entry) => entry.id !== snapshotId)
  )
}

/**
 * Puts an instance back to a snapshot.
 *
 * A snapshot of the current state is taken first, so restoring the wrong one
 * is undoable. The tracked folders are replaced wholesale rather than merged:
 * a mod deleted since the snapshot has to come back, and one added since has
 * to go, which a merge would not do.
 */
export async function restoreSnapshot(instanceId: string, snapshotId: string): Promise<InstanceSnapshot> {
  const instance = getInstance(instanceId)

  if (isRunning(instanceId)) {
    throw new LauncherError('ALREADY_RUNNING', 'the game is running', {
      title: 'Close Minecraft first',
      message: 'Replacing mods and configs under a running game would crash it.',
      actions: ['Quit Minecraft, then restore']
    })
  }

  const entries = await readIndex(instanceId)
  const snapshot = entries.find((entry) => entry.id === snapshotId)
  if (!snapshot) throw new LauncherError('NOT_FOUND', 'that snapshot no longer exists')

  const source = snapshotDir(instanceId, snapshotId)
  if (!existsSync(source)) throw new LauncherError('NOT_FOUND', 'that snapshot is no longer on disk')

  // Keep what is there now, so this is reversible too.
  await createSnapshot(instanceId, `Before restoring "${snapshot.name}"`, 'Taken automatically').catch((err) =>
    log.warn(`could not snapshot before restoring: ${(err as Error).message}`)
  )

  for (const folder of TRACKED) {
    const target = join(instance.gameDir, folder)
    const saved = join(source, folder)

    await rm(target, { recursive: true, force: true }).catch(() => undefined)
    if (existsSync(saved)) {
      await mkdir(target, { recursive: true })
      // Same rule in reverse: a restored config must be the instance's own
      // copy, or the next thing to edit it would rewrite the snapshot.
      await copyTree(saved, target, modeFor(folder))
    }
  }

  for (const fileName of TRACKED_FILES) {
    const target = join(instance.gameDir, fileName)
    const saved = join(source, fileName)
    await rm(target, { force: true }).catch(() => undefined)
    if (existsSync(saved)) await cp(saved, target).catch(() => undefined)
  }

  /*
   * A snapshot from before a loader change has to take the loader with it, or
   * the restored mods would be for a loader the instance no longer uses.
   */
  if (snapshot.loader !== instance.loader || snapshot.loaderVersion !== instance.loaderVersion) {
    updateInstance(instanceId, {
      loader: snapshot.loader,
      loaderVersion: snapshot.loaderVersion,
      // Force the loader profile to be resolved again on the next launch.
      resolvedVersionId: null
    })
  }

  log.info(`restored ${instance.name} to "${snapshot.name}"`)
  return snapshot
}

/**
 * What changed between a snapshot and the instance as it stands.
 *
 * Compares by size rather than by hash: a mod jar that changed version changed
 * size, and hashing several gigabytes to be certain of something the file name
 * already tells you is not worth the wait.
 */
export async function diffSnapshot(instanceId: string, snapshotId: string): Promise<SnapshotDiff> {
  const instance = getInstance(instanceId)
  const source = snapshotDir(instanceId, snapshotId)
  if (!existsSync(source)) throw new LauncherError('NOT_FOUND', 'that snapshot is no longer on disk')

  const added: SnapshotDiffEntry[] = []
  const removed: SnapshotDiffEntry[] = []
  const changed: SnapshotDiffEntry[] = []

  for (const folder of TRACKED) {
    const before = existsSync(join(source, folder)) ? await walk(join(source, folder)) : new Map<string, number>()
    const after = existsSync(join(instance.gameDir, folder))
      ? await walk(join(instance.gameDir, folder))
      : new Map<string, number>()

    for (const [path, size] of after) {
      if (!before.has(path)) added.push({ path: `${folder}/${path}`, sizeBytes: size })
      else if (before.get(path) !== size) changed.push({ path: `${folder}/${path}`, sizeBytes: size })
    }
    for (const [path, size] of before) {
      if (!after.has(path)) removed.push({ path: `${folder}/${path}`, sizeBytes: size })
    }
  }

  const byPath = (a: SnapshotDiffEntry, b: SnapshotDiffEntry): number => a.path.localeCompare(b.path)

  return {
    snapshotId,
    added: added.sort(byPath),
    removed: removed.sort(byPath),
    changed: changed.sort(byPath)
  }
}
