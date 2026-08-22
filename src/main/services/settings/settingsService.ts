import { totalmem } from 'node:os'
import type { AppSettings } from '@shared/types'
import { db } from '../../core/database'
import { emit } from '../../core/events'
import { createLogger } from '../../core/logger'

const log = createLogger('settings')
const KEY = 'app-settings'

/**
 * Recommended heap sizes. Minecraft does not benefit from very large heaps —
 * beyond ~8 GB garbage collection pauses usually get worse, not better — and
 * handing the JVM everything the machine has starves Windows itself.
 */
export function recommendedRamMb(): { min: number; max: number; ceiling: number; systemMb: number } {
  const systemMb = Math.floor(totalmem() / 1024 / 1024)
  // Never offer more than 70% of RAM, and always leave at least 2 GB for the OS.
  const ceiling = Math.max(1024, Math.min(Math.floor(systemMb * 0.7), systemMb - 2048))

  let max: number
  if (systemMb >= 32768) max = 8192
  else if (systemMb >= 16384) max = 6144
  else if (systemMb >= 12288) max = 4096
  else if (systemMb >= 8192) max = 3072
  else max = 2048

  max = Math.min(max, ceiling)
  return { min: Math.min(1024, max), max, ceiling, systemMb }
}

function defaults(): AppSettings {
  const ram = recommendedRamMb()
  return {
    dataDir: '',
    defaultMaxRamMb: ram.max,
    defaultMinRamMb: ram.min,
    // Modern low-pause collector; the defaults Mojang's own launcher ships with.
    defaultJvmArgs:
      '-XX:+UnlockExperimentalVMOptions -XX:+UseG1GC -XX:G1NewSizePercent=20 -XX:G1ReservePercent=20 -XX:MaxGCPauseMillis=50 -XX:G1HeapRegionSize=32M',
    javaPath: null,
    closeLauncherOnLaunch: false,
    restoreOnGameExit: true,
    keepLauncherOpen: true,
    maxConcurrentDownloads: 8,
    showSnapshots: false,
    authFlow: 'device-code',
    curseForgeApiKey: process.env.NEXUSCRAFT_CURSEFORGE_KEY?.trim() ?? '',
    clientId: process.env.NEXUSCRAFT_CLIENT_ID?.trim() ?? '',
    animatedBackground: true,
    particles: true,
    accentColor: '#5eead4',
    onboardingComplete: false,
    selectedInstanceId: null
  }
}

let cached: AppSettings | null = null

export function getSettings(): AppSettings {
  if (cached) return cached
  const raw = db().kvGet(KEY)
  const base = defaults()
  if (!raw) {
    cached = base
    return cached
  }
  try {
    const stored = JSON.parse(raw) as Partial<AppSettings>
    // Merge over defaults so settings added in a later version appear populated.
    cached = { ...base, ...stored }
    // An env-provided client id always wins so packaged builds can ship one.
    if (process.env.NEXUSCRAFT_CLIENT_ID?.trim()) cached.clientId = process.env.NEXUSCRAFT_CLIENT_ID.trim()
  } catch {
    log.warn('settings were unreadable; restoring defaults')
    cached = base
  }
  return cached
}

const NUMERIC_BOUNDS: Record<string, [number, number]> = {
  defaultMaxRamMb: [512, 65536],
  defaultMinRamMb: [256, 65536],
  maxConcurrentDownloads: [1, 24]
}

export function updateSettings(patch: Record<string, unknown>): AppSettings {
  const current = getSettings()
  const next: AppSettings = { ...current }

  for (const [key, value] of Object.entries(patch)) {
    if (!(key in current)) continue // ignore unknown keys rather than storing junk
    const typed = key as keyof AppSettings
    const expected = typeof current[typed]

    if (value === null && (typed === 'javaPath' || typed === 'selectedInstanceId')) {
      ;(next[typed] as unknown) = null
      continue
    }
    if (typeof value !== expected && current[typed] !== null) continue

    if (typeof value === 'number') {
      const bounds = NUMERIC_BOUNDS[key]
      if (!Number.isFinite(value)) continue
      const clamped = bounds ? Math.min(Math.max(Math.round(value), bounds[0]), bounds[1]) : Math.round(value)
      ;(next[typed] as unknown) = clamped
      continue
    }
    if (typeof value === 'string') {
      ;(next[typed] as unknown) = value.slice(0, 4096)
      continue
    }
    ;(next[typed] as unknown) = value
  }

  // Min heap can never exceed max heap, whichever the user just changed.
  if (next.defaultMinRamMb > next.defaultMaxRamMb) {
    if ('defaultMinRamMb' in patch) next.defaultMaxRamMb = next.defaultMinRamMb
    else next.defaultMinRamMb = next.defaultMaxRamMb
  }

  cached = next
  db().kvSet(KEY, JSON.stringify(next))
  emit('settings:changed', next)
  return next
}

/** Reads settings before the database exists (used to locate the data dir). */
export function bootstrapDataDir(): string | null {
  return process.env.NEXUSCRAFT_DATA_DIR?.trim() || null
}
