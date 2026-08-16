import { arch, platform, release } from 'node:os'
import type { Library, Rule } from './versionTypes'

/** Mojang's OS names, mapped from Node's. */
export function currentOsName(): 'windows' | 'osx' | 'linux' {
  switch (platform()) {
    case 'win32':
      return 'windows'
    case 'darwin':
      return 'osx'
    default:
      return 'linux'
  }
}

export function currentArch(): string {
  // Mojang uses x86 for 32-bit, x86_64 for 64-bit and arm64 as-is.
  switch (arch()) {
    case 'x64':
      return 'x86_64'
    case 'ia32':
      return 'x86'
    case 'arm64':
      return 'arm64'
    default:
      return arch()
  }
}

export interface FeatureSet {
  is_demo_user?: boolean
  has_custom_resolution?: boolean
  has_quick_plays_support?: boolean
  is_quick_play_singleplayer?: boolean
  is_quick_play_multiplayer?: boolean
  is_quick_play_realms?: boolean
}

function matchesOs(spec: NonNullable<Rule['os']>): boolean {
  if (spec.name && spec.name !== currentOsName()) return false
  if (spec.arch && spec.arch !== currentArch() && spec.arch !== arch()) return false
  if (spec.version) {
    try {
      if (!new RegExp(spec.version).test(release())) return false
    } catch {
      // A malformed regex in metadata should not block the launch.
      return true
    }
  }
  return true
}

/**
 * Evaluates Mojang's rule lists. The convention is: if any rule is present, the
 * default is deny, and the last matching rule wins.
 */
export function evaluateRules(rules: Rule[] | undefined, features: FeatureSet = {}): boolean {
  if (!rules || rules.length === 0) return true

  let allowed = false
  for (const rule of rules) {
    let matches = true
    if (rule.os) matches = matchesOs(rule.os)
    if (matches && rule.features) {
      for (const [name, required] of Object.entries(rule.features)) {
        const actual = Boolean((features as Record<string, boolean | undefined>)[name])
        if (actual !== required) {
          matches = false
          break
        }
      }
    }
    if (matches) allowed = rule.action === 'allow'
  }
  return allowed
}

export function isLibraryAllowed(library: Library, features: FeatureSet = {}): boolean {
  return evaluateRules(library.rules, features)
}

/**
 * Resolves the natives classifier for this platform on legacy versions, e.g.
 * "natives-windows" or "natives-windows-64".
 */
export function nativesClassifier(library: Library): string | null {
  if (!library.natives) return null
  const template = library.natives[currentOsName()]
  if (!template) return null
  return template.replace('${arch}', arch() === 'ia32' ? '32' : '64')
}

/**
 * Converts a maven coordinate ("group:artifact:version[:classifier][@ext]")
 * into its repository-relative path.
 */
export function mavenToPath(coordinate: string): string {
  const [main, extension = 'jar'] = coordinate.split('@')
  const parts = main.split(':')
  const [group, artifact, version] = parts
  const classifier = parts[3]

  const fileName = classifier
    ? `${artifact}-${version}-${classifier}.${extension}`
    : `${artifact}-${version}.${extension}`
  return [...group.split('.'), artifact, version, fileName].join('/')
}
