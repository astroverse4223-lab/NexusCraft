import type { LoaderId } from '@shared/types'

/**
 * Pure parsing and comparison logic for mod jars.
 *
 * Nothing here touches the disk or the zip: it takes the text of a manifest and
 * returns a shape. Keeping it separate from `modService` means the five
 * loader formats — each with its own quirks and its own way of being wrong —
 * can be tested against real-world manifests without a fixture jar.
 */

export interface RawMetadata {
  modId: string | null
  name: string
  version: string | null
  description: string | null
  authors: string[]
  loaders: LoaderId[]
  mcVersionRange: string | null
  iconPath: string | null
}

export const LOADER_NAMES: Record<LoaderId, string> = {
  vanilla: 'Vanilla',
  fabric: 'Fabric',
  forge: 'Forge',
  neoforge: 'NeoForge',
  quilt: 'Quilt'
}

/**
 * A deliberately small TOML reader. Forge's mods.toml only ever uses a handful
 * of constructs, and pulling in a full TOML parser for four fields is not worth
 * the dependency. Anything it cannot read degrades to "unknown", never a crash.
 */
export function readTomlValue(toml: string, key: string): string | null {
  const match = toml.match(new RegExp(`^\\s*${key}\\s*=\\s*(?:"""([\\s\\S]*?)"""|"([^"]*)"|'([^']*)')`, 'm'))
  if (!match) return null
  return (match[1] ?? match[2] ?? match[3] ?? '').trim() || null
}

export function parseFabricJson(text: string): RawMetadata | null {
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

export function parseQuiltJson(text: string): RawMetadata | null {
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

export function parseModsToml(text: string, loader: LoaderId): RawMetadata {
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

export function parseLegacyMcmod(text: string): RawMetadata | null {
  try {
    const parsed = JSON.parse(text) as
      | Array<{
          modid?: string
          name?: string
          version?: string
          description?: string
          authorList?: string[]
          mcversion?: string
          logoFile?: string
        }>
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

/**
 * Picks the right parser for whichever manifest a jar turned out to contain.
 * The order matters: a Quilt mod usually ships a Fabric manifest too, and the
 * Fabric one is the more complete of the pair.
 */
export function parseModManifest(manifests: {
  fabric?: string | null
  quilt?: string | null
  neoforge?: string | null
  forge?: string | null
  legacy?: string | null
}): RawMetadata | null {
  if (manifests.fabric) {
    const parsed = parseFabricJson(manifests.fabric)
    if (parsed) return parsed
  }
  if (manifests.quilt) {
    const parsed = parseQuiltJson(manifests.quilt)
    if (parsed) return parsed
  }
  if (manifests.neoforge) return parseModsToml(manifests.neoforge, 'neoforge')
  if (manifests.forge) {
    // A 1.20.1-era mods.toml works on both Forge and NeoForge.
    const parsed = parseModsToml(manifests.forge, 'forge')
    parsed.loaders = ['forge', 'neoforge']
    return parsed
  }
  if (manifests.legacy) return parseLegacyMcmod(manifests.legacy)
  return null
}

/* ------------------------------------------------------------- analysis */

/** Loaders that can run each other's mods. */
export function loaderAccepts(instanceLoader: LoaderId, modLoaders: LoaderId[]): 'yes' | 'maybe' | 'no' {
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

export function compareVersions(a: string, b: string): number {
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
