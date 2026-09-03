import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join, basename } from 'node:path'
import type {
  ContentKindId,
  Instance,
  ModChangelog,
  ModRollback,
  ModUpdate,
  ModrinthInstallResult,
  ModrinthProject,
  ModrinthSearchResult,
  ModrinthVersion,
  LoaderId
} from '@shared/types'
import { getJson, request, fetchImageAsDataUrl } from '../../core/http'
import { LauncherError } from '../../core/errors'
import { createLogger } from '../../core/logger'
import { instanceDir } from '../../core/paths'
import { instanceSubdir } from '../instances/instanceService'
import { createTask, sha1OfFile, type DownloadItem } from '../downloads/downloadManager'

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
  /** The project this version belongs to. Distinct from `id`, which is the version. */
  project_id?: string
  name: string
  version_number: string
  game_versions: string[]
  loaders: string[]
  version_type: string
  date_published: string
  downloads: number
  /** The author's release notes, in markdown. Often absent. */
  changelog?: string | null
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
  // Resource packs have no loader, and a modpack brings its own — filtering
  // either by the current instance's loader would hide valid results.
  if (kind === 'resourcepack' || kind === 'modpack') return []
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
  return await installVersionToDir(
    {
      dir: instanceSubdir(instance, KINDS[kind].subdir),
      taskId: instance.id,
      loader: instance.loader,
      minecraftVersion: instance.minecraftVersion
    },
    versionId,
    kind
  )
}

/** Where an install should land, plus what it needs to resolve dependencies. */
export interface InstallTarget {
  dir: string
  /** Groups the download in the UI; an instance id, or the server's id. */
  taskId: string
  loader: LoaderId
  minecraftVersion: string
}

/**
 * Installs a Modrinth version into a specific folder. Hosted servers keep their
 * mods outside the instances tree, so the destination cannot be derived from an
 * instance the way it can for the client.
 */
export async function installVersionToDir(
  target: InstallTarget,
  versionId: string,
  kind: ContentKindId
): Promise<ModrinthInstallResult> {
  const targetDir = target.dir
  const result: ModrinthInstallResult = { installed: [], dependencies: [], skipped: [] }

  const version = await fetchVersion(versionId)
  const task = createTask({ instanceId: target.taskId, label: 'Downloading content', phase: 'libraries' })

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
  const gameVersion = target.minecraftVersion
  for (const dependency of version.dependencies) {
    if (dependency.dependency_type !== 'required') continue
    try {
      const raw = dependency.version_id
        ? await fetchVersion(dependency.version_id)
        : dependency.project_id
          ? await resolveDependencyVersion(dependency.project_id, gameVersion, target.loader)
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
    `installed ${result.installed.length} file(s) and ${result.dependencies.length} dependency file(s) into ${targetDir}`
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

/* ----------------------------------------------------------- mod updates */

/*
 * Identifying installed mods by file hash rather than by how they were
 * installed means updates work for jars dropped into the folder by hand,
 * imported from a modpack, or installed through this launcher — Modrinth
 * recognises the file either way.
 *
 * `ModUpdate` itself lives in the shared types: it crosses IPC, and a second
 * copy here drifted from that one until the two disagreed about what a field
 * meant.
 */

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
    timeoutMs: 25_000,
    retries: 2
  })
  if (!response.ok) {
    throw new LauncherError('NETWORK_ERROR', `POST ${url} -> HTTP ${response.status}`)
  }
  return (await response.json()) as T
}

/**
 * Asks Modrinth which installed mods have a newer build for this instance's
 * Minecraft version and loader. Files Modrinth does not recognise are simply
 * absent from the result rather than being reported as errors.
 */
/**
 * Whether a version jump crosses a major boundary — the updates worth pausing
 * over, because they are the ones that break worlds and configs.
 *
 * Mod version strings are not reliably semver ("1.20.1-forge-47.2.0",
 * "v3.4b", "4.0.0+1.21"), so this only looks at the first run of digits and
 * treats anything it cannot parse as not-major rather than guessing.
 */
function isMajorJump(current: string | null, next: string): boolean {
  if (!current) return false
  const first = (value: string): number | null => {
    const match = /(\d+)/.exec(value)
    return match ? Number(match[1]) : null
  }
  const a = first(current)
  const b = first(next)
  if (a === null || b === null) return false
  return b > a
}

export async function checkModUpdates(instance: Instance): Promise<ModUpdate[]> {
  const dir = instanceSubdir(instance, 'mods')

  let entries: string[]
  try {
    entries = (await readdir(dir)).filter((name) => /\.jar(\.disabled)?$/i.test(name))
  } catch {
    return []
  }
  if (entries.length === 0) return []

  // Hash every jar; the hash is what Modrinth matches on.
  const byHash = new Map<string, string>()
  for (const fileName of entries) {
    try {
      byHash.set(await sha1OfFile(join(dir, fileName)), fileName)
    } catch {
      /* unreadable jar — skip it rather than fail the whole check */
    }
  }
  if (byHash.size === 0) return []

  const hashes = [...byHash.keys()]
  const loaders = loaderFacet('mod', instance.loader)

  const [current, latest] = await Promise.all([
    postJson<Record<string, RawVersion>>(`${API}/version_files`, { hashes, algorithm: 'sha1' }),
    postJson<Record<string, RawVersion>>(`${API}/version_files/update`, {
      hashes,
      algorithm: 'sha1',
      loaders: loaders.length > 0 ? loaders : undefined,
      game_versions: [instance.minecraftVersion]
    })
  ])

  const updates: ModUpdate[] = []

  for (const [hash, newest] of Object.entries(latest)) {
    const fileName = byHash.get(hash)
    if (!fileName || !newest) continue

    const installed = current[hash]
    // Same version id means the installed file already is the newest build.
    if (installed && installed.id === newest.id) continue

    const file = newest.files.find((f) => f.primary) ?? newest.files[0]
    if (!file) continue

    updates.push({
      fileName,
      modName: newest.name || file.filename,
      // The project, not the version — `newest.id` is the version id, and
      // labelling it projectId sent anything that followed the field (a
      // project page link, a changelog lookup) to a URL that does not exist.
      projectId: newest.project_id ?? installed?.project_id ?? '',
      currentVersion: installed?.version_number ?? null,
      currentVersionId: installed?.id ?? null,
      newVersionId: newest.id,
      newVersion: newest.version_number,
      newFileName: file.filename,
      sizeBytes: file.size,
      enabled: !fileName.endsWith('.disabled'),
      versionType: (newest.version_type as ModUpdate['versionType']) ?? 'release',
      publishedAt: Date.parse(newest.date_published) || null,
      majorJump: isMajorJump(installed?.version_number ?? null, newest.version_number)
    })
  }

  log.info(`${updates.length} of ${byHash.size} mods in "${instance.name}" have updates`)
  return updates
}

/**
 * Replaces a mod with its newer build. The new file is downloaded and verified
 * before the old one is removed, so a failed update never leaves the instance
 * without the mod.
 */
export async function applyModUpdate(instance: Instance, update: ModUpdate): Promise<void> {
  const dir = instanceSubdir(instance, 'mods')
  const version = await fetchVersion(update.newVersionId)
  const file = version.files.find((f) => f.primary) ?? version.files[0]
  if (!file) throw new LauncherError('NOT_FOUND', 'that version has no downloadable file')

  // Carry the disabled state across so an update cannot silently re-enable a
  // mod the user turned off.
  const targetName = update.enabled ? basename(file.filename) : `${basename(file.filename)}.disabled`
  const destination = join(dir, targetName)

  const task = createTask({ instanceId: instance.id, label: `Updating ${update.modName}`, phase: 'libraries' })
  task.add([
    {
      url: file.url,
      destination,
      sha1: file.hashes?.sha1 ?? null,
      size: file.size,
      label: file.filename
    }
  ])
  await task.run()
  task.markDone()

  /*
   * Only once the replacement is on disk and verified: move the old jar aside
   * rather than deleting it. An update that turns out to break the pack is
   * then one click to undo, which is the difference between trying an update
   * and committing to one.
   */
  const old = join(dir, update.fileName)
  if (old !== destination) {
    await stashForRollback(instance, update, old)
  }

  log.info(`updated ${update.fileName} -> ${targetName} in "${instance.name}"`)
}

/* ------------------------------------------------------- update review */

/** Where replaced jars wait in case an update needs undoing. */
function rollbackDir(instance: Instance): string {
  return join(instanceDir(instance.id), 'rollback')
}

const ROLLBACK_INDEX = 'rollback.json'

async function readRollbackIndex(instance: Instance): Promise<ModRollback[]> {
  try {
    const raw = await readFile(join(rollbackDir(instance), ROLLBACK_INDEX), 'utf8')
    const parsed = JSON.parse(raw) as ModRollback[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function writeRollbackIndex(instance: Instance, entries: ModRollback[]): Promise<void> {
  const dir = rollbackDir(instance)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, ROLLBACK_INDEX), JSON.stringify(entries, null, 2), 'utf8')
}

/**
 * Moves the jar an update replaced into the rollback folder and records it.
 *
 * Only the most recent replacement of a given file is kept: a mod updated
 * three times in a row leaves one undo step, not three, because restoring a
 * build from two updates ago is not a thing anyone asks for and keeping every
 * jar forever quietly fills the disk.
 */
/**
 * Exported so the CurseForge updater shares one undo history.
 *
 * The rollback list is what makes an update safe to try rather than a decision
 * to commit to, and a player does not care which site a jar came from. Two
 * separate stashes would mean a mod could be undone or not depending on where
 * the launcher happened to find it.
 */
export async function stashForRollback(instance: Instance, update: ModUpdate, oldPath: string): Promise<void> {
  const dir = rollbackDir(instance)
  await mkdir(dir, { recursive: true })

  const stashed = join(dir, update.fileName)
  let sizeBytes = 0
  try {
    sizeBytes = (await stat(oldPath)).size
    await rm(stashed, { force: true })
    await rename(oldPath, stashed)
  } catch (err) {
    // A jar that cannot be moved aside is still an update that succeeded —
    // fall back to removing it so two copies of the mod never both load.
    log.warn(`could not keep a rollback copy of ${update.fileName}: ${(err as Error).message}`)
    await rm(oldPath, { force: true }).catch(() => undefined)
    return
  }

  const entries = (await readRollbackIndex(instance)).filter((entry) => entry.fileName !== update.fileName)
  entries.unshift({
    fileName: update.fileName,
    modName: update.modName,
    fromVersion: update.currentVersion,
    toVersion: update.newVersion,
    replacedBy: update.enabled ? basename(update.newFileName) : `${basename(update.newFileName)}.disabled`,
    updatedAt: Date.now(),
    sizeBytes
  })

  // Twenty is far more undo history than anyone uses, and bounds the folder.
  const kept = entries.slice(0, 20)
  for (const dropped of entries.slice(20)) {
    await rm(join(dir, dropped.fileName), { force: true }).catch(() => undefined)
  }

  await writeRollbackIndex(instance, kept)
}

export async function listRollbacks(instance: Instance): Promise<ModRollback[]> {
  const dir = rollbackDir(instance)
  const entries = await readRollbackIndex(instance)
  // Only offer undo for jars that are actually still there.
  return entries.filter((entry) => existsSync(join(dir, entry.fileName)))
}

/** Puts a stashed jar back and removes the build that replaced it. */
export async function rollbackModUpdate(instance: Instance, fileName: string): Promise<ModRollback> {
  const entries = await readRollbackIndex(instance)
  const entry = entries.find((candidate) => candidate.fileName === fileName)
  if (!entry) throw new LauncherError('NOT_FOUND', 'there is no saved copy of that mod to go back to')

  const dir = rollbackDir(instance)
  const stashed = join(dir, entry.fileName)
  if (!existsSync(stashed)) throw new LauncherError('NOT_FOUND', 'the saved copy of that mod is gone')

  const mods = instanceSubdir(instance, 'mods')

  // Remove the newer jar first: both present at once is a duplicate-mod crash.
  await rm(join(mods, entry.replacedBy), { force: true }).catch(() => undefined)
  await rename(stashed, join(mods, entry.fileName))

  await writeRollbackIndex(
    instance,
    entries.filter((candidate) => candidate.fileName !== fileName)
  )

  log.info(`rolled ${entry.modName} back to ${entry.fromVersion ?? 'the previous build'} in "${instance.name}"`)
  return entry
}

/**
 * The author's notes for a build, plus every build between it and the one
 * installed — updating across five releases should show five changelogs, not
 * only the newest one's.
 */
export async function modChangelog(update: ModUpdate): Promise<ModChangelog[]> {
  if (!update.projectId) {
    // Without a project id there is nothing to list; fall back to the one build.
    const single = await fetchVersion(update.newVersionId)
    return [toChangelog(single)]
  }

  let versions: RawVersion[]
  try {
    versions = await getJson<RawVersion[]>(
      `${API}/project/${encodeURIComponent(update.projectId)}/version`,
      { timeoutMs: 20_000, retries: 2 }
    )
  } catch {
    const single = await fetchVersion(update.newVersionId)
    return [toChangelog(single)]
  }

  const newestAt = Date.parse(versions.find((v) => v.id === update.newVersionId)?.date_published ?? '') || Date.now()
  const installedAt = update.currentVersionId
    ? Date.parse(versions.find((v) => v.id === update.currentVersionId)?.date_published ?? '') || 0
    : 0

  const between = versions
    .filter((version) => {
      const at = Date.parse(version.date_published) || 0
      return at <= newestAt && at > installedAt
    })
    .sort((a, b) => (Date.parse(b.date_published) || 0) - (Date.parse(a.date_published) || 0))
    .slice(0, 12)

  const list = between.length > 0 ? between : versions.filter((v) => v.id === update.newVersionId)
  return list.map(toChangelog)
}

function toChangelog(version: RawVersion): ModChangelog {
  return {
    versionId: version.id,
    versionNumber: version.version_number,
    name: version.name,
    versionType: (version.version_type as ModChangelog['versionType']) ?? 'release',
    publishedAt: Date.parse(version.date_published) || null,
    changelog: (version.changelog ?? '').trim()
  }
}
