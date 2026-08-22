/**
 * Resolving which server software to install and how to launch it.
 *
 * Vanilla is one jar from Mojang and nothing else. Everything players actually
 * want — plugins, mods, performance patches — needs a different jar from a
 * different place, and two of them need an installer run before the server can
 * start at all. This module hides those differences behind two questions:
 *
 *   provision() — what do I download, and does anything need running after?
 *   launchPlan() — what arguments start the thing that provisioning produced?
 *
 * Each provider is fetched from its own project's official API. None of them are
 * mirrored or repackaged.
 */

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ServerSoftware } from '@shared/types'
import { getJson } from '../../core/http'
import { LauncherError } from '../../core/errors'
import { createLogger } from '../../core/logger'
import { componentForMajor, managedRuntimeInstalled, installManagedRuntime } from '../java/javaService'
import type { DownloadTask } from '../downloads/downloadManager'

const log = createLogger('server-software')

/*
 * PaperMC retired the v2 API — it answers 410 Gone — and replaced it with the
 * "fill" service on its own host. api.papermc.io/v3 is not the same thing and
 * refuses requests.
 */
const PAPER_API = 'https://fill.papermc.io/v3/projects'
const PURPUR_API = 'https://api.purpurmc.org/v2/purpur'
const FABRIC_META = 'https://meta.fabricmc.net/v2'
const FORGE_MAVEN = 'https://maven.minecraftforge.net'
// The promotions file is served from files., not the maven host, which 404s.
const FORGE_PROMOS = 'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json'
const NEOFORGE_MAVEN = 'https://maven.neoforged.net/releases'
const NEOFORGE_API = 'https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge'

export interface SoftwareInfo {
  id: ServerSoftware
  label: string
  /** One line describing what this is for, shown next to the choice. */
  blurb: string
  /** True when the server accepts Bukkit/Spigot plugins. */
  plugins: boolean
  /** True when the server accepts client-side-compatible mods. */
  mods: boolean
}

export const SOFTWARE: SoftwareInfo[] = [
  {
    id: 'vanilla',
    label: 'Vanilla',
    blurb: "Mojang's own server. No plugins or mods, exactly the game as shipped.",
    plugins: false,
    mods: false
  },
  {
    id: 'paper',
    label: 'Paper',
    blurb: 'The usual choice. Much faster than vanilla and runs Bukkit and Spigot plugins.',
    plugins: true,
    mods: false
  },
  {
    id: 'purpur',
    label: 'Purpur',
    blurb: 'Paper with a large set of extra gameplay toggles. Runs the same plugins.',
    plugins: true,
    mods: false
  },
  {
    id: 'fabric',
    label: 'Fabric',
    blurb: 'Lightweight mod loader. Players need the same mods installed to join.',
    plugins: false,
    mods: true
  },
  {
    id: 'forge',
    label: 'Forge',
    blurb: 'The long-established mod loader, used by most big modpacks.',
    plugins: false,
    mods: true
  },
  {
    id: 'neoforge',
    label: 'NeoForge',
    blurb: 'The actively developed fork of Forge. Covers 1.20.2 onwards.',
    plugins: false,
    mods: true
  }
]

export function softwareLabel(id: ServerSoftware): string {
  return SOFTWARE.find((s) => s.id === id)?.label ?? id
}

/** What provisioning decided: a file to fetch, and possibly an installer to run. */
export interface Provisioned {
  /** Direct download of the jar to place in the server directory. */
  url: string
  /** File name to save it as, relative to the server directory. */
  fileName: string
  /** Version of the server software itself (build number or loader version). */
  softwareVersion: string
  /**
   * True when `fileName` is an installer that must be run before the server
   * exists. Forge and NeoForge patch libraries in ways only their own code knows.
   */
  isInstaller: boolean
  /** Expected byte count, when the provider publishes one. */
  size?: number | null
}

/* --------------------------------------------------------------- helpers */

function unsupported(software: ServerSoftware, minecraftVersion: string, detail: string): LauncherError {
  return new LauncherError('NOT_FOUND', `${software} has no build for ${minecraftVersion}: ${detail}`, {
    title: `${softwareLabel(software)} does not support Minecraft ${minecraftVersion}`,
    message: `The ${softwareLabel(software)} project has not published a server build for that Minecraft version.`,
    actions: ['Pick a different Minecraft version', 'Or choose different server software']
  })
}

/* ------------------------------------------------------------ provisioning */

export async function provision(
  software: ServerSoftware,
  minecraftVersion: string,
  vanillaServerUrl: string | null
): Promise<Provisioned> {
  switch (software) {
    case 'vanilla': {
      if (!vanillaServerUrl) throw unsupported('vanilla', minecraftVersion, 'Mojang publishes no server jar')
      return { url: vanillaServerUrl, fileName: 'server.jar', softwareVersion: minecraftVersion, isInstaller: false }
    }

    case 'paper':
      return await provisionPaper(minecraftVersion)

    case 'purpur':
      return await provisionPurpur(minecraftVersion)

    case 'fabric':
      return await provisionFabric(minecraftVersion)

    case 'forge':
      return await provisionForge(minecraftVersion)

    case 'neoforge':
      return await provisionNeoForge(minecraftVersion)

    default:
      throw new LauncherError('INVALID_INPUT', `unknown server software "${software}"`)
  }
}

interface PaperBuild {
  id: number
  channel: string
  downloads: Record<string, { name: string; size: number; url: string }>
}

async function provisionPaper(minecraftVersion: string): Promise<Provisioned> {
  let builds: PaperBuild[]
  try {
    builds = await getJson<PaperBuild[]>(`${PAPER_API}/paper/versions/${minecraftVersion}/builds`, {
      timeoutMs: 30_000
    })
  } catch (err) {
    throw unsupported('paper', minecraftVersion, (err as Error).message)
  }

  // The list arrives newest first, so the first STABLE entry is the newest one.
  const chosen = builds.find((b) => b.channel === 'STABLE') ?? builds[0]
  const download = chosen?.downloads?.['server:default']
  if (!download?.url) throw unsupported('paper', minecraftVersion, 'no server download in the build list')

  return {
    url: download.url,
    fileName: 'server.jar',
    softwareVersion: `build ${chosen.id}`,
    isInstaller: false,
    size: download.size ?? null
  }
}

async function provisionPurpur(minecraftVersion: string): Promise<Provisioned> {
  let data: { builds: { latest: string } }
  try {
    data = await getJson(`${PURPUR_API}/${minecraftVersion}`, { timeoutMs: 30_000 })
  } catch (err) {
    throw unsupported('purpur', minecraftVersion, (err as Error).message)
  }

  const build = data.builds?.latest
  if (!build) throw unsupported('purpur', minecraftVersion, 'no builds listed')

  return {
    url: `${PURPUR_API}/${minecraftVersion}/${build}/download`,
    fileName: 'server.jar',
    softwareVersion: `build ${build}`,
    isInstaller: false
  }
}

async function provisionFabric(minecraftVersion: string): Promise<Provisioned> {
  const [loaders, installers] = await Promise.all([
    getJson<Array<{ loader: { version: string; stable: boolean } }>>(
      `${FABRIC_META}/versions/loader/${minecraftVersion}`,
      { timeoutMs: 30_000 }
    ).catch(() => []),
    getJson<Array<{ version: string; stable: boolean }>>(`${FABRIC_META}/versions/installer`, { timeoutMs: 30_000 })
  ])

  const loader = loaders.find((l) => l.loader.stable)?.loader.version ?? loaders[0]?.loader.version
  if (!loader) throw unsupported('fabric', minecraftVersion, 'no loader versions for this Minecraft version')

  const installer = installers.find((i) => i.stable)?.version ?? installers[0]?.version
  if (!installer) throw unsupported('fabric', minecraftVersion, 'no installer versions published')

  // Fabric serves a ready-made launch jar; it fetches its own libraries on first run.
  return {
    url: `${FABRIC_META}/versions/loader/${minecraftVersion}/${loader}/${installer}/server/jar`,
    fileName: 'server.jar',
    softwareVersion: `loader ${loader}`,
    isInstaller: false
  }
}

async function provisionForge(minecraftVersion: string): Promise<Provisioned> {
  const promos = await getJson<{ promos: Record<string, string> }>(FORGE_PROMOS, { timeoutMs: 30_000 })
  const build =
    promos.promos[`${minecraftVersion}-recommended`] ?? promos.promos[`${minecraftVersion}-latest`] ?? null
  if (!build) throw unsupported('forge', minecraftVersion, 'not in the Forge promotions list')

  const full = `${minecraftVersion}-${build}`
  return {
    url: `${FORGE_MAVEN}/net/minecraftforge/forge/${full}/forge-${full}-installer.jar`,
    fileName: 'installer.jar',
    softwareVersion: build,
    isInstaller: true
  }
}

async function provisionNeoForge(minecraftVersion: string): Promise<Provisioned> {
  const data = await getJson<{ versions: string[] }>(NEOFORGE_API, { timeoutMs: 30_000 })

  /*
   * NeoForge's version line is derived from the Minecraft version, and the rule
   * changed when Mojang moved to year-based numbering:
   *   1.21.1  ->  21.1.x   (the leading "1." is dropped)
   *   26.2    ->  26.2.x   (used as-is)
   * Assuming everything starts with "1." made 26.x look unsupported when the
   * project had in fact published for it.
   */
  const parts = minecraftVersion.split('.')
  const prefix =
    parts[0] === '1' && parts.length >= 2
      ? `${parts[1]}.${parts[2] ?? '0'}.`
      : `${parts.slice(0, 2).join('.')}.`

  const matching = data.versions.filter((v) => v.startsWith(prefix) && !v.includes('beta'))
  const chosen = matching[matching.length - 1] ?? data.versions.filter((v) => v.startsWith(prefix)).pop()
  if (!chosen) throw unsupported('neoforge', minecraftVersion, 'no matching version line')

  return {
    url: `${NEOFORGE_MAVEN}/net/neoforged/neoforge/${chosen}/neoforge-${chosen}-installer.jar`,
    fileName: 'installer.jar',
    softwareVersion: chosen,
    isInstaller: true
  }
}

/* ------------------------------------------------------------- installers */

/**
 * Runs a Forge or NeoForge server installer.
 *
 * The JVM choice matters and is not simply "the newest available": these
 * installers fail on very new JVMs in ways that produce truncated, unhelpful
 * output. The launcher already learned this for client installs — the same cap
 * at Java 17 applies here, with a retry on the version's own runtime if the
 * installer genuinely needs something newer.
 */
export async function runServerInstaller(
  dir: string,
  installerJar: string,
  requiredMajor: number,
  task: DownloadTask
): Promise<void> {
  const resolveRuntime = async (major: number): Promise<string> => {
    const component = componentForMajor(major)
    return managedRuntimeInstalled(component) ?? (await installManagedRuntime(component, task))
  }

  const run = async (javaPath: string): Promise<{ ok: boolean; output: string }> =>
    await new Promise((resolve) => {
      execFile(
        javaPath,
        ['-jar', installerJar, '--installServer'],
        { cwd: dir, timeout: 900_000, windowsHide: true, maxBuffer: 32 * 1024 * 1024 },
        (error, stdout, stderr) => resolve({ ok: !error, output: `${stdout}\n${stderr}` })
      )
    })

  const installerMajor = Math.min(requiredMajor, 17)
  task.setPhase('loader', 'Running the server installer')

  let result = await run(await resolveRuntime(installerMajor))

  if (!result.ok && /UnsupportedClassVersionError|class file version/i.test(result.output)) {
    log.warn(`server installer needs a newer JVM than ${installerMajor}; retrying on Java ${requiredMajor}`)
    result = await run(await resolveRuntime(requiredMajor))
  }

  if (!result.ok) {
    const tail = result.output.trim().split('\n').slice(-6).join('\n')
    throw new LauncherError('LOADER_INSTALL_FAILED', `server installer failed: ${tail}`, {
      title: 'The mod loader installer did not finish',
      message: 'The official installer ran but reported a failure.',
      actions: ['Try a different Minecraft version', 'Or use Paper if you only need plugins']
    })
  }

  log.info('server installer finished')
}

/* ----------------------------------------------------------- launch plan */

export interface LaunchPlan {
  /** Arguments after the memory flags. */
  args: string[]
}

/**
 * Works out how to start whatever provisioning left in the directory.
 *
 * Modern Forge and NeoForge no longer produce a runnable jar: the installer
 * writes an argument file under `libraries/` that the JVM reads with `@`. Older
 * Forge versions still leave a jar. Both shapes are handled by looking at what
 * is actually on disk rather than guessing from the version number.
 */
export async function launchPlan(dir: string, software: ServerSoftware): Promise<LaunchPlan> {
  if (software !== 'forge' && software !== 'neoforge') {
    return { args: ['-jar', 'server.jar', '--nogui'] }
  }

  const argsFile = await findArgsFile(dir, software)
  if (argsFile) {
    // The installer also expects a user JVM args file to exist alongside it.
    const userArgs = join(dir, 'user_jvm_args.txt')
    if (!existsSync(userArgs)) {
      await writeFile(userArgs, '# JVM arguments are set by the launcher.\n', 'utf8')
    }
    return { args: [`@${argsFile}`, '--nogui'] }
  }

  // Pre-1.17 Forge leaves a directly runnable universal jar.
  const jar = (await readdir(dir)).find((f) => /^(forge|neoforge).*\.jar$/i.test(f) && !/installer/i.test(f))
  if (jar) return { args: ['-jar', jar, '--nogui'] }

  throw new LauncherError('NOT_FOUND', 'the installer left nothing runnable behind', {
    title: 'Could not work out how to start this server',
    message: 'The mod loader installer finished but produced neither an argument file nor a server jar.',
    actions: ['Try a different Minecraft version', 'Or use Paper if you only need plugins']
  })
}

/** Locates the `*_args.txt` the modern installers generate, relative to `dir`. */
async function findArgsFile(dir: string, software: ServerSoftware): Promise<string | null> {
  const vendor = software === 'forge' ? 'net/minecraftforge/forge' : 'net/neoforged/neoforge'
  const base = join(dir, 'libraries', ...vendor.split('/'))
  if (!existsSync(base)) return null

  for (const version of await readdir(base)) {
    for (const candidate of ['win_args.txt', 'unix_args.txt']) {
      const relative = `libraries/${vendor}/${version}/${candidate}`
      if (existsSync(join(dir, ...relative.split('/')))) return relative
    }
  }
  return null
}
