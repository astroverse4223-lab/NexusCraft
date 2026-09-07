/*
 * The voice, in a process of its own.
 *
 * Synthesis was measured starving Electron's main thread: a 50ms timer fired
 * seven times across eight seconds of work, which is the whole window locked
 * up. The ONNX inference itself is native and mostly off-thread, but the
 * tokenising, phonemising and tensor handling around it are plain JavaScript
 * and run wherever they are called — so calling them in the main process meant
 * the launcher stopped responding every time a companion spoke.
 *
 * This is the same shape as the companion bot: a separate entry point, bundled
 * separately, spawned and talked to over messages. Nothing here touches
 * Electron, so it is an ordinary Node process and the model's cache directory
 * arrives in the first message rather than being looked up from `app`.
 */

interface LoadRequest {
  type: 'load'
  cacheDir: string
  build: 'q4' | 'q8'
}

interface SpeakRequest {
  type: 'speak'
  id: number
  text: string
  voice: string
}

interface TranscribeRequest {
  type: 'transcribe'
  id: number
  cacheDir: string
  /** 16kHz mono floats, resampled by the caller. */
  samples: number[]
  language?: string
}

type WorkerRequest = LoadRequest | SpeakRequest | TranscribeRequest

/* eslint-disable @typescript-eslint/no-explicit-any */
let tts: any = null
let loading: Promise<void> | null = null

let stt: any = null
let listening: Promise<void> | null = null

/** Small enough to be quick on a CPU, good enough for a spoken sentence. */
const WHISPER = 'onnx-community/whisper-base'

function send(message: unknown): void {
  process.send?.(message)
}

async function load(cacheDir: string, build: 'q4' | 'q8'): Promise<void> {
  if (tts) return
  if (loading) return loading

  loading = (async () => {
    const { env } = await import('@huggingface/transformers')
    env.cacheDir = cacheDir

    const { KokoroTTS } = await import('kokoro-js')
    tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
      dtype: build,
      device: 'cpu'
    })
  })()

  try {
    await loading
    send({ type: 'ready', voices: Object.keys(tts.voices ?? {}) })
  } catch (error) {
    tts = null
    send({ type: 'failed', message: error instanceof Error ? error.message : String(error) })
  } finally {
    loading = null
  }
}

/**
 * Loads Whisper, downloading it the first time.
 *
 * Separate from the voice on purpose: most people never speak to a companion,
 * and a few hundred megabytes should not be fetched to say a line out loud.
 */
async function listen(cacheDir: string): Promise<void> {
  if (stt) return
  if (listening) return listening

  listening = (async () => {
    const { env, pipeline } = await import('@huggingface/transformers')
    env.cacheDir = cacheDir

    stt = await pipeline('automatic-speech-recognition', WHISPER, {
      dtype: { encoder_model: 'fp32', decoder_model_merged: 'q8' },
      device: 'cpu'
    })
  })()

  try {
    await listening
  } finally {
    listening = null
  }
}

process.on('message', (message: WorkerRequest) => {
  void (async () => {
    if (message.type === 'load') {
      await load(message.cacheDir, message.build)
      return
    }

    if (message.type === 'transcribe') {
      try {
        await listen(message.cacheDir)
        const result = await stt(Float32Array.from(message.samples), {
          ...(message.language ? { language: message.language } : {}),
          task: 'transcribe',
          chunk_length_s: 30,
          return_timestamps: false
        })
        send({ type: 'transcribed', id: message.id, text: (result?.text ?? '').trim() })
      } catch (error) {
        send({
          type: 'transcribed',
          id: message.id,
          error: error instanceof Error ? error.message : String(error)
        })
      }
      return
    }

    if (message.type === 'speak') {
      if (!tts) {
        send({ type: 'spoken', id: message.id, error: 'the voice model is not loaded' })
        return
      }
      try {
        const audio = await tts.generate(message.text, { voice: message.voice })
        const wav = Buffer.from(audio.toWav())
        // Base64 because a Buffer over process IPC is JSON-serialised into an
        // array of numbers, which is several times the size and much slower.
        send({ type: 'spoken', id: message.id, wav: wav.toString('base64') })
      } catch (error) {
        send({
          type: 'spoken',
          id: message.id,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }
  })()
})

send({ type: 'started' })
