import { describe, expect, it } from 'vitest'
import {
  RECIPE_PRESETS,
  plainRecipe,
  readRecipe,
  recipePrompt
} from '../../src/shared/textureRecipe'

/**
 * What a model is allowed to answer with.
 *
 * These numbers are applied to every pixel of up to a thousand textures, so an
 * out-of-range one is not a bad look - it is a pack of black squares. And an
 * answer that changes nothing has to be refused rather than returned, because
 * "it worked and looks identical" is indistinguishable from a broken feature.
 */
describe('reading a style back', () => {
  it('takes a sensible one', () => {
    const got = readRecipe({
      name: 'Frostbitten',
      hue: -20,
      saturation: 0.6,
      brightness: 1.1,
      contrast: 1.2,
      tint: '#bcd8ff',
      tintStrength: 0.35,
      posterise: 0,
      grain: 0.05,
      outline: 0.2
    })

    expect(got?.name).toBe('Frostbitten')
    expect(got?.hue).toBe(-20)
    expect(got?.tint).toBe('#bcd8ff')
  })

  it('pulls wild numbers back into range', () => {
    const got = readRecipe({ hue: 9000, saturation: -5, brightness: 99, contrast: 0 })

    expect(got?.hue).toBe(180)
    expect(got?.saturation).toBe(0)
    expect(got?.brightness).toBe(1.8)
    expect(got?.contrast).toBe(0.5)
  })

  it('refuses a style that would change nothing', () => {
    // The model does this: every field at its default, applies cleanly, and
    // the pack comes out identical with no error anywhere.
    expect(readRecipe(plainRecipe())).toBeNull()
    expect(readRecipe({ hue: 0, saturation: 1, brightness: 1, contrast: 1 })).toBeNull()
  })

  it('accepts a change in any single knob', () => {
    expect(readRecipe({ hue: 40 })).not.toBeNull()
    expect(readRecipe({ posterise: 4 })).not.toBeNull()
    expect(readRecipe({ grain: 0.2 })).not.toBeNull()
    expect(readRecipe({ tint: '#ff0000', tintStrength: 0.5 })).not.toBeNull()
  })

  it('ignores a tint that is not a colour', () => {
    expect(readRecipe({ hue: 30, tint: 'red' })?.tint).toBe('#ffffff')
    expect(readRecipe({ hue: 30, tint: 'javascript:x' })?.tint).toBe('#ffffff')
  })

  it('refuses what is not an answer at all', () => {
    expect(readRecipe(null)).toBeNull()
    expect(readRecipe('frostbitten')).toBeNull()
    expect(readRecipe(42)).toBeNull()
  })
})

describe('the presets', () => {
  it('all actually change something', () => {
    for (const preset of RECIPE_PRESETS) {
      expect(readRecipe(preset), preset.name).not.toBeNull()
    }
  })

  it('use real colours', () => {
    for (const preset of RECIPE_PRESETS) {
      expect(preset.tint, preset.name).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it('stay inside the ranges the reader allows', () => {
    for (const preset of RECIPE_PRESETS) {
      const read = readRecipe(preset)
      // A preset the reader would clamp is a preset that does not do what it
      // says on its own button.
      expect(read, preset.name).toEqual(preset)
    }
  })
})

describe('what the model is told', () => {
  it('names every field the reader accepts', () => {
    const said = recipePrompt()

    for (const key of Object.keys(plainRecipe())) {
      expect(said, key).toContain(key)
    }
  })
})
