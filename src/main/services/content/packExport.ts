import AdmZip from 'adm-zip'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { join, relative, sep } from 'node:path'
import type { Instance } from '@shared/types'
import { LauncherError } from '../../core/errors'
import { createLogger } from '../../core/logger'
import { request } from '../../core/http'
import { instanceSubdir } from '../instances/instanceService'
import type { MrpackFile, MrpackIndex } from './modpackService'

const log = createLogger('pack-export')

const API = 'https://api.modrinth.com/v2'

/**
 * Turns an instance into a shareable `.mrpack`.
 *
 * The import side already exists; this is the other direction, and it is what
 * makes a hand-built instance something a friend can install — in this
 * launcher, or in Prism, or on Modrinth's own app, because the format is
 * theirs rather than ours.
 *
 * The interesting part is deciding, per file, between a *reference* and a
 * *copy*. Every jar is hashed and offered to Modrinth: anything it recognises
 * becomes a download link, which keeps the archive small and respects authors
 * who would rather their files came from them. Everything else — configs, a
 * jar from CurseForge, one built by hand — is copied into `overrides/`, which
 * is exactly what that folder is for.
 */

/** What gets considered for a Modrinth reference, and where it lives. */
const HASHED_DIRS = ['mods', 'resourcepacks', 'shaderpacks']

/** Folders copied verbatim into overrides when the user asks for them. */
const CONFIG_DIRS = ['config', 'defaultconfigs', 'kubejs', 'scripts', 'resourcepacks', 'shaderpacks', 'mods']

export interface PackExportOptions {
  /** Shown as the pack name; defaults to the instance name. */
  name?: string
  /** The pack's own version string, e.g. "1.0.0". */
  version?: string
  summary?: string
  /** Copy config folders into overrides. On by default — a pack without its configs is not the same pack. */
  includeConfigs?: boolean
  /** Include the instance's worlds. Off by default: they are large and personal. */
  includeWorlds?: boolean
}

export interface PackExportResult {
  path: string
  bytes: number
  /** Files referenced by download link rather than copied. */
  linked: number
  /** Files copied into overrides. */
  overrides: number
  /** Names of jars Modrinth did not recognise, so a copy was shipped instead. */
  unmatched: string[]
}

interface RemoteVersionFile {
  filename: string
  url: string
  primary: boolean
  size: number
  hashes?: { sha1?: string; sha512?: string }
}

interface RemoteVersion {
  id: string
  files: RemoteVersionFile[]
}

/** Both hashes a .mrpack entry carries, from one read of the file. */
async function hashFile(path: string): Promise<{ sha1: string; sha512: string; size: number }> {
  const data = await readFile(path)
  return {
    sha1: createHash('sha1').update(data).digest('hex'),
    sha512: createHash('sha512').update(data).digest('hex'),
    size: data.length
  }
}

/** Asks Modrinth which of these hashes it knows, in one round trip. */
async function lookupByHash(hashes: string[]): Promise<Record<string, RemoteVersion>> {
  if (hashes.length === 0) return {}
  try {
    const response = await request(`${API}/version_files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ hashes, algorithm: 'sha1' }),
      timeoutMs: 25_000,
      retries: 2
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return (await response.json()) as Record<string, RemoteVersion>
  } catch (err) {
    // A pack where nothing was matched is still a valid pack — every file just
    // ships as an override instead. Losing the network should not lose the export.
    log.warn(`could not reach Modrinth to match files: ${(err as Error).message}`)
    return {}
  }
}

/** Every file under `dir`, as paths relative to it. */
async function walk(dir: string): Promise<string[]> {
  const found: string[] = []

  async function visit(current: string): Promise<void> {
    let entries: Dirent[]
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) await visit(full)
      else if (entry.isFile()) found.push(relative(dir, full))
    }
  }

  await visit(dir)
  return found
}

/** The `dependencies` block naming the loader a pack needs. */
function dependencyBlock(instance: Instance): Record<string, string> {
  const dependencies: Record<string, string> = { minecraft: instance.minecraftVersion }
  const version = instance.loaderVersion ?? ''

  switch (instance.loader) {
    case 'fabric':
      dependencies['fabric-loader'] = version || '0.16.9'
      break
    case 'quilt':
      dependencies['quilt-loader'] = version || '0.27.0'
      break
    case 'forge':
      dependencies['forge'] = version || ''
      break
    case 'neoforge':
      dependencies['neoforge'] = version || ''
      break
    case 'vanilla':
      break
  }

  // An empty loader version would make the pack unusable; drop the key instead
  // so the installing launcher picks its own recommended build.
  for (const [key, value] of Object.entries(dependencies)) {
    if (!value) delete dependencies[key]
  }
  return dependencies
}

export function suggestedPackName(instance: Instance): string {
  const safe = instance.name.replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 50) || 'modpack'
  return `${safe}.mrpack`
}

export async function exportInstanceAsPack(
  instance: Instance,
  outputPath: string,
  options: PackExportOptions = {}
): Promise<PackExportResult> {
  const includeConfigs = options.includeConfigs ?? true
  const includeWorlds = options.includeWorlds ?? false

  /* 1. hash everything Modrinth might recognise */

  interface Candidate {
    /** Path inside the pack, always forward-slashed. */
    packPath: string
    absolute: string
    sha1: string
    sha512: string
    size: number
  }

  const candidates: Candidate[] = []

  for (const subdir of HASHED_DIRS) {
    const dir = instanceSubdir(instance, subdir)
    if (!existsSync(dir)) continue

    for (const relativePath of await walk(dir)) {
      // A disabled mod is one the user turned off; shipping it enabled in a
      // pack would quietly re-enable it for everyone who installs it.
      if (relativePath.endsWith('.disabled')) continue
      if (!/\.(jar|zip)$/i.test(relativePath)) continue

      const absolute = join(dir, relativePath)
      const { sha1, sha512, size } = await hashFile(absolute)
      candidates.push({
        packPath: `${subdir}/${relativePath.split(sep).join('/')}`,
        absolute,
        sha1,
        sha512,
        size
      })
    }
  }

  const matched = await lookupByHash(candidates.map((candidate) => candidate.sha1))

  /* 2. split into references and copies */

  const files: MrpackFile[] = []
  const copyIntoOverrides: Array<{ packPath: string; absolute: string }> = []
  const unmatched: string[] = []

  for (const candidate of candidates) {
    const version = matched[candidate.sha1]
    const remote = version?.files.find((file) => file.hashes?.sha1 === candidate.sha1)

    if (remote && remote.url) {
      files.push({
        path: candidate.packPath,
        hashes: { sha1: candidate.sha1, sha512: candidate.sha512 },
        downloads: [remote.url],
        fileSize: candidate.size
      })
    } else {
      copyIntoOverrides.push({ packPath: candidate.packPath, absolute: candidate.absolute })
      unmatched.push(candidate.packPath.split('/').pop() ?? candidate.packPath)
    }
  }

  /* 3. everything else that makes the pack what it is */

  if (includeConfigs) {
    for (const subdir of CONFIG_DIRS) {
      const dir = instanceSubdir(instance, subdir)
      if (!existsSync(dir)) continue

      for (const relativePath of await walk(dir)) {
        const packPath = `${subdir}/${relativePath.split(sep).join('/')}`
        // Jars and pack zips were already decided on above.
        if (candidates.some((candidate) => candidate.packPath === packPath)) continue
        if (relativePath.endsWith('.disabled')) continue
        copyIntoOverrides.push({ packPath, absolute: join(dir, relativePath) })
      }
    }
  }

  if (includeWorlds) {
    const saves = instanceSubdir(instance, 'saves')
    if (existsSync(saves)) {
      for (const relativePath of await walk(saves)) {
        copyIntoOverrides.push({
          packPath: `saves/${relativePath.split(sep).join('/')}`,
          absolute: join(saves, relativePath)
        })
      }
    }
  }

  if (files.length === 0 && copyIntoOverrides.length === 0) {
    throw new LauncherError('NOT_FOUND', 'nothing to export', {
      title: 'There is nothing in this instance to pack',
      message: `${instance.name} has no mods, packs or config files, so the export would be empty.`,
      actions: ['Add some mods first, then export']
    })
  }

  /* 4. write the archive */

  const index: MrpackIndex = {
    formatVersion: 1,
    game: 'minecraft',
    versionId: (options.version ?? '1.0.0').slice(0, 32),
    name: (options.name?.trim() || instance.name).slice(0, 120),
    summary: options.summary?.slice(0, 400) || undefined,
    files,
    dependencies: dependencyBlock(instance)
  }

  const zip = new AdmZip()
  zip.addFile('modrinth.index.json', Buffer.from(JSON.stringify(index, null, 2), 'utf8'))

  for (const entry of copyIntoOverrides) {
    try {
      zip.addFile(`overrides/${entry.packPath}`, await readFile(entry.absolute))
    } catch (err) {
      log.warn(`skipped ${entry.packPath}: ${(err as Error).message}`)
    }
  }

  await new Promise<void>((resolve, reject) => {
    zip.writeZip(outputPath, (err) => (err ? reject(err) : resolve()))
  })

  const { size } = await stat(outputPath)

  log.info(
    `exported "${instance.name}" as ${outputPath}: ${files.length} linked, ${copyIntoOverrides.length} copied`
  )

  return {
    path: outputPath,
    bytes: size,
    linked: files.length,
    overrides: copyIntoOverrides.length,
    unmatched
  }
}
