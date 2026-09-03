import { describe, expect, it } from 'vitest'
import { estimateGameMb } from '../../src/main/services/support/vramBudget'

/**
 * The estimate only has to be right about one thing: that shaders cost far more
 * than anything else. That is the difference between an 8 GB card comfortably
 * running a model alongside the game and the two quietly fighting over it.
 */
describe('game VRAM estimate', () => {
  it('treats shaders as the dominant cost', () => {
    expect(estimateGameMb(true, 12)).toBeGreaterThan(estimateGameMb(false, 12) * 2)
  })

  it('grows with render distance, but distance never swamps shaders', () => {
    const near = estimateGameMb(true, 8)
    const far = estimateGameMb(true, 24)
    expect(far).toBeGreaterThan(near)
    expect(far - near).toBeLessThan(estimateGameMb(true, 8) - estimateGameMb(false, 8))
  })

  it('does not fall below the base cost at very short distances', () => {
    expect(estimateGameMb(false, 2)).toBe(estimateGameMb(false, 8))
  })

  /*
   * The case this exists for, with the real numbers off this machine: an
   * 8188 MB card, deepseek-r1:8b holding about 5300 MB, and a shader pack.
   */
  it('calls the real 8 GB card tight once a large model is loaded', () => {
    const free = 8188 - 761 - 5300
    expect(estimateGameMb(true, 16) + 400).toBeGreaterThan(free)
  })

  it('calls the same card fine with nothing loaded', () => {
    expect(estimateGameMb(true, 16) + 400).toBeLessThan(8188 - 761)
  })
})
