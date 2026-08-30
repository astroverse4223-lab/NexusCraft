import { describe, expect, it } from 'vitest'
import { groundedOrigin } from '../../src/main/companion/build/builder'

/**
 * Cover for the bug these exist because of: a companion that had flown up ended
 * up building at y=117 with nothing beneath it, so all 168 placements failed
 * with "nothing solid to build against" and the launcher blamed server
 * protection.
 */

/** A world that is solid at and below `groundY`, air above, with optional decoration. */
function fakeBot(groundY: number, surface: 'solid' | 'grass' | 'void' = 'solid'): unknown {
  return {
    blockAt(position: { x: number; y: number; z: number }) {
      if (surface === 'void') return { name: 'air', boundingBox: 'empty' }

      // A grass tuft sits one above the ground and must not count as ground.
      if (surface === 'grass' && position.y === groundY + 1) {
        return { name: 'short_grass', boundingBox: 'empty' }
      }
      if (position.y <= groundY) return { name: 'stone', boundingBox: 'block' }
      return { name: 'air', boundingBox: 'empty' }
    }
  }
}

const SIZE = { width: 7, depth: 7 }

describe('groundedOrigin', () => {
  it('drops a mid-air origin down onto the ground', () => {
    // The reported case: bot at 117, terrain at 64.
    const bot = fakeBot(64)
    const origin = groundedOrigin(bot, { x: -6, y: 117, z: -495 }, SIZE)
    expect(origin.y).toBe(65)
  })

  it('leaves an origin that already sits on the ground alone', () => {
    // Standing on the block at y=63 means feet at y=64, which is correct.
    const bot = fakeBot(63)
    expect(groundedOrigin(bot, { x: 0, y: 64, z: 0 }, SIZE).y).toBe(64)
  })

  it('keeps x and z exactly as given', () => {
    const bot = fakeBot(64)
    const origin = groundedOrigin(bot, { x: -6, y: 117, z: -495 }, SIZE)
    expect(origin.x).toBe(-6)
    expect(origin.z).toBe(-495)
  })

  it('ignores grass and flowers, which cannot be built against', () => {
    const bot = fakeBot(70, 'grass')
    // Ground is 70, a tuft sits at 71; the build must start at 71 regardless.
    expect(groundedOrigin(bot, { x: 0, y: 90, z: 0 }, SIZE).y).toBe(71)
  })

  it('returns the point unchanged over the void, rather than inventing ground', () => {
    const bot = fakeBot(0, 'void')
    const asked = { x: 10, y: 100, z: 10 }
    expect(groundedOrigin(bot, asked, SIZE)).toEqual(asked)
  })

  it('looks a little above the origin, for a bot stood in a doorway', () => {
    // Ground at 66 while the bot reports 64: still found, because the scan
    // starts a few blocks higher than the origin.
    const bot = fakeBot(66)
    expect(groundedOrigin(bot, { x: 0, y: 64, z: 0 }, SIZE).y).toBe(67)
  })

  it('samples the middle of the footprint, not its corner', () => {
    const seen: number[] = []
    const bot = {
      blockAt(position: { x: number; y: number; z: number }) {
        seen.push(position.x)
        return position.y <= 64 ? { name: 'stone', boundingBox: 'block' } : { name: 'air', boundingBox: 'empty' }
      }
    }
    groundedOrigin(bot, { x: 0, y: 80, z: 0 }, { width: 7, depth: 7 })
    // 0 + floor(7/2) = 3
    expect(seen.every((x) => x === 3)).toBe(true)
  })

  it('gives up rather than scanning the whole world', () => {
    let calls = 0
    const bot = {
      blockAt() {
        calls += 1
        return { name: 'air', boundingBox: 'empty' }
      }
    }
    groundedOrigin(bot, { x: 0, y: 300, z: 0 }, SIZE)
    // 4 above plus 96 below, not 300-odd down to bedrock.
    expect(calls).toBeLessThanOrEqual(105)
  })
})
