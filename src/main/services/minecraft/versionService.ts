import { readFile, writeFile, mkdir, readdir, stat, copyFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, dirname, normalize } from 'node:path'
import AdmZip from 'adm-zip'
import type { VersionManifestInfo, VersionSummary } from '@shared/types'
import type { AssetIndex, Library, VersionJson, VersionManifest } from './versionTypes'
import { getJson } from '../../core/http'
import { LauncherError } from '../../core/errors'
import { createLogger } from '../../core/logger'
import { assetsRoot, cacheRoot, ensureDir, librariesRoot, nativesRoot, versionsRoot } from '../../core/paths'
import { isLibraryAllowed, mavenToPath, nativesClassifier, currentOsName } from './rules'
import type { DownloadItem, DownloadTask } from '../downloads/downloadManager'

const log = createLogger('versions')

const MANIFEST_URL = 'https://launchermeta.mojang.com/mc/game/version_manifest_v2.json'
const RESOURCES_BASE = 'https://resources.download.minecraft.net'
const MANIFEST_CACHE = (): string => join(cacheRoot(), 'version_manifest_v2.json')
const MANIFEST_TTL_MS = 15 * 60 * 1000

let manifestMemo: { data: VersionManifest; at: number } | null = null

/* ------------------------------------------------------------- manifest */

/**
 * Version data always comes from Mojang's live manifest — nothing about
 * available versions is hardcoded. A disk cache keeps the launcher usable
 * offline for versions already installed.
 */
export async function fetchManifest(refresh = false): Promise<{ data: VersionManifest; fromCache: boolean; fetchedAt: number | null }> {
  if (!refresh && manifestMemo && Date.now() - manifestMemo.at < MANIFEST_TTL_MS) {
    return { data: manifestMemo.data, fromCache: false, fetchedAt: manifestMemo.at }
  }

  try {
    const data = await getJson<VersionManifest>(MANIFEST_URL, { timeoutMs: 20_000, retries: 2 })
    manifestMemo = { data, at: Date.now() }
    ensureDir(cacheRoot())
    await writeFile(MANIFEST_CACHE(), JSON.stringify(data), 'utf8').catch(() => undefined)
    return { data, fromCache: false, fetchedAt: manifestMemo.at }
  } catch (err) {
    log.warn('could not reach the version manifest; trying the cache')
    try {
      const cached = JSON.parse(await readFile(MANIFEST_CACHE(), 'utf8')) as VersionManifest
      const info = await stat(MANIFEST_CACHE())
      manifestMemo = { data: cached, at: info.mtimeMs }
      return { data: cached, fromCache: true, fetchedAt: info.mtimeMs }
    } catch {
      throw err instanceof LauncherError ? err : new LauncherError('NETWORK_ERROR', err)
    }
  }
}

export async function getManifestInfo(refresh = false): Promise<VersionManifestInfo> {
  const { data, fromCache, fetchedAt } = await fetchManifest(refresh)
  const installed = new Set(await listInstalledVersionIds())

  const versions: VersionSummary[] = data.versions.map((entry) => ({
    id: entry.id,
    type: (['release', 'snapshot', 'old_beta', 'old_alpha'].includes(entry.type)
      ? entry.type
      : 'release') as VersionSummary['type'],
    releaseTime: entry.releaseTime,
    installed: installed.has(entry.id),
    javaMajor: null
  }))

  return {
    latestRelease: data.latest.release,
    latestSnapshot: data.latest.snapshot,
    versions,
    fetchedAt,
    fromCache
  }
}

export async function listInstalledVersionIds(): Promise<string[]> {
  try {
    const entries = await readdir(versionsRoot(), { withFileTypes: true })
    const ids: string[] = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (existsSync(join(versionsRoot(), entry.name, `${entry.name}.json`))) ids.push(entry.name)
    }
    return ids
  } catch {
    return []
  }
}

export function versionDir(versionId: string): string {
  return join(versionsRoot(), versionId)
}

export function versionJsonPath(versionId: string): string {
  return join(versionDir(versionId), `${versionId}.json`)
}

export function versionJarPath(versionId: string): string {
  return join(versionDir(versionId), `${versionId}.jar`)
}

/* --------------------------------------------------------- version json */

/** Loads a version json from disk, downloading it from Mojang if absent. */
export async function ensureVersionJson(versionId: string): Promise<VersionJson> {
  const path = versionJsonPath(versionId)
  if (existsSync(path)) {
    try {
      return JSON.parse(await readFile(path, 'utf8')) as VersionJson
    } catch {
      log.warn(`version json for ${versionId} was corrupt; re-downloading`)
    }
  }

  const { data } = await fetchManifest()
  const entry = data.versions.find((v) => v.id === versionId)
  if (!entry) {
    throw new LauncherError('NOT_FOUND', `version ${versionId} is not in Mojang's manifest`, {
      title: `Minecraft ${versionId} was not found`,
      message: `Mojang's version list does not contain "${versionId}". It may have been withdrawn, or the instance may refer to a modded profile that has not been installed yet.`,
      actions: ['Pick a different version for this instance', 'Refresh the version list from the Versions screen']
    })
  }

  const json = await getJson<VersionJson>(entry.url, { timeoutMs: 30_000 })
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(json, null, 2), 'utf8')
  return json
}

/**
 * Resolves a version, merging it with everything it inherits from. Mod loaders
 * publish a thin profile with `inheritsFrom` pointing at the vanilla version.
 */
export async function resolveVersion(versionId: string, seen = new Set<string>()): Promise<VersionJson> {
  if (seen.has(versionId)) {
    throw new LauncherError('INSTANCE_CORRUPT', `circular inheritance at ${versionId}`)
  }
  seen.add(versionId)

  const json = await ensureVersionJson(versionId)
  if (!json.inheritsFrom) return { ...json, resolvedBaseId: json.id }

  const parent = await resolveVersion(json.inheritsFrom, seen)

  /*
   * Child libraries win over the parent's for the same artifact, which is how
   * Forge replaces vanilla libraries with its patched builds.
   *
   * The classifier has to be part of that identity. Since 1.19 natives are not
   * a separate `natives` map but ordinary libraries told apart only by their
   * classifier:
   *
   *     org.lwjgl:lwjgl:3.3.3
   *     org.lwjgl:lwjgl:3.3.3:natives-windows
   *
   * Keying on group:artifact alone made those two the same library, so the
   * second was dropped as a duplicate and every native went with it. Vanilla
   * was unaffected — it has no parent, so it never comes through here — which
   * is why the game launched normally and every loader profile died on
   * `Failed to locate library: lwjgl.dll`.
   */
  const merged: Library[] = []
  const keyOf = (name: string): string => {
    const parts = name.split(':')
    const artifact = parts.slice(0, 2).join(':')
    const classifier = parts.length > 3 ? parts[3] : ''
    return classifier ? `${artifact}:${classifier}` : artifact
  }
  const takenKeys = new Set<string>()
  for (const library of [...(json.libraries ?? []), ...(parent.libraries ?? [])]) {
    const key = keyOf(library.name)
    if (takenKeys.has(key)) continue
    takenKeys.add(key)
    merged.push(library)
  }

  return {
    ...parent,
    ...json,
    id: json.id,
    // Loader profiles append their arguments to the parent's.
    arguments: {
      game: [...(parent.arguments?.game ?? []), ...(json.arguments?.game ?? [])],
      jvm: [...(parent.arguments?.jvm ?? []), ...(json.arguments?.jvm ?? [])]
    },
    minecraftArguments: json.minecraftArguments ?? parent.minecraftArguments,
    mainClass: json.mainClass ?? parent.mainClass,
    assetIndex: json.assetIndex ?? parent.assetIndex,
    assets: json.assets ?? parent.assets,
    downloads: { ...parent.downloads, ...json.downloads },
    javaVersion: json.javaVersion ?? parent.javaVersion,
    logging: json.logging ?? parent.logging,
    libraries: merged,
    // The chain is now flattened; keep the root id so callers know where the
    // vanilla client jar lives.
    resolvedBaseId: parent.resolvedBaseId ?? parent.id,
    inheritsFrom: undefined
  }
}

/* ------------------------------------------------------------- libraries */

export interface ResolvedLibrary {
  path: string
  url: string | null
  sha1: string | null
  size: number | null
  /** True when the jar must be extracted into the natives directory. */
  isNative: boolean
  extractExclude: string[]
  name: string
}

/**
 * Turns a version's library list into concrete local paths plus where to fetch
 * each one, honouring the OS rules.
 */
export function resolveLibraries(version: VersionJson): ResolvedLibrary[] {
  const out: ResolvedLibrary[] = []

  for (const library of version.libraries ?? []) {
    if (!isLibraryAllowed(library)) continue

    // Modern versions express natives as ordinary rule-gated artifacts; older
    // ones use the `natives` classifier map.
    const classifier = nativesClassifier(library)
    if (classifier) {
      const native = library.downloads?.classifiers?.[classifier]
      if (native?.path) {
        out.push({
          name: library.name,
          path: join(librariesRoot(), ...native.path.split('/')),
          url: native.url,
          sha1: native.sha1 ?? null,
          size: native.size ?? null,
          isNative: true,
          extractExclude: library.extract?.exclude ?? []
        })
      }
    }

    const artifact = library.downloads?.artifact
    if (artifact?.path) {
      out.push({
        name: library.name,
        path: join(librariesRoot(), ...artifact.path.split('/')),
        url: artifact.url,
        sha1: artifact.sha1 ?? null,
        size: artifact.size ?? null,
        // A rule-gated jar whose name carries a natives classifier is a native.
        isNative: /:natives-/.test(library.name) || library.name.includes(`natives-${currentOsName()}`),
        extractExclude: library.extract?.exclude ?? [],
      })
      continue
    }

    // Libraries with no `downloads` block (Fabric, Forge maven entries) are
    // located from their maven coordinate against the declared repository.
    if (!classifier) {
      const relative = mavenToPath(library.name)
      const base = library.url ?? 'https://libraries.minecraft.net/'
      out.push({
        name: library.name,
        path: join(librariesRoot(), ...relative.split('/')),
        url: base.endsWith('/') ? base + relative : `${base}/${relative}`,
        sha1: null,
        size: null,
        isNative: false,
        extractExclude: []
      })
    }
  }

  return out
}

/* ------------------------------------------------------------- installing */

export interface InstallOptions {
  task: DownloadTask
  /** Skip the asset objects — used when only the classpath is needed. */
  skipAssets?: boolean
}

/** Queues and downloads everything the version needs to run. */
export async function installVersion(versionId: string, options: InstallOptions): Promise<VersionJson> {
  const { task } = options

  task.setPhase('version-json', `Reading Minecraft ${versionId} metadata`)
  const version = await resolveVersion(versionId)

  /* client jar */
  const clientJar = version.downloads?.client
  const baseId = version.resolvedBaseId ?? versionId
  if (clientJar) {
    task.setPhase('client-jar', 'Downloading the Minecraft client')
    task.add([
      {
        url: clientJar.url,
        destination: versionJarPath(baseId),
        sha1: clientJar.sha1,
        size: clientJar.size,
        label: `${baseId}.jar`
      }
    ])
    await task.run()
  }

  /* libraries */
  task.setPhase('libraries', 'Downloading game libraries')
  const libraries = resolveLibraries(version)
  const libraryItems: DownloadItem[] = libraries
    .filter((library) => library.url)
    .map((library) => ({
      url: library.url as string,
      destination: library.path,
      sha1: library.sha1,
      size: library.size,
      label: library.name
    }))
  task.add(libraryItems)
  await task.run()

  /* log4j configuration */
  const logging = version.logging?.client
  if (logging?.file?.url) {
    task.add([
      {
        url: logging.file.url,
        destination: join(assetsRoot(), 'log_configs', logging.file.id),
        sha1: logging.file.sha1,
        size: logging.file.size,
        label: logging.file.id
      }
    ])
    await task.run()
  }

  /* assets */
  if (!options.skipAssets && version.assetIndex) {
    task.setPhase('assets', 'Downloading game assets')
    await installAssets(version, task)
  }

  /* natives */
  task.setPhase('natives', 'Unpacking native libraries')
  await extractNatives(nativesLibraryPath(versionId, version), libraries)

  return version
}

async function installAssets(version: VersionJson, task: DownloadTask): Promise<void> {
  const index = version.assetIndex
  if (!index?.url || !index.id) return

  const indexPath = join(assetsRoot(), 'indexes', `${index.id}.json`)
  task.add([{ url: index.url, destination: indexPath, sha1: index.sha1, size: index.size, label: `${index.id}.json` }])
  await task.run()

  const assetIndex = JSON.parse(await readFile(indexPath, 'utf8')) as AssetIndex
  const objectsDir = join(assetsRoot(), 'objects')

  const items: DownloadItem[] = []
  for (const [name, object] of Object.entries(assetIndex.objects)) {
    const prefix = object.hash.slice(0, 2)
    items.push({
      url: `${RESOURCES_BASE}/${prefix}/${object.hash}`,
      destination: join(objectsDir, prefix, object.hash),
      sha1: object.hash,
      size: object.size,
      label: name
    })
  }
  task.add(items)
  await task.run()

  // Pre-1.7 versions read assets as real files from a virtual tree instead of
  // the hashed object store.
  if (assetIndex.virtual || assetIndex.map_to_resources) {
    const virtualRoot = join(assetsRoot(), 'virtual', index.id)
    for (const [name, object] of Object.entries(assetIndex.objects)) {
      const target = join(virtualRoot, ...name.split('/'))
      if (existsSync(target)) continue
      await mkdir(dirname(target), { recursive: true })
      await copyFile(join(objectsDir, object.hash.slice(0, 2), object.hash), target).catch(() => undefined)
    }
  }
}

/**
 * Where a version expects its native libraries to sit.
 *
 * This is not fixed across versions. Modern metadata asks for a subfolder:
 *
 *     -Djava.library.path=${natives_directory}/java
 *
 * while older versions point straight at the natives directory. Rather than
 * guessing, the location is read back out of the version's own JVM arguments,
 * so the launcher follows whatever Mojang specifies.
 */
export function nativesLibraryPath(versionId: string, version: VersionJson): string {
  const base = nativesDir(versionId)
  const PREFIX = '-Djava.library.path='

  for (const entry of version.arguments?.jvm ?? []) {
    const values = typeof entry === 'string' ? [entry] : Array.isArray(entry.value) ? entry.value : [entry.value]
    for (const value of values) {
      if (typeof value !== 'string' || !value.startsWith(PREFIX)) continue
      const template = value.slice(PREFIX.length)
      return normalize(template.split('${natives_directory}').join(base))
    }
  }
  return base
}

/** Extracts native .dll/.so/.dylib payloads into the given directory. */
export async function extractNatives(target: string, libraries: ResolvedLibrary[]): Promise<string> {
  ensureDir(target)

  for (const library of libraries) {
    if (!library.isNative || !existsSync(library.path)) continue
    try {
      const zip = new AdmZip(library.path)
      for (const entry of zip.getEntries()) {
        if (entry.isDirectory) continue
        const name = entry.entryName
        if (name.startsWith('META-INF/')) continue
        if (library.extractExclude.some((prefix) => name.startsWith(prefix))) continue
        // Only the loadable binaries matter; skip sources and licences.
        if (!/\.(dll|so|dylib|jnilib)$/i.test(name)) continue

        const outPath = join(target, name.split('/').pop() as string)
        if (existsSync(outPath)) continue
        await writeFile(outPath, entry.getData())
      }
    } catch (err) {
      log.warn(`could not unpack natives from ${library.name}: ${(err as Error).message}`)
    }
  }
  return target
}

export function nativesDir(versionId: string): string {
  return join(nativesRoot(), versionId)
}

/**
 * Makes sure the natives folder is populated before a launch.
 *
 * Extraction normally happens during install, but the folder lives outside the
 * instance and can be cleared by a disk cleanup or antivirus without the rest of
 * the install being touched. Re-running is cheap — existing files are skipped.
 */
export async function ensureNativesExtracted(versionId: string, version: VersionJson): Promise<string> {
  return await extractNatives(nativesLibraryPath(versionId, version), resolveLibraries(version))
}

/**
 * Verifies that everything needed to launch is present. Returns the list of
 * missing files rather than throwing so callers can decide to repair.
 */
export async function verifyInstallation(versionId: string): Promise<{ missing: string[]; version: VersionJson }> {
  const version = await resolveVersion(versionId)
  const missing: string[] = []

  const jarId = version.resolvedBaseId ?? versionId
  if (version.downloads?.client && !existsSync(versionJarPath(jarId))) missing.push(`${jarId}.jar`)

  for (const library of resolveLibraries(version)) {
    if (!existsSync(library.path)) missing.push(library.name)
  }

  if (version.assetIndex?.id && !existsSync(join(assetsRoot(), 'indexes', `${version.assetIndex.id}.json`))) {
    missing.push(`asset index ${version.assetIndex.id}`)
  }

  return { missing, version }
}

/** Builds the -cp entries for a resolved version, client jar last. */
export function buildClasspath(versionId: string, version: VersionJson): string[] {
  const entries: string[] = []
  const seen = new Set<string>()

  for (const library of resolveLibraries(version)) {
    if (library.isNative) continue // natives are extracted, not on the classpath
    if (seen.has(library.path)) continue
    seen.add(library.path)
    entries.push(library.path)
  }

  /*
   * The client jar lives under the ROOT version, not this one.
   *
   * `resolveVersion` flattens the inheritance chain and clears `inheritsFrom`
   * once it is done, leaving the root id in `resolvedBaseId` — so reading
   * `inheritsFrom` here always found undefined and fell back to the profile's
   * own id. For a loader profile that means looking for a jar that never
   * exists: `fabric-loader-0.17.3-1.21.1.jar` instead of `1.21.1.jar`.
   *
   * The jar was then quietly left off the classpath. Forge tolerates that,
   * because BootstrapLauncher locates the game through its own module path,
   * but Fabric's Knot looks for Minecraft on the classpath and finds nothing:
   *
   *     Minecraft game provider couldn't locate the game!
   *
   * which reads as a corrupt install and is nothing of the kind. The same
   * `resolvedBaseId` is already used to decide which jar to download, so the
   * file was always present — this was only ever looking in the wrong place.
   */
  const jar = versionJarPath(version.resolvedBaseId ?? version.inheritsFrom ?? versionId)
  if (!existsSync(jar)) {
    // Never silently. A classpath without the game is not a classpath, and the
    // error the loader gives for it points nowhere near the cause.
    throw new LauncherError(
      'MISSING_LIBRARIES',
      `the Minecraft client jar is missing: ${jar}. Reinstall this version.`
    )
  }
  entries.push(jar)
  return entries
}

export async function deleteVersion(versionId: string): Promise<void> {
  await rm(versionDir(versionId), { recursive: true, force: true })
  await rm(nativesDir(versionId), { recursive: true, force: true })
}
