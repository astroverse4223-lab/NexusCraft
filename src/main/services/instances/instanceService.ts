import { randomUUID } from 'node:crypto'
import { existsSync, type Dirent } from 'node:fs'
import { mkdir, readdir, rm, stat, cp } from 'node:fs/promises'
import { join } from 'node:path'
import type { CreateInstanceInput, Instance, InstanceStats, LoaderId } from '@shared/types'
import { db, Collections } from '../../core/database'
import { emit } from '../../core/events'
import { LauncherError } from '../../core/errors'
import { createLogger } from '../../core/logger'
import { instanceDir, instancesRoot, ensureDir, assertInside } from '../../core/paths'
import { getSettings, recommendedRamMb } from '../settings/settingsService'

const log = createLogger('instances')

/**
 * Every instance owns a private game directory. Mods, worlds, resource packs,
 * shaders, screenshots and configs all live inside it, so two instances can
 * never see each other's files.
 */
export const INSTANCE_SUBDIRS = [
  'mods',
  'resourcepacks',
  'shaderpacks',
  'saves',
  'screenshots',
  'config',
  'logs'
] as const

export type InstanceSubdir = (typeof INSTANCE_SUBDIRS)[number]

export function gameDirOf(instance: Instance): string {
  return instance.gameDir
}

/** Resolves a subdirectory inside an instance, guarding against traversal. */
export function instanceSubdir(instance: Instance, sub: string): string {
  const target = join(instance.gameDir, sub)
  assertInside(instance.gameDir, target)
  return ensureDir(target)
}

export function listInstances(): Instance[] {
  return db()
    .all<Instance>(Collections.instances)
    .sort((a, b) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0) || a.createdAt - b.createdAt)
}

export function getInstance(id: string): Instance {
  const instance = db().get<Instance>(Collections.instances, id)
  if (!instance) {
    throw new LauncherError('NOT_FOUND', `instance ${id} does not exist`, {
      title: 'That instance no longer exists',
      message: 'The instance you tried to use has been deleted.',
      actions: ['Pick another instance from the Instances screen']
    })
  }
  return instance
}

export function findInstance(id: string): Instance | null {
  return db().get<Instance>(Collections.instances, id)
}

function broadcast(): void {
  emit('instances:changed', listInstances())
}

function saveInstance(instance: Instance): void {
  db().put(Collections.instances, instance.id, instance)
}

const ACCENTS = ['#5eead4', '#818cf8', '#f472b6', '#fbbf24', '#4ade80', '#60a5fa', '#f87171', '#c084fc']

export async function createInstance(input: CreateInstanceInput): Promise<Instance> {
  const settings = getSettings()
  const ram = recommendedRamMb()
  const id = randomUUID()

  const root = instanceDir(id)
  const gameDir = join(root, 'minecraft')
  await mkdir(gameDir, { recursive: true })
  for (const sub of INSTANCE_SUBDIRS) await mkdir(join(gameDir, sub), { recursive: true })
  await mkdir(join(root, 'backups'), { recursive: true })

  const maxRam = Math.min(Math.max(input.maxRamMb ?? settings.defaultMaxRamMb, 512), ram.ceiling)

  const instance: Instance = {
    id,
    name: input.name.trim().slice(0, 64) || 'New instance',
    minecraftVersion: input.minecraftVersion,
    loader: input.loader,
    loaderVersion: input.loaderVersion ?? null,
    // Populated once the loader profile has actually been installed.
    resolvedVersionId: input.loader === 'vanilla' ? input.minecraftVersion : null,
    gameDir,
    java: {
      javaPath: null,
      minRamMb: Math.min(settings.defaultMinRamMb, maxRam),
      maxRamMb: maxRam,
      jvmArgs: settings.defaultJvmArgs
    },
    window: { width: 1280, height: 720, fullscreen: false },
    iconColor: input.iconColor ?? ACCENTS[Math.floor(Math.random() * ACCENTS.length)],
    notes: '',
    createdAt: Date.now(),
    lastPlayedAt: null,
    totalPlaytimeMs: 0,
    installed: false
  }

  saveInstance(instance)
  log.info(`created instance "${instance.name}" (${instance.minecraftVersion}, ${instance.loader})`)
  broadcast()
  return instance
}

const EDITABLE_TOP_LEVEL = new Set([
  'name',
  'minecraftVersion',
  'loader',
  'loaderVersion',
  'resolvedVersionId',
  'iconColor',
  'notes',
  'installed'
])

/**
 * Applies a partial update. Only known fields are accepted and numeric values
 * are clamped, so a malformed IPC payload cannot corrupt an instance record.
 */
export function updateInstance(id: string, patch: Record<string, unknown>): Instance {
  const current = getInstance(id)
  const next: Instance = { ...current, java: { ...current.java }, window: { ...current.window } }
  const ram = recommendedRamMb()

  for (const [key, value] of Object.entries(patch)) {
    if (EDITABLE_TOP_LEVEL.has(key)) {
      if (key === 'name' && typeof value === 'string') next.name = value.trim().slice(0, 64) || current.name
      else if (key === 'loader' && typeof value === 'string') {
        const loader = value as LoaderId
        if (['vanilla', 'fabric', 'forge', 'neoforge', 'quilt'].includes(loader)) {
          next.loader = loader
          // Changing the loader invalidates the previously resolved profile.
          if (loader !== current.loader) {
            next.resolvedVersionId = loader === 'vanilla' ? next.minecraftVersion : null
            next.installed = false
          }
        }
      } else if (key === 'minecraftVersion' && typeof value === 'string') {
        next.minecraftVersion = value
        if (value !== current.minecraftVersion) {
          next.resolvedVersionId = next.loader === 'vanilla' ? value : null
          next.installed = false
        }
      } else if (key === 'loaderVersion') {
        next.loaderVersion = value === null ? null : String(value).slice(0, 64)
        if (next.loaderVersion !== current.loaderVersion) {
          next.resolvedVersionId = null
          next.installed = false
        }
      } else if (key === 'resolvedVersionId') {
        next.resolvedVersionId = value === null ? null : String(value).slice(0, 128)
      } else if (key === 'installed' && typeof value === 'boolean') next.installed = value
      else if (typeof value === 'string') (next as never as Record<string, unknown>)[key] = value.slice(0, 2000)
      continue
    }

    if (key === 'java' && value && typeof value === 'object') {
      const java = value as Record<string, unknown>
      if ('javaPath' in java) next.java.javaPath = java.javaPath === null ? null : String(java.javaPath).slice(0, 4096)
      if (typeof java.maxRamMb === 'number' && Number.isFinite(java.maxRamMb)) {
        next.java.maxRamMb = Math.min(Math.max(Math.round(java.maxRamMb), 512), ram.ceiling)
      }
      if (typeof java.minRamMb === 'number' && Number.isFinite(java.minRamMb)) {
        next.java.minRamMb = Math.min(Math.max(Math.round(java.minRamMb), 256), ram.ceiling)
      }
      if (typeof java.jvmArgs === 'string') next.java.jvmArgs = java.jvmArgs.slice(0, 2000)
      // A min heap above the max heap makes the JVM refuse to start.
      if (next.java.minRamMb > next.java.maxRamMb) next.java.minRamMb = next.java.maxRamMb
      continue
    }

    if (key === 'window' && value && typeof value === 'object') {
      const win = value as Record<string, unknown>
      if (typeof win.width === 'number') next.window.width = Math.min(Math.max(Math.round(win.width), 320), 7680)
      if (typeof win.height === 'number') next.window.height = Math.min(Math.max(Math.round(win.height), 240), 4320)
      if (typeof win.fullscreen === 'boolean') next.window.fullscreen = win.fullscreen
      continue
    }

    if (key === 'lastPlayedAt' && typeof value === 'number') next.lastPlayedAt = value
    if (key === 'totalPlaytimeMs' && typeof value === 'number') next.totalPlaytimeMs = Math.max(0, value)
  }

  saveInstance(next)
  broadcast()
  return next
}

export async function deleteInstance(id: string, deleteFiles: boolean): Promise<void> {
  const instance = getInstance(id)
  db().remove(Collections.instances, id)

  if (deleteFiles) {
    const root = instanceDir(id)
    // Confirm the directory really is ours before recursive removal.
    assertInside(instancesRoot(), root)
    await rm(root, { recursive: true, force: true })
  }

  const settings = getSettings()
  if (settings.selectedInstanceId === id) {
    const remaining = listInstances()
    const { updateSettings } = await import('../settings/settingsService')
    updateSettings({ selectedInstanceId: remaining[0]?.id ?? null })
  }

  log.info(`deleted instance "${instance.name}"${deleteFiles ? ' and its files' : ''}`)
  broadcast()
}

export async function duplicateInstance(id: string, name: string): Promise<Instance> {
  const source = getInstance(id)
  const copy = await createInstance({
    name,
    minecraftVersion: source.minecraftVersion,
    loader: source.loader,
    loaderVersion: source.loaderVersion,
    maxRamMb: source.java.maxRamMb,
    iconColor: source.iconColor
  })

  // Copy the game directory so mods and configs come along, but leave the
  // resolved profile in place — it is shared, not per-instance.
  await cp(source.gameDir, copy.gameDir, { recursive: true, force: false, errorOnExist: false }).catch((err) => {
    log.warn(`could not copy every file while duplicating: ${(err as Error).message}`)
  })

  const updated = updateInstance(copy.id, {
    resolvedVersionId: source.resolvedVersionId,
    installed: source.installed
  })
  return updated
}

/* ----------------------------------------------------------------- stats */

async function directorySize(dir: string): Promise<number> {
  let total = 0
  let entries: Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) total += await directorySize(full)
    else if (entry.isFile()) {
      try {
        total += (await stat(full)).size
      } catch {
        /* file vanished mid-scan */
      }
    }
  }
  return total
}

async function countEntries(dir: string, filter?: (name: string) => boolean): Promise<number> {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    return entries.filter((e) => (filter ? filter(e.name) : true)).length
  } catch {
    return 0
  }
}

export async function instanceStats(id: string): Promise<InstanceStats> {
  const instance = getInstance(id)
  const [mods, worlds, resourcePacks, shaderPacks, screenshots, diskBytes] = await Promise.all([
    countEntries(join(instance.gameDir, 'mods'), (n) => n.endsWith('.jar') || n.endsWith('.jar.disabled')),
    countEntries(join(instance.gameDir, 'saves')),
    countEntries(join(instance.gameDir, 'resourcepacks')),
    countEntries(join(instance.gameDir, 'shaderpacks')),
    countEntries(join(instance.gameDir, 'screenshots'), (n) => /\.(png|jpg|jpeg)$/i.test(n)),
    directorySize(instance.gameDir)
  ])
  return { mods, worlds, resourcePacks, shaderPacks, screenshots, diskBytes }
}

/** Recreates any missing standard folders. Cheap and safe to call before launch. */
export async function ensureInstanceLayout(instance: Instance): Promise<void> {
  if (!existsSync(instance.gameDir)) await mkdir(instance.gameDir, { recursive: true })
  for (const sub of INSTANCE_SUBDIRS) {
    const dir = join(instance.gameDir, sub)
    if (!existsSync(dir)) await mkdir(dir, { recursive: true })
  }
}

export function recordPlaySession(id: string, durationMs: number): void {
  const instance = findInstance(id)
  if (!instance) return
  saveInstance({
    ...instance,
    lastPlayedAt: Date.now(),
    totalPlaytimeMs: instance.totalPlaytimeMs + Math.max(0, durationMs)
  })
  broadcast()
}
