/**
 * The companion bot, run as a separate process.
 *
 * Keeping it out of the launcher's main process matters: mineflayer maintains a
 * live protocol connection and the agent runs untrusted-ish model output, so a
 * crash here must never take the launcher — or a running game — down with it.
 * Everything is exchanged with the supervisor over process IPC messages.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { CompanionConfig, CompanionOutbound, CompanionInbound } from '@shared/companion'
import { Agent } from './agent'

const send = (message: CompanionOutbound): void => {
  process.send?.(message)
}

const log = (message: string): void => send({ type: 'log', message })

let bot: any = null
let agent: Agent | null = null
let tickTimer: NodeJS.Timeout | null = null
let stopping = false
let spawned = false

/**
 * Immediate self-defence, without waiting for the model.
 *
 * The companion spent most of its life standing still: a turn ends, and it
 * waits out the idle interval before deciding anything. A zombie hits for
 * around three, so a bot that only reacts once its health reaches six — and
 * then needs a full model round trip to decide what to do — is dead before it
 * answers. Players do not deliberate when something bites them.
 *
 * This runs only while no turn is in progress. Mid-action the tools do their
 * own danger checks, and two things steering the pathfinder at once is worse
 * than either alone.
 */
const HOSTILE_NAMES = new Set([
  'zombie', 'husk', 'drowned', 'zombie_villager', 'zombified_piglin',
  'skeleton', 'stray', 'bogged', 'wither_skeleton',
  'creeper', 'spider', 'cave_spider', 'enderman', 'endermite',
  'witch', 'slime', 'magma_cube', 'blaze', 'ghast', 'phantom',
  'pillager', 'vindicator', 'evoker', 'ravager', 'vex', 'illusioner',
  'silverfish', 'guardian', 'elder_guardian', 'shulker', 'hoglin', 'zoglin',
  'piglin_brute', 'warden', 'breeze', 'creaking'
])

const REFLEX_FLEE_HEALTH = 8
let reflexBusy = false
/** Pathfinder goals, captured when the bot starts so the reflex can use them. */
let pathGoals: any = null

function nearestHostile(activeBot: any, within: number): any | null {
  let best: any = null
  let bestDistance = within
  for (const entity of Object.values(activeBot.entities) as any[]) {
    if (!entity?.position || entity === activeBot.entity) continue
    if (!HOSTILE_NAMES.has(String(entity.name ?? ''))) continue
    const distance = entity.position.distanceTo(activeBot.entity.position)
    if (distance < bestDistance) {
      bestDistance = distance
      best = entity
    }
  }
  return best
}

async function reflexDefend(activeBot: any, threat: any): Promise<void> {
  if (reflexBusy) return
  reflexBusy = true
  try {
    if (activeBot.health > REFLEX_FLEE_HEALTH) {
      // Healthy enough to answer back. Hold something sharp and swing.
      const weapon = activeBot.inventory
        .items()
        .filter((i: any) => /_(sword|axe)$/.test(i.name))
        .sort((a: any, b: any) => b.name.length - a.name.length)[0]
      if (weapon && activeBot.heldItem?.type !== weapon.type) {
        await activeBot.equip(weapon, 'hand').catch(() => undefined)
      }
      await activeBot.lookAt(threat.position.offset(0, 1, 0)).catch(() => undefined)
      activeBot.attack(threat)
      log(`hit back at the ${threat.name}`)
    } else {
      // Too hurt to trade blows: put distance between them.
      const away = activeBot.entity.position.minus(threat.position).normalize().scaled(10)
      const goal = activeBot.entity.position.offset(away.x, 0, away.z)
      if (pathGoals) activeBot.pathfinder?.setGoal(new pathGoals.GoalNear(goal.x, goal.y, goal.z, 2))
      log(`backing away from the ${threat.name} at ${Math.round(activeBot.health)}/20`)
      setTimeout(() => activeBot.pathfinder?.setGoal(null), 6000)
    }
  } catch {
    /* a reflex that fails is not worth reporting as an error */
  } finally {
    setTimeout(() => {
      reflexBusy = false
    }, 800)
  }
}

/**
 * The things a player does without thinking.
 *
 * The companion had tools to eat, swim and step out of fire, but nothing ever
 * reached for them: every one waited on the model noticing the problem and
 * choosing to act, which costs a round trip the bot often does not have. It
 * would drown holding bread, or starve while carrying a stack of steak.
 *
 * These run on a short timer, only while no turn is in progress, and each is
 * deliberately small — reflexes, not plans. Anything requiring judgement is
 * still the model's job.
 */
const EDIBLE = /cooked_|bread|apple|carrot|potato|beetroot|melon_slice|steak|mutton|rabbit|stew|berries|golden_/
const HUNGRY_AT = 16
const DROWNING_AT = 8

let instinctTimer: NodeJS.Timeout | null = null
let instinctBusy = false

async function runInstincts(activeBot: any): Promise<void> {
  if (instinctBusy || !activeBot?.entity) return
  if (agent?.isBusy()) return

  instinctBusy = true
  try {
    /* ---- drowning: get to the surface --------------------------------- */
    if (typeof activeBot.oxygenLevel === 'number' && activeBot.oxygenLevel < DROWNING_AT) {
      const head = activeBot.blockAt(activeBot.entity.position.offset(0, 1, 0))
      if (head && head.name.includes('water')) {
        activeBot.setControlState('jump', true)
        log(`out of air (${activeBot.oxygenLevel}) — swimming up`)
        setTimeout(() => activeBot.setControlState('jump', false), 2500)
        return
      }
    }

    /* ---- standing in something that hurts ----------------------------- */
    const feet = activeBot.blockAt(activeBot.entity.position)
    const below = activeBot.blockAt(activeBot.entity.position.offset(0, -1, 0))
    const burning = [feet, below].find((b: any) => b && /lava|fire|magma|campfire/.test(b.name))
    if (burning) {
      const escape = activeBot.entity.position.offset(
        (Math.random() - 0.5) * 8,
        0,
        (Math.random() - 0.5) * 8
      )
      if (pathGoals) activeBot.pathfinder?.setGoal(new pathGoals.GoalNear(escape.x, escape.y, escape.z, 1))
      log(`standing in ${burning.name} — moving off it`)
      setTimeout(() => activeBot.pathfinder?.setGoal(null), 4000)
      return
    }

    /* ---- hunger: eat before it becomes a problem ---------------------- */
    if (activeBot.food <= HUNGRY_AT) {
      const food = activeBot.inventory.items().find((i: any) => EDIBLE.test(i.name))
      if (food) {
        try {
          await activeBot.equip(food, 'hand')
          await activeBot.consume()
          log(`ate ${food.name} at ${activeBot.food}/20 hunger`)
        } catch {
          /* eating can be interrupted; it will come round again */
        }
      }
    }
  } catch {
    /* an instinct that fails should never take the bot down with it */
  } finally {
    instinctBusy = false
  }
}

async function start(config: CompanionConfig): Promise<void> {
  const mineflayer = require('mineflayer')
  const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
  pathGoals = goals
  const minecraftData = require('minecraft-data')

  send({ type: 'status', status: 'connecting', detail: `${config.host}:${config.port}` })

  const options: Record<string, unknown> = {
    host: config.host,
    port: config.port,
    username: config.username,
    // 'offline' is for your own LAN world or local server, which do not
    // authenticate. 'microsoft' signs the bot in as a real account.
    auth: config.auth,
    hideErrors: true
  }
  if (config.version) options.version = config.version

  bot = mineflayer.createBot(options)
  bot.loadPlugin(pathfinder)

  bot.once('spawn', () => {
    const mcData = minecraftData(bot.version)
    if (!mcData) {
      send({
        type: 'status',
        status: 'error',
        detail: `Minecraft ${bot.version} is not supported by the bot protocol library yet`
      })
      return
    }

    bot.pathfinder.setMovements(new Movements(bot))

    agent = new Agent(
      bot,
      { mcData, goals, Movements },
      {
        llm: config.llm,
        personality: config.personality,
        owner: config.owner || null,
        autonomy: config.autonomy,
        idleIntervalSec: config.idleIntervalSec,
        memory: config.memory ?? []
      },
      {
        log,
        thought: (text) => send({ type: 'thought', text }),
        action: (name, args, result) => send({ type: 'action', name, args, result }),
        memoryChanged: (notes) => send({ type: 'memory', notes }),
        goalChanged: (goal) => send({ type: 'goal', goal }),
        error: (message) => send({ type: 'agentError', message })
      }
    )

    spawned = true
    send({ type: 'status', status: 'playing', detail: `spawned as ${bot.username} on ${bot.version}` })
    log(`connected to ${config.host}:${config.port} as ${bot.username} (Minecraft ${bot.version})`)

    // The idle nudge is what turns a command-taker into a companion.
    tickTimer = setInterval(() => agent?.tick(), 5000)
    // Reflexes run far more often than decisions do.
    instinctTimer = setInterval(() => void runInstincts(bot), 2000)
  })

  bot.on('chat', (username: string, message: string) => {
    if (username === bot.username) return
    send({ type: 'chat', from: username, message })

    // Only react when spoken to, or when the message names the bot, so it does
    // not interrupt every conversation on a busy server.
    const mentioned =
      message.toLowerCase().includes(bot.username.toLowerCase()) ||
      !config.owner ||
      username === config.owner
    if (mentioned) agent?.queue(`${username} said in chat: "${message}"`)
  })

  let lastHealth = 20
  bot.on('health', () => {
    const hurt = bot.health < lastHealth
    lastHealth = bot.health

    if (!hurt) return

    /*
     * Defend first, explain second. Waiting for the model to decide costs
     * seconds the bot does not have, and on a local model considerably more.
     */
    const threat = nearestHostile(bot, 6)
    if (threat && agent && !agent.isBusy()) void reflexDefend(bot, threat)

    if (bot.health <= 12) {
      agent?.queue(
        threat
          ? `[event] A ${threat.name} is attacking you and you are on ${Math.round(bot.health)}/20 health. Fight it or get away.`
          : `[event] You are hurt — ${Math.round(bot.health)}/20 health. Work out why and deal with it.`
      )
    }
  })

  bot.on('death', () => {
    send({ type: 'status', status: 'playing', detail: 'died and respawned' })
    agent?.queue('[event] You just died and respawned. Consider recovering your things.')
  })

  bot.on('kicked', (reason: string) => {
    send({ type: 'status', status: 'error', detail: `kicked: ${String(reason).slice(0, 200)}` })
  })

  bot.on('error', (err: Error) => {
    send({ type: 'status', status: 'error', detail: describeFailure(err, config) })
    /*
     * A failure before the bot ever spawned means there is no session to keep
     * alive. Lingering here left an empty process behind that made the
     * supervisor refuse the next Start as "already connected", with the screen
     * showing no bot and therefore no Stop button to clear it.
     */
    if (!spawned) {
      shutdown()
      process.exit(0)
    }
  })

  bot.on('end', (reason: string) => {
    if (!stopping) send({ type: 'status', status: 'disconnected', detail: String(reason ?? '') })
  })
}

/**
 * Turns a connection failure into something a player can act on.
 *
 * Node's socket errors reach mineflayer with an empty `message` often enough
 * that the message alone cannot be trusted — a refused connection was showing
 * up in the activity feed as the bare word "error", which says nothing. The
 * `code` is the reliable field, so it is read first.
 */
function describeFailure(err: unknown, config: CompanionConfig): string {
  const failure = err as NodeJS.ErrnoException | undefined
  const where = `${config.host}:${config.port}`

  switch (failure?.code) {
    case 'ECONNREFUSED':
      return `Nothing is listening on ${where}. The companion joins a server as a second player, so a server has to be running before it can connect — open your world to LAN, or start a dedicated server, then try again.`
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return `Could not find a server at "${config.host}". Check the address for a typo.`
    case 'ETIMEDOUT':
      return `${where} never answered. Check the port and whether a firewall is blocking it.`
    case 'ECONNRESET':
      return `${where} closed the connection immediately. An online-mode server will do this unless the companion signs in with its own Microsoft account that owns Minecraft.`
    default:
      break
  }

  const message = (failure?.message ?? '').trim() || String(err ?? '').trim()

  // A version mismatch is the next most likely failure, so it is named too.
  if (/unsupported protocol|unknown version|protocol version/i.test(message)) {
    return `${message} — the bot library does not support this Minecraft version yet`
  }

  return message || `the connection to ${where} failed without giving a reason`
}

function shutdown(): void {
  stopping = true
  if (tickTimer) clearInterval(tickTimer)
  tickTimer = null
  if (instinctTimer) clearInterval(instinctTimer)
  instinctTimer = null
  agent?.stop()
  agent = null
  try {
    bot?.quit?.()
  } catch {
    /* already gone */
  }
  bot = null
}

process.on('message', (message: CompanionInbound) => {
  switch (message.type) {
    case 'start':
      start(message.config).catch((err) => {
        send({ type: 'status', status: 'error', detail: (err as Error).message })
      })
      break

    case 'instruct':
      if (!agent) return log('not connected yet')
      agent.queue(`Your owner says: "${message.text}"`)
      break

    case 'say':
      try {
        bot?.chat(message.text.slice(0, 240))
      } catch {
        /* not connected */
      }
      break

    case 'configure':
      agent?.update({
        autonomy: message.autonomy,
        personality: message.personality,
        idleIntervalSec: message.idleIntervalSec
      })
      log(`settings updated (autonomy ${message.autonomy ? 'on' : 'off'})`)
      break

    case 'stop':
      shutdown()
      /*
       * Give the disconnect a moment to reach the server before the process
       * goes. Exiting immediately after quit() left the packet unsent, the
       * server kept the companion standing in the world until it timed out, and
       * anything hostile nearby killed it and scattered everything it carried.
       */
      setTimeout(() => process.exit(0), 400)
      break
  }
})

process.on('uncaughtException', (err) => {
  send({ type: 'status', status: 'error', detail: `bot crashed: ${err.message}` })
  shutdown()
  process.exit(1)
})

process.on('unhandledRejection', (reason) => {
  log(`unhandled rejection in the bot: ${String(reason).slice(0, 200)}`)
})
