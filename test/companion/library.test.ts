import minecraftData from 'minecraft-data'
import { describe, expect, it } from 'vitest'
import { BLUEPRINT_LIBRARY, findLibraryBlueprint } from '../../src/main/companion/build/library'
import { billOfMaterials, blueprintSize, validateBlueprint } from '../../src/main/companion/build/blueprint'

/**
 * The library is drawn by hand, so it is exactly the kind of thing that rots
 * quietly: one short row and a wall has a hole in it that nobody sees until a
 * bot is standing in a field failing to build. These run the same validator the
 * launcher uses on model output, against the same real block list.
 */

const mcData = minecraftData('1.21.1')
const isKnownBlock = (name: string): boolean => Boolean(mcData.blocksByName[name])

describe('bundled blueprint library', () => {
  it('is not empty', () => {
    expect(BLUEPRINT_LIBRARY.length).toBeGreaterThan(0)
  })

  it('has unique ids', () => {
    const ids = BLUEPRINT_LIBRARY.map((entry) => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it.each(BLUEPRINT_LIBRARY.map((entry) => [entry.id, entry] as const))(
    '"%s" is a valid blueprint',
    (_id, entry) => {
      const problems = validateBlueprint(entry.blueprint, isKnownBlock)
      // Printing the problems makes a failure say which row is short.
      expect(problems.map((p) => p.message)).toEqual([])
    }
  )

  it.each(BLUEPRINT_LIBRARY.map((entry) => [entry.id, entry] as const))(
    '"%s" places a sensible number of blocks',
    (_id, entry) => {
      const total = [...billOfMaterials(entry.blueprint)].reduce((sum, [, count]) => sum + count, 0)
      expect(total).toBeGreaterThan(20)
      // Anything past a few thousand is an afternoon of block placement.
      expect(total).toBeLessThan(4000)
    }
  )

  it.each(BLUEPRINT_LIBRARY.map((entry) => [entry.id, entry] as const))(
    '"%s" has every palette entry actually used',
    (_id, entry) => {
      const used = new Set<string>()
      for (const layer of entry.blueprint.layers) {
        for (const row of layer) {
          for (const character of row) if (character !== '.') used.add(character)
        }
      }
      // An unused palette entry is a sign a feature was drawn then lost.
      const unused = Object.keys(entry.blueprint.palette).filter((key) => !used.has(key))
      expect(unused).toEqual([])
    }
  )

  it.each(BLUEPRINT_LIBRARY.map((entry) => [entry.id, entry] as const))(
    '"%s" has a solid ground course to build off',
    (_id, entry) => {
      // The bottom layer carries everything above it; if it is mostly holes the
      // layers above have nothing to be placed against.
      const bottom = entry.blueprint.layers[0]
      const cells = bottom.join('').length
      const filled = bottom.join('').split('').filter((c) => c !== '.').length
      expect(filled / cells).toBeGreaterThan(0.3)
    }
  )

  it('reports real dimensions', () => {
    const cottage = findLibraryBlueprint('cottage')
    expect(cottage).toBeDefined()
    const size = blueprintSize(cottage!.blueprint)
    expect(size.width).toBe(7)
    expect(size.depth).toBe(7)
    expect(size.height).toBeGreaterThan(4)
  })

  it('finds entries case-insensitively and ignores stray spacing', () => {
    expect(findLibraryBlueprint('  Cottage ')?.id).toBe('cottage')
  })

  it('returns nothing for an unknown id', () => {
    expect(findLibraryBlueprint('nope')).toBeUndefined()
  })
})
