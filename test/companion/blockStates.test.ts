import minecraftData from 'minecraft-data'
import { describe, expect, it } from 'vitest'
import { BLUEPRINT_LIBRARY } from '../../src/main/companion/build/library'
import { baseBlockName, blockState } from '../../src/main/companion/build/blueprint'

/**
 * Are the block states real?
 *
 * The library test checks that block *names* exist. It never looked at the
 * properties, which is the half that matters for redstone: `facing`, `half`,
 * `face`, `delay`, `mode`. Get a property name or one of its values wrong and
 * the game does not complain — it takes the block and quietly gives it the
 * default state. A schematic full of defaulted states pastes as a build that
 * looks right and does nothing at all, which is the hardest failure to see.
 *
 * minecraft-data carries the real state table per block, so every property and
 * value in the library is checked against it here.
 */

const mcData = minecraftData('1.21.1')

interface State {
  name: string
  type: string
  values?: string[]
  num_values: number
}

/** Legal values for a property, including the ones data leaves implicit. */
function allowed(state: State): string[] {
  if (state.values) return state.values
  if (state.type === 'bool') return ['true', 'false']
  // An int property runs 0..num_values-1.
  return Array.from({ length: state.num_values }, (_, index) => String(index))
}

describe('block states in the library', () => {
  const entries = BLUEPRINT_LIBRARY.flatMap((entry) =>
    Object.entries(entry.blueprint.palette).map(
      ([letter, id]) => [`${entry.id}:${letter}`, id] as const
    )
  )

  it.each(entries)('%s — "%s" is a state the game accepts', (_where, id) => {
    const name = baseBlockName(id)
    const block = mcData.blocksByName[name]
    expect(block, `no such block: ${name}`).toBeDefined()

    const states = (block.states ?? []) as State[]
    const byName = new Map(states.map((state) => [state.name, state]))

    for (const [property, value] of Object.entries(blockState(id))) {
      const state = byName.get(property)
      expect(
        state,
        `${name} has no property "${property}" (it has: ${states.map((s) => s.name).join(', ') || 'none'})`
      ).toBeDefined()

      expect(
        allowed(state as State),
        `${name}.${property} cannot be "${value}"`
      ).toContain(value)
    }
  })
})
