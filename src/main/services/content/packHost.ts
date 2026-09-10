import { existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { basename } from 'node:path'
import type { PackHostStatus } from '@shared/resourcePacks'
import { LauncherError } from '../../core/errors'
import { createLogger } from '../../core/logger'
import { db } from '../../core/database'
import { localNetworkAddress } from '../servers/hostService'

const log = createLogger('packhost')

/**
 * Handing a resource pack to the people who join.
 *
 * A server does not send the pack itself. It sends a url and a hash, and every
 * client fetches the file over plain http - so putting a pack on a server means
 * the file has to be somewhere clients can reach, which is what this is.
 *
 * It serves exactly one file and answers nothing else. Not a static file
 * server pointed at a folder: a single path, one known file, and 404 for
 * everything else, because this listens on a port that may be reachable from
 * outside the house.
 */

/** Minecraft refuses a pack larger than this, so there is no point serving one. */
const MAX_BYTES = 250 * 1024 * 1024

export interface ServedPack {
  file: string
  sha1: string
}

let server: Server | null = null
let listening = 0
let served: ServedPack | null = null

/**
 * The page served at the root, when there is one.
 *
 * A function rather than a string so it is rendered per request - the whole
 * point of the page is that it shows who is on now, and a snapshot taken when
 * the listener started would be wrong within a minute.
 */
let site: (() => Promise<string>) | null = null

export function serveSite(render: (() => Promise<string>) | null): void {
  site = render
  log.info(render === null ? 'site is no longer served' : 'site is being served')
}

export function sitePath(): string {
  return '/'
}

/** Where the last served pack is remembered. */
const REMEMBERED = 'servedPack'

/**
 * What was being served last time, brought back.
 *
 * `served` is a variable in this file, so it was empty every time the launcher
 * started - and starting the website binds the port without setting it. The
 * result was a listener answering the site perfectly and 404ing the pack, with
 * a server still publishing that url and every player told only that the pack
 * failed to download. Nothing anywhere said the launcher had simply forgotten
 * which file it was handing out.
 */
function remember(pack: ServedPack): void {
  try {
    db().kvSet(REMEMBERED, JSON.stringify(pack))
  } catch (err) {
    log.warn(`could not remember the served pack: ${(err as Error).message}`)
  }
}

function recall(): void {
  if (served !== null) return

  try {
    const raw = db().kvGet(REMEMBERED)
    if (!raw) return

    const pack = JSON.parse(raw) as ServedPack

    // Only if it is still there. A pack deleted between runs is not a pack to
    // start answering with.
    if (!pack?.file || !pack?.sha1 || !existsSync(pack.file)) return

    served = pack
    log.info(`serving ${basename(pack.file)} again from last time`)
  } catch (err) {
    log.warn(`could not recall the served pack: ${(err as Error).message}`)
  }
}

/**
 * The url path, which is the hash rather than the file name.
 *
 * Clients cache a pack by url. Two different packs served at `/pack.zip` are
 * the same url, so a client that already has the old one keeps using it and
 * never sees the change - which reads as "the launcher did not rebuild it".
 * Naming the path after the contents makes a changed pack a changed url.
 */
function pathFor(pack: ServedPack): string {
  return `/${pack.sha1}.zip`
}

export function packHostStatus(): PackHostStatus {
  return {
    running: server !== null,
    port: server === null ? null : listening,
    localAddress: localNetworkAddress(),
    path: served === null ? null : pathFor(served),
    sha1: served?.sha1 ?? null,
    bytes: null
  }
}

/** What gets served from now on. Replacing it does not interrupt the listener. */
export async function servePack(pack: ServedPack): Promise<void> {
  if (!existsSync(pack.file)) {
    throw new LauncherError('NOT_FOUND', `no pack at ${pack.file}`, {
      title: 'That pack file is gone',
      message: 'Build the pack again before serving it.'
    })
  }

  const size = (await stat(pack.file)).size

  if (size > MAX_BYTES) {
    throw new LauncherError('INVALID_INPUT', `pack too large: ${size}`, {
      title: 'That pack is too big to hand out',
      message:
        `Minecraft refuses a resource pack over 250MB, and this one is ` +
        `${Math.round(size / 1024 / 1024)}MB. Sounds are almost always the reason.`,
      actions: ['Use shorter audio, or fewer sounds']
    })
  }

  served = pack
  log.info(`serving ${basename(pack.file)} (${size} bytes) at ${pathFor(pack)}`)

  remember(pack)
}

/**
 * Starts listening, or moves to a different port.
 *
 * Nothing is done to the firewall. Windows asks the first time a port is
 * bound and the answer is the user's to give - which is the same arrangement
 * the rest of the launcher works under.
 */
export async function startPackHost(port: number): Promise<PackHostStatus> {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new LauncherError('INVALID_INPUT', `bad port ${port}`, {
      title: 'That is not a usable port',
      message: 'Pick a number between 1024 and 65535.'
    })
  }

  if (server !== null && listening === port) return packHostStatus()

  stopPackHost()

  const next = createServer((request, response) => {
    const pack = served

    // Only ever GET or HEAD, and only ever the one path.
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { allow: 'GET, HEAD' }).end()
      return
    }

    const asked = (request.url ?? '').split('?')[0]

    // The public page, when one is being served.
    if (site !== null && (asked === '/' || asked === '/index.html')) {
      void site()
        .then((html) => {
          response.writeHead(200, {
            'content-type': 'text/html; charset=utf-8',
            // Rendered per request from files on disk, so caching it would
            // show yesterday's leaderboard to anyone who came back.
            'cache-control': 'no-store'
          })

          response.end(request.method === 'HEAD' ? undefined : html)
        })
        .catch((err) => {
          log.warn(`could not render the site: ${(err as Error).message}`)
          if (!response.headersSent) response.writeHead(500).end()
          else response.end()
        })

      return
    }

    if (pack === null || asked !== pathFor(pack) || !existsSync(pack.file)) {
      response.writeHead(404, { 'content-type': 'text/plain' }).end('no pack here')
      return
    }

    void (async () => {
      try {
        const size = (await stat(pack.file)).size

        response.writeHead(200, {
          'content-type': 'application/zip',
          'content-length': String(size),
          'content-disposition': 'attachment; filename="pack.zip"',
          // The url already changes when the pack does, so this can be cached
          // hard - it is the same bytes forever or it is a different url.
          'cache-control': 'public, max-age=31536000, immutable'
        })

        if (request.method === 'HEAD') {
          response.end()
          return
        }

        createReadStream(pack.file).pipe(response)
      } catch (err) {
        log.warn(`could not serve the pack: ${(err as Error).message}`)
        if (!response.headersSent) response.writeHead(500).end()
        else response.end()
      }
    })()
  })

  await new Promise<void>((resolve, reject) => {
    const failed = (err: NodeJS.ErrnoException): void => {
      next.removeListener('listening', ready)

      if (err.code === 'EADDRINUSE') {
        reject(
          new LauncherError('ALREADY_RUNNING', `port ${port} is taken`, {
            title: `Something else is already on port ${port}`,
            message: 'Pick a different port for the pack.',
            actions: ['Try another port']
          })
        )
        return
      }

      /*
       * Windows reserves whole blocks of ports and refuses them outright.
       *
       * Hyper-V and WSL claim ranges above 49152 in particular, and binding
       * into one fails with EACCES rather than "in use" - which reads as a
       * permissions problem the user cannot fix and is really just a port
       * they are not allowed to have.
       */
      if (err.code === 'EACCES') {
        reject(
          new LauncherError('INVALID_INPUT', `port ${port} is reserved`, {
            title: `Windows will not allow port ${port}`,
            message:
              'Whole blocks of ports are reserved by the system, usually by Hyper-V or WSL, ' +
              'and nothing else may listen on them.',
            actions: [
              'Try a port between 1024 and 49151',
              'Run "netsh interface ipv4 show excludedportrange protocol=tcp" to see which are reserved'
            ]
          })
        )
        return
      }

      reject(err)
    }

    const ready = (): void => {
      next.removeListener('error', failed)
      resolve()
    }

    next.once('error', failed)
    next.once('listening', ready)
    next.listen(port)
  })

  server = next
  listening = port
  log.info(`pack host listening on ${port}`)

  // Whatever was being handed out last time, if nothing has been set since.
  recall()

  return packHostStatus()
}

export function stopPackHost(): void {
  if (server === null) return

  /*
   * Sockets as well as the listener.
   *
   * `close` only stops new connections being accepted. Anything already
   * connected keeps its keep-alive socket and carries on being served, so
   * "stop serving" did not stop serving - and the port stayed bound long
   * enough that starting again on it failed as already in use.
   */
  server.closeAllConnections()
  server.close()

  server = null
  listening = 0
  log.info('pack host stopped')
}

/**
 * Whether that url can actually be fetched from here.
 *
 * Worth asking, because the answer is surprisingly often no. Many home routers
 * will not route a machine back to its own public address - "NAT hairpinning"
 * - so a url built from the address the world sees is unreachable from inside
 * the house. The server accepts it, the client tries it, and the player gets
 * "failed to download" with nothing saying which of a dozen things went wrong.
 *
 * A failure here does not mean the url is wrong for everybody else. It means
 * it is wrong for whoever is sitting at this machine, which is usually the
 * person testing it.
 */
export async function canFetch(url: string, timeoutMs = 6000): Promise<boolean> {
  const stop = new AbortController()
  const timer = setTimeout(() => stop.abort(), timeoutMs)

  try {
    const response = await fetch(url, { method: 'HEAD', signal: stop.signal })
    return response.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

/** The url a server should publish, given the address players reach it on. */
export function packUrl(address: string, port: number): string | null {
  if (served === null) return null

  return `http://${address}:${port}${pathFor(served)}`
}
