/**
 * Giving the companion a voice.
 *
 * Uses the speech synthesis built into Chromium, which Electron already is. No
 * dependency, no API key, no model to download, and it works with the network
 * off — it speaks through the voices Windows already has installed. A neural
 * voice would sound better, but it would mean shipping a few hundred megabytes
 * and a second runtime to say "I found some iron", and the thing that makes a
 * companion feel present is that it speaks at all, not how well.
 *
 * Two rules shape everything here.
 *
 * It only ever speaks actual dialogue. A companion feed carries status lines,
 * tool calls, pathfinding notes and errors, and reading those aloud turns a
 * character into a screen reader working through a log.
 *
 * And it never queues. Chromium's synthesiser queues by default, so a bot that
 * produced six lines while you were in another tab would deliver all six in a
 * row, minutes late, over the top of whatever it is saying now. Speech that is
 * no longer true is worse than silence.
 */

export interface VoiceSettings {
  enabled: boolean
  /** 0 to 1. */
  volume: number
  /** 0.5 to 2; 1 is the voice's natural pace. */
  rate: number
  /** Preferred voice name, or empty for whatever the system picks. */
  voiceName: string
}

export const DEFAULT_VOICE: VoiceSettings = {
  enabled: false,
  volume: 0.9,
  // Slightly quicker than default, which otherwise sounds like a announcement.
  rate: 1.05,
  voiceName: ''
}

/**
 * Voices the system has, English first.
 *
 * Chromium populates this asynchronously and returns an empty list on the first
 * call, which is why this is a function rather than a constant and why callers
 * also listen for `voiceschanged`.
 */
export function availableVoices(): SpeechSynthesisVoice[] {
  if (typeof window === 'undefined' || !window.speechSynthesis) return []
  return window.speechSynthesis
    .getVoices()
    .filter((voice) => voice.lang.toLowerCase().startsWith('en'))
}

/**
 * A stable voice for a companion, when none was chosen.
 *
 * Derived from the companion's id, so two bots running at once do not sound
 * like the same person and a given bot sounds the same tomorrow. Without this
 * every companion gets the system default and a crew is indistinguishable.
 */
function voiceFor(companionId: string, preferred: string): SpeechSynthesisVoice | null {
  const voices = availableVoices()
  if (voices.length === 0) return null

  if (preferred) {
    const exact = voices.find((voice) => voice.name === preferred)
    if (exact) return exact
  }

  let hash = 0
  for (const char of companionId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return voices[hash % voices.length]
}

/**
 * Text worth saying out loud.
 *
 * Minecraft chat is full of things that are unreadable aloud: coordinates,
 * item ids, colour codes, another player's name in angle brackets. This keeps
 * the sentence and drops the machinery.
 */
export function speakable(text: string): string {
  return text
    // Section-sign colour codes.
    .replace(/§./g, '')
    /*
     * <Player> prefixes — the speaker is already known.
     *
     * Leading whitespace is allowed for on purpose: stripping the colour codes
     * above can leave some behind, and an anchor that insists on position zero
     * then quietly stops matching.
     */
    .replace(/^\s*<[^>]+>\s*/, '')
    // minecraft:iron_ingot -> iron ingot
    .replace(/\b(?:minecraft:)?([a-z_]+_[a-z_]+)\b/g, (_, word: string) => word.replace(/_/g, ' '))
    // Bare coordinate runs, which are unlistenable.
    .replace(/-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?/g, 'over there')
    .replace(/\s+/g, ' ')
    .trim()
}

/** The longest line worth speaking; past this it is a monologue. */
const MAX_CHARS = 220

let lastSpokenAt = 0

/**
 * Says one line, replacing anything already being said.
 *
 * `cancel()` before `speak()` is the whole trick. Left to itself the browser
 * queues utterances and works through the backlog, so a companion that talked
 * while the window was hidden arrives as a monologue about things that have
 * stopped being true.
 */
export function say(text: string, companionId: string, settings: VoiceSettings): void {
  if (!settings.enabled) return
  if (typeof window === 'undefined' || !window.speechSynthesis) return

  const line = speakable(text)
  if (!line) return

  // Rate-limited: a chatty bot can produce several lines a second, and speech
  // that is constantly interrupting itself is just noise.
  const now = Date.now()
  if (now - lastSpokenAt < 400) return
  lastSpokenAt = now

  const utterance = new SpeechSynthesisUtterance(
    line.length > MAX_CHARS ? `${line.slice(0, MAX_CHARS)}…` : line
  )
  utterance.volume = Math.min(Math.max(settings.volume, 0), 1)
  utterance.rate = Math.min(Math.max(settings.rate, 0.5), 2)

  const voice = voiceFor(companionId, settings.voiceName)
  if (voice) {
    utterance.voice = voice
    utterance.lang = voice.lang
  }

  window.speechSynthesis.cancel()
  window.speechSynthesis.speak(utterance)
}

/** Stops immediately — for closing the screen, or a mute. */
export function hush(): void {
  if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel()
}
