import { existsSync } from 'node:fs'
import { ensureDir } from '../../core/paths'
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

/**
 * Whatever the API said about refusing us, if it said anything.
 *
 * Never throws and never returns the request's own details — only the server's
 * words, so nothing sensitive can travel out with it.
 */
async function readApiComplaint(response: Response): Promise<string> {
  try {
    const text = (await response.text()).trim()
    if (!text) return ''

    try {
      const parsed = JSON.parse(text) as { message?: string; error?: string; description?: string }
      const said = parsed.message ?? parsed.error ?? parsed.description
      if (said) return String(said).slice(0, 200)
    } catch {
      /* not JSON; the raw text will do */
    }

    // Guard against an HTML error page arriving instead of an API reply.
    if (/^\s*</.test(text)) return 'an HTML error page rather than an API response'
    return text.slice(0, 200)
  } catch {
    return ''
  }
}

async function cfGet<T>(path: string, params?: URLSearchParams): Promise<T> {
  const url = `${API}${path}${params ? `?${params}` : ''}`
  const response = await request(url, {
    headers: { 'x-api-key': apiKey(), Accept: 'application/json' },
    timeoutMs: 20_000,
    retries: 2
  })

  /*
   * 401 and 403 are different problems and were being reported as the same one.
   *
   * 401 is the key: missing, mistyped, revoked. 403 is not — the key was read
   * and accepted, and the request was refused anyway, which for this API means
   * the key is not approved for the Minecraft data it is asking for. Telling
   * someone with a perfectly good key to go and generate another one sends them
   * round in circles, so each now says what actually happened.
   *
   * CurseForge explains itself in the response body, and that explanation was
   * being thrown away. It is read here and passed along.
   */
  if (response.status === 401 || response.status === 403) {
    const explanation = await readApiComplaint(response)
    const detail = explanation ? ` — CurseForge said: ${explanation}` : ''

    if (response.status === 401) {
      throw new LauncherError('AUTH_NOT_CONFIGURED', `CurseForge rejected the API key (HTTP 401)${detail}`, {
        title: 'CurseForge did not accept the key',
        message: `The key was not recognised. It may be mistyped, incomplete, or revoked.${detail}`,
        actions: [
          'Check the key in Settings → Content — paste the whole thing, it is long',
          'Generate a new one at console.curseforge.com',
          'Modrinth needs no key and works without this'
        ]
      })
    }

    throw new LauncherError('AUTH_NOT_CONFIGURED', `CurseForge refused the request (HTTP 403)${detail}`, {
      title: 'CurseForge refused this request',
      message:
        'CurseForge answers this both for a key it does not recognise and for one that has not been approved ' +
        `for Minecraft, so it is worth ruling out the simple case first.${detail}`,
      actions: [
        'Re-copy the whole key — they are long and easily cut short',
        'At console.curseforge.com, check the key is approved for Minecraft',
        'Modrinth needs no key and has most of the same mods'
      ]
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

/**
 * The loaders a file is genuinely built for.
 *
 * CurseForge puts loader names in `gameVersions` alongside the Minecraft
 * versions — "Forge", "NeoForge", "Fabric" — so the file says what it is. The
 * listing used to label every result with whatever loader had been *asked* for
 * instead, which made a NeoForge build appear in a Forge list reading "Forge,
 * 1.21.11". Their own filter is loose enough to return neighbouring builds, so
 * that label was the difference between picking the right jar and a client that
 * cannot synchronise registries with its server.
 */
function loadersOf(file: CfFile): string[] {
  const known: Record<string, string> = {
    forge: 'forge',
    neoforge: 'neoforge',
    fabric: 'fabric',
    quilt: 'quilt'
  }

  const found = new Set<string>()
  for (const entry of file.gameVersions ?? []) {
    const match = known[entry.trim().toLowerCase()]
    if (match) found.add(match)
  }
  return [...found]
}

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

  /*
   * Their filter is a hint, not a guarantee. Files that say outright they are
   * for another loader are dropped here, because offering one is worse than
   * offering nothing: it installs, it looks right, and the client then fails to
   * synchronise registries with a server running the correct build.
   */
  const wanted = loader?.toLowerCase()
  const usable = result.data.filter((file) => {
    /*
     * The game version has to match as well as the loader.
     *
     * Their filter is a hint on both counts, and a build for the wrong version
     * is every bit as broken as one for the wrong loader — a 26.2 jar in a
     * 26.1.2 instance is skipped by Forge for wanting a newer language
     * provider, and the mods depending on it then report it as "not installed",
     * which sends you looking for a mod that is sitting right there.
     */
    if (gameVersion && !(file.gameVersions ?? []).includes(gameVersion)) return false

    if (!wanted || kind !== 'mod') return true
    const declared = loadersOf(file)
    // Nothing declared means it is not saying either way; leave it in.
    return declared.length === 0 || declared.includes(wanted)
  })

  return usable.map((file) => ({
    versionId: String(file.id),
    name: file.displayName,
    versionNumber: file.displayName,
    gameVersions: file.gameVersions ?? [],
    // What the file actually is, not what was asked for.
    loaders: loadersOf(file),
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

  return await fetchFileInto(
    instanceSubdir(instance, subdirFor(kind)),
    instance.id,
    instance.name,
    file
  )
}

/**
 * Downloads a CurseForge file into any folder.
 *
 * The work is identical wherever it lands — a hosted server takes the same jar
 * an instance does — so the folder is the only thing that varies, and asking
 * for an Instance just to learn a path meant servers could not use this at all.
 */
async function fetchFileInto(
  dir: string,
  taskId: string,
  describedAs: string,
  file: CfFile
): Promise<ModrinthInstallResult> {
  const destination = join(dir, basename(file.fileName))
  const result: ModrinthInstallResult = { installed: [], dependencies: [], skipped: [] }

  if (existsSync(destination)) {
    result.skipped.push(file.fileName)
    return result
  }

  const sha1 = file.hashes?.find((h) => h.algo === 1)?.value ?? null

  const task = createTask({ instanceId: taskId, label: `Downloading ${file.displayName}`, phase: 'libraries' })
  task.add([{ url: file.downloadUrl as string, destination, sha1, size: file.fileLength, label: file.fileName }])
  await task.run()
  task.markDone()

  result.installed.push(file.fileName)
  log.info(`installed ${file.fileName} from CurseForge into "${describedAs}"`)
  return result
}

/** Installs a CurseForge file straight into a folder — used for hosted servers. */
export async function installCurseForgeFileToDir(
  target: { dir: string; taskId: string },
  projectId: string,
  fileId: string,
  describedAs = 'the server'
): Promise<ModrinthInstallResult> {
  const file = await getFile(projectId, fileId)

  if (!file.downloadUrl) {
    throw new LauncherError('INVALID_INPUT', `file ${fileId} has no download URL (author opt-out)`, {
      title: 'This mod must be downloaded manually',
      message:
        'Its author has turned off third-party downloads on CurseForge, so no launcher is permitted to fetch it ' +
        'automatically. Download the file from its CurseForge page and add it with "Add files".',
      actions: [
        'Open the mod page on CurseForge and download the file',
        'Return here and use "Add files"',
        'Or look for the same mod on Modrinth, which has no such restriction'
      ]
    })
  }

  ensureDir(target.dir)
  return await fetchFileInto(target.dir, target.taskId, describedAs, file)
}

/** Resolves several CurseForge files at once — used by modpack installs. */
export async function getFiles(fileIds: number[]): Promise<CfFile[]> {
  if (fileIds.length === 0) return []
  const result = await cfPost<{ data: CfFile[] }>('/mods/files', { fileIds })
  return result.data
}

/* ------------------------------------------------------------ verifying */

/**
 * Asks CurseForge whether a key actually works, and says why if it does not.
 *
 * Saving a key used to be silent — the interface said "saved" whatever the key
 * was, and the first sign of trouble came later from a search that failed for
 * reasons the settings screen never mentioned. Since the API is the only thing
 * that can settle it, it gets asked at the point the key is entered.
 *
 * Never throws, and never reports the key itself.
 */
export async function verifyApiKey(candidate?: string): Promise<{ ok: boolean; reason: string }> {
  const key = (candidate ?? getSettings().curseForgeApiKey ?? '').trim()
  if (!key) return { ok: false, reason: 'No key has been entered.' }

  /*
   * Test the call the launcher actually makes, not a tidier one.
   *
   * This first asked `/games/{id}`, which looked like the cheapest possible
   * check — but keys issued for mod distribution are frequently not authorised
   * for the games endpoints while working perfectly well for searching mods.
   * That turned a good key into a flat "CurseForge would not accept that key",
   * which is worse than no check at all: it sends someone off to change
   * settings that were never wrong. Searching for one mod proves the only thing
   * that matters, which is whether search works.
   */
  const params = new URLSearchParams({
    gameId: String(GAME_MINECRAFT),
    pageSize: '1',
    sortField: '6',
    sortOrder: 'desc'
  })

  try {
    const response = await request(`${API}/mods/search?${params}`, {
      headers: { 'x-api-key': key, Accept: 'application/json' },
      timeoutMs: 15_000,
      retries: 1
    })

    if (response.ok) return { ok: true, reason: 'CurseForge accepted the key.' }

    const said = await readApiComplaint(response)
    const complaint = said ? ` CurseForge said: ${said}` : ''

    /*
     * A note on the shape of what was entered, never the thing itself.
     *
     * The field is a password box, so a key that was cut short on the way in
     * looks exactly like a good one, and this is the single most common reason
     * for a rejection. Its length is enough to show that up and gives nothing
     * away.
     */
    const shape =
      key.length < 40
        ? ` The key entered is ${key.length} characters, which is short — CurseForge keys are around 60, so check none of it was left behind.`
        : ''

    const detail = `${complaint}${shape}`

    if (response.status === 401) {
      return { ok: false, reason: `CurseForge did not recognise that key.${detail}` }
    }
    if (response.status === 403) {
      /*
       * Do not over-read a 403 here. This API answers 403 both for a key it
       * does not accept and for one it accepts but will not serve, so the two
       * cannot be told apart from the status alone — and guessing sends people
       * off to fix whichever one was not the problem.
       */
      return {
        ok: false,
        reason:
          'CurseForge refused the request. Their API answers this both for a key it does not recognise and ' +
          'for one that has not been approved for Minecraft, so check the key is complete first, then its ' +
          `approval at console.curseforge.com.${detail}`
      }
    }
    return { ok: false, reason: `CurseForge returned HTTP ${response.status}.${detail}` }
  } catch (err) {
    return { ok: false, reason: `Could not reach CurseForge: ${(err as Error).message}` }
  }
}
