import { existsSync } from 'node:fs'
import { readdir, rm, stat, copyFile, mkdir } from 'node:fs/promises'
import { basename, join, extname } from 'node:path'
import AdmZip from 'adm-zip'
import type { Instance, LoaderId, ModInfo, ModIssue } from '@shared/types'
import { LauncherError } from '../../core/errors'
import { createLogger } from '../../core/logger'
import { assertInside } from '../../core/paths'
import { instanceSubdir } from '../instances/instanceService'
import { renameWhenFree } from '../../core/fileLocks'

const log = createLogger('mods')

const DISABLED_SUFFIX = '.disabled'

export function modsDir(instance: Instance): string {
  return instanceSubdir(instance, 'mods')
}

/**
 * Somewhere mods live, with enough context to judge whether they belong there.
 *
 * A client instance and a hosted server both have a mods folder, a loader and a
 * Minecraft version — everything the analysis needs — but only the instance is
 * an `Instance`. Naming the target directly lets both use the same code.
 */
export interface ModTarget {
  dir: string
  loader: LoaderId
  minecraftVersion: string
  /** How to refer to the destination in messages, e.g. "this server". */
  description: string
}

export function instanceTarget(instance: Instance): ModTarget {
  return {
    dir: modsDir(instance),
    loader: instance.loader,
    minecraftVersion: instance.minecraftVersion,
    description: 'this instance'
  }
}

/* ---------------------------------------------------------- jar metadata */

interface RawMetadata {
  modId: string | null
  name: string
  version: string | null
  description: string | null
  authors: string[]
  loaders: LoaderId[]
  mcVersionRange: string | null
  iconPath: string | null
}

/**
 * A deliberately small TOML reader. Forge's mods.toml only ever uses a handful
 * of constructs, and pulling in a full TOML parser for four fields is not worth
 * the dependency. Anything it cannot read degrades to "unknown", never a crash.
 */
function readTomlValue(toml: string, key: string): string | null {
  const match = toml.match(new RegExp(`^\\s*${key}\\s*=\\s*(?:"""([\\s\\S]*?)"""|"([^"]*)"|'([^']*)')`, 'm'))
  if (!match) return null
  return (match[1] ?? match[2] ?? match[3] ?? '').trim() || null
}

function parseFabricJson(text: string): RawMetadata | null {
  try {
    const json = JSON.parse(text) as {
      id?: string
      name?: string
      version?: string
      description?: string
      authors?: Array<string | { name?: string }>
      icon?: string | Record<string, string>
      depends?: Record<string, string | string[]>
    }
    const minecraft = json.depends?.minecraft
    return {
      modId: json.id ?? null,
      name: json.name ?? json.id ?? 'Unknown mod',
      version: json.version ?? null,
      description: json.description ?? null,
      authors: (json.authors ?? []).map((a) => (typeof a === 'string' ? a : (a.name ?? ''))).filter(Boolean),
      loaders: ['fabric'],
      mcVersionRange: Array.isArray(minecraft) ? minecraft.join(', ') : (minecraft ?? null),
      iconPath: typeof json.icon === 'string' ? json.icon : (Object.values(json.icon ?? {})[0] ?? null)
    }
  } catch {
    return null
  }
}

function parseQuiltJson(text: string): RawMetadata | null {
  try {
    const json = JSON.parse(text) as {
      quilt_loader?: {
        id?: string
        version?: string
        metadata?: {
          name?: string
          description?: string
          contributors?: Record<string, string>
          icon?: string
        }
        depends?: Array<{ id?: string; versions?: string }>
      }
    }
    const loader = json.quilt_loader
    if (!loader) return null
    const minecraft = loader.depends?.find((d) => d.id === 'minecraft')
    return {
      modId: loader.id ?? null,
      name: loader.metadata?.name ?? loader.id ?? 'Unknown mod',
      version: loader.version ?? null,
      description: loader.metadata?.description ?? null,
      authors: Object.keys(loader.metadata?.contributors ?? {}),
      // Quilt can load Fabric mods, and most Quilt mods ship a Fabric entry too.
      loaders: ['quilt', 'fabric'],
      mcVersionRange: minecraft?.versions ?? null,
      iconPath: loader.metadata?.icon ?? null
    }
  } catch {
    return null
  }
}

function parseModsToml(text: string, loader: LoaderId): RawMetadata {
  // Only the first [[mods]] block matters for display purposes.
  const modsBlock = text.split(/\[\[mods\]\]/)[1] ?? text
  const modId = readTomlValue(modsBlock, 'modId')
  const mcRange = text.match(/modId\s*=\s*"minecraft"[\s\S]{0,300}?versionRange\s*=\s*"([^"]*)"/)?.[1] ?? null

  return {
    modId,
    name: readTomlValue(modsBlock, 'displayName') ?? modId ?? 'Unknown mod',
    version: readTomlValue(modsBlock, 'version'),
    description: readTomlValue(modsBlock, 'description'),
    authors: (readTomlValue(modsBlock, 'authors') ?? '')
      .split(/,\s*/)
      .map((a) => a.trim())
      .filter(Boolean),
    loaders: [loader],
    mcVersionRange: mcRange,
    iconPath: readTomlValue(modsBlock, 'logoFile')
  }
}

function parseLegacyMcmod(text: string): RawMetadata | null {
  try {
    const parsed = JSON.parse(text) as
      | Array<{ modid?: string; name?: string; version?: string; description?: string; authorList?: string[]; mcversion?: string; logoFile?: string }>
      | { modList?: Array<Record<string, unknown>> }
    const entry = Array.isArray(parsed) ? parsed[0] : ((parsed.modList?.[0] as never) ?? null)
    if (!entry) return null
    return {
      modId: (entry.modid as string) ?? null,
      name: (entry.name as string) ?? (entry.modid as string) ?? 'Unknown mod',
      version: (entry.version as string) ?? null,
      description: (entry.description as string) ?? null,
      authors: ((entry.authorList as string[]) ?? []).filter(Boolean),
      loaders: ['forge'],
      mcVersionRange: (entry.mcversion as string) ?? null,
      iconPath: (entry.logoFile as string) ?? null
    }
  } catch {
    return null
  }
}

interface ReadResult {
  metadata: RawMetadata | null
  iconDataUrl: string | null
  unreadable: boolean
}

/** Opens a mod jar and reads whichever loader manifest it contains. */
function readModJar(jarPath: string): ReadResult {
  try {
    const zip = new AdmZip(jarPath)
    const read = (name: string): string | null => {
      const entry = zip.getEntry(name)
      return entry ? entry.getData().toString('utf8') : null
    }

    let metadata: RawMetadata | null = null

    const fabric = read('fabric.mod.json')
    if (fabric) metadata = parseFabricJson(fabric)

    if (!metadata) {
      const quilt = read('quilt.mod.json')
      if (quilt) metadata = parseQuiltJson(quilt)
    }
    if (!metadata) {
      const neoforge = read('META-INF/neoforge.mods.toml')
      if (neoforge) metadata = parseModsToml(neoforge, 'neoforge')
    }
    if (!metadata) {
      const forge = read('META-INF/mods.toml')
      // A 1.20.1-era mods.toml works on both Forge and NeoForge.
      if (forge) {
        metadata = parseModsToml(forge, 'forge')
        metadata.loaders = ['forge', 'neoforge']
      }
    }
    if (!metadata) {
      const legacy = read('mcmod.info')
      if (legacy) metadata = parseLegacyMcmod(legacy)
    }

    let iconDataUrl: string | null = null
    if (metadata?.iconPath) {
      const entry = zip.getEntry(metadata.iconPath)
      const data = entry?.getData()
      if (data && data.byteLength > 0 && data.byteLength < 512 * 1024) {
        const ext = extname(metadata.iconPath).toLowerCase()
        const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png'
        iconDataUrl = `data:${mime};base64,${data.toString('base64')}`
      }
    }

    return { metadata, iconDataUrl, unreadable: false }
  } catch (err) {
    log.warn(`could not read ${basename(jarPath)}: ${(err as Error).message}`)
    return { metadata: null, iconDataUrl: null, unreadable: true }
  }
}

/* ------------------------------------------------------------- analysis */

/** Loaders that can run each other's mods. */
function loaderAccepts(instanceLoader: LoaderId, modLoaders: LoaderId[]): 'yes' | 'maybe' | 'no' {
  if (modLoaders.length === 0) return 'maybe'
  if (modLoaders.includes(instanceLoader)) return 'yes'

  // Quilt runs Fabric mods natively.
  if (instanceLoader === 'quilt' && modLoaders.includes('fabric')) return 'yes'
  // Forge and NeoForge share a manifest format on 1.20.1 and diverge after,
  // so this is a warning rather than a hard failure.
  if (
    (instanceLoader === 'neoforge' && modLoaders.includes('forge')) ||
    (instanceLoader === 'forge' && modLoaders.includes('neoforge'))
  ) {
    return 'maybe'
  }
  return 'no'
}

const LOADER_NAMES: Record<LoaderId, string> = {
  vanilla: 'Vanilla',
  fabric: 'Fabric',
  forge: 'Forge',
  neoforge: 'NeoForge',
  quilt: 'Quilt'
}

export async function analyseMods(instance: Instance): Promise<ModInfo[]> {
  return await analyseModsIn(instanceTarget(instance))
}

/**
 * Reads a mods folder directly.
 *
 * Split out from the instance-based call so a hosted server's `mods` directory
 * can be managed with exactly the same code — a server needs the same listing,
 * toggling and importing a client instance does.
 */
export async function analyseModsIn(target: ModTarget): Promise<ModInfo[]> {
  const dir = target.dir
  let entries: string[]
  try {
    entries = (await readdir(dir, { withFileTypes: true })).filter((e) => e.isFile()).map((e) => e.name)
  } catch {
    return []
  }

  const mods: ModInfo[] = []

  for (const fileName of entries) {
    const enabled = !fileName.endsWith(DISABLED_SUFFIX)
    const bare = enabled ? fileName : fileName.slice(0, -DISABLED_SUFFIX.length)
    if (!bare.toLowerCase().endsWith('.jar')) {
      // Anything that is not a jar cannot be a mod; surface it rather than hide it.
      if (/\.(zip|litemod|txt)$/i.test(bare)) {
        const full = join(dir, fileName)
        mods.push({
          path: full,
          fileName,
          modId: null,
          name: bare,
          version: null,
          description: null,
          authors: [],
          loaders: [],
          mcVersionRange: null,
          enabled,
          sizeBytes: await stat(full).then((s) => s.size).catch(() => 0),
          iconDataUrl: null,
          issues: [
            {
              severity: 'warning',
              code: 'not-a-jar',
              message: 'This file is not a .jar, so Minecraft will ignore it.'
            }
          ]
        })
      }
      continue
    }

    const full = join(dir, fileName)
    const { metadata, iconDataUrl, unreadable } = readModJar(full)
    const issues: ModIssue[] = []

    if (unreadable) {
      issues.push({
        severity: 'warning',
        code: 'unreadable',
        message: 'This jar could not be opened. It may be corrupt or still downloading.'
      })
    } else if (!metadata) {
      issues.push({
        severity: 'warning',
        code: 'unreadable',
        message: 'No mod metadata was found in this jar. It may be a library rather than a mod.'
      })
    }

    if (metadata && enabled) {
      const verdict = loaderAccepts(target.loader, metadata.loaders)
      if (verdict === 'no') {
        issues.push({
          severity: 'error',
          code: 'loader-mismatch',
          message: `This is a ${metadata.loaders.map((l) => LOADER_NAMES[l]).join('/')} mod, but ${target.description} runs ${LOADER_NAMES[target.loader]}.`
        })
      } else if (verdict === 'maybe' && metadata.loaders.length > 0) {
        issues.push({
          severity: 'warning',
          code: 'loader-mismatch',
          message: `Built for ${metadata.loaders.map((l) => LOADER_NAMES[l]).join('/')}; it may or may not run on ${LOADER_NAMES[target.loader]}.`
        })
      }

      if (metadata.mcVersionRange && !versionSatisfies(target.minecraftVersion, metadata.mcVersionRange)) {
        issues.push({
          severity: 'warning',
          code: 'mc-version-mismatch',
          message: `Declares support for ${metadata.mcVersionRange}, but ${target.description} is Minecraft ${target.minecraftVersion}.`
        })
      }
    }

    mods.push({
      path: full,
      fileName,
      modId: metadata?.modId ?? null,
      name: metadata?.name ?? bare.replace(/\.jar$/i, ''),
      version: metadata?.version ?? null,
      description: metadata?.description ?? null,
      authors: metadata?.authors ?? [],
      loaders: metadata?.loaders ?? [],
      mcVersionRange: metadata?.mcVersionRange ?? null,
      enabled,
      sizeBytes: await stat(full).then((s) => s.size).catch(() => 0),
      iconDataUrl,
      issues
    })
  }

  // Two enabled jars declaring the same mod id crash every loader on startup.
  const byModId = new Map<string, ModInfo[]>()
  for (const mod of mods) {
    if (!mod.modId || !mod.enabled) continue
    const list = byModId.get(mod.modId) ?? []
    list.push(mod)
    byModId.set(mod.modId, list)
  }
  for (const [modId, duplicates] of byModId) {
    if (duplicates.length < 2) continue
    for (const mod of duplicates) {
      mod.issues.push({
        severity: 'error',
        code: 'duplicate-mod-id',
        message: `Another enabled mod also provides "${modId}" (${duplicates
          .filter((d) => d !== mod)
          .map((d) => d.fileName)
          .join(', ')}). Keep only one.`
      })
    }
  }

  mods.sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name))
  return mods
}

/* -------------------------------------------------------------- mutations */

/** Enabling and disabling is a rename, which is how every launcher does it. */
export async function setModEnabled(instance: Instance, fileName: string, enabled: boolean): Promise<void> {
  await setModEnabledIn(modsDir(instance), fileName, enabled)
}

export async function setModEnabledIn(dir: string, fileName: string, enabled: boolean): Promise<void> {
  const current = assertInside(dir, join(dir, fileName))
  if (!existsSync(current)) throw new LauncherError('NOT_FOUND', 'that mod file no longer exists')

  const isDisabled = fileName.endsWith(DISABLED_SUFFIX)
  if (enabled === !isDisabled) return

  const nextName = enabled ? fileName.slice(0, -DISABLED_SUFFIX.length) : fileName + DISABLED_SUFFIX
  const next = assertInside(dir, join(dir, nextName))
  // The game or a scanner may still hold the jar open; wait it out.
  await renameWhenFree(current, next)
  log.info(`${enabled ? 'enabled' : 'disabled'} ${nextName}`)
}

export async function deleteMod(instance: Instance, fileName: string): Promise<void> {
  await deleteModIn(modsDir(instance), fileName)
}

export async function deleteModIn(dir: string, fileName: string): Promise<void> {
  const target = assertInside(dir, join(dir, fileName))
  await rm(target, { force: true })
  log.info(`removed mod ${fileName}`)
}

export async function importMods(instance: Instance, files: string[]): Promise<number> {
  return await importModsIn(modsDir(instance), files)
}

export async function importModsIn(dir: string, files: string[]): Promise<number> {
  await mkdir(dir, { recursive: true })
  let imported = 0

  for (const file of files) {
    if (!/\.(jar)$/i.test(file)) continue
    const target = join(dir, basename(file))
    // Never silently replace an existing mod: add a suffix instead.
    let final = target
    let counter = 1
    while (existsSync(final)) {
      final = join(dir, `${basename(file, '.jar')} (${counter}).jar`)
      counter++
    }
    try {
      await copyFile(file, final)
      imported++
    } catch (err) {
      log.warn(`could not import ${file}: ${(err as Error).message}`)
    }
  }
  return imported
}

/* ----------------------------------------------------------- version range */

/**
 * Best-effort check of a Maven-style version range such as "[1.20.1,1.21)".
 * Mod metadata ranges are advisory, so an unparseable range counts as a match
 * rather than a false warning.
 */
export function versionSatisfies(version: string, range: string): boolean {
  const trimmed = range.trim()
  if (!trimmed || trimmed === '*') return true

  // Fabric-style: ">=1.20.1", "~1.20", "1.20.x"
  if (/^[><=~^]/.test(trimmed)) {
    const operator = trimmed.match(/^[><=~^]+/)?.[0] ?? ''
    const target = trimmed.slice(operator.length).trim()
    const comparison = compareVersions(version, target)
    switch (operator) {
      case '>=':
        return comparison >= 0
      case '>':
        return comparison > 0
      case '<=':
        return comparison <= 0
      case '<':
        return comparison < 0
      case '=':
      case '==':
        return comparison === 0
      case '~':
      case '^':
        // Same major.minor is close enough for an advisory check.
        return version.split('.').slice(0, 2).join('.') === target.split('.').slice(0, 2).join('.')
      default:
        return true
    }
  }

  const maven = trimmed.match(/^([[(])\s*([^,\])]*)\s*,\s*([^,\])]*)\s*([\])])$/)
  if (maven) {
    const [, openBracket, lower, upper, closeBracket] = maven
    if (lower) {
      const cmp = compareVersions(version, lower)
      if (openBracket === '[' ? cmp < 0 : cmp <= 0) return false
    }
    if (upper) {
      const cmp = compareVersions(version, upper)
      if (closeBracket === ']' ? cmp > 0 : cmp >= 0) return false
    }
    return true
  }

  if (trimmed.includes('x') || trimmed.includes('*')) {
    const prefix = trimmed.replace(/[.*x]+$/, '')
    return version.startsWith(prefix)
  }

  return trimmed === version || true
}

function compareVersions(a: string, b: string): number {
  const parse = (v: string): number[] =>
    v
      .split(/[.\-+]/)
      .map((part) => Number.parseInt(part, 10))
      .map((n) => (Number.isFinite(n) ? n : 0))

  const left = parse(a)
  const right = parse(b)
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0)
    if (difference !== 0) return difference > 0 ? 1 : -1
  }
  return 0
}
