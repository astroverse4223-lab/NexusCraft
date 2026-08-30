/**
 * Turns a modpack into a hosted server rather than a client instance.
 *
 * The two installs share a manifest but not much else. A pack is authored for
 * the client: it lists mods that only exist to draw things, and its overrides
 * carry resource packs, shader settings and key bindings. Copying all of that
 * into a dedicated server produces a process that dies on startup with a
 * missing-class trace naming something in the rendering engine — which reads as
 * a corrupt download and is nothing of the kind.
 *
 * So this is not the instance installer pointed at a different folder. It keeps
 * what a server can use and leaves the rest, and says which is which.
 */
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import AdmZip from 'adm-zip'
import type { LoaderId, ServerSoftware, ModpackServerInstallResult } from '@shared/types'
import { getJson, getBuffer } from '../../core/http'
import { LauncherError } from '../../core/errors'
import { createLogger } from '../../core/logger'
import { createTask, type DownloadItem } from '../downloads/downloadManager'
import { getFiles } from './curseforgeService'
import { analyseModsIn, setModEnabledIn } from '../mods/modService'
import {
  saveHostedServer,
  installHostedServer,
  deleteHostedServer,
  listHostedServers,
  hostedServerDir,
  getHostedServer,
  serverModTarget
} from '../servers/hostService'
import {
  isAllowedDownload,
  readIndex,
  readCfManifest,
  resolveLoader,
  parseCfLoader,
  safeTarget,
  type CfManifest,
  type MrpackIndex
} from './modpackService'

const log = createLogger('modpack-server')

/* ------------------------------------------------------------- the loader */

/**
 * Maps the loader a pack declares onto server software the launcher can
 * install.
 *
 * Quilt is the gap: it is a real client loader but the launcher has no Quilt
 * server, so a Quilt pack is refused with the reason rather than quietly
 * installed as something else. Quilt runs Fabric mods, so a Fabric server is
 * usually the honest suggestion — but making that swap silently would produce a
 * server the pack's author never tested.
 */
function softwareForLoader(loader: LoaderId, packName: string): ServerSoftware {
  switch (loader) {
    case 'fabric':
      return 'fabric'
    case 'forge':
      return 'forge'
    case 'neoforge':
      return 'neoforge'
    case 'vanilla':
      return 'vanilla'
    case 'quilt':
      throw new LauncherError('INVALID_INPUT', `no Quilt server software for "${packName}"`, {
        title: 'Quilt packs cannot be hosted yet',
        message:
          'This pack runs on Quilt, and the launcher can install Vanilla, Paper, Purpur, Fabric, Forge and NeoForge servers — not Quilt.',
        actions: [
          'Most Quilt packs also publish a Fabric version — look for that on the pack page',
          'You can still install this pack as a normal instance and play it single-player'
        ]
      })
    default:
      throw new LauncherError('INVALID_INPUT', `unknown loader ${loader}`)
  }
}

/* --------------------------------------------------------------- the port */

/**
 * Picks a port no other hosted server has claimed, starting at the default.
 *
 * Saving would refuse a clash anyway, but failing after downloading a gigabyte
 * of mods to say "port 25565 is taken" is a poor way to find out.
 */
function firstFreePort(): number {
  const taken = new Set(listHostedServers().map((server) => server.port))
  for (let port = 25565; port < 25665; port++) {
    if (!taken.has(port)) return port
  }
  throw new LauncherError('INVALID_INPUT', 'every port from 25565 to 25664 is already used by one of your servers')
}

/* ---------------------------------------------------------- the overrides */

/**
 * Override paths that belong to the client and have no meaning on a server.
 *
 * These are not harmful so much as pointless — a server will never read a
 * shader pack — but a few of them are actively confusing. `saves/` would drop
 * the pack author's own single-player world into the server directory, and
 * `servers.dat` would hand every player a server list that is not theirs.
 */
const CLIENT_ONLY_PREFIXES = [
  'resourcepacks/',
  'shaderpacks/',
  'saves/',
  'screenshots/',
  'logs/',
  'crash-reports/',
  'texturepacks/'
]

const CLIENT_ONLY_FILES = ['options.txt', 'optionsof.txt', 'servers.dat', 'servers.dat_old', 'usercache.json']

function isClientOnlyOverride(relative: string): boolean {
  const lower = relative.toLowerCase()
  if (CLIENT_ONLY_FILES.includes(lower)) return true
  return CLIENT_ONLY_PREFIXES.some((prefix) => lower.startsWith(prefix))
}

/**
 * Copies the pack's bundled configuration into the server directory.
 *
 * `overrides/` applies to both sides. `server-overrides/` is the author saying
 * "use this instead when hosting", so it is applied after and wins.
 * `client-overrides/` is skipped outright.
 */
async function applyOverrides(zip: AdmZip, dir: string, overridesDir: string): Promise<{ applied: number; skipped: number }> {
  let applied = 0
  let skipped = 0

  // Ordered so a server-override lands on top of the shared one.
  const prefixes = [`${overridesDir}/`, 'server-overrides/']

  for (const prefix of prefixes) {
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory) continue
      if (!entry.entryName.startsWith(prefix)) continue

      const relative = entry.entryName.slice(prefix.length)
      if (!relative) continue

      if (isClientOnlyOverride(relative)) {
        skipped++
        continue
      }

      const target = safeTarget(dir, relative)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, entry.getData())
      applied++
    }
  }

  return { applied, skipped }
}

/* ------------------------------------------------------- client-only mods */

/**
 * Disables mods that declare themselves client-only, and reports them.
 *
 * Fabric mods state this in `fabric.mod.json` and newer NeoForge manifests in
 * `side`, so for those it is a fact rather than a guess. They are renamed to
 * `.disabled` rather than deleted: the pack downloaded them, the user may
 * disagree with the call, and a rename is undone with one click where a
 * deletion is another download.
 *
 * Forge mods mostly say nothing, so most of them survive this untouched. That
 * is the right default — excluding a jar because its manifest predates the
 * field would break more packs than it fixed — but it does mean a Forge pack
 * can still arrive with a client mod in it.
 */
async function disableClientOnlyMods(serverId: string): Promise<string[]> {
  const server = getHostedServer(serverId)
  const target = serverModTarget(server)
  if (!existsSync(target.dir)) return []

  const mods = await analyseModsIn(target)
  const clientOnly = mods.filter((mod) => mod.environment === 'client')

  for (const mod of clientOnly) {
    try {
      await setModEnabledIn(target.dir, mod.fileName, false)
    } catch (err) {
      log.warn(`could not disable client-only mod ${mod.fileName}: ${String(err)}`)
    }
  }

  if (clientOnly.length > 0) {
    log.info(`disabled ${clientOnly.length} client-only mod(s) for server ${server.name}`)
  }
  return clientOnly.map((mod) => mod.name || mod.fileName)
}

/* ------------------------------------------------------------- the create */

export interface ModpackServerOptions {
  /** Overrides the pack's own name. */
  name?: string
  port?: number
  memoryMb?: number
}

/** Everything both pack formats need once their manifest has been read. */
interface PackFacts {
  name: string
  minecraftVersion: string
  loader: LoaderId
  loaderVersion: string | null
}

function factsFromMrpack(index: MrpackIndex): PackFacts {
  const { loader, version } = resolveLoader(index.dependencies)
  return {
    name: index.name || 'Modpack server',
    minecraftVersion: index.dependencies.minecraft,
    loader,
    loaderVersion: version
  }
}

function factsFromCurseForge(manifest: CfManifest): PackFacts {
  const { loader, version } = parseCfLoader(manifest.minecraft.modLoaders)
  return {
    name: manifest.name || 'Modpack server',
    minecraftVersion: manifest.minecraft.version,
    loader,
    loaderVersion: version
  }
}

/**
 * Creates the server record for a pack, before anything is downloaded.
 *
 * The defaults are a fresh server's, with two deliberate exceptions: the pack's
 * own name and version, and enough memory to actually load it. A hundred-mod
 * pack will not start in the 2 GB a vanilla server is content with.
 */
function createServerFor(facts: PackFacts, options: ModpackServerOptions): string {
  const software = softwareForLoader(facts.loader, facts.name)

  const server = saveHostedServer({
    id: null,
    name: (options.name?.trim() || facts.name).slice(0, 64),
    minecraftVersion: facts.minecraftVersion,
    software,
    port: options.port ?? firstFreePort(),
    onlineMode: true,
    reachability: 'network',
    // Modded servers are hungry. 4 GB is a working floor for a real pack where
    // vanilla's default would spend its first minute garbage-collecting.
    memoryMb: options.memoryMb ?? 4096,
    motd: facts.name.slice(0, 59),
    difficulty: 'normal',
    gameMode: 'survival',
    maxPlayers: 10,
    allowCheats: false,
    operators: []
  })

  return server.id
}

/* ------------------------------------------------------------ the install */

/** Installs an already-open pack archive as a hosted server. */
async function installPackAsServer(
  zip: AdmZip,
  options: ModpackServerOptions
): Promise<ModpackServerInstallResult> {
  const cf = readCfManifest(zip)
  const index = cf ? null : readIndex(zip)
  const facts = cf ? factsFromCurseForge(cf) : factsFromMrpack(index as MrpackIndex)

  log.info(`installing "${facts.name}" as a server (${facts.minecraftVersion}, ${facts.loader})`)

  const serverId = createServerFor(facts, options)
  const dir = hostedServerDir(serverId)
  const skipped: string[] = []

  try {
    // The loader server itself first: without it there is nothing for the mods
    // to load into, and a failure here is cheap to recover from.
    await installHostedServer(serverId)

    const modsDir = join(dir, 'mods')
    await mkdir(modsDir, { recursive: true })

    const items: DownloadItem[] = cf
      ? await curseForgeItems(cf, dir, skipped)
      : mrpackItems(index as MrpackIndex, dir, skipped)

    const task = createTask({ label: `Installing ${facts.name}`, phase: 'libraries' })
    task.setPhase('libraries', `Downloading ${items.length} server files`)
    task.add(items)
    await task.run()

    task.setPhase('verifying', 'Unpacking pack configuration')
    const overridesDir = cf?.overrides ?? 'overrides'
    const { applied, skipped: clientOverrides } = await applyOverrides(zip, dir, overridesDir)

    const clientOnly = await disableClientOnlyMods(serverId)

    task.setPhase('done', 'Server ready')
    task.markDone()

    log.info(
      `"${facts.name}" installed as a server: ${items.length} files, ${applied} overrides, ` +
        `${clientOverrides} client-only overrides skipped, ${clientOnly.length} client-only mods disabled`
    )

    return {
      server: getHostedServer(serverId),
      installedFiles: items.length,
      overrides: applied,
      skipped,
      clientOnlyMods: clientOnly,
      clientOverridesSkipped: clientOverrides
    }
  } catch (err) {
    // A half-built server is worse than none: it would sit in the list looking
    // startable and fail in a way that points nowhere near this.
    await deleteHostedServer(serverId, true).catch(() => undefined)
    throw err
  }
}

/**
 * Modrinth packs state which side each file belongs to, so the filtering here
 * is the author's own answer rather than a guess.
 */
function mrpackItems(index: MrpackIndex, dir: string, skipped: string[]): DownloadItem[] {
  const items: DownloadItem[] = []

  for (const file of index.files ?? []) {
    // The pack saying a file has no place on a server is the end of it.
    if (file.env?.server === 'unsupported') continue

    const url = (file.downloads ?? []).find(isAllowedDownload)
    if (!url) {
      skipped.push(file.path)
      log.warn(`skipping "${file.path}": no download URL from an allowed host`)
      continue
    }

    items.push({
      url,
      destination: safeTarget(dir, file.path),
      sha1: file.hashes?.sha1 ?? null,
      size: file.fileSize ?? null,
      label: file.path.split('/').pop() ?? file.path
    })
  }

  return items
}

/**
 * CurseForge manifests carry no client/server marking at all, so every mod is
 * fetched and the client-only ones are sorted out afterwards by reading what
 * the jars themselves declare.
 */
async function curseForgeItems(manifest: CfManifest, dir: string, skipped: string[]): Promise<DownloadItem[]> {
  const entries = manifest.files ?? []
  const resolved = await getFiles(entries.map((file) => file.fileID))
  const byId = new Map(resolved.map((file) => [file.id, file]))

  const items: DownloadItem[] = []
  for (const entry of entries) {
    const file = byId.get(entry.fileID)
    if (!file) {
      skipped.push(`file ${entry.fileID}`)
      continue
    }
    // No URL is the author opting out of third-party distribution, not an error.
    if (!file.downloadUrl) {
      skipped.push(file.fileName || `file ${entry.fileID}`)
      continue
    }

    items.push({
      url: file.downloadUrl,
      destination: safeTarget(dir, `mods/${file.fileName}`),
      sha1: file.hashes?.find((hash) => hash.algo === 1)?.value ?? null,
      size: file.fileLength ?? null,
      label: file.fileName
    })
  }

  return items
}

/* --------------------------------------------------------------- sources */

/** Installs a modpack archive already on disk as a hosted server. */
export async function installModpackAsServerFromFile(
  filePath: string,
  options: ModpackServerOptions = {}
): Promise<ModpackServerInstallResult> {
  if (!existsSync(filePath)) throw new LauncherError('NOT_FOUND', 'that file no longer exists')
  return await installPackAsServer(new AdmZip(filePath), options)
}

/** Downloads a Modrinth pack version, then installs it as a hosted server. */
export async function installModpackAsServerFromModrinth(
  versionId: string,
  options: ModpackServerOptions = {}
): Promise<ModpackServerInstallResult> {
  interface RawVersion {
    files: Array<{ url: string; filename: string; primary: boolean }>
    name: string
  }

  const version = await getJson<RawVersion>(`https://api.modrinth.com/v2/version/${encodeURIComponent(versionId)}`, {
    timeoutMs: 20_000,
    retries: 2
  })

  const file = version.files.find((f) => f.filename.endsWith('.mrpack')) ?? version.files.find((f) => f.primary)
  if (!file || !isAllowedDownload(file.url)) {
    throw new LauncherError('INVALID_INPUT', 'that version has no downloadable .mrpack file')
  }

  const workDir = join(tmpdir(), `nexuscraft-srvpack-${randomUUID()}`)
  await mkdir(workDir, { recursive: true })
  const localPath = join(workDir, 'pack.mrpack')
  try {
    await writeFile(localPath, await getBuffer(file.url, { timeoutMs: 300_000, retries: 2 }))
    return await installModpackAsServerFromFile(localPath, options)
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

/** Downloads a CurseForge pack file, then installs it as a hosted server. */
export async function installModpackAsServerFromCurseForge(
  projectId: string,
  fileId: string,
  options: ModpackServerOptions = {}
): Promise<ModpackServerInstallResult> {
  const [file] = await getFiles([Number(fileId)])
  if (!file?.downloadUrl) {
    throw new LauncherError('INVALID_INPUT', `modpack file ${fileId} cannot be downloaded`, {
      title: 'This modpack must be downloaded manually',
      message:
        'Its author has turned off third-party downloads on CurseForge, so no launcher may fetch it automatically. Download the pack .zip from its CurseForge page, then host it from that file.',
      actions: [
        'Open the pack page on CurseForge and download the .zip',
        'Return here and use Host a server -> From a modpack file',
        'Modrinth packs carry no such restriction'
      ]
    })
  }

  const workDir = join(tmpdir(), `nexuscraft-srvpack-${randomUUID()}`)
  await mkdir(workDir, { recursive: true })
  const localPath = join(workDir, 'pack.zip')
  try {
    await writeFile(localPath, await getBuffer(file.downloadUrl, { timeoutMs: 300_000, retries: 2 }))
    return await installModpackAsServerFromFile(localPath, options)
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

/** Exposed for tests and diagnostics. */
export const __internals = { isClientOnlyOverride, softwareForLoader, firstFreePort }
