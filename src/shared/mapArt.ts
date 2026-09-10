/**
 * Turning a picture into Minecraft map art.
 *
 * A map item holds 128x128 bytes, one per pixel, and each byte is an index into
 * a fixed palette the game has built in. So the whole job is choosing, for every
 * pixel of an image, which of those palette entries is closest - and then
 * writing the bytes into a map file the world already knows how to read.
 *
 * The matching lives here rather than in the main process because it is pure
 * arithmetic over an array, which makes it testable without a world, a jar or a
 * canvas anywhere near it.
 */

/**
 * Minecraft's base map colours, in palette order.
 *
 * These are the game's own MapColor table. They are hardcoded because they live
 * in Minecraft's code rather than in any data file in the jar - there is nothing
 * to read them from, so the only options are this or getting them wrong.
 *
 * The index into this array is the "base" colour; the byte written into a map is
 * `base * 4 + shade`, which is why the palette is 62 * 4 entries.
 */
export const BASE_COLOURS: [number, number, number][] = [
  [0, 0, 0], // 0  none - never written, and transparent in game
  [127, 178, 56], // 1  grass
  [247, 233, 163], // 2  sand
  [199, 199, 199], // 3  wool
  [255, 0, 0], // 4  fire
  [160, 160, 255], // 5  ice
  [167, 167, 167], // 6  metal
  [0, 124, 0], // 7  plant
  [255, 255, 255], // 8  snow
  [164, 168, 184], // 9  clay
  [151, 109, 77], // 10 dirt
  [112, 112, 112], // 11 stone
  [64, 64, 255], // 12 water
  [143, 119, 72], // 13 wood
  [255, 252, 245], // 14 quartz
  [216, 127, 51], // 15 orange
  [178, 76, 216], // 16 magenta
  [102, 153, 216], // 17 light blue
  [229, 229, 51], // 18 yellow
  [127, 204, 25], // 19 lime
  [242, 127, 165], // 20 pink
  [76, 76, 76], // 21 gray
  [153, 153, 153], // 22 light gray
  [76, 127, 153], // 23 cyan
  [127, 63, 178], // 24 purple
  [51, 76, 178], // 25 blue
  [102, 76, 51], // 26 brown
  [102, 127, 51], // 27 green
  [153, 51, 51], // 28 red
  [25, 25, 25], // 29 black
  [250, 238, 77], // 30 gold
  [92, 219, 213], // 31 diamond
  [74, 128, 255], // 32 lapis
  [0, 217, 58], // 33 emerald
  [129, 86, 49], // 34 podzol
  [112, 2, 0], // 35 nether
  [209, 177, 161], // 36 white terracotta
  [159, 82, 36], // 37 orange terracotta
  [149, 87, 108], // 38 magenta terracotta
  [112, 108, 138], // 39 light blue terracotta
  [186, 133, 36], // 40 yellow terracotta
  [103, 117, 53], // 41 lime terracotta
  [160, 77, 78], // 42 pink terracotta
  [57, 41, 35], // 43 gray terracotta
  [135, 107, 98], // 44 light gray terracotta
  [87, 92, 92], // 45 cyan terracotta
  [122, 73, 88], // 46 purple terracotta
  [76, 62, 92], // 47 blue terracotta
  [76, 50, 35], // 48 brown terracotta
  [76, 82, 42], // 49 green terracotta
  [142, 60, 46], // 50 red terracotta
  [37, 22, 16], // 51 black terracotta
  [189, 48, 49], // 52 crimson nylium
  [148, 63, 97], // 53 crimson stem
  [92, 25, 29], // 54 crimson hyphae
  [22, 126, 134], // 55 warped nylium
  [58, 142, 140], // 56 warped stem
  [86, 44, 62], // 57 warped hyphae
  [20, 180, 133], // 58 warped wart block
  [100, 100, 100], // 59 deepslate
  [216, 175, 147], // 60 raw iron
  [127, 167, 150] // 61 glow lichen
]

/**
 * The four brightnesses each base colour comes in.
 *
 * Which one a block shows depends on the height of the ground north of it, so
 * on a flat wall of blocks only one of them appears - but a map file may hold
 * any of them, and using all four is what gives map art its range.
 */
export const SHADES = [180, 220, 255, 135]

/** How wide and tall one map is, in pixels. */
export const MAP_SIZE = 128

/** One palette entry: the byte to write, and what it looks like. */
export interface Swatch {
  byte: number
  r: number
  g: number
  b: number
}

/**
 * Every colour a map can show.
 *
 * Base zero is left out on purpose. It is the "nothing here" entry and renders
 * transparent, so allowing it would let a dark pixel match to a hole in the
 * picture.
 */
export function palette(): Swatch[] {
  const out: Swatch[] = []

  for (let base = 1; base < BASE_COLOURS.length; base++) {
    const [r, g, b] = BASE_COLOURS[base]

    for (let shade = 0; shade < SHADES.length; shade++) {
      const scale = SHADES[shade]

      out.push({
        byte: base * 4 + shade,
        r: Math.round((r * scale) / 255),
        g: Math.round((g * scale) / 255),
        b: Math.round((b * scale) / 255)
      })
    }
  }

  return out
}

/**
 * How far apart two colours look, roughly.
 *
 * Weighted towards green because eyes are, which stops skies matching to
 * purple and skin matching to green - the two mistakes a plain sum of squares
 * makes most obviously.
 */
function distance(swatch: Swatch, r: number, g: number, b: number): number {
  const dr = swatch.r - r
  const dg = swatch.g - g
  const db = swatch.b - b

  return dr * dr * 2 + dg * dg * 4 + db * db * 3
}

export function nearest(swatches: Swatch[], r: number, g: number, b: number): Swatch {
  let best = swatches[0]
  let closest = Number.MAX_VALUE

  for (const swatch of swatches) {
    const away = distance(swatch, r, g, b)
    if (away >= closest) continue

    closest = away
    best = swatch
  }

  return best
}

export interface ConvertOptions {
  /** Spread the error into neighbouring pixels, which reads as more colours. */
  dither: boolean
}

/**
 * Turns RGBA pixels into the bytes a map file holds.
 *
 * @param rgba  four bytes per pixel, as a canvas gives them
 * @param width  in pixels; the height follows from the length
 *
 * Dithering is Floyd-Steinberg. Without it a photograph turns into flat bands,
 * because 248 colours is not many and a sky is mostly one of them; with it the
 * same sky reads as a gradient from a few blocks away.
 */
export function toMapBytes(
  rgba: Uint8ClampedArray | number[],
  width: number,
  height: number,
  options: ConvertOptions = { dither: true }
): Uint8Array {
  const swatches = palette()
  const out = new Uint8Array(width * height)

  // A working copy in floats, so error spread does not clip on every step.
  const work = new Float32Array(width * height * 3)
  for (let i = 0; i < width * height; i++) {
    work[i * 3] = rgba[i * 4]
    work[i * 3 + 1] = rgba[i * 4 + 1]
    work[i * 3 + 2] = rgba[i * 4 + 2]
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = y * width + x

      /*
       * A transparent pixel becomes a hole rather than a black square.
       *
       * Byte zero is the palette's "nothing here", which is exactly what the
       * transparent part of a logo should be - and the alternative, matching
       * it as if it were black, puts a black box around every cut-out image.
       */
      if (rgba[at * 4 + 3] < 128) {
        out[at] = 0
        continue
      }

      const r = work[at * 3]
      const g = work[at * 3 + 1]
      const b = work[at * 3 + 2]

      const chosen = nearest(swatches, r, g, b)
      out[at] = chosen.byte

      if (!options.dither) continue

      const errR = r - chosen.r
      const errG = g - chosen.g
      const errB = b - chosen.b

      const spread = (dx: number, dy: number, amount: number): void => {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || nx >= width || ny >= height) return

        const to = (ny * width + nx) * 3
        work[to] += errR * amount
        work[to + 1] += errG * amount
        work[to + 2] += errB * amount
      }

      spread(1, 0, 7 / 16)
      spread(-1, 1, 3 / 16)
      spread(0, 1, 5 / 16)
      spread(1, 1, 1 / 16)
    }
  }

  return out
}

/**
 * Splits a wall of maps into single maps.
 *
 * Map art bigger than one map is several maps in item frames, so the image is
 * cut into 128 by 128 tiles and each becomes its own file. Returned in reading
 * order, which is the order the frames go up in.
 */
export function tiles(
  bytes: Uint8Array,
  width: number,
  across: number,
  down: number
): Uint8Array[] {
  const out: Uint8Array[] = []

  for (let ty = 0; ty < down; ty++) {
    for (let tx = 0; tx < across; tx++) {
      const tile = new Uint8Array(MAP_SIZE * MAP_SIZE)

      for (let y = 0; y < MAP_SIZE; y++) {
        for (let x = 0; x < MAP_SIZE; x++) {
          const from = (ty * MAP_SIZE + y) * width + (tx * MAP_SIZE + x)
          tile[y * MAP_SIZE + x] = bytes[from] ?? 0
        }
      }

      out.push(tile)
    }
  }

  return out
}

/** The colour a byte shows as, for drawing a preview of the result. */
export function swatchOf(byte: number): { r: number; g: number; b: number } | null {
  if (byte < 4) return null

  const base = byte >> 2
  const shade = byte & 3

  const rgb = BASE_COLOURS[base]
  if (!rgb) return null

  const scale = SHADES[shade]

  return {
    r: Math.round((rgb[0] * scale) / 255),
    g: Math.round((rgb[1] * scale) / 255),
    b: Math.round((rgb[2] * scale) / 255)
  }
}
