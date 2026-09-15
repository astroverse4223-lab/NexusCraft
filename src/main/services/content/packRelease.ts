import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { LauncherError } from '../../core/errors'
import { createLogger } from '../../core/logger'
import { canFetch } from './packHost'

const run = promisify(execFile)
const log = createLogger('packrelease')

/**
 * Putting the server's pack somewhere every player can reach it.
 *
 * A server does not send a pack. It sends a url, and every client fetches the
 * file itself - so the file has to sit somewhere on the public internet. The
 * launcher can serve it from this machine, but only while the launcher is
 * running and only to whoever can reach this machine, which on a home
 * connection is nobody outside the house.
 *
 * A release asset has neither problem. It is always up, it survives the
 * launcher being closed, and the url does not change when the pack does -
 * which matters more than it sounds, because the url is written into the
 * server's config and nobody wants to edit that every time a texture changes.
 *
 * Uploaded through the `gh` command rather than the api directly. That way the
 * launcher never asks for, handles or stores a token: whoever is signed in to
 * gh is who this uploads as, and their credential stays where they put it.
 */

/** What the upload needs to know, beyond the file itself. */
export interface ReleaseTarget {
  /** "owner/repo". */
  repo: string
  /** The release the asset hangs off. One release, reused - not one per build. */
  tag: string
  /** The file name players' clients will fetch. */
  assetName: string
}

export interface GithubStatus {
  /** Whether the gh command is on this machine at all. */
  installed: boolean
  /** Who it is signed in as, when it is. */
  account: string | null
  /** Whether that login can write to repositories. */
  canWrite: boolean
  /** Why it cannot be used, in words meant for the person reading them. */
  why: string | null
}

async function gh(args: string[], timeout = 180_000): Promise<{ ok: boolean; out: string }> {
  try {
    const { stdout } = await run('gh', args, {
      windowsHide: true,
      timeout,
      maxBuffer: 16 * 1024 * 1024
    })
    return { ok: true, out: stdout }
  } catch (err) {
    const problem = err as { stderr?: string; stdout?: string; code?: string }
    return { ok: false, out: String(problem.stderr || problem.stdout || err) }
  }
}

/**
 * Whether this machine can upload, and if not, what is missing.
 *
 * Asked before the button is drawn rather than after it is pressed. "Install
 * the GitHub CLI" is a fine thing to be told; it is not a fine thing to be
 * told after waiting through a four megabyte build.
 */
export async function githubStatus(): Promise<GithubStatus> {
  const version = await gh(['--version'], 15_000)

  if (!version.ok) {
    return {
      installed: false,
      account: null,
      canWrite: false,
      why: 'The GitHub CLI is not installed on this machine.'
    }
  }

  const auth = await gh(['auth', 'status'], 20_000)

  if (!auth.ok) {
    return {
      installed: true,
      account: null,
      canWrite: false,
      why: 'The GitHub CLI is installed but not signed in.'
    }
  }

  /*
   * gh writes its status to stderr as often as stdout, and the wording has
   * changed between versions, so both are searched and the account is taken
   * from whichever line carries it.
   */
  const text = auth.out
  const account = /account (\S+)/.exec(text)?.[1] ?? /as (\S+)/.exec(text)?.[1] ?? null
  const canWrite = /'repo'|\brepo\b/.test(text)

  return {
    installed: true,
    account,
    canWrite,
    why: canWrite ? null : 'That GitHub login is not allowed to write to repositories.'
  }
}

/** Whether a release with this tag already exists on the repo. */
async function releaseExists(target: ReleaseTarget): Promise<boolean> {
  const found = await gh(['release', 'view', target.tag, '--repo', target.repo, '--json', 'tagName'], 30_000)
  return found.ok
}

export interface UploadResult {
  url: string
  sha1: string
  bytes: number
  /** Whether the release had to be made, rather than added to. */
  created: boolean
  /** Whether the uploaded file could then be fetched back without signing in. */
  reachable: boolean
}

/**
 * Puts a built pack on a release and hands back the url players will use.
 *
 * The url is worked out rather than parsed out of gh's output, because the
 * shape of a release download address is fixed and gh prints the page rather
 * than the asset.
 */
export async function uploadPack(file: string, target: ReleaseTarget): Promise<UploadResult> {
  if (!existsSync(file)) {
    throw new LauncherError('NOT_FOUND', `no pack at ${file}`, {
      title: 'That pack is not on disk',
      message: 'Build the pack first, then upload it.'
    })
  }

  const ready = await githubStatus()
  if (!ready.installed || !ready.canWrite) {
    throw new LauncherError('INVALID_INPUT', 'github cli unavailable', {
      title: 'Cannot upload to GitHub yet',
      message: ready.why ?? 'The GitHub CLI is not ready.',
      actions: ready.installed
        ? ['Run "gh auth login" in a terminal, then try again']
        : ['Install the GitHub CLI from cli.github.com, then sign in with "gh auth login"']
    })
  }

  const bytes = await readFile(file)
  const sha1 = createHash('sha1').update(bytes).digest('hex')

  const sent = await uploadAsset(file, target)

  return { url: sent.url, sha1, bytes: bytes.length, created: sent.created, reachable: sent.reachable }
}

/**
 * Puts any one file on the release and hands back the address for it.
 *
 * Shared by the pack and by the published status file, because the fiddly
 * parts are the same for both and neither is the interesting bit: the asset
 * has to be named what the address says, the old one has to be replaced rather
 * than joined, and the result has to be fetched back to prove a stranger can
 * actually reach it.
 */
export async function uploadAsset(
  file: string,
  target: ReleaseTarget
): Promise<{ url: string; created: boolean; reachable: boolean }> {
  const existed = await releaseExists(target)

  if (!existed) {
    const made = await gh([
      'release',
      'create',
      target.tag,
      '--repo',
      target.repo,
      '--title',
      'Server resource pack',
      '--notes',
      "The server's texture pack, fetched by players when they join.\n\n" +
        'Replace the file on this release to change the pack. The address stays ' +
        'the same, so the server needs no further edits.'
    ])

    if (!made.ok) {
      throw new LauncherError('UNKNOWN', 'could not make the release', {
        title: 'GitHub would not make that release',
        message: made.out.trim().slice(0, 400)
      })
    }
  }

  /*
   * Copied to a file already called what the asset must be called.
   *
   * gh names an asset after the file it was given, and the `file#label`
   * syntax sets a display label rather than the name - so uploading the
   * built pack directly puts it up as `nexus-resource-pack.zip` while the
   * url in the server's config points at `nexuscraft-pack.zip`. The upload
   * reports success, a second asset appears beside the first, and the
   * address goes on serving whatever was there before. Which is exactly
   * what happened the first time this ran by hand.
   */
  const staging = await mkdtemp(join(tmpdir(), 'nexus-release-'))
  const named = join(staging, target.assetName)

  try {
    await copyFile(file, named)

    /*
     * --clobber, because the whole arrangement rests on the address staying
     * put. A second asset beside the first would be a second address, and the
     * one in the server's config would go on serving the old pack for ever.
     */
    const sent = await gh(['release', 'upload', target.tag, named, '--repo', target.repo, '--clobber'])

    if (!sent.ok) {
      throw new LauncherError('UNKNOWN', 'upload refused', {
        title: 'GitHub would not take the file',
        message: sent.out.trim().slice(0, 400)
      })
    }
  } finally {
    await rm(staging, { recursive: true, force: true })
  }

  const url = `https://github.com/${target.repo}/releases/download/${encodeURIComponent(
    target.tag
  )}/${encodeURIComponent(target.assetName)}`

  /*
   * Fetched straight back, without signing in.
   *
   * This is the only part that proves anything. A private repository takes the
   * upload happily and then answers every player with a 404, and an upload
   * that "worked" into a pack nobody can download is the exact failure this
   * feature exists to end.
   */
  const reachable = await canFetch(url, 20_000)

  log.info(
    `${basename(file)} uploaded to ${target.repo}` +
      (reachable ? '' : ' - but it could not be fetched back anonymously')
  )

  return { url, created: !existed, reachable }
}
