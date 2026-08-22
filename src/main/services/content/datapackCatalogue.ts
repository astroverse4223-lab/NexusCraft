import type { DataPackDefinition, DataPackOptionValues } from '@shared/types'

/**
 * Every data pack the launcher can generate.
 *
 * Packs are built almost entirely from command functions, scoreboards and
 * advancements. Those parts of the data pack format have been stable across
 * many Minecraft versions, whereas loot table and recipe schemas changed in
 * 1.20.5 and again in 1.21 — the few packs that need them declare both
 * variants and the engine picks by pack format.
 */

export interface BuildContext {
  options: DataPackOptionValues
  /** This pack's own namespace, e.g. `nexuscraft_cave_sense`. */
  ns: string
  /** Data pack format of the target Minecraft version. */
  format: number
}

/** A JSON file to place in the pack, addressed by what kind of thing it is. */
export interface JsonFile {
  kind: 'advancement' | 'recipe' | 'loot_table' | 'predicate' | 'raw'
  /** Path within that kind's directory, without `.json`. */
  name: string
  /** Defaults to the pack's namespace; set `minecraft` to override vanilla. */
  namespace?: string
  data: unknown
}

export interface PackOutput {
  /** Function name (`load`, `tick`, or any helper) to its command lines. */
  functions: Record<string, string[]>
  json?: JsonFile[]
}

export interface PackBuilder extends DataPackDefinition {
  /** Minimum data pack format this pack can work on, when it needs newer features. */
  minPackFormat?: number
  build: (context: BuildContext) => PackOutput
}

/* ------------------------------------------------------------- helpers */

export function bool(options: DataPackOptionValues, key: string, fallback = false): boolean {
  const value = options[key]
  return typeof value === 'boolean' ? value : fallback
}

export function num(options: DataPackOptionValues, key: string, fallback: number): number {
  const value = options[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function str(options: DataPackOptionValues, key: string, fallback: string): string {
  const value = options[key]
  return typeof value === 'string' && value ? value : fallback
}

/** Mobs the radar highlights. Vanilla has no "all hostiles" entity tag. */
const HOSTILES = [
  'zombie', 'husk', 'drowned', 'zombie_villager', 'skeleton', 'stray', 'wither_skeleton',
  'creeper', 'spider', 'cave_spider', 'enderman', 'endermite', 'silverfish', 'witch',
  'slime', 'magma_cube', 'blaze', 'ghast', 'phantom', 'pillager', 'vindicator', 'evoker',
  'ravager', 'vex', 'piglin_brute', 'hoglin', 'zoglin', 'guardian', 'elder_guardian',
  'shulker', 'warden', 'breeze', 'bogged'
]

/* ---------------------------------------------------------------- packs */

export const PACKS: PackBuilder[] = [
  /* ============================================================ originals */
  {
    id: 'quality-of-life',
    name: 'Quality of Life',
    tagline: 'The world rules most people change anyway, in one pack.',
    description:
      'Applies a set of game rules as soon as the world loads. Each one is optional, so you can take only the parts you want.',
    icon: 'settings',
    category: 'Essentials',
    options: [
      { key: 'keepInventory', label: 'Keep inventory on death', type: 'boolean', default: true },
      { key: 'sleepPercent', label: 'Players needed to skip night (%)', type: 'number', default: 50, min: 1, max: 100 },
      { key: 'noMobGriefing', label: 'Stop creepers and endermen wrecking the place', type: 'boolean', default: false },
      { key: 'noFireSpread', label: 'Stop fire spreading', type: 'boolean', default: false },
      { key: 'alwaysDay', label: 'Lock time to day', type: 'boolean', default: false },
      { key: 'clearWeather', label: 'Lock weather to clear', type: 'boolean', default: false }
    ],
    build: ({ options }) => {
      const load: string[] = []
      if (bool(options, 'keepInventory', true)) load.push('gamerule keepInventory true')
      load.push(`gamerule playersSleepingPercentage ${Math.round(num(options, 'sleepPercent', 50))}`)
      if (bool(options, 'noMobGriefing')) load.push('gamerule mobGriefing false')
      if (bool(options, 'noFireSpread')) load.push('gamerule doFireTick false')
      if (bool(options, 'alwaysDay')) load.push('gamerule doDaylightCycle false', 'time set day')
      if (bool(options, 'clearWeather')) load.push('gamerule doWeatherCycle false', 'weather clear')
      return { functions: { load } }
    }
  },

  {
    id: 'coordinates-hud',
    name: 'Coordinates HUD',
    tagline: 'Your position, always on screen, without pressing F3.',
    description:
      'Shows your X, Y and Z in the action bar above the hotbar. Reads the position off each player every tick and writes it to a scoreboard.',
    icon: 'compass',
    category: 'Essentials',
    options: [],
    build: ({ ns }) => ({
      functions: {
        load: [
          'scoreboard objectives add nc_x dummy',
          'scoreboard objectives add nc_y dummy',
          'scoreboard objectives add nc_z dummy'
        ],
        tick: [
          'execute as @a store result score @s nc_x run data get entity @s Pos[0]',
          'execute as @a store result score @s nc_y run data get entity @s Pos[1]',
          'execute as @a store result score @s nc_z run data get entity @s Pos[2]',
          'execute as @a run title @s actionbar ["",{"text":"X ","color":"gray"},{"score":{"name":"@s","objective":"nc_x"},"color":"white"},{"text":"  Y ","color":"gray"},{"score":{"name":"@s","objective":"nc_y"},"color":"white"},{"text":"  Z ","color":"gray"},{"score":{"name":"@s","objective":"nc_z"},"color":"white"}]'
        ]
      }
    })
  },

  {
    id: 'cave-sense',
    name: 'Cave Sense',
    tagline: 'Night vision kicks in when you go deep.',
    description:
      'Grants night vision automatically below a chosen depth and removes it when you climb back up. Handy for caving without burning through torches.',
    icon: 'eye',
    category: 'Essentials',
    options: [
      { key: 'depth', label: 'Apply below Y', type: 'number', default: 0, min: -64, max: 320 },
      { key: 'announce', label: 'Say when it turns on', type: 'boolean', default: false }
    ],
    build: ({ options }) => {
      const depth = Math.round(num(options, 'depth', 0))
      const tick = [
        'execute as @a store result score @s nc_depth run data get entity @s Pos[1]',
        `execute as @a[scores={nc_depth=..${depth}}] run effect give @s minecraft:night_vision 12 0 true`,
        `execute as @a[scores={nc_depth=${depth + 1}..}] run effect clear @s minecraft:night_vision`
      ]
      if (bool(options, 'announce')) {
        tick.push(
          `execute as @a[scores={nc_depth=..${depth}}] run title @s actionbar {"text":"Cave sense active","color":"aqua"}`
        )
      }
      return { functions: { load: ['scoreboard objectives add nc_depth dummy'], tick } }
    }
  },

  {
    id: 'explorers-kit',
    name: "Explorer's Kit",
    tagline: 'Start with the basics instead of punching trees.',
    description:
      'Gives each player a small kit the first time they are in the world. Uses an advancement so it fires exactly once per player.',
    icon: 'package',
    category: 'Essentials',
    options: [
      {
        key: 'tier',
        label: 'Kit',
        type: 'select',
        default: 'stone',
        choices: [
          { value: 'wood', label: 'Modest — wooden tools and bread' },
          { value: 'stone', label: 'Standard — stone tools, torches, food' },
          { value: 'iron', label: 'Generous — iron tools and armour' }
        ]
      },
      { key: 'compass', label: 'Include a compass and a map', type: 'boolean', default: true }
    ],
    build: ({ options, ns }) => {
      const kits: Record<string, string[]> = {
        wood: ['wooden_sword', 'wooden_pickaxe', 'wooden_axe'].map((i) => `give @s minecraft:${i}`).concat('give @s minecraft:bread 8'),
        stone: ['stone_sword', 'stone_pickaxe', 'stone_axe', 'stone_shovel']
          .map((i) => `give @s minecraft:${i}`)
          .concat('give @s minecraft:torch 32', 'give @s minecraft:cooked_beef 16'),
        iron: ['iron_sword', 'iron_pickaxe', 'iron_axe', 'iron_shovel', 'iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots']
          .map((i) => `give @s minecraft:${i}`)
          .concat('give @s minecraft:torch 64', 'give @s minecraft:cooked_beef 32')
      }
      const lines = [...(kits[str(options, 'tier', 'stone')] ?? kits.stone)]
      if (bool(options, 'compass', true)) lines.push('give @s minecraft:compass', 'give @s minecraft:map')
      lines.push('tellraw @s [{"text":"[NexusCraft] ","color":"aqua"},{"text":"Here is your kit. Good luck.","color":"gray"}]')

      return {
        functions: { kit: lines },
        json: [
          {
            kind: 'advancement',
            name: 'kit',
            data: { criteria: { joined: { trigger: 'minecraft:tick' } }, rewards: { function: `${ns}:kit` } }
          }
        ]
      }
    }
  },

  {
    id: 'scoreboard-suite',
    name: 'Scoreboard Suite',
    tagline: 'Health under names, kills on the sidebar.',
    description:
      "Turns on Minecraft's built-in scoreboard displays: hearts beneath every player name, and a running kill count in the sidebar.",
    icon: 'trophy',
    category: 'Essentials',
    options: [
      { key: 'health', label: 'Show health under player names', type: 'boolean', default: true },
      { key: 'kills', label: 'Show a kill counter on the sidebar', type: 'boolean', default: true },
      { key: 'deaths', label: 'Track deaths in the tab list', type: 'boolean', default: false }
    ],
    build: ({ options }) => {
      const load: string[] = []
      if (bool(options, 'health', true)) {
        load.push(
          'scoreboard objectives add nc_health health',
          'scoreboard objectives modify nc_health displayname "Health"',
          'scoreboard objectives setdisplay below_name nc_health'
        )
      }
      if (bool(options, 'kills', true)) {
        load.push(
          'scoreboard objectives add nc_kills totalKillCount',
          'scoreboard objectives modify nc_kills displayname "Kills"',
          'scoreboard objectives setdisplay sidebar nc_kills'
        )
      }
      if (bool(options, 'deaths')) {
        load.push('scoreboard objectives add nc_deaths deathCount', 'scoreboard objectives setdisplay list nc_deaths')
      }
      return { functions: { load } }
    }
  },

  /* ==================================================== survival essentials */
  {
    id: 'death-waypoint',
    name: 'Death Waypoint',
    tagline: 'Never lose your stuff to a forgotten cave again.',
    description:
      'Records exactly where you died and tells you the coordinates. Run /trigger deathpoint at any time to hear them again.',
    icon: 'skull',
    category: 'Survival',
    options: [{ key: 'announce', label: 'Announce deaths to everyone', type: 'boolean', default: false }],
    build: ({ options, ns }) => ({
      functions: {
        load: [
          'scoreboard objectives add nc_died deathCount',
          'scoreboard objectives add nc_dp trigger',
          'scoreboard objectives add nc_dx dummy',
          'scoreboard objectives add nc_dy dummy',
          'scoreboard objectives add nc_dz dummy'
        ],
        tick: [
          'scoreboard players enable @a nc_dp',
          // A player stays at the place they died until they respawn, so the
          // next tick still has the right position.
          `execute as @a[scores={nc_died=1..}] at @s run function ${ns}:record`,
          `execute as @a[scores={nc_dp=1..}] run function ${ns}:show`
        ],
        record: [
          'execute store result score @s nc_dx run data get entity @s Pos[0]',
          'execute store result score @s nc_dy run data get entity @s Pos[1]',
          'execute store result score @s nc_dz run data get entity @s Pos[2]',
          'scoreboard players set @s nc_died 0',
          ...(bool(options, 'announce')
            ? ['tellraw @a [{"selector":"@s","color":"yellow"},{"text":" died at ","color":"gray"},{"score":{"name":"@s","objective":"nc_dx"},"color":"white"},{"text":" ","color":"gray"},{"score":{"name":"@s","objective":"nc_dy"},"color":"white"},{"text":" ","color":"gray"},{"score":{"name":"@s","objective":"nc_dz"},"color":"white"}]']
            : []),
          'tellraw @s [{"text":"[Waypoint] ","color":"red"},{"text":"You died at ","color":"gray"},{"score":{"name":"@s","objective":"nc_dx"},"color":"white"},{"text":" ","color":"gray"},{"score":{"name":"@s","objective":"nc_dy"},"color":"white"},{"text":" ","color":"gray"},{"score":{"name":"@s","objective":"nc_dz"},"color":"white"},{"text":"  (/trigger deathpoint)","color":"dark_gray"}]'
        ],
        show: [
          'scoreboard players set @s nc_dp 0',
          'tellraw @s [{"text":"[Waypoint] ","color":"red"},{"text":"Last death: ","color":"gray"},{"score":{"name":"@s","objective":"nc_dx"},"color":"white"},{"text":" ","color":"gray"},{"score":{"name":"@s","objective":"nc_dy"},"color":"white"},{"text":" ","color":"gray"},{"score":{"name":"@s","objective":"nc_dz"},"color":"white"}]'
        ]
      }
    })
  },

  {
    id: 'home-waypoints',
    name: 'Home & Waypoints',
    tagline: 'Set a home, then get back to it from anywhere.',
    description:
      'Adds /trigger sethome and /trigger home. Your home is stored per player and the teleport is done with a macro function, so it works across dimensions in the overworld.',
    icon: 'house',
    category: 'Survival',
    // Macro functions ($ arguments) arrived with data pack format 18 (1.20.2).
    minPackFormat: 18,
    options: [{ key: 'cooldown', label: 'Cooldown between teleports (seconds)', type: 'number', default: 10, min: 0, max: 600 }],
    build: ({ options, ns }) => {
      const cooldown = Math.round(num(options, 'cooldown', 10)) * 20
      return {
        functions: {
          load: [
            'scoreboard objectives add nc_sethome trigger',
            'scoreboard objectives add nc_home trigger',
            'scoreboard objectives add nc_hx dummy',
            'scoreboard objectives add nc_hy dummy',
            'scoreboard objectives add nc_hz dummy',
            'scoreboard objectives add nc_hset dummy',
            'scoreboard objectives add nc_cool dummy'
          ],
          tick: [
            'scoreboard players enable @a nc_sethome',
            'scoreboard players enable @a nc_home',
            'execute as @a[scores={nc_cool=1..}] run scoreboard players remove @s nc_cool 1',
            `execute as @a[scores={nc_sethome=1..}] at @s run function ${ns}:set_home`,
            `execute as @a[scores={nc_home=1..}] at @s run function ${ns}:go_home`
          ],
          set_home: [
            'scoreboard players set @s nc_sethome 0',
            'execute store result score @s nc_hx run data get entity @s Pos[0]',
            'execute store result score @s nc_hy run data get entity @s Pos[1]',
            'execute store result score @s nc_hz run data get entity @s Pos[2]',
            'scoreboard players set @s nc_hset 1',
            'tellraw @s [{"text":"[Home] ","color":"green"},{"text":"Home set here.","color":"gray"}]'
          ],
          go_home: [
            'scoreboard players set @s nc_home 0',
            'execute if score @s nc_hset matches 0 run tellraw @s [{"text":"[Home] ","color":"red"},{"text":"No home set yet — use /trigger sethome.","color":"gray"}]',
            `execute if score @s nc_cool matches 1.. run tellraw @s [{"text":"[Home] ","color":"red"},{"text":"Still on cooldown.","color":"gray"}]`,
            `execute if score @s nc_hset matches 1 if score @s nc_cool matches ..0 run function ${ns}:teleport`
          ],
          teleport: [
            // Scores are copied into storage so a macro can read them.
            'execute store result storage nexuscraft:home x int 1 run scoreboard players get @s nc_hx',
            'execute store result storage nexuscraft:home y int 1 run scoreboard players get @s nc_hy',
            'execute store result storage nexuscraft:home z int 1 run scoreboard players get @s nc_hz',
            `function ${ns}:do_teleport with storage nexuscraft:home`,
            ...(cooldown > 0 ? [`scoreboard players set @s nc_cool ${cooldown}`] : []),
            'tellraw @s [{"text":"[Home] ","color":"green"},{"text":"Welcome back.","color":"gray"}]'
          ],
          do_teleport: ['$tp @s $(x) $(y) $(z)']
        }
      }
    }
  },

  {
    id: 'random-teleport',
    name: 'Random Teleport',
    tagline: 'Drop yourself somewhere completely new.',
    description:
      'Adds /trigger rtp, which scatters you to a random safe spot within a radius you choose. Uses vanilla spreadplayers, so it always lands you on solid ground.',
    icon: 'shuffle',
    category: 'Survival',
    options: [
      { key: 'range', label: 'Maximum distance from spawn', type: 'number', default: 5000, min: 200, max: 100000 },
      { key: 'cooldown', label: 'Cooldown (seconds)', type: 'number', default: 60, min: 0, max: 3600 }
    ],
    build: ({ options, ns }) => {
      const range = Math.round(num(options, 'range', 5000))
      const cooldown = Math.round(num(options, 'cooldown', 60)) * 20
      return {
        functions: {
          load: ['scoreboard objectives add nc_rtp trigger', 'scoreboard objectives add nc_rtpcd dummy'],
          tick: [
            'scoreboard players enable @a nc_rtp',
            'execute as @a[scores={nc_rtpcd=1..}] run scoreboard players remove @s nc_rtpcd 1',
            `execute as @a[scores={nc_rtp=1..}] at @s run function ${ns}:go`
          ],
          go: [
            'scoreboard players set @s nc_rtp 0',
            'execute if score @s nc_rtpcd matches 1.. run tellraw @s [{"text":"[RTP] ","color":"red"},{"text":"Still on cooldown.","color":"gray"}]',
            `execute if score @s nc_rtpcd matches ..0 run spreadplayers 0 0 200 ${range} false @s`,
            ...(cooldown > 0 ? [`execute if score @s nc_rtpcd matches ..0 run scoreboard players set @s nc_rtpcd ${cooldown}`] : []),
            'execute if score @s nc_rtpcd matches 1.. run tellraw @s [{"text":"[RTP] ","color":"aqua"},{"text":"Off you go.","color":"gray"}]'
          ]
        }
      }
    }
  },

  {
    id: 'void-rescue',
    name: 'Void Rescue',
    tagline: 'Catches you before the void does.',
    description:
      'If you fall below the world, you are pulled back to a safe height with slow falling instead of dying. Useful in the End, or after a bad ladder.',
    icon: 'lifebuoy',
    category: 'Survival',
    options: [
      { key: 'catchY', label: 'Catch below Y', type: 'number', default: -70, min: -200, max: 0 },
      { key: 'rescueY', label: 'Return to Y', type: 'number', default: 90, min: 0, max: 320 }
    ],
    build: ({ options, ns }) => {
      const catchY = Math.round(num(options, 'catchY', -70))
      const rescueY = Math.round(num(options, 'rescueY', 90))
      return {
        functions: {
          load: ['scoreboard objectives add nc_void dummy'],
          tick: [
            'execute as @a store result score @s nc_void run data get entity @s Pos[1]',
            `execute as @a[scores={nc_void=..${catchY}}] at @s run function ${ns}:rescue`
          ],
          rescue: [
            `tp @s ~ ${rescueY} ~`,
            'effect give @s minecraft:slow_falling 15 0 true',
            'effect give @s minecraft:resistance 10 4 true',
            'tellraw @s [{"text":"[Rescue] ","color":"aqua"},{"text":"Caught you.","color":"gray"}]'
          ]
        }
      }
    }
  },

  {
    id: 'nether-calculator',
    name: 'Nether Calculator',
    tagline: 'The matching Nether coordinates, worked out for you.',
    description:
      'Shows the Nether equivalent of your current position in the action bar — your coordinates divided by eight — so linking portals stops being mental arithmetic.',
    icon: 'calculator',
    category: 'Survival',
    options: [],
    build: () => ({
      functions: {
        load: [
          'scoreboard objectives add nc_nx dummy',
          'scoreboard objectives add nc_nz dummy',
          'scoreboard objectives add nc_const dummy',
          'scoreboard players set #eight nc_const 8'
        ],
        tick: [
          'execute as @a store result score @s nc_nx run data get entity @s Pos[0]',
          'execute as @a store result score @s nc_nz run data get entity @s Pos[2]',
          'execute as @a run scoreboard players operation @s nc_nx /= #eight nc_const',
          'execute as @a run scoreboard players operation @s nc_nz /= #eight nc_const',
          'execute as @a run title @s actionbar ["",{"text":"Nether ","color":"red"},{"score":{"name":"@s","objective":"nc_nx"},"color":"white"},{"text":" / ","color":"gray"},{"score":{"name":"@s","objective":"nc_nz"},"color":"white"}]'
        ]
      }
    })
  },

  /* ============================================================ toys */
  {
    id: 'elevator-blocks',
    name: 'Elevator Blocks',
    tagline: 'Jump on a block to ride up to the next one.',
    description:
      'Stack a chosen block at different heights and jump while standing on one to be lifted to the next above it. Searches up to 64 blocks upward.',
    icon: 'arrow-up',
    category: 'Toys',
    options: [
      {
        key: 'block',
        label: 'Elevator block',
        type: 'select',
        default: 'minecraft:gold_block',
        choices: [
          { value: 'minecraft:gold_block', label: 'Gold block' },
          { value: 'minecraft:diamond_block', label: 'Diamond block' },
          { value: 'minecraft:emerald_block', label: 'Emerald block' },
          { value: 'minecraft:iron_block', label: 'Iron block' },
          { value: 'minecraft:lapis_block', label: 'Lapis block' }
        ]
      }
    ],
    build: ({ options, ns }) => {
      const block = str(options, 'block', 'minecraft:gold_block')
      return {
        functions: {
          load: [
            // The jump statistic increments once per jump, which is the
            // cleanest way vanilla exposes "the player jumped".
            'scoreboard objectives add nc_jump minecraft.custom:minecraft.jump',
            'scoreboard objectives add nc_scan dummy'
          ],
          tick: [
            `execute as @a[scores={nc_jump=1..}] at @s if block ~ ~-1 ~ ${block} run function ${ns}:ascend`,
            'scoreboard players set @a nc_jump 0'
          ],
          ascend: ['scoreboard players set @s nc_scan 0', `function ${ns}:scan`],
          scan: [
            'scoreboard players add @s nc_scan 1',
            `execute if block ~ ~1 ~ ${block} run tp @s ~ ~2 ~`,
            `execute if block ~ ~1 ~ ${block} run playsound minecraft:entity.enderman.teleport master @s ~ ~ ~ 0.4 1.6`,
            // Step upward one block at a time until a landing is found or the
            // search runs out, carrying the position into the next call.
            `execute unless block ~ ~1 ~ ${block} if score @s nc_scan matches ..64 positioned ~ ~1 ~ run function ${ns}:scan`
          ]
        }
      }
    }
  },

  {
    id: 'mob-radar',
    name: 'Mob Radar',
    tagline: 'Hostiles glow through the walls when they get close.',
    description:
      'Nearby hostile mobs are outlined so you can see them coming. Set the range, and optionally only switch it on underground.',
    icon: 'radar',
    category: 'Toys',
    options: [
      { key: 'range', label: 'Detection range (blocks)', type: 'number', default: 24, min: 4, max: 64 },
      { key: 'undergroundOnly', label: 'Only underground', type: 'boolean', default: false },
      { key: 'depth', label: 'Underground means below Y', type: 'number', default: 50, min: -64, max: 320 }
    ],
    build: ({ options, ns }) => {
      const range = Math.round(num(options, 'range', 24))
      const undergroundOnly = bool(options, 'undergroundOnly')
      const depth = Math.round(num(options, 'depth', 50))

      const glow = HOSTILES.map(
        (type) => `execute at @s run effect give @e[type=minecraft:${type},distance=..${range}] minecraft:glowing 2 0 true`
      )

      return {
        functions: {
          load: ['scoreboard objectives add nc_ry dummy'],
          tick: undergroundOnly
            ? [
                'execute as @a store result score @s nc_ry run data get entity @s Pos[1]',
                `execute as @a[scores={nc_ry=..${depth}}] run function ${ns}:sweep`
              ]
            : [`execute as @a run function ${ns}:sweep`],
          sweep: glow
        }
      }
    }
  },

  {
    id: 'speedrun-timer',
    name: 'Speedrun Timer',
    tagline: 'A clock in the action bar, with start and stop.',
    description:
      'Adds /trigger timer_start, /trigger timer_stop and /trigger timer_reset. Counts in real time and shows minutes and seconds to everyone.',
    icon: 'timer',
    category: 'Toys',
    options: [{ key: 'autostart', label: 'Start automatically when the world loads', type: 'boolean', default: false }],
    build: ({ options, ns }) => ({
      functions: {
        load: [
          'scoreboard objectives add nc_t dummy',
          'scoreboard objectives add nc_trun dummy',
          'scoreboard objectives add nc_tc dummy',
          'scoreboard objectives add timer_start trigger',
          'scoreboard objectives add timer_stop trigger',
          'scoreboard objectives add timer_reset trigger',
          'scoreboard players set #sixty nc_tc 60',
          'scoreboard players set #twenty nc_tc 20',
          ...(bool(options, 'autostart') ? ['scoreboard players set #run nc_trun 1'] : ['scoreboard players set #run nc_trun 0'])
        ],
        tick: [
          'scoreboard players enable @a timer_start',
          'scoreboard players enable @a timer_stop',
          'scoreboard players enable @a timer_reset',
          'execute as @a[scores={timer_start=1..}] run function ' + ns + ':start',
          'execute as @a[scores={timer_stop=1..}] run function ' + ns + ':stop',
          'execute as @a[scores={timer_reset=1..}] run function ' + ns + ':reset',
          'execute if score #run nc_trun matches 1 run scoreboard players add #ticks nc_t 1',
          `execute if score #run nc_trun matches 1 run function ${ns}:display`
        ],
        start: [
          'scoreboard players set @s timer_start 0',
          'scoreboard players set #run nc_trun 1',
          'tellraw @a [{"text":"[Timer] ","color":"green"},{"text":"Started.","color":"gray"}]'
        ],
        stop: [
          'scoreboard players set @s timer_stop 0',
          'scoreboard players set #run nc_trun 0',
          'tellraw @a [{"text":"[Timer] ","color":"yellow"},{"text":"Stopped.","color":"gray"}]'
        ],
        reset: [
          'scoreboard players set @s timer_reset 0',
          'scoreboard players set #ticks nc_t 0',
          'tellraw @a [{"text":"[Timer] ","color":"aqua"},{"text":"Reset.","color":"gray"}]'
        ],
        display: [
          // ticks -> seconds -> minutes and remainder
          'scoreboard players operation #sec nc_t = #ticks nc_t',
          'scoreboard players operation #sec nc_t /= #twenty nc_tc',
          'scoreboard players operation #min nc_t = #sec nc_t',
          'scoreboard players operation #min nc_t /= #sixty nc_tc',
          'scoreboard players operation #rem nc_t = #sec nc_t',
          'scoreboard players operation #rem nc_t %= #sixty nc_tc',
          'title @a actionbar ["",{"text":"⏱ ","color":"gold"},{"score":{"name":"#min","objective":"nc_t"},"color":"white"},{"text":"m ","color":"gray"},{"score":{"name":"#rem","objective":"nc_t"},"color":"white"},{"text":"s","color":"gray"}]'
        ]
      }
    })
  },

  {
    id: 'stats-sidebar',
    name: 'Stats Sidebar',
    tagline: "Your own statistics, pulled straight from the game.",
    description:
      "Puts one of Minecraft's own tracked statistics on the sidebar — playtime, mob kills, distance walked or jumps — and keeps it updated.",
    icon: 'bar-chart',
    category: 'Toys',
    options: [
      {
        key: 'stat',
        label: 'Show on the sidebar',
        type: 'select',
        default: 'mob_kills',
        choices: [
          { value: 'mob_kills', label: 'Mob kills' },
          { value: 'play_time', label: 'Playtime (minutes)' },
          { value: 'walk_one_cm', label: 'Distance walked (metres)' },
          { value: 'jump', label: 'Jumps' },
          { value: 'damage_dealt', label: 'Damage dealt' }
        ]
      }
    ],
    build: ({ options, ns }) => {
      const stat = str(options, 'stat', 'mob_kills')
      // Playtime and distance are stored in ticks and centimetres, so they are
      // scaled into units a person actually reads.
      const scaled = stat === 'play_time' ? 1200 : stat === 'walk_one_cm' ? 100 : 1
      const labels: Record<string, string> = {
        mob_kills: 'Mob kills',
        play_time: 'Minutes played',
        walk_one_cm: 'Metres walked',
        jump: 'Jumps',
        damage_dealt: 'Damage dealt'
      }

      const load = [
        `scoreboard objectives add nc_raw minecraft.custom:minecraft.${stat}`,
        'scoreboard objectives add nc_stat dummy',
        'scoreboard objectives add nc_sc dummy',
        `scoreboard objectives modify nc_stat displayname "${labels[stat] ?? 'Stat'}"`,
        'scoreboard objectives setdisplay sidebar nc_stat',
        `scoreboard players set #scale nc_sc ${scaled}`
      ]

      const tick =
        scaled === 1
          ? ['execute as @a run scoreboard players operation @s nc_stat = @s nc_raw']
          : [
              'execute as @a run scoreboard players operation @s nc_stat = @s nc_raw',
              'execute as @a run scoreboard players operation @s nc_stat /= #scale nc_sc'
            ]

      return { functions: { load, tick } }
    }
  },

  /* ================================================== loot and crafting */
  {
    id: 'craft-the-uncraftables',
    name: 'Craft the Uncraftables',
    tagline: 'Recipes for the things vanilla never lets you make.',
    description:
      'Adds crafting recipes for saddles, name tags, horse armour and other items you can normally only find. Balanced to be expensive rather than free.',
    icon: 'hammer',
    category: 'Crafting',
    options: [
      { key: 'saddle', label: 'Saddle', type: 'boolean', default: true },
      { key: 'nameTag', label: 'Name tag', type: 'boolean', default: true },
      { key: 'horseArmour', label: 'Horse armour (iron, gold, diamond)', type: 'boolean', default: true },
      { key: 'elytra', label: 'Elytra (very expensive)', type: 'boolean', default: false }
    ],
    build: ({ options, format }) => {
      // The result field was renamed from `item` to `id` in data pack format 41
      // (Minecraft 1.20.5), so the right shape is chosen from the format.
      const result = (id: string, count = 1): Record<string, unknown> =>
        format >= 41 ? { id, count } : { item: id, count }

      const json: JsonFile[] = []
      const shaped = (name: string, pattern: string[], key: Record<string, string>, out: string, count = 1): void => {
        json.push({
          kind: 'recipe',
          name,
          data: {
            type: 'minecraft:crafting_shaped',
            pattern,
            key: Object.fromEntries(
              Object.entries(key).map(([k, v]) => [k, format >= 41 ? v : { item: v }])
            ),
            result: result(out, count)
          }
        })
      }

      if (bool(options, 'saddle', true)) {
        shaped('saddle', ['LLL', 'L L', 'I I'], { L: 'minecraft:leather', I: 'minecraft:iron_ingot' }, 'minecraft:saddle')
      }
      if (bool(options, 'nameTag', true)) {
        shaped('name_tag', ['  P', ' S ', 'I  '], { P: 'minecraft:paper', S: 'minecraft:string', I: 'minecraft:iron_ingot' }, 'minecraft:name_tag')
      }
      if (bool(options, 'horseArmour', true)) {
        for (const [metal, item] of [
          ['iron_ingot', 'iron_horse_armor'],
          ['gold_ingot', 'golden_horse_armor'],
          ['diamond', 'diamond_horse_armor']
        ]) {
          shaped(item, ['M  ', 'MLM', 'MMM'], { M: `minecraft:${metal}`, L: 'minecraft:leather' }, `minecraft:${item}`)
        }
      }
      if (bool(options, 'elytra')) {
        shaped(
          'elytra',
          ['PMP', 'PDP', 'P P'],
          { P: 'minecraft:phantom_membrane', M: 'minecraft:netherite_ingot', D: 'minecraft:dragon_breath' },
          'minecraft:elytra'
        )
      }

      return { functions: { load: [] }, json }
    }
  },

  {
    id: 'mob-heads',
    name: 'Mob Heads',
    tagline: 'Trophies from the things that tried to kill you.',
    description:
      'Killing a creeper, skeleton, zombie or wither skeleton has a chance to drop its head. Implemented with advancement triggers rather than loot tables, so it does not replace any vanilla drops.',
    icon: 'skull',
    category: 'Crafting',
    options: [
      { key: 'chance', label: 'Drop chance (%)', type: 'number', default: 25, min: 1, max: 100 },
      { key: 'players', label: 'Also drop player heads in PvP', type: 'boolean', default: false }
    ],
    build: ({ options, ns, format }) => {
      const chance = Math.max(1, Math.min(100, Math.round(num(options, 'chance', 25))))
      const mobs: Array<[string, string]> = [
        ['creeper', 'minecraft:creeper_head'],
        ['skeleton', 'minecraft:skeleton_skull'],
        ['wither_skeleton', 'minecraft:wither_skeleton_skull'],
        ['zombie', 'minecraft:zombie_head']
      ]

      const json: JsonFile[] = []
      const functions: Record<string, string[]> = {
        load: ['scoreboard objectives add nc_roll dummy']
      }

      for (const [mob, head] of mobs) {
        // The killed-entity condition is a bare object in older formats and a
        // predicate list from 1.20.5 onward.
        const entityCondition =
          format >= 41
            ? [
                {
                  condition: 'minecraft:entity_properties',
                  entity: 'this',
                  predicate: { type: `minecraft:${mob}` }
                }
              ]
            : { type: `minecraft:${mob}` }

        json.push({
          kind: 'advancement',
          name: `kill_${mob}`,
          data: {
            criteria: {
              kill: {
                trigger: 'minecraft:player_killed_entity',
                conditions: { entity: entityCondition }
              }
            },
            rewards: { function: `${ns}:drop_${mob}` }
          }
        })

        functions[`drop_${mob}`] = [
          // Re-rolling the advancement lets it fire on every kill.
          `advancement revoke @s only ${ns}:kill_${mob}`,
          `execute store result score @s nc_roll run random value 1..100`,
          `execute if score @s nc_roll matches ..${chance} at @s run summon minecraft:item ~ ~1 ~ {Item:{id:"${head}",count:1}}`
        ]
      }

      if (bool(options, 'players')) {
        json.push({
          kind: 'advancement',
          name: 'kill_player',
          data: {
            criteria: { kill: { trigger: 'minecraft:player_killed_entity', conditions: {} } },
            rewards: { function: `${ns}:drop_player` }
          }
        })
        functions.drop_player = [
          `advancement revoke @s only ${ns}:kill_player`,
          'execute at @s run summon minecraft:item ~ ~1 ~ {Item:{id:"minecraft:player_head",count:1}}'
        ]
      }

      return { functions, json }
    }
  },

  {
    id: 'ore-harvest',
    name: 'Ore Harvest',
    tagline: 'Ores give more, and smelt themselves.',
    description:
      'Replaces the drop tables for coal, iron, gold, copper and diamond ore so they yield extra, and optionally drop ingots directly. Silk Touch and Fortune still behave normally.',
    icon: 'pickaxe',
    category: 'Crafting',
    options: [
      { key: 'multiplier', label: 'Extra drops per ore', type: 'number', default: 2, min: 1, max: 5 },
      { key: 'autoSmelt', label: 'Smelt iron, gold and copper automatically', type: 'boolean', default: false }
    ],
    build: ({ options, format }) => {
      const multiplier = Math.max(1, Math.min(5, Math.round(num(options, 'multiplier', 2))))
      const autoSmelt = bool(options, 'autoSmelt')

      // Ore -> [raw drop, smelted drop]
      const ores: Array<[string, string, string]> = [
        ['coal_ore', 'minecraft:coal', 'minecraft:coal'],
        ['deepslate_coal_ore', 'minecraft:coal', 'minecraft:coal'],
        ['iron_ore', 'minecraft:raw_iron', 'minecraft:iron_ingot'],
        ['deepslate_iron_ore', 'minecraft:raw_iron', 'minecraft:iron_ingot'],
        ['copper_ore', 'minecraft:raw_copper', 'minecraft:copper_ingot'],
        ['deepslate_copper_ore', 'minecraft:raw_copper', 'minecraft:copper_ingot'],
        ['gold_ore', 'minecraft:raw_gold', 'minecraft:gold_ingot'],
        ['deepslate_gold_ore', 'minecraft:raw_gold', 'minecraft:gold_ingot'],
        ['diamond_ore', 'minecraft:diamond', 'minecraft:diamond'],
        ['deepslate_diamond_ore', 'minecraft:diamond', 'minecraft:diamond']
      ]

      const silkTouch =
        format >= 41
          ? {
              condition: 'minecraft:match_tool',
              predicate: { predicates: { 'minecraft:enchantments': [{ enchantments: 'minecraft:silk_touch', levels: { min: 1 } }] } }
            }
          : {
              condition: 'minecraft:match_tool',
              predicate: { enchantments: [{ enchantment: 'minecraft:silk_touch', levels: { min: 1 } }] }
            }

      const json: JsonFile[] = ores.map(([ore, raw, smelted]) => ({
        kind: 'loot_table' as const,
        namespace: 'minecraft',
        name: `blocks/${ore}`,
        data: {
          type: 'minecraft:block',
          pools: [
            {
              rolls: 1,
              entries: [
                {
                  type: 'minecraft:alternatives',
                  children: [
                    // Silk Touch keeps the block itself, exactly as vanilla.
                    {
                      type: 'minecraft:item',
                      name: `minecraft:${ore}`,
                      conditions: [silkTouch]
                    },
                    {
                      type: 'minecraft:item',
                      name: autoSmelt ? smelted : raw,
                      functions: [
                        { function: 'minecraft:set_count', count: multiplier, add: false },
                        { function: 'minecraft:apply_bonus', enchantment: 'minecraft:fortune', formula: 'minecraft:ore_drops' },
                        { function: 'minecraft:explosion_decay' }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      }))

      return { functions: { load: [] }, json }
    }
  },

  /* ============================================================== arena */
  {
    id: 'mob-arena',
    name: 'Mob Arena',
    tagline: 'Waves of mobs, right where you stand.',
    description:
      'Adds /trigger arena to start a wave-based fight at your position. Each wave is larger and harder than the last, tracked on a boss bar, with a reward when you clear the final wave.',
    icon: 'swords',
    category: 'Arena',
    options: [
      { key: 'waves', label: 'Number of waves', type: 'number', default: 5, min: 1, max: 20 },
      { key: 'perWave', label: 'Mobs added each wave', type: 'number', default: 3, min: 1, max: 10 },
      { key: 'radius', label: 'Spawn radius (blocks)', type: 'number', default: 8, min: 3, max: 32 },
      { key: 'reward', label: 'Reward for clearing', type: 'select', default: 'diamond', choices: [
        { value: 'none', label: 'Nothing — just bragging rights' },
        { value: 'diamond', label: 'Diamonds' },
        { value: 'netherite', label: 'A netherite ingot' }
      ] }
    ],
    build: ({ options, ns }) => {
      const waves = Math.round(num(options, 'waves', 5))
      const perWave = Math.round(num(options, 'perWave', 3))
      const radius = Math.round(num(options, 'radius', 8))
      const reward = str(options, 'reward', 'diamond')

      const spawns = ['zombie', 'skeleton', 'spider', 'creeper']
      const spawnLines = spawns.map(
        (mob) =>
          `execute if score #wave nc_arena matches 1.. run summon minecraft:${mob} ~${radius} ~1 ~ {Tags:["nc_arena_mob"],PersistenceRequired:1b}`
      )

      const rewardLines =
        reward === 'none'
          ? []
          : reward === 'netherite'
            ? ['give @a[distance=..48] minecraft:netherite_ingot 1']
            : ['give @a[distance=..48] minecraft:diamond 5']

      return {
        functions: {
          load: [
            'scoreboard objectives add nc_arena dummy',
            'scoreboard objectives add arena trigger',
            'scoreboard players set #wave nc_arena 0',
            'scoreboard players set #active nc_arena 0',
            'bossbar add nexuscraft:arena {"text":"Mob Arena"}',
            'bossbar set nexuscraft:arena color red',
            'bossbar set nexuscraft:arena visible false'
          ],
          tick: [
            'scoreboard players enable @a arena',
            `execute as @a[scores={arena=1..}] at @s run function ${ns}:start`,
            // Count what is still alive and move on when the field is clear.
            'execute if score #active nc_arena matches 1 store result score #alive nc_arena run execute if entity @e[tag=nc_arena_mob]',
            'execute if score #active nc_arena matches 1 store result score #alive nc_arena if entity @e[tag=nc_arena_mob]',
            `execute if score #active nc_arena matches 1 if score #alive nc_arena matches 0 run function ${ns}:next_wave`
          ],
          start: [
            'scoreboard players set @s arena 0',
            'execute if score #active nc_arena matches 1 run tellraw @s [{"text":"[Arena] ","color":"red"},{"text":"A fight is already running.","color":"gray"}]',
            `execute if score #active nc_arena matches 0 run function ${ns}:begin`
          ],
          begin: [
            'scoreboard players set #active nc_arena 1',
            'scoreboard players set #wave nc_arena 0',
            'bossbar set nexuscraft:arena visible true',
            'bossbar set nexuscraft:arena players @a',
            `bossbar set nexuscraft:arena max ${waves}`,
            'tellraw @a [{"text":"[Arena] ","color":"red"},{"text":"The fight begins.","color":"gray"}]',
            `function ${ns}:next_wave`
          ],
          next_wave: [
            'scoreboard players add #wave nc_arena 1',
            'execute store result bossbar nexuscraft:arena value run scoreboard players get #wave nc_arena',
            `execute if score #wave nc_arena matches ${waves + 1}.. run function ${ns}:finish`,
            `execute if score #wave nc_arena matches ..${waves} run function ${ns}:spawn_wave`
          ],
          spawn_wave: [
            'tellraw @a [{"text":"[Arena] ","color":"red"},{"text":"Wave ","color":"gray"},{"score":{"name":"#wave","objective":"nc_arena"},"color":"white"}]',
            'playsound minecraft:entity.wither.spawn master @a ~ ~ ~ 0.5 1.4',
            // Each wave spawns a growing ring of mobs around the starting point.
            ...Array.from({ length: perWave }, () => spawnLines).flat()
          ],
          finish: [
            'scoreboard players set #active nc_arena 0',
            'bossbar set nexuscraft:arena visible false',
            'kill @e[tag=nc_arena_mob]',
            'tellraw @a [{"text":"[Arena] ","color":"gold"},{"text":"All waves cleared.","color":"gray"}]',
            'playsound minecraft:ui.toast.challenge_complete master @a ~ ~ ~ 1 1',
            ...rewardLines
          ]
        }
      }
    }
  }
]
