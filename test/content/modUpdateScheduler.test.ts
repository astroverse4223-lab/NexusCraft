import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { Instance, ModUpdate } from '../../src/shared/types'

/**
 * What the automatic updater will and will not touch.
 *
 * The whole safety of `install` mode rests on two rules: never write into an
 * instance whose game is running, and never apply an update a person should
 * look at first. Both are easy to break without noticing, because the failure
 * is silent — a jar swapped under a live game shows up as a crash on the next
 * world load, not as an error here.
 */

const instances: Instance[] = [
  { id: 'a', name: 'Alpha', minecraftVersion: '1.21.1', loader: 'fabric' } as Instance,
  { id: 'b', name: 'Beta', minecraftVersion: '1.21.1', loader: 'fabric' } as Instance
]

const running = new Set<string>()
const applied: string[] = []
let updatesFor: (instance: Instance) => ModUpdate[] = () => []
const kv = new Map<string, string>()

vi.mock('../../src/main/core/database', () => ({
  db: () => ({
    kvGet: (key: string) => kv.get(key) ?? null,
    kvSet: (key: string, value: string) => void kv.set(key, value)
  })
}))
vi.mock('../../src/main/core/events', () => ({ emit: vi.fn(), toast: vi.fn() }))
vi.mock('../../src/main/core/notifications', () => ({ notifyDesktop: vi.fn() }))
vi.mock('../../src/main/core/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })
}))
vi.mock('../../src/main/services/instances/instanceService', () => ({
  listInstances: () => instances
}))
vi.mock('../../src/main/services/launch/launchService', () => ({
  isRunning: (id: string) => running.has(id)
}))
vi.mock('../../src/main/services/content/modrinthService', () => ({
  checkModUpdates: async (instance: Instance) => updatesFor(instance),
  applyModUpdate: async (_instance: Instance, update: ModUpdate) => void applied.push(update.fileName)
}))

const { sweepForModUpdates, setModUpdateSettings, modUpdateSettings } = await import(
  '../../src/main/services/content/modUpdateScheduler'
)

function update(fileName: string, extra: Partial<ModUpdate> = {}): ModUpdate {
  return {
    fileName,
    projectId: 'p',
    currentVersion: '1.0.0',
    newVersion: '1.0.1',
    newVersionId: 'v',
    newFileName: fileName,
    sizeBytes: 1,
    enabled: true,
    versionType: 'release',
    ...extra
  } as ModUpdate
}

beforeEach(() => {
  running.clear()
  applied.length = 0
  kv.clear()
  updatesFor = () => []
})

describe('sweepForModUpdates', () => {
  it('defaults to telling you rather than installing', () => {
    expect(modUpdateSettings().mode).toBe('notify')
  })

  it('notify mode finds updates but writes nothing', async () => {
    updatesFor = () => [update('a.jar'), update('b.jar')]
    const sweep = await sweepForModUpdates('test')

    expect(sweep.found).toBe(4) // two per instance
    expect(sweep.installed).toBe(0)
    expect(applied).toEqual([])
  })

  it('skips an instance whose game is running', async () => {
    running.add('a')
    updatesFor = () => [update('a.jar')]
    const sweep = await sweepForModUpdates('test')

    expect(sweep.skipped).toBe(1)
    expect(sweep.checked).toBe(1)
    // Only the idle instance contributed.
    expect(sweep.found).toBe(1)
  })

  it('never writes into a running instance even in install mode', async () => {
    setModUpdateSettings({ mode: 'install' })
    running.add('a')
    running.add('b')
    updatesFor = () => [update('a.jar')]

    await sweepForModUpdates('test')
    expect(applied).toEqual([])
  })

  it('install mode holds back major jumps and pre-release builds', async () => {
    setModUpdateSettings({ mode: 'install' })
    running.add('b')
    updatesFor = () => [
      update('safe.jar'),
      update('major.jar', { majorJump: true }),
      update('beta.jar', { versionType: 'beta' })
    ]

    const sweep = await sweepForModUpdates('test')

    expect(applied).toEqual(['safe.jar'])
    expect(sweep.installed).toBe(1)
    expect(sweep.heldBack).toBe(2)
  })

  it('applies everything once you turn the holdback off', async () => {
    setModUpdateSettings({ mode: 'install', reviewRisky: false })
    running.add('b')
    updatesFor = () => [update('safe.jar'), update('major.jar', { majorJump: true })]

    const sweep = await sweepForModUpdates('test')

    expect(applied.sort()).toEqual(['major.jar', 'safe.jar'])
    expect(sweep.heldBack).toBe(0)
  })

  it('carries on when one instance cannot be checked', async () => {
    updatesFor = (instance) => {
      if (instance.id === 'a') throw new Error('network down')
      return [update('b.jar')]
    }

    const sweep = await sweepForModUpdates('test')
    expect(sweep.checked).toBe(1)
    expect(sweep.found).toBe(1)
  })

  it('records when it last ran, so a restart does not re-scan at once', async () => {
    expect(modUpdateSettings().lastCheck).toBeNull()
    await sweepForModUpdates('test')
    expect(modUpdateSettings().lastCheck).toBeTypeOf('number')
  })

  it('keeps the interval within a sane range', () => {
    expect(setModUpdateSettings({ everyHours: 0 }).everyHours).toBe(1)
    expect(setModUpdateSettings({ everyHours: 10_000 }).everyHours).toBe(168)
  })
})
