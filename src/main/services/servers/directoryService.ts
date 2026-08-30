import type { DirectoryServer, DirectoryCategory, ServerStatus } from '@shared/types'
import { emit } from '../../core/events'
import { createLogger } from '../../core/logger'
import { getJson } from '../../core/http'
import { LauncherError } from '../../core/errors'
import { getSettings } from '../settings/settingsService'
import { pingServer, stripFormatting, resolveServerAddress } from './mcPing'
import { BUNDLED_DIRECTORY, DIRECTORY_CATEGORIES } from './serverCatalogue'

const log = createLogger('directory')

/**
 * The public server browser.
 *
 * Every figure this serves comes from pinging the server itself. Nothing is
 * cached from a third party and nothing is assumed: a server that does not
 * answer is reported offline with the reason, never quietly hidden or shown
 * with a stale player count.
 */

const statusCache = new Map<string, ServerStatus>()
const inFlight = new Map<string, Promise<ServerStatus>>()

/** How long a ping result is treated as current. */
const STATUS_TTL_MS = 60_000

/** Servers pinged at once. The public list is long and mostly remote. */
const PING_CONCURRENCY = 8

/* ----------------------------------------------------------- the catalogue */

let remoteCatalogue: DirectoryServer[] | null = null
let remoteFetchedAt = 0
/** The url the cache was built from, so changing it in Settings takes effect. */
let remoteCatalogueUrl = ''

/** Bundled entries, replaced wholesale by a custom feed when one is configured. */
export function catalogue(): DirectoryServer[] {
  return remoteCatalogue ?? BUNDLED_DIRECTORY
}

export function categories(): typeof DIRECTORY_CATEGORIES {
  return DIRECTORY_CATEGORIES
}

/** Keeps a hand-written feed from turning into a crash or a spoofed entry. */
function sanitiseEntry(raw: unknown, index: number): DirectoryServer | null {
  if (!raw || typeof raw !== 'object') return null
  const entry = raw as Record<string, unknown>

  const name = typeof entry.name === 'string' ? entry.name.trim().slice(0, 64) : ''
  const address = typeof entry.address === 'string' ? entry.address.trim().slice(0, 255) : ''
  if (!name || !address) return null

  const port = typeof entry.port === 'number' && entry.port >= 1 && entry.port <= 65535 ? Math.round(entry.port) : 25565
  const known = DIRECTORY_CATEGORIES.some((c) => c.id === entry.category)

  return {
    id: typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim().slice(0, 64) : `remote-${index}`,
    name,
    address,
    port,
    category: known ? (entry.category as DirectoryCategory) : 'survival',
    description: typeof entry.description === 'string' ? entry.description.trim().slice(0, 300) : '',
    version: typeof entry.version === 'string' ? entry.version.trim().slice(0, 32) : null,
    tags: Array.isArray(entry.tags)
      ? entry.tags.filter((t): t is string => typeof t === 'string').slice(0, 6).map((t) => t.slice(0, 24))
      : []
  }
}

/**
 * Replaces the bundled list from `directoryUrl`, when one is set.
 *
 * The bundled list ages: servers close, move, or rename, and a list compiled
 * into the binary cannot follow them. Pointing this at a JSON file you control
 * makes the screen yours without a new build.
 */
export async function loadRemoteCatalogue(force = false): Promise<{ entries: number; source: 'bundled' | 'remote' }> {
  const url = getSettings().directoryUrl.trim()
  if (!url) {
    remoteCatalogue = null
    remoteCatalogueUrl = ''
    return { entries: BUNDLED_DIRECTORY.length, source: 'bundled' }
  }

  // Re-fetching on every visit to the screen would be rude to whoever hosts it.
  // A changed url is not a cache hit, though, or editing it in Settings would
  // appear to do nothing for half an hour.
  if (!force && remoteCatalogue && remoteCatalogueUrl === url && Date.now() - remoteFetchedAt < 30 * 60_000) {
    return { entries: remoteCatalogue.length, source: 'remote' }
  }

  if (!url.startsWith('https://')) {
    throw new LauncherError('INVALID_INPUT', 'the server list url must be https', {
      title: 'That server list address was refused',
      message: 'NexusCraft only fetches a custom server list over https.',
      actions: ['Use an https:// address, or clear the box to go back to the built-in list']
    })
  }

  const payload = await getJson<unknown>(url, { timeoutMs: 15_000 })
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { servers?: unknown }).servers)
      ? ((payload as { servers: unknown[] }).servers)
      : null

  if (!rows) {
    throw new LauncherError('INVALID_INPUT', 'the server list was not an array', {
      title: 'That server list could not be read',
      message: 'The file has to be a JSON array of servers, or an object with a "servers" array.',
      actions: ['Check the file, or clear the box to go back to the built-in list']
    })
  }

  const parsed = rows.map(sanitiseEntry).filter((e): e is DirectoryServer => e !== null).slice(0, 500)
  if (parsed.length === 0) {
    throw new LauncherError('INVALID_INPUT', 'no usable entries in the server list', {
      title: 'That server list had nothing in it',
      message: 'Every entry needs at least a name and an address.',
      actions: ['Check the file, or clear the box to go back to the built-in list']
    })
  }

  remoteCatalogue = parsed
  remoteCatalogueUrl = url
  remoteFetchedAt = Date.now()
  log.info(`loaded ${parsed.length} servers from a custom directory`)
  return { entries: parsed.length, source: 'remote' }
}

/* -------------------------------------------------------------- pinging */

function unknownStatus(id: string): ServerStatus {
  return {
    serverId: id,
    online: null,
    checkedAt: Date.now(),
    latencyMs: null,
    playersOnline: null,
    playersMax: null,
    versionName: null,
    protocol: null,
    motd: null,
    // A previously fetched icon is worth keeping through a re-check so the row
    // does not flicker back to a placeholder.
    faviconDataUrl: statusCache.get(id)?.faviconDataUrl ?? null,
    error: null
  }
}

/** Pings one address and publishes the result under `id`. */
async function pingInto(id: string, address: string, port: number): Promise<ServerStatus> {
  const pending = inFlight.get(id)
  if (pending) return await pending

  const promise = (async (): Promise<ServerStatus> => {
    const placeholder = unknownStatus(id)
    statusCache.set(id, placeholder)
    emit('directory:status', placeholder)

    const result = await pingServer(address, port, 6000)

    const status: ServerStatus = result.online
      ? {
          serverId: id,
          online: true,
          checkedAt: Date.now(),
          latencyMs: result.latencyMs,
          playersOnline: result.playersOnline,
          playersMax: result.playersMax,
          versionName: result.versionName ? stripFormatting(result.versionName) : null,
          protocol: result.protocol,
          motd: result.motd,
          faviconDataUrl: result.faviconDataUrl,
          error: null
        }
      : {
          ...unknownStatus(id),
          online: false,
          error: result.error
        }

    statusCache.set(id, status)
    emit('directory:status', status)
    return status
  })()

  inFlight.set(id, promise)
  try {
    return await promise
  } finally {
    inFlight.delete(id)
  }
}

/** Everything known right now, without waiting for a ping. */
export function cachedDirectoryStatuses(): ServerStatus[] {
  return [...statusCache.values()]
}

export async function pingDirectoryServer(id: string): Promise<ServerStatus> {
  const entry = catalogue().find((server) => server.id === id)
  if (!entry) throw new LauncherError('NOT_FOUND', `no directory server with id ${id}`)
  return await pingInto(entry.id, entry.address, entry.port)
}

/**
 * Refreshes the whole list a few at a time.
 *
 * Skips anything checked recently unless forced, so moving between categories
 * does not re-ping thirty servers each time.
 */
export async function refreshDirectory(force = false): Promise<ServerStatus[]> {
  const entries = catalogue()
  const due = force
    ? entries
    : entries.filter((entry) => {
        const cached = statusCache.get(entry.id)
        return !cached || Date.now() - cached.checkedAt > STATUS_TTL_MS
      })

  for (let i = 0; i < due.length; i += PING_CONCURRENCY) {
    const batch = due.slice(i, i + PING_CONCURRENCY)
    await Promise.all(
      batch.map((entry) =>
        pingInto(entry.id, entry.address, entry.port).catch((err) => {
          log.warn(`could not ping ${entry.address}: ${(err as Error).message}`)
        })
      )
    )
  }

  return cachedDirectoryStatuses()
}

/* --------------------------------------------------------- ad-hoc lookup */

export interface AddressLookup {
  address: string
  port: number
  /** What the address resolved to, when an SRV record pointed elsewhere. */
  resolvedAddress: string
  resolvedPort: number
  status: ServerStatus
}

/**
 * Turns what a person pasted into a host and a port.
 *
 * Kept separate from the ping so the parsing is testable on its own, and
 * because this is where the awkward input lands: a bare host, a host:port, a
 * copied `minecraft://` link, an IPv6 literal in brackets, or a trailing slash
 * picked up from a web page.
 */
export function parseServerAddress(rawAddress: string): { host: string; port: number } {
  const trimmed = rawAddress.trim()
  if (!trimmed) {
    throw new LauncherError('INVALID_INPUT', 'no address given', {
      title: 'Enter a server address',
      message: 'Type the address a server gave you, like play.example.com.',
      actions: []
    })
  }

  const withoutScheme = trimmed.replace(/^minecraft:\/\//i, '').replace(/\/+$/, '')

  // Bracketed IPv6 keeps its colons; everything else splits on the last one.
  const bracketed = /^\[([^\]]+)\](?::(\d{1,5}))?$/.exec(withoutScheme)
  const match = bracketed ?? /^([^:]+)(?::(\d{1,5}))?$/.exec(withoutScheme)

  if (!match) {
    throw new LauncherError('INVALID_INPUT', 'that address could not be read', {
      title: 'That does not look like a server address',
      message: 'Enter something like play.example.com, or play.example.com:25566 if it uses a different port.',
      actions: []
    })
  }

  const host = match[1].trim()
  const port = match[2] ? Number(match[2]) : 25565

  if (!host || host.length > 255 || /\s/.test(host)) {
    throw new LauncherError('INVALID_INPUT', 'that address could not be read', {
      title: 'That does not look like a server address',
      message: 'Enter something like play.example.com, or play.example.com:25566 if it uses a different port.',
      actions: []
    })
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new LauncherError('INVALID_INPUT', 'port out of range', {
      title: 'That port number is not valid',
      message: 'A port has to be between 1 and 65535.',
      actions: []
    })
  }

  return { host, port }
}

/**
 * Pings an address the user typed, so a server a friend just sent them can be
 * checked and joined without adding it to anything first.
 */
export async function lookupAddress(rawAddress: string): Promise<AddressLookup> {
  const { host, port } = parseServerAddress(rawAddress)

  const resolved = await resolveServerAddress(host, port)
  // Keyed by address so repeated lookups of the same server reuse the row.
  const id = `lookup:${host}:${port}`
  const status = await pingInto(id, host, port)

  return {
    address: host,
    port,
    resolvedAddress: resolved.host,
    resolvedPort: resolved.port,
    status
  }
}
