import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { leaderboards } from './siteService'
import { uploadAsset, type ReleaseTarget } from './packRelease'
import { createLogger } from '../../core/logger'

const log = createLogger('sitestatus')

/**
 * The numbers the public page shows, published as a file.
 *
 * The website is static - it sits on GitHub Pages and on Railway and knows
 * nothing about this machine - so it cannot read the server's stats file the
 * way the launcher's own page does. This writes those numbers out as JSON and
 * puts it on the same release the pack lives on, where the page can fetch it.
 *
 * Published rather than served for the same reason the pack is: a number that
 * is only visible while the launcher happens to be open is not on the website,
 * it is on this desktop.
 */

export interface PublishedStatus {
  /** When these numbers were taken, so the page can say how old they are. */
  takenAt: number
  /** Who was on at that moment. Empty when the server was down. */
  online: string[]
  running: boolean
  version: string
  boards: { key: string; label: string; rows: { name: string; value: string }[] }[]
}

export async function buildStatus(
  serverDir: string,
  facts: { online: string[]; running: boolean; version: string }
): Promise<PublishedStatus> {
  return {
    takenAt: Date.now(),
    online: facts.online,
    running: facts.running,
    version: facts.version,
    boards: await leaderboards(serverDir)
  }
}

/**
 * Writes the status out and puts it on the release.
 *
 * The same asset name every time, so the address in the page never changes -
 * a status file at a new url each publish is a page that goes on showing the
 * first one it ever saw.
 */
export async function publishStatus(
  serverDir: string,
  facts: { online: string[]; running: boolean; version: string },
  target: ReleaseTarget
): Promise<{ url: string; boards: number; players: number }> {
  const status = await buildStatus(serverDir, facts)

  const staging = await mkdtemp(join(tmpdir(), 'nexus-status-'))
  const file = join(staging, target.assetName)

  try {
    await writeFile(file, JSON.stringify(status), 'utf8')
    const sent = await uploadAsset(file, target)

    log.info(
      `published ${status.boards.length} leaderboard(s) and ${status.online.length} player(s) online`
    )

    return { url: sent.url, boards: status.boards.length, players: status.online.length }
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}
