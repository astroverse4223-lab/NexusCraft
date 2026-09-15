import { existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BOARDS, type SiteConfig, defaultSite } from '@shared/serverSite'
import { db } from '../../core/database'
import { createLogger } from '../../core/logger'

const log = createLogger('site')

/**
 * Rendering the server's public page.
 *
 * Everything on it is read off disk at the moment somebody asks for it: the
 * plugin already writes `stats.yml`, so there is no second copy of the truth
 * and nothing to keep in step. A page that is a minute stale is fine; a page
 * that disagrees with the game is not.
 */

export interface SiteFacts {
  online: string[]
  running: boolean
  motd: string
  version: string
}

/** One player's row out of stats.yml. Named so it does not shadow Record<K, V>. */
interface PlayerRecord {
  rank?: string
  money?: number
  [key: string]: unknown
}

/** Everybody the plugin has ever seen, by uuid. */
async function readStats(serverDir: string): Promise<Map<string, PlayerRecord>> {
  const file = join(serverDir, 'plugins', 'Nexus', 'stats.yml')
  if (!existsSync(file)) return new Map()

  try {
    const yaml = require('yaml')
    const parsed = yaml.parse(await readFile(file, 'utf8')) as Record<string, PlayerRecord> | null

    return new Map(Object.entries(parsed ?? {}))
  } catch (err) {
    log.warn(`could not read stats.yml: ${(err as Error).message}`)
    return new Map()
  }
}

/**
 * A name for a uuid, from the server's own player files.
 *
 * `usercache.json` is what the server keeps for exactly this, so nothing has
 * to be asked of Mojang and the page still works with no internet.
 */
async function readNames(serverDir: string): Promise<Map<string, string>> {
  const file = join(serverDir, 'usercache.json')
  if (!existsSync(file)) return new Map()

  try {
    const entries = JSON.parse(await readFile(file, 'utf8')) as {
      uuid?: string
      name?: string
    }[]

    return new Map(
      entries
        .filter((e) => e.uuid && e.name)
        .map((e) => [String(e.uuid).toLowerCase(), String(e.name)])
    )
  } catch (err) {
    log.warn(`could not read usercache.json: ${(err as Error).message}`)
    return new Map()
  }
}

function escape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function money(value: number): string {
  return '$' + Math.round(value).toLocaleString('en-US')
}

function duration(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m`

  const hours = Math.floor(minutes / 60)
  const rest = Math.round(minutes % 60)

  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`
}

/** One leaderboard's rows, before anything decides how to draw them. */
export interface BoardRows {
  key: string
  label: string
  rows: { name: string; value: string }[]
}

/**
 * Every leaderboard, read off the plugin's own stats file.
 *
 * Shared rather than written twice, because there are now two things that show
 * these - the page the launcher serves and the file it publishes for the
 * public site - and two copies of "who is richest" is two answers to the same
 * question. The file on disk is the only source either of them has.
 */
export async function leaderboards(serverDir: string): Promise<BoardRows[]> {
  const stats = await readStats(serverDir)
  const names = await readNames(serverDir)

  const named = [...stats.entries()].map(([uuid, record]) => ({
    name: names.get(uuid.toLowerCase()) ?? uuid.slice(0, 8),
    record
  }))

  return BOARDS.map((entry) => ({
    key: entry.key,
    label: entry.label,
    rows: named
      .map((player) => ({ name: player.name, raw: Number(player.record[entry.read] ?? 0) }))
      /*
       * Nobody sits on a board with nothing on it. A leaderboard padded out
       * with zeroes says the server is empty far louder than showing three
       * names does.
       */
      .filter((row) => row.raw > 0)
      .sort((a, b) => b.raw - a.raw)
      .slice(0, 5)
      .map((row) => ({
        name: row.name,
        value: entry.money
          ? money(row.raw)
          : entry.key === 'minutesPlayed'
            ? duration(row.raw)
            : Math.round(row.raw).toLocaleString('en-US')
      }))
  })).filter((entry) => entry.rows.length > 0)
}

/** One leaderboard, as a block of html. */
function board(
  label: string,
  rows: { name: string; value: string }[],
  accent: string
): string {
  if (rows.length === 0) return ''

  const items = rows
    .map(
      (row, at) =>
        `<li><span class="at">${at + 1}</span>` +
        `<img src="https://mc-heads.net/avatar/${encodeURIComponent(row.name)}/24" alt="" ` +
        `onerror="this.style.visibility='hidden'">` +
        `<span class="who">${escape(row.name)}</span>` +
        `<span class="val">${escape(row.value)}</span></li>`
    )
    .join('')

  return `<section class="board"><h3 style="border-color:${escape(accent)}">${escape(
    label
  )}</h3><ol>${items}</ol></section>`
}

/**
 * The whole page.
 *
 * One document with its own styles rather than separate files, because it is
 * served by a listener whose entire job is to be simple and hard to get wrong -
 * one request, one response, no asset paths to reason about.
 */
export async function renderSite(
  serverDir: string,
  config: SiteConfig,
  facts: SiteFacts
): Promise<string> {
  const boards = (await leaderboards(serverDir))
    .map((entry) => board(entry.label, entry.rows, config.accent))
    .join('')

  /*
   * Only the rows that are finished.
   *
   * A half-typed row is kept in the settings so it survives a click away, but
   * a button with no name pointing at "https://" is not something to put in
   * front of a player.
   */
  const ready = config.votes.filter((site) => site.name.trim() && /^https?:\/\//i.test(site.url))

  const voteButtons =
    ready.length === 0
      ? '<p class="dim">No vote sites added yet.</p>'
      : ready
          .map(
            (site) =>
              `<a class="vote" href="${escape(site.url)}" target="_blank" rel="noopener">` +
              `${escape(site.name)}</a>`
          )
          .join('')

  const heading = config.title.trim() || 'Minecraft Server'

  const address = config.joinAddress.trim()

  const players =
    facts.online.length === 0
      ? '<p class="dim">Nobody on right now.</p>'
      : `<div class="players">${facts.online
          .map(
            (name) =>
              `<div class="player"><img src="https://mc-heads.net/avatar/${encodeURIComponent(
                name
              )}/32" alt="" onerror="this.style.visibility='hidden'">` +
              `<span>${escape(name)}</span></div>`
          )
          .join('')}</div>`

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(heading)}</title>
<style>
  :root { color-scheme: dark; --accent: ${escape(config.accent)}; }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: #0e0f13; color: #e8e8ee;
    font: 15px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  .wrap { max-width: 940px; margin: 0 auto; padding: 32px 20px 64px; }
  header { text-align: center; padding: 40px 0 28px; }
  h1 { font-size: 44px; margin: 0 0 8px; letter-spacing: -0.02em; }
  .blurb { color: #a6a6b6; margin: 0 0 22px; }
  .status {
    display: inline-flex; align-items: center; gap: 8px; padding: 6px 14px;
    border-radius: 999px; background: #1a1b22; font-size: 13px;
  }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: #3ad07a; }
  .dot.off { background: #6b6b78; }
  .addr {
    display: block; margin: 20px auto 0; width: fit-content; padding: 12px 22px;
    border-radius: 10px; background: #16171e; border: 1px solid #262733;
    font-family: ui-monospace, "Cascadia Code", Menlo, monospace; font-size: 17px;
    cursor: pointer; transition: border-color .15s;
  }
  .addr:hover { border-color: var(--accent); }
  .addr small { display: block; font-family: system-ui; font-size: 11px; color: #7c7c8a; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .09em;
       color: #8a8a99; margin: 44px 0 14px; font-weight: 600; }
  .vote {
    display: inline-block; margin: 0 8px 8px 0; padding: 11px 18px; border-radius: 9px;
    background: var(--accent); color: #fff; text-decoration: none; font-weight: 600;
  }
  .vote:hover { filter: brightness(1.12); }
  .players { display: flex; flex-wrap: wrap; gap: 10px; }
  .player { display: flex; align-items: center; gap: 8px; padding: 7px 13px 7px 7px;
            background: #16171e; border-radius: 999px; }
  .player img { width: 26px; height: 26px; border-radius: 5px; image-rendering: pixelated; }
  .boards { display: grid; grid-template-columns: repeat(auto-fit, minmax(270px, 1fr)); gap: 16px; }
  .board { background: #14151b; border: 1px solid #22232e; border-radius: 12px; padding: 16px 18px; }
  .board h3 { margin: 0 0 12px; font-size: 14px; padding-bottom: 9px;
              border-bottom: 2px solid; }
  .board ol { list-style: none; margin: 0; padding: 0; }
  .board li { display: flex; align-items: center; gap: 9px; padding: 5px 0; font-size: 14px; }
  .at { width: 17px; color: #6b6b78; font-size: 12px; }
  .board img { width: 20px; height: 20px; border-radius: 4px; image-rendering: pixelated; }
  .who { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .val { color: #a6a6b6; font-variant-numeric: tabular-nums; }
  .dim { color: #6b6b78; }
  footer { margin-top: 56px; text-align: center; color: #55555f; font-size: 12px; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>${escape(heading)}</h1>
    <p class="blurb">${escape(config.blurb)}</p>
    <span class="status">
      <span class="dot${facts.running ? '' : ' off'}"></span>
      ${facts.running ? `${facts.online.length} online` : 'Offline'}
      ${facts.version ? `&middot; ${escape(facts.version)}` : ''}
    </span>
    ${
      address
        ? `<div class="addr" onclick="navigator.clipboard.writeText('${escape(
            address
          )}');this.querySelector('small').textContent='Copied'">${escape(
            address
          )}<small>Click to copy</small></div>`
        : ''
    }
  </header>

  <h2>Vote for us</h2>
  ${voteButtons}

  <h2>Who is on</h2>
  ${players}

  ${boards ? `<h2>Leaderboards</h2><div class="boards">${boards}</div>` : ''}

  <footer>Served by NexusCraft Launcher</footer>
</div>
</body>
</html>`
}

/* ------------------------------------------------------------------ store */

const KEY = 'serverSite'

/** The page's settings, which are the launcher's rather than the server's. */
export function getSiteConfig(serverId: string, name: string): SiteConfig {
  const raw = db().kvGet(`${KEY}:${serverId}`)
  const base = defaultSite(serverId, name)

  if (!raw) return base

  try {
    // Merged over the defaults so a setting added later is populated rather
    // than undefined in a page that then renders "undefined" at people.
    return { ...base, ...(JSON.parse(raw) as Partial<SiteConfig>), serverId }
  } catch {
    log.warn('the site settings were unreadable; using defaults')
    return base
  }
}

export function saveSiteConfig(config: SiteConfig): SiteConfig {
  db().kvSet(`${KEY}:${config.serverId}`, JSON.stringify(config))
  return config
}

/* --------------------------------------------------------------- votifier */

/**
 * What a vote site needs to be told, read from the plugin's own files.
 *
 * Every list asks for the same four things and calls them slightly different
 * names. Getting one wrong means votes that are accepted by the site and
 * silently dropped here, so they are read rather than typed out again.
 */
export interface VotifierInfo {
  port: number
  /** Version 2 sites want this instead of the key. */
  token: string
  /** Version 1 sites want this, as one long line. */
  publicKey: string
  enabled: boolean
}

const NEXUS = ['plugins', 'Nexus']

export function votifierPortOf(serverDir: string): number {
  const file = join(serverDir, ...NEXUS, 'config.yml')

  if (existsSync(file)) {
    try {
      const yaml = require('yaml')
      const parsed = yaml.parse(readFileSync(file, 'utf8')) as {
        voting?: { port?: number }
      } | null

      const port = parsed?.voting?.port
      if (typeof port === 'number' && port > 0) return port
    } catch (err) {
      log.warn(`could not read the votifier port: ${(err as Error).message}`)
    }
  }

  // What the plugin itself falls back to, and what every list assumes.
  return 8192
}

export async function votifierInfo(serverDir: string): Promise<VotifierInfo> {
  const config = join(serverDir, ...NEXUS, 'config.yml')
  const key = join(serverDir, ...NEXUS, 'votifier', 'public.key')

  let token = ''
  let enabled = false

  if (existsSync(config)) {
    try {
      const yaml = require('yaml')
      const parsed = yaml.parse(await readFile(config, 'utf8')) as {
        voting?: { token?: string; enabled?: boolean }
      } | null

      token = String(parsed?.voting?.token ?? '')
      enabled = parsed?.voting?.enabled !== false
    } catch (err) {
      log.warn(`could not read the voting settings: ${(err as Error).message}`)
    }
  }

  let publicKey = ''

  if (existsSync(key)) {
    try {
      // The sites want it as one unbroken line, which is not how it is stored.
      publicKey = (await readFile(key, 'utf8'))
        .replace(/-----[A-Z ]+-----/g, '')
        .replace(/\s+/g, '')
    } catch (err) {
      log.warn(`could not read the votifier public key: ${(err as Error).message}`)
    }
  }

  return { port: votifierPortOf(serverDir), token, publicKey, enabled }
}

/* ------------------------------------------------------------- moderation */

export interface Punished {
  kind: string
  name: string
  by: string
  reason: string
  at: number
  until: number
}

/**
 * Who is banned or muted, read from what the plugin wrote.
 *
 * The panel could hand out punishments and had no way to see or undo one,
 * which is half a moderation tool - and the wrong half, because a ban you
 * cannot lift is the mistake that costs you a player permanently.
 */
export async function punishments(serverDir: string): Promise<Punished[]> {
  const file = join(serverDir, ...NEXUS, 'punishments.yml')
  if (!existsSync(file)) return []

  try {
    const yaml = require('yaml')
    const parsed = yaml.parse(await readFile(file, 'utf8')) as Record<
      string,
      Record<string, unknown>
    > | null

    const now = Date.now()

    return Object.values(parsed ?? {})
      .map((row) => ({
        kind: String(row?.kind ?? ''),
        name: String(row?.name ?? ''),
        by: String(row?.by ?? ''),
        reason: String(row?.reason ?? ''),
        at: Number(row?.at ?? 0),
        until: Number(row?.until ?? 0)
      }))
      // Expired ones are history, not something anybody needs to lift.
      .filter((row) => row.name && (row.until === 0 || row.until > now))
  } catch (err) {
    log.warn(`could not read punishments.yml: ${(err as Error).message}`)
    return []
  }
}

/**
 * Everybody the server has ever seen, most recent first.
 *
 * Moderation mostly happens after somebody has left - they say something and
 * log off - so a panel that can only act on who is online right now is one
 * that is empty exactly when it is needed.
 */
export async function knownPlayers(serverDir: string): Promise<string[]> {
  const file = join(serverDir, 'usercache.json')
  if (!existsSync(file)) return []

  try {
    const rows = JSON.parse(await readFile(file, 'utf8')) as {
      name?: string
      expiresOn?: string
    }[]

    return rows
      .map((row) => String(row?.name ?? ''))
      .filter(Boolean)
      .reverse()
  } catch (err) {
    log.warn(`could not read usercache.json: ${(err as Error).message}`)
    return []
  }
}
