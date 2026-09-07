import { describe, expect, it } from 'vitest'
import { schemasFor } from '../../src/main/companion/tools'

/**
 * Which tools a companion is offered.
 *
 * Every schema costs tokens on every request and, worse, invites the model to
 * use it. A companion working alone was offered the crew tools, spent a turn
 * deciding which crew member to hand a job to, called `crew_status`, and was
 * told "you are not in a crew" — a whole turn for nothing.
 */
const CREW = ['crew_status', 'assign_task', 'crew_note']

describe('the tools offered to a companion', () => {
  it('leaves the crew tools out when it is working alone', () => {
    const names = schemasFor('full').map((s) => s.name)
    for (const tool of CREW) expect(names).not.toContain(tool)
  })

  it('offers them once it is on a crew', () => {
    const names = schemasFor('full', { inCrew: true }).map((s) => s.name)
    for (const tool of CREW) expect(names).toContain(tool)
  })

  it('keeps the working tools either way', () => {
    for (const options of [undefined, { inCrew: true }]) {
      const names = schemasFor('full', options).map((s) => s.name)
      expect(names).toContain('say')
      expect(names).toContain('place_block')
      expect(names).toContain('build_from_library')
    }
  })

  it('still shortens the list for a small model', () => {
    const core = schemasFor('core').map((s) => s.name)
    const full = schemasFor('full').map((s) => s.name)
    expect(core.length).toBeLessThan(full.length)
    expect(core).toContain('say')
  })

  it('the short list has no crew tools either', () => {
    const names = schemasFor('core').map((s) => s.name)
    for (const tool of CREW) expect(names).not.toContain(tool)
  })

  it('every schema has a name and a description', () => {
    // A tool the model cannot understand is worse than one it does not have.
    for (const schema of schemasFor('full', { inCrew: true })) {
      expect(schema.name, 'a tool with no name').toBeTruthy()
      expect(schema.description?.length ?? 0, `${schema.name} has no description`).toBeGreaterThan(20)
    }
  })
})
