import { existsSync } from 'node:fs'
import { readdir, rm, stat, copyFile, mkdir, readFile } from 'node:fs/promises'
import { basename, join, extname } from 'node:path'
import AdmZip from 'adm-zip'
import type { ContentPack, Instance } from '@shared/types'
import { LauncherError } from '../../core/errors'
import { createLogger } from '../../core/logger'
import { assertInside } from '../../core/paths'
import { instanceSubdir } from '../instances/instanceService'
import { renameWhenFree } from '../../core/fileLocks'

const log = createLogger('content')

export type ContentKind = 'resourcepacks' | 'shaderpacks'

const DISABLED_SUFFIX = '.disabled'

export function contentDir(instance: Instance, kind: ContentKind): string {
  return instanceSubdir(instance, kind)
}

interface PackMeta {
  description: string | null
  packFormat: number | null
}

function parsePackMcmeta(text: string): PackMeta {
  try {
    const json = JSON.parse(text) as {
      pack?: { description?: unknown; pack_format?: number }
    }
    const description = json.pack?.description
    return {
      // Descriptions may be a raw string or Minecraft's JSON text component.
      description:
        typeof description === 'string'
          ? description
          : description
            ? flattenTextComponent(description)
            : null,
      packFormat: typeof json.pack?.pack_format === 'number' ? json.pack.pack_format : null
    }
  } catch {
    return { description: null, packFormat: null }
  }
}

/** Reduces a Minecraft JSON text component to plain text. */
function flattenTextComponent(component: unknown): string {
  if (typeof component === 'string') return component
  if (Array.isArray(component)) return component.map(flattenTextComponent).join('')
  if (component && typeof component === 'object') {
    const node = component as { text?: string; extra?: unknown[] }
    return `${node.text ?? ''}${(node.extra ?? []).map(flattenTextComponent).join('')}`
  }
  return ''
}

function toDataUrl(data: Buffer, ext: string): string | null {
  if (data.byteLength === 0 || data.byteLength > 2 * 1024 * 1024) return null
  const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png'
  return `data:${mime};base64,${data.toString('base64')}`
}

async function readPack(dir: string, fileName: string): Promise<ContentPack> {
  const full = join(dir, fileName)
  const enabled = !fileName.endsWith(DISABLED_SUFFIX)
  const bare = enabled ? fileName : fileName.slice(0, -DISABLED_SUFFIX.length)
  const info = await stat(full)

  let meta: PackMeta = { description: null, packFormat: null }
  let iconDataUrl: string | null = null

  if (info.isDirectory()) {
    // Packs can be unzipped folders; Minecraft accepts both.
    const mcmeta = join(full, 'pack.mcmeta')
    if (existsSync(mcmeta)) meta = parsePackMcmeta(await readFile(mcmeta, 'utf8').catch(() => ''))
    const icon = join(full, 'pack.png')
    if (existsSync(icon)) iconDataUrl = toDataUrl(await readFile(icon).catch(() => Buffer.alloc(0)), '.png')
  } else if (/\.(zip|jar)(\.disabled)?$/i.test(fileName)) {
    try {
      const zip = new AdmZip(full)
      const mcmeta = zip.getEntry('pack.mcmeta')
      if (mcmeta) meta = parsePackMcmeta(mcmeta.getData().toString('utf8'))
      const icon = zip.getEntry('pack.png')
      if (icon) iconDataUrl = toDataUrl(icon.getData(), '.png')
    } catch {
      log.warn(`could not read pack archive ${fileName}`)
    }
  }

  return {
    path: full,
    fileName,
    name: bare.replace(/\.(zip|jar)$/i, ''),
    description: meta.description,
    iconDataUrl,
    packFormat: meta.packFormat,
    enabled,
    isDirectory: info.isDirectory(),
    sizeBytes: info.isDirectory() ? 0 : info.size
  }
}

export async function listContent(instance: Instance, kind: ContentKind): Promise<ContentPack[]> {
  const dir = contentDir(instance, kind)
  let entries: string[]
  try {
    entries = (await readdir(dir)).filter((name) => !name.startsWith('.'))
  } catch {
    return []
  }

  const packs: ContentPack[] = []
  for (const name of entries) {
    try {
      packs.push(await readPack(dir, name))
    } catch {
      /* entry vanished or is unreadable */
    }
  }
  packs.sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name))
  return packs
}

/**
 * Disabling renames the pack out of the game's view. Minecraft itself tracks
 * which resource packs are selected in options.txt; this only controls whether
 * the game can see the pack at all.
 */
export async function setContentEnabled(
  instance: Instance,
  kind: ContentKind,
  fileName: string,
  enabled: boolean
): Promise<void> {
  const dir = contentDir(instance, kind)
  const current = assertInside(dir, join(dir, fileName))
  if (!existsSync(current)) throw new LauncherError('NOT_FOUND', 'that pack no longer exists')

  const isDisabled = fileName.endsWith(DISABLED_SUFFIX)
  if (enabled === !isDisabled) return

  const nextName = enabled ? fileName.slice(0, -DISABLED_SUFFIX.length) : fileName + DISABLED_SUFFIX
  // The game or a scanner may still hold the jar open; wait it out.
  await renameWhenFree(current, assertInside(dir, join(dir, nextName)))
}

export async function deleteContent(instance: Instance, kind: ContentKind, fileName: string): Promise<void> {
  const dir = contentDir(instance, kind)
  const target = assertInside(dir, join(dir, fileName))
  await rm(target, { recursive: true, force: true })
  log.info(`removed ${kind} entry ${fileName}`)
}

const ALLOWED_EXTENSIONS: Record<ContentKind, RegExp> = {
  resourcepacks: /\.zip$/i,
  shaderpacks: /\.(zip|zip\.txt)$/i
}

export async function importContent(instance: Instance, kind: ContentKind, files: string[]): Promise<number> {
  const dir = contentDir(instance, kind)
  await mkdir(dir, { recursive: true })
  let imported = 0

  for (const file of files) {
    if (!ALLOWED_EXTENSIONS[kind].test(file)) continue
    let target = join(dir, basename(file))
    let counter = 1
    while (existsSync(target)) {
      const ext = extname(file)
      target = join(dir, `${basename(file, ext)} (${counter})${ext}`)
      counter++
    }
    try {
      await copyFile(file, target)
      imported++
    } catch (err) {
      log.warn(`could not import ${file}: ${(err as Error).message}`)
    }
  }
  return imported
}

/* ------------------------------------------------------------ screenshots */

export interface Screenshot {
  fileName: string
  path: string
  takenAt: number
  sizeBytes: number
  dataUrl: string | null
}

export async function listScreenshots(instance: Instance, limit = 60): Promise<Screenshot[]> {
  const dir = instanceSubdir(instance, 'screenshots')
  let names: string[]
  try {
    names = (await readdir(dir)).filter((name) => /\.(png|jpg|jpeg)$/i.test(name))
  } catch {
    return []
  }

  const shots: Screenshot[] = []
  for (const name of names) {
    const full = join(dir, name)
    try {
      const info = await stat(full)
      shots.push({ fileName: name, path: full, takenAt: info.mtimeMs, sizeBytes: info.size, dataUrl: null })
    } catch {
      /* skip */
    }
  }

  shots.sort((a, b) => b.takenAt - a.takenAt)
  const recent = shots.slice(0, limit)

  // Only the newest screenshots get inlined; a full folder would be enormous.
  for (const shot of recent) {
    if (shot.sizeBytes > 6 * 1024 * 1024) continue
    try {
      shot.dataUrl = toDataUrl(await readFile(shot.path), extname(shot.fileName).toLowerCase())
    } catch {
      /* unreadable */
    }
  }
  return recent
}
