import { mkdir, writeFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, dirname, isAbsolute, basename } from 'node:path'
import AdmZip from 'adm-zip'
import type { Instance, InstanceExportInfo, LoaderId } from '@shared/types'
import { LauncherError } from '../../core/errors'
import { createLogger } from '../../core/logger'
import { assertInside } from '../../core/paths'
import { zipDirectory } from '../backup/zipWriter'
import { createInstance, deleteInstance, getInstance } from './instanceService'
import { emit } from '../../core/events'

const log = createLogger('transfer')

/** Written into the archive so an import can rebuild the instance faithfully. */
interface ExportManifest {
  format: 'nexuscraft-instance'
  formatVersion: 1
  exportedAt: number
  name: string
  minecraftVersion: string
  loader: LoaderId
  loaderVersion: string | null
  iconColor: string
  notes: string
  java: Instance['java']
  window: Instance['window']
  includesWorlds: boolean
}

const MANIFEST_NAME = 'nexuscraft-instance.json'

/* ---------------------------------------------------------------- export */

export interface ExportOptions {
  includeWorlds: boolean
  /** Screenshots and logs are rarely wanted in a shared setup. */
  includeScreenshots: boolean
}

/**
 * Packages an instance — its mods, configs, packs and optionally worlds — into
 * a single archive that can be backed up or handed to someone else.
 *
 * Only the instance's own directory is read, so an export can never pick up
 * files belonging to another instance or to the launcher itself.
 */
export async function exportInstance(
  instanceId: string,
  outputFile: string,
  options: ExportOptions
): Promise<{ path: string; bytes: number; entries: number }> {
  const instance = getInstance(instanceId)

  const skipDirs = new Set<string>(['logs', 'crash-reports'])
  if (!options.includeWorlds) skipDirs.add('saves')
  if (!options.includeScreenshots) skipDirs.add('screenshots')

  log.info(`exporting "${instance.name}"${options.includeWorlds ? ' with worlds' : ''}`)

  const result = await zipDirectory(instance.gameDir, outputFile, undefined, {
    // Paths arrive relative to the game directory, using forward slashes.
    filter: (relative) => {
      const top = relative.split('/')[0]
      return !skipDirs.has(top)
    },
    extraEntries: [
      {
        name: MANIFEST_NAME,
        data: Buffer.from(
          JSON.stringify(
            {
              format: 'nexuscraft-instance',
              formatVersion: 1,
              exportedAt: Date.now(),
              name: instance.name,
              minecraftVersion: instance.minecraftVersion,
              loader: instance.loader,
              loaderVersion: instance.loaderVersion,
              iconColor: instance.iconColor,
              notes: instance.notes,
              java: instance.java,
              window: instance.window,
              includesWorlds: options.includeWorlds
            } satisfies ExportManifest,
            null,
            2
          ),
          'utf8'
        )
      }
    ]
  })

  log.info(`exported "${instance.name}": ${result.entries} entries, ${result.bytes} bytes`)
  return { path: outputFile, ...result }
}

/* ---------------------------------------------------------------- import */

function readManifest(zip: AdmZip): ExportManifest {
  const entry = zip.getEntry(MANIFEST_NAME)
  if (!entry) {
    throw new LauncherError('INVALID_INPUT', 'no instance manifest in the archive', {
      title: 'That is not an exported instance',
      message: `The archive does not contain a ${MANIFEST_NAME}, so it was not produced by NexusCraft's export.`,
      actions: [
        'Check you selected a file exported from Instances → Export',
        'To import a modpack instead, use Import modpack'
      ]
    })
  }

  try {
    const manifest = JSON.parse(entry.getData().toString('utf8')) as ExportManifest
    if (manifest.format !== 'nexuscraft-instance' || !manifest.minecraftVersion) {
      throw new Error('wrong format')
    }
    return manifest
  } catch {
    throw new LauncherError('INVALID_INPUT', 'the instance manifest could not be read')
  }
}

/** Reads an export's manifest without importing it. */
export async function inspectInstanceArchive(filePath: string): Promise<InstanceExportInfo> {
  if (!existsSync(filePath)) throw new LauncherError('NOT_FOUND', 'that file no longer exists')

  let zip: AdmZip
  try {
    zip = new AdmZip(filePath)
  } catch {
    throw new LauncherError('INVALID_INPUT', 'the archive could not be opened', {
      title: 'That file could not be read',
      message: 'The archive appears to be damaged or is not a zip file.',
      actions: ['Export the instance again']
    })
  }

  const manifest = readManifest(zip)
  const entries = zip.getEntries().filter((e) => !e.isDirectory && e.entryName !== MANIFEST_NAME)

  return {
    name: manifest.name,
    minecraftVersion: manifest.minecraftVersion,
    loader: manifest.loader,
    loaderVersion: manifest.loaderVersion,
    exportedAt: manifest.exportedAt,
    includesWorlds: manifest.includesWorlds,
    fileCount: entries.length,
    modCount: entries.filter((e) => e.entryName.startsWith('mods/') && e.entryName.endsWith('.jar')).length,
    sizeBytes: entries.reduce((sum, e) => sum + (e.header?.size ?? 0), 0)
  }
}

/** Rejects archive entries that would write outside the new instance. */
function safeTarget(gameDir: string, relative: string): string {
  const cleaned = relative.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!cleaned || cleaned.includes('..') || isAbsolute(cleaned) || /^[a-zA-Z]:/.test(cleaned)) {
    throw new LauncherError('INVALID_INPUT', `archive entry escapes the instance: ${relative.slice(0, 120)}`)
  }
  return assertInside(gameDir, join(gameDir, ...cleaned.split('/')))
}

/**
 * Recreates an exported instance as a new one. Like a modpack import, a failure
 * part-way through removes the partial instance rather than leaving it behind.
 */
export async function importInstance(filePath: string, nameOverride?: string): Promise<Instance> {
  const zip = new AdmZip(filePath)
  const manifest = readManifest(zip)

  const instance = await createInstance({
    name: (nameOverride?.trim() || manifest.name || 'Imported instance').slice(0, 64),
    minecraftVersion: manifest.minecraftVersion,
    loader: manifest.loader,
    loaderVersion: manifest.loaderVersion,
    iconColor: manifest.iconColor
  })

  try {
    let written = 0
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory || entry.entryName === MANIFEST_NAME) continue
      const target = safeTarget(instance.gameDir, entry.entryName)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, entry.getData())
      written++
    }

    // Carry the memory and window settings across too — they are part of how
    // the instance was set up, not incidental.
    const { updateInstance } = await import('./instanceService')
    const restored = updateInstance(instance.id, {
      notes: manifest.notes,
      java: manifest.java,
      window: manifest.window
    })

    log.info(`imported "${restored.name}": ${written} files`)
    emit('toast', {
      kind: 'success',
      title: `${restored.name} imported`,
      message: `${written} files restored.`
    })
    return restored
  } catch (err) {
    await deleteInstance(instance.id, true).catch(() => undefined)
    throw err
  }
}

/** Default file name offered when exporting. */
export function suggestedExportName(instance: Instance): string {
  const safe = instance.name.replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 50) || 'instance'
  return `${safe}.ncinstance`
}

export { basename }
