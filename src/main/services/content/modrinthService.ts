import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join, basename } from 'node:path'
import type {
  ContentKindId,
  Instance,
  ModrinthInstallResult,
  ModrinthProject,
  ModrinthSearchResult,
  ModrinthVersion
} from '@shared/types'
import { getJson, fetchImageAsDataUrl } from '../../core/http'
import { LauncherError } from '../../core/errors'
import { createLogger } from '../../core/logger'
import { instanceSubdir } from '../instances/instanceService'
import { createTask, type DownloadItem } from '../downloads/downloadManager'

const log = createLogger('modrinth')

const API = 'https://api.modrinth.com/v2'

/* ------------------------------------------------------------ api shapes */

interface RawSearchHit {
  project_id: string
  slug: string
  title: string
  description: string
  author: string
  downloads: number
  follows: number
  icon_url: string | null
  categories: string[]
  project_type: string
}

interface RawSearchResponse {
  hits: RawSearchHit[]
  total_hits: number
  offset: number
}

interface RawVersion {
  id: string
  name: string
  version_number: string
  game_versions: string[]
  loaders: string[]
  version_type: string
  date_published: string
  downloads: number
  files: Array<{ url: string; filename: string; primary: boolean; size: number; hashes?: { sha1?: string } }>
  dependencies: Array<{ project_id: string | null; version_id: string | null; dependency_type: string }>
}

/* ----------------------------------------------------------- kind mapping */

/** Where each content kind lives inside an instance, and how Modrinth names it. */
const KINDS: Record<ContentKindId, { projectType: string; subdir: string; extensions: RegExp }> = {
  mod: { projectType: 'mod', subdir: 'mods', extensions: /\.jar$/i },
  resourcepack: { projectType: 'resourcepack', subdir: 'resourcepacks', extensions: /\.zip$/i },
  shader: { projectType: 'shader', subdir: 'shaderpacks', extensions: /\.(zip|zip\.txt)$/i },
  modpack: { projectType: 'modpack', subdir: 'mods', extensions: /\.mrpack$/i }
}

/**
 * Modrinth's `loaders` facet doubles as the shader-loader field. Resource packs
 * carry no loader at all, so filtering by one returns nothing.
 */
function loaderFacet(kind: ContentKindId, loader: string): string[] {
  if (kind === 'resourcepack') return []
  if (kind === 'shader') return ['iris', 'optifine', 'canvas', 'vanilla']
  if (loader === 'vanilla') return []
  // Quilt runs Fabric mods, so surface both rather than an empty shelf.
  if (loader === 'quilt') return ['quilt', 'fabric']
  return [loader]
}

/* --------------------------------------------------------------- searching */

export interface SearchOptions {
  query: string
  kind: ContentKindId
  gameVersion?: string | null
  loader?: string | null
  offset?: number
  limit?: number
  /** Used to mark results that are already installed. */
  instance?: Instance | null
}

export async function searchProjects(options: SearchOptions): Promise<ModrinthSearchResult> {
  const kind = KINDS[options.kind]
  if (!kind) throw new LauncherError('INVALID_INPUT', `unknown content kind ${options.kind}`)

  // Facets are AND-ed across groups and OR-ed within a group.
  const facets: string[][] = [[`project_type:${kind.projectType}`]]
  if (options.gameVersion) facets.push([`versions:${options.gameVersion}`])

  const loaders = options.loader ? loaderFacet(options.kind, options.loader) : []
  if (loaders.length > 0) facets.push(loaders.map((l) => `categories:${l}`))

  const params = new URLSearchParams({
    query: options.query.slice(0, 120),
    facets: JSON.stringify(facets),
    limit: String(Math.min(options.limit ?? 20, 50)),
    offset: String(Math.max(options.offset ?? 0, 0)),
    index: options.query.trim() ? 'relevance' : 'downloads'
  })

  const response = await getJson<RawSearchResponse>(`${API}/search?${params}`, { timeoutMs: 20_000, retries: 2 })

  const installedNames = options.instance ? await installedFileNames(options.instance, options.kind) : new Set<string>()

  // Icons are fetched here so the renderer never makes a network request; a
  // failed icon is not worth failing a search over.
  const projects = await Promise.all(
    response.hits.map(async (hit): Promise<ModrinthProject> => ({
      projectId: hit.project_id,
      slug: hit.slug,
      title: hit.title,
      description: hit.description,
      author: hit.author,
      downloads: hit.downloads,
      follows: hit.follows,
      iconDataUrl: hit.icon_url ? await fetchImageAsDataUrl(hit.icon_url, { timeoutMs: 8000, retries: 0 }) : null,
      categories: hit.categories.slice(0, 6),
      projectType: hit.project_type,
      installed: [...installedNames].some((name) => name.includes(hit.slug.toLowerCase()))
    }))
  )

  return { projects, total: response.total_hits, offset: response.offset }
}

async function installedFileNames(instance: Instance, kind: ContentKindId): Promise<Set<string>> {
  try {
    const dir = instanceSubdir(instance, KINDS[kind].subdir)
    return new Set((await readdir(dir)).map((name) => name.toLowerCase()))
  } catch {
    return new Set()
  }
}

/* --------------------------------------------------------------- versions */

export async function listVersions(
  projectId: string,
  kind: ContentKindId,
  gameVersion?: string | null,
  loader?: string | null
): Promise<ModrinthVersion[]> {
  const params = new URLSearchParams()
  if (gameVersion) params.set('game_versions', JSON.stringify([gameVersion]))
  const loaders = loader ? loaderFacet(kind, loader) : []
  if (loaders.length > 0) params.set('loaders', JSON.stringify(loaders))

  const query = params.toString()
  const versions = await getJson<RawVersion[]>(
    `${API}/project/${encodeURIComponent(projectId)}/version${query ? `?${query}` : ''}`,
    { timeoutMs: 20_000, retries: 2 }
  )

  return versions
    .map((version): ModrinthVersion | null => {
      const file = version.files.find((f) => f.primary) ?? version.files[0]
      if (!file) return null
      return {
        versionId: version.id,
        name: version.name,
        versionNumber: version.version_number,
        gameVersions: version.game_versions,
        loaders: version.loaders,
        versionType: (['release', 'beta', 'alpha'].includes(version.version_type)
          ? version.version_type
          : 'release') as ModrinthVersion['versionType'],
        datePublished: version.date_published,
        downloads: version.downloads,
        fileName: file.filename,
        fileSizeBytes: file.size,
        requiredDependencies: version.dependencies.filter((d) => d.dependency_type === 'required').length
      }
    })
    .filter((v): v is ModrinthVersion => v !== null)
}

/* -------------------------------------------------------------- installing */

async function fetchVersion(versionId: string): Promise<RawVersion> {
  return await getJson<RawVersion>(`${API}/version/${encodeURIComponent(versionId)}`, { timeoutMs: 20_000, retries: 2 })
}

/**
 * Picks the best version of a dependency project for this instance. Modrinth
 * dependencies often name only a project, leaving the launcher to choose.
 */
async function resolveDependencyVersion(
  projectId: string,
  gameVersion: string | null,
  loader: string | null
): Promise<RawVersion | null> {
  const params = new URLSearchParams()
  if (gameVersion) params.set('game_versions', JSON.stringify([gameVersion]))
  const loaders = loader ? loaderFacet('mod', loader) : []
  if (loaders.length > 0) params.set('loaders', JSON.stringify(loaders))

  try {
    const versions = await getJson<RawVersion[]>(
      `${API}/project/${encodeURIComponent(projectId)}/version?${params}`,
      { timeoutMs: 15_000, retries: 1 }
    )
    // Newest release first; fall back to any build if there is no release.
    return versions.find((v) => v.version_type === 'release') ?? versions[0] ?? null
  } catch {
    return null
  }
}

/**
 * Downloads a Modrinth version into the right folder of an instance, pulling in
 * any required dependencies. Files are hash-verified by the download manager.
 */
export async function installVersionToInstance(
  instance: Instance,
  versionId: string,
  kind: ContentKindId
): Promise<ModrinthInstallResult> {
  const targetDir = instanceSubdir(instance, KINDS[kind].subdir)
  const result: ModrinthInstallResult = { installed: [], dependencies: [], skipped: [] }

  const version = await fetchVersion(versionId)
  const task = createTask({ instanceId: instance.id, label: 'Downloading content', phase: 'libraries' })

  const items: DownloadItem[] = []

  const queue = (raw: RawVersion, isDependency: boolean): void => {
    const file = raw.files.find((f) => f.primary) ?? raw.files[0]
    if (!file) return
    const destination = join(targetDir, basename(file.filename))

    // Never silently replace something already there.
    if (existsSync(destination)) {
      result.skipped.push(file.filename)
      return
    }

    items.push({
      url: file.url,
      destination,
      sha1: file.hashes?.sha1 ?? null,
      size: file.size,
      label: file.filename
    })
    if (isDependency) result.dependencies.push(file.filename)
    else result.installed.push(file.filename)
  }

  queue(version, false)

  // Required dependencies, one level deep — enough for the overwhelming
  // majority of mods (an API or library jar) without risking a runaway graph.
  const gameVersion = instance.minecraftVersion
  for (const dependency of version.dependencies) {
    if (dependency.dependency_type !== 'required') continue
    try {
      const raw = dependency.version_id
        ? await fetchVersion(dependency.version_id)
        : dependency.project_id
          ? await resolveDependencyVersion(dependency.project_id, gameVersion, instance.loader)
          : null
      if (raw) queue(raw, true)
    } catch (err) {
      log.warn(`could not resolve a required dependency: ${(err as Error).message}`)
    }
  }

  if (items.length === 0) {
    task.markDone()
    return result
  }

  task.add(items)
  await task.run()
  task.markDone()

  log.info(
    `installed ${result.installed.length} file(s) and ${result.dependencies.length} dependency file(s) into "${instance.name}"`
  )
  return result
}

/** Fetches a project's full description for the details panel. */
export async function getProjectBody(projectId: string): Promise<{ body: string; title: string }> {
  const project = await getJson<{ body: string; title: string }>(
    `${API}/project/${encodeURIComponent(projectId)}`,
    { timeoutMs: 15_000, retries: 1 }
  )
  return { body: (project.body ?? '').slice(0, 20_000), title: project.title }
}
