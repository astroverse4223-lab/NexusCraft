/**
 * Restyling textures that already exist.
 *
 * A language model cannot see a picture and it cannot paint one. What it can do
 * is say how a picture should change - "colder, bluer, harder edges" - and that
 * is a recipe, which is a short list of numbers. The code then applies those
 * numbers to the real pixels of the real texture.
 *
 * Which is the whole difference between this and asking a model for art: the
 * texture keeps every detail Mojang drew, and only its colour and contrast are
 * moved. A thousand blocks restyled the same way is a coherent pack; a thousand
 * blocks redrawn by a model that cannot draw is a thousand missing textures.
 */

export interface TextureRecipe {
  /** What to call it, so a recipe can be kept and used again. */
  name: string
  /** Degrees around the colour wheel, -180 to 180. */
  hue: number
  /** Multiplier on colourfulness. 0 is grey, 1 is unchanged, 2 is lurid. */
  saturation: number
  /** Multiplier on lightness. */
  brightness: number
  /** Multiplier on the distance from mid grey. */
  contrast: number
  /** A colour washed over everything, and how strongly. */
  tint: string
  tintStrength: number
  /** How many levels each channel is squashed to. 0 leaves it alone. */
  posterise: number
  /** Speckle, 0 to 1, for wear and grain. */
  grain: number
  /** Darkens pixels that sit next to a very different one, 0 to 1. */
  outline: number
}

export function plainRecipe(): TextureRecipe {
  return {
    name: 'Unchanged',
    hue: 0,
    saturation: 1,
    brightness: 1,
    contrast: 1,
    tint: '#ffffff',
    tintStrength: 0,
    posterise: 0,
    grain: 0,
    outline: 0
  }
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const clamp = (v: number, low: number, high: number): number =>
  Math.max(low, Math.min(high, v))

/**
 * What a model is told before it is asked for a recipe.
 *
 * Beside the reader below, so the vocabulary described and the vocabulary
 * accepted cannot drift apart - the same reason the icon prompt lives beside
 * its own reader.
 */
export function recipePrompt(): string {
  return [
    'You restyle Minecraft textures by describing an adjustment, not by drawing.',
    'Answer with JSON only, no prose, in exactly this shape:',
    '{"name":"Frostbitten","hue":-20,"saturation":0.6,"brightness":1.1,'
      + '"contrast":1.2,"tint":"#bcd8ff","tintStrength":0.35,"posterise":0,'
      + '"grain":0.05,"outline":0.2}',
    '',
    'hue: -180 to 180, degrees to rotate every colour.',
    'saturation: 0 to 2. Below 1 drains colour, above 1 deepens it.',
    'brightness: 0.4 to 1.8.',
    'contrast: 0.5 to 2.',
    'tint: a #rrggbb colour washed over everything.',
    'tintStrength: 0 to 1. Use 0 for no wash.',
    'posterise: 0 to leave alone, or 2 to 12 to flatten into bands.',
    'grain: 0 to 0.4. Speckle, for wear and age.',
    'outline: 0 to 1. Darkens the edges inside the picture.',
    '',
    'The texture keeps its shape and detail - you are only moving its colour.',
    'Be bold enough to be visible. A recipe that changes nothing is no use.'
  ].join('\n')
}

/** A model's answer, or null when it is not one. */
export function readRecipe(raw: unknown): TextureRecipe | null {
  if (!raw || typeof raw !== 'object') return null

  const got = raw as Record<string, unknown>
  const base = plainRecipe()

  const tint =
    typeof got.tint === 'string' && /^#[0-9a-f]{6}$/i.test(got.tint) ? got.tint : base.tint

  const recipe: TextureRecipe = {
    name: typeof got.name === 'string' && got.name.trim()
      ? got.name.trim().slice(0, 40)
      : 'Restyled',
    hue: num(got.hue) ? clamp(got.hue, -180, 180) : 0,
    saturation: num(got.saturation) ? clamp(got.saturation, 0, 2) : 1,
    brightness: num(got.brightness) ? clamp(got.brightness, 0.4, 1.8) : 1,
    contrast: num(got.contrast) ? clamp(got.contrast, 0.5, 2) : 1,
    tint,
    tintStrength: num(got.tintStrength) ? clamp(got.tintStrength, 0, 1) : 0,
    posterise: num(got.posterise) ? Math.round(clamp(got.posterise, 0, 12)) : 0,
    grain: num(got.grain) ? clamp(got.grain, 0, 0.4) : 0,
    outline: num(got.outline) ? clamp(got.outline, 0, 1) : 0
  }

  /*
   * A recipe that changes nothing is refused rather than returned.
   *
   * The model sometimes answers with every field at its default, which applies
   * cleanly and does nothing at all - and "it worked but looks identical" is
   * the hardest kind of failure to tell from a bug.
   */
  const moves =
    Math.abs(recipe.hue) > 1 ||
    Math.abs(recipe.saturation - 1) > 0.05 ||
    Math.abs(recipe.brightness - 1) > 0.05 ||
    Math.abs(recipe.contrast - 1) > 0.05 ||
    recipe.tintStrength > 0.02 ||
    recipe.posterise > 0 ||
    recipe.grain > 0.01 ||
    recipe.outline > 0.02

  return moves ? recipe : null
}

/** A few worth having without asking a model at all. */
export const RECIPE_PRESETS: TextureRecipe[] = [
  { ...plainRecipe(), name: 'Frostbitten', hue: -18, saturation: 0.55, brightness: 1.12,
    contrast: 1.15, tint: '#bcd8ff', tintStrength: 0.35, outline: 0.18 },
  { ...plainRecipe(), name: 'Scorched', hue: 12, saturation: 1.25, brightness: 0.82,
    contrast: 1.3, tint: '#ff6a2a', tintStrength: 0.22, grain: 0.08, outline: 0.25 },
  { ...plainRecipe(), name: 'Faded', saturation: 0.35, brightness: 1.08, contrast: 0.85,
    tint: '#e8e2d2', tintStrength: 0.2, grain: 0.05 },
  { ...plainRecipe(), name: 'Neon', saturation: 1.9, brightness: 1.15, contrast: 1.45,
    posterise: 5, outline: 0.35 },
  { ...plainRecipe(), name: 'Storybook', saturation: 1.15, brightness: 1.1, contrast: 0.9,
    posterise: 6, outline: 0.4 },
  { ...plainRecipe(), name: 'Cursed', hue: 96, saturation: 0.8, brightness: 0.75,
    contrast: 1.35, tint: '#5a2a8a', tintStrength: 0.3, grain: 0.12, outline: 0.3 },
  { ...plainRecipe(), name: 'Gilded', hue: -8, saturation: 1.35, brightness: 1.18,
    contrast: 1.2, tint: '#ffc94a', tintStrength: 0.3, outline: 0.2 },
  { ...plainRecipe(), name: 'Ashen', saturation: 0.12, brightness: 0.9, contrast: 1.25,
    grain: 0.1, outline: 0.22 }
]
