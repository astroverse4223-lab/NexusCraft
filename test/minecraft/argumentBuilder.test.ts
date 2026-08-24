import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import type { Instance } from '@shared/types'
import type { VersionJson } from '@main/services/minecraft/versionTypes'

/**
 * The argument builder decides the exact argv the game is launched with. A bug
 * here is either an instant crash or — worse — a leaked access token in a log
 * file, so the redaction and the user-argument filter are covered as carefully
 * as the templating.
 */
const os = vi.hoisted(() => ({
  platform: vi.fn(() => 'win32'),
  arch: vi.fn(() => 'x64'),
  release: vi.fn(() => '10.0.22631')
}))

vi.mock('node:os', () => os)

// `paths` reaches for Electron's `app` on import; the builder only ever needs
// the assets root, so the whole module is replaced with a fixed one.
vi.mock('@main/core/paths', () => ({
  assetsRoot: () => 'C:\\data\\assets'
}))

const { buildLaunchArguments, splitAddress, splitJvmArgs } = await import('@main/services/minecraft/argumentBuilder')

const TOKEN = 'ey.super.secret.token'

function makeInstance(overrides: Partial<Instance> = {}): Instance {
  return {
    id: 'inst-1',
    name: 'Test',
    minecraftVersion: '1.21.4',
    loader: 'vanilla',
    loaderVersion: null,
    resolvedVersionId: null,
    gameDir: 'C:\\data\\instances\\inst-1',
    java: { javaPath: null, minRamMb: 1024, maxRamMb: 4096, jvmArgs: '' },
    window: { width: 1280, height: 720, fullscreen: false },
    iconColor: '#fff',
    notes: '',
    createdAt: 0,
    lastPlayedAt: null,
    totalPlaytimeMs: 0,
    installed: true,
    ...overrides
  }
}

function makeVersion(overrides: Partial<VersionJson> = {}): VersionJson {
  return {
    id: '1.21.4',
    type: 'release',
    mainClass: 'net.minecraft.client.main.Main',
    assets: '19',
    assetIndex: { id: '19', url: '', sha1: '', size: 0, totalSize: 0 },
    arguments: {
      jvm: ['-Djava.library.path=${natives_directory}', '-cp', '${classpath}'],
      game: ['--username', '${auth_player_name}', '--accessToken', '${auth_access_token}']
    },
    ...overrides
  } as VersionJson
}

function build(instance = makeInstance(), version = makeVersion(), extra: Record<string, unknown> = {}) {
  return buildLaunchArguments({
    instance,
    version,
    versionId: version.id,
    classpath: ['C:\\libs\\a.jar', 'C:\\libs\\b.jar'],
    nativesDir: 'C:\\data\\natives\\1.21.4',
    accessToken: TOKEN,
    username: 'Steve',
    uuid: '0000-1111',
    xuid: 'xuid-1',
    clientId: 'client-1',
    ...extra
  })
}

beforeEach(() => {
  os.platform.mockReturnValue('win32')
  os.arch.mockReturnValue('x64')
})
afterEach(() => vi.clearAllMocks())

describe('splitJvmArgs', () => {
  it('splits on whitespace', () => {
    expect(splitJvmArgs('-XX:+UseG1GC -XX:MaxGCPauseMillis=50')).toEqual([
      '-XX:+UseG1GC',
      '-XX:MaxGCPauseMillis=50'
    ])
  })

  it('keeps a double-quoted path with spaces as one argument', () => {
    expect(splitJvmArgs('-Dfoo="C:\\Program Files\\Java" -Xss1M')).toEqual([
      '-Dfoo=C:\\Program Files\\Java',
      '-Xss1M'
    ])
  })

  it('handles single quotes too', () => {
    expect(splitJvmArgs("-Dbar='a b c'")).toEqual(['-Dbar=a b c'])
  })

  it('returns an empty list for blank input', () => {
    expect(splitJvmArgs('')).toEqual([])
    expect(splitJvmArgs('    ')).toEqual([])
  })

  it('collapses runs of whitespace rather than emitting empty tokens', () => {
    expect(splitJvmArgs('-a\t\n  -b')).toEqual(['-a', '-b'])
  })
})

describe('splitAddress', () => {
  it('defaults to the Minecraft port', () => {
    expect(splitAddress('play.example.com')).toEqual(['play.example.com', 25565])
  })

  it('reads an explicit port', () => {
    expect(splitAddress('play.example.com:25577')).toEqual(['play.example.com', 25577])
  })

  it('parses a bracketed IPv6 literal with a port', () => {
    expect(splitAddress('[::1]:25577')).toEqual(['::1', 25577])
  })

  it('parses a bracketed IPv6 literal without a port', () => {
    expect(splitAddress('[fe80::1]')).toEqual(['fe80::1', 25565])
  })

  it('does not mistake a bare IPv6 address for host:port', () => {
    expect(splitAddress('fe80::1:2:3')).toEqual(['fe80::1:2:3', 25565])
  })

  it('rejects an out-of-range port and keeps the whole string as the host', () => {
    expect(splitAddress('example.com:99999')).toEqual(['example.com:99999', 25565])
  })

  it('trims surrounding whitespace', () => {
    expect(splitAddress('  example.com:25565  ')).toEqual(['example.com', 25565])
  })
})

describe('buildLaunchArguments', () => {
  it('puts heap settings before any user argument', () => {
    const { args } = build(makeInstance({ java: { javaPath: null, minRamMb: 512, maxRamMb: 8192, jvmArgs: '' } }))
    expect(args[0]).toBe('-Xms512M')
    expect(args[1]).toBe('-Xmx8192M')
  })

  it('drops user arguments that would override the heap or classpath', () => {
    const instance = makeInstance({
      java: { javaPath: null, minRamMb: 1024, maxRamMb: 4096, jvmArgs: '-Xmx99G -Xms1G -cp evil.jar -jar x.jar -XX:+UseG1GC' }
    })
    const { args } = build(instance)
    expect(args).not.toContain('-Xmx99G')
    expect(args).not.toContain('-Xms1G')
    expect(args).not.toContain('evil.jar')
    expect(args).not.toContain('-jar')
    // The legitimate one survives.
    expect(args).toContain('-XX:+UseG1GC')
    expect(args.filter((a) => a.startsWith('-Xmx'))).toEqual(['-Xmx4096M'])
  })

  it('substitutes placeholders in game arguments', () => {
    const { args } = build()
    expect(args).toContain('Steve')
    expect(args).toContain(TOKEN)
  })

  it('redacts the access token in safeArgs but not in args', () => {
    const { args, safeArgs } = build()
    expect(args).toContain(TOKEN)
    expect(safeArgs).not.toContain(TOKEN)
    expect(safeArgs.some((a) => a.includes('[redacted]'))).toBe(true)
    // Redaction must not otherwise change the shape of the command line.
    expect(safeArgs).toHaveLength(args.length)
  })

  it('redacts a token embedded inside a larger argument', () => {
    const version = makeVersion({
      arguments: { jvm: [], game: ['--session', 'token:${auth_access_token}:${auth_uuid}'] }
    })
    const { safeArgs } = build(makeInstance(), version)
    expect(safeArgs.join(' ')).not.toContain(TOKEN)
    expect(safeArgs.join(' ')).toContain('[redacted]')
  })

  it('places the main class between the jvm and game arguments', () => {
    const version = makeVersion()
    const { args, mainClass } = build(makeInstance(), version)
    const index = args.indexOf(version.mainClass)
    expect(mainClass).toBe(version.mainClass)
    expect(index).toBeGreaterThan(0)
    expect(args.slice(0, index).some((a) => a.startsWith('-Xmx'))).toBe(true)
    expect(args.slice(index + 1)).toContain('Steve')
  })

  it('falls back to pre-1.13 classpath arguments when no jvm list exists', () => {
    const version = makeVersion({
      arguments: undefined,
      minecraftArguments: '--username ${auth_player_name} --version ${version_name}'
    })
    const { args } = build(makeInstance(), version)
    expect(args).toContain('-cp')
    expect(args).toContain('C:\\libs\\a.jar;C:\\libs\\b.jar')
    expect(args).toContain('-Djava.library.path=C:\\data\\natives\\1.21.4')
    expect(args).toContain('Steve')
    expect(args).toContain('1.21.4')
  })

  it('adds the macOS thread flag only on darwin', () => {
    expect(build().args).not.toContain('-XstartOnFirstThread')
    os.platform.mockReturnValue('darwin')
    expect(build().args).toContain('-XstartOnFirstThread')
  })

  it('passes window size when not fullscreen', () => {
    const { args } = build()
    expect(args).toContain('--width')
    expect(args).toContain('1280')
    expect(args).toContain('--height')
    expect(args).toContain('720')
    expect(args).not.toContain('--fullscreen')
  })

  it('passes --fullscreen instead of a size when fullscreen', () => {
    const instance = makeInstance({ window: { width: 1280, height: 720, fullscreen: true } })
    const { args } = build(instance)
    expect(args).toContain('--fullscreen')
    expect(args).not.toContain('--width')
  })

  it('uses --quickPlayMultiplayer when the version advertises support', () => {
    const version = makeVersion({
      arguments: {
        jvm: [],
        game: [
          { rules: [{ action: 'allow', features: { is_quick_play_multiplayer: true } }], value: ['--quickPlayMultiplayer', '${quickPlayMultiplayer}'] }
        ]
      }
    })
    const { args } = build(makeInstance(), version, { quickPlayServer: 'play.example.com:25577' })
    expect(args).toContain('--quickPlayMultiplayer')
    expect(args).toContain('play.example.com:25577')
    expect(args).not.toContain('--server')
  })

  it('falls back to --server/--port on versions without quick play', () => {
    const { args } = build(makeInstance(), makeVersion(), { quickPlayServer: 'play.example.com:25577' })
    expect(args).toContain('--server')
    expect(args).toContain('play.example.com')
    expect(args).toContain('--port')
    expect(args).toContain('25577')
    expect(args).not.toContain('--quickPlayMultiplayer')
  })

  it('adds no join arguments when no server was requested', () => {
    const { args } = build()
    expect(args).not.toContain('--server')
    expect(args).not.toContain('--quickPlayMultiplayer')
  })

  it('honours feature rules on the jvm argument list', () => {
    const version = makeVersion({
      arguments: {
        jvm: [
          '-Dalways=1',
          { rules: [{ action: 'allow', os: { name: 'osx' } }], value: '-Donlymac=1' },
          { rules: [{ action: 'allow', os: { name: 'windows' } }], value: '-Donlywin=1' }
        ],
        game: []
      }
    })
    const { args } = build(makeInstance(), version)
    expect(args).toContain('-Dalways=1')
    expect(args).toContain('-Donlywin=1')
    expect(args).not.toContain('-Donlymac=1')
  })

  it('adds the log4j configuration argument when the version ships one', () => {
    const version = makeVersion({
      logging: {
        client: {
          argument: '-Dlog4j.configurationFile=${path}',
          file: { id: 'client-1.12.xml', url: '', sha1: '', size: 0 },
          type: 'log4j2-xml'
        }
      }
    })
    const { args } = build(makeInstance(), version)
    expect(args.some((a) => a.startsWith('-Dlog4j.configurationFile='))).toBe(true)
    expect(args.some((a) => a.includes('client-1.12.xml'))).toBe(true)
    expect(args.some((a) => a.includes('${path}'))).toBe(false)
  })

  it('leaves unknown placeholders untouched rather than emitting "undefined"', () => {
    const version = makeVersion({ arguments: { jvm: [], game: ['${not_a_real_placeholder}'] } })
    const { args } = build(makeInstance(), version)
    expect(args).toContain('${not_a_real_placeholder}')
    expect(args).not.toContain('undefined')
  })

  it('always stamps the launcher brand and version', () => {
    const { args } = build()
    expect(args).toContain('-Dminecraft.launcher.brand=nexuscraft')
    expect(args.some((a) => a.startsWith('-Dminecraft.launcher.version='))).toBe(true)
  })
})
