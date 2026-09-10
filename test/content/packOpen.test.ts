import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import AdmZip from 'adm-zip'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))

import { readResourcePack } from '../../src/main/services/content/resourcePackService'

/**
 * Reading somebody else's pack back in.
 *
 * The honest part is what it refuses to claim: a pack can hold models, sounds,
 * fonts and shaders, and importing only the textures while saying nothing would
 * mean rebuilding a pack that silently lost half of itself. So the count of
 * what was not understood is part of the answer.
 */

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

let root: string

function makePack(files: Record<string, Buffer | string>): string {
  const zip = new AdmZip()
  for (const [name, body] of Object.entries(files)) {
    zip.addFile(name, typeof body === 'string' ? Buffer.from(body) : body)
  }

  const at = join(root, 'pack.zip')
  zip.writeZip(at)
  return at
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'packopen-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('opening a pack', () => {
  it('reads textures back at their paths', async () => {
    const read = await readResourcePack(
      makePack({
        'pack.mcmeta': '{"pack":{"pack_format":88,"description":"A test pack"}}',
        'assets/minecraft/textures/block/stone.png': PNG,
        'assets/minecraft/textures/item/apple.png': PNG
      })
    )

    expect(read.textures.map((t) => t.path).sort()).toEqual(['block/stone', 'item/apple'])
    expect(read.description).toBe('A test pack')
  })

  it('pulls the panorama out as a panorama, not six textures', async () => {
    const faces: Record<string, Buffer> = {}
    for (let i = 0; i < 6; i++) {
      faces[`assets/minecraft/textures/gui/title/background/panorama_${i}.png`] = PNG
    }

    const read = await readResourcePack(makePack(faces))

    expect(read.panorama).toHaveLength(6)
    expect(read.textures).toHaveLength(0)
  })

  it('refuses a half a panorama', async () => {
    // Three of six would flicker between yours and Mojang's as the camera
    // turns, which looks like a bug rather than a partial pack.
    const faces: Record<string, Buffer> = {}
    for (let i = 0; i < 3; i++) {
      faces[`assets/minecraft/textures/gui/title/background/panorama_${i}.png`] = PNG
    }

    expect((await readResourcePack(makePack(faces))).panorama).toBeNull()
  })

  it('finds the title logo', async () => {
    const read = await readResourcePack(
      makePack({ 'assets/minecraft/textures/gui/title/minecraft.png': PNG })
    )

    expect(read.logo).not.toBeNull()
    expect(read.textures).toHaveLength(0)
  })

  it('counts what it could not take rather than hiding it', async () => {
    const read = await readResourcePack(
      makePack({
        'assets/minecraft/textures/block/stone.png': PNG,
        'assets/minecraft/models/item/stick.json': '{}',
        'assets/minecraft/sounds/note.ogg': 'x',
        'assets/minecraft/font/default.json': '{}'
      })
    )

    expect(read.textures).toHaveLength(1)
    expect(read.ignored).toBe(3)
  })

  it('survives a pack.mcmeta that will not parse', async () => {
    const read = await readResourcePack(
      makePack({
        'pack.mcmeta': 'not json at all',
        'assets/minecraft/textures/block/dirt.png': PNG
      })
    )

    expect(read.description).toBe('')
    expect(read.textures).toHaveLength(1)
  })

  it('says so when the file is gone', async () => {
    await expect(readResourcePack(join(root, 'nothing.zip'))).rejects.toThrow()
  })
})
