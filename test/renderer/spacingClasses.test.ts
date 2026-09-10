import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Spacing classes that exist.
 *
 * `gap-2`, `gap-6`, `gap-10` and `gap-14` were written into forty-odd places
 * across the app and defined in the stylesheet nowhere, so they did nothing:
 * a `.col gap-14` got no gap at all and its panels sat flush together, while
 * a `.row gap-6` quietly kept the ten pixels `.row` sets for itself.
 *
 * Nothing errors and nothing warns. The number in the markup is simply not the
 * number on the screen, and the only symptom is that a screen looks wrong for
 * reasons nobody can point at - which is exactly how it was found.
 */

const root = join(__dirname, '..', '..')
const css = readFileSync(join(root, 'src/renderer/src/styles/global.css'), 'utf8')

/** Every `.gap-N` the stylesheet actually declares. */
const defined = new Set([...css.matchAll(/^\.gap-(\d+)\s*\{/gm)].map((m) => m[1]))

function sourceFiles(dir: string): string[] {
  const found: string[] = []

  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) found.push(...sourceFiles(path))
    else if (entry.endsWith('.tsx') || entry.endsWith('.ts')) found.push(path)
  }

  return found
}

describe('the spacing scale', () => {
  it('declares every gap the renderer asks for', () => {
    const missing = new Map<string, string[]>()

    for (const file of sourceFiles(join(root, 'src/renderer/src'))) {
      for (const match of readFileSync(file, 'utf8').matchAll(/\bgap-(\d+)\b/g)) {
        const step = match[1]
        if (defined.has(step)) continue

        const where = missing.get(step) ?? []
        where.push(file.slice(root.length + 1).replace(/\\/g, '/'))
        missing.set(step, where)
      }
    }

    expect(Object.fromEntries(missing)).toEqual({})
  })

  it('found a real scale rather than an empty stylesheet', () => {
    // Guards the test itself: a regex that stopped matching would pass above.
    expect(defined.size).toBeGreaterThan(4)
    expect(defined.has('12')).toBe(true)
  })
})
