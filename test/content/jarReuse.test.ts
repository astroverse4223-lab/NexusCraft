import { describe, expect, it, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import RealAdmZip from 'adm-zip'
import { mkdtemp, rm, writeFile, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * That a version jar is opened once and kept, rather than once per texture.
 *
 * This is the difference between a restyle taking nine seconds and taking
 * twenty minutes, measured: a version jar is around forty megabytes, opening
 * one costs about half a second, and a whole-pack restyle asks for roughly two
 * and a half thousand textures one after another.
 *
 * It is also why the launcher stops answering while one runs. These reads are
 * synchronous and they happen in the main process, so each of those half
 * seconds is half a second in which nothing else can be served.
 *
 * Counting opens rather than timing, because a timing test on a machine under
 * load is a test that fails for no reason.
 */

let directory = ''
let jar = ''
let opens: string[] = []

vi.mock('adm-zip', async () => {
  const actual = (await vi.importActual<{ default: typeof RealAdmZip }>('adm-zip')).default

  return {
    default: class Counting extends actual {
      constructor(input?: string | Buffer) {
        super(input as string)
        if (typeof input === 'string') opens.push(input)
      }
    }
  }
})

vi.mock('../../src/main/services/minecraft/versionService', () => ({
  versionJarPath: () => jar
}))

const { vanillaTexture, vanillaTextures } = await import(
  '../../src/main/services/content/resourcePackService'
)

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'nexus-jar-'))
  jar = join(directory, 'version.jar')

  const zip = new RealAdmZip()
  for (const name of ['stone', 'dirt', 'oak_planks', 'sand', 'gravel']) {
    zip.addFile(
      `assets/minecraft/textures/block/${name}.png`,
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, name.length])
    )
  }
  zip.writeZip(jar)
})

afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

beforeEach(() => {
  opens = []
})

describe('reading textures out of a version jar', () => {
  it('opens the jar once for many textures, not once each', () => {
    // Warmed first, so the count below is only the reads being measured and
    // not whatever order the tests happened to run in.
    vanillaTexture('test', 'block/stone')
    opens = []

    // The read that matters: a restyle walks every texture in turn.
    for (const name of ['stone', 'dirt', 'oak_planks', 'sand', 'gravel']) {
      expect(vanillaTexture('test', `block/${name}`)).toContain('data:image/png;base64,')
    }

    expect(opens).toHaveLength(0)
  })

  it('shares the open jar between listing and reading', () => {
    vanillaTexture('test', 'block/stone')
    opens = []

    expect(vanillaTextures('test')).toContain('block/stone')
    vanillaTexture('test', 'block/dirt')

    expect(opens).toHaveLength(0)
  })

  it('opens it exactly once from cold, however many textures follow', async () => {
    // Cold, by making the file look new.
    const later = new Date(Date.now() + 20_000)
    await utimes(jar, later, later)
    opens = []

    for (const name of ['stone', 'dirt', 'oak_planks', 'sand', 'gravel']) {
      vanillaTexture('test', `block/${name}`)
    }

    expect(opens).toHaveLength(1)
  })

  it('opens it again when the jar on disk has changed', async () => {
    vanillaTexture('test', 'block/stone')
    opens = []

    /*
     * A version that is repaired or redownloaded mid-session has to be
     * noticed. Holding the old one would keep serving textures out of a file
     * that is no longer there, which is a cache that lies rather than one that
     * saves anything.
     */
    const zip = new RealAdmZip()
    zip.addFile('assets/minecraft/textures/block/stone.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]))
    zip.writeZip(jar)

    const later = new Date(Date.now() + 10_000)
    await utimes(jar, later, later)

    vanillaTexture('test', 'block/stone')

    expect(opens).toHaveLength(1)
  })

  it('says nothing rather than throwing when the jar is missing', async () => {
    const gone = join(directory, 'nope.jar')
    const was = jar
    jar = gone

    expect(vanillaTexture('test', 'block/stone')).toBeNull()
    expect(vanillaTextures('test')).toEqual([])

    jar = was
  })

  it('refuses a path that climbs out of the textures folder', async () => {
    await writeFile(join(directory, 'secret'), 'not a texture')

    expect(vanillaTexture('test', '../../../secret')).toBeNull()
    expect(vanillaTexture('test', 'block/../../secret')).toBeNull()
  })
})
