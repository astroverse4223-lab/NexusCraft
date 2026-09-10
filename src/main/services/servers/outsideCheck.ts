/**
 * Asking somebody outside the house whether the server answers.
 *
 * The check built into the share dialog pings the public address from this
 * machine, and that is close to worthless for the question people actually
 * have. Most routers refuse to let a device inside the network reach its own
 * public address — hairpin NAT, which plenty of consumer routers simply do not
 * do — so a working, properly forwarded server reports "no answer" from the
 * inside and sends its owner off to fix something that was never broken.
 *
 * The only way to know is to have a machine somewhere else try it. This asks a
 * public Minecraft status service to do exactly that, which is the same thing
 * every listing site does with the address once it is submitted.
 *
 * That is an outward-facing act — the address is handed to a third party — so
 * nothing here runs on its own. It happens when somebody presses the button.
 */
import type { OutsideCheck } from '@shared/types'

import { createLogger } from '../../core/logger'
import { getHostedServer, isHostedServerRunning } from './hostService'
import { discoverGateway, externalAddress } from './portForwarding'

const log = createLogger('outside-check')

/** Long enough for a cold lookup, short enough not to look hung. */
const TIMEOUT_MS = 20_000

interface StatusReply {
  online?: boolean
  motd?: { clean?: string[] }
  players?: { online?: number; max?: number }
  version?: string
  debug?: {
    ping?: boolean
    query?: boolean
    cachehit?: boolean
    cacheexpire?: number
    error?: { ping?: string; query?: string }
  }
}

/**
 * Whether a failed status ping still proves the port is open.
 *
 * The service reports `online: false` for two situations that mean opposite
 * things here. It never reached the machine - "Failed to connect or create a
 * socket: 110 (Connection timed out)" - which is the port not getting through.
 * Or it connected and could not make sense of the reply - "Unknown problem with
 * returned server data" - which is what a hardened or proxied server does, and
 * which means the port is open after all. Hypixel answers exactly that way.
 *
 * Only the first is a forwarding problem, so only the first is reported as one.
 */
function neverConnected(error: string | undefined): boolean {
  if (!error) return true
  return /failed to connect|timed out|refused|unreachable|no route/i.test(error)
}

/**
 * Whether the world can reach this server right now.
 *
 * Deliberately refuses to guess when the server is stopped. A stopped server
 * fails this test for a reason that has nothing to do with the router, and
 * reporting that as "not reachable" is how somebody ends up rewriting firewall
 * rules to fix a server they had turned off — which is exactly what happened
 * here before this existed.
 */
export async function checkFromOutside(id: string): Promise<OutsideCheck> {
  const server = getHostedServer(id)

  if (!isHostedServerRunning(server.id)) {
    return {
      reachable: false,
      address: null,
      motd: null,
      players: null,
      version: null,
      note:
        'The server is not running, so nothing would answer regardless of the router. ' +
        'Start it and check again — a closed port and a stopped server look identical from outside.'
    }
  }

  const gateway = await discoverGateway()
  const external = gateway ? await externalAddress(gateway) : null

  if (!external) {
    return {
      reachable: false,
      address: null,
      motd: null,
      players: null,
      version: null,
      note:
        'No public address could be found. The router did not answer, so there is nothing to test from outside yet.'
    }
  }

  const address = `${external}:${server.port}`

  let reply: StatusReply
  try {
    const answer = await fetch(`https://api.mcsrvstat.us/3/${address}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      /*
       * A User-Agent, because the service answers 403 to requests without a
       * recognisable one - which a diagnostic then reads as "your port is
       * shut" rather than "the question was refused".
       */
      headers: {
        Accept: 'application/json',
        'User-Agent': 'NexusCraftLauncher/1.3.2 (+port reachability check)'
      }
    })

    if (!answer.ok) {
      return {
        reachable: false,
        address,
        motd: null,
        players: null,
        version: null,
        note: `The checking service answered ${answer.status}, so this proves nothing either way. Try again in a moment.`
      }
    }

    reply = (await answer.json()) as StatusReply
  } catch (err) {
    log.warn(`could not reach the status service: ${(err as Error).message}`)
    return {
      reachable: false,
      address,
      motd: null,
      players: null,
      version: null,
      note:
        'The checking service could not be reached, so this says nothing about your server — only about the ' +
        'connection to that service.'
    }
  }

  if (!reply.online) {
    /*
     * A cached "no" is not an answer.
     *
     * The service keeps each address's result for five minutes. Check a server
     * while it is stopped, start it, and press the button again inside that
     * window and it reports a timeout for a server that is up and answering -
     * which is exactly what happened here, and sent somebody hunting through
     * router settings that were correct all along.
     *
     * A cached "yes" is still proof; something reached it. Only the failure is
     * thrown away.
     */
    if (reply.debug?.cachehit) {
      const expires = reply.debug.cacheexpire
      const seconds = expires ? Math.max(0, Math.round(expires - Date.now() / 1000)) : null

      return {
        reachable: false,
        address,
        motd: null,
        players: null,
        version: null,
        note:
          `This is a cached answer from before, not a fresh test of ${address}, so it proves nothing. ` +
          (seconds
            ? `Try again in about ${seconds} second${seconds === 1 ? '' : 's'}, once the cache clears.`
            : 'Try again in a few minutes, once the cache clears.')
      }
    }

    const failure = reply.debug?.error?.ping

    if (!neverConnected(failure)) {
      return {
        reachable: true,
        address,
        motd: null,
        players: null,
        version: null,
        note:
          `Something outside your network connected to ${address}, but could not read the reply. The port is ` +
          'getting through — which is the part that depends on your router. Players should be able to join.'
      }
    }

    return {
      reachable: false,
      address,
      motd: null,
      players: null,
      version: null,
      note:
        `Nothing answered at ${address} from outside your network — the connection timed out. The server is ` +
        'running, so the port is not getting through: check the router is forwarding it, and that your ISP ' +
        'allows incoming connections.'
    }
  }

  const players =
    reply.players && typeof reply.players.online === 'number'
      ? `${reply.players.online} of ${reply.players.max ?? '?'}`
      : null

  log.info(`${address} answered from outside`)

  return {
    reachable: true,
    address,
    motd: reply.motd?.clean?.join(' ')?.trim() || null,
    players,
    version: reply.version ?? null,
    note: `A machine outside your network reached ${address}. Port forwarding is working — anyone can join at that address.`
  }
}
