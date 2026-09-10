/**
 * Drawing text the way Minecraft draws it.
 *
 * Every glyph is 8x8 and lit or not, so this paints rectangles rather than
 * calling `fillText`. That is the point: at four times the size a real font is
 * smoothed and rounded, and Minecraft's is not, so anything set in a system
 * font reads as a website about Minecraft rather than as Minecraft.
 *
 * Advances come from the game as well, so "ill" is narrow and "WWW" is wide and
 * a centred line is centred where the game would centre it.
 */
import { ADVANCES, GLYPHS, GLYPH_SIZE } from '@shared/mcFont'

let glyphCache: Uint8Array | null = null

function glyphs(): Uint8Array {
  if (glyphCache) return glyphCache

  // Renderer only, so atob is always there - no Node fallback needed.
  const binary = atob(GLYPHS)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  glyphCache = out
  return glyphCache
}

/** How wide a string is, in font pixels, before any scaling. */
export function measure(text: string): number {
  let width = 0
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 32
    width += code < ADVANCES.length ? ADVANCES[code] : 6
  }
  return width
}

export interface TextStyle {
  colour: string
  bold?: boolean
  /** A drop shadow at a quarter brightness, which is what the game does. */
  shadow?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
}

/** The shadow colour Minecraft uses: the same colour at a quarter brightness. */
export function shadowOf(hexish: string): string {
  const channel = (at: number): number =>
    Math.round(parseInt(hexish.slice(at, at + 2), 16) * 0.25)
  return `rgb(${channel(1)}, ${channel(3)}, ${channel(5)})`
}

/**
 * Paints one string and returns how far the cursor moved.
 *
 * `scale` is how many screen pixels one font pixel becomes, so the lettering
 * stays exactly square at any size.
 */
export function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  scale: number,
  style: TextStyle
): number {
  const sheet = glyphs()

  const paint = (offsetX: number, offsetY: number, ink: string): void => {
    ctx.fillStyle = ink
    let cursor = 0

    for (const ch of text) {
      const code = ch.codePointAt(0) ?? 32
      const advance = code < ADVANCES.length ? ADVANCES[code] : 6
      const at = code * GLYPH_SIZE * GLYPH_SIZE

      if (at + GLYPH_SIZE * GLYPH_SIZE <= sheet.length) {
        for (let gy = 0; gy < GLYPH_SIZE; gy++) {
          for (let gx = 0; gx < GLYPH_SIZE; gx++) {
            if (!sheet[at + gy * GLYPH_SIZE + gx]) continue

            /*
             * Italic leans the glyph by shifting each row, which is how the
             * game fakes it - there is no second set of shapes.
             */
            const lean = style.italic ? Math.floor((GLYPH_SIZE - 1 - gy) / 3) : 0

            ctx.fillRect(
              x + offsetX + (cursor + gx + lean) * scale,
              y + offsetY + gy * scale,
              scale,
              scale
            )
            // Bold is the same glyph painted again one pixel right.
            if (style.bold) {
              ctx.fillRect(
                x + offsetX + (cursor + gx + lean + 1) * scale,
                y + offsetY + gy * scale,
                scale,
                scale
              )
            }
          }
        }
      }

      cursor += advance + (style.bold ? 1 : 0)
    }
  }

  if (style.shadow) paint(scale, scale, shadowOf(style.colour))
  paint(0, 0, style.colour)

  const width = measure(text) + (style.bold ? [...text].length : 0)

  if (style.underline || style.strike) {
    ctx.fillStyle = style.colour
    if (style.underline) ctx.fillRect(x, y + GLYPH_SIZE * scale, width * scale, scale)
    if (style.strike) ctx.fillRect(x, y + 3 * scale, width * scale, scale)
  }

  return width * scale
}

/**
 * Paints an outline around text, a pixel thick in every direction.
 *
 * Drawn as the same glyphs offset eight ways rather than as a stroke, because
 * stroking a bitmap gives soft edges and the whole point is that these are not
 * soft.
 */
export function drawOutlined(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  scale: number,
  style: TextStyle,
  outline: string,
  thickness = 1
): number {
  const around: TextStyle = { ...style, colour: outline, shadow: false, underline: false, strike: false }

  for (let dx = -thickness; dx <= thickness; dx++) {
    for (let dy = -thickness; dy <= thickness; dy++) {
      if (dx === 0 && dy === 0) continue
      drawText(ctx, text, x + dx * scale, y + dy * scale, scale, around)
    }
  }

  return drawText(ctx, text, x, y, scale, style)
}
