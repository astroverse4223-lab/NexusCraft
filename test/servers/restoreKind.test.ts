import { describe, expect, it, vi, beforeEach, afterAll } from 'vitest'
import AdmZip from 'adm-zip'
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Two kinds of snapshot share one folder, and telling them apart is the whole
 * test.
 *
 * The launcher writes world backups. The plugin writes its own data folder as
 * the server shuts down - money, homes, claims, islands, vault, stats - and it
 * writes them beside the world ones. Restore used to send everything to the
 * world folder unconditionally, so putting a data snapshot back would have
 * deleted the world and left yaml files standing where it used to be.
 *
 * That is not a bug you find twice, so it is pinned here.
 */

let root = ''
let serverId = 'test-server'

vi.mock('../../src/main/core/paths', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../src/main/core/paths')
  return {
    ...actual,
    ensureDir: (dir: string) => {
      require('node:fs').mkdirSync(dir, { recursive: true })
      return dir
    }
  }
})

vi.mock('../../src/main/services/servers/hostService', () => ({
  hostedServerDir: () => join(root, serverId),
  getHostedServer: () => ({ id: serverId, name: 'Test', minecraftVersion: '26.2' }),
  isHostedServerRunning: () => running
}))

let running = false

const { restoreServerBackup, listServerBackups } = await import(
  '../../src/main/services/backup/backupScheduler'
)

/** A server directory with a world and a plugin folder already in it. */
async function makeServer(): Promise<void> {
  const dir = join(root, serverId)

  await mkdir(join(dir, 'world', 'region'), { recursive: true })
  await writeFile(join(dir, 'world', 'level.dat'), 'LIVE LEVEL')
  await writeFile(join(dir, 'world', 'region', 'r.0.0.mca'), 'LIVE REGION')

  await mkdir(join(dir, 'plugins', 'Nexus'), { recursive: true })
  await writeFile(join(dir, 'plugins', 'Nexus', 'stats.yml'), 'live: stats')
  await writeFile(join(dir, 'plugins', 'other-plugin.jar'), 'SOMEBODY ELSE')

  await mkdir(join(dir, 'backups'), { recursive: true })
  await writeFile(join(dir, 'server.properties'), 'level-name=world\n')
}

beforeEach(async () => {
  running = false
  root = await mkdtemp(join(tmpdir(), 'nexus-restore-'))
  await makeServer()
})

afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true }).catch(() => undefined)
})

function writeArchive(name: string, files: Record<string, string>): void {
  const zip = new AdmZip()
  for (const [path, body] of Object.entries(files)) zip.addFile(path, Buffer.from(body))
  zip.writeZip(join(root, serverId, 'backups', name))
}

describe('telling the two kinds of snapshot apart', () => {
  it('calls a plugin-data archive data, and a world one world', async () => {
    writeArchive('nexus-data-2026-01-01_00-00-00.zip', { 'Nexus/stats.yml': 'old: stats' })
    writeArchive('world_2026-01-01_00-00-00.zip', { 'level.dat': 'OLD LEVEL' })

    const listed = await listServerBackups(serverId)
    const byName = Object.fromEntries(listed.map((b) => [b.fileName, b]))

    expect(byName['nexus-data-2026-01-01_00-00-00.zip'].kind).toBe('data')
    expect(byName['world_2026-01-01_00-00-00.zip'].kind).toBe('world')
  })

  it('names the data one something a person can read', async () => {
    writeArchive('nexus-data-2026-01-01_00-00-00.zip', { 'Nexus/stats.yml': 'old: stats' })

    const [only] = await listServerBackups(serverId)

    // Not "nexus-data", which is what stripping the timestamp would leave.
    expect(only.worldName).toBe('Player data')
  })
})

describe('putting a player-data snapshot back', () => {
  it('leaves the world completely alone', async () => {
    /*
     * The one that mattered. Restoring data used to delete the world folder
     * and unpack the yaml where it had been.
     */
    writeArchive('nexus-data-2026-01-01_00-00-00.zip', { 'Nexus/stats.yml': 'old: stats' })

    await restoreServerBackup(serverId, 'nexus-data-2026-01-01_00-00-00.zip')

    const world = join(root, serverId, 'world')
    expect(existsSync(join(world, 'level.dat'))).toBe(true)
    expect(await readFile(join(world, 'level.dat'), 'utf8')).toBe('LIVE LEVEL')
    expect(await readFile(join(world, 'region', 'r.0.0.mca'), 'utf8')).toBe('LIVE REGION')
  })

  it('puts the data back where the plugin reads it', async () => {
    writeArchive('nexus-data-2026-01-01_00-00-00.zip', { 'Nexus/stats.yml': 'old: stats' })

    await restoreServerBackup(serverId, 'nexus-data-2026-01-01_00-00-00.zip')

    const restored = join(root, serverId, 'plugins', 'Nexus', 'stats.yml')
    expect(await readFile(restored, 'utf8')).toBe('old: stats')
  })

  it('does not take the other plugins down with it', async () => {
    /*
     * The destination for a data restore is `plugins`, and emptying that to
     * replace one folder inside it would remove every other plugin's settings
     * and their jars along with them.
     */
    writeArchive('nexus-data-2026-01-01_00-00-00.zip', { 'Nexus/stats.yml': 'old: stats' })

    await restoreServerBackup(serverId, 'nexus-data-2026-01-01_00-00-00.zip')

    const other = join(root, serverId, 'plugins', 'other-plugin.jar')
    expect(existsSync(other)).toBe(true)
    expect(await readFile(other, 'utf8')).toBe('SOMEBODY ELSE')
  })
})

describe('putting a world snapshot back', () => {
  it('replaces the world and not the plugins', async () => {
    writeArchive('world_2026-01-01_00-00-00.zip', { 'level.dat': 'OLD LEVEL' })

    await restoreServerBackup(serverId, 'world_2026-01-01_00-00-00.zip')

    expect(await readFile(join(root, serverId, 'world', 'level.dat'), 'utf8')).toBe('OLD LEVEL')

    // The plugin's data is not part of a world snapshot and must survive one.
    const stats = join(root, serverId, 'plugins', 'Nexus', 'stats.yml')
    expect(await readFile(stats, 'utf8')).toBe('live: stats')
  })
})

describe('refusing to restore at the wrong moment', () => {
  it('will not replace anything while the server is running', async () => {
    writeArchive('nexus-data-2026-01-01_00-00-00.zip', { 'Nexus/stats.yml': 'old: stats' })
    running = true

    await expect(
      restoreServerBackup(serverId, 'nexus-data-2026-01-01_00-00-00.zip')
    ).rejects.toThrow()

    // And nothing was touched on the way to refusing.
    const stats = join(root, serverId, 'plugins', 'Nexus', 'stats.yml')
    expect(await readFile(stats, 'utf8')).toBe('live: stats')
  })
})
