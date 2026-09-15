import { describe, expect, it } from 'vitest'
import { readMood, nextMood, MOOD_LOOK, MOOD_DWELL, type MoodInput } from '../../src/shared/mood'
import type { CompanionEvent, CompanionStatus } from '../../src/shared/companion'
import { THEMES } from '../../src/shared/types'

/**
 * The companion's mood, which drives what colour the whole window is.
 *
 * Two things matter and neither is the mapping. The first is that a mood is
 * always true - it is read off what is actually happening, so it cannot say
 * "working" at a bot that is disconnected. The second is that it settles: a
 * window that changes colour twice a second is one nobody leaves switched on,
 * and a bot that fails, recovers and fails again does exactly that to it.
 */

const NOW = 1_700_000_000_000

function event(kind: CompanionEvent['kind'], text: string, ago = 0): CompanionEvent {
  return { id: 1, at: NOW - ago, kind, text, companionId: 'a' }
}

function input(over: Partial<MoodInput> = {}): MoodInput {
  return {
    status: 'playing' as CompanionStatus,
    goal: null,
    events: [],
    now: NOW,
    ...over
  }
}

describe('reading a mood off what is happening', () => {
  it('is away when there is no bot running', () => {
    expect(readMood(input({ status: 'idle' }))).toBe('away')
    expect(readMood(input({ status: 'disconnected' }))).toBe('away')
  })

  it('never claims to be working while disconnected', () => {
    // The case an invented mood gets wrong: a goal is still set, but there is
    // nothing there to pursue it.
    expect(readMood(input({ status: 'disconnected', goal: 'build a house' }))).toBe('away')
  })

  it('is calm when connected with nothing to do', () => {
    expect(readMood(input())).toBe('calm')
  })

  it('is focused once it has set itself a goal', () => {
    expect(readMood(input({ goal: 'mine some iron' }))).toBe('focused')
  })

  it('is pleased when something finished', () => {
    expect(readMood(input({ events: [event('action', 'built the walls')] }))).toBe('pleased')
  })

  it('is rattled when a tool call went somewhere bad', () => {
    expect(readMood(input({ events: [event('action', 'could not reach that block')] }))).toBe('rattled')
  })

  it('tells "not found" from "cannot reach"', () => {
    /*
     * An empty answer is an answer. Treating every unhelpful tool result as
     * trouble would leave the window red most of the time.
     */
    expect(readMood(input({ events: [event('action', 'no chest found nearby')] }))).toBe('calm')
  })

  it('lets an error outrank something it just finished', () => {
    const events = [event('action', 'built the walls'), event('error', 'the model refused')]
    expect(readMood(input({ events }))).toBe('rattled')
  })

  it('forgets what happened a while ago', () => {
    // Otherwise one failure half a minute back keeps it rattled indefinitely.
    expect(readMood(input({ events: [event('action', 'failed to path there', 60_000)] }))).toBe('calm')
  })

  it('is alarmed when the bot itself is in an error state', () => {
    expect(readMood(input({ status: 'error' }))).toBe('alarmed')
  })
})

describe('settling, so the window does not strobe', () => {
  it('lets a stronger mood cut straight in', () => {
    const held = { mood: 'calm' as const, since: NOW }
    const now = nextMood(held, input({ status: 'error', now: NOW + 10 }))

    expect(now.mood).toBe('alarmed')
  })

  it('makes a quieter mood wait its turn', () => {
    /*
     * The flicker this exists to stop: something fails, recovers a moment
     * later, and the window would have gone red and back again inside a
     * second.
     */
    const held = { mood: 'rattled' as const, since: NOW }
    const now = nextMood(held, input({ now: NOW + 500 }))

    expect(now.mood).toBe('rattled')
    expect(now.since).toBe(NOW)
  })

  it('lets it go once it has been readable long enough', () => {
    const held = { mood: 'rattled' as const, since: NOW }
    const now = nextMood(held, input({ now: NOW + MOOD_DWELL.rattled + 1 }))

    expect(now.mood).toBe('calm')
  })

  it('keeps the same mood without restarting its clock', () => {
    // Otherwise a mood that keeps being true never stops being new, and can
    // never be replaced by anything quieter.
    const held = { mood: 'focused' as const, since: NOW }
    const now = nextMood(held, input({ goal: 'still going', now: NOW + 9000 }))

    expect(now.since).toBe(NOW)
  })

  it('takes the first mood immediately, with nothing to settle from', () => {
    expect(nextMood(null, input({ goal: 'go' })).mood).toBe('focused')
  })
})

describe('the looks themselves', () => {
  it('names a theme the app actually has for every mood', () => {
    const real = new Set(THEMES.map((theme) => theme.id))

    for (const [mood, look] of Object.entries(MOOD_LOOK)) {
      expect(real.has(look.theme), `${mood} -> ${look.theme}`).toBe(true)
      expect(look.label.length).toBeGreaterThan(0)
    }
  })

  it('gives the ordinary moods the quiet theme', () => {
    // Away and idle are most of a companion's life; they should not be an event.
    expect(MOOD_LOOK.away.theme).toBe(MOOD_LOOK.calm.theme)
  })

  it('has a dwell for every mood', () => {
    for (const mood of Object.keys(MOOD_LOOK)) {
      expect(MOOD_DWELL[mood as keyof typeof MOOD_DWELL]).toBeGreaterThanOrEqual(0)
    }
  })
})
