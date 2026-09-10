import { describe, expect, it } from 'vitest'
import { guessPackFormat } from '../../src/main/services/content/datapackService'

/*
 * The guesses used to be wrong for the two versions actually installed on this
 * machine, which is how a pack came to declare a format the game was not
 * running. These are the numbers read out of the jars themselves.
 */
describe('guessPackFormat', () => {
  it('matches what the jars say for the versions we can check', () => {
    expect(guessPackFormat('26.2')).toBe(107)
    expect(guessPackFormat('26.1.2')).toBe(101)
    expect(guessPackFormat('1.21.11')).toBe(94)
  })

  it('never goes backwards as versions go forwards', () => {
    const order = [
      '1.18.2',
      '1.19.4',
      '1.20.1',
      '1.20.6',
      '1.21.1',
      '1.21.4',
      '1.21.9',
      '1.21.11',
      '26.1.2',
      '26.2'
    ]

    for (let i = 1; i < order.length; i++) {
      expect(
        guessPackFormat(order[i]),
        `${order[i]} should not be below ${order[i - 1]}`
      ).toBeGreaterThanOrEqual(guessPackFormat(order[i - 1]))
    }
  })

  it('assumes a future version is at least as new as the newest known', () => {
    expect(guessPackFormat('27.1')).toBeGreaterThanOrEqual(107)
    expect(guessPackFormat('1.22.0')).toBeGreaterThanOrEqual(94)
  })

  it('still answers for something it has never heard of', () => {
    expect(guessPackFormat('nonsense')).toBeGreaterThan(0)
  })
})
