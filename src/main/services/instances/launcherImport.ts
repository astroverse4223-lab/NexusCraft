import { existsSync } from 'node:fs'
import { cp, readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { LoaderId } from '@shared/types'
import { createLogger } from '../../core/logger'
import { LauncherError } from '../../core/errors'
import { createInstance, ensureInstanceLayout, instanceSubdir } from './instanceService'

const log = createLogger('import')

/**
 * Bringing instances over from whichever launcher you used before.
 *
 * This is the thing that stops people changing launcher: not features, but the
 * prospect of rebuilding twenty modpacks by hand. Every launcher stores its
 * instances differently, but they all agree on the parts that matter — a
 * Minecraft version, a loader, and a folder with mods and worlds in it — so
 * each format needs only enough parsing to find those three.
 *
 * Nothing is moved. Files are copied, and the original install is left exactly
 * as it was, so trying this out cannot cost anyone the setup they already have.
 */

export type ForeignLauncher = 'curseforge' | 'prism' | 'multimc' | 'modrinth' | 'vanilla' | 'gdlauncher'

export interface ForeignInstance {
  /** Stable within one scan, used to ask for this instance by name later. */
  id: string
  launcher: ForeignLauncher
  name: string
  minecraftVersion: string
  loader: LoaderId
  loaderVersion: string | null
  /** The folder holding mods, config and saves. */
  gameDir: string
  mods: number
  worlds: number
  sizeBytes: number
}

/** Where each launcher keeps its instances on Windows. */
function candidateRoots(): Array<{ launcher: ForeignLauncher; dir: string }> {
  const home = homedir()
  const appData = process.env.APPDATA ?? join(home, 'AppData', 'Roaming')
  const localAppData = process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local')

  return [
    { launcher: 'curseforge', dir: join(home, 'curseforge', 'minecraft', 'Instances') },
    { launcher: 'curseforge', dir: join(home, 'Documents', 'curseforge', 'minecraft', 'Instances') },
    { launcher: 'prism', dir: join(appData, 'PrismLauncher', 'instances') },
    { launcher: 'prism', dir: join(localAppData, 'Programs', 'PrismLauncher', 'instances') },
    { launcher: 'multimc', dir: join(appData, 'MultiMC', 'instances') },
    { launcher: 'modrinth', dir: join(appData, 'com.modrinth.theseus', 'profiles') },
    { launcher: 'modrinth', dir: join(appData, 'ModrinthApp', 'profiles') },
    { launcher: 'gdlauncher', dir: join(appData, 'gdlauncher_next', 'instances') },
    { launcher: 'vanilla', dir: join(appData, '.minecraft') }
  ]
}

/** Reads a loader id out of the strings these launchers actually write. */
function loaderFrom(text: string): LoaderId {
  const lower = text.toLowerCase()
  if (lower.includes('neoforge')) return 'neoforge'
  if (lower.includes('forge')) return 'forge'
  if (lower.includes('fabric')) return 'fabric'
  if (lower.includes('quilt')) return 'quilt'
  return 'vanilla'
}

async function countIn(dir: string, filter: (name: string) => boolean): Promise<number> {
  try {
    return (await readdir(dir)).filter(filter).length
  } catch {
    return 0
  }
}

/** Rough size of a folder, one level deep — enough to warn about a big copy. */
async function roughSize(dir: string): Promise<number> {
  let total = 0
  try {
    for (const name of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, name.name)
      try {
        if (name.isFile()) total += (await stat(path)).size
        else if (name.isDirectory()) {
          for (const inner of await readdir(path, { withFileTypes: true })) {
            if (inner.isFile()) total += (await stat(join(path, inner.name))).size
          }
        }
      } catch {
        /* skip anything unreadable */
      }
    }
  } catch {
    /* an unreadable folder reports zero rather than failing the scan */
  }
  return total
}

/* --------------------------------------------------------------- formats */

/**
 * CurseForge writes `minecraftinstance.json` beside the game folder, holding
 * both the Minecraft version and the loader as a single "modloader" id like
 * `forge-47.2.0` or `fabric-0.15.7-1.20.1`.
 */
async function readCurseForge(dir: string, name: string): Promise<ForeignInstance | null> {
  const manifest = join(dir, 'minecraftinstance.json')
  if (!existsSync(manifest)) return null

  try {
    const parsed = JSON.parse(await readFile(manifest, 'utf8')) as {
      name?: string
      baseModLoader?: { name?: string; minecraftVersion?: string; forgeVersion?: string }
      gameVersion?: string
    }

    const minecraftVersion = parsed.baseModLoader?.minecraftVersion ?? parsed.gameVersion ?? ''
    if (!minecraftVersion) return null

    const loaderName = parsed.baseModLoader?.name ?? ''
    return {
      id: `curseforge:${name}`,
      launcher: 'curseforge',
      name: parsed.name ?? name,
      minecraftVersion,
      loader: loaderFrom(loaderName),
      loaderVersion: parsed.baseModLoader?.forgeVersion ?? null,
      gameDir: dir,
      mods: await countIn(join(dir, 'mods'), (file) => file.endsWith('.jar')),
      worlds: await countIn(join(dir, 'saves'), () => true),
      sizeBytes: await roughSize(dir)
    }
  } catch {
    return null
  }
}

/**
 * Prism and MultiMC share a format: an `instance.cfg` of key=value pairs beside
 * a `.minecraft` (Prism calls it `minecraft`) folder, with the versions in
 * `mmc-pack.json`.
 */
async function readPrismLike(
  dir: string,
  name: string,
  launcher: ForeignLauncher
): Promise<ForeignInstance | null> {
  const config = join(dir, 'instance.cfg')
  if (!existsSync(config)) return null

  // Prism renamed the folder; both spellings are still in the wild.
  const gameDir = ['minecraft', '.minecraft'].map((entry) => join(dir, entry)).find((entry) => existsSync(entry))
  if (!gameDir) return null

  let displayName = name
  try {
    const text = await readFile(config, 'utf8')
    const match = /^name\s*=\s*(.+)$/m.exec(text)
    if (match) displayName = match[1].trim()
  } catch {
    /* the folder name is a fine fallback */
  }

  let minecraftVersion = ''
  let loader: LoaderId = 'vanilla'
  let loaderVersion: string | null = null

  try {
    const pack = JSON.parse(await readFile(join(dir, 'mmc-pack.json'), 'utf8')) as {
      components?: Array<{ uid?: string; version?: string; cachedName?: string }>
    }
    for (const component of pack.components ?? []) {
      const uid = component.uid ?? ''
      if (uid === 'net.minecraft') minecraftVersion = component.version ?? ''
      else if (uid.includes('fabric') || uid.includes('forge') || uid.includes('quilt')) {
        loader = loaderFrom(uid)
        loaderVersion = component.version ?? null
      }
    }
  } catch {
    return null
  }

  if (!minecraftVersion) return null

  return {
    id: `${launcher}:${name}`,
    launcher,
    name: displayName,
    minecraftVersion,
    loader,
    loaderVersion,
    gameDir,
    mods: await countIn(join(gameDir, 'mods'), (file) => file.endsWith('.jar')),
    worlds: await countIn(join(gameDir, 'saves'), () => true),
    sizeBytes: await roughSize(gameDir)
  }
}

/** The Modrinth app keeps a `profile.json` in each profile folder. */
async function readModrinth(dir: string, name: string): Promise<ForeignInstance | null> {
  const manifest = join(dir, 'profile.json')
  if (!existsSync(manifest)) return null

  try {
    const parsed = JSON.parse(await readFile(manifest, 'utf8')) as {
      name?: string
      game_version?: string
      loader?: string
      loader_version?: { id?: string }
    }
    if (!parsed.game_version) return null

    return {
      id: `modrinth:${name}`,
      launcher: 'modrinth',
      name: parsed.name ?? name,
      minecraftVersion: parsed.game_version,
      loader: loaderFrom(parsed.loader ?? ''),
      loaderVersion: parsed.loader_version?.id ?? null,
      gameDir: dir,
      mods: await countIn(join(dir, 'mods'), (file) => file.endsWith('.jar')),
      worlds: await countIn(join(dir, 'saves'), () => true),
      sizeBytes: await roughSize(dir)
    }
  } catch {
    return null
  }
}

/**
 * A plain `.minecraft` folder from the official launcher.
 *
 * It has no instances, so it is offered as a single import of whatever is
 * there. The version is read from the newest folder under `versions/`, which
 * is a guess — but a labelled one, and the alternative is not offering the
 * official launcher's saves at all.
 */
async function readVanilla(dir: string): Promise<ForeignInstance | null> {
  if (!existsSync(join(dir, 'saves')) && !existsSync(join(dir, 'versions'))) return null

  let minecraftVersion = ''
  try {
    const versions = await readdir(join(dir, 'versions'))
    // Plain release numbers only; loader profiles have longer names.
    const releases = versions.filter((name) => /^\d+\.\d+(\.\d+)?$/.test(name))
    minecraftVersion = releases.sort().pop() ?? ''
  } catch {
    /* handled below */
  }
  if (!minecraftVersion) return null

  return {
    id: 'vanilla:.minecraft',
    launcher: 'vanilla',
    name: 'Minecraft (official launcher)',
    minecraftVersion,
    loader: 'vanilla',
    loaderVersion: null,
    gameDir: dir,
    mods: await countIn(join(dir, 'mods'), (file) => file.endsWith('.jar')),
    worlds: await countIn(join(dir, 'saves'), () => true),
    sizeBytes: await roughSize(dir)
  }
}

/* ----------------------------------------------------------------- scan */

/** Everything importable that this machine can be found to hold. */
export async function findForeignInstances(): Promise<ForeignInstance[]> {
  const found: ForeignInstance[] = []

  for (const { launcher, dir } of candidateRoots()) {
    if (!existsSync(dir)) continue

    if (launcher === 'vanilla') {
      const entry = await readVanilla(dir)
      if (entry) found.push(entry)
      continue
    }

    let names: string[]
    try {
      names = (await readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name)
    } catch {
      continue
    }

    for (const name of names) {
      const path = join(dir, name)
      const entry =
        launcher === 'curseforge' || launcher === 'gdlauncher'
          ? await readCurseForge(path, name)
          : launcher === 'modrinth'
            ? await readModrinth(path, name)
            : await readPrismLike(path, name, launcher)

      if (entry) found.push(entry)
    }
  }

  // Same pack imported from two launchers is worth showing twice; same folder
  // reached by two candidate roots is not.
  const seen = new Set<string>()
  const unique = found.filter((entry) => {
    const key = entry.gameDir.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  log.info(`found ${unique.length} importable instance(s)`)
  return unique
}

/** What gets copied across, and what is deliberately left behind. */
const COPY_FOLDERS = ['mods', 'config', 'saves', 'resourcepacks', 'shaderpacks', 'scripts', 'kubejs', 'defaultconfigs']
const COPY_FILES = ['options.txt', 'servers.dat', 'optionsof.txt']

export interface ImportResult {
  instanceId: string
  name: string
  copiedFolders: string[]
  skipped: string[]
}

/**
 * Copies a foreign instance into a new NexusCraft instance.
 *
 * Only the parts that are the user's are taken: mods, configs, worlds, packs
 * and settings. Game files — the version jars, libraries, assets — are left
 * behind deliberately, because the launcher downloads and verifies its own, and
 * copying another launcher's cache is how you inherit its corruption.
 */
export async function importForeignInstance(entry: ForeignInstance, name?: string): Promise<ImportResult> {
  if (!existsSync(entry.gameDir)) {
    throw new LauncherError('NOT_FOUND', 'that instance folder is gone', {
      title: `${entry.name} is no longer where it was`,
      message: 'The folder it was found in has moved or been deleted since the scan.',
      actions: ['Scan again']
    })
  }

  const instance = await createInstance({
    name: (name ?? entry.name).slice(0, 64),
    minecraftVersion: entry.minecraftVersion,
    loader: entry.loader,
    loaderVersion: entry.loaderVersion
  })
  await ensureInstanceLayout(instance)

  const copied: string[] = []
  const skipped: string[] = []

  for (const folder of COPY_FOLDERS) {
    const source = join(entry.gameDir, folder)
    if (!existsSync(source)) continue
    try {
      await cp(source, instanceSubdir(instance, folder), { recursive: true, force: true })
      copied.push(folder)
    } catch (err) {
      skipped.push(`${folder} (${(err as Error).message})`)
    }
  }

  for (const file of COPY_FILES) {
    const source = join(entry.gameDir, file)
    if (!existsSync(source)) continue
    try {
      await cp(source, join(instance.gameDir, file), { force: true })
      copied.push(file)
    } catch (err) {
      skipped.push(`${file} (${(err as Error).message})`)
    }
  }

  log.info(`imported "${entry.name}" from ${entry.launcher} into ${instance.id}`)
  return { instanceId: instance.id, name: instance.name, copiedFolders: copied, skipped }
}
