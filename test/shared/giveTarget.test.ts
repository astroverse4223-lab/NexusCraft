import { describe, expect, it } from 'vitest'
import { validTarget } from '../../src/shared/creations'

describe('validTarget', () => {
  /*
   * The one that actually happened. The box was prefilled with "@a", somebody
   * typed their name after it, and the server refused the command in a log
   * nobody was watching while the launcher said it had been handed over.
   */
  it('refuses a selector with a name stuck on the end', () => {
    expect(validTarget('@aDave0734')).toBe(false)
    expect(validTarget('@pSteve')).toBe(false)
  })

  it('accepts the selectors give understands', () => {
    for (const selector of ['@a', '@p', '@s', '@r', '@e']) {
      expect(validTarget(selector)).toBe(true)
    }
  })

  it('accepts a selector with arguments', () => {
    expect(validTarget('@a[team=red]')).toBe(true)
    expect(validTarget('@e[type=minecraft:pig,limit=1]')).toBe(true)
  })

  it('accepts a plain player name', () => {
    expect(validTarget('Dave0734')).toBe(true)
    expect(validTarget('Notch')).toBe(true)
  })

  it('refuses names Mojang would not allow', () => {
    expect(validTarget('ab')).toBe(false)
    expect(validTarget('a'.repeat(17))).toBe(false)
    expect(validTarget('has space')).toBe(false)
    expect(validTarget('semi;colon')).toBe(false)
  })

  it('refuses nothing at all', () => {
    expect(validTarget('')).toBe(false)
    expect(validTarget('   ')).toBe(false)
  })

  it('refuses an unknown selector letter', () => {
    expect(validTarget('@x')).toBe(false)
  })
})
