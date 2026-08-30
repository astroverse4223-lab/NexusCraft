import type { Companion } from '@shared/companion'
import { LauncherError } from '../../core/errors'
import { createLogger } from '../../core/logger'
import { toast } from '../../core/events'
import {
  createCompanion,
  getCompanion,
  isCompanionRunning,
  listCompanions,
  startCompanion,
  stopCompanion,
  updateCompanion,
  sayAsCompanion
} from './companionService'
import {
  getHostedServer,
  isHostedServerRunning,
  onHostedServerEvent,
  serverAddress
} from '../servers/hostService'
import { splitAddress } from '../minecraft/argumentBuilder'

const log = createLogger('steward')

/**
 * The resident companion for a hosted server.
 *
 * A launcher-hosted server is up only while its owner's launcher is, so a bot
 * that lives on it can be tied to it exactly: it joins when the server says it
 * is ready and leaves when the server stops. That is the whole difference
 * between "a companion I pointed at my server" and "my server has someone on
 * it" — and it is why this is wiring rather than new machinery.
 */

/** The personality a steward gets, unless the user rewrites it. */
function stewardPersonality(serverName: string, operators: string[]): string {
  const owner = operators[0]
  return (
    `You live on "${serverName}", a Minecraft server run from NexusCraft. You are its resident companion: ` +
    'you greet players by name when they join, answer questions about the world, help with directions and ' +
    'building, and keep an eye on things when nobody else is around. ' +
    (owner ? `${owner} runs this server. ` : '') +
    'Speak briefly and naturally in chat. Do not narrate every action, and never ask for permission to do ' +
    'something small.'
  )
}

/** A username derived from the server name that a Minecraft server will accept. */
function stewardUsername(serverName: string): string {
  const base = serverName.replace(/[^A-Za-z0-9_]/g, '').slice(0, 12) || 'Server'
  return `${base}Bot`.slice(0, 16)
}

/** Every companion assigned to a given server. */
export function stewardsFor(serverId: string): Companion[] {
  return listCompanions().filter((companion) => companion.stewardOf === serverId)
}

export interface DeployStewardResult {
  companion: Companion
  /** True when a new companion profile was created rather than an existing one reused. */
  created: boolean
  /** Set when the companion could not be started, with the reason why. */
  warning: string | null
}

/**
 * Puts a companion on a hosted server, making one if needed.
 *
 * Passing an existing companion converts it into this server's steward rather
 * than creating a second bot: someone who already configured a model and an
 * API key should not have to do it twice.
 */
export function deploySteward(serverId: string, companionId?: string): DeployStewardResult {
  const server = getHostedServer(serverId)

  /*
   * A companion signs in offline — it has no Minecraft account of its own — so
   * a server that verifies players with Mojang will refuse it at the door.
   * Saying so here beats a disconnect the user has to decode.
   */
  if (server.onlineMode) {
    throw new LauncherError('INVALID_INPUT', 'server verifies players with Mojang', {
      title: 'This server will not let a companion in',
      message:
        `"${server.name}" verifies players with Mojang, and a companion has no Minecraft account to verify. ` +
        'Turning that off lets it join; the launcher then keeps the server off the internet unless you ' +
        'explicitly forward the port.',
      actions: [
        `Edit "${server.name}" and turn off "Verify players with Mojang"`,
        'Start the server again, then deploy the companion'
      ]
    })
  }

  const [host, port] = splitAddress(serverAddress(server))

  const existing = companionId ? getCompanion(companionId) : null
  const created = !existing

  const companion = existing ?? createCompanion(stewardUsername(server.name))

  const updated = updateCompanion(companion.id, {
    host,
    port,
    auth: 'offline',
    // Pinning the version avoids a protocol guess against a server we already
    // know the version of.
    version: server.minecraftVersion,
    owner: server.operators[0] ?? companion.owner,
    stewardOf: serverId,
    // Only overwrite a personality the user has not written themselves.
    personality:
      created || !companion.personality.trim() ? stewardPersonality(server.name, server.operators) : companion.personality
  })

  log.info(`${updated.username} is now the steward of "${server.name}"`)

  if (!isHostedServerRunning(serverId)) {
    return {
      companion: updated,
      created,
      warning: 'The server is not running. The companion will join automatically once you start it.'
    }
  }

  try {
    startCompanion(updated.id)
    return { companion: updated, created, warning: null }
  } catch (err) {
    return { companion: updated, created, warning: (err as Error).message }
  }
}

/** Detaches a companion from its server, leaving the profile intact. */
export function dismissSteward(companionId: string): Companion {
  // Reject an unknown id here, where the message is about a companion, rather
  // than letting the update fail with something vaguer.
  getCompanion(companionId)
  if (isCompanionRunning(companionId)) stopCompanion(companionId)
  return updateCompanion(companionId, { stewardOf: '' })
}

/**
 * Follows every hosted server, moving its stewards in and out with it.
 *
 * Registered once at startup. Joining is deferred a few seconds after the
 * server reports ready: the "Done" line lands before the server is actually
 * accepting connections, and a bot that knocks too early gets refused and
 * reports an error the user then has to clear by hand.
 */
export function initStewards(): void {
  onHostedServerEvent((event, serverId, player) => {
    const stewards = stewardsFor(serverId)
    if (stewards.length === 0) return

    if (event === 'ready') {
      for (const steward of stewards) {
        if (isCompanionRunning(steward.id)) continue
        setTimeout(() => {
          // The server may have stopped again in those few seconds.
          if (!isHostedServerRunning(serverId)) return
          try {
            startCompanion(steward.id)
            log.info(`${steward.username} joined its server`)
          } catch (err) {
            log.warn(`${steward.username} could not join: ${(err as Error).message}`)
            toast('warning', `${steward.username} could not join`, (err as Error).message)
          }
        }, 4000).unref()
      }
      return
    }

    if (event === 'stopped') {
      for (const steward of stewards) {
        if (!isCompanionRunning(steward.id)) continue
        try {
          stopCompanion(steward.id)
          log.info(`${steward.username} left with its server`)
        } catch (err) {
          log.warn(`could not stop ${steward.username}: ${(err as Error).message}`)
        }
      }
      return
    }

    if (event === 'player-joined' && player) {
      for (const steward of stewards) {
        // Never greet itself.
        if (!isCompanionRunning(steward.id) || steward.username === player) continue
        sayAsCompanion(steward.id, `Welcome back, ${player}!`)
      }
    }
  })

  log.info('watching hosted servers for resident companions')
}
