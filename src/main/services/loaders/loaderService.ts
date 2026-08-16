import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { writeFile, mkdir, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { LoaderId, LoaderVersion } from '@shared/types'
import { getJson, getText, getBuffer } from '../../core/http'
import { LauncherError } from '../../core/errors'
import { createLogger } from '../../core/logger'
import { dataRoot, versionsRoot, ensureDir } from '../../core/paths'
import { installVersion, listInstalledVersionIds, versionDir } from '../minecraft/versionService'
import { componentForMajor, installManagedRuntime, managedRuntimeInstalled } from '../java/javaService'
import type { DownloadTask } from '../downloads/downloadManager'
import type { VersionJson } from '../minecraft/versionTypes'

const log = createLogger('loaders')

const FABRIC_META = 'https://meta.fabricmc.net/v2'
const QUILT_META = 'https://meta.quiltmc.org/v3'
const NEOFORGE_MAVEN = 'https://maven.neoforged.net/releases'
const NEOFORGE_API = 'https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge'
const FORGE_MAVEN = 'https://maven.minecraftforge.net'
const FORGE_PROMOS = 'https://maven.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json'

/* ------------------------------------------------------------ listing */

interface FabricLoaderEntry {
  loader: { version: string; stable: boolean; build: number }
}

async function fabricVersions(base: string, minecraftVersion: string): Promise<LoaderVersion[]> {
  const entries = await getJson<FabricLoaderEntry[]>(
    `${base}/versions/loader/${encodeURIComponent(minecraftVersion)}`,
    { timeoutMs: 15_000 }
  )
  return entries.map((entry, index) => ({
    version: entry.loader.version,
    stable: entry.loader.stable,
    // The first stable entry is what the loader's own installer defaults to.
    recommended: index === entries.findIndex((e) => e.loader.stable)
  }))
}

async function neoforgeVersions(minecraftVersion: string): Promise<LoaderVersion[]> {
  const data = await getJson<{ versions: string[] }>(NEOFORGE_API, { timeoutMs: 15_000 })

  // NeoForge encodes the Minecraft version in its own: 1.21.4 -> 21.4.x
  const parts = minecraftVersion.split('.')
  if (parts[0] !== '1' || parts.length < 2) return []
  const prefix = `${parts[1]}.${parts[2] ?? '0'}.`

  const matching = data.versions.filter((v) => v.startsWith(prefix)).reverse()
  return matching.map((version, index) => ({
    version,
    stable: !version.includes('beta'),
    recommended: index === matching.findIndex((v) => !v.includes('beta'))
  }))
}

async function forgeVersions(minecraftVersion: string): Promise<LoaderVersion[]> {
  const [xml, promos] = await Promise.all([
    getText(`${FORGE_MAVEN}/net/minecraftforge/forge/maven-metadata.xml`, { timeoutMs: 15_000 }),
    getJson<{ promos: Record<string, string> }>(FORGE_PROMOS, { timeoutMs: 15_000 }).catch(
      // The promotions file is advisory: losing it costs the "recommended"
      // marker, not the version list itself.
      () => ({ promos: {} as Record<string, string> })
    )
  ])

  const all = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1])
  const recommended = promos.promos[`${minecraftVersion}-recommended`]
  const latest = promos.promos[`${minecraftVersion}-latest`]

  const matching = all.filter((v) => v.startsWith(`${minecraftVersion}-`)).reverse()
  return matching.map((full) => {
    // Entries look like "1.20.1-47.3.0" or "1.12.2-14.23.5.2859-1.12.2".
    const build = full.slice(minecraftVersion.length + 1)
    return {
      version: full,
      stable: build === recommended,
      recommended: build === (recommended ?? latest)
    }
  })
}

export async function listLoaderVersions(loader: LoaderId, minecraftVersion: string): Promise<LoaderVersion[]> {
  try {
    switch (loader) {
      case 'fabric':
        return await fabricVersions(FABRIC_META, minecraftVersion)
      case 'quilt':
        return await fabricVersions(QUILT_META, minecraftVersion)
      case 'neoforge':
        return await neoforgeVersions(minecraftVersion)
      case 'forge':
        return await forgeVersions(minecraftVersion)
      default:
        return []
    }
  } catch (err) {
    log.warn(`could not list ${loader} versions for ${minecraftVersion}: ${(err as Error).message}`)
    return []
  }
}

/* --------------------------------------------------------- installation */

/**
 * Fabric and Quilt publish a ready-made version profile, so installing them is
 * just fetching that json and writing it into versions/.
 */
async function installFabricLike(
  base: string,
  minecraftVersion: string,
  loaderVersion: string
): Promise<string> {
  const profile = await getJson<VersionJson>(
    `${base}/versions/loader/${encodeURIComponent(minecraftVersion)}/${encodeURIComponent(loaderVersion)}/profile/json`,
    { timeoutMs: 20_000 }
  )
  if (!profile.id) throw new LauncherError('LOADER_INSTALL_FAILED', 'loader profile had no id')

  const dir = ensureDir(versionDir(profile.id))
  await writeFile(join(dir, `${profile.id}.json`), JSON.stringify(profile, null, 2), 'utf8')
  log.info(`installed loader profile ${profile.id}`)
  return profile.id
}

/**
 * The Forge and NeoForge installers run library patching steps that only their
 * own code knows how to perform, so the launcher runs the official installer in
 * client mode rather than trying to reimplement it.
 */
async function runInstallerJar(
  installerUrl: string,
  label: string,
  task: DownloadTask,
  minecraftVersion: string
): Promise<string> {
  const before = new Set(await listInstalledVersionIds())

  /*
   * The installer patches the vanilla client jar and loads vanilla libraries
   * while doing it, so those have to be on disk first. Assets are skipped —
   * they are hundreds of megabytes and the installer never touches them.
   */
  task.setPhase('libraries', `Preparing Minecraft ${minecraftVersion} for ${label}`)
  const vanilla = await installVersion(minecraftVersion, { task, skipAssets: true })

  task.setPhase('loader', `Downloading the ${label} installer`)
  const jarBytes = await getBuffer(installerUrl, { timeoutMs: 120_000, retries: 2 })

  const workDir = join(tmpdir(), `nexuscraft-${label.toLowerCase()}-${Date.now()}`)
  await mkdir(workDir, { recursive: true })
  const jarPath = join(workDir, 'installer.jar')
  await writeFile(jarPath, jarBytes)

  // The installers refuse to run unless a launcher profile file is present.
  const profilesFile = join(dataRoot(), 'launcher_profiles.json')
  if (!existsSync(profilesFile)) {
    await writeFile(profilesFile, JSON.stringify({ profiles: {}, version: 3 }, null, 2), 'utf8')
  }
  const microsoftStoreFile = join(dataRoot(), 'launcher_profiles_microsoft_store.json')
  if (!existsSync(microsoftStoreFile)) {
    await writeFile(microsoftStoreFile, JSON.stringify({ profiles: {}, version: 3 }, null, 2), 'utf8')
  }

  /*
   * Which JVM runs the installer matters, and it is NOT simply the newest one.
   *
   * Both the Forge and NeoForge remapping toolchains abort part-way through on
   * Mojang's Java 21 runtime. The process dies during "Processing entries" with
   * exit code 127, no error message and none of the patched jars it should
   * produce — leaving a version profile that looks installed but cannot launch.
   * The identical installers complete on Java 17:
   *
   *   Forge 1.20.1    Java 21 -> exit 127,  890 lines, no patched jars
   *                   Java 17 -> exit 0, 13,075 lines, "Successfully installed"
   *   NeoForge 21.1.248  Java 21 -> exit 127, 1,096 lines
   *                      Java 17 -> exit 0,  9,794 lines, "Successfully installed"
   *
   * So the installer JVM is capped at 17, while never dropping below what the
   * Minecraft version itself needs (old Forge builds require Java 8). If an
   * installer genuinely needs something newer it says so, and we retry below.
   */
  const requiredMajor = vanilla.javaVersion?.majorVersion ?? 17
  const installerMajor = Math.min(requiredMajor, 17)

  const resolveRuntime = async (major: number): Promise<string> => {
    const component = componentForMajor(major)
    return managedRuntimeInstalled(component) ?? (await installManagedRuntime(component, task))
  }

  const runInstaller = async (javaPath: string): Promise<{ ok: boolean; output: string }> =>
    await new Promise((resolve) => {
      const child = execFile(
        javaPath,
        ['-jar', jarPath, '--installClient', dataRoot()],
        { cwd: workDir, timeout: 900_000, windowsHide: true, maxBuffer: 32 * 1024 * 1024 },
        (error, stdout, stderr) => {
          resolve({ ok: !error, output: `${stdout}\n${stderr}` })
        }
      )
      child.on('error', (err) => resolve({ ok: false, output: String(err) }))
    })

  try {
    const installerJava = await resolveRuntime(installerMajor)
    task.setPhase('loader', `Running the ${label} installer`)
    log.info(`running the ${label} installer on Java ${installerMajor} (${installerJava})`)

    let result = await runInstaller(installerJava)

    // Only a genuinely newer-JVM requirement justifies retrying on the runtime
    // the game needs; anything else is a real installer failure.
    if (!result.ok && /UnsupportedClassVersionError|class file version/i.test(result.output)) {
      const fallback = await resolveRuntime(requiredMajor)
      log.warn(`${label} installer needs a newer JVM than ${installerMajor}; retrying on Java ${requiredMajor}`)
      result = await runInstaller(fallback)
    }

    if (!result.ok) {
      // The output is thousands of lines of remapping chatter, most of it
      // harmless "Can't Find Class" notes, so pull out the lines that explain
      // the failure rather than blindly keeping the tail.
      const lines = result.output.trim().split(/\r?\n/).filter((line) => !/Can.t Find Class/i.test(line))
      const meaningful = lines.filter((line) => /error|exception|failed|caused by/i.test(line)).slice(-8)
      const detail = (meaningful.length > 0 ? meaningful : lines.slice(-12)).join('\n')

      throw new LauncherError('LOADER_INSTALL_FAILED', `${label} installer exited with an error:\n${detail}`, {
        title: `The ${label} installer failed`,
        message: `${label} could not be installed for Minecraft ${minecraftVersion}. This usually means the loader build does not match the Minecraft version, or the installer could not write to the data folder.`,
        actions: [
          `Pick a different ${label} version`,
          'Check that the Minecraft version and loader version go together',
          'Make sure antivirus is not blocking Java from writing files'
        ]
      })
    }
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined)
  }

  // Identify what the installer added by diffing the versions directory.
  const after = await listInstalledVersionIds()
  const added = after.filter((id) => !before.has(id))
  if (added.length === 0) {
    throw new LauncherError('LOADER_INSTALL_FAILED', `${label} installer produced no new version profile`)
  }
  // If several appeared, prefer the one naming the loader.
  const match = added.find((id) => id.toLowerCase().includes(label.toLowerCase())) ?? added[0]
  log.info(`installed loader profile ${match}`)
  return match
}

/**
 * Installs a mod loader and returns the version id to launch. Returns the
 * vanilla version id unchanged for `vanilla`.
 */
export async function installLoader(
  loader: LoaderId,
  minecraftVersion: string,
  loaderVersion: string | null,
  task: DownloadTask
): Promise<string> {
  if (loader === 'vanilla') return minecraftVersion

  if (!loaderVersion) {
    const available = await listLoaderVersions(loader, minecraftVersion)
    const chosen = available.find((v) => v.recommended) ?? available.find((v) => v.stable) ?? available[0]
    if (!chosen) {
      throw new LauncherError('LOADER_INSTALL_FAILED', `no ${loader} builds for ${minecraftVersion}`, {
        title: `${loaderLabel(loader)} is not available for Minecraft ${minecraftVersion}`,
        message: `No ${loaderLabel(loader)} build has been published for Minecraft ${minecraftVersion}.`,
        actions: [
          'Choose a different Minecraft version',
          `Or choose a different mod loader for this instance`
        ]
      })
    }
    loaderVersion = chosen.version
  }

  task.setPhase('loader', `Installing ${loaderLabel(loader)} ${loaderVersion}`)

  switch (loader) {
    case 'fabric':
      return await installFabricLike(FABRIC_META, minecraftVersion, loaderVersion)
    case 'quilt':
      return await installFabricLike(QUILT_META, minecraftVersion, loaderVersion)
    case 'neoforge': {
      const url = `${NEOFORGE_MAVEN}/net/neoforged/neoforge/${loaderVersion}/neoforge-${loaderVersion}-installer.jar`
      return await runInstallerJar(url, 'NeoForge', task, minecraftVersion)
    }
    case 'forge': {
      // Forge version strings already carry the Minecraft version prefix.
      const full = loaderVersion.startsWith(`${minecraftVersion}-`) ? loaderVersion : `${minecraftVersion}-${loaderVersion}`
      const url = `${FORGE_MAVEN}/net/minecraftforge/forge/${full}/forge-${full}-installer.jar`
      return await runInstallerJar(url, 'Forge', task, minecraftVersion)
    }
    default:
      return minecraftVersion
  }
}

export function loaderLabel(loader: LoaderId): string {
  switch (loader) {
    case 'fabric':
      return 'Fabric'
    case 'forge':
      return 'Forge'
    case 'neoforge':
      return 'NeoForge'
    case 'quilt':
      return 'Quilt'
    default:
      return 'Vanilla'
  }
}

/** True when the loader's version profile is already on disk. */
export async function loaderProfileInstalled(versionId: string | null): Promise<boolean> {
  if (!versionId) return false
  return existsSync(join(versionsRoot(), versionId, `${versionId}.json`))
}
