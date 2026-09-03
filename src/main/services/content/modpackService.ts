import { mkdir, writeFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, dirname, isAbsolute } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import AdmZip from 'adm-zip'
import type { LoaderId, ModpackInfo, ModpackInstallResult } from '@shared/types'
import { getJson, getBuffer } from '../../core/http'
import { LauncherError } from '../../core/errors'
import { createLogger } from '../../core/logger'
import { assertInside } from '../../core/paths'
import { createInstance, deleteInstance } from '../instances/instanceService'
import { createTask, type DownloadItem } from '../downloads/downloadManager'
import { getFiles } from './curseforgeService'

const log = createLogger('modpack')

/* ------------------------------------------------------- manifest shape */

export interface MrpackFile {
  path: string
  hashes?: { sha1?: string; sha512?: string }
  env?: { client?: string; server?: string }
  downloads: string[]
  fileSize?: number
}

export interface MrpackIndex {
  formatVersion: number
  game: string
  versionId: string
  name: string
  summary?: string
  files: MrpackFile[]
  dependencies: Record<string, string>
}

/**
 * Hosts a modpack may pull files from.
 *
 * A .mrpack is data from a third party that tells the launcher to download and
 * write files onto the user's disk, so the URLs it names are not trusted. This
 * mirrors the host allowlist Modrinth itself enforces when publishing packs;
 * anything else is skipped and reported rather than fetched.
 */
const ALLOWED_DOWNLOAD_DOMAINS = [
  'modrinth.com',
  'githubusercontent.com',
  'github.com',
  'gitlab.com',
  'shedaniel.me',
  'maven.minecraftforge.net',
  'maven.neoforged.net',
  'maven.fabricmc.net'
]

export function isAllowedDownload(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return false
    const host = parsed.hostname.toLowerCase()
    return ALLOWED_DOWNLOAD_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`))
  } catch {
    return false
  }
}

/* -------------------------------------------------------------- parsing */

/** Maps the pack's dependency block onto a loader the launcher understands. */
export function resolveLoader(dependencies: Record<string, string>): { loader: LoaderId; version: string | null } {
  if (dependencies['fabric-loader']) return { loader: 'fabric', version: dependencies['fabric-loader'] }
  if (dependencies['quilt-loader']) return { loader: 'quilt', version: dependencies['quilt-loader'] }
  if (dependencies['neoforge']) return { loader: 'neoforge', version: dependencies['neoforge'] }
  if (dependencies['forge']) return { loader: 'forge', version: dependencies['forge'] }
  return { loader: 'vanilla', version: null }
}

/**
 * Rejects any path that would write outside the instance. Entry paths inside a
 * .mrpack are attacker-controlled, and "../" in a zip entry is the classic
 * zip-slip escape.
 */
export function safeTarget(gameDir: string, relative: string): string {
  const cleaned = relative.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!cleaned || cleaned.includes('..') || isAbsolute(cleaned) || /^[a-zA-Z]:/.test(cleaned)) {
    throw new LauncherError('INVALID_INPUT', `modpack entry escapes the instance: ${relative.slice(0, 120)}`)
  }
  const target = join(gameDir, ...cleaned.split('/'))
  // Belt and braces: resolve and confirm containment.
  return assertInside(gameDir, target)
}

export function readIndex(zip: AdmZip): MrpackIndex {
  const entry = zip.getEntry('modrinth.index.json')
  if (!entry) {
    throw new LauncherError('INVALID_INPUT', 'no modrinth.index.json in the archive', {
      title: 'That is not a Modrinth modpack',
      message:
        'The archive contains neither a modrinth.index.json nor a CurseForge manifest.json, so it is not a modpack this launcher recognises.',
      actions: [
        'Check you selected a .mrpack or a CurseForge pack .zip',
        'Some sites wrap the pack in another zip — extract it first'
      ]
    })
  }

  let index: MrpackIndex
  try {
    index = JSON.parse(entry.getData().toString('utf8')) as MrpackIndex
  } catch {
    throw new LauncherError('INVALID_INPUT', 'modrinth.index.json is not valid JSON')
  }

  if (!index.dependencies?.minecraft) {
    throw new LauncherError('INVALID_INPUT', 'the pack does not declare a Minecraft version')
  }
  return index
}

function countOverrides(zip: AdmZip): number {
  return zip
    .getEntries()
    .filter((e) => !e.isDirectory && (e.entryName.startsWith('overrides/') || e.entryName.startsWith('client-overrides/')))
    .length
}

/** Reads a .mrpack's manifest without installing anything. */
export async function inspectModpack(filePath: string): Promise<ModpackInfo> {
  if (!existsSync(filePath)) throw new LauncherError('NOT_FOUND', 'that file no longer exists')

  let zip: AdmZip
  try {
    zip = new AdmZip(filePath)
  } catch {
    throw new LauncherError('INVALID_INPUT', 'the archive could not be opened', {
      title: 'That file could not be read',
      message: 'The modpack archive appears to be damaged or is not a zip file.',
      actions: ['Download the modpack again']
    })
  }

  // CurseForge packs use a different container; detect rather than assume.
  const cf = readCfManifest(zip)
  if (cf) return inspectCurseForge(zip, cf)

  const index = readIndex(zip)
  const { loader, version } = resolveLoader(index.dependencies)

  return {
    name: index.name || 'Modpack',
    version: index.versionId || '',
    summary: index.summary ?? null,
    minecraftVersion: index.dependencies.minecraft,
    loader,
    loaderVersion: version,
    fileCount: (index.files ?? []).length,
    overrideCount: countOverrides(zip),
    format: 'modrinth'
  }
}

/* ----------------------------------------------------------- installing */

/**
 * Installs a .mrpack as a brand new instance: creates it with the Minecraft
 * version and loader the pack declares, downloads every file the pack lists,
 * and unpacks its overrides. Nothing is written outside the new instance.
 */
export async function installModpackFromFile(filePath: string, nameOverride?: string): Promise<ModpackInstallResult> {
  const zip = new AdmZip(filePath)

  const cf = readCfManifest(zip)
  if (cf) return await installCurseForgePack(zip, cf, nameOverride)

  const index = readIndex(zip)
  const { loader, version: loaderVersion } = resolveLoader(index.dependencies)

  log.info(`installing modpack "${index.name}" (${index.dependencies.minecraft}, ${loader})`)

  const instance = await createInstance({
    name: (nameOverride?.trim() || index.name || 'Modpack').slice(0, 64),
    minecraftVersion: index.dependencies.minecraft,
    loader,
    loaderVersion
  })

  const task = createTask({ instanceId: instance.id, label: `Installing ${index.name}`, phase: 'libraries' })
  const skipped: string[] = []

  try {
    /* files listed in the manifest */
    const items: DownloadItem[] = []
    for (const file of index.files ?? []) {
      // Server-only files have no place in a client instance.
      if (file.env?.client === 'unsupported') continue

      const url = (file.downloads ?? []).find(isAllowedDownload)
      if (!url) {
        skipped.push(file.path)
        log.warn(`skipping "${file.path}": no download URL from an allowed host`)
        continue
      }

      items.push({
        url,
        destination: safeTarget(instance.gameDir, file.path),
        sha1: file.hashes?.sha1 ?? null,
        size: file.fileSize ?? null,
        label: file.path.split('/').pop() ?? file.path
      })
    }

    task.setPhase('libraries', `Downloading ${items.length} modpack files`)
    task.add(items)
    await task.run()

    /* overrides bundled inside the archive */
    task.setPhase('verifying', 'Unpacking modpack configuration')
    let overrides = 0
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory) continue
      const prefix = entry.entryName.startsWith('overrides/')
        ? 'overrides/'
        : entry.entryName.startsWith('client-overrides/')
          ? 'client-overrides/'
          : null
      if (!prefix) continue

      const relative = entry.entryName.slice(prefix.length)
      if (!relative) continue

      const target = safeTarget(instance.gameDir, relative)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, entry.getData())
      overrides++
    }

    task.setPhase('done', 'Modpack installed')
    task.markDone()

    log.info(`modpack "${index.name}" installed: ${items.length} files, ${overrides} overrides, ${skipped.length} skipped`)
    return { instance, installedFiles: items.length, overrides, skipped }
  } catch (err) {
    task.cancel()
    // A half-installed instance is worse than none — roll it back.
    await deleteInstance(instance.id, true).catch(() => undefined)
    throw err
  }
}

/** Downloads a modpack version from Modrinth, then installs it. */
export async function installModpackFromModrinth(versionId: string, nameOverride?: string): Promise<ModpackInstallResult> {
  interface RawVersion {
    files: Array<{ url: string; filename: string; primary: boolean }>
    name: string
  }

  const version = await getJson<RawVersion>(`https://api.modrinth.com/v2/version/${encodeURIComponent(versionId)}`, {
    timeoutMs: 20_000,
    retries: 2
  })

  const file = version.files.find((f) => f.filename.endsWith('.mrpack')) ?? version.files.find((f) => f.primary)
  if (!file || !isAllowedDownload(file.url)) {
    throw new LauncherError('INVALID_INPUT', 'that version has no downloadable .mrpack file')
  }

  const workDir = join(tmpdir(), `nexuscraft-mrpack-${randomUUID()}`)
  await mkdir(workDir, { recursive: true })
  const localPath = join(workDir, 'pack.mrpack')

  try {
    log.info(`downloading modpack archive ${file.filename}`)
    await writeFile(localPath, await getBuffer(file.url, { timeoutMs: 300_000, retries: 2 }))
    return await installModpackFromFile(localPath, nameOverride)
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

/** Reads a downloaded .mrpack's manifest without installing (used for previews). */
export async function inspectModpackFromBuffer(buffer: Buffer): Promise<ModpackInfo> {
  const workDir = join(tmpdir(), `nexuscraft-inspect-${randomUUID()}`)
  await mkdir(workDir, { recursive: true })
  const localPath = join(workDir, 'pack.mrpack')
  try {
    await writeFile(localPath, buffer)
    return await inspectModpack(localPath)
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

/** Exposed for tests and diagnostics. */
export const __internals = { isAllowedDownload, resolveLoader, safeTarget }


/* ------------------------------------------------- CurseForge modpacks */

/**
 * CurseForge packs use a different container to Modrinth's: a plain .zip with a
 * `manifest.json` listing project/file id pairs, and an `overrides` folder. The
 * ids must be resolved against the CurseForge API to obtain download URLs, so
 * this path needs an API key where the Modrinth one does not.
 */
export interface CfManifest {
  manifestType?: string
  name?: string
  version?: string
  author?: string
  overrides?: string
  minecraft: {
    version: string
    modLoaders?: Array<{ id: string; primary?: boolean }>
  }
  files?: Array<{ projectID: number; fileID: number; required?: boolean }>
}

/** "forge-47.2.0" -> { loader: 'forge', version: '47.2.0' } */
export function parseCfLoader(modLoaders: CfManifest['minecraft']['modLoaders']): {
  loader: LoaderId
  version: string | null
} {
  const primary = modLoaders?.find((l) => l.primary) ?? modLoaders?.[0]
  if (!primary?.id) return { loader: 'vanilla', version: null }

  const [name, ...rest] = primary.id.split('-')
  const version = rest.join('-') || null
  switch (name.toLowerCase()) {
    case 'forge':
      return { loader: 'forge', version }
    case 'neoforge':
      return { loader: 'neoforge', version }
    case 'fabric':
      return { loader: 'fabric', version }
    case 'quilt':
      return { loader: 'quilt', version }
    default:
      return { loader: 'vanilla', version: null }
  }
}

export function readCfManifest(zip: AdmZip): CfManifest | null {
  const entry = zip.getEntry('manifest.json')
  if (!entry) return null
  try {
    const parsed = JSON.parse(entry.getData().toString('utf8')) as CfManifest
    return parsed.minecraft?.version ? parsed : null
  } catch {
    return null
  }
}

function inspectCurseForge(zip: AdmZip, manifest: CfManifest): ModpackInfo {
  const { loader, version } = parseCfLoader(manifest.minecraft.modLoaders)
  const overridesDir = manifest.overrides ?? 'overrides'
  const overrideCount = zip
    .getEntries()
    .filter((e) => !e.isDirectory && e.entryName.startsWith(`${overridesDir}/`)).length

  return {
    name: manifest.name || 'Modpack',
    version: manifest.version || '',
    summary: manifest.author ? `by ${manifest.author}` : null,
    minecraftVersion: manifest.minecraft.version,
    loader,
    loaderVersion: version,
    fileCount: (manifest.files ?? []).length,
    overrideCount,
    format: 'curseforge'
  }
}

async function installCurseForgePack(
  zip: AdmZip,
  manifest: CfManifest,
  nameOverride?: string
): Promise<ModpackInstallResult> {
  const { loader, version: loaderVersion } = parseCfLoader(manifest.minecraft.modLoaders)
  log.info(`installing CurseForge modpack "${manifest.name}" (${manifest.minecraft.version}, ${loader})`)

  const instance = await createInstance({
    name: (nameOverride?.trim() || manifest.name || 'Modpack').slice(0, 64),
    minecraftVersion: manifest.minecraft.version,
    loader,
    loaderVersion
  })

  const task = createTask({ instanceId: instance.id, label: `Installing ${manifest.name}`, phase: 'libraries' })
  const skipped: string[] = []

  try {
    const entries = manifest.files ?? []
    task.setPhase('libraries', `Resolving ${entries.length} files with CurseForge`)

    // One bulk call rather than a request per mod.
    const resolved = await getFiles(entries.map((f) => f.fileID))
    const byId = new Map(resolved.map((f) => [f.id, f]))

    const items: DownloadItem[] = []
    for (const entry of entries) {
      const file = byId.get(entry.fileID)
      if (!file) {
        skipped.push(`file ${entry.fileID}`)
        continue
      }
      // A missing download URL is the author's opt-out from third-party
      // distribution, not a failure — record it so the user can fetch it.
      if (!file.downloadUrl) {
        skipped.push(file.fileName || `file ${entry.fileID}`)
        continue
      }

      items.push({
        url: file.downloadUrl,
        destination: safeTarget(instance.gameDir, `mods/${file.fileName}`),
        sha1: file.hashes?.find((h) => h.algo === 1)?.value ?? null,
        size: file.fileLength ?? null,
        label: file.fileName
      })
    }

    task.setPhase('libraries', `Downloading ${items.length} modpack files`)
    task.add(items)
    await task.run()

    task.setPhase('verifying', 'Unpacking modpack configuration')
    const overridesDir = manifest.overrides ?? 'overrides'
    let overrides = 0
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory) continue
      if (!entry.entryName.startsWith(`${overridesDir}/`)) continue
      const relative = entry.entryName.slice(overridesDir.length + 1)
      if (!relative) continue

      const target = safeTarget(instance.gameDir, relative)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, entry.getData())
      overrides++
    }

    task.setPhase('done', 'Modpack installed')
    task.markDone()

    if (skipped.length > 0) {
      log.warn(`${skipped.length} file(s) could not be downloaded automatically (author opt-out)`)
    }
    return { instance, installedFiles: items.length, overrides, skipped }
  } catch (err) {
    task.cancel()
    await deleteInstance(instance.id, true).catch(() => undefined)
    throw err
  }
}

/** Downloads a CurseForge modpack file, then installs it. */
export async function installCurseForgeModpack(
  projectId: string,
  fileId: string,
  nameOverride?: string
): Promise<ModpackInstallResult> {
  const [file] = await getFiles([Number(fileId)])
  if (!file?.downloadUrl) {
    throw new LauncherError('INVALID_INPUT', `modpack file ${fileId} cannot be downloaded`, {
      title: 'This modpack must be downloaded manually',
      message:
        'Its author has turned off third-party downloads on CurseForge, so no launcher may fetch it automatically. Download the pack .zip from its CurseForge page, then use Import modpack.',
      actions: [
        'Open the pack page on CurseForge and download the .zip',
        'Return here and use Instances -> Import modpack',
        'Modrinth packs carry no such restriction'
      ]
    })
  }

  const workDir = join(tmpdir(), `nexuscraft-cfpack-${randomUUID()}`)
  await mkdir(workDir, { recursive: true })
  const localPath = join(workDir, 'pack.zip')
  try {
    await writeFile(localPath, await getBuffer(file.downloadUrl, { timeoutMs: 300_000, retries: 2 }))
    return await installModpackFromFile(localPath, nameOverride)
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined)
  }
}
