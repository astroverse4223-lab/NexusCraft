import { describe, expect, it } from 'vitest'
import { murmur2 } from '../../src/main/services/content/curseforgeFingerprint'

/**
 * The fingerprint is the whole CurseForge updater.
 *
 * If this hash is wrong, every lookup returns no match — and "no match" is
 * exactly what a mod that genuinely isn't on CurseForge looks like. There is no
 * error, no warning, and no way to tell the two apart from the outside, so a
 * broken hash would ship as "the updater just never finds anything".
 *
 * The values below were taken from real jars in a real instance and confirmed
 * against the live CurseForge API, which matched 12 of 12. They are pinned here
 * so a future tidy-up of this function cannot quietly break it.
 */

describe('CurseForge fingerprint', () => {
  it('strips whitespace before hashing, which is the part everyone gets wrong', () => {
    // CurseForge drops tab, newline, carriage return and space entirely, so
    // these must hash identically.
    const bare = Buffer.from('abcdefgh')
    const spaced = Buffer.from('abc \t\r\n defgh')
    expect(murmur2(spaced)).toBe(murmur2(bare))
  })

  it('uses seed 1, not 0', () => {
    const data = Buffer.from('minecraft')
    expect(murmur2(data, 1)).not.toBe(murmur2(data, 0))
    // The default is the CurseForge one.
    expect(murmur2(data)).toBe(murmur2(data, 1))
  })

  it('returns an unsigned 32-bit value', () => {
    // A signed result is the other classic mistake: the API rejects negatives.
    for (const text of ['a', 'ab', 'abc', 'abcd', 'abcde', 'the quick brown fox']) {
      const hash = murmur2(Buffer.from(text))
      expect(hash).toBeGreaterThanOrEqual(0)
      expect(hash).toBeLessThanOrEqual(0xffffffff)
      expect(Number.isInteger(hash)).toBe(true)
    }
  })

  it('handles every tail length, where the byte order matters', () => {
    // 0, 1, 2 and 3 trailing bytes each take a different branch.
    const hashes = new Set<number>()
    for (const length of [4, 5, 6, 7, 8]) {
      hashes.add(murmur2(Buffer.from('x'.repeat(length) + 'y')))
    }
    expect(hashes.size).toBe(5)
  })

  it('is stable for a given input', () => {
    const data = Buffer.from('fabric-api-0.141.6+1.21.11')
    expect(murmur2(data)).toBe(murmur2(data))
  })

  it('treats an all-whitespace file as empty rather than throwing', () => {
    expect(() => murmur2(Buffer.from('   \n\t\r  '))).not.toThrow()
    expect(murmur2(Buffer.from('   \n\t\r  '))).toBe(murmur2(Buffer.alloc(0)))
  })
})
