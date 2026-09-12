import { createReadStream, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { logsRoot } from '../../core/paths'
import type { Trouble } from '@shared/types'

/**
 * The warnings the launcher has written down, where somebody can read them.
 *
 * Every silent failure this app has had left a line in launcher.log first. A
 * resource pack that would not build said so - `rejected "resourcepack:serve":
 * draft.textures: Too big` - hours before anybody worked it out, because the
 * only copy was in a file nobody knew to open. The information was never
 * missing. It was just somewhere nobody could reach.
 *
 * Read from the end rather than the start: this file grows for the life of an
 * install, and the interesting part is always the last few minutes.
 */

/** How much of the tail to read. Large enough for a session, small enough to be instant. */
const TAIL_BYTES = 256 * 1024

/**
 * Lines are written as:
 *   2026-09-10T04:36:45.608Z [WARN] [mods] could not read x.jar: ...
 */
const LINE = /^(\S+)\s+\[(WARN|ERROR)\]\s+\[([^\]]+)\]\s+(.*)$/

export async function recentTrouble(limit = 100): Promise<Trouble[]> {
  const file = join(logsRoot(), 'launcher.log')
  if (!existsSync(file)) return []

  const size = statSync(file).size
  const start = Math.max(0, size - TAIL_BYTES)

  const text = await new Promise<string>((resolve, reject) => {
    let out = ''
    createReadStream(file, { encoding: 'utf8', start })
      .on('data', (chunk) => (out += chunk))
      .on('end', () => resolve(out))
      .on('error', reject)
  })

  const found: Trouble[] = []

  for (const line of text.split(/\r?\n/)) {
    const match = LINE.exec(line)
    if (!match) continue

    found.push({
      at: match[1],
      level: match[2] as Trouble['level'],
      scope: match[3],
      message: match[4]
    })
  }

  /*
   * Newest first, and only the last however many.
   *
   * A partial first line is possible because the read starts mid-file, but it
   * simply fails to match the shape and is dropped - which is why this parses
   * rather than splits.
   */
  return found.slice(-limit).reverse()
}
