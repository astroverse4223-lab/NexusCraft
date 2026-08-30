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
 * The protocol is the only figure in a ping that is unambiguous. Version
 * *names* are decoration a server picks for itself: the live catalogue check
 * turned up "Velocity 1.7.2-26.2", "§f§fWe support: 1.20-1.21" and a Paper
 * server listing fifteen versions at once, none of which can be parsed
 * reliably. Protocol 767 means 1.21.1/1.21 and nothing else.
 */
export function versionsForProtocol(protocol: number | null): string[] {
  if (protocol === null || !Number.isFinite(protocol)) return []
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
  const serverVersions = versionsForProtocol(status?.protocol ?? null)
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

  candidates.sort((a, b) => a.rank - b.rank || a.instance.name.localeCompare(b.instance.name))
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
