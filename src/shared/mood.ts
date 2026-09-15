import type { CompanionEvent, CompanionStatus } from './companion'
import type { ThemeId } from './types'

/**
 * What the companion is feeling, as far as anything can honestly say.
 *
 * Not asked of the model. A mood that costs a round trip is a mood that lags
 * behind the thing it is describing, and one the model invents is a mood that
 * does not correspond to anything - it would say "focused" while the bot sat
 * disconnected. These are read off what is actually happening instead: it is
 * connected or it is not, it has a goal or it has not, the last thing it tried
 * worked or it threw.
 *
 * The result is a mood that is always true, which is the only kind worth
 * painting the whole window with.
 */
export type Mood = 'away' | 'waking' | 'calm' | 'focused' | 'pleased' | 'rattled' | 'alarmed'

export interface MoodLook {
  theme: ThemeId
  /** Shown beside the companion, so the colour is never a mystery. */
  label: string
}

/**
 * Which theme each mood wears.
 *
 * Chosen so the common moods are quiet and the rare ones are not. Most of the
 * time a companion is idle or working, and a window that flashed red every
 * time a pathfinder gave up would be one nobody leaves switched on.
 */
export const MOOD_LOOK: Record<Mood, MoodLook> = {
  away: { theme: 'nexus', label: 'Away' },
  waking: { theme: 'abyss', label: 'Waking up' },
  calm: { theme: 'nexus', label: 'Idle' },
  focused: { theme: 'abyss', label: 'Working' },
  pleased: { theme: 'moss', label: 'Pleased' },
  rattled: { theme: 'crimson', label: 'Stuck' },
  alarmed: { theme: 'ember', label: 'Trouble' }
}

/**
 * How long a mood holds before anything quieter may replace it.
 *
 * Without this the window strobes: a bot that fails one step, recovers and
 * fails again would flick red, blue, red across a second. A mood that arrives
 * has to be readable before it is allowed to go, and the sharper the mood the
 * longer it is worth looking at.
 */
export const MOOD_DWELL: Record<Mood, number> = {
  away: 0,
  waking: 0,
  calm: 0,
  focused: 1500,
  pleased: 6000,
  rattled: 8000,
  alarmed: 12_000
}

/** Bigger wins when two moods are in play at once. */
const WEIGHT: Record<Mood, number> = {
  away: 0,
  waking: 1,
  calm: 1,
  focused: 2,
  pleased: 3,
  rattled: 4,
  alarmed: 5
}

export interface MoodInput {
  status: CompanionStatus
  /** What it has set itself to do, if anything. */
  goal: string | null
  /** The most recent events, newest last. Only the tail is read. */
  events: CompanionEvent[]
  /** Now, passed in rather than read, so this stays pure. */
  now: number
}

/** How far back an event still counts towards the mood. */
const RECENT_MS = 15_000

/**
 * Words that mean a tool call went somewhere bad rather than merely returning
 * nothing. "not found" is an answer; "cannot reach" is a problem.
 */
const TROUBLE = /\b(failed|cannot|could not|unreachable|refused|timed out|crashed|kicked)\b/i

/** Words for a thing finishing rather than starting. */
const WIN = /\b(built|finished|done|complete|placed|arrived|delivered|found it)\b/i

/**
 * The mood the signals add up to, ignoring whatever came before.
 *
 * Kept separate from the settling in `nextMood` so the rules can be read, and
 * tested, without a clock in the way.
 */
export function readMood(input: MoodInput): Mood {
  if (input.status === 'disconnected' || input.status === 'idle') {
    // Idle here means "not running", not "running with nothing to do".
    return 'away'
  }

  if (input.status === 'connecting') return 'waking'
  if (input.status === 'error') return 'alarmed'

  const recent = input.events.filter((event) => input.now - event.at <= RECENT_MS)

  // An error it raised itself outranks anything it might be pleased about.
  if (recent.some((event) => event.kind === 'error')) return 'rattled'

  const actions = recent.filter((event) => event.kind === 'action')

  if (actions.some((event) => TROUBLE.test(event.text))) return 'rattled'
  if (actions.some((event) => WIN.test(event.text))) return 'pleased'

  if (input.goal) return 'focused'

  return 'calm'
}

export interface MoodHold {
  mood: Mood
  /** When it took hold, so its dwell can be measured. */
  since: number
}

/**
 * The mood to show now, given what it was showing already.
 *
 * A stronger mood always cuts in. A weaker one has to wait for the current one
 * to have been readable for its dwell, which is what stops the window
 * flickering between two states a bot passes through in the same second.
 */
export function nextMood(held: MoodHold | null, input: MoodInput): MoodHold {
  const wanted = readMood(input)

  if (!held) return { mood: wanted, since: input.now }
  if (wanted === held.mood) return held

  const stronger = WEIGHT[wanted] > WEIGHT[held.mood]
  const settled = input.now - held.since >= MOOD_DWELL[held.mood]

  if (stronger || settled) return { mood: wanted, since: input.now }

  return held
}
