import { describe, expect, it } from 'vitest'
import { itemCommand, quoted } from '../../src/shared/creations'

const bare = {
  id: 'fishing_rod',
  name: '',
  lore: [] as string[],
  enchants: [] as { id: string; level: number }[],
  unbreakable: false,
  count: 1
}

describe('quoted', () => {
  /*
   * The one that happened. "Grand Line Champion's Rod" ended its own SNBT
   * string at the apostrophe, and the server answered:
   *   Expected ']' at position 90: ... Champion'
   */
  it('escapes an apostrophe so it cannot close the string', () => {
    const out = quoted('{"text":"Champion\'s Rod"}')

    expect(out.startsWith("'")).toBe(true)
    expect(out.endsWith("'")).toBe(true)

    // Every apostrophe inside is escaped; only the wrapping pair is bare.
    const inner = out.slice(1, -1)
    expect(inner).not.toMatch(/(^|[^\\])'/)
  })

  it('escapes backslashes before quotes, not after', () => {
    // A trailing backslash must not end up escaping the closing quote.
    const out = quoted('a\\b')
    expect(out).toBe("'a\\\\b'")
  })

  it('leaves text without either alone', () => {
    expect(quoted('{"text":"plain"}')).toBe('\'{"text":"plain"}\'')
  })
})

describe('itemCommand', () => {
  it('survives an apostrophe in the name', () => {
    const command = itemCommand({ ...bare, name: "Grand Line Champion's Rod" }, 'Dave0734')

    // Nothing may close a string except the wrapper, so every apostrophe that
    // came from the name has to be preceded by a backslash.
    const insides = command.match(/'(?:[^'\\]|\\.)*'/g) ?? []
    expect(insides.length).toBeGreaterThan(0)

    for (const chunk of insides) {
      expect(chunk.slice(1, -1)).not.toMatch(/(^|[^\\])'/)
    }
  })

  it('survives an apostrophe in the lore', () => {
    const command = itemCommand(
      { ...bare, name: 'Rod', lore: ["the angler's finest"] },
      'Dave0734'
    )

    expect(command).toContain("angler\\'s")
  })

  it('still writes a plain command when nothing needs escaping', () => {
    const command = itemCommand({ ...bare, name: 'Windpiercer' }, '@a')

    expect(command).toContain('give @a minecraft:fishing_rod[')
    expect(command).toContain('Windpiercer')
    expect(command.endsWith(' 1')).toBe(true)
  })

  it('keeps every lore line', () => {
    const command = itemCommand({ ...bare, lore: ['one', 'two', 'three'] }, '@a')

    for (const line of ['one', 'two', 'three']) expect(command).toContain(line)
  })
})
