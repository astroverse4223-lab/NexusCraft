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
import { captureFrame } from './camera'
import { buildBlueprint, describeResult, groundedOrigin } from './build/builder'
import { blueprintSize } from './build/blueprint'
import type { ToolContext } from './tools/types'
import { setCrewSnapshot } from './tools'
import { findRoutine, RoutineRunner } from './routines'

const send = (message: CompanionOutbound): void => {
  process.send?.(message)
}

const log = (message: string): void => send({ type: 'log', message })

let bot: any = null
let agent: Agent | null = null
let runner: RoutineRunner | null = null
/** Lets a routine's tools be cut short when the worker is told to stop. */
let routineStop = new AbortController()
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
/*
 * The mineflayer helpers, captured at spawn.
 *
 * They are created inside the connection sequence but needed later by anything
 * the launcher asks for out of band — a build started from the interface has no
 * agent turn to borrow them from.
 */
let pathMovements: any = null
let botData: any = null

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

/*
 * The bot cam only runs while somebody is looking at it. Sampling a 41x41
 * column grid twice a second is cheap next to what the bot does anyway, but
 * doing it for every idle companion nobody has open would not be.
 */
let cameraTimer: NodeJS.Timeout | null = null
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
  pathMovements = Movements
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
    botData = mcData
    if (!mcData) {
      send({
        type: 'status',
        status: 'error',
        detail: `Minecraft ${bot.version} is not supported by the bot protocol library yet`
      })
      return
    }

    bot.pathfinder.setMovements(new Movements(bot))

    /*
     * A routine takes the model's place entirely.
     *
     * Nothing below this point is needed when one is named: no agent, no idle
     * nudge, no thinking. The worker drives the same tools directly.
     */
    if (config.routine) {
      const routine = findRoutine(config.routine)
      if (!routine) {
        send({ type: 'status', status: 'error', detail: `there is no routine called "${config.routine}"` })
        return
      }

      spawned = true
      send({
        type: 'status',
        status: 'playing',
        detail: `working as a ${routine.label.toLowerCase()} on ${bot.version}`
      })

      runner = new RoutineRunner(
        routine,
        {
          bot,
          mcData,
          goals,
          Movements,
          owner: config.owner || null,
          log,
          addMemory: () => {},
          setGoal: () => {},
          signal: routineStop.signal,
          announce: (text: string) => {
            try {
              bot.chat(text.slice(0, 240))
            } catch {
              /* not connected */
            }
          }
        } as never,
        (message) => send({ type: 'agentError', message })
      )

      void runner.run()
      instinctTimer = setInterval(() => void runInstincts(bot), 2000)
      return
    }

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
    send({ type: 'status', status: 'error', detail: describeKick(reason, config) })
  })

  bot.on('error', (err: Error) => {
    // A version the data library has not caught up with is worth its own words.
    /*
     * Two different refusals, both about the version and neither worth showing
     * raw. The library declines anything past its ceiling before it connects,
     * and separately has versions it knows of but has no data for yet.
     */
    const tooNew = /version '?([^'\s]+)'? is not supported/i.exec(err.message)
    const missing = /No data available for version (\S+)/i.exec(err.message)

    send({
      type: 'status',
      status: 'error',
      detail: tooNew
        ? describeUnsupportedVersion(tooNew[1])
        : missing
          ? describeMissingVersionData(missing[1])
          : describeFailure(err, config)
    })
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
 * Explains a version the bot library has no data for.
 *
 * minecraft-data lists a version as soon as Mojang ships it but publishes the
 * block and item data later, so a brand new release connects far enough to be
 * rejected with "No data available for version 26.2" — which reads like a fault
 * in the launcher rather than a gap upstream that will fill in on its own. The
 * versions that do work are named, since the useful next step is to run the
 * server on one of them.
 */
function describeUnsupportedVersion(version: string): string {
  let ceiling = ''
  try {
    ceiling = require('mineflayer/lib/version.js').latestSupportedVersion ?? ''
  } catch {
    /* the message stands without it */
  }

  return (
    `The companion cannot play on Minecraft ${version}. The library it uses to speak the game's protocol ` +
    `supports up to ${ceiling || 'an earlier version'}, and refuses anything newer outright — the protocol ` +
    'changes with each release and there is nothing to configure here. Support arrives when that library ' +
    'updates. Point companions at a server running ' +
    `${ceiling || 'a supported version'} or older.`
  )
}

function describeMissingVersionData(version: string): string {
  let usable: string[] = []
  try {
    const data = require('minecraft-data')
    usable = data.versions.pc
      .map((entry: { minecraftVersion: string }) => entry.minecraftVersion)
      .filter((name: string) => !name.includes('-'))
      .filter((name: string) => {
        try {
          return Boolean(data(name))
        } catch {
          return false
        }
      })
      .slice(0, 4)
  } catch {
    /* no list to offer; the message still stands without one */
  }

  return (
    `The companion cannot play on Minecraft ${version} yet. Its protocol library knows the version exists but ` +
    'has not published the block and item data for it — that usually follows within a few weeks of a release, ' +
    'and nothing here needs changing when it does.' +
    (usable.length > 0 ? ` Versions it can play now include ${usable.join(', ')}.` : '')
  )
}

/**
 * Turns a server's kick message into something worth reading.
 *
 * Servers send these as a translation key wrapped in JSON, so what reached the
 * screen was a line like `{"translate":"multiplayer.disconnect.unverified_username"}`
 * — which says nothing to anyone who does not already know what it means, and
 * least of all what to do about it. The handful that actually happen to a
 * companion are spelled out, with the remedy, and anything else is at least
 * stripped of its JSON.
 */
/**
 * Strips the tag wrappers off an NBT value.
 *
 * Minecraft moved chat components from JSON to NBT, so a kick reason now
 * arrives as `{type:'compound', value:{extra:{type:'list', value:[...]}}}`
 * rather than `{extra:[...]}`. Every real word is buried two layers under a
 * `value` key, which is why the raw structure was reaching the activity feed
 * looking like a memory dump.
 */
function untag(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(untag)
  if (value && typeof value === 'object') {
    const node = value as Record<string, unknown>
    // A tagged node is exactly {type, value} — unwrap it and keep going.
    if (typeof node.type === 'string' && 'value' in node && Object.keys(node).length <= 3) {
      return untag(node.value)
    }
    const out: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(node)) out[key] = untag(entry)
    return out
  }
  return value
}

/** Flattens a chat component into the words a person would read. */
function flattenComponent(node: unknown, depth = 0): string {
  if (depth > 16) return ''
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map((child) => flattenComponent(child, depth + 1)).join('')
  if (node && typeof node === 'object') {
    const component = node as { text?: unknown; translate?: unknown; extra?: unknown; with?: unknown }
    const own =
      typeof component.text === 'string'
        ? component.text
        : typeof component.translate === 'string'
          ? component.translate
          : ''
    const extra = component.extra ? flattenComponent(component.extra, depth + 1) : ''
    const args = component.with ? flattenComponent(component.with, depth + 1) : ''
    return `${own}${args}${extra}`
  }
  return ''
}

function describeKick(reason: unknown, config: CompanionConfig): string {
  /*
   * Decode first, then match. The keyword checks below were written against
   * plain JSON and silently stopped matching when the wire format changed, so a
   * whitelist kick — which has a perfectly good explanation here — was coming
   * out as raw NBT alongside everything else.
   */
  const decoded = flattenComponent(untag(reason)).trim()
  const raw = decoded || (typeof reason === 'string' ? reason : JSON.stringify(reason ?? ''))

  if (raw.includes('unverified_username')) {
    return (
      `${config.host}:${config.port} only accepts players verified with Mojang, and the companion is signed ` +
      'in offline. Either turn off "Verify players with Mojang" in the server settings — which is what lets a ' +
      'companion join without a Minecraft account of its own — or give this companion its own Microsoft ' +
      'account that owns the game.'
    )
  }
  if (raw.includes('outdated_server') || raw.includes('outdated_client')) {
    return `The companion and ${config.host}:${config.port} are on different Minecraft versions.`
  }
  if (raw.includes('server_full')) return 'The server is full.'
  if (raw.includes('banned') || raw.includes('You are banned')) {
    return 'This server has banned the companion\'s username.'
  }
  if (raw.includes('whitelist')) {
    return `${config.host}:${config.port} has a whitelist, and the companion's username is not on it.`
  }
  if (raw.includes('flying')) return 'The server kicked the companion for flying.'

  /*
   * A modded world will not take a plain client.
   *
   * The companion speaks vanilla Minecraft, so a Forge or Fabric world that
   * registers its own blocks, items or network channels refuses it during the
   * handshake. This is the usual reason a companion that worked on a vanilla
   * world stops working the moment it is pointed at a modded one.
   */
  if (/mod|channel|registry|fml|forge|fabric|handshake|Incompatible|protocol/i.test(raw)) {
    return (
      `${config.host}:${config.port} refused the companion because it is a modded world and the companion ` +
      `is a plain Minecraft client. The server said: "${raw.slice(0, 140)}". A companion can join a vanilla ` +
      'world or a server whose mods it does not need; it cannot join one that requires mods on the client.'
    )
  }

  // Not one we know: at least give back the words rather than the structure.
  return `The server disconnected the companion: ${raw.slice(0, 200)}`
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
      /*
       * Two very different servers close a connection this abruptly, and
       * asserting the wrong one wastes an afternoon.
       *
       * A verified server rejects an offline companion, which is the obvious
       * case. But so does a Forge server running mods that register network
       * channels: the companion joins as a plain client, cannot answer the mod
       * handshake, and Forge drops it — with `online-mode=false` set correctly
       * the whole time. Blaming authentication there sends someone to check a
       * setting that was never wrong. Both are named, closest cause first.
       */
      return (
        `${where} closed the connection straight away, without saying why. Two things do this:\n\n` +
        '• The server runs Forge or NeoForge mods that register their own network channels — worldgen mods ' +
        'especially. A companion connects as an ordinary client and cannot answer their handshake, so the ' +
        'server drops it. Its log will name the channel it wanted. Removing those mods from the server, or ' +
        'hosting a plain or Paper server for the companion, is the way round it.\n\n' +
        '• The server verifies players with Mojang, and this companion signs in offline. Turn off "Verify ' +
        'players with Mojang", or give the companion its own Microsoft account that owns the game.'
      )
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
  if (cameraTimer) clearInterval(cameraTimer)
  cameraTimer = null
  agent?.stop()
  agent = null
  runner?.stop()
  runner = null
  routineStop.abort()
  routineStop = new AbortController()
  try {
    bot?.quit?.()
  } catch {
    /* already gone */
  }
  bot = null
}

/**
 * A tool context for a build asked for from the launcher rather than by the
 * model. It carries no `llm`, which is correct: the blueprint is already drawn,
 * so nothing in this path needs to think.
 */
function buildContext(activeBot: any): ToolContext {
  return {
    bot: activeBot,
    mcData: botData,
    goals: pathGoals,
    Movements: pathMovements,
    owner: null,
    log,
    addMemory: () => {},
    setGoal: () => {},
    signal: routineStop.signal
  }
}

process.on('message', (message: CompanionInbound) => {
  switch (message.type) {
    case 'start':
      start(message.config).catch((err) => {
        send({ type: 'status', status: 'error', detail: (err as Error).message })
      })
      break

    case 'instruct':
      if (agent) {
        agent.queue(`Your owner says: "${message.text}"`)
      } else if (runner) {
        /*
         * A routine worker has no model to reason with, so it cannot act on
         * free text. Saying so beats the silence: an instruction that vanished
         * without a word looked like the bot ignoring its owner, and — once
         * crews existed — like a foreman's order being carried out when
         * nothing had happened at all.
         */
        log(`cannot act on "${message.text.slice(0, 60)}" while following the ${runner.routineId} routine`)
      } else {
        log('not connected yet')
      }
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

    /*
     * The crew, as the launcher currently sees it. Held rather than acted on:
     * the crew tools read it when the model asks, so a snapshot arriving
     * mid-turn never interrupts what the bot is doing.
     */
    case 'crew':
      setCrewSnapshot(message.snapshot)
      agent?.update({ crew: message.snapshot })
      break

    case 'camera': {
      if (cameraTimer) clearInterval(cameraTimer)
      cameraTimer = null
      if (!message.on) break

      const tick = (): void => {
        if (!bot) return
        try {
          const frame = captureFrame(bot)
          if (frame) send({ type: 'camera', frame })
        } catch {
          /* a frame that cannot be built is not worth reporting every 500ms */
        }
      }
      tick()
      cameraTimer = setInterval(tick, 500)
      break
    }

    /*
     * A blueprint chosen in the launcher. It goes through the same executor the
     * model's own builds use, so behaviour — resuming, material checks, the
     * spawn-protection cutoff — is identical whichever way a build was asked for.
     */
    case 'build': {
      if (!bot) {
        log('not connected yet')
        break
      }
      const blueprint = message.blueprint as Parameters<typeof buildBlueprint>[1]
      const position = bot.entity.position
      const origin = groundedOrigin(
        bot,
        {
          x: Math.floor(position.x) + 2,
          y: Math.floor(position.y),
          z: Math.floor(position.z) + 2
        },
        blueprintSize(blueprint)
      )
      log(`building ${message.label} at ${origin.x} ${origin.y} ${origin.z}`)

      void buildBlueprint(buildContext(bot), blueprint, {
        origin,
        onProgress: (progress) => log(`${progress.placed}/${progress.total} blocks placed`)
      })
        .then((result) => log(describeResult(blueprint, result)))
        .catch((err) => log(`the build stopped: ${(err as Error).message}`))
      break
    }

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
