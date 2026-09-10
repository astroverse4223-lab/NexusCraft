import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Class names that exist.
 *
 * A class name with no rule behind it is the quietest bug the renderer has.
 * Nothing errors, nothing warns, and the markup goes on describing a layout
 * the screen does not have - so the only symptom is a screen that looks wrong
 * for reasons nobody can point at, which is how every one of these was found.
 *
 * What was actually rotting in here:
 *
 *   gap-2, gap-6, gap-10, gap-14   used forty-odd times, defined nowhere, so a
 *                                  `.col gap-14` got no gap and its panels sat
 *                                  flush together
 *   spin                           two loading spinners that did not turn
 *   items-center, items-end        no cross-axis alignment on a `.col`, where
 *                                  it is the one that means horizontal
 *   mb-12, mt-12                   a hole in a margin scale that had 8, 16, 24
 *   end                            the modal footers happened to be aligned by
 *                                  their parent, so this one was only a lie
 *
 * There is a single stylesheet, so "defined" means defined in it. A new class
 * needs a rule; that is the whole contract.
 */

const root = join(__dirname, '..', '..')
const css = readFileSync(join(root, 'src/renderer/src/styles/global.css'), 'utf8')

/*
 * Comments are stripped first. A class named only inside one - in an
 * explanation of why it was removed, say - is not a class that exists.
 */
const live = css.replace(/\/\*[\s\S]*?\*\//g, '')
const defined = new Set([...live.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)].map((m) => m[1]))

function sourceFiles(dir: string): string[] {
  const found: string[] = []

  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) found.push(...sourceFiles(path))
    else if (entry.endsWith('.tsx') || entry.endsWith('.ts')) found.push(path)
  }

  return found
}

/**
 * The literal class names in a file.
 *
 * Reads `className="a b"`, `className={`a ${x} b`}` and `className={'a b'}`,
 * dropping the interpolations - what a template puts in is decided at runtime
 * and cannot be checked from here, so only the fixed parts are claimed.
 */
function classesIn(source: string): string[] {
  const found: string[] = []

  for (const match of source.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\}|\{'([^']*)'\})/g)) {
    const literal = (match[1] ?? match[2] ?? match[3]).replace(/\$\{[^}]*\}/g, ' ')
    found.push(...literal.split(/\s+/).filter(Boolean))
  }

  return found
}

describe('the stylesheet', () => {
  it('has a rule for every class the renderer uses', () => {
    const missing = new Map<string, Set<string>>()

    for (const file of sourceFiles(join(root, 'src/renderer/src'))) {
      for (const name of classesIn(readFileSync(file, 'utf8'))) {
        if (defined.has(name)) continue

        const where = missing.get(name) ?? new Set<string>()
        where.add(file.slice(root.length + 1).replace(/\\/g, '/'))
        missing.set(name, where)
      }
    }

    // Named rather than counted, so a failure says which class and where.
    expect(Object.fromEntries([...missing].map(([k, v]) => [k, [...v]]))).toEqual({})
  })

  it('read a real stylesheet rather than an empty one', () => {
    // Guards the test itself: a regex that stopped matching would pass above.
    expect(defined.size).toBeGreaterThan(80)
    expect(defined.has('panel')).toBe(true)
    expect(defined.has('gap-12')).toBe(true)
    expect(defined.has('tab-strip')).toBe(true)
  })

  it('finds the classes in a file, interpolations aside', () => {
    const source = [
      '<div className="panel col gap-12">',
      '<button className={`tab ${active ? "active" : ""}`} />',
      "<span className={'tiny dim'} />"
    ].join('\n')

    expect(classesIn(source).sort()).toEqual(['col', 'dim', 'gap-12', 'panel', 'tab', 'tiny'])
  })
})
