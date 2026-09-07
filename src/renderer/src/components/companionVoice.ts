import { api } from '../api'

/**
 * Giving the companion a voice.
 *
 * Two engines, and the choice is a real one.
 *
 * The system voice is Chromium's, which Electron already is: no dependency, no
 * key, nothing to download, works offline, and sounds like a train station.
 * Kokoro is a neural model running on this machine — enormously better, at the
 * cost of a one-time download and about a second a line. The original argument
 * for shipping only the system voice was that presence comes from speaking at
 * all rather than from speaking well, and that is true right up until you hear
 * the two side by side.
 *
 * Synthesis for the neural voice happens in the main process, not here. The
 * renderer is held to `connect-src 'self'` and cannot fetch a model, and the
 * same loaded model is shared with the Minecraft mod rather than downloaded
 * twice.
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

/**
 * Which engine says the lines.
 *
 * `system` is Windows' own synthesiser through Chromium — instant, free, and
 * unmistakably a robot. `kokoro` is a neural model running on this machine,
 * which sounds enormously better and costs a one-time download and about a
 * second a line.
 *
 * Microsoft's Edge voices are deliberately absent. They are not a public API
 * but a private protocol behind a rolling signed token, so an implementation
 * works right up until Microsoft rotates it and then fails silently.
 */
export type VoiceEngine = 'system' | 'kokoro'

export interface VoiceSettings {
  engine: VoiceEngine
  /** Which Kokoro voice, e.g. af_sky. Ignored by the system engine. */
  kokoroVoice: string
  enabled: boolean
  /** 0 to 1. */
  volume: number
  /** 0.5 to 2; 1 is the voice's natural pace. */
  rate: number
  /** Preferred voice name, or empty for whatever the system picks. */
  voiceName: string
}

export const DEFAULT_VOICE: VoiceSettings = {
  // The system voice needs no download, so it is what a fresh install gets.
  engine: 'system',
  kokoroVoice: 'af_sky',
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

  const line = speakable(text)
  if (!line) return

  // Rate-limited: a chatty bot can produce several lines a second, and speech
  // that is constantly interrupting itself is just noise.
  const now = Date.now()
  if (now - lastSpokenAt < 400) return
  lastSpokenAt = now

  if (settings.engine === 'kokoro') {
    void sayWithKokoro(line, settings)
    return
  }

  if (typeof window === 'undefined' || !window.speechSynthesis) return

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
  // Whichever engine was talking, stop it.
  latestRequest++
  stopClip()
}

/**
 * The neural voice, synthesised in the main process and played here.
 *
 * Two things make this behave rather than pile up. Only one clip is ever
 * playing, and a new line stops the old one — the same rule as the system
 * voice, for the same reason: a companion working through a backlog is
 * narrating things that stopped being true minutes ago.
 *
 * And a line that is still being synthesised when the next one arrives is
 * abandoned. Synthesis takes about a second, which is easily long enough for
 * two lines to overlap, and playing both is worse than dropping one.
 */
let playing: HTMLAudioElement | null = null
let latestRequest = 0

async function sayWithKokoro(line: string, settings: VoiceSettings): Promise<void> {
  const mine = ++latestRequest

  try {
    const { wav } = await api.voice.speak(line.slice(0, 400), settings.kokoroVoice)

    // Something newer was asked for while this was being made.
    if (mine !== latestRequest) return

    stopClip()

    const blob = new Blob([Uint8Array.from(atob(wav), (c) => c.charCodeAt(0))], {
      type: 'audio/wav'
    })
    const url = URL.createObjectURL(blob)
    const audio = new Audio(url)
    audio.volume = Math.min(Math.max(settings.volume, 0), 1)
    // Kokoro speaks at a natural pace already, so the slider is a nudge here
    // rather than the wholesale speed-up a system voice needs.
    audio.playbackRate = Math.min(Math.max(settings.rate, 0.5), 2)

    // Revoked on the way out, or every line leaks a few hundred kilobytes.
    audio.addEventListener('ended', () => URL.revokeObjectURL(url), { once: true })

    playing = audio
    await audio.play()
  } catch {
    /*
     * Silent on failure, deliberately. The model may still be downloading, or
     * absent entirely, and a toast for every line a companion says would be
     * far worse than the line not being spoken.
     */
  }
}

function stopClip(): void {
  if (!playing) return
  playing.pause()
  playing.currentTime = 0
  playing = null
}
