import { app } from 'electron'
import { createLogger } from '../../core/logger'
import { LauncherError } from '../../core/errors'

const log = createLogger('links')

/**
 * `nexuscraft://` links.
 *
 * Two jobs, one mechanism: an "Install with NexusCraft" button on a web page,
 * and an invite a host sends a friend. Both arrive as a URL — from the shell on
 * first launch, or as an argv line to the already-running instance — and both
 * end in the launcher doing something on the user's behalf, so what a link may
 * ask for is deliberately small and closed.
 *
 * Anything not in `ParsedLink` is refused. A link that could name an arbitrary
 * download, a file path, or a command would be a remote-code-execution hole
 * dressed up as convenience.
 */

export const PROTOCOL = 'nexuscraft'

export type ParsedLink =
  /** Install a Modrinth modpack: nexuscraft://modpack/modrinth/<versionId> */
  | { kind: 'modpack-modrinth'; versionId: string }
  /** Install a CurseForge modpack: nexuscraft://modpack/curseforge/<projectId>/<fileId> */
  | { kind: 'modpack-curseforge'; projectId: string; fileId: string }
  /** Add a mod to an instance the user picks: nexuscraft://mod/modrinth/<versionId> */
  | { kind: 'mod-modrinth'; versionId: string }
  /**
   * Join a server: nexuscraft://join/<host>/<port>?name=…&version=…&loader=…&pack=…
   *
   * The optional fields let the launcher prepare a matching client before
   * connecting, which is the difference between an invite that works and one
   * that ends in "failed to synchronise registry data".
   */
  | {
      kind: 'join'
      host: string
      port: number
      name: string | null
      minecraftVersion: string | null
      loader: string | null
      /** A Modrinth modpack version id the server runs, when the host named one. */
      packVersionId: string | null
    }

/** Ids from the two content sites are alphanumeric; nothing else is accepted. */
const SAFE_ID = /^[A-Za-z0-9]{1,32}$/

/**
 * A hostname or IPv4 address, which is all a Minecraft server address may be.
 * Deliberately strict: this string is handed to the game as a connect target.
 */
const SAFE_HOST = /^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/

export function parseDeepLink(raw: string): ParsedLink | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }

  if (url.protocol !== `${PROTOCOL}:`) return null

  // nexuscraft://join/host/port parses with "join" as the hostname, so the
  // action and its arguments have to be reassembled from both halves.
  const segments = [url.hostname, ...url.pathname.split('/')]
    .map((segment) => decodeURIComponent(segment.trim()))
    .filter(Boolean)

  const [action, ...rest] = segments
  if (!action) return null

  switch (action.toLowerCase()) {
    case 'modpack': {
      const [source, first, second] = rest
      if (source === 'modrinth' && SAFE_ID.test(first ?? '')) {
        return { kind: 'modpack-modrinth', versionId: first }
      }
      if (source === 'curseforge' && SAFE_ID.test(first ?? '') && SAFE_ID.test(second ?? '')) {
        return { kind: 'modpack-curseforge', projectId: first, fileId: second }
      }
      return null
    }

    case 'mod': {
      const [source, first] = rest
      if (source === 'modrinth' && SAFE_ID.test(first ?? '')) {
        return { kind: 'mod-modrinth', versionId: first }
      }
      return null
    }

    case 'join': {
      const [host, portText] = rest
      if (!host || !SAFE_HOST.test(host)) return null

      const port = Number(portText ?? '25565')
      if (!Number.isInteger(port) || port < 1 || port > 65535) return null

      const packVersionId = url.searchParams.get('pack')

      return {
        kind: 'join',
        host,
        port,
        name: url.searchParams.get('name')?.slice(0, 64) ?? null,
        minecraftVersion: url.searchParams.get('version')?.slice(0, 32) ?? null,
        loader: url.searchParams.get('loader')?.slice(0, 16) ?? null,
        packVersionId: packVersionId && SAFE_ID.test(packVersionId) ? packVersionId : null
      }
    }

    default:
      return null
  }
}

/** Builds an invite link for a server, for the host to send to a friend. */
export function buildJoinLink(input: {
  host: string
  port: number
  name?: string | null
  minecraftVersion?: string | null
  loader?: string | null
  packVersionId?: string | null
}): string {
  if (!SAFE_HOST.test(input.host)) {
    throw new LauncherError('INVALID_INPUT', `refusing to build a link for host "${input.host}"`)
  }

  const url = new URL(`${PROTOCOL}://join/${input.host}/${input.port}`)
  if (input.name) url.searchParams.set('name', input.name.slice(0, 64))
  if (input.minecraftVersion) url.searchParams.set('version', input.minecraftVersion)
  if (input.loader) url.searchParams.set('loader', input.loader)
  if (input.packVersionId) url.searchParams.set('pack', input.packVersionId)
  return url.toString()
}

/**
 * Registers the launcher as the handler for its protocol.
 *
 * In development the executable is Electron itself running a script, so the
 * registration has to name both — otherwise Windows records "electron.exe"
 * as the handler and the link opens a blank Electron app.
 */
export function registerProtocol(): void {
  const registered =
    process.defaultApp && process.argv.length >= 2
      ? app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [process.argv[1]])
      : app.setAsDefaultProtocolClient(PROTOCOL)

  if (registered) log.info(`registered ${PROTOCOL}:// links`)
  else log.warn(`could not register ${PROTOCOL}:// links`)
}

/** The first `nexuscraft://` URL in a command line, if there is one. */
export function findLinkInArgv(argv: string[]): string | null {
  return argv.find((arg) => arg.startsWith(`${PROTOCOL}://`)) ?? null
}
