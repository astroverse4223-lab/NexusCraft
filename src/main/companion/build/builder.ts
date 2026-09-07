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
 * The longest a build may go without saying anything, however slowly it is
 * going.
 *
 * Reporting purely every 25 blocks was fine when the bot could fly, and wrong
 * the moment it had to walk: on a server with flight disabled a single
 * placement can take several seconds, so 25 of them can outlast the turn's
 * stall timer. The build was then killed for being idle while it was in fact
 * working the whole time - which is what "it stops mid build" looked like.
 */
const PROGRESS_AT_LEAST_EVERY_MS = 15_000

/**
 * Consecutive failures before giving up.
 *
 * A build that has run out of a block, or is being refused by the server's
 * spawn protection, fails every single placement — and mineflayer reports the
 * placement as fine when a protected server silently discards it, so the only
 * signal is that nothing is landing. Twelve in a row is unambiguous.
 */
const MAX_CONSECUTIVE_FAILURES = 12

/**
 * How many times to go round placing what would not go before.
 *
 * A pass only retries what is still missing, so a spare one costs almost
 * nothing, and a tall build genuinely needs several: each course of a fifteen
 * layer tower waits on the course below being finished. Three left a lighthouse
 * thirteen blocks short. Passes stop as soon as one places nothing, so this is
 * a ceiling rather than a cost.
 */
const MAX_PASSES = 8

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
): { x: number; y: number; z: number; grounded: boolean } {
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
      return { x: preferred.x, y: y + 1, z: preferred.z, grounded: true }
    }
  }

  /*
   * Nothing solid underneath, anywhere within a hundred blocks.
   *
   * This used to hand back the requested spot as though it were fine, and the
   * builder then tried to lay a house in mid-air: watched live, an Oak Cottage
   * reported "placed 0 of 202 blocks; 202 failed" after attempting every single
   * one, because the bot was a hundred blocks up and the search found no floor.
   * Saying so costs one message; not saying so costs two hundred placements and
   * a confusing report.
   */
  return { ...preferred, grounded: false }
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
  let lastReportAt = Date.now()
  /** The most recent refusal, whatever it was, for a build that placed nothing. */
  let lastFailureReply: string | null = null

  /*
   * Blocks are laid in more than one pass.
   *
   * A block can only be placed against something solid, and a blueprint does
   * not order itself so that every block's support comes first - a roof edge
   * over a doorway, a wall on sloped ground, anything overhanging. Those fail,
   * and in one pass they stayed failed: an Oak Cottage on uneven ground came
   * out as "placed 56 of 168; 99 failed", because one missing foundation block
   * failed everything stacked above it.
   *
   * Going round again fixes almost all of it, since the neighbours placed later
   * are exactly the support that was missing. Passes stop as soon as one places
   * nothing new, so genuinely impossible ground costs one extra sweep rather
   * than three.
   */
  let remaining = blocks
  const stillFailing: typeof blocks = []

  for (let pass = 1; pass <= MAX_PASSES && remaining.length > 0; pass += 1) {
    const placedBefore = result.placed
    stillFailing.length = 0
    consecutiveFailures = 0

    for (let index = 0; index < remaining.length; index += 1) {
      const entry = remaining[index]
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
        // Kept for the next pass: its support may be placed later in this one.
        stillFailing.push(entry)
        lastFailureReply = reply

        // Out of a material is worth stopping for; there is no point trying the
        // other three hundred placements of a block that is gone.
        if (/no .* in the inventory/.test(reply)) {
          result.stoppedBecause = reply
          break
        }

        /*
         * There is no early exit any more; a pass runs to the end.
         *
         * Stopping after a run of refusals was self-defeating once builds were
         * retried: the first row of a raised deck legitimately fails - there is
         * nothing under it yet - and every pass restarted at that same row, hit
         * the same dozen refusals and gave up before reaching the block that
         * would have placed and unlocked the rest. A stilt hut laid its four
         * legs and stopped, twelve blocks out of a hundred and fifty-seven.
         *
         * What a pass placed is the honest test instead, and it is checked
         * below: a pass that places nothing has nothing left to offer, and that
         * is equally true of a protected area and of impossible ground.
         */
      }

      const done = result.placed + result.skipped + result.failed
      const quietFor = Date.now() - lastReportAt
      if (options.onProgress && (done % PROGRESS_EVERY === 0 || quietFor >= PROGRESS_AT_LEAST_EVERY_MS)) {
        lastReportAt = Date.now()
        options.onProgress({ placed: result.placed, skipped: result.skipped, failed: result.failed, total: blocks.length })
      }
    }

    if (result.stoppedBecause === 'stopped') break

    // Nothing new landed, so another sweep would place nothing either.
    if (result.placed === placedBefore) break

    // Only what is still missing goes into the next pass.
    remaining = [...stillFailing]

    if (remaining.length > 0) {
      options.onProgress?.({
        placed: result.placed,
        skipped: result.skipped,
        failed: result.failed,
        total: blocks.length
      })
    }
  }

  /*
   * The failure count is what is genuinely still missing, worked out at the
   * end rather than tallied as it goes.
   *
   * Counting every attempt meant a build that finished after two passes still
   * reported the first pass's refusals - "99 failed" on a complete house - and
   * subtracting them again as passes went by was bookkeeping that drifted: it
   * reported zero failures on a lighthouse that was thirteen blocks short.
   */
  result.failed = Math.max(0, result.total - result.placed - result.skipped)

  /*
   * If the build came up short, say why, using the last refusal seen.
   *
   * The reason has to survive the retries: a block that failed in one pass and
   * landed in the next is not worth mentioning, but a build that ends with
   * blocks missing needs to say what stopped them - a protected region, or
   * nothing underneath to place against.
   */
  if (!result.stoppedBecause && result.failed > 0 && lastFailureReply) {
    const noSupport = /nothing solid next to|nowhere to stand/.test(lastFailureReply)
    const nothingAtAll = result.placed === 0

    result.stoppedBecause =
      (nothingAtAll
        ? 'nothing could be placed'
        : `${result.failed} block${result.failed === 1 ? '' : 's'} could not be placed`) +
      ` — the last attempt said: ${lastFailureReply}.` +
      (noSupport
        ? ' Those blocks had nothing to build against, so the site is probably uneven or in mid-air.'
        : ' On a server this usually means the area is protected.')
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
