import type { Blueprint } from './blueprint'
import { REDSTONE_LIBRARY } from './redstone'

/**
 * Structures that ship with the launcher, drawn by hand.
 *
 * A model asked to design a building produces something plausible about three
 * times in four; the fourth is a box with a hole in it. These are the fallback
 * that always works, and the reference the model is shown when it is asked to
 * draw its own — every one of them is a legal blueprint under the same rules,
 * with real doorways, real windows and nothing floating.
 *
 * Layer 0 is the ground course. Rows run north to south, characters west to
 * east. A dot leaves the space alone, which is what makes openings possible.
 */

/**
 * What kind of thing a blueprint is, for grouping in the picker.
 *
 * The list had grown to thirty-five entries in one flat grid, and finding the
 * cottage among two dozen redstone contraptions meant reading every card. A
 * player looking for a house is not browsing; they know what they want.
 */
export type BlueprintCategory = 'building' | 'redstone' | 'farm'

export interface LibraryEntry {
  id: string
  /** One line on what it is and what it costs, for the picker. */
  blurb: string
  /** Which section it belongs to. Defaults to a building. */
  category?: BlueprintCategory
  blueprint: Blueprint
}

/*
 * Nothing ships any more.
 *
 * Eight hand-drawn structures and three redstone contraptions used to live
 * here, and the person who used them gave the verdict: the houses are ugly and
 * the redstone does not work at all. That is what a build written by someone
 * who cannot stand back and look at it comes out like, and no amount of
 * redrawing fixes the cause.
 *
 * The tab now leads with importing a .schem or .nbt - real builds, made by
 * people who could see what they were making - and with the studio, where you
 * draw one yourself. An empty shelf beside a working door beats a full shelf
 * of things that fall apart.
 */
const STRUCTURES: LibraryEntry[] = []

/*
 * Buildings and circuits in one list, because the interface offers them the
 * same way. They are authored separately: a circuit is only correct if every
 * component's block state is right, which a decorative build never has to care
 * about.
 */
/**
 * Everything the launcher ships, each tagged with the section it belongs to.
 *
 * The categories are applied here rather than repeated on every entry: the two
 * source arrays already are the distinction, and a tag written out thirty-five
 * times is thirty-five chances to write it wrong.
 */
export const BLUEPRINT_LIBRARY: LibraryEntry[] = [
  ...STRUCTURES.map((entry) => ({ ...entry, category: entry.category ?? ('building' as const) })),
  ...REDSTONE_LIBRARY.map((entry) => ({ ...entry, category: entry.category ?? ('redstone' as const) }))
]

export function findLibraryBlueprint(id: string): LibraryEntry | undefined {
  return BLUEPRINT_LIBRARY.find((entry) => entry.id === id.toLowerCase().trim())
}

/** Words that carry no meaning when matching a request to a structure. */
const NOISE = new Set([
  'a',
  'an',
  'the',
  'small',
  'little',
  'big',
  'large',
  'nice',
  'cosy',
  'cozy',
  'simple',
  'basic',
  'me',
  'my',
  'build',
  'make',
  'please',
  'with',
  'and',
  'of',
  'for',
  'some',
  'new',
  'good'
])

/**
 * The library entry a request is asking for, or nothing if it is not clear.
 *
 * Exact ids are the normal case and win outright. Everything else is scored on
 * how many meaningful words the request shares with an entry's id, name and
 * blurb, and a weak best match is no match at all.
 *
 * The refusal is the point. A companion asked for "a small welcome outpost"
 * picked `well` out of the list and built one — a well, with a bucket, instead
 * of a house — and reported success. Guessing wrong and saying so is recoverable;
 * guessing wrong silently is not.
 */
export function matchLibraryBlueprint(query: string): { entry: LibraryEntry; exact: boolean } | null {
  const cleaned = query.toLowerCase().trim()
  if (!cleaned) return null

  const exact = findLibraryBlueprint(cleaned)
  if (exact) return { entry: exact, exact: true }

  const words = cleaned.split(/[^a-z0-9]+/).filter((word) => word.length > 2 && !NOISE.has(word))
  if (words.length === 0) return null

  let best: LibraryEntry | null = null
  let bestScore = 0

  for (const entry of BLUEPRINT_LIBRARY) {
    const haystack = `${entry.id} ${entry.blueprint.name} ${entry.blurb}`.toLowerCase()
    let score = 0
    for (const word of words) {
      // The id and name are what the thing *is*; the blurb only describes it.
      if (`${entry.id} ${entry.blueprint.name}`.toLowerCase().includes(word)) score += 3
      else if (haystack.includes(word)) score += 1
    }
    if (score > bestScore) {
      bestScore = score
      best = entry
    }
  }

  // One passing mention in a blurb is not enough to build something on.
  return best && bestScore >= 3 ? { entry: best, exact: false } : null
}
