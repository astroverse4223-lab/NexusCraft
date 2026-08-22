import { existsSync } from 'node:fs'
import { join, basename } from 'node:path'
import type { ContentKindId, Instance, ModrinthInstallResult, ModrinthProject, ModrinthSearchResult, ModrinthVersion } from '@shared/types'
import { request, fetchImageAsDataUrl } from '../../core/http'
import { LauncherError } from '../../core/errors'
import { createLogger } from '../../core/logger'
import { instanceSubdir } from '../instances/instanceService'
import { getSettings } from '../settings/settingsService'
import { createTask } from '../downloads/downloadManager'

const log = createLogger('curseforge')

const API = 'https://api.curseforge.com/v1'

/** CurseForge's numeric ids for the things this launcher installs. */
const GAME_MINECRAFT = 432
const CLASS_MODS = 6
const CLASS_RESOURCE_PACKS = 12
const CLASS_SHADERS = 6552
const CLASS_MODPACKS = 4471

/** Their `modLoaderType` enum. */
const LOADER_IDS: Record<string, number> = {
  forge: 1,
  fabric: 4,
  quilt: 5,
  neoforge: 6
}

function classIdFor(kind: ContentKindId): number {
  switch (kind) {
    case 'resourcepack':
      return CLASS_RESOURCE_PACKS
    case 'shader':
      return CLASS_SHADERS
    case 'modpack':
      return CLASS_MODPACKS
    default:
      return CLASS_MODS
  }
}

function subdirFor(kind: ContentKindId): string {
  switch (kind) {
    case 'resourcepack':
      return 'resourcepacks'
    case 'shader':
      return 'shaderpacks'
    default:
      return 'mods'
  }
}

/* ------------------------------------------------------------ api shapes */

interface CfMod {
  id: number
  name: string
  slug: string
  summary: string
  downloadCount: number
  thumbsUpCount?: number
  logo?: { thumbnailUrl?: string; url?: string } | null
  authors?: Array<{ name: string }>
  categories?: Array<{ name: string }>
  classId?: number
  /** False when the author has opted out of third-party distribution. */
  allowModDistribution?: boolean | null
  links?: { websiteUrl?: string }
}

interface CfFile {
  id: number
  modId: number
  displayName: string
  fileName: string
  fileDate: string
  fileLength: number
  releaseType: number // 1 release, 2 beta, 3 alpha
  downloadUrl: string | null
  gameVersions: string[]
  downloadCount?: number
  hashes?: Array<{ value: string; algo: number }> // algo 1 = sha1
  dependencies?: Array<{ modId: number; relationType: number }> // 3 = required
}

/* ------------------------------------------------------------- requesting */

export function isConfigured(): boolean {
  return Boolean(getSettings().curseForgeApiKey?.trim())
}

function apiKey(): string {
  const key = getSettings().curseForgeApiKey?.trim()
  if (!key) {
    throw new LauncherError('AUTH_NOT_CONFIGURED', 'no CurseForge API key configured', {
      title: 'CurseForge needs an API key',
      message:
        'Searching CurseForge requires a free API key. It is issued instantly from their developer console and is stored only on this PC.',
      actions: [
        'Open Settings → Content and paste your CurseForge API key',
        'Get one at console.curseforge.com — sign in, then "API Keys"',
        'Modrinth needs no key and works without this'
      ]
    })
  }
  return key
}

async function cfGet<T>(path: string, params?: URLSearchParams): Promise<T> {
  const url = `${API}${path}${params ? `?${params}` : ''}`
  const response = await request(url, {
    headers: { 'x-api-key': apiKey(), Accept: 'application/json' },
    timeoutMs: 20_000,
    retries: 2
  })

  if (response.status === 401 || response.status === 403) {
    throw new LauncherError('AUTH_NOT_CONFIGURED', `CurseForge rejected the API key (HTTP ${response.status})`, {
      title: 'CurseForge rejected the API key',
      message: 'The key was not accepted. It may have been typed incorrectly, or revoked.',
      actions: ['Check the key in Settings → Content', 'Generate a new one at console.curseforge.com']
    })
  }
  if (!response.ok) {
    throw new LauncherError('NETWORK_ERROR', `CurseForge returned HTTP ${response.status}`)
  }
  return (await response.json()) as T
}

async function cfPost<T>(path: string, body: unknown): Promise<T> {
  const response = await request(`${API}${path}`, {
    method: 'POST',
    headers: { 'x-api-key': apiKey(), 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
    timeoutMs: 20_000,
    retries: 2
  })
  if (!response.ok) throw new LauncherError('NETWORK_ERROR', `CurseForge returned HTTP ${response.status}`)
  return (await response.json()) as T
}

/* --------------------------------------------------------------- search */

export interface CurseSearchOptions {
  query: string
  kind: ContentKindId
  gameVersion?: string | null
  loader?: string | null
  offset?: number
  limit?: number
  instance?: Instance | null
}

export async function searchCurseForge(options: CurseSearchOptions): Promise<ModrinthSearchResult> {
  const params = new URLSearchParams({
    gameId: String(GAME_MINECRAFT),
    classId: String(classIdFor(options.kind)),
    searchFilter: options.query.slice(0, 120),
    pageSize: String(Math.min(options.limit ?? 20, 50)),
    index: String(Math.max(options.offset ?? 0, 0)),
    sortField: options.query.trim() ? '1' : '6', // 1 = relevancy, 6 = total downloads
    sortOrder: 'desc'
  })
  if (options.gameVersion) params.set('gameVersion', options.gameVersion)

  // Modpacks and resource packs carry no loader of their own.
  if (options.loader && options.kind === 'mod') {
    const loaderId = LOADER_IDS[options.loader]
    if (loaderId) params.set('modLoaderType', String(loaderId))
  }

  const result = await cfGet<{ data: CfMod[]; pagination?: { totalCount: number } }>('/mods/search', params)

  const installed = options.instance ? await installedNames(options.instance, options.kind) : new Set<string>()

  const projects = await Promise.all(
    result.data.map(async (mod): Promise<ModrinthProject> => {
      const icon = mod.logo?.thumbnailUrl ?? mod.logo?.url ?? null
      return {
        projectId: String(mod.id),
        slug: mod.slug,
        title: mod.name,
        description: mod.summary,
        author: mod.authors?.[0]?.name ?? 'Unknown',
        downloads: mod.downloadCount ?? 0,
        follows: mod.thumbsUpCount ?? 0,
        iconDataUrl: icon ? await fetchImageAsDataUrl(icon, { timeoutMs: 8000, retries: 0 }) : null,
        categories: (mod.categories ?? []).slice(0, 6).map((c) => c.name),
        projectType: options.kind,
        installed: [...installed].some((name) => name.includes(mod.slug.toLowerCase())),
        // Surfaced so the interface can say plainly that a mod must be fetched
        // by hand, instead of offering an Install button that cannot work.
        distributionAllowed: mod.allowModDistribution !== false,
        source: 'curseforge',
        pageUrl: mod.links?.websiteUrl ?? `https://www.curseforge.com/minecraft/mc-mods/${mod.slug}`
      }
    })
  )

  return { projects, total: result.pagination?.totalCount ?? projects.length, offset: options.offset ?? 0 }
}

async function installedNames(instance: Instance, kind: ContentKindId): Promise<Set<string>> {
  try {
    const { readdir } = await import('node:fs/promises')
    return new Set((await readdir(instanceSubdir(instance, subdirFor(kind)))).map((n) => n.toLowerCase()))
  } catch {
    return new Set()
  }
}

/* -------------------------------------------------------------- versions */

const RELEASE_TYPES: Record<number, ModrinthVersion['versionType']> = { 1: 'release', 2: 'beta', 3: 'alpha' }

export async function listCurseForgeFiles(
  projectId: string,
  kind: ContentKindId,
  gameVersion?: string | null,
  loader?: string | null
): Promise<ModrinthVersion[]> {
  const params = new URLSearchParams({ pageSize: '50' })
  if (gameVersion) params.set('gameVersion', gameVersion)
  if (loader && kind === 'mod' && LOADER_IDS[loader]) params.set('modLoaderType', String(LOADER_IDS[loader]))

  const result = await cfGet<{ data: CfFile[] }>(`/mods/${encodeURIComponent(projectId)}/files`, params)

  return result.data.map((file) => ({
    versionId: String(file.id),
    name: file.displayName,
    versionNumber: file.displayName,
    gameVersions: file.gameVersions ?? [],
    loaders: loader ? [loader] : [],
    versionType: RELEASE_TYPES[file.releaseType] ?? 'release',
    datePublished: file.fileDate,
    downloads: file.downloadCount ?? 0,
    fileName: file.fileName,
    fileSizeBytes: file.fileLength ?? 0,
    requiredDependencies: (file.dependencies ?? []).filter((d) => d.relationType === 3).length,
    // A null download URL is the author's opt-out, not a launcher failure.
    downloadable: Boolean(file.downloadUrl)
  }))
}

/* ------------------------------------------------------------ installing */

async function getFile(projectId: string, fileId: string): Promise<CfFile> {
  const result = await cfGet<{ data: CfFile }>(
    `/mods/${encodeURIComponent(projectId)}/files/${encodeURIComponent(fileId)}`
  )
  return result.data
}

/**
 * Downloads a CurseForge file into an instance.
 *
 * CurseForge lets authors forbid third-party distribution. When they have, the
 * API returns no download URL and no launcher may fetch the file — so this
 * fails with an explanation and a link rather than trying to work around it.
 */
export async function installCurseForgeFile(
  instance: Instance,
  projectId: string,
  fileId: string,
  kind: ContentKindId
): Promise<ModrinthInstallResult> {
  const file = await getFile(projectId, fileId)

  if (!file.downloadUrl) {
    throw new LauncherError('INVALID_INPUT', `file ${fileId} has no download URL (author opt-out)`, {
      title: 'This mod must be downloaded manually',
      message:
        'Its author has turned off third-party downloads on CurseForge, so no launcher is permitted to fetch it automatically. Download the file from its CurseForge page, then add it with "Add mods".',
      actions: [
        'Open the mod page on CurseForge and download the file',
        'Return here and use Mods → Installed → Add mods',
        'Or look for the same mod on Modrinth, which has no such restriction'
      ]
    })
  }

  const dir = instanceSubdir(instance, subdirFor(kind))
  const destination = join(dir, basename(file.fileName))
  const result: ModrinthInstallResult = { installed: [], dependencies: [], skipped: [] }

  if (existsSync(destination)) {
    result.skipped.push(file.fileName)
    return result
  }

  const sha1 = file.hashes?.find((h) => h.algo === 1)?.value ?? null

  const task = createTask({ instanceId: instance.id, label: `Downloading ${file.displayName}`, phase: 'libraries' })
  task.add([{ url: file.downloadUrl, destination, sha1, size: file.fileLength, label: file.fileName }])
  await task.run()
  task.markDone()

  result.installed.push(file.fileName)
  log.info(`installed ${file.fileName} from CurseForge into "${instance.name}"`)
  return result
}

/** Resolves several CurseForge files at once — used by modpack installs. */
export async function getFiles(fileIds: number[]): Promise<CfFile[]> {
  if (fileIds.length === 0) return []
  const result = await cfPost<{ data: CfFile[] }>('/mods/files', { fileIds })
  return result.data
}
