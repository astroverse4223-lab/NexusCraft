/**
 * Talking, looking, and the companion's own bookkeeping.
 *
 * These are the tools with no physical effect on the world: the model uses them to
 * report back, to check what it is carrying, and to leave itself notes.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { FORBIDDEN_COMMANDS } from '../constants'
import type { Tool } from '../types'
import { gameModeName } from '../support/world'
import { itemCounts, nearbyPlayers } from '../support/players'
import { nearbyThreats } from '../support/combat'
import { wornArmour } from '../support/equipment'

export const TOOLS: Tool[] = [
  {
    schema: {
      name: 'say',
      description: 'Say something in Minecraft chat so the player can read it. Use this to reply, ask questions, or report what you are doing.',
      parameters: {
        type: 'object',
        properties: { message: { type: 'string', description: 'What to say. Keep it short and natural.' } },
        required: ['message']
      }
    },
    execute: async ({ bot }, { message }) => {
      const text = String(message ?? '').slice(0, 240)
      if (!text) return 'nothing to say'
      bot.chat(text)
      return `said: ${text}`
    }
  },

  {
    schema: {
      name: 'look_around',
      description: 'Observe the surroundings: position, health, time of day, nearby players, mobs and notable blocks. Use this when you need to know what is going on.',
      parameters: { type: 'object', properties: {} }
    },
    execute: async ({ bot }) => {
      const pos = bot.entity.position
      const entities = Object.values(bot.entities) as any[]

      const mobs = entities
        .filter((e) => e.type === 'mob' && e.position.distanceTo(pos) < 24)
        .map((e) => `${e.name} at ${Math.round(e.position.distanceTo(pos))}m`)
        .slice(0, 8)

      const players = nearbyPlayers(bot)
        .map((name) => {
          const entity = bot.players[name]?.entity
          return entity ? `${name} at ${Math.round(entity.position.distanceTo(pos))}m` : `${name} (out of range)`
        })
        .slice(0, 6)

      const drops = entities.filter((e) => e.name === 'item' && e.position.distanceTo(pos) < 16).length

      /*
       * Say what is being worn. Armour was invisible to the model: it never
       * appeared here, and it is not in the inventory once equipped, so the
       * only way to find out was to try putting some on and read the reply.
       */
      const armour = wornArmour(bot)

      return [
        `position ${Math.round(pos.x)} ${Math.round(pos.y)} ${Math.round(pos.z)}`,
        `health ${Math.round(bot.health)}/20, food ${Math.round(bot.food)}/20`,
        armour.length > 0 ? `wearing ${armour.join(', ')}` : 'wearing no armour',
        `time ${bot.time.timeOfDay < 12000 ? 'day' : 'night'}`,
        // Game mode changes what is even possible: creative drops nothing when
        // you mine, so the model needs to know which world it is in.
        `mode ${gameModeName(bot)}`,
        // Night with hostiles about is the single most useful thing to know,
        // and "time night" alone did not say whether anything was hunting.
        ...(() => {
          const threats = nearbyThreats(bot)
          if (threats.length > 0) return [`THREATS: ${threats.join(', ')}`]
          if (bot.time.timeOfDay >= 12000) return ['no hostiles in sight, but it is night — they spawn in the dark']
          return []
        })(),
        `players: ${players.length ? players.join(', ') : 'none nearby'}`,
        `mobs: ${mobs.length ? mobs.join(', ') : 'none nearby'}`,
        `dropped items nearby: ${drops}`,
        `inventory: ${itemCounts(bot)}`
      ].join('\n')
    }
  },

  {
    schema: {
      name: 'inventory',
      description: 'List everything currently carried.',
      parameters: { type: 'object', properties: {} }
    },
    execute: async ({ bot }) => `carrying: ${itemCounts(bot)}`
  },

  {
    schema: {
      name: 'remember',
      description: 'Save a durable note — a base location, a promise made, something learned. Notes survive restarts and are shown to you every turn.',
      parameters: {
        type: 'object',
        properties: { note: { type: 'string', description: 'A short fact worth keeping' } },
        required: ['note']
      }
    },
    execute: async ({ addMemory }, { note }) => {
      const text = String(note ?? '').slice(0, 200)
      if (!text) return 'nothing to remember'
      addMemory(text)
      return `remembered: ${text}`
    }
  },

  {
    schema: {
      name: 'set_goal',
      description: 'Record what you are currently working towards, so you keep track across turns. Set it to an empty string when finished.',
      parameters: {
        type: 'object',
        properties: { goal: { type: 'string', description: 'The current objective' } },
        required: ['goal']
      }
    },
    execute: async ({ setGoal }, { goal }) => {
      const text = String(goal ?? '').slice(0, 160)
      setGoal(text || null)
      return text ? `working towards: ${text}` : 'goal cleared'
    }
  },

  {
    schema: {
      name: 'wait',
      description: 'Do nothing for a few seconds. Use when there is genuinely nothing worth doing.',
      parameters: {
        type: 'object',
        properties: { seconds: { type: 'number', description: 'How long to wait, up to 30' } }
      }
    },
    execute: async ({ signal }, { seconds }) => {
      const ms = Math.max(1, Math.min(Number(seconds) || 5, 30)) * 1000
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, ms)
        signal.addEventListener('abort', () => {
          clearTimeout(timer)
          resolve(null)
        }, { once: true })
      })
      return 'waited'
    }
  },

  {
    schema: {
      name: 'run_command',
      description:
        'Run a Minecraft command, such as "time set day", "weather clear" or "tp Steve". Only works if the server has made this bot an operator. Do not use it to obtain items or win fights in survival — mine and craft instead.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The command without the leading slash, e.g. time set day' }
        },
        required: ['command']
      }
    },
    execute: async ({ bot }, { command }) => {
      const text = String(command ?? '')
        .trim()
        .replace(/^\//, '')
      if (!text) return 'run_command needs a command'

      const verb = text.split(/\s+/)[0].toLowerCase()

      /*
       * Administrative and irreversible commands are refused outright. The model
       * is not malicious, but it is confused often enough that "it seemed like a
       * good idea" should not be able to ban a player, wipe a world or strip the
       * owner's operator status.
       */
      if (FORBIDDEN_COMMANDS.has(verb)) {
        return `refusing to run "${verb}" — that one can lock people out or destroy things that cannot be undone. Ask the player to run it themselves.`
      }

      if (text.length > 200) return 'that command is too long'

      bot.chat(`/${text}`)
      /*
       * The server replies in chat rather than to the sender, and there is no
       * acknowledgement packet to await, so this reports what was sent rather
       * than claiming it worked.
       */
      return `sent "/${text}". If nothing changed, this bot is probably not an operator on the server.`
    }
  }
]
