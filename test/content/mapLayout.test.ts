import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mapLayout } from '../../src/main/services/content/mapArtService'

/**
 * Where map files go, which nothing else can tell you.
 *
 * 26 moved saved data into a namespaced folder, and getting this wrong is the
 * worst kind of wrong: the write succeeds, the give succeeds, the item frame
 * holds a genuine filled map, and the server logs nothing at all. The only
 * symptom is that every frame on the wall shows the rolled-up map icon instead
 * of the picture, because the server never loaded an id it was never asked for
 * from a folder it does not read.
 *
 * These paths were read out of paper-26.2.jar rather than remembered:
 * `MapId.key()` concatenates "maps/" with the id, `SavedDataStorage` resolves
 * that against the data folder by namespace and appends ".dat", and `MapIndex`
 * names its counter "maps/last_id".
 */

let data: string

beforeEach(() => {
  data = mkdtempSync(join(tmpdir(), 'maplayout-'))
})

afterEach(() => {
  rmSync(data, { recursive: true, force: true })
})

describe('reading the layout off a world that has run', () => {
  it('takes a minecraft folder as namespaced, whatever the version says', () => {
    mkdirSync(join(data, 'minecraft'))
    writeFileSync(join(data, 'minecraft', 'scoreboard.dat'), '')

    // Deliberately an old version string: the world outranks the guess.
    const layout = mapLayout(data, '1.21.11')

    expect(layout.namespaced).toBe(true)
    expect(layout.mapFile(7)).toBe(join(data, 'minecraft', 'maps', '7.dat'))
    expect(layout.counter).toBe(join(data, 'minecraft', 'maps', 'last_id.dat'))
  })

  it('takes loose saved data as flat, whatever the version says', () => {
    writeFileSync(join(data, 'scoreboard.dat'), '')

    const layout = mapLayout(data, '26.2')

    expect(layout.namespaced).toBe(false)
    expect(layout.mapFile(7)).toBe(join(data, 'map_7.dat'))
    expect(layout.counter).toBe(join(data, 'idcounts.dat'))
  })

  it('recognises a world that only has an old id counter', () => {
    writeFileSync(join(data, 'idcounts.dat'), '')
    expect(mapLayout(data, '26.2').namespaced).toBe(false)
  })

  it('recognises a world that only has random sequences', () => {
    writeFileSync(join(data, 'random_sequences.dat'), '')
    expect(mapLayout(data, '26.2').namespaced).toBe(false)
  })
})

describe('falling back to the version for a world that has never run', () => {
  it('puts 26 and above in the namespaced folder', () => {
    expect(mapLayout(data, '26.2').namespaced).toBe(true)
    expect(mapLayout(data, '27.0').namespaced).toBe(true)
  })

  it('leaves 1.21 and below flat', () => {
    expect(mapLayout(data, '1.21.11').namespaced).toBe(false)
    expect(mapLayout(data, '1.20.4').namespaced).toBe(false)
    expect(mapLayout(data, '1.8.9').namespaced).toBe(false)
  })

  it('treats a version it cannot read as the older layout', () => {
    // Guessing new would write somewhere an old server never reads, and the
    // failure is silent; guessing old at worst writes a file nothing uses.
    expect(mapLayout(data, 'fabric-loader-0.16.5').namespaced).toBe(false)
    expect(mapLayout(data, '').namespaced).toBe(false)
  })
})

describe('the folder that has to exist before writing', () => {
  it('is the maps folder when namespaced', () => {
    expect(mapLayout(data, '26.2').folder).toBe(join(data, 'minecraft', 'maps'))
  })

  it('is the data folder itself when flat', () => {
    expect(mapLayout(data, '1.21.11').folder).toBe(data)
  })
})
