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
  ...FARMING_TOOLS
]

// Published so the tools that call other tools can resolve them by name
// without importing this module back.
registerTools(TOOLS)

export const TOOL_SCHEMAS: ToolSchema[] = TOOLS.map((t) => t.schema)

export type { Tool, ToolContext } from './types'
export { findTool } from './registry'

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
  'equip',
  'attack_nearest',
  'eat_food',
  'set_goal'
]

export type ToolSetName = 'full' | 'core'

export function schemasFor(set: ToolSetName): ToolSchema[] {
  if (set !== 'core') return TOOL_SCHEMAS
  return TOOL_SCHEMAS.filter((schema) => CORE_TOOL_NAMES.includes(schema.name))
}
