import type { Instance } from '@shared/types'
import { createLogger } from '../../core/logger'
import { toast } from '../../core/events'
import { getSettings } from '../settings/settingsService'
import { createTask } from '../downloads/downloadManager'
import { installLoader, loaderProfileInstalled } from '../loaders/loaderService'
import { installVersion, verifyInstallation, resolveVersion } from '../minecraft/versionService'
import { resolveJavaForVersion } from '../java/javaService'
import { ensureInstanceLayout, getInstance, updateInstance } from './instanceService'

const log = createLogger('install')

export interface InstallResult {
  instanceId: string
  versionId: string
  javaPath: string
  javaInstalled: boolean
  filesVerified: number
}

/**
 * Brings an instance to a launchable state: mod loader profile, game files,
 * assets and a matching Java runtime. Safe to run repeatedly — anything already
 * present and valid is skipped.
 */
async function prepare(instance: Instance, verifyMode: 'quick' | 'full'): Promise<InstallResult> {
  const settings = getSettings()
  await ensureInstanceLayout(instance)

  const task = createTask({
    instanceId: instance.id,
    concurrency: settings.maxConcurrentDownloads,
    verifyMode,
    label: verifyMode === 'full' ? 'Repairing' : 'Installing'
  })

  try {
    /* mod loader */
    let versionId = instance.resolvedVersionId
    if (!versionId || !(await loaderProfileInstalled(versionId)) || verifyMode === 'full') {
      if (instance.loader === 'vanilla') {
        versionId = instance.minecraftVersion
      } else if (!versionId || !(await loaderProfileInstalled(versionId))) {
        versionId = await installLoader(instance.loader, instance.minecraftVersion, instance.loaderVersion, task)
      }
      updateInstance(instance.id, { resolvedVersionId: versionId })
    }

    /* game files */
    const version = await installVersion(versionId, { task })

    /* java */
    task.setPhase('java-runtime', 'Checking the Java runtime')
    const java = await resolveJavaForVersion(version, instance.java.javaPath, settings.javaPath, task)

    /* final verification */
    task.setPhase('verifying', 'Verifying game files')
    const check = await verifyInstallation(versionId)
    if (check.missing.length > 0) {
      log.warn(`${check.missing.length} file(s) still missing after install; downloading again`)
      await installVersion(versionId, { task })
    }

    updateInstance(instance.id, { installed: true })
    task.setPhase('done', 'Ready to play')
    task.markDone()

    log.info(`instance "${instance.name}" is ready (${versionId})`)
    return {
      instanceId: instance.id,
      versionId,
      javaPath: java.path,
      javaInstalled: java.installed,
      filesVerified: task.snapshot().completedFiles
    }
  } catch (err) {
    task.cancel()
    throw err
  }
}

/**
 * Installs already under way, so a second request joins the first.
 *
 * Two installs of the same instance at once race over the same files, and the
 * loser reports a `FileAlreadyExistsException` from a file the winner had just
 * finished writing. The user sees "The Forge installer failed" while the
 * install goes on to succeed — an alarming error about a job that worked.
 * Whatever asked second gets the first one's answer instead.
 */
const installsInFlight = new Map<string, Promise<InstallResult>>()

export async function installInstance(instanceId: string): Promise<InstallResult> {
  const already = installsInFlight.get(instanceId)
  if (already) {
    log.info(`install of ${instanceId} is already running; waiting for it rather than starting a second`)
    return await already
  }

  const instance = getInstance(instanceId)

  const running = (async (): Promise<InstallResult> => {
    const result = await prepare(instance, 'quick')
    toast('success', 'Instance ready', `${instance.name} is installed and ready to play.`)
    return result
  })()

  installsInFlight.set(instanceId, running)
  try {
    return await running
  } finally {
    installsInFlight.delete(instanceId)
  }
}

/**
 * Re-hashes every file rather than trusting sizes, then replaces anything that
 * does not match. This is what fixes an instance broken by a partial download
 * or an antivirus quarantine.
 */
export async function repairInstance(instanceId: string): Promise<InstallResult> {
  const instance = getInstance(instanceId)
  log.info(`repairing instance "${instance.name}"`)
  const result = await prepare(instance, 'full')
  toast('success', 'Repair complete', `${instance.name} was verified and any damaged files were replaced.`)
  return result
}

/** Resolves the version an instance would launch, without downloading anything. */
export async function describeInstanceVersion(instanceId: string): Promise<{
  versionId: string
  javaMajor: number | null
  mainClass: string | null
}> {
  const instance = getInstance(instanceId)
  const versionId = instance.resolvedVersionId ?? instance.minecraftVersion
  try {
    const version = await resolveVersion(versionId)
    return {
      versionId,
      javaMajor: version.javaVersion?.majorVersion ?? null,
      mainClass: version.mainClass ?? null
    }
  } catch {
    return { versionId, javaMajor: null, mainClass: null }
  }
}
