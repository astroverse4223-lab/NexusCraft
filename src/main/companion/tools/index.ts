import type { ToolSchema } from '../llm'
import type { Tool } from './types'
import { registerTools } from './registry'

import { TOOLS as CHAT_TOOLS } from './sets/chat'
import { TOOLS as MOVEMENT_TOOLS } from './sets/movement'
import { TOOLS as BLOCK_TOOLS } from './sets/blocks'
import { TOOLS as CRAFTING_TOOLS } from './sets/crafting'
import { TOOLS as INVENTORY_TOOLS } from './sets/inventory'
import { TOOLS as COMBAT_TOOLS } from './sets/combat'
import { TOOLS as FARMING_TOOLS } from './sets/farming'
import { TOOLS as CREW_TOOLS } from './sets/crew'
import { TOOLS as RECOVERY_TOOLS } from './sets/recovery'
import { TOOLS as TRADING_TOOLS } from './sets/trading'
import { TOOLS as ENCHANTING_TOOLS } from './sets/enchanting'
import { TOOLS as BUILDING_TOOLS } from './sets/building'
import { TOOLS as BASE_BRAIN_TOOLS } from './sets/baseBrain'

/**
 * The complete set of things the companion can do.
 *
 * The model never issues raw Minecraft commands — it picks from this list and
 * the implementations behind it drive mineflayer. That keeps the blast radius
 * of a confused model to "did something useless" rather than "ran /kill @a".
 *
 * The tools themselves live in `sets/`, grouped by what they act on, and the
 * shared machinery they lean on — pathfinding, combat, containers — lives in
 * `support/`. Order here is the order the model sees them in.
 */
export const TOOLS: Tool[] = [
  ...CHAT_TOOLS,
  ...MOVEMENT_TOOLS,
  ...BLOCK_TOOLS,
  ...CRAFTING_TOOLS,
  ...INVENTORY_TOOLS,
  ...COMBAT_TOOLS,
  ...FARMING_TOOLS,
  ...BUILDING_TOOLS,
  ...BASE_BRAIN_TOOLS,
  ...CREW_TOOLS,
  ...RECOVERY_TOOLS,
  ...TRADING_TOOLS,
  ...ENCHANTING_TOOLS
]

// Published so the tools that call other tools can resolve them by name
// without importing this module back.
registerTools(TOOLS)

export const TOOL_SCHEMAS: ToolSchema[] = TOOLS.map((t) => t.schema)

export type { Tool, ToolContext } from './types'
export { findTool } from './registry'
export { setCrewSnapshot, currentCrew } from './sets/crew'

/* ------------------------------------------------------------ tool sets */

/**
 * A smaller set of tools for smaller models.
 *
 * The full set is thirty-five tools and roughly 2,300 tokens of schema on every
 * request, before any conversation. Large hosted models cope; a 7B local model
 * given that many choices tends to stall, invent tool names, or mix up
 * arguments. These fourteen cover the whole survival loop — look, move, gather,
 * craft, build, fight, eat — and leave out the specialist ones a small model
 * rarely picks correctly anyway.
 */
export const CORE_TOOL_NAMES = [
  'say',
  'look_around',
  'inventory',
  'come_to_player',
  'follow_player',
  'explore',
  'mine_block',
  'collect_nearby_items',
  'craft_item',
  'place_block',
  // Worth its schema even in the short list: one call builds a whole
  // structure, where place_block builds one block.
  'build_structure',
  'recall_item',
  'equip',
  'attack_nearest',
  'eat_food',
  'set_goal',
  /*
   * In the essentials, despite the essentials being deliberately small.
   *
   * This is the one tool with a five minute deadline on it. A local model
   * running the reduced set is exactly the setup where the player is least
   * likely to be micromanaging, and "your things are about to despawn" is not
   * something to leave out of the small list.
   */
  'recover_death_drops'
]

/**
 * How many tools each set offers, and roughly what they cost.
 *
 * Counted rather than written down. The dropdown that offers these had "30
 * tools" typed into it, which was true when it was written and wrong by
 * fifteen a few sets later — the number is the one thing on that screen a
 * reader has no way to check, so it has to compute itself.
 *
 * The token figure is an estimate from the serialised schemas at roughly four
 * characters per token. It is there to make the cost of the full set visible,
 * not to be exact.
 */
export function toolSetSizes(): { full: number; core: number; fullTokens: number; coreTokens: number } {
  const core = TOOL_SCHEMAS.filter((schema) => CORE_TOOL_NAMES.includes(schema.name))
  const tokensOf = (schemas: ToolSchema[]): number =>
    Math.round(JSON.stringify(schemas).length / 4 / 50) * 50

  return {
    full: TOOL_SCHEMAS.length,
    core: core.length,
    fullTokens: tokensOf(TOOL_SCHEMAS),
    coreTokens: tokensOf(core)
  }
}

export type ToolSetName = 'full' | 'core'

export function schemasFor(set: ToolSetName): ToolSchema[] {
  if (set !== 'core') return TOOL_SCHEMAS
  return TOOL_SCHEMAS.filter((schema) => CORE_TOOL_NAMES.includes(schema.name))
}
