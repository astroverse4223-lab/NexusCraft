import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { COSMETIC_HATS } from '../../src/shared/resourcePacks'

/**
 * The hat ids are a contract with the server, kept in two languages.
 *
 * Cosmetics.Hat points every hat at `nexus:hat_<name>` and looks for nothing
 * else, so a texture filed under any other name is one the game never finds -
 * and the failure is silent: the hat simply stays a diamond block. Nothing in
 * the launcher can read the plugin's Java, so this reads it here instead.
 */
describe('the cosmetic hat contract', () => {
  const java = readFileSync(
    'server/src/main/java/dev/nexuscraft/nexus/Cosmetics.java',
    'utf8'
  )

  /** The enum constants, minus NONE, as the plugin's model() would name them. */
  const fromPlugin = (() => {
    const block = java.match(/public enum Hat \{([\s\S]*?)\n {4}\}/)
    if (!block) throw new Error('could not find the Hat enum')

    return [...block[1].matchAll(/^\s*([A-Z_]+)\(/gm)]
      .map((m) => m[1])
      .filter((name) => name !== 'NONE')
      .map((name) => 'hat_' + name.toLowerCase())
  })()

  it('names every hat the server has', () => {
    expect(COSMETIC_HATS.map((h) => h.id)).toEqual(fromPlugin)
  })

  it('names no hat the server does not have', () => {
    for (const hat of COSMETIC_HATS) expect(fromPlugin).toContain(hat.id)
  })

  it('uses ids that are legal resource locations', () => {
    // Upper case or a space here is dropped by the game with no warning.
    for (const hat of COSMETIC_HATS) expect(hat.id).toMatch(/^[a-z0-9_.-]+$/)
  })

  it('builds on a real vanilla item', () => {
    for (const hat of COSMETIC_HATS) expect(hat.base).toMatch(/^minecraft:[a-z_]+$/)
  })
})
