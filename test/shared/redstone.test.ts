import { describe, expect, it } from 'vitest'

import { COMPONENTS, blockDataFor, emptyCircuit, piecesOf, rotate, type Placed } from '../../src/shared/redstone'

/**
 * The block state strings a circuit is made of.
 *
 * This is the whole feature. A repeater without its facing and delay is not a
 * repeater, it is one pointing the wrong way with the wrong timing - and a
 * circuit made of those looks exactly like a working one and does nothing. An
 * unknown property is worse still: Bukkit refuses the whole string, so the
 * block simply never places and the only trace is a line in a log.
 *
 * Every property name checked here was read out of the 26.2 jar's own
 * blockstate files.
 */

const place = (over: Partial<Placed>): Placed => ({
  x: 0,
  y: 0,
  z: 0,
  component: 'dust',
  facing: 'north',
  delay: 1,
  face: 'floor',
  subtract: false,
  ...over
})

describe('what a placed component is written as', () => {
  it('writes a plain block with no properties at all', () => {
    expect(blockDataFor(place({ component: 'dust' }))).toBe('minecraft:redstone_wire')
    expect(blockDataFor(place({ component: 'block' }))).toBe('minecraft:redstone_block')
    expect(blockDataFor(place({ component: 'lamp' }))).toBe('minecraft:redstone_lamp')
  })

  it('gives a repeater its facing and its delay, and nothing else', () => {
    const data = blockDataFor(place({ component: 'repeater', facing: 'east', delay: 3 }))

    expect(data).toBe('minecraft:repeater[facing=east,delay=3]')
  })

  it('keeps a repeater delay inside the four the game has', () => {
    expect(blockDataFor(place({ component: 'repeater', delay: 9 }))).toContain('delay=4')
    expect(blockDataFor(place({ component: 'repeater', delay: 0 }))).toContain('delay=1')
  })

  it('gives a comparator its mode', () => {
    expect(blockDataFor(place({ component: 'comparator', subtract: true }))).toContain('mode=subtract')
    expect(blockDataFor(place({ component: 'comparator' }))).toContain('mode=compare')
  })

  it('does not give a delay to anything that has no delay', () => {
    for (const component of COMPONENTS) {
      if (component.delay) continue
      expect(blockDataFor(place({ component: component.id })), component.id).not.toContain('delay=')
    }
  })

  it('does not aim anything that does not point', () => {
    for (const component of COMPONENTS) {
      if (component.aim) continue
      expect(blockDataFor(place({ component: component.id })), component.id).not.toContain('facing=')
    }
  })

  /*
   * A torch on a wall is a different block, not a property.
   *
   * `redstone_torch[face=wall]` is not a thing - the game has
   * `redstone_wall_torch` with its own facing - and asking for the first is
   * refused outright rather than approximated.
   */
  it('turns a wall torch into the block the game actually has', () => {
    expect(blockDataFor(place({ component: 'torch', face: 'wall', facing: 'south' }))).toBe(
      'minecraft:redstone_wall_torch[facing=south]'
    )

    expect(blockDataFor(place({ component: 'torch', face: 'floor' }))).toBe('minecraft:redstone_torch')
  })

  it('gives a lever both the face it is on and the way it points', () => {
    const data = blockDataFor(place({ component: 'lever', face: 'ceiling', facing: 'west' }))

    expect(data).toContain('face=ceiling')
    expect(data).toContain('facing=west')
  })

  it('never writes a property twice', () => {
    for (const component of COMPONENTS) {
      const data = blockDataFor(place({ component: component.id }))
      const names = [...data.matchAll(/([a-z_]+)=/g)].map((m) => m[1])

      expect(new Set(names).size, `${component.id}: ${data}`).toBe(names.length)
    }
  })

  it('writes something the game could parse for every part offered', () => {
    for (const component of COMPONENTS) {
      const data = blockDataFor(place({ component: component.id }))

      expect(data.startsWith('minecraft:'), component.id).toBe(true)
      expect(data, component.id).not.toContain('undefined')
      expect(data, component.id).toMatch(/^minecraft:[a-z_]+(\[[a-z_]+=[a-z0-9_]+(,[a-z_]+=[a-z0-9_]+)*\])?$/)
    }
  })
})

describe('turning a design', () => {
  it('turns the facings with the positions', () => {
    const circuit = {
      ...emptyCircuit(),
      width: 3,
      depth: 2,
      placed: [place({ x: 0, z: 0, component: 'repeater', facing: 'north' })]
    }

    const turned = rotate(circuit)

    // The footprint swaps, and north becomes east.
    expect(turned.width).toBe(2)
    expect(turned.depth).toBe(3)
    expect(turned.placed[0].facing).toBe('east')
  })

  it('comes back to where it started after four turns', () => {
    const circuit = {
      ...emptyCircuit(),
      width: 4,
      depth: 4,
      placed: [
        place({ x: 1, z: 0, component: 'repeater', facing: 'north' }),
        place({ x: 3, z: 2, component: 'piston', facing: 'west' })
      ]
    }

    const round = rotate(rotate(rotate(rotate(circuit))))

    expect(round.placed).toEqual(circuit.placed)
  })
})

describe('what gets sent', () => {
  it('leaves out the squares nothing was placed on', () => {
    const circuit = {
      ...emptyCircuit(),
      placed: [place({ component: 'dust' }), place({ x: 1, component: 'air' })]
    }

    expect(piecesOf(circuit)).toHaveLength(1)
  })

  it('carries the offset and the state together', () => {
    const circuit = {
      ...emptyCircuit(),
      placed: [place({ x: 2, y: 1, z: 3, component: 'repeater', facing: 'south', delay: 2 })]
    }

    expect(piecesOf(circuit)[0]).toEqual({
      dx: 2,
      dy: 1,
      dz: 3,
      data: 'minecraft:repeater[facing=south,delay=2]'
    })
  })
})
