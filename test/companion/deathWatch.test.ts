import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { watchOwnerDeath, DESPAWN_MS } from '../../src/main/companion/tools/support/deathWatch'

/**
 * Noticing a death you cannot see.
 *
 * The failure that matters is silent: if nothing recorded where the player was,
 * the recovery has nowhere to go, and the player finds out five minutes later
 * when their gear is gone. So this checks the position is captured *before* the
 * death, since afterwards the entity no longer exists to ask.
 */

/** A mineflayer-shaped stub, with just the parts the watcher touches. */
function fakeBot(ownerAt: { x: number; y: number; z: number } | null) {
  const handlers: Record<string, Array<(arg: unknown) => void>> = {}
  return {
    game: { dimension: 'overworld' },
    players: ownerAt ? { Error420s: { entity: { position: ownerAt, type: 'player', username: 'Error420s' } } } : {},
    on(event: string, fn: (arg: unknown) => void) {
      ;(handlers[event] ??= []).push(fn)
    },
    removeListener() {},
    emit(event: string, arg: unknown) {
      for (const fn of handlers[event] ?? []) fn(arg)
    }
  }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('watchOwnerDeath', () => {
  it('records where they were, because the body is gone by the time it knows', () => {
    const bot = fakeBot({ x: 120, y: 63, z: -40 })
    const watch = watchOwnerDeath(bot, 'Error420s')
    vi.advanceTimersByTime(1100)

    // They die: the entity vanishes, and only the sample survives.
    bot.players = {}
    bot.emit('entityDead', { type: 'player', username: 'Error420s' })

    expect(watch.site()).toMatchObject({ x: 120, y: 63, z: -40, dimension: 'overworld' })
  })

  it('catches a death message when no entity event arrives', () => {
    // A death in an unloaded chunk produces no entity event at all — and that
    // is exactly the death worth recovering from.
    const bot = fakeBot({ x: 5, y: 70, z: 5 })
    const watch = watchOwnerDeath(bot, 'Error420s')
    vi.advanceTimersByTime(1100)

    bot.emit('message', 'Error420s fell from a high place')
    expect(watch.site()).not.toBeNull()
    expect(watch.site()?.cause).toBe('Error420s fell from a high place')
  })

  it('ignores chat that merely mentions the player', () => {
    const bot = fakeBot({ x: 0, y: 64, z: 0 })
    const watch = watchOwnerDeath(bot, 'Error420s')
    vi.advanceTimersByTime(1100)

    bot.emit('message', 'Error420s: watch out, that creeper was close')
    bot.emit('message', 'Someone else was slain by a zombie')
    expect(watch.site()).toBeNull()
  })

  it('does not record a second time for one death', () => {
    const bot = fakeBot({ x: 1, y: 2, z: 3 })
    const watch = watchOwnerDeath(bot, 'Error420s')
    vi.advanceTimersByTime(1100)

    const seen: unknown[] = []
    watch.onDeath((site) => seen.push(site))

    // Both signals usually fire for the same death.
    bot.emit('entityDead', { type: 'player', username: 'Error420s' })
    bot.emit('message', 'Error420s was slain by a zombie')
    expect(seen).toHaveLength(1)
  })

  it('reports the time left before the drops go', () => {
    const bot = fakeBot({ x: 0, y: 0, z: 0 })
    const watch = watchOwnerDeath(bot, 'Error420s')
    vi.advanceTimersByTime(1100)
    bot.emit('entityDead', { type: 'player', username: 'Error420s' })

    expect(watch.timeLeft()).toBeGreaterThan(DESPAWN_MS - 2000)
    vi.advanceTimersByTime(DESPAWN_MS)
    expect(watch.timeLeft()).toBeLessThanOrEqual(0)
  })

  it('records nothing when the player was never seen', () => {
    const bot = fakeBot(null)
    const watch = watchOwnerDeath(bot, 'Error420s')
    vi.advanceTimersByTime(2000)
    bot.emit('entityDead', { type: 'player', username: 'Error420s' })
    expect(watch.site()).toBeNull()
  })
})
