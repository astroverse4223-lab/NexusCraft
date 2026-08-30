import { describe, expect, it } from 'vitest'
import {
  billOfMaterials,
  blueprintBlocks,
  blueprintSize,
  parseBlueprint,
  validateBlueprint,
  type Blueprint
} from '../../src/main/companion/build/blueprint'

/** A 3x2x3 hut: stone floor, plank walls with a doorway. */
const HUT: Blueprint = {
  name: 'Hut',
  palette: { s: 'cobblestone', w: 'oak_planks' },
  layers: [
    ['sss', 'sss', 'sss'],
    ['www', 'w.w', 'w.w']
  ]
}

const known = (name: string): boolean =>
  ['cobblestone', 'oak_planks', 'glass', 'stone'].includes(name)

describe('blueprintSize', () => {
  it('reads width, depth and height off the layers', () => {
    expect(blueprintSize(HUT)).toEqual({ width: 3, depth: 3, height: 2 })
  })
})

describe('validateBlueprint', () => {
  it('accepts a well-formed blueprint', () => {
    expect(validateBlueprint(HUT, known)).toEqual([])
  })

  it('rejects a layer with the wrong number of rows', () => {
    const broken: Blueprint = { ...HUT, layers: [['sss', 'sss', 'sss'], ['www', 'w.w']] }
    expect(validateBlueprint(broken, known)[0].message).toMatch(/2 rows, expected 3/)
  })

  it('rejects a row of the wrong width', () => {
    const broken: Blueprint = { ...HUT, layers: [['sss', 'ss', 'sss'], ['www', 'w.w', 'w.w']] }
    expect(validateBlueprint(broken, known)[0].message).toMatch(/2 wide, expected 3/)
  })

  it('rejects a character with no palette entry', () => {
    const broken: Blueprint = { ...HUT, layers: [['sxs', 'sss', 'sss'], ['www', 'w.w', 'w.w']] }
    expect(validateBlueprint(broken, known).some((p) => p.message.includes('"x"'))).toBe(true)
  })

  it('rejects a palette naming a block that does not exist', () => {
    const broken: Blueprint = { ...HUT, palette: { s: 'cheese', w: 'oak_planks' } }
    expect(validateBlueprint(broken, known).some((p) => p.message.includes('cheese'))).toBe(true)
  })

  it('ignores the skip character', () => {
    // The hut's own '.' spaces must not be reported as missing from the palette.
    expect(validateBlueprint(HUT, known)).toEqual([])
  })

  it('reports an empty blueprint rather than throwing', () => {
    expect(validateBlueprint({ name: '', palette: {}, layers: [] }, known)[0].message).toMatch(/no layers/)
  })
})

describe('blueprintBlocks', () => {
  it('skips the dots and emits everything else', () => {
    const blocks = blueprintBlocks(HUT)
    // 9 floor + 8 wall (the middle of the top layer's second and third rows is '.')
    expect(blocks).toHaveLength(9 + 7)
    expect(blocks.every((block) => block.block !== '.')).toBe(true)
  })

  it('orders layers bottom to top, so nothing is placed in mid-air', () => {
    const blocks = blueprintBlocks(HUT)
    const firstUpper = blocks.findIndex((block) => block.dy === 1)
    const lastLower = blocks.map((block) => block.dy).lastIndexOf(0)
    expect(firstUpper).toBeGreaterThan(lastLower)
  })

  it('strips the minecraft: prefix from palette entries', () => {
    const prefixed: Blueprint = { ...HUT, palette: { s: 'minecraft:cobblestone', w: 'minecraft:oak_planks' } }
    expect(blueprintBlocks(prefixed).every((block) => !block.block.includes(':'))).toBe(true)
  })

  it('works outward from the centre within a layer', () => {
    // A 5x5 floor: the corners must come before the middle, or the bot ends up
    // standing where the next block goes.
    const wide: Blueprint = {
      name: 'Floor',
      palette: { s: 'stone' },
      layers: [['sssss', 'sssss', 'sssss', 'sssss', 'sssss']]
    }
    const blocks = blueprintBlocks(wide)
    const centre = blocks.findIndex((block) => block.dx === 2 && block.dz === 2)
    const corner = blocks.findIndex((block) => block.dx === 0 && block.dz === 0)
    expect(corner).toBeLessThan(centre)
  })
})

describe('billOfMaterials', () => {
  it('counts every block the structure needs', () => {
    const bill = billOfMaterials(HUT)
    expect(bill.get('cobblestone')).toBe(9)
    expect(bill.get('oak_planks')).toBe(7)
  })
})

describe('parseBlueprint', () => {
  it('reads a bare JSON object', () => {
    const blueprint = parseBlueprint(JSON.stringify(HUT))
    expect(blueprint.name).toBe('Hut')
    expect(blueprint.layers).toHaveLength(2)
  })

  it('reads JSON out of a fenced code block', () => {
    const blueprint = parseBlueprint('Here you go:\n```json\n' + JSON.stringify(HUT) + '\n```\nHope that helps!')
    expect(blueprint.palette.s).toBe('cobblestone')
  })

  it('reads JSON surrounded by prose without fences', () => {
    const blueprint = parseBlueprint(`Sure! ${JSON.stringify(HUT)} Let me know what you think.`)
    expect(blueprint.name).toBe('Hut')
  })

  it('throws when there is no object at all', () => {
    expect(() => parseBlueprint('I cannot do that')).toThrow(/no JSON object/)
  })

  it('throws when the palette is missing', () => {
    expect(() => parseBlueprint('{"name":"x","layers":[["a"]]}')).toThrow(/palette/)
  })

  it('throws when the layers are missing', () => {
    expect(() => parseBlueprint('{"name":"x","palette":{"a":"stone"}}')).toThrow(/layers/)
  })

  it('keeps only the first character of each palette key', () => {
    const blueprint = parseBlueprint('{"name":"x","palette":{"stone":"cobblestone"},"layers":[["s"]]}')
    expect(blueprint.palette.s).toBe('cobblestone')
  })
})
