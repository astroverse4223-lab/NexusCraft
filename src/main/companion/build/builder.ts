/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ToolContext } from '../tools/types'
import { findTool } from '../tools/registry'
import type { BuildPlacement } from '@shared/companion'
import { blueprintBlocks, billOfMaterials, blueprintSize, type Blueprint } from './blueprint'

/**
 * Puts a blueprint in the ground, one block at a time, without a model.
 *
 * This is the half that makes prompt-to-build possible at all. Asking a model
 * where each of four hundred blocks goes costs four hundred round trips, a
 * fortune in tokens, and produces a wall with holes in it, because by block
 * two hundred the model has forgotten what it was building. Asking it once for
 * a blueprint and then executing that blueprint mechanically costs one round
 * trip and produces the thing that was drawn.
 *
 * So the model decides the shape and this decides nothing at all: it walks the
 * list, places what is missing, skips what is already right, and reports what
 * it could not do.
 */

export interface BuildProgress {
  placed: number
  skipped: number
  failed: number
  total: number
}

export interface BuildOptions {
  /** World coordinates of the blueprint's (0,0,0) corner. */
  origin: { x: number; y: number; z: number }
  /** Called every so often so the player hears about a long build. */
  onProgress?: (progress: BuildProgress) => void
  /** Stops the build early. */
  signal?: AbortSignal
}

export interface BuildResult extends BuildProgress {
  /** Blocks the bill of materials needed that the bot did not have. */
  missing: Array<{ block: string; short: number }>
  /** Why the build stopped early, when it did. */
  stoppedBecause: string | null
  /**
   * Every block actually placed, with what the position held first.
   *
   * Recorded as the build runs rather than reconstructed afterwards: the only
   * moment the previous block is knowable is immediately before it is replaced.
   */
  placements: BuildPlacement[]
}

/** How often to report progress, in blocks. */
const PROGRESS_EVERY = 25

/**
 * Consecutive failures before giving up.
 *
 * A build that has run out of a block, or is being refused by the server's
 * spawn protection, fails every single placement — and mineflayer reports the
 * placement as fine when a protected server silently discards it, so the only
 * signal is that nothing is landing. Twelve in a row is unambiguous.
 */
const MAX_CONSECUTIVE_FAILURES = 12

/** What the bot is carrying, as a count per block name. */
function inventoryCounts(bot: any): Map<string, number> {
  const counts = new Map<string, number>()
  for (const item of bot.inventory.items() as any[]) {
    counts.set(item.name, (counts.get(item.name) ?? 0) + item.count)
  }
  return counts
}

/** True when the server has the bot in creative mode. */
function isCreative(bot: any): boolean {
  return bot.game?.gameMode === 'creative'
}

/**
 * Fills the bot's inventory with what a build needs, in creative mode.
 *
 * This exists because "creative mode has everything" is true of the player's
 * item menu and false of the bot's inventory, which starts empty. `shortfall`
 * therefore reported nothing missing while every single placement failed with
 * "no cobblestone in the inventory" — the build stopped after twelve refusals
 * having laid no blocks at all, which is what made building in creative look
 * broken rather than merely unstocked.
 *
 * Stacks are 64, so a wall of two hundred cobblestone needs restocking as it
 * goes; `restock` handles that case mid-build.
 */
async function restock(bot: any, block: string, count = 64): Promise<boolean> {
  if (!isCreative(bot)) return false

  try {
    const mcData = require('minecraft-data')(bot.version)
    const itemType = mcData.itemsByName[block]
    if (!itemType) return false

    const slot = bot.inventory.firstEmptyInventorySlot()
    if (slot == null) return false

    const ItemClass = require('prismarine-item')(bot.version)
    await bot.creative.setInventorySlot(slot, new ItemClass(itemType.id, Math.max(1, Math.min(count, 64))))
    return true
  } catch {
    return false
  }
}

/** Stocks one stack of every distinct block a blueprint calls for. */
async function stockForBuild(bot: any, blueprint: Blueprint): Promise<void> {
  if (!isCreative(bot)) return

  const have = inventoryCounts(bot)
  for (const [block, needed] of billOfMaterials(blueprint)) {
    if ((have.get(block) ?? 0) >= Math.min(needed, 64)) continue
    await restock(bot, block, Math.min(needed, 64))
  }
}

/**
 * What the build needs that the bot has not got.
 *
 * Creative mode has everything, so this is only meaningful in survival — which
 * is also the only mode where it matters, since that is where a shortfall
 * means a half-built house.
 */
export function shortfall(bot: any, blueprint: Blueprint): Array<{ block: string; short: number }> {
  if (isCreative(bot)) return []

  const have = inventoryCounts(bot)
  const missing: Array<{ block: string; short: number }> = []

  for (const [block, needed] of billOfMaterials(blueprint)) {
    const short = needed - (have.get(block) ?? 0)
    if (short > 0) missing.push({ block, short })
  }

  return missing.sort((a, b) => b.short - a.short)
}

/**
 * Drops a build origin down onto solid ground.
 *
 * The origin used to be taken straight from the bot's feet, which is right only
 * when the bot happens to be standing on something. In creative it flies, and
 * after a failed flight it can be left a hundred blocks up — and a blueprint
 * started in mid-air fails every placement with "nothing solid to build
 * against", because Minecraft places blocks against the face of an existing
 * one and there is nothing up there to place against.
 *
 * So the ground is found rather than assumed: scan down the middle of the
 * footprint for the first real block and start one above it. Returns the
 * original point unchanged if there is nothing below at all, which is the void.
 */
export function groundedOrigin(
  bot: any,
  preferred: { x: number; y: number; z: number },
  size: { width: number; depth: number }
): { x: number; y: number; z: number } {
  const { Vec3 } = require('vec3')

  const centreX = preferred.x + Math.floor(size.width / 2)
  const centreZ = preferred.z + Math.floor(size.depth / 2)

  // A little above in case the bot is standing in a doorway or on a slab.
  const from = Math.min(preferred.y + 4, 319)
  const to = Math.max(preferred.y - 96, -64)

  for (let y = from; y >= to; y -= 1) {
    const block = bot.blockAt(new Vec3(centreX, y, centreZ))
    // `boundingBox === 'block'` skips grass, flowers and snow layers, which
    // cannot be built against and are not the ground.
    if (block && block.name !== 'air' && block.boundingBox === 'block') {
      return { x: preferred.x, y: y + 1, z: preferred.z }
    }
  }

  return preferred
}

export async function buildBlueprint(
  context: ToolContext,
  blueprint: Blueprint,
  options: BuildOptions
): Promise<BuildResult> {
  const { bot } = context
  const place = findTool('place_block')
  if (!place) throw new Error('the place_block tool is missing')

  const { Vec3 } = require('vec3')
  const blocks = blueprintBlocks(blueprint)
  const { origin } = options

  const result: BuildResult = {
    placed: 0,
    skipped: 0,
    failed: 0,
    total: blocks.length,
    missing: shortfall(bot, blueprint),
    stoppedBecause: null,
    placements: []
  }

  // In creative the bot's inventory starts empty; fill it before laying anything.
  await stockForBuild(bot, blueprint)

  let consecutiveFailures = 0

  for (const entry of blocks) {
    if (options.signal?.aborted || context.signal.aborted) {
      result.stoppedBecause = 'stopped'
      break
    }

    const x = origin.x + entry.dx
    const y = origin.y + entry.dy
    const z = origin.z + entry.dz

    /*
     * Skip what is already right. This is what makes a build resumable: run it
     * again after a failure and it picks up where it left off instead of
     * fighting to place blocks that are already there.
     */
    const current = bot.blockAt(new Vec3(x, y, z))
    if (current && current.name === entry.block) {
      result.skipped += 1
      continue
    }

    let reply = String(await place.execute(context, { block: entry.block, x, y, z }))

    /*
     * A stack runs out partway through a wall. In creative that is not a real
     * shortage, just an empty hand — refill and take the one retry rather than
     * reporting a shortfall the player cannot act on.
     */
    if (/^no .* in the inventory/.test(reply) && (await restock(bot, entry.block))) {
      reply = String(await place.execute(context, { block: entry.block, x, y, z }))
    }

    if (reply.startsWith('placed')) {
      result.placed += 1
      consecutiveFailures = 0
      // `current` was read just above, before anything was placed here.
      result.placements.push({ x, y, z, placed: entry.block, was: current?.name ?? 'air' })
    } else if (reply.includes('is already at')) {
      result.skipped += 1
      consecutiveFailures = 0
    } else {
      result.failed += 1
      consecutiveFailures += 1

      // Out of a material is worth stopping for; there is no point trying the
      // other three hundred placements of a block that is gone.
      if (/no .* in the inventory/.test(reply)) {
        result.stoppedBecause = reply
        break
      }

      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        /*
         * Say what actually happened rather than guessing.
         *
         * This used to blame server protection for every run of failures, which
         * sent people looking at permissions when the real answer was that the
         * build had been started in mid-air and had nothing to place against.
         * Protection is only the likely cause when the placements were refused,
         * not when they had nowhere to go.
         */
        const noSupport = /nothing solid next to|nowhere to stand/.test(reply)
        result.stoppedBecause =
          `${MAX_CONSECUTIVE_FAILURES} placements in a row failed — the last said: ${reply}.` +
          (noSupport
            ? ' The build has nothing under it, so it was probably started in mid-air. Land first, then build.'
            : ' On a server this usually means the area is protected.')
        break
      }
    }

    const done = result.placed + result.skipped + result.failed
    if (options.onProgress && done % PROGRESS_EVERY === 0) {
      options.onProgress({ placed: result.placed, skipped: result.skipped, failed: result.failed, total: blocks.length })
    }
  }

  return result
}

/** A one-line summary of what a build did, for chat and the activity feed. */
export function describeResult(blueprint: Blueprint, result: BuildResult): string {
  const size = blueprintSize(blueprint)
  const parts = [
    `${blueprint.name}: placed ${result.placed} of ${result.total} blocks (${size.width}x${size.height}x${size.depth})`
  ]

  if (result.skipped > 0) parts.push(`${result.skipped} were already right`)
  if (result.failed > 0) parts.push(`${result.failed} failed`)
  if (result.stoppedBecause) parts.push(`stopped: ${result.stoppedBecause}`)
  if (result.missing.length > 0) {
    parts.push(
      `short of ${result.missing
        .slice(0, 4)
        .map((entry) => `${entry.short}x ${entry.block}`)
        .join(', ')}`
    )
  }

  return parts.join('; ')
}
