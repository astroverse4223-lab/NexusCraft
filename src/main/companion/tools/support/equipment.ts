/**
 * Choosing and wearing the right gear.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { TOOL_ITEM, materialTier } from '../constants'

/**
 * Armour ranked the way the game ranks it, worst first.
 *
 * The bot could craft a full set and then fight in its shirt: the only way to
 * wear anything was for the model to call `equip` four times with the right
 * destination for each piece, which it never thought to do.
 */
export const ARMOUR_TIER = ['leather', 'golden', 'chainmail', 'iron', 'diamond', 'netherite']

export const ARMOUR_SLOTS: Array<{ suffix: string; destination: string; label: string }> = [
  { suffix: '_helmet', destination: 'head', label: 'head' },
  { suffix: '_chestplate', destination: 'torso', label: 'chest' },
  { suffix: '_leggings', destination: 'legs', label: 'legs' },
  { suffix: '_boots', destination: 'feet', label: 'feet' }
]

export function armourRank(name: string): number {
  // Must actually be a piece of armour: matching the material alone counted an
  // iron pickaxe as iron armour, so the bot reported it was already wearing
  // "the best armour carried" while standing there in nothing at all.
  if (!ARMOUR_SLOTS.some((slot) => name.endsWith(slot.suffix))) return -1
  return ARMOUR_TIER.findIndex((material) => name.startsWith(`${material}_`))
}

/**
 * What the bot is wearing, slot by slot.
 *
 * Nothing could see this before. `equip_armor` only ever looked in the
 * inventory, so a bot in a full set of iron reported "no armour to wear" —
 * equipped armour is not carried armour — and a model reading that would go and
 * mine more iron for a set it was already standing in. Nor did looking around
 * mention armour at all, so there was no way to find out short of guessing.
 */
export function wornArmour(bot: any): string[] {
  const on: string[] = []
  for (const slot of ARMOUR_SLOTS) {
    try {
      const piece = bot.inventory.slots[bot.getEquipmentDestSlot(slot.destination)]
      if (piece?.name && armourRank(piece.name) >= 0) on.push(piece.name)
    } catch {
      /* a slot that cannot be read is simply not reported */
    }
  }
  return on
}

/** Wears the best piece carried for each slot. Returns what it put on. */
export async function wearBestArmour(bot: any): Promise<string[]> {
  const worn: string[] = []

  for (const slot of ARMOUR_SLOTS) {
    const candidates = bot.inventory
      .items()
      .filter((item: any) => item.name.endsWith(slot.suffix) && armourRank(item.name) >= 0)
      .sort((a: any, b: any) => armourRank(b.name) - armourRank(a.name))

    const best = candidates[0]
    if (!best) continue

    // Already wearing something at least as good? Leave it alone.
    const current = bot.inventory.slots[bot.getEquipmentDestSlot(slot.destination)]
    if (current && armourRank(current.name) >= armourRank(best.name)) continue

    try {
      await bot.equip(best, slot.destination)
      worn.push(best.name)
    } catch {
      /* a piece that will not go on is not worth failing the whole set over */
    }
  }

  return worn
}

/**
 * Holds the fastest tool in the inventory for a given block.
 *
 * mineflayer does not equip anything on its own, so `bot.dig` uses whatever
 * happens to be in hand. Bare-handed mining of stone or ore either takes long
 * enough to hit the action timeout or drops nothing at all, which is why the
 * companion looked incapable of gathering anything for itself.
 *
 * Rather than hard-coding a tool-to-material table, every item is asked how
 * long it would take to break this block and the quickest wins. That stays
 * correct across Minecraft versions and handles enchanted tools for free.
 */
/**
 * How long to allow for breaking one block, from how long it should take.
 *
 * Every dig was given the same two-minute allowance as any other action, so a
 * block the bot could not actually break — the wrong tool for it, or nothing in
 * hand at all — meant two solid minutes of swinging on the spot before anything
 * gave up. From outside that is indistinguishable from a hung bot, and it is
 * what the owner kept seeing.
 *
 * prismarine-block already knows what the held item would do against this
 * block, so the allowance is three times that, with a floor for latency and a
 * ceiling well under the old one.
 */
export function digAllowanceMs(bot: any, block: any): number {
  try {
    const held = bot.heldItem?.type ?? null
    const expected = block.digTime(held, false, false, false)
    if (Number.isFinite(expected) && expected > 0) {
      return Math.min(45_000, Math.max(8_000, Math.ceil(expected * 3)))
    }
  } catch {
    /* fall through to the default */
  }
  return 15_000
}

export async function equipBestTool(bot: any, block: any): Promise<string | null> {
  const items = bot.inventory.items()
  if (items.length === 0) return null

  let best: any = null
  let bestTime = Number.POSITIVE_INFINITY

  // The empty hand is the baseline every tool has to beat. If that cannot be
  // measured, every item looks like an improvement — which is how the bot ended
  // up "mining oak_log using oak_log", holding a log as though it were an axe.
  let baseline: number | null = null
  try {
    const bare = block.digTime(null, false, false, false)
    if (Number.isFinite(bare)) baseline = bare
  } catch {
    baseline = null
  }
  if (baseline != null) bestTime = baseline

  /*
   * Prefer a tool that will actually yield the block's drops, then the fastest
   * among those. Ranking on speed alone chose a stone pickaxe over an iron one
   * for iron ore, and a wooden pickaxe for obsidian — which cannot mine it at
   * all. Speed is only worth comparing between tools that work.
   */
  const harvests = (item: any): boolean => {
    const needed = block.harvestTools
    return !needed || Boolean(needed[item.type])
  }

  /*
   * Whether this block needs a tool at all to give up its drops.
   *
   * Logs, dirt and wool have no requirement, so every tool "harvests" them —
   * and the rule below that a harvesting tool beats a non-harvesting one then
   * matched the first tool in the bag regardless of speed. That is how the bot
   * came to chop trees with a stone pickaxe: a pickaxe is no faster on wood
   * than an empty hand, so it wore the pickaxe out for nothing. Where nothing
   * is required, a tool has to earn its place by actually being quicker.
   */
  const needsTool = Boolean(block.harvestTools)

  let bestHarvests = false

  for (const item of items) {
    // Only actual tools are worth holding; nothing else beats a bare hand.
    if (!TOOL_ITEM.test(item.name)) continue
    try {
      const time = block.digTime(item.type, false, false, false)
      if (!Number.isFinite(time)) continue

      const works = harvests(item)

      // A tool that yields drops always beats one that does not, however slow —
      // but only where the block actually demands one.
      if (needsTool && works && !bestHarvests) {
        bestHarvests = true
        bestTime = time
        best = item
        continue
      }
      if (needsTool && works !== bestHarvests) continue

      // Nothing required: the bare hand is the thing to beat, and matching it
      // is not beating it.
      if (!needsTool && baseline != null && time >= baseline) continue

      /*
       * Break ties by material. prismarine-block reports an identical dig time
       * for every pickaxe tier that can harvest iron ore, so a straight speed
       * comparison kept a stone pickaxe over an iron one. In the game the
       * better material really is faster; when the numbers cannot tell them
       * apart, the tier can.
       */
      if (time < bestTime || (time === bestTime && best && materialTier(item.name) > materialTier(best.name))) {
        bestTime = time
        best = item
      }
    } catch {
      /* an item that cannot be evaluated simply does not win */
    }
  }

  // Reporting whatever happens to be in hand made the bot claim it was
  // "mining oak_log using oak_log". Nothing chosen means nothing to report.
  if (!best) return null
  if (bot.heldItem?.type === best.type) return best.name

  try {
    await bot.equip(best, 'hand')
    return best.name
  } catch {
    return null
  }
}
