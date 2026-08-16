import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Instance, SavedServer, ServerStatus } from '@shared/types'
import { db, Collections } from '../../core/database'
import { emit } from '../../core/events'
import { LauncherError } from '../../core/errors'
import { createLogger } from '../../core/logger'
import { pingServer, stripFormatting } from './mcPing'
import { parseNbt, nbtString, nbtCompound } from '../worlds/nbt'
import { splitAddress } from '../minecraft/argumentBuilder'

const log = createLogger('servers')

export function listServers(): SavedServer[] {
  return db()
    .all<SavedServer>(Collections.servers)
    .sort(
      (a, b) =>
        Number(b.favorite) - Number(a.favorite) ||
        a.sortOrder - b.sortOrder ||
        (b.lastJoinedAt ?? 0) - (a.lastJoinedAt ?? 0) ||
        a.name.localeCompare(b.name)
    )
}

export function getServer(id: string): SavedServer {
  const server = db().get<SavedServer>(Collections.servers, id)
  if (!server) throw new LauncherError('NOT_FOUND', `server ${id} does not exist`)
  return server
}

export interface SaveServerInput {
  id: string | null
  name: string
  address: string
  port: number
  notedVersion?: string | null
  description?: string | null
  favorite?: boolean
  preferredInstanceId?: string | null
}

export function saveServer(input: SaveServerInput): SavedServer {
  const existing = input.id ? db().get<SavedServer>(Collections.servers, input.id) : null

  // A pasted "host:port" should not become a host containing a colon.
  const [host, parsedPort] = splitAddress(input.address)
  const port = input.port && input.port !== 25565 ? input.port : parsedPort

  const server: SavedServer = {
    id: existing?.id ?? randomUUID(),
    name: input.name.trim().slice(0, 64) || host,
    address: host,
    port,
    notedVersion: input.notedVersion?.slice(0, 64) ?? existing?.notedVersion ?? null,
    description: input.description?.slice(0, 512) ?? existing?.description ?? null,
    favorite: input.favorite ?? existing?.favorite ?? false,
    preferredInstanceId: input.preferredInstanceId ?? existing?.preferredInstanceId ?? null,
    lastJoinedAt: existing?.lastJoinedAt ?? null,
    createdAt: existing?.createdAt ?? Date.now(),
    sortOrder: existing?.sortOrder ?? Date.now()
  }

  db().put(Collections.servers, server.id, server)
  return server
}

export function deleteServer(id: string): void {
  getServer(id)
  db().remove(Collections.servers, id)
  statusCache.delete(id)
}

export function setFavorite(id: string, favorite: boolean): SavedServer {
  const server = getServer(id)
  const next = { ...server, favorite }
  db().put(Collections.servers, id, next)
  return next
}

export function recordJoin(id: string): void {
  const server = db().get<SavedServer>(Collections.servers, id)
  if (!server) return
  db().put(Collections.servers, id, { ...server, lastJoinedAt: Date.now() })
}

/* --------------------------------------------------------------- status */

const statusCache = new Map<string, ServerStatus>()
const inFlight = new Map<string, Promise<ServerStatus>>()

export function cachedStatuses(): ServerStatus[] {
  return [...statusCache.values()]
}

/**
 * Pings a server for real. The result is only ever "online" when the server
 * actually answered; anything else stays null or false with a reason.
 */
export async function checkServer(id: string): Promise<ServerStatus> {
  const pending = inFlight.get(id)
  if (pending) return pending

  const server = getServer(id)

  const promise = (async (): Promise<ServerStatus> => {
    // Publish an "unknown" state immediately so the card can show a spinner
    // rather than a stale or invented result.
    const pendingStatus: ServerStatus = {
      serverId: id,
      online: null,
      checkedAt: Date.now(),
      latencyMs: null,
      playersOnline: null,
      playersMax: null,
      versionName: null,
      protocol: null,
      motd: null,
      faviconDataUrl: statusCache.get(id)?.faviconDataUrl ?? null,
      error: null
    }
    statusCache.set(id, pendingStatus)
    emit('servers:status', pendingStatus)

    const result = await pingServer(server.address, server.port)

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
          serverId: id,
          online: false,
          checkedAt: Date.now(),
          latencyMs: null,
          playersOnline: null,
          playersMax: null,
          versionName: null,
          protocol: null,
          motd: null,
          faviconDataUrl: statusCache.get(id)?.faviconDataUrl ?? null,
          error: result.error
        }

    statusCache.set(id, status)
    emit('servers:status', status)
    return status
  })()

  inFlight.set(id, promise)
  try {
    return await promise
  } finally {
    inFlight.delete(id)
  }
}

/** Pings everything, a few at a time so a long list does not stall. */
export async function checkAllServers(): Promise<ServerStatus[]> {
  const servers = listServers()
  const results: ServerStatus[] = []
  const batchSize = 5

  for (let i = 0; i < servers.length; i += batchSize) {
    const batch = servers.slice(i, i + batchSize)
    results.push(
      ...(await Promise.all(
        batch.map((server) =>
          checkServer(server.id).catch(
            (): ServerStatus => ({
              serverId: server.id,
              online: false,
              checkedAt: Date.now(),
              latencyMs: null,
              playersOnline: null,
              playersMax: null,
              versionName: null,
              protocol: null,
              motd: null,
              faviconDataUrl: null,
              error: 'The check could not be completed.'
            })
          )
        )
      ))
    )
  }
  return results
}

/* --------------------------------------------------------------- import */

/**
 * Imports the server list Minecraft itself keeps in servers.dat, so a user
 * moving from the official launcher does not have to retype anything.
 */
export async function importFromInstance(instance: Instance): Promise<number> {
  const file = join(instance.gameDir, 'servers.dat')
  if (!existsSync(file)) {
    throw new LauncherError('NOT_FOUND', 'no servers.dat in this instance', {
      title: 'No server list found',
      message: `This instance has no servers.dat yet. Minecraft writes it once you add a server in game.`,
      actions: ['Launch the instance and add a server in Minecraft first', 'Or add servers here by hand']
    })
  }

  const root = await parseNbt(await readFile(file))
  const list = root.servers
  if (!Array.isArray(list)) return 0

  const existing = listServers()
  let imported = 0

  for (const entry of list) {
    const compound = nbtCompound(entry)
    if (!compound) continue
    const ip = nbtString(compound.ip)
    if (!ip) continue

    const [host, port] = splitAddress(ip)
    // Skip anything already saved so repeated imports do not duplicate.
    if (existing.some((s) => s.address.toLowerCase() === host.toLowerCase() && s.port === port)) continue

    saveServer({
      id: null,
      name: stripFormatting(nbtString(compound.name) ?? host).slice(0, 64),
      address: host,
      port,
      description: null,
      notedVersion: null
    })
    imported++
  }

  log.info(`imported ${imported} server(s) from ${instance.name}`)
  return imported
}
