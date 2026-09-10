import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import AdmZip from 'adm-zip'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))

import { writeResourcePack } from '../../src/main/services/content/resourcePackService'
import { emptyDraft } from '../../src/shared/resourcePacks'
import { IpcRequestSchemas } from '../../src/shared/ipc'

/**
 * Replaced textures, and where they are allowed to land.
 *
 * The path decides which file inside the zip a picture becomes, and that zip is
 * handed to every player who joins - so a path that escapes the assets tree is
 * the one input here that has to be refused rather than tidied.
 */

const PNG =
  'data:image/png;base64,' +
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'packtex-'))
  mkdirSync(root, { recursive: true })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('replacing a vanilla texture', () => {
  it('lands at the path the game reads', async () => {
    const dest = join(root, 'pack.zip')

    await writeResourcePack(
      { ...emptyDraft(), textures: [{ path: 'block/stone', image: PNG }] },
      '26.2',
      dest
    )

    const inside = new AdmZip(dest).getEntries().map((e) => e.entryName)
    expect(inside).toContain('assets/minecraft/textures/block/stone.png')
  })

  it('handles the deeper paths mobs use', async () => {
    const dest = join(root, 'pack.zip')

    await writeResourcePack(
      { ...emptyDraft(), textures: [{ path: 'entity/creeper/creeper', image: PNG }] },
      '26.2',
      dest
    )

    expect(new AdmZip(dest).getEntries().map((e) => e.entryName)).toContain(
      'assets/minecraft/textures/entity/creeper/creeper.png'
    )
  })

  it('tolerates a path somebody typed with .png on the end', async () => {
    const dest = join(root, 'pack.zip')

    await writeResourcePack(
      { ...emptyDraft(), textures: [{ path: 'item/apple', image: PNG }] },
      '26.2',
      dest
    )

    const inside = new AdmZip(dest).getEntries().map((e) => e.entryName)
    expect(inside).toContain('assets/minecraft/textures/item/apple.png')
    expect(inside).not.toContain('assets/minecraft/textures/item/apple.png.png')
  })

  it('counts them in what it reports', async () => {
    const built = await writeResourcePack(
      {
        ...emptyDraft(),
        textures: [
          { path: 'block/stone', image: PNG },
          { path: 'block/dirt', image: PNG }
        ]
      },
      '26.2',
      join(root, 'pack.zip')
    )

    expect(built.contents.textures).toBe(2)
  })
})

describe('paths that must be refused', () => {
  const schema = IpcRequestSchemas['resourcepack:install']

  function withPath(path: string) {
    return {
      instanceId: 'abc',
      draft: { ...emptyDraft(), textures: [{ path, image: PNG }] }
    }
  }

  it('refuses one that climbs out of the assets tree', () => {
    expect(schema.safeParse(withPath('../../evil')).success).toBe(false)
    expect(schema.safeParse(withPath('block/../../evil')).success).toBe(false)
  })

  it('refuses a leading slash or a drive letter', () => {
    expect(schema.safeParse(withPath('/etc/passwd')).success).toBe(false)
    expect(schema.safeParse(withPath('C:/windows/system32')).success).toBe(false)
  })

  it('refuses upper case and spaces, which the game ignores anyway', () => {
    expect(schema.safeParse(withPath('Block/Stone')).success).toBe(false)
    expect(schema.safeParse(withPath('block/my stone')).success).toBe(false)
  })

  it('accepts the ordinary ones', () => {
    expect(schema.safeParse(withPath('block/stone')).success).toBe(true)
    expect(schema.safeParse(withPath('entity/creeper/creeper')).success).toBe(true)
    expect(schema.safeParse(withPath('gui/title/minecraft')).success).toBe(true)
  })
})
