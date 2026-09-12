import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { blueprintFromCells, trimmed, MAX_DISTINCT_BLOCKS } from '../../src/shared/studio'
import type { StudioCell } from '../../src/shared/studio'
import { exportBlueprint } from '../../src/main/companion/build/schematicExport'
import { loadSchematic } from '../../src/main/companion/build/schematic'
import { blueprintSize, billOfMaterials } from '../../src/main/companion/build/blueprint'

/**
 * The studio draws into a list of placed blocks and the exporter reads a
 * character grid, so this is the one piece of code between what somebody built
 * and the file they get. Everything it can get wrong is silent: a swapped axis
 * exports a build rotated, an off-by-one drops the far row, a lost key turns
 * stone into air. None of that throws.
 */

/** A cell, written short, because the tests below place a lot of them. */
function at(x: number, y: number, z: number, block: string): StudioCell {
  return { x, y, z, block }
}

describe('drawn cells become a blueprint', () => {
  it('puts each block where it was drawn', () => {
    /*
     * Deliberately not symmetric. A build that reads the same along both axes
     * passes whether or not x and z are the right way round, which is the
     * mistake most worth catching here.
     */
    const built = blueprintFromCells(
      'Corner',
      [at(0, 0, 0, 'stone'), at(2, 0, 0, 'stone'), at(0, 0, 1, 'oak_planks')],
      3,
      2,
      1
    )

    const key = Object.entries(built.palette)
    const stone = key.find(([, id]) => id === 'stone')?.[0] as string
    const planks = key.find(([, id]) => id === 'oak_planks')?.[0] as string

    expect(built.layers).toEqual([[`${stone}.${stone}`, `${planks}..`]])
  })

  it('fills the whole footprint, not just the part that was used', () => {
    const built = blueprintFromCells('Speck', [at(0, 0, 0, 'stone')], 4, 3, 1)

    expect(built.layers[0]).toHaveLength(3)
    for (const row of built.layers[0]) expect(row).toHaveLength(4)
  })

  it('keeps the layers apart and in order, bottom first', () => {
    const built = blueprintFromCells('Stack', [at(0, 0, 0, 'stone'), at(0, 2, 0, 'glass')], 1, 1, 3)

    const stone = Object.entries(built.palette).find(([, id]) => id === 'stone')?.[0]
    const glass = Object.entries(built.palette).find(([, id]) => id === 'glass')?.[0]

    expect(built.layers).toEqual([[stone], ['.'], [glass]])
  })

  it('only keys the blocks that were actually used', () => {
    const built = blueprintFromCells('Two', [at(0, 0, 0, 'stone'), at(1, 0, 0, 'stone')], 2, 1, 1)

    // Air plus the one block. The other 187 in the palette are not in the file.
    expect(Object.keys(built.palette)).toHaveLength(2)
  })

  it('the last placement at a spot is the one that survives', () => {
    // Painting over something is how the studio erases and recolours, so the
    // later cell has to win rather than the first one drawn.
    const built = blueprintFromCells('Over', [at(0, 0, 0, 'stone'), at(0, 0, 0, 'glass')], 1, 1, 1)

    expect(built.palette[built.layers[0][0]]).toBe('glass')
  })

  it('drops cells outside the canvas instead of writing past the row', () => {
    const built = blueprintFromCells(
      'Stray',
      [at(0, 0, 0, 'stone'), at(9, 0, 0, 'stone'), at(0, 0, 9, 'stone'), at(-1, 0, 0, 'stone')],
      2,
      2,
      1
    )

    const stone = Object.entries(built.palette).find(([, id]) => id === 'stone')?.[0] as string

    // Only the one inside it is drawn; the far cells and the negative one are
    // gone rather than wrapped onto a row they do not belong on.
    expect(built.layers).toEqual([[`${stone}.`, '..']])
  })

  it('falls back to a name rather than writing an empty one', () => {
    expect(blueprintFromCells('   ', [], 1, 1, 1).name).toBe('Build')
  })

  it('stops at the last key rather than drawing the wrong block', () => {
    /*
     * Past the key characters a grid cannot say which block a cell is. Leaving
     * the cell out is wrong in a way you can see; reusing a key is wrong in a
     * way you cannot, and would swap blocks silently in the exported file.
     */
    const many = Array.from({ length: MAX_DISTINCT_BLOCKS + 5 }, (_, i) =>
      at(i, 0, 0, `block_${i}`)
    )

    const built = blueprintFromCells('Many', many, many.length, 1, 1)

    expect(Object.keys(built.palette)).toHaveLength(MAX_DISTINCT_BLOCKS + 1)
    expect(built.layers[0][0].endsWith('.....')).toBe(true)
  })
})

describe('trimming the empty top', () => {
  it('drops layers nothing was built on', () => {
    const built = blueprintFromCells('Low', [at(0, 0, 0, 'stone')], 1, 1, 6)

    expect(built.layers).toHaveLength(6)
    expect(trimmed(built).layers).toHaveLength(1)
  })

  it('keeps an empty layer with something above it', () => {
    const built = blueprintFromCells('Gap', [at(0, 0, 0, 'stone'), at(0, 2, 0, 'stone')], 1, 1, 6)

    // The gap is part of the build — a floating roof needs its space beneath.
    expect(trimmed(built).layers).toHaveLength(3)
  })

  it('leaves one layer behind when the canvas is empty', () => {
    // A structure with no layers at all is not a structure the exporter can
    // size, so an empty build stays one empty layer rather than becoming none.
    expect(trimmed(blueprintFromCells('None', [], 2, 2, 8)).layers).toHaveLength(1)
  })
})

describe('a drawn build reaches the file intact', () => {
  let directory = ''

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'nexus-studio-'))
  })

  afterAll(async () => {
    if (directory) await rm(directory, { recursive: true, force: true })
  })

  it('survives the round trip through a .schem', async () => {
    /*
     * The point of the studio is the file at the end of it, so this goes the
     * whole way: cells out of the editor, through the converter, through the
     * real exporter, and back in through the reader WorldEdit files are read
     * with. An axis swap anywhere in that chain shows up here and nowhere else.
     */
    const cells = [
      at(0, 0, 0, 'stone'),
      at(1, 0, 0, 'stone'),
      at(2, 0, 0, 'stone'),
      at(0, 0, 1, 'stone'),
      at(2, 0, 1, 'stone'),
      at(1, 1, 0, 'glass'),
      at(0, 1, 1, 'oak_planks')
    ]

    const built = trimmed(blueprintFromCells('Drawn', cells, 3, 2, 5))
    const file = join(directory, 'drawn.schem')
    await exportBlueprint(built, file, 'schem')

    const { blueprint: readBack, info } = await loadSchematic(file, 'Drawn')

    // Three wide, two deep, and the empty layers gone: two high, not five.
    expect(blueprintSize(readBack)).toEqual({ width: 3, depth: 2, height: 2 })
    expect(blueprintSize(readBack)).toEqual(blueprintSize(built))

    // And every block came back, block for block.
    const before = [...billOfMaterials(built)].sort()
    expect([...billOfMaterials(readBack)].sort()).toEqual(before)
    expect(info.blockCount).toBe(cells.length)
  })
})
