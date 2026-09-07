import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Every server setting should appear on the form exactly once.
 *
 * "Allow flight" was drawn twice — once under "The world" and again under
 * "Players" — both bound to the same `editing.allowFlight`. Flipping either
 * moved the same value, so nothing behaved wrongly, but two rows with the same
 * label and two different explanations is a settings screen you cannot trust:
 * the natural reading is that one of them is the real one and you picked wrong.
 *
 * This reads the source rather than rendering, because the failure is a
 * duplicated block of JSX and that is what it looks like in the file.
 */
const source = readFileSync(
  join(__dirname, '..', '..', 'src', 'renderer', 'src', 'screens', 'HostServer.tsx'),
  'utf8'
)

describe('the hosted-server settings form', () => {
  it('binds each setting to exactly one control', () => {
    const bound = [...source.matchAll(/(?:checked|value)=\{editing\.([a-zA-Z]+)/g)].map(
      (match) => match[1]
    )

    const seen = new Map<string, number>()
    for (const field of bound) seen.set(field, (seen.get(field) ?? 0) + 1)

    const twice = [...seen.entries()]
      .filter(([, count]) => count > 1)
      .map(([field, count]) => `${field} is rendered ${count} times`)

    expect(twice).toEqual([])
  })

  it('gives each setting exactly one label', () => {
    const labels = [...source.matchAll(/label="([^"]+)"/g)].map((match) => match[1])

    const seen = new Map<string, number>()
    for (const label of labels) seen.set(label, (seen.get(label) ?? 0) + 1)

    const twice = [...seen.entries()]
      .filter(([, count]) => count > 1)
      .map(([label, count]) => `"${label}" appears ${count} times`)

    expect(twice).toEqual([])
  })
})
