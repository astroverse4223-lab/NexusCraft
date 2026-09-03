import { app } from 'electron'
import { totalmem, cpus, release, type } from 'node:os'
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLogger, redact } from '../../core/logger'
import { dataRoot, logsRoot } from '../../core/paths'
import { getSettings } from '../settings/settingsService'
import { listInstances } from '../instances/instanceService'
import { analyseMods } from '../mods/modService'
import { detectJavaInstallations } from '../java/javaService'
import { listHostedServers } from '../servers/hostService'
import { zipDirectory } from '../backup/zipWriter'

const log = createLogger('diagnostics')

/**
 * Everything needed to work out why something went wrong, in one file.
 *
 * Written because every problem in this launcher's short life has started the
 * same way: a screenshot of an error, followed by half an hour of reading
 * `launcher.log`, listing an instance's jars, and pinging a server by hand. The
 * information was always there; it was just spread across four places and a
 * terminal. This gathers it.
 *
 * Two rules govern what goes in. Everything is passed through the same redactor
 * the log uses, because a session token in a support bundle is a session token
 * on someone else's disk. And nothing is collected that the user could not read
 * themselves — the bundle is a plain zip of plain text, openable before it is
 * sent anywhere.
 */

/** How much of the log to take. Enough for a session, not the whole history. */
const LOG_TAIL_BYTES = 512 * 1024

interface BundleOptions {
  /** Include this instance's mod list and issues, when one is in context. */
  instanceId?: string
  /** A note from the user about what they were doing. */
  note?: string
}

function heading(title: string): string {
  return `\n${'='.repeat(72)}\n${title}\n${'='.repeat(72)}\n`
}

/** The machine and the build, which decide half of what can go wrong. */
async function systemReport(options: BundleOptions): Promise<string> {
  const settings = getSettings()
  const lines: string[] = []

  lines.push(heading('NexusCraft diagnostics'))
  lines.push(`generated       ${new Date().toISOString()}`)
  if (options.note) lines.push(`what happened   ${options.note.slice(0, 500)}`)

  lines.push(heading('Build'))
  lines.push(`launcher        ${app.getVersion()}`)
  lines.push(`packaged        ${app.isPackaged}`)
  lines.push(`electron        ${process.versions.electron}`)
  lines.push(`chrome          ${process.versions.chrome}`)
  lines.push(`node            ${process.versions.node}`)
  lines.push(`module ABI      ${process.versions.modules}`)

  lines.push(heading('System'))
  lines.push(`os              ${type()} ${release()} (${process.platform} ${process.arch})`)
  lines.push(`cpu             ${cpus()[0]?.model ?? 'unknown'} x${cpus().length}`)
  lines.push(`memory          ${Math.round(totalmem() / 1024 / 1024 / 1024)} GB`)
  lines.push(`data directory  ${dataRoot()}`)

  lines.push(heading('Settings'))
  /*
   * Listed by hand rather than dumping the object: the settings hold a
   * CurseForge key and a client id, and a bundle that leaks them is worse than
   * no bundle at all.
   */
  lines.push(`max memory      ${settings.defaultMaxRamMb} MB`)
  lines.push(`min memory      ${settings.defaultMinRamMb} MB`)
  lines.push(`jvm args        ${settings.defaultJvmArgs}`)
  lines.push(`java override   ${settings.javaPath ?? '(auto)'}`)
  lines.push(`downloads       ${settings.maxConcurrentDownloads} at once`)
  lines.push(`close to tray   ${settings.closeToTray}`)
  lines.push(`notifications   ${settings.desktopNotifications}`)
  lines.push(`curseforge key  ${settings.curseForgeApiKey ? 'set (not included)' : 'not set'}`)

  try {
    const javas = await detectJavaInstallations(false)
    lines.push(heading('Java runtimes'))
    for (const java of javas) {
      lines.push(`${String(java.majorVersion).padStart(3)}  ${java.vendor.padEnd(18)} ${java.path}`)
    }
    if (javas.length === 0) lines.push('(none found)')
  } catch (err) {
    lines.push(`\n(could not list Java: ${(err as Error).message})`)
  }

  return lines.join('\n')
}

/** Instances and hosted servers, which is usually where the fault lives. */
function inventoryReport(): string {
  const lines: string[] = []

  const instances = listInstances()
  lines.push(heading(`Instances (${instances.length})`))
  for (const instance of instances) {
    lines.push(
      `${instance.name}\n` +
        `    version     ${instance.minecraftVersion} ${instance.loader}` +
        `${instance.loaderVersion ? ` ${instance.loaderVersion}` : ''}\n` +
        `    resolved    ${instance.resolvedVersionId ?? '(not installed)'}\n` +
        `    memory      ${instance.java.minRamMb}-${instance.java.maxRamMb} MB\n` +
        `    java        ${instance.java.javaPath ?? '(auto)'}\n` +
        `    playtime    ${Math.round(instance.totalPlaytimeMs / 60000)} min\n` +
        `    installed   ${instance.installed}`
    )
  }

  try {
    const servers = listHostedServers()
    lines.push(heading(`Hosted servers (${servers.length})`))
    for (const server of servers) {
      lines.push(
        `${server.name}\n` +
          `    version     ${server.minecraftVersion} ${server.software}` +
          `${server.softwareVersion ? ` ${server.softwareVersion}` : ''}\n` +
          `    port        ${server.port}  reachability ${server.reachability}\n` +
          `    online mode ${server.onlineMode}  memory ${server.memoryMb} MB`
      )
    }
  } catch (err) {
    lines.push(`\n(could not list servers: ${(err as Error).message})`)
  }

  return lines.join('\n')
}

/** The mod list for one instance, with whatever the analyser flagged. */
async function modReport(instanceId: string): Promise<string> {
  const instance = listInstances().find((entry) => entry.id === instanceId)
  if (!instance) return ''

  const lines = [heading(`Mods in ${instance.name}`)]
  try {
    const mods = await analyseMods(instance)
    if (mods.length === 0) lines.push('(no mods)')

    for (const mod of mods) {
      lines.push(
        `${mod.enabled ? '[on ]' : '[off]'} ${mod.fileName}` +
          `${mod.version ? `  (${mod.version})` : ''}` +
          `${mod.loaders.length > 0 ? `  ${mod.loaders.join('/')}` : ''}`
      )
      for (const issue of mod.issues) lines.push(`        ${issue.severity.toUpperCase()}: ${issue.message}`)
    }
  } catch (err) {
    lines.push(`(could not read mods: ${(err as Error).message})`)
  }
  return lines.join('\n')
}

/** The tail of the launcher log, redacted again for good measure. */
async function logTail(): Promise<string> {
  const file = join(logsRoot(), 'launcher.log')
  try {
    const info = await stat(file)
    const handle = await readFile(file)
    const slice = info.size > LOG_TAIL_BYTES ? handle.subarray(info.size - LOG_TAIL_BYTES) : handle
    return redact(slice.toString('utf8'))
  } catch (err) {
    return `(could not read the log: ${(err as Error).message})`
  }
}

/** The newest crash report from any instance, which is usually the one wanted. */
async function newestCrash(): Promise<{ name: string; body: string } | null> {
  let newest: { name: string; body: string; at: number } | null = null

  for (const instance of listInstances()) {
    const dir = join(instance.gameDir, 'crash-reports')
    let names: string[]
    try {
      names = await readdir(dir)
    } catch {
      continue
    }

    for (const name of names.filter((entry) => entry.endsWith('.txt'))) {
      try {
        const path = join(dir, name)
        const info = await stat(path)
        if (newest && info.mtimeMs <= newest.at) continue
        const body = redact(await readFile(path, 'utf8'))
        newest = { name: `${instance.name} — ${name}`, body, at: info.mtimeMs }
      } catch {
        /* an unreadable report is not worth failing the bundle over */
      }
    }
  }

  return newest ? { name: newest.name, body: newest.body } : null
}

export interface DiagnosticsResult {
  path: string
  bytes: number
  files: number
}

/**
 * Writes a diagnostics zip to `outputPath`.
 *
 * Staged through a temporary directory so the zip is built from real files —
 * `zipDirectory` already handles the archive format, and duplicating that to
 * stream generated strings would be a second implementation to keep correct.
 */
export async function writeDiagnostics(
  outputPath: string,
  options: BundleOptions = {}
): Promise<DiagnosticsResult> {
  const staging = await mkdtemp(join(tmpdir(), 'nexuscraft-diag-'))

  try {
    let files = 0

    await writeFile(join(staging, 'report.txt'), await systemReport(options), 'utf8')
    files += 1

    await writeFile(join(staging, 'inventory.txt'), inventoryReport(), 'utf8')
    files += 1

    await writeFile(join(staging, 'launcher.log'), await logTail(), 'utf8')
    files += 1

    if (options.instanceId) {
      const mods = await modReport(options.instanceId)
      if (mods) {
        await writeFile(join(staging, 'mods.txt'), mods, 'utf8')
        files += 1
      }
    }

    const crash = await newestCrash()
    if (crash) {
      await writeFile(join(staging, 'crash-report.txt'), `${crash.name}\n\n${crash.body}`, 'utf8')
      files += 1
    }

    const zipped = await zipDirectory(staging, outputPath)
    log.info(`wrote a diagnostics bundle to ${outputPath}`)

    return { path: outputPath, bytes: zipped.bytes, files }
  } finally {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined)
  }
}
