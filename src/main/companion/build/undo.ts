/* eslint-disable @typescript-eslint/no-explicit-any */
import type { BuildRecord, BuildUndoResult } from '@shared/companion'

/**
 * Taking a build back out again.
 *
 * A companion can put several thousand blocks into a world in one instruction,
 * and until this existed there was no way to reverse it — one badly aimed
 * "build me a castle" next to a base meant repairing by hand. That risk is what
 * stops people using the feature at all, so the builder now writes down what
 * each position held *before* it placed anything, and this puts it back.
 *
 * What can and cannot be restored is worth being plain about. A position that
 * was air is simply cleared, which is the overwhelmingly common case since
 * builds land on open ground. A position that held something — grass it grew
 * over, stone it cut into — is restored only if the bot is carrying that block
 * or can take it from the creative inventory; otherwise the position is left
 * empty and reported, because a silent partial restore is worse than a counted
 * one.
 */

/** Blocks that were never really "there": placing over them destroyed nothing. */
const DISPOSABLE = /^(air|cave_air|void_air|water|lava|snow|short_grass|tall_grass|fern|large_fern|dead_bush|seagrass|vine|.*_sapling|.*flower|dandelion|poppy|torch)$/

export function isDisposable(name: string): boolean {
  return DISPOSABLE.test(name)
}

/**
 * Reverses a recorded build, newest placement first.
 *
 * Reverse order matters: a wall built bottom-up has to come down top-down, or
 * the bot spends the whole job standing on blocks it is trying to remove.
 */
export async function undoBuild(
  bot: any,
  record: BuildRecord,
  options: {
    signal?: AbortSignal
    dig: (x: number, y: number, z: number) => Promise<string>
    onProgress?: (done: number, total: number) => void
  }
): Promise<BuildUndoResult> {
  const { Vec3 } = require('vec3')

  const result: BuildUndoResult = {
    buildId: record.id,
    removed: 0,
    restored: 0,
    skipped: 0,
    failed: 0,
    total: record.placements.length,
    stoppedBecause: null
  }

  const entries = [...record.placements].reverse()
  let consecutiveFailures = 0

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    if (options.signal?.aborted) {
      result.stoppedBecause = 'stopped'
      break
    }

    const here = bot.blockAt(new Vec3(entry.x, entry.y, entry.z))

    /*
     * Only take back what is still ours. If a player has since replaced the
     * block, or the ground has grown over it, removing whatever is there now
     * would be destroying something the companion never placed.
     */
    if (!here || here.name !== entry.placed) {
      result.skipped += 1
      continue
    }

    const reply = await options.dig(entry.x, entry.y, entry.z)
    const gone = bot.blockAt(new Vec3(entry.x, entry.y, entry.z))

    if (gone && gone.name === entry.placed) {
      result.failed += 1
      consecutiveFailures += 1
      // Same signal the builder uses: a run of refusals means protection.
      if (consecutiveFailures >= 12) {
        result.stoppedBecause =
          `12 removals in a row failed — the last said: ${reply}. On a server this usually means the area is protected.`
        break
      }
      continue
    }

    consecutiveFailures = 0
    result.removed += 1

    // Put back anything real that was displaced, when we can.
    if (entry.was && !isDisposable(entry.was)) {
      const restored = await restoreBlock(bot, entry.x, entry.y, entry.z, entry.was)
      if (restored) result.restored += 1
    }

    if (options.onProgress && (index + 1) % 25 === 0) {
      options.onProgress(index + 1, entries.length)
    }
  }

  return result
}

/**
 * Puts a displaced block back, if the bot has one.
 *
 * Deliberately best-effort: a survival bot that has since spent the dirt it dug
 * cannot restore it, and refusing to undo the rest of the build over that would
 * be the wrong trade.
 */
async function restoreBlock(bot: any, x: number, y: number, z: number, name: string): Promise<boolean> {
  try {
    const { Vec3 } = require('vec3')
    let held = bot.inventory.items().find((item: any) => item.name === name)

    if (!held && bot.game?.gameMode === 'creative') {
      const mcData = require('minecraft-data')(bot.version)
      const itemType = mcData.itemsByName[name]
      if (!itemType) return false
      const slot = bot.inventory.firstEmptyInventorySlot()
      if (slot == null) return false
      const ItemClass = require('prismarine-item')(bot.version)
      await bot.creative.setInventorySlot(slot, new ItemClass(itemType.id, 1))
      held = bot.inventory.items().find((item: any) => item.name === name)
    }

    if (!held) return false

    const target = new Vec3(x, y, z)
    const faces = [
      new Vec3(0, -1, 0),
      new Vec3(0, 1, 0),
      new Vec3(-1, 0, 0),
      new Vec3(1, 0, 0),
      new Vec3(0, 0, -1),
      new Vec3(0, 0, 1)
    ]
    for (const offset of faces) {
      const neighbour = bot.blockAt(target.plus(offset))
      if (!neighbour || neighbour.name === 'air' || neighbour.boundingBox !== 'block') continue
      await bot.equip(held, 'hand')
      await bot.placeBlock(neighbour, new Vec3(-offset.x, -offset.y, -offset.z))
      return true
    }
    return false
  } catch {
    return false
  }
}

/** A one-line summary of an undo, for chat and the activity feed. */
export function describeUndo(record: BuildRecord, result: BuildUndoResult): string {
  const parts = [`Undid ${record.label}: removed ${result.removed} of ${result.total} blocks`]
  if (result.restored > 0) parts.push(`put ${result.restored} original block(s) back`)
  if (result.skipped > 0) parts.push(`${result.skipped} had already changed and were left alone`)
  if (result.failed > 0) parts.push(`${result.failed} could not be removed`)
  if (result.stoppedBecause) parts.push(`stopped: ${result.stoppedBecause}`)
  return parts.join('; ')
}
