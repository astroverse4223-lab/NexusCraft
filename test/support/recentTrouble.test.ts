import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let root = ''

vi.mock('../../src/main/core/paths', () => ({
  logsRoot: () => root
}))

import { recentTrouble } from '../../src/main/services/support/recentTrouble'

/**
 * Reading back what the launcher wrote down.
 *
 * The value of this panel is entirely in the parsing: if the log format moves
 * and the pattern stops matching, nothing errors and nothing is missing on
 * screen - it simply shows "nothing has gone wrong", forever, which is worse
 * than not having the panel at all. That is the failure this pins.
 */

const LOG = [
  '2026-09-10T04:36:45.608Z [INFO] [mods] scanned 143 jars',
  '2026-09-10T04:36:46.100Z [WARN] [ipc] rejected "resourcepack:serve": draft.textures: Too big',
  '2026-09-10T04:36:47.000Z [ERROR] [packhost] could not listen on 25567',
  'a line from something else entirely',
  '2026-09-10T04:36:48.000Z [INFO] [host] server started'
].join('\n')

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'trouble-'))
  mkdirSync(root, { recursive: true })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const write = (text: string): void => writeFileSync(join(root, 'launcher.log'), text, 'utf8')

describe('the warnings the launcher wrote down', () => {
  it('finds the warnings and errors and leaves the rest', async () => {
    write(LOG)

    const found = await recentTrouble()

    expect(found).toHaveLength(2)
    expect(found.map((f) => f.level).sort()).toEqual(['ERROR', 'WARN'])
  })

  it('pulls apart the line the way it is written', async () => {
    write(LOG)

    const [newest] = await recentTrouble()

    // Newest first, so the error written last comes back first.
    expect(newest.level).toBe('ERROR')
    expect(newest.scope).toBe('packhost')
    expect(newest.message).toBe('could not listen on 25567')
    expect(newest.at).toBe('2026-09-10T04:36:47.000Z')
  })

  it('keeps the message that actually mattered intact', async () => {
    write(LOG)

    const rejection = (await recentTrouble()).find((f) => f.scope === 'ipc')

    // This exact line is the one that sat unread while a pack refused to build.
    expect(rejection?.message).toContain('resourcepack:serve')
    expect(rejection?.message).toContain('Too big')
  })

  it('ignores a line that is not one of ours', async () => {
    write(LOG)
    expect((await recentTrouble()).some((f) => f.message.includes('something else'))).toBe(false)
  })

  it('returns nothing rather than throwing when there is no log yet', async () => {
    expect(await recentTrouble()).toEqual([])
  })

  it('reads the end of a long file, not the start', async () => {
    // Half a megabyte of noise, then the thing worth seeing. Reading from the
    // top would find the noise and stop.
    const noise = Array.from({ length: 8000 }, (_, i) => `2026-09-10T04:00:00.000Z [INFO] [noise] line ${i}`).join('\n')

    write(noise + '\n2026-09-10T05:00:00.000Z [WARN] [late] the newest thing')

    const found = await recentTrouble()

    expect(found).toHaveLength(1)
    expect(found[0].scope).toBe('late')
  })

  it('honours the limit, newest kept', async () => {
    const many = Array.from({ length: 40 }, (_, i) => `2026-09-10T04:00:0${i % 10}.000Z [WARN] [x] warning ${i}`).join(
      '\n'
    )

    write(many)

    const found = await recentTrouble(10)

    expect(found).toHaveLength(10)
    expect(found[0].message).toBe('warning 39')
  })
})
