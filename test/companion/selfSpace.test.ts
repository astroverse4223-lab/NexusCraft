import { describe, expect, it } from 'vitest'
import { occupiedBlocks, standingIn, stepAsideSpots } from '../../src/main/companion/build/selfSpace'

/**
 * Andy stood in the gap he was meant to fill, was refused, and never moved —
 * so every later pass was refused identically and the wall kept its
 * bot-shaped hole. These are the cases that produced it.
 */
describe('the space the bot itself takes up', () => {
  it('covers the block at its feet', () => {
    expect(standingIn({ x: 10.5, y: 64, z: 20.5 }, { x: 10, y: 64, z: 20 })).toBe(true)
  })

  it('covers the block at its head, which is the one that got missed', () => {
    // The wall gap in the screenshot was at head height, not foot height.
    expect(standingIn({ x: 10.5, y: 64, z: 20.5 }, { x: 10, y: 65, z: 20 })).toBe(true)
  })

  it('does not cover the block it is standing on', () => {
    expect(standingIn({ x: 10.5, y: 64, z: 20.5 }, { x: 10, y: 63, z: 20 })).toBe(false)
  })

  it('does not cover the block above its head', () => {
    expect(standingIn({ x: 10.5, y: 64, z: 20.5 }, { x: 10, y: 66, z: 20 })).toBe(false)
  })

  it('does not cover a neighbour it is merely next to', () => {
    expect(standingIn({ x: 10.5, y: 64, z: 20.5 }, { x: 11, y: 64, z: 20 })).toBe(false)
  })

  it('covers both columns when straddling a boundary', () => {
    // Standing on the edge: the 0.6-wide body is genuinely in two columns.
    const blocks = occupiedBlocks({ x: 11.0, y: 64, z: 20.5 })
    const columns = new Set(blocks.map((block) => block.x))
    expect(columns).toEqual(new Set([10, 11]))
  })

  it('does not claim a neighbour from a hair over the line', () => {
    // Dead centre: only one column, or the bot could never build beside itself.
    const blocks = occupiedBlocks({ x: 10.5, y: 64, z: 20.5 })
    expect(new Set(blocks.map((block) => block.x))).toEqual(new Set([10]))
    expect(new Set(blocks.map((block) => block.z))).toEqual(new Set([20]))
  })

  it('takes up exactly two levels standing on flat ground', () => {
    const blocks = occupiedBlocks({ x: 10.5, y: 64, z: 20.5 })
    expect(new Set(blocks.map((block) => block.y))).toEqual(new Set([64, 65]))
  })
})

describe('stepping out of the way', () => {
  const feet = { x: 10.5, y: 64, z: 20.5 }
  const target = { x: 10, y: 64, z: 20 }

  it('offers somewhere to go', () => {
    expect(stepAsideSpots(feet, target).length).toBeGreaterThan(0)
  })

  it('never offers a spot that puts it back in the target', () => {
    for (const spot of stepAsideSpots(feet, target)) {
      const centre = { x: spot.x + 0.5, y: spot.y, z: spot.z + 0.5 }
      expect(standingIn(centre, target), `${spot.x},${spot.y},${spot.z} is still in the way`).toBe(
        false
      )
    }
  })

  it('keeps the target within reach from every spot', () => {
    for (const spot of stepAsideSpots(feet, target, 4)) {
      const dist = Math.hypot(spot.x + 0.5 - (target.x + 0.5), spot.y - target.y, spot.z + 0.5 - (target.z + 0.5))
      expect(dist).toBeLessThanOrEqual(4)
    }
  })

  it('tries the smallest move first', () => {
    const spots = stepAsideSpots(feet, target)
    const first = spots[0]
    const moved = Math.hypot(first.x - feet.x, first.y - feet.y, first.z - feet.z)
    // One step sideways, not a trek across the site.
    expect(moved).toBeLessThan(2)
  })

  it('handles a head-height target too', () => {
    const spots = stepAsideSpots(feet, { x: 10, y: 65, z: 20 })
    expect(spots.length).toBeGreaterThan(0)
    for (const spot of spots) {
      const centre = { x: spot.x + 0.5, y: spot.y, z: spot.z + 0.5 }
      expect(standingIn(centre, { x: 10, y: 65, z: 20 })).toBe(false)
    }
  })
})
