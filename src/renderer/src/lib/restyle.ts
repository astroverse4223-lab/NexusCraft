import type { TextureRecipe } from '@shared/textureRecipe'

/**
 * Applying a recipe to a texture's actual pixels.
 *
 * Every detail Mojang drew survives - the shape, the shading, the wear on a
 * plank - and only the colour of each pixel moves. That is what makes a
 * restyled pack look like a pack rather than a thousand smudges, and it is why
 * the model is asked for numbers instead of art.
 *
 * Transparency is left exactly alone. A leaf texture is mostly nothing, and a
 * restyle that touched alpha would fill the gaps with tinted fog.
 */

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Straight from the sRGB conversion, kept in 0-1. */
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2

  if (max === min) return [0, 0, l]

  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)

  let h: number
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) h = ((b - r) / d + 2) / 6
  else h = ((r - g) / d + 4) / 6

  return [h, s, l]
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l, l, l]

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q

  const channel = (t: number): number => {
    let v = t
    if (v < 0) v += 1
    if (v > 1) v -= 1
    if (v < 1 / 6) return p + (q - p) * 6 * v
    if (v < 1 / 2) return q
    if (v < 2 / 3) return p + (q - p) * (2 / 3 - v) * 6
    return p
  }

  return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)]
}

/**
 * A texture with the recipe applied, as a png data url.
 *
 * Deterministic on purpose: the same texture and the same recipe produce the
 * same bytes every time, including the grain, which is seeded from the pixel's
 * own position rather than from a random source. A pack that came out slightly
 * different on every build would be a pack whose hash changed for no reason,
 * and the whole delivery system is built on that hash meaning something.
 */
export async function restyle(dataUrl: string, recipe: TextureRecipe): Promise<string> {
  const source = new Image()
  source.src = dataUrl
  await source.decode()

  const canvas = document.createElement('canvas')
  canvas.width = source.width
  canvas.height = source.height

  const ctx = canvas.getContext('2d')
  if (!ctx) return dataUrl

  ctx.drawImage(source, 0, 0)

  const picture = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const px = picture.data

  const [tr, tg, tb] = hexToRgb(recipe.tint)
  const hueTurn = recipe.hue / 360

  // Kept before the loop so outlining reads the original rather than pixels
  // it has already darkened - otherwise the effect creeps inwards.
  const original = recipe.outline > 0.02 ? new Uint8ClampedArray(px) : null

  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] === 0) continue

    let r = px[i] / 255
    let g = px[i + 1] / 255
    let b = px[i + 2] / 255

    if (recipe.hue !== 0 || recipe.saturation !== 1) {
      const [h, s, l] = rgbToHsl(r, g, b)
      const shifted = (h + hueTurn + 1) % 1
      ;[r, g, b] = hslToRgb(shifted, Math.min(1, s * recipe.saturation), l)
    }

    r *= recipe.brightness
    g *= recipe.brightness
    b *= recipe.brightness

    if (recipe.contrast !== 1) {
      r = (r - 0.5) * recipe.contrast + 0.5
      g = (g - 0.5) * recipe.contrast + 0.5
      b = (b - 0.5) * recipe.contrast + 0.5
    }

    if (recipe.tintStrength > 0) {
      const k = recipe.tintStrength
      r = r * (1 - k) + (tr / 255) * k
      g = g * (1 - k) + (tg / 255) * k
      b = b * (1 - k) + (tb / 255) * k
    }

    if (recipe.posterise > 1) {
      const steps = recipe.posterise - 1
      r = Math.round(r * steps) / steps
      g = Math.round(g * steps) / steps
      b = Math.round(b * steps) / steps
    }

    if (recipe.grain > 0) {
      // From the pixel's own index, so the same texture speckles identically
      // every time it is built.
      const seeded = (Math.sin(i * 12.9898) * 43758.5453) % 1
      const shift = (seeded - 0.5) * recipe.grain

      r += shift
      g += shift
      b += shift
    }

    px[i] = Math.round(Math.max(0, Math.min(1, r)) * 255)
    px[i + 1] = Math.round(Math.max(0, Math.min(1, g)) * 255)
    px[i + 2] = Math.round(Math.max(0, Math.min(1, b)) * 255)
  }

  if (original) darkenEdges(px, original, canvas.width, canvas.height, recipe.outline)

  ctx.putImageData(picture, 0, 0)
  return canvas.toDataURL('image/png')
}

/**
 * Darkens a pixel that sits against a very different one.
 *
 * Read from the untouched copy so the darkening does not feed on itself, and
 * skipped entirely at the edge of transparency - outlining against nothing
 * draws a halo round every leaf.
 */
function darkenEdges(
  px: Uint8ClampedArray,
  from: Uint8ClampedArray,
  width: number,
  height: number,
  strength: number
): void {
  const at = (x: number, y: number): number => (y * width + x) * 4

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = at(x, y)
      if (from[i + 3] === 0) continue

      let most = 0

      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1]
      ]) {
        const nx = x + dx
        const ny = y + dy

        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue

        const j = at(nx, ny)
        if (from[j + 3] === 0) continue

        const apart =
          (Math.abs(from[i] - from[j]) +
            Math.abs(from[i + 1] - from[j + 1]) +
            Math.abs(from[i + 2] - from[j + 2])) /
          765

        most = Math.max(most, apart)
      }

      if (most < 0.12) continue

      const k = 1 - most * strength * 0.9

      px[i] = Math.round(px[i] * k)
      px[i + 1] = Math.round(px[i + 1] * k)
      px[i + 2] = Math.round(px[i + 2] * k)
    }
  }
}
