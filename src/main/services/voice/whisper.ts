import { createLogger } from '../../core/logger'

const log = createLogger('whisper')

/**
 * Turning speech into text, on this machine.
 *
 * The companion mods can already be heard; this is what lets them listen. It
 * runs Whisper through the same ONNX runtime the voice already uses, so
 * speaking to a companion needs nothing installed that the launcher does not
 * ship — which was the whole point of hosting Kokoro here rather than telling
 * people to set up a Python server.
 *
 * Loaded lazily and only when something actually asks for a transcription: it
 * is a few hundred megabytes, and most people never speak to anything.
 */

/** What Whisper expects, regardless of what arrives. */
const SAMPLE_RATE = 16000

import { transcribe as runInWorker } from './kokoro'

/**
 * Reads a mono 16-bit PCM WAV into the floats Whisper wants.
 *
 * Written by hand because the alternative is a decoding dependency for a format
 * that is a 44-byte header and then the samples. Chunk-walking rather than
 * assuming the data starts at byte 44: some writers put a LIST chunk first, and
 * transcribing the metadata as though it were audio produces confident nonsense.
 */
export function wavToFloats(wav: Buffer): { samples: Float32Array; rate: number } {
  if (wav.length < 12 || wav.toString('ascii', 0, 4) !== 'RIFF') {
    throw new Error('not a WAV file')
  }

  let rate = SAMPLE_RATE
  let channels = 1
  let bits = 16
  let data: Buffer | null = null

  let at = 12
  while (at + 8 <= wav.length) {
    const id = wav.toString('ascii', at, at + 4)
    const size = wav.readUInt32LE(at + 4)
    const body = at + 8

    if (id === 'fmt ') {
      channels = wav.readUInt16LE(body + 2)
      rate = wav.readUInt32LE(body + 4)
      bits = wav.readUInt16LE(body + 14)
    } else if (id === 'data') {
      data = wav.subarray(body, Math.min(body + size, wav.length))
    }

    // Chunks are padded to even lengths.
    at = body + size + (size % 2)
  }

  if (!data) throw new Error('the WAV had no audio in it')
  if (bits !== 16) throw new Error(`expected 16-bit audio, got ${bits}-bit`)

  const total = Math.floor(data.length / 2)
  const frames = Math.floor(total / channels)
  const samples = new Float32Array(frames)

  for (let frame = 0; frame < frames; frame += 1) {
    // Average the channels rather than taking the first: a microphone captured
    // in stereo is the same voice twice, and dropping one halves the signal.
    let sum = 0
    for (let channel = 0; channel < channels; channel += 1) {
      sum += data.readInt16LE((frame * channels + channel) * 2)
    }
    samples[frame] = sum / channels / 32768
  }

  return { samples, rate }
}

/**
 * Resamples to 16kHz by averaging.
 *
 * Simple decimation would alias — dropping two of every three samples of 48kHz
 * speech folds the high frequencies down into the range Whisper listens to, and
 * it hears a robot. Averaging each group is a crude low-pass, which is enough
 * for one voice at conversational volume.
 */
export function resample(samples: Float32Array, from: number, to = SAMPLE_RATE): Float32Array {
  if (from === to) return samples

  const ratio = from / to
  const out = new Float32Array(Math.floor(samples.length / ratio))

  for (let i = 0; i < out.length; i += 1) {
    const start = Math.floor(i * ratio)
    const end = Math.min(Math.floor((i + 1) * ratio), samples.length)

    let sum = 0
    for (let j = start; j < end; j += 1) sum += samples[j]
    out[i] = end > start ? sum / (end - start) : 0
  }

  return out
}

/** What was said, or an empty string when it was not speech at all. */
export async function transcribe(wav: Buffer, language?: string): Promise<string> {
  const { samples, rate } = wavToFloats(wav)
  const audio = resample(samples, rate)

  // Under a fifth of a second cannot be a word.
  if (audio.length < SAMPLE_RATE / 5) return ''

  /*
   * Handed to the voice worker rather than run here.
   *
   * Loading the model in the main process used the default transformers cache,
   * which lives inside node_modules — and in a packaged build that is inside
   * the read-only asar, so every transcription failed with
   * "ENOTDIR, not a directory" while working perfectly from a checkout.
   */
  return await runInWorker(audio, language)
}
