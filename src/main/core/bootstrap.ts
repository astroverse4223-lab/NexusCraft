import { app } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The data directory has to be known before the database can be opened, so it
 * cannot live in the database. It is kept in a tiny standalone file next to the
 * Electron user data instead.
 */
interface BootstrapConfig {
  dataDir?: string
}

function file(): string {
  return join(app.getPath('userData'), 'bootstrap.json')
}

export function readBootstrap(): BootstrapConfig {
  if (process.env.NEXUSCRAFT_DATA_DIR?.trim()) {
    return { dataDir: process.env.NEXUSCRAFT_DATA_DIR.trim() }
  }
  try {
    return JSON.parse(readFileSync(file(), 'utf8')) as BootstrapConfig
  } catch {
    return {}
  }
}

export function writeBootstrap(config: BootstrapConfig): void {
  writeFileSync(file(), JSON.stringify(config, null, 2), 'utf8')
}
