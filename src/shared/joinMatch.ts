import type { Instance, SavedServer, ServerStatus } from './types'

/**
 * Working out which instance to join a server with.
 *
 * Pressing Join used to launch whichever instance happened to be selected on
 * the Instances screen, which is the last one played - so joining a 1.12.2
 * modpack server straight after playing 1.21 launched 1.21 at it and the
 * server refused the connection. The instance you want is decided by the
 * server, not by what you did last.
 *
 * Nothing here talks to anything. It is given what is already known about the
 * server and what instances exist, and returns a decision, so the awkward
 * cases - several that fit, none that fit, a server that never answered a ping
 * - can be written down and tested rather than discovered.
 */

export type JoinChoice =
  /** The server names one and it is still there. */
  | { kind: 'preferred'; instance: Instance }
  /** Matched on version. */
  | { kind: 'matched'; instance: Instance; version: string }
  /** Nothing to match on, but there is only one instance, so it is that one. */
  | { kind: 'only'; instance: Instance }
  /** Nothing fits. `wanted` is the version to make, when that is known. */
  | { kind: 'none'; wanted: string | null }

/**
 * Every version this server might be, best guess first.
 *
 * A server's reported name is free text and it is under no obligation to be a
 * version at all: proxies announce ranges like "1.8-1.21", and plenty of
 * servers put their own name in it. So everything version-shaped is taken out
 * of it rather than the whole string being trusted, and what the owner wrote
 * down by hand is kept as a fallback for a server that has never answered.
 */
export function serverVersions(
  status: ServerStatus | null | undefined,
  notedVersion: string | null | undefined
): string[] {
  const found: string[] = []

  const add = (value: string | null | undefined): void => {
    if (!value) return
    for (const match of value.matchAll(/\b(1\.\d{1,2}(?:\.\d{1,2})?|\d{2}\.\d{1,2}(?:\.\d{1,2})?)\b/g)) {
      if (!found.includes(match[1])) found.push(match[1])
    }
  }

  add(status?.versionName)
  add(notedVersion)

  return found
}

/**
 * How well an instance matches a version the server might be.
 *
 * Exact beats close. "1.20" against an instance on "1.20.1" is worth taking
 * when nothing exact exists - those two versions talk to each other often
 * enough - but never over an instance that matches outright.
 */
function scoreOf(instance: Instance, version: string): number {
  if (instance.minecraftVersion === version) return 3

  // Same major and minor, differing only in the patch.
  const [a, b] = [instance.minecraftVersion.split('.'), version.split('.')]
  if (a[0] === b[0] && a[1] === b[1]) return 2

  return 0
}

/**
 * Which instance to launch, and why.
 *
 * Order matters and is deliberate: what the server was told to use, then what
 * actually fits, and only then the fallback of "there is only one". Being
 * wrong here is a failed connection with nothing on screen explaining it, so
 * a guess is never dressed up as a match.
 */
export function chooseInstance(
  server: Pick<SavedServer, 'preferredInstanceId' | 'notedVersion'>,
  status: ServerStatus | null | undefined,
  instances: Instance[]
): JoinChoice {
  if (server.preferredInstanceId) {
    const named = instances.find((one) => one.id === server.preferredInstanceId)
    if (named) return { kind: 'preferred', instance: named }
  }

  const versions = serverVersions(status, server.notedVersion)

  let best: { instance: Instance; version: string; score: number } | null = null

  for (const version of versions) {
    for (const instance of instances) {
      const score = scoreOf(instance, version)
      if (score === 0) continue

      /*
       * Ties go to whatever was played most recently. Somebody with two
       * instances on the same version has a reason for it, and the one they
       * were last in is the better guess than whichever was made first.
       */
      const better =
        best === null ||
        score > best.score ||
        (score === best.score && (instance.lastPlayedAt ?? 0) > (best.instance.lastPlayedAt ?? 0))

      if (better) best = { instance, version, score }
    }
  }

  if (best) return { kind: 'matched', instance: best.instance, version: best.version }

  /*
   * Nothing matched. One instance and no idea what the server wants is not a
   * match, but it is the only thing that could possibly be meant - and it is
   * what the launcher did for every server before any of this.
   */
  if (versions.length === 0 && instances.length === 1) {
    return { kind: 'only', instance: instances[0] }
  }

  return { kind: 'none', wanted: versions[0] ?? null }
}
