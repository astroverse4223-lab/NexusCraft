import { app } from 'electron'
import { join, resolve, sep } from 'node:path'
import { mkdirSync } from 'node:fs'

/**
 * All launcher state lives under a single root so that instances stay isolated
 * and the whole install can be moved or backed up as one directory.
 */
let rootDir = ''

export function initPaths(customRoot?: string | null): string {
  rootDir = customRoot && customRoot.trim() ? resolve(customRoot) : join(app.getPath('userData'), 'data')
  for (const dir of [rootDir, instancesRoot(), versionsRoot(), librariesRoot(), assetsRoot(), runtimesRoot(), cacheRoot(), logsRoot(), skinsRoot()]) {
    mkdirSync(dir, { recursive: true })
  }
  return rootDir
}

export function dataRoot(): string {
  if (!rootDir) throw new Error('paths not initialised')
  return rootDir
}

export const instancesRoot = (): string => join(dataRoot(), 'instances')
export const versionsRoot = (): string => join(dataRoot(), 'versions')
export const librariesRoot = (): string => join(dataRoot(), 'libraries')
export const assetsRoot = (): string => join(dataRoot(), 'assets')
export const runtimesRoot = (): string => join(dataRoot(), 'runtimes')
export const cacheRoot = (): string => join(dataRoot(), 'cache')
export const logsRoot = (): string => join(dataRoot(), 'logs')
export const skinsRoot = (): string => join(dataRoot(), 'skins')
export const nativesRoot = (): string => join(dataRoot(), 'natives')
export const dbFile = (): string => join(dataRoot(), 'nexuscraft.db')

export function instanceDir(instanceId: string): string {
  return join(instancesRoot(), instanceId)
}

export function ensureDir(dir: string): string {
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Guards every filesystem operation driven by renderer input: resolves `child`
 * and confirms it really sits inside `parent`. Prevents `../` traversal from an
 * IPC payload reaching arbitrary files.
 */
export function assertInside(parent: string, child: string): string {
  const p = resolve(parent)
  const c = resolve(child)
  if (c !== p && !c.startsWith(p.endsWith(sep) ? p : p + sep)) {
    throw new Error(`path escapes its parent directory`)
  }
  return c
}
