/**
 * Tuning constants for the companion's actions.
 *
 * Every number here was arrived at by watching a bot fail: a timeout that was too
 * short abandoned good work, one that was too long left the user staring at a
 * frozen companion. They are collected in one place so they can be compared
 * against each other rather than hunted down individually.
 */

 

export const MAX_MINE = 64

export const ACTION_TIMEOUT_MS = 120_000

/** How long the pathfinder may spend planning before it gives up. */
export const PATH_THINK_TIMEOUT_MS = 20_000

/** Blocks already within reach are dug directly rather than pathed to. */
export const REACH_BLOCKS = 4

/** Moving into range for one block should fail fast, not stall a whole build. */
export const MOVE_TO_PLACE_TIMEOUT_MS = 12_000

/** Flight covers short hops quickly; a long wait here means it is not working. */
export const FLIGHT_TIMEOUT_MS = 6_000

/** Travelling to a player or place: long enough to cross terrain, short enough to report back. */
export const TRAVEL_TIMEOUT_MS = 45_000

/** Travel budgets to spend before giving up, while ground is still being covered. */
export const TRAVEL_ATTEMPTS = 4

/** How much dearer a block of water is than a block of ground when routing. */
export const LIQUID_COST = 12

/** Health at which a fight is abandoned rather than lost. */
export const RETREAT_HEALTH = 8

/** Damage taken during a job before it is abandoned. */
export const DAMAGE_BEFORE_STOPPING = 6

/** How far to back off when breaking from a fight. */
export const FLEE_DISTANCE = 14

/** Ceiling on closing the distance to a wandering animal. */
export const MAX_ANIMAL_APPROACH_MS = 70_000

/** Ceiling on one boat crossing before it is abandoned. */
export const BOAT_TRAVEL_MS = 120_000

/** How far the boat is advanced each tick — under a real boat's top speed. */
export const BOAT_STEP_BLOCKS = 0.28

/** How often the boat's new position is reported. */
export const BOAT_TICK_MS = 50

/** Items worth eating when hurt. */
export const EDIBLE = /cooked_|bread|apple|carrot|potato|beetroot|melon_slice|steak|mutton|rabbit|stew|berries/

/** Items that can meaningfully speed up breaking a block. */
export const TOOL_ITEM = /_(pickaxe|axe|shovel|hoe|sword)$|^shears$/

/** Tool materials, worst to best, for breaking ties the dig time cannot. */
export const MATERIAL_TIER = ['wooden', 'golden', 'stone', 'iron', 'diamond', 'netherite']

export function materialTier(name: string): number {
  return MATERIAL_TIER.findIndex((material) => name.startsWith(`${material}_`))
}

/** Consecutive unreachable blocks before a mining job gives up. */
export const MAX_UNREACHABLE = 4

/** How much dearer a block of height is than a block of ground when choosing what to mine. */
export const VERTICAL_PENALTY = 4

/** How often to check that a walk is actually making progress. */
export const STUCK_SAMPLE_MS = 1_200

/** Movement below this over one sample counts as standing still. */
export const STUCK_MOVED_BLOCKS = 0.35

/** Reaching one block to mine it; a whole job should not hinge on a single stubborn one. */
export const MINE_APPROACH_TIMEOUT_MS = 20_000

/** Commands the companion will never run, however it is asked. */
export const FORBIDDEN_COMMANDS = new Set([
  'stop', 'ban', 'ban-ip', 'banlist', 'pardon', 'pardon-ip', 'kick',
  'op', 'deop', 'whitelist', 'save-off', 'setidletimeout',
  'forceload', 'reload', 'debug', 'perf', 'jfr'
])

export const MAX_FLIGHT_FAILURES = 3

/** Flight is retried after a pause; abandoning it for the session was worse. */
export const FLIGHT_RETRY_AFTER_MS = 60_000
