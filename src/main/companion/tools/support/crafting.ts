/**
 * Working out what a recipe still needs, and what to burn in a furnace.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ToolContext } from '../types'
import { ACTION_TIMEOUT_MS } from '../constants'
import { withTimeout } from './players'

/**
 * What a recipe still needs that the inventory cannot cover, for `runs` of it.
 *
 * Counting a single run was not enough: asking for three boats made planks for
 * one, then failed on the second with "missing ingredient". What is made has to
 * cover every run of the recipe that is about to happen.
 */
export function missingIngredients(bot: any, recipe: any, runs = 1): Array<{ id: number; count: number }> {
  const needed = new Map<number, number>()
  for (const part of recipe.delta ?? []) {
    // Negative entries are what the recipe consumes.
    if (part.count >= 0) continue
    needed.set(part.id, (needed.get(part.id) ?? 0) + -part.count * runs)
  }

  const short: Array<{ id: number; count: number }> = []
  for (const [id, count] of needed) {
    const have = bot.inventory.count(id, null)
    if (have < count) short.push({ id, count: count - have })
  }
  return short
}

/**
 * Makes the parts a recipe is short of, so the recipe itself becomes possible.
 *
 * `recipesFor` only reports what can be built from what is already in the bag,
 * so a pickaxe with logs but no planks looked flatly impossible — the bot stood
 * over a crafting table holding three oak logs and reported no recipe for a
 * wooden pickaxe. A player would make planks and sticks first.
 *
 * Every wood has its own version of a recipe, and they all look equally far off
 * when the bag is empty of all of them. Picking the first and giving up when it
 * failed meant reaching for acacia planks while carrying oak, so each version is
 * tried in turn until one actually comes together.
 */
export async function supplyIngredients(
  context: ToolContext,
  itemType: any,
  table: any,
  depth = 2,
  runs = 1
): Promise<string[]> {
  const { bot, mcData } = context
  const made: string[] = []
  if (depth <= 0) return made

  const all = bot.recipesAll(itemType.id, null, table ?? null)
  if (!all || all.length === 0) return made

  // Closest to possible first, so the likeliest version is tried before the rest.
  const ranked = [...all].sort(
    (a: any, b: any) => missingIngredients(bot, a, runs).length - missingIngredients(bot, b, runs).length
  )

  for (const recipe of ranked) {
    if (context.signal.aborted) break

    /*
     * Several passes, because making one part can eat another.
     *
     * A wooden pickaxe wants three planks and two sticks. Working the shortfall
     * once turned a log into four planks and then spent two of them on sticks,
     * leaving two planks where three were needed — everything asked for had
     * been made, and the pickaxe was still impossible. Re-reckoning what is
     * missing after each pass makes the second one top the planks back up.
     */
    for (let pass = 0; pass < 3; pass++) {
      if (context.signal.aborted) break

      const shortfall = missingIngredients(bot, recipe, runs)
      if (shortfall.length === 0) return made

      let progressed = false

      for (const part of shortfall) {
        if (context.signal.aborted) break
        const sub = mcData.items[part.id]
        if (!sub) break

        let subRecipes = bot.recipesFor(sub.id, null, 1, table ?? null)
        if (!subRecipes || subRecipes.length === 0) {
          // The part itself may need making first.
          made.push(...(await supplyIngredients(context, sub, table, depth - 1, part.count)))
          subRecipes = bot.recipesFor(sub.id, null, 1, table ?? null)
        }
        if (!subRecipes || subRecipes.length === 0) continue

        const perCraft = Math.max(1, subRecipes[0].result?.count ?? 1)
        const batches = Math.max(1, Math.ceil(part.count / perCraft))
        try {
          await withTimeout(
            bot.craft(subRecipes[0], batches, table ?? null),
            ACTION_TIMEOUT_MS,
            `crafting ${sub.name}`
          )
          await new Promise((r) => setTimeout(r, 150))
          made.push(`${batches * perCraft}x ${sub.name}`)
          progressed = true
        } catch {
          continue
        }
      }

      // Did that make the thing we actually came for possible?
      const now = bot.recipesFor(itemType.id, null, 1, table ?? null)
      if (now && now.length > 0) return made

      // Nothing was made this pass, so another will not help either.
      if (!progressed) break
    }
  }

  return made
}

/**
 * How many items one unit of each fuel will smelt, best first.
 *
 * The old code took whichever of four fuels it happened to be carrying and put
 * in `wanted / 8 + 1` of it, on the assumption that every fuel smelts eight
 * items. Coal does; wood does not. Asked for five iron with two oak planks in
 * the bag, the bot burned both planks — three items' worth — smelted three and
 * reported success, leaving the rest sitting in the furnace.
 *
 * Lava buckets and coal blocks are deliberately absent: both work, but neither
 * is worth spending on a handful of ingots.
 */
export const FUEL_YIELD: Array<{ match: RegExp; smelts: number }> = [
  { match: /^(coal|charcoal)$/, smelts: 8 },
  { match: /^blaze_rod$/, smelts: 12 },
  { match: /^dried_kelp_block$/, smelts: 20 },
  { match: /_(log|wood|stem|hyphae)$/, smelts: 1.5 },
  { match: /_planks$/, smelts: 1.5 },
  { match: /^(bamboo|stick)$/, smelts: 0.5 }
]

/** The best fuel carried, and how much of it this job needs. */
export function chooseFuel(bot: any, wanted: number): { item: any; use: number; smelts: number } | null {
  for (const kind of FUEL_YIELD) {
    const item = bot.inventory.items().find((i: any) => kind.match.test(i.name))
    if (!item) continue

    const needed = Math.ceil(wanted / kind.smelts)
    const use = Math.min(item.count, needed)
    return { item, use, smelts: Math.floor(use * kind.smelts) }
  }
  return null
}
