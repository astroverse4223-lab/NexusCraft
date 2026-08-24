import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import type { Library, Rule } from '@main/services/minecraft/versionTypes'

/**
 * `rules.ts` reads the host platform at call time, so every test drives it
 * through a mocked `node:os`. Getting this wrong ships the wrong natives and
 * crashes the game before the window opens, which is exactly the failure these
 * tests exist to catch.
 */
const os = vi.hoisted(() => ({
  platform: vi.fn(() => 'win32'),
  arch: vi.fn(() => 'x64'),
  release: vi.fn(() => '10.0.22631')
}))

vi.mock('node:os', () => os)

const { currentArch, currentOsName, evaluateRules, isLibraryAllowed, mavenToPath, nativesClassifier } = await import(
  '@main/services/minecraft/rules'
)

function asWindows(): void {
  os.platform.mockReturnValue('win32')
  os.arch.mockReturnValue('x64')
  os.release.mockReturnValue('10.0.22631')
}

function asLinux(): void {
  os.platform.mockReturnValue('linux')
  os.arch.mockReturnValue('x64')
  os.release.mockReturnValue('6.8.0')
}

function asMacArm(): void {
  os.platform.mockReturnValue('darwin')
  os.arch.mockReturnValue('arm64')
  os.release.mockReturnValue('23.5.0')
}

beforeEach(asWindows)
afterEach(() => vi.clearAllMocks())

describe('currentOsName', () => {
  it('maps Node platforms onto Mojang names', () => {
    asWindows()
    expect(currentOsName()).toBe('windows')
    asMacArm()
    expect(currentOsName()).toBe('osx')
    asLinux()
    expect(currentOsName()).toBe('linux')
  })

  it('treats every other platform as linux', () => {
    os.platform.mockReturnValue('freebsd')
    expect(currentOsName()).toBe('linux')
  })
})

describe('currentArch', () => {
  it('maps Node architectures onto Mojang names', () => {
    os.arch.mockReturnValue('x64')
    expect(currentArch()).toBe('x86_64')
    os.arch.mockReturnValue('ia32')
    expect(currentArch()).toBe('x86')
    os.arch.mockReturnValue('arm64')
    expect(currentArch()).toBe('arm64')
  })

  it('passes unknown architectures through unchanged', () => {
    os.arch.mockReturnValue('ppc64')
    expect(currentArch()).toBe('ppc64')
  })
})

describe('evaluateRules', () => {
  it('allows when there are no rules at all', () => {
    expect(evaluateRules(undefined)).toBe(true)
    expect(evaluateRules([])).toBe(true)
  })

  it('denies by default once any rule is present', () => {
    const rules: Rule[] = [{ action: 'allow', os: { name: 'osx' } }]
    expect(evaluateRules(rules)).toBe(false)
  })

  it('allows when an os rule matches the host', () => {
    const rules: Rule[] = [{ action: 'allow', os: { name: 'windows' } }]
    expect(evaluateRules(rules)).toBe(true)
  })

  it('lets the last matching rule win', () => {
    // Mojang's real shape: allow everywhere, then carve out one platform.
    const rules: Rule[] = [{ action: 'allow' }, { action: 'disallow', os: { name: 'windows' } }]
    expect(evaluateRules(rules)).toBe(false)
    asLinux()
    expect(evaluateRules(rules)).toBe(true)
  })

  it('ignores a disallow rule aimed at a different platform', () => {
    const rules: Rule[] = [{ action: 'allow' }, { action: 'disallow', os: { name: 'osx' } }]
    expect(evaluateRules(rules)).toBe(true)
  })

  it('matches on architecture, accepting both Mojang and Node spellings', () => {
    os.arch.mockReturnValue('ia32')
    expect(evaluateRules([{ action: 'allow', os: { name: 'windows', arch: 'x86' } }])).toBe(true)
    expect(evaluateRules([{ action: 'allow', os: { name: 'windows', arch: 'ia32' } }])).toBe(true)
    expect(evaluateRules([{ action: 'allow', os: { name: 'windows', arch: 'x86_64' } }])).toBe(false)
  })

  it('matches the os version as a regex against the kernel release', () => {
    os.release.mockReturnValue('10.0.22631')
    expect(evaluateRules([{ action: 'allow', os: { name: 'windows', version: '^10\\.' } }])).toBe(true)
    expect(evaluateRules([{ action: 'allow', os: { name: 'windows', version: '^6\\.' } }])).toBe(false)
  })

  it('does not let a malformed version regex block the launch', () => {
    // A broken pattern in metadata must not be the reason a library is skipped.
    expect(evaluateRules([{ action: 'allow', os: { name: 'windows', version: '([' } }])).toBe(true)
  })

  it('requires every feature in a rule to match exactly', () => {
    const rules: Rule[] = [{ action: 'allow', features: { has_custom_resolution: true } }]
    expect(evaluateRules(rules, { has_custom_resolution: true })).toBe(true)
    expect(evaluateRules(rules, { has_custom_resolution: false })).toBe(false)
    expect(evaluateRules(rules, {})).toBe(false)
  })

  it('treats an absent feature as false, matching a required-false rule', () => {
    const rules: Rule[] = [{ action: 'allow', features: { is_demo_user: false } }]
    expect(evaluateRules(rules, {})).toBe(true)
  })

  it('requires os and features together when a rule carries both', () => {
    const rules: Rule[] = [
      { action: 'allow', os: { name: 'windows' }, features: { has_quick_plays_support: true } }
    ]
    expect(evaluateRules(rules, { has_quick_plays_support: true })).toBe(true)
    expect(evaluateRules(rules, { has_quick_plays_support: false })).toBe(false)
    asLinux()
    expect(evaluateRules(rules, { has_quick_plays_support: true })).toBe(false)
  })
})

describe('isLibraryAllowed', () => {
  it('allows an unconditional library', () => {
    expect(isLibraryAllowed({ name: 'com.example:thing:1.0' })).toBe(true)
  })

  it('honours the library rule list', () => {
    const library: Library = {
      name: 'org.lwjgl:lwjgl:3.3.3',
      rules: [{ action: 'allow', os: { name: 'osx' } }]
    }
    expect(isLibraryAllowed(library)).toBe(false)
    asMacArm()
    expect(isLibraryAllowed(library)).toBe(true)
  })
})

describe('nativesClassifier', () => {
  it('returns null when a library ships no legacy natives', () => {
    expect(nativesClassifier({ name: 'com.example:thing:1.0' })).toBeNull()
  })

  it('returns null when natives exist for other platforms only', () => {
    expect(nativesClassifier({ name: 'a:b:1', natives: { osx: 'natives-osx' } })).toBeNull()
  })

  it('picks the classifier for the host os', () => {
    expect(nativesClassifier({ name: 'a:b:1', natives: { windows: 'natives-windows' } })).toBe('natives-windows')
  })

  it('substitutes ${arch} with the process bitness', () => {
    const library: Library = { name: 'a:b:1', natives: { windows: 'natives-windows-${arch}' } }
    expect(nativesClassifier(library)).toBe('natives-windows-64')
    os.arch.mockReturnValue('ia32')
    expect(nativesClassifier(library)).toBe('natives-windows-32')
  })
})

describe('mavenToPath', () => {
  it('converts a plain coordinate', () => {
    expect(mavenToPath('com.mojang:logging:1.1.1')).toBe('com/mojang/logging/1.1.1/logging-1.1.1.jar')
  })

  it('appends the classifier to the file name', () => {
    expect(mavenToPath('org.lwjgl:lwjgl:3.3.3:natives-windows')).toBe(
      'org/lwjgl/lwjgl/3.3.3/lwjgl-3.3.3-natives-windows.jar'
    )
  })

  it('honours an @extension suffix', () => {
    expect(mavenToPath('net.minecraftforge:forge:1.20.1-47.2.0:installer@zip')).toBe(
      'net/minecraftforge/forge/1.20.1-47.2.0/forge-1.20.1-47.2.0-installer.zip'
    )
  })

  it('splits every group segment into its own directory', () => {
    expect(mavenToPath('a.b.c.d:artifact:2.0')).toBe('a/b/c/d/artifact/2.0/artifact-2.0.jar')
  })
})
