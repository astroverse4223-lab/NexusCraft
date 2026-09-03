import type { Instance, LoaderId, ServerStatus } from '@shared/types'

/**
 * Choosing which instance to launch when joining someone else's server.
 *
 * Getting this wrong is not a cosmetic problem: launching a 1.21.1 Fabric pack
 * at a 1.20.1 server produces "Outdated client" or a registry-sync failure that
 * names no cause, and the player is left guessing. So the version the server
 * actually speaks decides, and when nothing on disk can speak it the launcher
 * says so instead of starting the wrong thing.
 */

interface ProtocolEntry {
  minecraftVersion: string
  version: number
  majorVersion: string
  releaseType?: string
}

/**
 * Minecraft versions that speak a given protocol number, newest first.
 *
 * The protocol is exact where it is available: 767 means 1.21.1/1.21 and
 * nothing else. It is not always available, though — a proxy asked with the
 * conventional "any version" handshake echoes that back instead of answering,
 * and then the version *name* is all there is. See `versionsFromName`.
 */
export function versionsForProtocol(protocol: number | null): string[] {
  if (protocol === null || !Number.isFinite(protocol) || protocol < 0) return []
  try {
    const mcData = require('minecraft-data') as { versions: { pc: ProtocolEntry[] } }
    return mcData.versions.pc
      .filter((entry) => entry.version === protocol && entry.releaseType !== 'snapshot')
      .map((entry) => entry.minecraftVersion)
  } catch {
    // Without the data table there is nothing to match on; the caller then
    // falls back to trusting the user's explicit choice.
    return []
  }
}

/** Every release, newest first — the ordering used to compare versions. */
function releaseOrder(): string[] {
  try {
    const mcData = require('minecraft-data') as { versions: { pc: ProtocolEntry[] } }
    return mcData.versions.pc
      .filter((entry) => entry.releaseType !== 'snapshot')
      .map((entry) => entry.minecraftVersion)
  } catch {
    return []
  }
}

/**
 * Reads the version range out of a server's *name*.
 *
 * Needed because a proxy does not answer the protocol question. The launcher
 * pings with protocol -1, meaning "reply whatever your version is", which is
 * the usual convention — but Velocity echoes that -1 straight back rather than
 * reporting its own, so the number is useless and the name is all there is.
 *
 * Happily the name is better data than the protocol for this case: a proxy
 * advertises the whole span it accepts ("Velocity 1.7.2-26.2"), where a
 * protocol number could only ever name one. Paper's multi-version strings
 * ("1.20-1.21") read the same way.
 */
export function versionsFromName(versionName: string | null): string[] {
  if (!versionName) return []

  const order = releaseOrder()
  if (order.length === 0) return []

  const rank = new Map(order.map((version, index) => [version, index]))

  // Version-shaped tokens, e.g. 1.7.2, 1.21, 26.2. Longest first so "1.21.1"
  // is not read as "1.21".
  const tokens = (versionName.match(/\d+\.\d+(?:\.\d+)?/g) ?? []).filter((token) => rank.has(token))
  if (tokens.length === 0) return []
  if (tokens.length === 1) return [tokens[0]]

  // Lower index means newer, so the newest bound is the smallest index.
  const positions = tokens.map((token) => rank.get(token) as number)
  const newest = Math.min(...positions)
  const oldest = Math.max(...positions)

  // Everything the server says it accepts, newest first.
  return order.slice(newest, oldest + 1)
}

export interface JoinCandidate {
  instance: Instance
  /** Why this one is a fit, in the order preferences were applied. */
  rank: number
  reason: string
}

/**
 * Ranks the instances that could join a server, best first.
 *
 * Vanilla wins ties because most public servers run Paper, Spigot or a
 * Velocity proxy, which speak the vanilla protocol; a heavy client pack adds
 * failure modes without adding anything the server can use.
 */
export function rankInstancesForServer(
  status: ServerStatus | null,
  instances: Instance[]
): { candidates: JoinCandidate[]; serverVersions: string[] } {
  /*
   * Protocol first, because it is exact. The name is the fallback for proxies,
   * which is not a rare edge case — most large public servers run behind one.
   */
  const serverVersions =
    versionsForProtocol(status?.protocol ?? null).length > 0
      ? versionsForProtocol(status?.protocol ?? null)
      : versionsFromName(status?.versionName ?? null)

  if (serverVersions.length === 0) return { candidates: [], serverVersions }

  // "1.21.1" -> "1.21", so a 1.21.1 client still counts for a 1.21 server.
  const majors = new Set(serverVersions.map(majorOf))

  const candidates: JoinCandidate[] = []
  for (const instance of instances) {
    const exact = serverVersions.includes(instance.minecraftVersion)
    const sameMajor = majors.has(majorOf(instance.minecraftVersion))
    if (!exact && !sameMajor) continue

    const vanilla = instance.loader === 'vanilla'
    const rank = exact ? (vanilla ? 0 : 1) : vanilla ? 2 : 3

    candidates.push({
      instance,
      rank,
      reason: exact
        ? vanilla
          ? `matches ${instance.minecraftVersion} exactly`
          : `matches ${instance.minecraftVersion}, with ${loaderLabel(instance.loader)}`
        : `close enough — ${instance.minecraftVersion} against a ${serverVersions[0]} server`
    })
  }

  /*
   * Within a rank, prefer the newest version the server accepts.
   *
   * A proxy advertising 1.7.2 through 26.2 makes every instance an exact match,
   * and falling back to alphabetical order would send a 1.7.2 client at a
   * modern server for want of a tiebreak. `serverVersions` is newest-first, so
   * its index is the ordering.
   */
  const newness = new Map(serverVersions.map((version, index) => [version, index]))
  candidates.sort(
    (a, b) =>
      a.rank - b.rank ||
      (newness.get(a.instance.minecraftVersion) ?? 9999) - (newness.get(b.instance.minecraftVersion) ?? 9999) ||
      a.instance.name.localeCompare(b.instance.name)
  )
  return { candidates, serverVersions }
}

/** "1.21.1" -> "1.21"; "1.21" -> "1.21". */
function majorOf(version: string): string {
  const parts = version.split('.')
  return parts.length >= 2 ? `${parts[0]}.${parts[1]}` : version
}

function loaderLabel(loader: LoaderId): string {
  switch (loader) {
    case 'fabric':
      return 'Fabric'
    case 'forge':
      return 'Forge'
    case 'neoforge':
      return 'NeoForge'
    case 'quilt':
      return 'Quilt'
    default:
      return 'no loader'
  }
}
