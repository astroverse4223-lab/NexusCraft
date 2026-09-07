import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { schemasFor } from '../../src/main/companion/tools'

/**
 * Every tool the scripted routines call must actually exist.
 *
 * A routine names its tools as strings, so a tool that is renamed or removed
 * does not break the build — it breaks the worker, silently, at run time. The
 * lumberjack would simply stop chopping, and the only symptom is a companion
 * standing still, which is also what a working routine looks like between jobs.
 *
 * Scripted workers have no model to recover with, either: a language model that
 * gets "no such tool" tries something else, and a routine just fails.
 */
const ROUTINES = join(__dirname, '..', '..', 'src', 'main', 'companion', 'routines.ts')

describe('the tools the routines depend on', () => {
  const source = readFileSync(ROUTINES, 'utf8')

  // Every `use(context, 'name', …)` in the routines.
  const called = [...source.matchAll(/use\(context, '([a-z_]+)'/g)].map((m) => m[1])
  const unique = [...new Set(called)].sort()

  it('finds tool calls to check', () => {
    expect(unique.length).toBeGreaterThan(5)
  })

  it.each(unique)('"%s" is a real tool', (name) => {
    const known = schemasFor('full', { inCrew: true }).map((schema) => schema.name)
    expect(known, `${name} is called by a routine but is not a registered tool`).toContain(name)
  })
})
