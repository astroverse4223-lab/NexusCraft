import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import AdmZip from 'adm-zip'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

/**
 * Forge builds up to 1.12.2 ship an installer that has no `--installClient`
 * option — installing a client was GUI-only — so running one headless dies on
 * an unrecognised option before it does any work. Those builds are unpacked
 * here instead, and this covers the unpacking: the profile that gets written,
 * the jar that no maven repository carries, and the entries that would send
 * the downloader after files a client has no use for.
 */

const root = mkdtempSync(join(tmpdir(), 'legacy-forge-test-'))

vi.mock('@main/core/paths', () => ({
  dataRoot: () => root,
  librariesRoot: () => join(root, 'libraries'),
  versionsRoot: () => join(root, 'versions'),
  ensureDir: (dir: string) => {
    mkdirSync(dir, { recursive: true })
    return dir
  }
}))

vi.mock('@main/services/minecraft/versionService', () => ({
  versionDir: (id: string) => join(root, 'versions', id),
  // A legacy install touches neither of these; failing loudly proves it.
  installVersion: vi.fn(async () => {
    throw new Error('installVersion should not be called for a legacy Forge build')
  }),
  listInstalledVersionIds: vi.fn(async () => [])
}))

vi.mock('@main/services/java/javaService', () => ({
  componentForMajor: () => 'jre-legacy',
  managedRuntimeInstalled: () => {
    throw new Error('no JVM should be needed for a legacy Forge build')
  },
  installManagedRuntime: async () => {
    throw new Error('no JVM should be needed for a legacy Forge build')
  }
}))

const http = vi.hoisted(() => ({
  getBuffer: vi.fn(),
  getJson: vi.fn(),
  getText: vi.fn()
}))

vi.mock('@main/core/http', () => http)

const { installLoader } = await import('@main/services/loaders/loaderService')

const VERSION = '1.12.2'
const BUILD = '1.12.2-14.23.5.2808'
const PROFILE_ID = `1.12.2-forge${BUILD}`

/** A stand-in for the real installer jar, in the same shape. */
function legacyInstallerJar(): Buffer {
  const zip = new AdmZip()
  zip.addFile(
    'install_profile.json',
    Buffer.from(
      JSON.stringify({
        install: {
          path: `net.minecraftforge:forge:${BUILD}`,
          filePath: `forge-${BUILD}-universal.jar`,
          target: PROFILE_ID
        },
        versionInfo: {
          id: PROFILE_ID,
          inheritsFrom: VERSION,
          jar: VERSION,
          type: 'release',
          mainClass: 'net.minecraft.launchwrapper.Launch',
          minecraftArguments: '--tweakClass net.minecraftforge.fml.common.launcher.FMLTweaker',
          libraries: [
            { name: `net.minecraftforge:forge:${BUILD}`, url: 'https://maven.minecraftforge.net/' },
            { name: 'net.minecraft:launchwrapper:1.12', serverreq: true },
            // Server-only, and not on the client library host at all.
            { name: 'org.jline:jline:3.5.1', url: 'https://maven.minecraftforge.net/', clientreq: false },
            // The host in old profiles that no longer serves artifacts.
            { name: 'org.ow2.asm:asm-all:5.2', url: 'http://files.minecraftforge.net/maven/', clientreq: true }
          ]
        }
      })
    )
  )
  zip.addFile(`forge-${BUILD}-universal.jar`, Buffer.from('universal jar bytes'))
  return zip.toBuffer()
}

function fakeTask(): never {
  return { setPhase: vi.fn(), add: vi.fn(), run: vi.fn() } as never
}

describe('legacy Forge installs', () => {
  beforeEach(() => {
    http.getBuffer.mockReset()
    http.getBuffer.mockResolvedValue(legacyInstallerJar())
  })

  afterEach(() => {
    rmSync(join(root, 'versions'), { recursive: true, force: true })
    rmSync(join(root, 'libraries'), { recursive: true, force: true })
  })

  it('writes the profile from the jar without running the installer', async () => {
    const id = await installLoader('forge', VERSION, BUILD, fakeTask())

    expect(id).toBe(PROFILE_ID)
    const profile = JSON.parse(
      readFileSync(join(root, 'versions', PROFILE_ID, `${PROFILE_ID}.json`), 'utf8')
    )
    expect(profile.inheritsFrom).toBe(VERSION)
    expect(profile.mainClass).toBe('net.minecraft.launchwrapper.Launch')
  })

  it('extracts the universal jar to the path its library entry names', async () => {
    await installLoader('forge', VERSION, BUILD, fakeTask())

    const jar = join(root, 'libraries', 'net', 'minecraftforge', 'forge', BUILD, `forge-${BUILD}.jar`)
    expect(readFileSync(jar, 'utf8')).toBe('universal jar bytes')
  })

  it('drops server-only libraries and repoints dead maven hosts', async () => {
    await installLoader('forge', VERSION, BUILD, fakeTask())

    const profile = JSON.parse(
      readFileSync(join(root, 'versions', PROFILE_ID, `${PROFILE_ID}.json`), 'utf8')
    )
    const names = profile.libraries.map((library: { name: string }) => library.name)
    expect(names).not.toContain('org.jline:jline:3.5.1')
    expect(names).toContain('net.minecraft:launchwrapper:1.12')

    const asm = profile.libraries.find((library: { name: string }) => library.name.startsWith('org.ow2.asm'))
    expect(asm.url).toBe('https://maven.minecraftforge.net/')
  })

  it('downloads the installer for the requested build', async () => {
    await installLoader('forge', VERSION, BUILD, fakeTask())

    expect(http.getBuffer).toHaveBeenCalledWith(
      `https://maven.minecraftforge.net/net/minecraftforge/forge/${BUILD}/forge-${BUILD}-installer.jar`,
      expect.anything()
    )
  })
})
