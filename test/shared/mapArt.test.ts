import { describe, expect, it } from 'vitest'
import {
  BASE_COLOURS,
  MAP_SIZE,
  SHADES,
  nearest,
  palette,
  swatchOf,
  tiles,
  toMapBytes
} from '../../src/shared/mapArt'

describe('the palette', () => {
  it('has the 62 base colours the game has', () => {
    expect(BASE_COLOURS).toHaveLength(62)
  })

  it('gives four shades of every base except the transparent one', () => {
    expect(palette()).toHaveLength(61 * SHADES.length)
  })

  /*
   * Spot checks against colours anybody can name from the game. If the table
   * were shifted by a row - the easy way to get a hand-entered list wrong -
   * these are what would catch it.
   */
  it('has grass green, water blue and snow white where they belong', () => {
    expect(BASE_COLOURS[1]).toEqual([127, 178, 56])
    expect(BASE_COLOURS[12]).toEqual([64, 64, 255])
    expect(BASE_COLOURS[8]).toEqual([255, 255, 255])
  })

  it('never writes a byte the game has no colour for', () => {
    for (const swatch of palette()) {
      expect(swatch.byte).toBeGreaterThanOrEqual(4)
      expect(swatch.byte).toBeLessThan(BASE_COLOURS.length * 4)
      expect(swatchOf(swatch.byte)).not.toBeNull()
    }
  })

  it('reads a byte back to the colour it was built from', () => {
    for (const swatch of palette()) {
      expect(swatchOf(swatch.byte)).toEqual({ r: swatch.r, g: swatch.g, b: swatch.b })
    }
  })

  it('shades each base from darkest to brightest and back down', () => {
    // 135 is dimmer than 180, so the fourth shade is the darkest of the four.
    expect(SHADES[3]).toBeLessThan(SHADES[0])
    expect(SHADES[2]).toBe(255)
  })
})

describe('matching', () => {
  it('picks white for white and black for black', () => {
    const swatches = palette()

    const white = nearest(swatches, 255, 255, 255)
    const black = nearest(swatches, 0, 0, 0)

    expect(white.r).toBeGreaterThan(240)
    expect(black.r).toBeLessThan(40)
  })

  it('picks something recognisably red for red', () => {
    const red = nearest(palette(), 255, 0, 0)

    expect(red.r).toBeGreaterThan(red.g + 60)
    expect(red.r).toBeGreaterThan(red.b + 60)
  })
})

describe('converting', () => {
  const solid = (w: number, h: number, r: number, g: number, b: number, a = 255): number[] => {
    const out: number[] = []
    for (let i = 0; i < w * h; i++) out.push(r, g, b, a)
    return out
  }

  it('gives one byte per pixel', () => {
    const bytes = toMapBytes(solid(8, 4, 200, 30, 30), 8, 4, { dither: false })
    expect(bytes).toHaveLength(32)
  })

  it('turns a transparent pixel into a hole, not a black square', () => {
    const bytes = toMapBytes(solid(2, 1, 0, 0, 0, 0), 2, 1, { dither: false })
    expect([...bytes]).toEqual([0, 0])
  })

  it('gives a flat colour the same byte everywhere when not dithering', () => {
    const bytes = toMapBytes(solid(6, 6, 127, 178, 56), 6, 6, { dither: false })
    expect(new Set(bytes).size).toBe(1)
  })

  it('never emits a byte outside the palette, dithered or not', () => {
    for (const dither of [true, false]) {
      const noisy: number[] = []
      for (let i = 0; i < 32 * 32; i++) {
        noisy.push((i * 37) % 256, (i * 91) % 256, (i * 13) % 256, 255)
      }

      for (const byte of toMapBytes(noisy, 32, 32, { dither })) {
        expect(byte === 0 || swatchOf(byte) !== null).toBe(true)
      }
    }
  })
})

describe('tiling', () => {
  it('cuts a wall into whole maps of the right size', () => {
    const width = MAP_SIZE * 2
    const height = MAP_SIZE * 1

    const bytes = new Uint8Array(width * height).fill(8)
    const cut = tiles(bytes, width, 2, 1)

    expect(cut).toHaveLength(2)
    for (const tile of cut) expect(tile).toHaveLength(MAP_SIZE * MAP_SIZE)
  })

  it('takes each tile from its own part of the picture', () => {
    const width = MAP_SIZE * 2
    const bytes = new Uint8Array(width * MAP_SIZE)

    // Left half one colour, right half another.
    for (let y = 0; y < MAP_SIZE; y++) {
      for (let x = 0; x < width; x++) bytes[y * width + x] = x < MAP_SIZE ? 8 : 12
    }

    const [left, right] = tiles(bytes, width, 2, 1)

    expect(new Set(left)).toEqual(new Set([8]))
    expect(new Set(right)).toEqual(new Set([12]))
  })
})
