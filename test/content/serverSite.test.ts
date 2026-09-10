import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))
vi.mock('../../src/main/core/database', () => ({
  db: () => ({ kvGet: () => null, kvSet: () => undefined })
}))

import { renderSite, votifierInfo, votifierPortOf } from '../../src/main/services/content/siteService'
import { defaultSite } from '../../src/shared/serverSite'

/**
 * The page people outside the game see.
 *
 * It is rendered from files the plugin writes and then handed to anyone with
 * the link, so the two things worth testing are that it reads the real shapes
 * and that nothing a player controls can get out of a string and into the
 * page as markup - a username is player-chosen and lands in the leaderboard.
 */

let root: string

function plugin(name: string, body: string): void {
  const dir = join(root, 'plugins', 'Nexus')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, name), body)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'site-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const FACTS = { online: [], running: true, motd: 'hi', version: '26.2' }

describe('the leaderboards', () => {
  beforeEach(() => {
    // The shape Bukkit's YamlConfiguration really writes, taken from a live file.
    plugin(
      'stats.yml',
      [
        '4d719be5-a3d0-4766-9f77-b2c097b2efe7:',
        '  rank: PLAYER',
        '  money: 18872.19999999997',
        '  blocksMined: 844',
        '  minutesPlayed: 200',
        'aaaaaaaa-0000-0000-0000-000000000000:',
        '  rank: PLAYER',
        '  money: 50.0',
        '  blocksMined: 5',
        '  minutesPlayed: 30'
      ].join('\n')
    )

    writeFileSync(
      join(root, 'usercache.json'),
      JSON.stringify([
        { uuid: '4d719be5-a3d0-4766-9f77-b2c097b2efe7', name: 'Dave0734' },
        { uuid: 'aaaaaaaa-0000-0000-0000-000000000000', name: 'Someone' }
      ])
    )
  })

  it('puts real names against the uuids', async () => {
    const html = await renderSite(root, defaultSite('s', 'Nexus'), FACTS)

    expect(html).toContain('Dave0734')
    expect(html).not.toContain('4d719be5-a3d0-4766-9f77-b2c097b2efe7')
  })

  it('ranks by the value and formats money', async () => {
    const html = await renderSite(root, defaultSite('s', 'Nexus'), FACTS)

    expect(html).toContain('$18,872')
    // The richer player comes first in the richest board.
    expect(html.indexOf('Dave0734')).toBeLessThan(html.indexOf('Someone'))
  })

  it('reads playtime as hours rather than a raw number', async () => {
    const html = await renderSite(root, defaultSite('s', 'Nexus'), FACTS)
    expect(html).toContain('3h 20m')
  })

  it('leaves out a board nobody has scored on', async () => {
    const html = await renderSite(root, defaultSite('s', 'Nexus'), FACTS)

    // Nobody has dug anything, so that board is absent rather than empty.
    expect(html).not.toContain('Most dug at the dig site')
  })
})

describe('what a player can put on the page', () => {
  it('escapes a username that is trying to be markup', async () => {
    plugin('stats.yml', ['aaaaaaaa-0000-0000-0000-000000000001:', '  money: 10.0'].join('\n'))

    writeFileSync(
      join(root, 'usercache.json'),
      JSON.stringify([
        {
          uuid: 'aaaaaaaa-0000-0000-0000-000000000001',
          name: '<img src=x onerror=alert(1)>'
        }
      ])
    )

    const html = await renderSite(root, defaultSite('s', 'Nexus'), FACTS)

    expect(html).not.toContain('<img src=x onerror=alert(1)>')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })

  it('escapes the names of people who are online', async () => {
    const html = await renderSite(root, defaultSite('s', 'Nexus'), {
      ...FACTS,
      online: ['"><script>bad()</script>']
    })

    expect(html).not.toContain('<script>bad()</script>')
  })

  it('escapes what the operator typed into the page settings', async () => {
    const html = await renderSite(
      root,
      { ...defaultSite('s', 'Nexus'), title: '</title><script>x</script>' },
      FACTS
    )

    expect(html).not.toContain('<script>x</script>')
  })
})

describe('a server with nothing recorded yet', () => {
  it('still renders', async () => {
    const html = await renderSite(root, defaultSite('s', 'Nexus'), FACTS)

    expect(html).toContain('<!doctype html>')
    expect(html).toContain('Nexus')
    expect(html).toContain('Nobody on right now')
  })
})

describe('what the vote sites are told', () => {
  it('reads the port out of the plugin config', () => {
    plugin('config.yml', 'voting:\n  enabled: true\n  port: 9001\n  token: abc\n')
    expect(votifierPortOf(root)).toBe(9001)
  })

  it('falls back to 8192, which is what every list assumes', () => {
    expect(votifierPortOf(root)).toBe(8192)
  })

  it('hands back the key as the one unbroken line the sites want', async () => {
    plugin('config.yml', 'voting:\n  enabled: true\n  port: 8192\n  token: tok123\n')

    mkdirSync(join(root, 'plugins', 'Nexus', 'votifier'), { recursive: true })
    writeFileSync(
      join(root, 'plugins', 'Nexus', 'votifier', 'public.key'),
      '-----BEGIN PUBLIC KEY-----\nAAAA\nBBBB\n-----END PUBLIC KEY-----\n'
    )

    const info = await votifierInfo(root)

    expect(info.publicKey).toBe('AAAABBBB')
    expect(info.token).toBe('tok123')
    expect(info.port).toBe(8192)
    expect(info.enabled).toBe(true)
  })
})
