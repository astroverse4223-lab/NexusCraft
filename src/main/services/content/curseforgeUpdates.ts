import { readFile, readdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { Instance, ModUpdate } from '@shared/types'
import { createLogger } from '../../core/logger'
import { LauncherError } from '../../core/errors'
import { instanceSubdir } from '../instances/instanceService'
import { createTask } from '../downloads/downloadManager'
import { murmur2 } from './curseforgeFingerprint'
import { cfPost, cfGet, isConfigured, loaderIdFor } from './curseforgeService'
import { stashForRollback } from './modrinthService'

const log = createLogger('curseforge-updates')

/**
 * Updating mods that came from CurseForge.
 *
 * The existing updater is Modrinth-only, and silently so: it hashes each jar,
 * asks Modrinth what it is, and a CurseForge mod simply never appears in the
 * results. From the outside that is indistinguishable from being up to date,
 * which is the worst way for a feature to be missing.
 *
 * The shape is deliberately the same as Modrinth's — hash what is on disk, ask
 * the site to identify it, ask what is newer — because it produces the same
 * `ModUpdate` and drops into the same review screen, with the same undo. The
 * only real difference is the hash: CurseForge wants a Murmur2 over the file
 * with whitespace stripped, which is what `curseforgeFingerprint` is for.
 */

interface FingerprintMatch {
  id: number
  file: { id: number; fileFingerprint: number; fileName: string; displayName?: string }
}

interface CfFileSummary {
  id: number
  displayName: string
  fileName: string
  fileDate: string
  fileLength: number
  releaseType: number
  downloadUrl: string | null
  gameVersions: string[]
}

/** Everything in the mods folder, including the ones turned off. */
async function jarsOnDisk(instance: Instance): Promise<Array<{ fileName: string; path: string }>> {
  const dir = instanceSubdir(instance, 'mods')
  let entries: string[] = []
  try {
    entries = await readdir(dir)
  } catch {
    return []
  }

  return entries
    .filter((name) => name.endsWith('.jar') || name.endsWith('.jar.disabled'))
    .map((name) => ({ fileName: name, path: join(dir, name) }))
}

/**
 * Which installed jars CurseForge recognises.
 *
 * One request for the lot. The endpoint takes an array, and asking per file
 * would be a hundred round trips and a rate limit on a large pack.
 */
async function identify(
  jars: Array<{ fileName: string; path: string }>
): Promise<Map<string, FingerprintMatch>> {
  const prints = new Map<number, string>()

  for (const jar of jars) {
    try {
      const print = murmur2(await readFile(jar.path))
      // Two identical jars under different names would collide; the first wins
      // and the second is simply not offered an update, which is harmless.
      if (!prints.has(print)) prints.set(print, jar.fileName)
    } catch (err) {
      log.warn(`could not read ${jar.fileName}: ${(err as Error).message}`)
    }
  }
  if (prints.size === 0) return new Map()

  const response = await cfPost<{ data?: { exactMatches?: FingerprintMatch[] } }>('/fingerprints', {
    fingerprints: [...prints.keys()]
  })

  const byFileName = new Map<string, FingerprintMatch>()
  for (const match of response.data?.exactMatches ?? []) {
    const fileName = prints.get(match.file?.fileFingerprint)
    if (fileName) byFileName.set(fileName, match)
  }
  return byFileName
}

/** The newest file for this project that suits the instance. */
async function newestFor(instance: Instance, modId: number): Promise<CfFileSummary | null> {
  const params = new URLSearchParams({ gameVersion: instance.minecraftVersion, pageSize: '20' })
  const loader = loaderIdFor(instance.loader)
  if (loader !== null) params.set('modLoaderType', String(loader))

  const response = await cfGet<{ data?: CfFileSummary[] }>(`/mods/${modId}/files`, params)
  const files = response.data ?? []
  if (files.length === 0) return null

  // The API returns newest first, but not dependably across pages, so sort.
  return files.sort((a: CfFileSummary, b: CfFileSummary) => Date.parse(b.fileDate) - Date.parse(a.fileDate))[0] ?? null
}

const RELEASE_TYPES: Record<number, ModUpdate['versionType']> = { 1: 'release', 2: 'beta', 3: 'alpha' }

/** Whether the leading number changed, which is where mods break configs. */
function isMajorJump(from: string, to: string): boolean {
  const lead = (value: string): number | null => {
    const match = /\d+/.exec(value)
    return match ? Number(match[0]) : null
  }
  const a = lead(from)
  const b = lead(to)
  return a !== null && b !== null && b > a
}

export async function checkCurseForgeUpdates(instance: Instance): Promise<ModUpdate[]> {
  if (!isConfigured()) return []

  const jars = await jarsOnDisk(instance)
  if (jars.length === 0) return []

  const identified = await identify(jars)
  if (identified.size === 0) return []

  const updates: ModUpdate[] = []

  for (const [fileName, match] of identified) {
    let newest: CfFileSummary | null = null
    try {
      newest = await newestFor(instance, match.id)
    } catch (err) {
      // One project failing must not lose the rest of the results.
      log.warn(`could not list files for ${match.id}: ${(err as Error).message}`)
      continue
    }

    if (!newest || newest.id === match.file.id) continue
    // A file with no download url is one CurseForge will not serve to a
    // launcher; offering it would produce a download that always fails.
    if (!newest.downloadUrl) continue

    const currentName = match.file.displayName ?? match.file.fileName;
    updates.push({
      fileName,
      modName: newest.displayName || basename(fileName),
      projectId: String(match.id),
      currentVersion: currentName,
      currentVersionId: String(match.file.id),
      newVersion: newest.displayName,
      newVersionId: String(newest.id),
      newFileName: newest.fileName,
      sizeBytes: newest.fileLength,
      enabled: !fileName.endsWith('.disabled'),
      versionType: RELEASE_TYPES[newest.releaseType] ?? 'release',
      // ModUpdate stores this as a timestamp; CurseForge sends an ISO string.
      publishedAt: Date.parse(newest.fileDate),
      majorJump: isMajorJump(currentName, newest.displayName),
      source: 'curseforge'
    })
  }

  log.info(`${updates.length} CurseForge update(s) for "${instance.name}"`)
  return updates
}

export async function applyCurseForgeUpdate(instance: Instance, update: ModUpdate): Promise<void> {
  const dir = instanceSubdir(instance, 'mods')
  const response = await cfGet<{ data?: CfFileSummary }>(`/mods/${update.projectId}/files/${update.newVersionId}`)
  const file = response.data
  if (!file?.downloadUrl) {
    throw new LauncherError('NOT_FOUND', 'CurseForge will not serve that file to a launcher', {
      title: `${update.modName} cannot be downloaded automatically`,
      message:
        'The author has turned off third-party downloads for this file, so it has to be fetched from the website by hand.',
      actions: ['Open the project page on CurseForge', 'Download the file into this instance’s mods folder']
    })
  }

  // The disabled suffix carries across, so an update never re-enables a mod
  // that was deliberately switched off.
  const targetName = update.enabled ? basename(file.fileName) : `${basename(file.fileName)}.disabled`
  const destination = join(dir, targetName)

  const task = createTask({ instanceId: instance.id, label: `Updating ${update.modName}`, phase: 'libraries' })
  task.add([{ url: file.downloadUrl, destination, sha1: null, size: file.fileLength, label: file.fileName }])
  await task.run()
  task.markDone()

  const old = join(dir, update.fileName)
  if (old !== destination) await stashForRollback(instance, update, old)

  log.info(`updated ${update.fileName} -> ${targetName} in "${instance.name}"`)
}
