import { existsSync } from 'node:fs'
import { readdir, rm, stat, copyFile, mkdir } from 'node:fs/promises'
import { basename, join, extname } from 'node:path'
import AdmZip from 'adm-zip'
import type { Instance, LoaderId, ModInfo, ModIssue } from '@shared/types'
import { LauncherError } from '../../core/errors'
import { createLogger } from '../../core/logger'
import { assertInside } from '../../core/paths'
import { instanceSubdir } from '../instances/instanceService'
import { renameWhenFree } from '../../core/fileLocks'
import {
  LOADER_NAMES,
  loaderAccepts,
  parseModManifest,
  versionSatisfies,
  type RawMetadata
} from './modMetadata'

const log = createLogger('mods')

const DISABLED_SUFFIX = '.disabled'

export function modsDir(instance: Instance): string {
  return instanceSubdir(instance, 'mods')
}

/**
 * Somewhere mods live, with enough context to judge whether they belong there.
 *
 * A client instance and a hosted server both have a mods folder, a loader and a
 * Minecraft version — everything the analysis needs — but only the instance is
 * an `Instance`. Naming the target directly lets both use the same code.
 */
export interface ModTarget {
  dir: string
  loader: LoaderId
  minecraftVersion: string
  /** How to refer to the destination in messages, e.g. "this server". */
  description: string
}

export function instanceTarget(instance: Instance): ModTarget {
  return {
    dir: modsDir(instance),
    loader: instance.loader,
    minecraftVersion: instance.minecraftVersion,
    description: 'this instance'
  }
}

/* ---------------------------------------------------------- jar metadata */

interface ReadResult {
  metadata: RawMetadata | null
  iconDataUrl: string | null
  unreadable: boolean
}

/** Opens a mod jar and reads whichever loader manifest it contains. */
function readModJar(jarPath: string): ReadResult {
  try {
    const zip = new AdmZip(jarPath)
    const read = (name: string): string | null => {
      const entry = zip.getEntry(name)
      return entry ? entry.getData().toString('utf8') : null
    }

    const metadata: RawMetadata | null = parseModManifest({
      fabric: read('fabric.mod.json'),
      quilt: read('quilt.mod.json'),
      neoforge: read('META-INF/neoforge.mods.toml'),
      forge: read('META-INF/mods.toml'),
      legacy: read('mcmod.info')
    })

    let iconDataUrl: string | null = null
    if (metadata?.iconPath) {
      const entry = zip.getEntry(metadata.iconPath)
      const data = entry?.getData()
      if (data && data.byteLength > 0 && data.byteLength < 512 * 1024) {
        const ext = extname(metadata.iconPath).toLowerCase()
        const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png'
        iconDataUrl = `data:${mime};base64,${data.toString('base64')}`
      }
    }

    return { metadata, iconDataUrl, unreadable: false }
  } catch (err) {
    log.warn(`could not read ${basename(jarPath)}: ${(err as Error).message}`)
    return { metadata: null, iconDataUrl: null, unreadable: true }
  }
}

/* ------------------------------------------------------------- analysis */

export async function analyseMods(instance: Instance): Promise<ModInfo[]> {
  return await analyseModsIn(instanceTarget(instance))
}

/**
 * Reads a mods folder directly.
 *
 * Split out from the instance-based call so a hosted server's `mods` directory
 * can be managed with exactly the same code — a server needs the same listing,
 * toggling and importing a client instance does.
 */
export async function analyseModsIn(target: ModTarget): Promise<ModInfo[]> {
  const dir = target.dir
  let entries: string[]
  try {
    entries = (await readdir(dir, { withFileTypes: true })).filter((e) => e.isFile()).map((e) => e.name)
  } catch {
    return []
  }

  const mods: ModInfo[] = []

  for (const fileName of entries) {
    const enabled = !fileName.endsWith(DISABLED_SUFFIX)
    const bare = enabled ? fileName : fileName.slice(0, -DISABLED_SUFFIX.length)
    if (!bare.toLowerCase().endsWith('.jar')) {
      // Anything that is not a jar cannot be a mod; surface it rather than hide it.
      if (/\.(zip|litemod|txt)$/i.test(bare)) {
        const full = join(dir, fileName)
        mods.push({
          path: full,
          fileName,
          modId: null,
          name: bare,
          version: null,
          description: null,
          authors: [],
          loaders: [],
          mcVersionRange: null,
          enabled,
          sizeBytes: await stat(full).then((s) => s.size).catch(() => 0),
          iconDataUrl: null,
          issues: [
            {
              severity: 'warning',
              code: 'not-a-jar',
              message: 'This file is not a .jar, so Minecraft will ignore it.'
            }
          ]
        })
      }
      continue
    }

    const full = join(dir, fileName)
    const { metadata, iconDataUrl, unreadable } = readModJar(full)
    const issues: ModIssue[] = []

    if (unreadable) {
      issues.push({
        severity: 'warning',
        code: 'unreadable',
        message: 'This jar could not be opened. It may be corrupt or still downloading.'
      })
    } else if (!metadata) {
      issues.push({
        severity: 'warning',
        code: 'unreadable',
        message: 'No mod metadata was found in this jar. It may be a library rather than a mod.'
      })
    }

    if (metadata && enabled) {
      const verdict = loaderAccepts(target.loader, metadata.loaders)
      if (verdict === 'no') {
        issues.push({
          severity: 'error',
          code: 'loader-mismatch',
          message: `This is a ${metadata.loaders.map((l) => LOADER_NAMES[l]).join('/')} mod, but ${target.description} runs ${LOADER_NAMES[target.loader]}.`
        })
      } else if (verdict === 'maybe' && metadata.loaders.length > 0) {
        issues.push({
          severity: 'warning',
          code: 'loader-mismatch',
          message: `Built for ${metadata.loaders.map((l) => LOADER_NAMES[l]).join('/')}; it may or may not run on ${LOADER_NAMES[target.loader]}.`
        })
      }

      if (metadata.mcVersionRange && !versionSatisfies(target.minecraftVersion, metadata.mcVersionRange)) {
        issues.push({
          severity: 'warning',
          code: 'mc-version-mismatch',
          message: `Declares support for ${metadata.mcVersionRange}, but ${target.description} is Minecraft ${target.minecraftVersion}.`
        })
      }
    }

    mods.push({
      path: full,
      fileName,
      modId: metadata?.modId ?? null,
      name: metadata?.name ?? bare.replace(/\.jar$/i, ''),
      version: metadata?.version ?? null,
      description: metadata?.description ?? null,
      authors: metadata?.authors ?? [],
      loaders: metadata?.loaders ?? [],
      mcVersionRange: metadata?.mcVersionRange ?? null,
      enabled,
      sizeBytes: await stat(full).then((s) => s.size).catch(() => 0),
      iconDataUrl,
      issues
    })
  }

  // Two enabled jars declaring the same mod id crash every loader on startup.
  const byModId = new Map<string, ModInfo[]>()
  for (const mod of mods) {
    if (!mod.modId || !mod.enabled) continue
    const list = byModId.get(mod.modId) ?? []
    list.push(mod)
    byModId.set(mod.modId, list)
  }
  for (const [modId, duplicates] of byModId) {
    if (duplicates.length < 2) continue
    for (const mod of duplicates) {
      mod.issues.push({
        severity: 'error',
        code: 'duplicate-mod-id',
        message: `Another enabled mod also provides "${modId}" (${duplicates
          .filter((d) => d !== mod)
          .map((d) => d.fileName)
          .join(', ')}). Keep only one.`
      })
    }
  }

  mods.sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name))
  return mods
}

/* -------------------------------------------------------------- mutations */

/** Enabling and disabling is a rename, which is how every launcher does it. */
export async function setModEnabled(instance: Instance, fileName: string, enabled: boolean): Promise<void> {
  await setModEnabledIn(modsDir(instance), fileName, enabled)
}

export async function setModEnabledIn(dir: string, fileName: string, enabled: boolean): Promise<void> {
  const current = assertInside(dir, join(dir, fileName))
  if (!existsSync(current)) throw new LauncherError('NOT_FOUND', 'that mod file no longer exists')

  const isDisabled = fileName.endsWith(DISABLED_SUFFIX)
  if (enabled === !isDisabled) return

  const nextName = enabled ? fileName.slice(0, -DISABLED_SUFFIX.length) : fileName + DISABLED_SUFFIX
  const next = assertInside(dir, join(dir, nextName))
  // The game or a scanner may still hold the jar open; wait it out.
  await renameWhenFree(current, next)
  log.info(`${enabled ? 'enabled' : 'disabled'} ${nextName}`)
}

export async function deleteMod(instance: Instance, fileName: string): Promise<void> {
  await deleteModIn(modsDir(instance), fileName)
}

export async function deleteModIn(dir: string, fileName: string): Promise<void> {
  const target = assertInside(dir, join(dir, fileName))
  await rm(target, { force: true })
  log.info(`removed mod ${fileName}`)
}

export async function importMods(instance: Instance, files: string[]): Promise<number> {
  return await importModsIn(modsDir(instance), files)
}

export async function importModsIn(dir: string, files: string[]): Promise<number> {
  await mkdir(dir, { recursive: true })
  let imported = 0

  for (const file of files) {
    if (!/\.(jar)$/i.test(file)) continue
    const target = join(dir, basename(file))
    // Never silently replace an existing mod: add a suffix instead.
    let final = target
    let counter = 1
    while (existsSync(final)) {
      final = join(dir, `${basename(file, '.jar')} (${counter}).jar`)
      counter++
    }
    try {
      await copyFile(file, final)
      imported++
    } catch (err) {
      log.warn(`could not import ${file}: ${(err as Error).message}`)
    }
  }
  return imported
}
