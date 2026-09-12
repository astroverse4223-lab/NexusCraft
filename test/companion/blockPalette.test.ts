import { describe, expect, it, vi, beforeAll, afterAll } from 'vitest'
import AdmZip from 'adm-zip'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Which face of a block goes on which side of a cube.
 *
 * Getting this wrong is silent and looks like nothing more than a build that
 * seems a bit off: grass with a turf underside, a log with rings down its
 * length, a crafting table with a worktop on the floor. So the rules are
 * checked against a jar built here with known contents, rather than against a
 * real one that may not be downloaded and whose textures change per version.
 */

let directory = ''
let jar = ''

/** A png small enough to inline, distinguishable by its byte length. */
function png(bytes: number): Buffer {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(Math.max(0, bytes - 8), 7)
  ])
}

vi.mock('../../src/main/services/minecraft/versionService', () => ({
  versionJarPath: () => jar
}))

const { blockPalette } = await import('../../src/main/companion/build/palette')

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'nexus-palette-'))
  jar = join(directory, 'fake.jar')

  const zip = new AdmZip()
  const put = (name: string, size: number): void =>
    zip.addFile(`assets/minecraft/textures/block/${name}.png`, png(size))

  // A plain block: one face, used on all six sides.
  put('stone', 100)

  // Grass: a greyscale top, a coloured side, a tintable fringe, dirt beneath.
  put('grass_block_side', 200)
  put('grass_block_top', 201)
  put('grass_block_side_overlay', 202)
  put('dirt', 203)

  // A log: rings on both ends, bark around the middle, and no `_bottom` file.
  put('oak_log', 300)
  put('oak_log_top', 301)

  // Sandstone states its underside outright.
  put('sandstone', 400)
  put('sandstone_top', 401)
  put('sandstone_bottom', 402)

  // A worktop, with planks underneath named by the candidate rather than found.
  put('crafting_table_front', 500)
  put('crafting_table_top', 501)
  put('oak_planks', 502)

  zip.writeZip(jar)
})

afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

/** The byte length a data url carries, which is how each fixture is told apart. */
function bytes(dataUrl: string | undefined): number | undefined {
  if (!dataUrl) return undefined
  return Buffer.from(dataUrl.split(',')[1], 'base64').length
}

describe('the block palette', () => {
  const find = (id: string) => blockPalette('test').find((entry) => entry.id === id)

  it('leaves out anything this version has no texture for', () => {
    // The fake jar holds a handful of blocks; the other ~180 the launcher
    // offers are simply absent, and a palette that rendered holes for them
    // would be one somebody clicks anyway.
    const ids = blockPalette('test').map((entry) => entry.id)

    expect(ids).toContain('stone')
    expect(ids).not.toContain('deepslate')
    expect(ids.length).toBeLessThan(20)
  })

  it('gives a plain block no separate faces at all', () => {
    const stone = find('stone')

    expect(bytes(stone?.texture)).toBe(100)
    expect(stone?.top).toBeUndefined()
    expect(stone?.bottom).toBeUndefined()
  })

  it('finds the top and bottom a block names for itself', () => {
    const sandstone = find('sandstone')

    expect(bytes(sandstone?.texture)).toBe(400)
    expect(bytes(sandstone?.top)).toBe(401)
    expect(bytes(sandstone?.bottom)).toBe(402)
  })

  it('leaves a log without an underside, so both its ends match', () => {
    /*
     * A log has rings on top and no `_bottom` texture, because both ends are
     * the same cut. Nothing is claimed here, and whoever draws it falls back
     * to the top - which is the only answer that puts rings on both ends.
     */
    const log = find('oak_log')

    expect(bytes(log?.texture)).toBe(300)
    expect(bytes(log?.top)).toBe(301)
    expect(log?.bottom).toBeUndefined()
  })

  it('puts dirt under grass rather than more grass', () => {
    const grass = find('grass_block')

    expect(bytes(grass?.texture)).toBe(200)
    expect(bytes(grass?.top)).toBe(201)
    // Not 201. Falling back to the top here is what lays turf on the underside.
    expect(bytes(grass?.bottom)).toBe(203)
  })

  it('marks grass as needing its colour, and carries the fringe', () => {
    /*
     * Grass is the one block stored without its colour: the top is a greyscale
     * mask and so is the fringe down the sides. Both are tinted as the game
     * draws them, so the palette flags them and leaves the colouring to
     * whatever has a canvas.
     */
    const grass = find('grass_block')

    expect(grass?.tintTop).toBe(true)
    expect(bytes(grass?.overlay)).toBe(202)
  })

  it('does not claim any other block needs tinting', () => {
    for (const entry of blockPalette('test')) {
      if (entry.id === 'grass_block') continue
      expect(entry.tintTop).toBeUndefined()
      expect(entry.overlay).toBeUndefined()
    }
  })

  it('puts planks under a crafting table', () => {
    const table = find('crafting_table')

    expect(bytes(table?.texture)).toBe(500)
    expect(bytes(table?.top)).toBe(501)
    expect(bytes(table?.bottom)).toBe(502)
  })

  it('reads the jar once and remembers it', () => {
    // Called on every re-render of the studio, so re-reading a 300MB jar each
    // time would be felt.
    const first = blockPalette('cached-check')
    const second = blockPalette('cached-check')

    expect(second).toBe(first)
  })
})
