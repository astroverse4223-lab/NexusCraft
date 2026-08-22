import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import { readdir, mkdir, symlink, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { arch, platform } from 'node:os'
import type { JavaInstallation } from '@shared/types'
import { getJson } from '../../core/http'
import { LauncherError } from '../../core/errors'
import { createLogger } from '../../core/logger'
import { runtimesRoot, ensureDir } from '../../core/paths'
import type { DownloadItem, DownloadTask } from '../downloads/downloadManager'
import type { VersionJson } from '../minecraft/versionTypes'

const log = createLogger('java')
const execFileAsync = promisify(execFile)

const RUNTIME_MANIFEST_URL =
  'https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json'

const isWindows = platform() === 'win32'
const JAVA_EXE = isWindows ? 'java.exe' : 'java'
/** javaw.exe has no console window, which is what a launcher wants on Windows. */
const JAVAW_EXE = isWindows ? 'javaw.exe' : 'java'

/* ---------------------------------------------------------------- probing */

/**
 * Runs `java -version` and parses the result. This is the only reliable way to
 * know what a given executable actually is — directory names lie.
 */
export async function probeJava(javaPath: string): Promise<JavaInstallation | null> {
  if (!existsSync(javaPath)) return null
  try {
    // `java -version` writes to stderr on every JVM vendor.
    const { stderr, stdout } = await execFileAsync(javaPath, ['-version'], { timeout: 10_000, windowsHide: true })
    const output = `${stderr}\n${stdout}`

    const versionMatch = output.match(/version "([^"]+)"/)
    if (!versionMatch) return null
    const version = versionMatch[1]

    // "1.8.0_412" -> 8, "21.0.3" -> 21
    const major = version.startsWith('1.')
      ? Number.parseInt(version.split('.')[1] ?? '0', 10)
      : Number.parseInt(version.split(/[.\-+]/)[0] ?? '0', 10)
    if (!Number.isFinite(major) || major <= 0) return null

    let vendor = 'Unknown'
    if (/temurin|adoptium/i.test(output)) vendor = 'Eclipse Temurin'
    else if (/zulu/i.test(output)) vendor = 'Azul Zulu'
    else if (/graalvm/i.test(output)) vendor = 'GraalVM'
    else if (/microsoft/i.test(output)) vendor = 'Microsoft'
    else if (/openjdk/i.test(output)) vendor = 'OpenJDK'
    else if (/java\(tm\)|hotspot/i.test(output)) vendor = 'Oracle'

    const is64 = /64-bit/i.test(output)

    return {
      path: javaPath,
      version,
      majorVersion: major,
      vendor,
      arch: is64 ? 'x64' : 'x86',
      source: 'manual',
      managed: false
    }
  } catch {
    return null
  }
}

/* -------------------------------------------------------------- detection */

function candidateRoots(): string[] {
  const roots: string[] = []
  if (isWindows) {
    const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files'
    const programFilesX86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
    const localAppData = process.env.LOCALAPPDATA ?? ''
    for (const base of [programFiles, programFilesX86]) {
      roots.push(
        join(base, 'Java'),
        join(base, 'Eclipse Adoptium'),
        join(base, 'Eclipse Foundation'),
        join(base, 'AdoptOpenJDK'),
        join(base, 'Zulu'),
        join(base, 'Microsoft'),
        join(base, 'Amazon Corretto'),
        join(base, 'BellSoft'),
        join(base, 'Semeru')
      )
    }
    // The official Minecraft launcher keeps its runtimes here; reusing them
    // saves the user a multi-hundred-megabyte download.
    if (localAppData) {
      roots.push(join(localAppData, 'Packages'), join(localAppData, 'Programs', 'Eclipse Adoptium'))
      roots.push(join(process.env.APPDATA ?? '', '.minecraft', 'runtime'))
    }
  } else {
    roots.push('/usr/lib/jvm', '/usr/java', '/Library/Java/JavaVirtualMachines', '/opt/java')
  }
  return roots.filter((r) => r && existsSync(r))
}

/** Looks for `bin/java` one and two levels below a root directory. */
async function findUnderRoot(root: string, depth = 2): Promise<string[]> {
  const found: string[] = []
  if (depth <= 0) return found
  let entries: string[]
  try {
    entries = (await readdir(root, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    return found
  }

  for (const name of entries) {
    const dir = join(root, name)
    const direct = join(dir, 'bin', JAVA_EXE)
    if (existsSync(direct)) {
      found.push(direct)
      continue
    }
    // macOS bundles nest the home one level deeper.
    const macHome = join(dir, 'Contents', 'Home', 'bin', JAVA_EXE)
    if (existsSync(macHome)) {
      found.push(macHome)
      continue
    }
    found.push(...(await findUnderRoot(dir, depth - 1)))
  }
  return found
}

async function fromPath(): Promise<string[]> {
  try {
    const command = isWindows ? 'where' : 'which'
    const { stdout } = await execFileAsync(command, [JAVA_EXE], { timeout: 8000, windowsHide: true })
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && existsSync(line))
  } catch {
    return []
  }
}

let detectionCache: { installations: JavaInstallation[]; at: number } | null = null

/**
 * Finds every Java runtime on the machine. Results are cached because probing
 * spawns one process per candidate.
 */
export async function detectJavaInstallations(refresh = false): Promise<JavaInstallation[]> {
  if (!refresh && detectionCache && Date.now() - detectionCache.at < 60_000) {
    return detectionCache.installations
  }

  const candidates = new Map<string, JavaInstallation['source']>()

  for (const managed of await listManagedRuntimes()) candidates.set(managed, 'managed')

  if (process.env.JAVA_HOME) {
    const home = join(process.env.JAVA_HOME, 'bin', JAVA_EXE)
    if (existsSync(home)) candidates.set(home, 'java-home')
  }

  for (const path of await fromPath()) if (!candidates.has(path)) candidates.set(path, 'path')

  for (const root of candidateRoots()) {
    for (const path of await findUnderRoot(root)) {
      if (!candidates.has(path)) candidates.set(path, 'common-dir')
    }
  }

  const results: JavaInstallation[] = []
  const seenVersions = new Set<string>()

  for (const [path, source] of candidates) {
    const probed = await probeJava(path)
    if (!probed) continue
    // Collapse duplicates that are the same runtime reached by different paths.
    const key = `${probed.version}|${probed.arch}|${dirname(dirname(path))}`
    if (seenVersions.has(key)) continue
    seenVersions.add(key)
    results.push({ ...probed, source, managed: source === 'managed' })
  }

  results.sort((a, b) => Number(b.managed) - Number(a.managed) || b.majorVersion - a.majorVersion)
  detectionCache = { installations: results, at: Date.now() }
  log.info(`found ${results.length} Java runtime(s)`)
  return results
}

/* -------------------------------------------------- Mojang managed runtimes */

interface RuntimeManifestEntry {
  availability: { group: number; progress: number }
  manifest: { sha1: string; size: number; url: string }
  version: { name: string; released: string }
}

type AllRuntimes = Record<string, Record<string, RuntimeManifestEntry[]>>

interface RuntimeFiles {
  files: Record<
    string,
    {
      type: 'file' | 'directory' | 'link'
      executable?: boolean
      target?: string
      downloads?: { raw: { sha1: string; size: number; url: string }; lzma?: { sha1: string; size: number; url: string } }
    }
  >
}

/** Mojang's platform key for this machine. */
function runtimePlatform(): string {
  if (isWindows) {
    if (arch() === 'arm64') return 'windows-arm64'
    return arch() === 'ia32' ? 'windows-x86' : 'windows-x64'
  }
  if (platform() === 'darwin') return arch() === 'arm64' ? 'mac-os-arm64' : 'mac-os'
  return arch() === 'ia32' ? 'linux-i386' : 'linux'
}

/**
 * Maps a Java major version onto the runtime component Mojang publishes. The
 * version json usually names the component directly; this is the fallback.
 */
export function componentForMajor(major: number): string {
  if (major <= 8) return 'jre-legacy'
  if (major <= 16) return 'java-runtime-alpha'
  if (major <= 17) return 'java-runtime-gamma'
  if (major <= 21) return 'java-runtime-delta'
  // Newer versions ship their own component; delta is the closest fallback for
  // anything above 21 whose manifest does not name one.
  return 'java-runtime-delta'
}

export function managedRuntimeDir(component: string): string {
  return join(runtimesRoot(), component, runtimePlatform())
}

function managedJavaExe(component: string, preferWindowless = false): string {
  const base = managedRuntimeDir(component)
  const exe = preferWindowless ? JAVAW_EXE : JAVA_EXE
  // macOS runtimes are shipped inside a bundle layout.
  const macPath = join(base, 'jre.bundle', 'Contents', 'Home', 'bin', exe)
  if (platform() === 'darwin' && existsSync(macPath)) return macPath
  return join(base, 'bin', exe)
}

async function listManagedRuntimes(): Promise<string[]> {
  const found: string[] = []
  try {
    for (const component of await readdir(runtimesRoot())) {
      const exe = managedJavaExe(component)
      if (existsSync(exe)) found.push(exe)
    }
  } catch {
    /* no managed runtimes yet */
  }
  return found
}

export function managedRuntimeInstalled(component: string): string | null {
  const exe = managedJavaExe(component)
  return existsSync(exe) ? exe : null
}

/**
 * Downloads a Java runtime straight from Mojang. This is the same runtime the
 * official launcher uses, so it is always a version the game supports.
 */
export async function installManagedRuntime(component: string, task: DownloadTask): Promise<string> {
  const existing = managedRuntimeInstalled(component)
  if (existing) return existing

  task.setPhase('java-runtime', `Downloading Java runtime (${component})`)

  const all = await getJson<AllRuntimes>(RUNTIME_MANIFEST_URL, { timeoutMs: 20_000 })
  const forPlatform = all[runtimePlatform()]
  const entries = forPlatform?.[component]

  if (!entries || entries.length === 0) {
    throw new LauncherError('JAVA_NOT_FOUND', `Mojang publishes no "${component}" runtime for ${runtimePlatform()}`, {
      title: 'No matching Java runtime is available',
      message: `Mojang does not publish the Java runtime this version needs (${component}) for your platform (${runtimePlatform()}).`,
      actions: [
        'Install a Java runtime yourself, for example Eclipse Temurin',
        'Then point NexusCraft at it in Settings → Java'
      ]
    })
  }

  const files = await getJson<RuntimeFiles>(entries[0].manifest.url, { timeoutMs: 20_000 })
  const targetDir = ensureDir(managedRuntimeDir(component))

  const items: DownloadItem[] = []
  const links: Array<{ path: string; target: string }> = []

  for (const [relative, entry] of Object.entries(files.files)) {
    const destination = join(targetDir, ...relative.split('/'))
    if (entry.type === 'directory') {
      await mkdir(destination, { recursive: true })
      continue
    }
    if (entry.type === 'link' && entry.target) {
      links.push({ path: destination, target: entry.target })
      continue
    }
    if (entry.type === 'file' && entry.downloads?.raw) {
      items.push({
        url: entry.downloads.raw.url,
        destination,
        sha1: entry.downloads.raw.sha1,
        size: entry.downloads.raw.size,
        executable: entry.executable,
        label: relative
      })
    }
  }

  task.add(items)
  await task.run()

  // Symlinks come last: their targets have to exist first.
  for (const link of links) {
    try {
      await mkdir(dirname(link.path), { recursive: true })
      if (!existsSync(link.path)) await symlink(link.target, link.path)
    } catch {
      // Windows refuses symlinks without elevation. Java only uses them for
      // duplicate legal files, so this is safe to skip.
    }
  }

  // Mojang's runtime archives omit this marker; some JVMs want it present.
  const versionFile = join(targetDir, '.nexuscraft-version')
  await writeFile(versionFile, entries[0].version.name, 'utf8').catch(() => undefined)

  const exe = managedJavaExe(component)
  if (!existsSync(exe)) {
    throw new LauncherError('JAVA_NOT_FOUND', `runtime unpacked but ${exe} is missing`)
  }
  detectionCache = null
  log.info(`installed managed runtime ${component} (${entries[0].version.name})`)
  return exe
}

/* --------------------------------------------------------------- resolving */

export interface JavaResolution {
  /** Executable used to start the game. */
  path: string
  majorVersion: number
  /** True when the launcher had to install it just now. */
  installed: boolean
}

/**
 * Chooses the Java runtime for a launch, in priority order:
 *   1. the instance's explicit override
 *   2. the global override from Settings
 *   3. a managed runtime matching the version's declared component
 *   4. any detected runtime with the right major version
 *   5. install the managed runtime from Mojang
 */
export async function resolveJavaForVersion(
  version: VersionJson,
  overridePath: string | null,
  globalPath: string | null,
  installTask: DownloadTask | null
): Promise<JavaResolution> {
  const required = version.javaVersion?.majorVersion ?? inferJavaMajor(version)
  const component = version.javaVersion?.component ?? componentForMajor(required)

  for (const candidate of [overridePath, globalPath]) {
    if (!candidate) continue
    const probed = await probeJava(candidate)
    if (!probed) {
      throw new LauncherError('JAVA_NOT_FOUND', `configured java path is not usable: ${candidate}`, {
        title: 'The configured Java path does not work',
        message: `NexusCraft could not run "${candidate}". The file may have been moved, or it may not be a Java runtime.`,
        actions: ['Clear the Java path in Settings → Java to use automatic selection', 'Or pick a different runtime']
      })
    }
    // An explicit choice is honoured, but a mismatch is a hard error rather
    // than a silent fallback: the game would crash confusingly otherwise.
    if (probed.majorVersion < required) {
      throw new LauncherError(
        'JAVA_VERSION_MISMATCH',
        `configured java ${probed.version} is older than the required Java ${required}`,
        {
          title: `This version needs Java ${required}`,
          message: `Minecraft ${version.id} requires Java ${required} or newer, but the runtime you selected is Java ${probed.majorVersion} (${probed.version}).`,
          actions: [
            `Let NexusCraft install Java ${required} automatically`,
            'Or select a newer runtime in Settings → Java'
          ]
        }
      )
    }
    return { path: candidate, majorVersion: probed.majorVersion, installed: false }
  }

  const managed = managedRuntimeInstalled(component)
  if (managed) return { path: managed, majorVersion: required, installed: false }

  const detected = await detectJavaInstallations()
  // Prefer an exact major match; Minecraft is sensitive to running too new a JVM
  // on old versions and outright refuses too old a JVM on new ones.
  const exact = detected.find((j) => j.majorVersion === required)
  if (exact) return { path: exact.path, majorVersion: exact.majorVersion, installed: false }

  /*
   * Install the runtime Mojang names before settling for a newer one.
   *
   * Taking any newer JVM sounds harmless and is not. Minecraft 1.21.11 asks for
   * Java 21; a Java 25 runtime installed for some other version satisfied the
   * "newer" test and was used instead, and the game died 22 minutes in with an
   * access violation inside the JIT compiler — a JVM bug, on a JVM the game was
   * never tested against. Downloading the right one costs a minute, once.
   */
  if (installTask) {
    const path = await installManagedRuntime(component, installTask)
    return { path, majorVersion: required, installed: true }
  }

  // No way to install right now: a newer JVM is better than refusing to launch,
  // but it is a fallback rather than a preference.
  const newer = detected.find((j) => j.majorVersion > required)
  if (newer && required >= 17) {
    log.warn(
      `using Java ${newer.majorVersion} for a version that asks for Java ${required}; ` +
        'the matching runtime is not installed and no download was possible'
    )
    return { path: newer.path, majorVersion: newer.majorVersion, installed: false }
  }

  throw new LauncherError('JAVA_NOT_FOUND', `no Java ${required} runtime available and no install task provided`)
}

/**
 * Versions before ~1.17 carry no `javaVersion` block. Their release date is the
 * only signal available, and Java 8 is what they were built against.
 */
function inferJavaMajor(version: VersionJson): number {
  const released = version.releaseTime ? Date.parse(version.releaseTime) : NaN
  if (Number.isFinite(released) && released < Date.parse('2021-06-08')) return 8
  return 17
}

/** Swaps java.exe for javaw.exe so Windows shows no console window. */
export function preferWindowless(javaPath: string): string {
  if (!isWindows) return javaPath
  const candidate = javaPath.replace(/java\.exe$/i, 'javaw.exe')
  return existsSync(candidate) ? candidate : javaPath
}
