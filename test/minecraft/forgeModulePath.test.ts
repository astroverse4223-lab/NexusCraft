import { describe, expect, it, vi } from 'vitest'

// The builder reads the data directory for a couple of paths; the test only
// cares about argument shape, so a fixed root keeps it out of the filesystem.
vi.mock('../../src/main/core/paths', () => ({
  assetsRoot: () => 'C:/data/assets'
}))
import { buildLaunchArguments } from '../../src/main/services/minecraft/argumentBuilder'
import type { VersionJson } from '../../src/main/services/minecraft/versionTypes'
import type { Instance } from '../../src/shared/types'

/**
 * Forge 1.20.1 dies before loading a single mod if the game jar is not named in
 * its `-DignoreList`. The jar becomes an automatic module, collides with
 * Forge's patched `minecraft` over `net.minecraft.data`, and the JVM refuses
 * the module layer — with a message that mentions neither the launcher nor any
 * mod, so it reads as a broken modpack.
 *
 * The catch is that Forge writes the list as `${version_name}.jar`, and on a
 * loader profile that placeholder is the loader's id, not the jar's.
 */

const instance = {
  id: 'i',
  name: 'Verity JE',
  gameDir: 'C:/games/verity',
  minecraftVersion: '1.20.1',
  loader: 'forge',
  java: { minRamMb: 1024, maxRamMb: 4096, javaPath: null, jvmArgs: '' },
  window: { width: 1280, height: 720, fullscreen: false }
} as unknown as Instance

/** A Forge profile, shaped the way the installer writes one. */
function forgeVersion(): VersionJson {
  return {
    id: '1.20.1-forge-47.4.23',
    // resolveVersion flattens inheritance and records the root here.
    resolvedBaseId: '1.20.1',
    mainClass: 'cpw.mods.bootstraplauncher.BootstrapLauncher',
    type: 'release',
    arguments: {
      jvm: [
        '-DignoreList=bootstraplauncher,securejarhandler,asm,client-extra,forge-,${version_name}.jar',
        '-DlibraryDirectory=${library_directory}',
        '-p',
        'module/path/here',
        '--add-modules',
        'ALL-MODULE-PATH'
      ],
      game: ['--version', '${version_name}']
    }
  } as unknown as VersionJson
}

function build(version: VersionJson) {
  return buildLaunchArguments({
    instance,
    version,
    versionId: '1.20.1-forge-47.4.23',
    classpath: ['C:/data/versions/1.20.1/1.20.1.jar'],
    nativesDir: 'C:/natives',
    accessToken: 'secret',
    username: 'Error420s',
    uuid: 'u',
    xuid: 'x',
    clientId: 'c'
  })
}

describe('Forge module path', () => {
  it('names the real client jar in the ignore list, not the loader profile', () => {
    const { args } = build(forgeVersion())
    const ignore = args.find((arg) => arg.startsWith('-DignoreList='))

    expect(ignore).toBeDefined()
    // The jar that is actually on the classpath.
    expect(ignore).toContain('1.20.1.jar')
    // And Forge's own entries survive.
    expect(ignore).toContain('bootstraplauncher')
    expect(ignore).toContain('client-extra')
  })

  it('leaves --version as the loader id, which is the correct answer there', () => {
    const { args } = build(forgeVersion())
    const at = args.indexOf('--version')
    expect(at).toBeGreaterThan(-1)
    expect(args[at + 1]).toBe('1.20.1-forge-47.4.23')
  })

  it('does not add the same jar twice', () => {
    const version = forgeVersion()
    version.arguments!.jvm = ['-DignoreList=asm,1.20.1.jar']
    const { args } = build(version)
    const ignore = args.find((arg) => arg.startsWith('-DignoreList='))!
    expect(ignore.split(',').filter((entry) => entry === '1.20.1.jar')).toHaveLength(1)
  })

  it('leaves newer loaders alone, which ship no ignore list at all', () => {
    const version = forgeVersion()
    version.arguments!.jvm = ['-DlibraryDirectory=${library_directory}', '--add-modules', 'ALL-MODULE-PATH']
    const { args } = build(version)
    expect(args.some((arg) => arg.startsWith('-DignoreList='))).toBe(false)
  })

  it('falls back to inheritsFrom when the chain was not flattened', () => {
    const version = forgeVersion()
    delete (version as { resolvedBaseId?: string }).resolvedBaseId
    ;(version as { inheritsFrom?: string }).inheritsFrom = '1.20.1'
    const { args } = build(version)
    expect(args.find((arg) => arg.startsWith('-DignoreList='))).toContain('1.20.1.jar')
  })
})
