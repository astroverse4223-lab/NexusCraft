import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))

import { writeMapArtToServer } from '../../src/main/services/content/mapArtService'

/**
 * The whole write, end to end, into a world shaped like a real one.
 *
 * The layout unit test checks which folder is chosen; this checks that a map
 * actually lands in it, that the ids do not collide with what is already
 * there, and that the bytes read back as a locked map. Between them they cover
 * the failure that shipped: every file written correctly, to a folder the
 * server does not read, with nothing in any log to say so.
 */

const nbt = require('prismarine-nbt')

const SIZE = 128 * 128

let root: string

/** A world folder the way a server leaves one. */
function makeWorld(dataVersion: number, namespaced: boolean): string {
  const world = join(root, 'world')
  const data = join(world, 'data')
  mkdirSync(data, { recursive: true })

  const level = nbt.comp({ Data: nbt.comp({ DataVersion: nbt.int(dataVersion) }) })
  writeFileSync(
    join(world, 'level.dat'),
    gzipSync(nbt.writeUncompressed({ ...level, name: '' } as never))
  )

  if (namespaced) {
    mkdirSync(join(data, 'minecraft'), { recursive: true })
    writeFileSync(join(data, 'minecraft', 'scoreboard.dat'), '')
  } else {
    writeFileSync(join(data, 'scoreboard.dat'), '')
  }

  return world
}

function tile(fill: number): number[] {
  return new Array(SIZE).fill(fill)
}

function readMap(file: string): Record<string, unknown> {
  const parsed = nbt.parseUncompressed(
    require('node:zlib').gunzipSync(readFileSync(file)),
    'big'
  )
  return nbt.simplify(parsed).data as Record<string, unknown>
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mapwrite-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('writing into a 26 world', () => {
  it('puts the maps where the server reads them', async () => {
    makeWorld(4903, true)

    const result = await writeMapArtToServer(root, 'world', '26.2', [tile(4), tile(5)], 2, 1)

    const maps = join(root, 'world', 'data', 'minecraft', 'maps')
    expect(existsSync(join(maps, `${result.ids[0]}.dat`))).toBe(true)
    expect(existsSync(join(maps, `${result.ids[1]}.dat`))).toBe(true)
    expect(existsSync(join(maps, 'last_id.dat'))).toBe(true)

    // And not where they used to go, which is the bug this replaced.
    expect(existsSync(join(root, 'world', 'data', `map_${result.ids[0]}.dat`))).toBe(false)
  })

  it('writes a locked map of the right size', async () => {
    makeWorld(4903, true)

    const result = await writeMapArtToServer(root, 'world', '26.2', [tile(9)], 1, 1)

    const body = readMap(
      join(root, 'world', 'data', 'minecraft', 'maps', `${result.ids[0]}.dat`)
    ) as { colors: number[]; locked: number; scale: number }

    expect(body.colors).toHaveLength(SIZE)
    expect(body.locked).toBe(1)
    expect(body.scale).toBe(0)
    expect(body.colors[0]).toBe(9)
  })

  it('moves maps left in the old place across, keeping their ids', async () => {
    makeWorld(4903, true)

    const data = join(root, 'world', 'data')
    writeFileSync(join(data, 'map_20.dat'), 'stale but real')
    writeFileSync(join(data, 'map_21.dat'), 'stale but real')

    const result = await writeMapArtToServer(root, 'world', '26.2', [tile(1)], 1, 1)

    const maps = join(data, 'minecraft', 'maps')
    expect(readFileSync(join(maps, '20.dat'), 'utf8')).toBe('stale but real')
    expect(readFileSync(join(maps, '21.dat'), 'utf8')).toBe('stale but real')

    // And the new map goes after them rather than on top of one.
    expect(result.ids).toEqual([22])
  })

  it('never writes over a map already in the new place', async () => {
    makeWorld(4903, true)

    const data = join(root, 'world', 'data')
    mkdirSync(join(data, 'minecraft', 'maps'), { recursive: true })
    writeFileSync(join(data, 'minecraft', 'maps', '3.dat'), 'the real one')
    writeFileSync(join(data, 'map_3.dat'), 'the stale one')

    const result = await writeMapArtToServer(root, 'world', '26.2', [tile(1)], 1, 1)

    expect(readFileSync(join(data, 'minecraft', 'maps', '3.dat'), 'utf8')).toBe('the real one')
    expect(result.ids).toEqual([4])
  })

  it('hands back component give commands', async () => {
    makeWorld(4903, true)

    const result = await writeMapArtToServer(root, 'world', '26.2', [tile(1)], 1, 1)

    expect(result.commands[0]).toBe(
      `/give @p minecraft:filled_map[minecraft:map_id=${result.ids[0]}]`
    )
  })
})

describe('writing into a 1.21 world', () => {
  it('keeps the old flat names', async () => {
    makeWorld(4671, false)

    const result = await writeMapArtToServer(root, 'world', '1.21.11', [tile(2)], 1, 1)

    const data = join(root, 'world', 'data')
    expect(existsSync(join(data, `map_${result.ids[0]}.dat`))).toBe(true)
    expect(existsSync(join(data, 'idcounts.dat'))).toBe(true)
    expect(existsSync(join(data, 'minecraft', 'maps'))).toBe(false)
  })

  it('carries on from the maps already there', async () => {
    makeWorld(4671, false)

    writeFileSync(join(root, 'world', 'data', 'map_11.dat'), 'already here')

    const result = await writeMapArtToServer(root, 'world', '1.21.11', [tile(2)], 1, 1)

    expect(result.ids).toEqual([12])
  })
})
