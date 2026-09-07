import { describe, expect, it } from 'vitest'
import { IpcRequestSchemas } from '../../src/shared/ipc'

/**
 * The settings a hosted server saves must survive the trip.
 *
 * Zod strips whatever a schema does not name, silently. The `host:save` schema
 * listed thirteen fields and none of the world settings, so the form sent them,
 * the schema dropped them, and the service — which handles every one correctly —
 * never saw them. Turn on "allow flight", save, reopen: off again.
 *
 * Spawn protection went the same way, which is why companions kept being
 * refused near spawn even after it was turned down.
 *
 * A field added to the settings screen and not to the schema fails exactly like
 * this: no error anywhere, the value simply gone. Hence this test.
 */
const base = {
  id: null,
  name: 'Test',
  minecraftVersion: '1.21.11',
  software: 'fabric' as const,
  port: 25565,
  onlineMode: false,
  reachability: 'local' as const,
  memoryMb: 2048,
  motd: 'hello',
  difficulty: 'normal' as const,
  gameMode: 'creative' as const,
  maxPlayers: 8,
  allowCheats: true,
  operators: ['Error420s']
}

describe('the host:save schema', () => {
  const schema = IpcRequestSchemas['host:save']

  it('keeps allow flight', () => {
    const parsed = schema.parse({ ...base, allowFlight: true })
    expect(parsed.allowFlight).toBe(true)
  })

  it('keeps every world setting the screen offers', () => {
    const world = {
      levelSeed: 'abc123',
      pvp: false,
      hardcore: true,
      allowFlight: true,
      spawnProtection: 0,
      viewDistance: 12,
      simulationDistance: 8,
      spawnMonsters: false,
      spawnAnimals: false,
      whitelist: true
    }

    const parsed = schema.parse({ ...base, ...world })
    for (const [key, value] of Object.entries(world)) {
      expect(parsed[key], `${key} was dropped by the schema`).toEqual(value)
    }
  })

  it('still accepts a save with none of them, for an older server', () => {
    const parsed = schema.parse(base)
    expect(parsed.name).toBe('Test')
    expect(parsed.allowFlight).toBeUndefined()
  })

  it('refuses a spawn protection radius the server would not accept', () => {
    expect(() => schema.parse({ ...base, spawnProtection: -1 })).toThrow()
    expect(() => schema.parse({ ...base, spawnProtection: 9999 })).toThrow()
  })

  it('refuses a view distance outside what Minecraft allows', () => {
    expect(() => schema.parse({ ...base, viewDistance: 1 })).toThrow()
    expect(() => schema.parse({ ...base, viewDistance: 64 })).toThrow()
  })
})
