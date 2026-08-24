/**
 * Opening chests and furnaces, and putting one down when there is none.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ToolContext } from '../types'

import { standingSpotNear } from './world'
import { MINE_APPROACH_TIMEOUT_MS, MOVE_TO_PLACE_TIMEOUT_MS, REACH_BLOCKS } from '../constants'
import { findTool } from '../registry'
import { freeSpotBeside } from './world'
import { goTo, goToBlock } from './navigation'

/**
 * Opens a container, making sure the bot is beside it rather than on top of it.
 *
 * A chest placed right where the bot was standing cannot be opened at all — the
 * server never sends the window, and it surfaces as a twenty-second timeout with
 * no hint of the cause.
 */
export async function openContainerNearby(context: ToolContext, block: any): Promise<any> {
  const { bot } = context
  const distance = bot.entity.position.distanceTo(block.position)

  if (distance < 1.2) {
    // Standing in it: step aside before trying.
    const spot = standingSpotNear(bot, block.position)
    if (spot) {
      try {
        await goTo(context, spot.x, spot.y, spot.z, 1, MOVE_TO_PLACE_TIMEOUT_MS)
      } catch {
        /* if it cannot move, opening will fail with its own message */
      }
    }
  } else if (distance > REACH_BLOCKS) {
    await goToBlock(context, block.position.x, block.position.y, block.position.z, MINE_APPROACH_TIMEOUT_MS)
  }

  await bot.lookAt(block.position.offset(0.5, 0.5, 0.5))
  return await bot.openContainer(block)
}

/** Blocks that hold items and can be opened the same way. */
export const CONTAINERS = ['chest', 'trapped_chest', 'barrel', 'shulker_box', 'ender_chest']

/**
 * Finds a container to use, placing one from the inventory if none is near.
 * Returns the block, or null with the reason it could not be arranged.
 */
export async function findOrPlaceContainer(
  context: ToolContext,
  allowPlacing: boolean
): Promise<{ block: any | null; reason: string }> {
  const { bot, mcData } = context

  const ids = CONTAINERS.map((n) => mcData.blocksByName[n]?.id).filter((id) => id != null)
  let block = bot.findBlock({ matching: ids, maxDistance: 16 })
  if (block) return { block, reason: '' }

  if (!allowPlacing) return { block: null, reason: 'no chest or barrel within 16 blocks' }

  const carried = bot.inventory.items().find((i: any) => CONTAINERS.includes(i.name))
  if (!carried) {
    return { block: null, reason: 'no chest nearby and none carried. Craft one from 8 planks.' }
  }

  const spot = await freeSpotBeside(bot)
  if (!spot) return { block: null, reason: 'no room beside me to put a chest down' }

  const placed = await findTool('place_block')!.execute(context, {
    block: carried.name,
    x: spot.x,
    y: spot.y,
    z: spot.z
  })
  context.log(`chest: ${placed}`)

  block = bot.findBlock({ matching: ids, maxDistance: 16 })
  return block ? { block, reason: '' } : { block: null, reason: `could not place a chest: ${placed}` }
}
