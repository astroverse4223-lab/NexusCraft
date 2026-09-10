import { describeAudio, isOggVorbis } from '@shared/resourcePacks'

/**
 * Turning any audio file into the one format Minecraft plays.
 *
 * The game does not play mp3 and it does not play wav. It plays Ogg Vorbis and
 * nothing else - the sound engine decodes with stb_vorbis, so even an .ogg is
 * only half an answer: an Ogg file holding Opus has the right extension, the
 * right magic bytes, and is silent in game. That is checked here rather than
 * discovered in a world.
 *
 * Two halves, and each is someone else's job. Chromium already decodes mp3,
 * wav, flac, m4a and opus, so decoding is `decodeAudioData` and costs nothing.
 * Encoding Vorbis is real work, and libvorbis compiled to asm.js does it.
 */

/** Vorbis quality, 0 to 1. About 160kbps at this setting, which is plenty. */
const QUALITY = 0.5

/** Encoded in blocks, both to bound memory and to have something to report. */
const BLOCK = 4096

export interface Converted {
  bytes: ArrayBuffer
  /** False when the file was already Ogg Vorbis and was passed straight through. */
  converted: boolean
  seconds: number
  channels: number
  sampleRate: number
}

/**
 * Decodes whatever this is and re-encodes it as Ogg Vorbis.
 *
 * A file that is already Ogg Vorbis is handed back untouched: re-encoding it
 * would throw away quality to arrive where it started.
 */
export async function toOggVorbis(file: File, onProgress?: (done: number) => void): Promise<Converted> {
  const original = await file.arrayBuffer()

  if (isOggVorbis(new Uint8Array(original))) {
    return {
      bytes: original,
      converted: false,
      seconds: 0,
      channels: 0,
      sampleRate: 0
    }
  }

  /*
   * decodeAudioData detaches the buffer it is given, and the caller may still
   * want the original, so it gets a copy.
   */
  const context = new AudioContext()

  let audio: AudioBuffer
  try {
    audio = await context.decodeAudioData(original.slice(0))
  } catch {
    throw new Error(
      `${file.name} could not be decoded - it looks like ${describeAudio(file.name, new Uint8Array(original))}. ` +
        'Try an mp3, wav, flac, m4a or ogg.'
    )
  } finally {
    void context.close()
  }

  /*
   * Loaded when somebody actually converts something.
   *
   * libvorbis compiled to asm.js is two megabytes, and importing it at the top
   * of the file put all of it in the main chunk - parsed on every launch, by
   * everyone, whether or not they ever add a sound. As its own chunk it costs
   * nothing until the first conversion.
   */
  // @ts-expect-error - vorbis-encoder-js ships generated JavaScript with no typings
  const { default: VorbisEncoder } = await import('vorbis-encoder-js/dist/encoder.js')

  const encoder = new VorbisEncoder(audio.sampleRate, audio.numberOfChannels, QUALITY, {
    ENCODER: 'NexusCraft Launcher'
  })

  const channels: Float32Array[] = []
  for (let ch = 0; ch < audio.numberOfChannels; ch += 1) channels.push(audio.getChannelData(ch))

  for (let at = 0; at < audio.length; at += BLOCK) {
    encoder.encode(channels.map((data) => data.slice(at, at + BLOCK)))

    /*
     * Yielded every block so the window keeps painting. A four minute track is
     * a couple of thousand blocks, and without this the app is frozen for the
     * whole of it with no way to say how far along it is.
     */
    if (onProgress) {
      onProgress(Math.min(1, at / audio.length))
      await new Promise((resume) => setTimeout(resume, 0))
    }
  }

  const blob: Blob = encoder.finish('audio/ogg')
  onProgress?.(1)

  return {
    bytes: await blob.arrayBuffer(),
    converted: true,
    seconds: audio.duration,
    channels: audio.numberOfChannels,
    sampleRate: audio.sampleRate
  }
}
