/**
 * Banner designs, and how to draw one.
 *
 * A Minecraft banner is not a picture — it is a base colour plus up to six
 * pattern layers, each tinted with a dye. That is why a language model with no
 * ability to draw can still design one: the design is structured data, and the
 * drawing is arithmetic done here from the game's own artwork in `bannerArt.ts`.
 *
 * The same design feeds all three outputs. Draw it small and it is the banner
 * block; draw it into a square and it is the server icon; draw it wide and it is
 * the listing image. Designing once and rendering three times is the whole point
 * of keeping the design as data rather than as pixels.
 */
import {
  BANNER_HEIGHT,
  BANNER_MASKS,
  BANNER_SHADING,
  BANNER_WIDTH,
  DYES,
  DYE_NAMES,
  LOOM_PATTERNS,
  SPECIAL_PATTERNS
} from './bannerArt'

export { BANNER_WIDTH, BANNER_HEIGHT, DYES, DYE_NAMES, LOOM_PATTERNS, SPECIAL_PATTERNS }

/**
 * The loom's limit, and so the designer's.
 *
 * The game will render more than six layers if something writes them directly,
 * but a banner nobody can reproduce at a loom is a picture of a banner rather
 * than a banner. Six is what a player can actually make.
 */
export const MAX_LAYERS = 6

export interface BannerLayer {
  pattern: string
  colour: string
}

export interface BannerDesign {
  name: string
  base: string
  layers: BannerLayer[]
}

/* ------------------------------------------------------------- validation */

export function isDye(value: unknown): value is string {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(DYES, value)
}

export function isPattern(value: unknown): value is string {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(BANNER_MASKS, value)
}

/**
 * Turns whatever a model returned into a design, or gives up.
 *
 * Models invent pattern names — `diagonal`, `stripe`, `chevron` — and they
 * invent colours. Rendering an invented name would crash, and quietly dropping
 * it would hand back a design that is not the one described. So unknown layers
 * are dropped and counted, and the caller is told, rather than either.
 */
export function readDesign(raw: unknown): { design: BannerDesign; dropped: string[] } | null {
  if (!raw || typeof raw !== 'object') return null
  const source = raw as Record<string, unknown>

  const base = typeof source.base === 'string' ? source.base.replace(/^minecraft:/, '') : ''
  if (!isDye(base)) return null

  const dropped: string[] = []
  const layers: BannerLayer[] = []

  const rawLayers = Array.isArray(source.layers) ? source.layers : []
  for (const entry of rawLayers) {
    if (!entry || typeof entry !== 'object') continue
    const layer = entry as Record<string, unknown>

    const pattern =
      typeof layer.pattern === 'string' ? layer.pattern.replace(/^minecraft:/, '') : ''
    // Models spell it both ways, and neither is worth failing over.
    const colourish = layer.colour ?? layer.color
    const colour = typeof colourish === 'string' ? colourish.replace(/^minecraft:/, '') : ''

    if (!isPattern(pattern) || !isDye(colour)) {
      dropped.push(`${pattern || '?'}/${colour || '?'}`)
      continue
    }
    if (layers.length < MAX_LAYERS) layers.push({ pattern, colour })
  }

  const name =
    typeof source.name === 'string' && source.name.trim() ? source.name.trim().slice(0, 48) : 'Banner'

  return { design: { name, base, layers }, dropped }
}

/* -------------------------------------------------------------- designers */

/**
 * A language model the banner tab can design with.
 *
 * These are the companions the user already configured, rather than a separate
 * provider setup - so `ready` carries why one cannot be used, and the tab can
 * say so instead of failing when it is picked.
 */
export interface BannerBrain {
  id: string
  label: string
  provider: string
  model: string
  ready: boolean
  reason: string
}

/**
 * What a model is told before it is asked for a banner.
 *
 * The vocabulary is listed rather than assumed. Left to themselves models name
 * patterns that sound right - chevron, diagonal, stripe - and the design then
 * has to be thrown away; spelling out the real ids costs a few hundred tokens
 * and turns a coin flip into a formality.
 *
 * Lives here, next to the lists it quotes, so that changing the vocabulary
 * cannot leave the instructions describing an older one.
 */
export function designerPrompt(): string {
  return [
    'You design Minecraft banners. Answer with one JSON object and nothing else.',
    '',
    'Shape: {"name":"<short name>","base":"<dye>","layers":[{"pattern":"<id>","colour":"<dye>"}]}',
    '',
    `Dyes (use these exact names): ${DYE_NAMES.join(', ')}`,
    '',
    `Patterns (use these exact ids): ${LOOM_PATTERNS.join(', ')}`,
    '',
    `Use at most ${MAX_LAYERS} layers. Layers stack in order, first at the back.`,
    'Do not invent names. Do not add commentary, explanation or code fences.'
  ].join('\n')
}

/* ---------------------------------------------------------------- drawing */

/**
 * Base64 to bytes, in both the sandboxed renderer and the main process.
 *
 * `atob` is a global in a browser and in Node since 16, so this is the one path
 * in practice. The fallback decodes by hand rather than reaching for `Buffer`,
 * which does not exist in the renderer's type environment and would make this
 * shared file compile in only one of the two builds that use it.
 */
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function bytes(encoded: string): Uint8Array {
  const decoder = (globalThis as { atob?: (input: string) => string }).atob

  if (decoder) {
    const binary = decoder(encoded)
    const out = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
    return out
  }

  const clean = encoded.replace(/=+$/, '')
  const out = new Uint8Array((clean.length * 3) >> 2)

  let held = 0
  let bits = 0
  let at = 0

  for (const ch of clean) {
    const value = B64.indexOf(ch)
    if (value < 0) continue

    held = (held << 6) | value
    bits += 6

    if (bits >= 8) {
      bits -= 8
      out[at++] = (held >> bits) & 0xff
    }
  }

  return out
}

let shadingCache: Uint8Array | null = null
const maskCache = new Map<string, Uint8Array>()

function shading(): Uint8Array {
  if (!shadingCache) shadingCache = bytes(BANNER_SHADING)
  return shadingCache
}

function mask(pattern: string): Uint8Array | null {
  const cached = maskCache.get(pattern)
  if (cached) return cached
  const encoded = BANNER_MASKS[pattern]
  if (!encoded) return null
  const decoded = bytes(encoded)
  maskCache.set(pattern, decoded)
  return decoded
}

function rgb(hexish: string): [number, number, number] {
  return [
    parseInt(hexish.slice(1, 3), 16),
    parseInt(hexish.slice(3, 5), 16),
    parseInt(hexish.slice(5, 7), 16)
  ]
}

/**
 * The banner's front face, 20x40, as RGBA.
 *
 * This is what the game does: each layer is a dye tinted by the cloth's own
 * shading, composited over what is beneath it by the pattern's alpha. The base
 * cloth is fully opaque — checked against the texture, every pixel of the front
 * face is alpha 255 — so the result never has holes in it.
 */
export function renderBanner(design: BannerDesign): Uint8ClampedArray {
  const shade = shading()
  const pixels = BANNER_WIDTH * BANNER_HEIGHT
  const out = new Uint8ClampedArray(pixels * 4)

  const [br, bg, bb] = rgb(DYES[design.base] ?? DYES.white)

  for (let i = 0; i < pixels; i++) {
    const lit = shade[i] / 255
    out[i * 4] = br * lit
    out[i * 4 + 1] = bg * lit
    out[i * 4 + 2] = bb * lit
    out[i * 4 + 3] = 255
  }

  for (const layer of design.layers) {
    const alpha = mask(layer.pattern)
    if (!alpha) continue
    const [lr, lg, lb] = rgb(DYES[layer.colour] ?? DYES.white)

    for (let i = 0; i < pixels; i++) {
      const a = alpha[i] / 255
      if (a === 0) continue
      const lit = shade[i] / 255
      out[i * 4] = out[i * 4] * (1 - a) + lr * lit * a
      out[i * 4 + 1] = out[i * 4 + 1] * (1 - a) + lg * lit * a
      out[i * 4 + 2] = out[i * 4 + 2] * (1 - a) + lb * lit * a
    }
  }

  return out
}

/* --------------------------------------------------------------- commands */

/**
 * The command that puts this banner in somebody's hand.
 *
 * Item components, which is 1.20.5 and later. The older `BlockEntityTag` form
 * needs two-letter pattern codes and numeric colours, and would silently
 * produce a plain banner on a modern server rather than failing — so callers
 * check the version instead of guessing, and `supportsGive` is what they ask.
 */
export function giveCommand(design: BannerDesign, target: string): string {
  const patterns = design.layers
    .map((l) => `{pattern:"minecraft:${l.pattern}",color:"${l.colour}"}`)
    .join(',')

  const item = `minecraft:${design.base}_banner`
  const components = patterns ? `[minecraft:banner_patterns=[${patterns}]]` : ''

  return `give ${target} ${item}${components} 1`
}

/** Whether a server new enough for the component syntax above. */
export function supportsGive(version: string): boolean {
  const parts = /^(\d+)\.(\d+)(?:\.(\d+))?/.exec(version.trim())
  if (!parts) return false

  const major = Number(parts[1])
  const minor = Number(parts[2])
  const patch = Number(parts[3] ?? 0)

  if (major !== 1) return major > 1
  if (minor !== 20) return minor > 20
  return patch >= 5
}

/* ------------------------------------------------------------------- text */

/** `stripe_top` as `Stripe top`, for a label. */
export function patternLabel(pattern: string): string {
  return pattern.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
}

export function dyeLabel(dye: string): string {
  return patternLabel(dye)
}

/** A design in one line, for a tooltip or a log. */
export function describeDesign(design: BannerDesign): string {
  if (!design.layers.length) return `plain ${dyeLabel(design.base).toLowerCase()}`
  const layers = design.layers
    .map((l) => `${dyeLabel(l.colour).toLowerCase()} ${patternLabel(l.pattern).toLowerCase()}`)
    .join(', ')
  return `${dyeLabel(design.base).toLowerCase()} base with ${layers}`
}
