import { app } from 'electron'
import { fork, type ChildProcess } from 'node:child_process'
import { join } from 'node:path'
import { existsSync, mkdirSync } from 'node:fs'

/**
 * A real neural voice, running on this machine.
 *
 * Kokoro is an 82M-parameter text-to-speech model that runs on ONNX, and the
 * `kokoro-js` wrapper carries a pure-JavaScript phonemiser — which is the part
 * that usually sinks this on Windows. Every other route to a good offline voice
 * wants `espeak-ng` installed as a system binary, and telling somebody to go and
 * install a command-line tool before their Minecraft companion can talk is not
 * a feature, it is an obstacle.
 *
 * This lives in the main process for two reasons. The renderer is locked to
 * `connect-src 'self'` on purpose, so it cannot fetch a model, and opening that
 * up to a model host would undo a deliberate security property for a voice.
 * And the model must be shared: the launcher's companions and the Minecraft mod
 * both speak through it, and loading a second copy would mean a second download
 * and a second few hundred megabytes resident.
 */

/**
 * Quantisations, measured on this machine rather than guessed.
 *
 * The gap is the whole decision. q8 is a third of the download and takes over
 * four seconds a line, which is long enough that the companion answers the
 * question before last — the reply is no longer true by the time it arrives.
 * q4 says the same line in about one second, which reads as conversation.
 */
export const BUILDS = {
  q4: { dtype: 'q4' as const, downloadMb: 300, typicalMs: 1100 },
  q8: { dtype: 'q8' as const, downloadMb: 90, typicalMs: 4200 }
}

export type BuildName = keyof typeof BUILDS

const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX'

/** The default voice, and the fallback when a requested one does not exist. */
export const DEFAULT_VOICE = 'af_sky'

export type Status =
  | { state: 'idle' }
  | { state: 'loading'; build: BuildName }
  | { state: 'ready'; build: BuildName; voices: string[] }
  | { state: 'failed'; message: string }

let status: Status = { state: 'idle' }
let loading: Promise<void> | null = null
let loadedBuild: BuildName | null = null

/*
 * The process that actually does the work.
 *
 * Synthesis used to run here, in the main process, and measurably starved
 * Electron's event loop - a 50ms timer fired seven times across eight seconds
 * of synthesis, which is the launcher window frozen. Moving it out is the only
 * fix that holds: the work is genuinely heavy, and the main process is where
 * every window's input is handled.
 */
let worker: ChildProcess | null = null

/** Callbacks waiting on a spoken line, by request id. */
const pending = new Map<
  number,
  { resolve: (value: never) => void; reject: (error: Error) => void }
>()
let nextRequestId = 1

function workerScriptPath(): string {
  return join(app.getAppPath(), 'out', 'main', 'voice.js')
}

function startWorker(): ChildProcess {
  if (worker && !worker.killed) return worker

  const script = workerScriptPath()
  if (!existsSync(script)) throw new Error(`the voice worker is missing at ${script}`)

  const child = fork(script, [], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    // The model is a few hundred megabytes of tensors; the default heap is not
    // generous enough on every machine.
    execArgv: ['--max-old-space-size=2048']
  })

  child.on('message', (message: any) => {
    if (message?.type === 'ready') {
      status = { state: 'ready', build: loadedBuild ?? 'q4', voices: message.voices ?? [] }
    } else if (message?.type === 'failed') {
      status = { state: 'failed', message: String(message.message ?? 'unknown') }
    } else if (message?.type === 'spoken') {
      const waiting = pending.get(message.id)
      if (!waiting) return
      pending.delete(message.id)
      if (message.error) waiting.reject(new Error(String(message.error)))
      else (waiting.resolve as (wav: Buffer) => void)(Buffer.from(String(message.wav), 'base64'))
    } else if (message?.type === 'transcribed') {
      const waiting = pending.get(message.id)
      if (!waiting) return
      pending.delete(message.id)
      if (message.error) waiting.reject(new Error(String(message.error)))
      else (waiting.resolve as (text: string) => void)(String(message.text ?? ''))
    }
  })

  child.on('exit', (code) => {
    worker = null
    loadedBuild = null
    // Anything still waiting will never be answered now.
    for (const [, waiting] of pending) waiting.reject(new Error('the voice worker stopped'))
    pending.clear()
    if (status.state !== 'failed') status = { state: 'idle' }
    if (code !== 0) status = { state: 'failed', message: `the voice worker exited with code ${code}` }
  })

  worker = child
  return child
}

/** Stops the worker, freeing the memory the model holds. */
export function shutdown(): void {
  worker?.kill()
  worker = null
  loadedBuild = null
  status = { state: 'idle' }
}

export function currentStatus(): Status {
  return status
}

/**
 * Where the model is kept.
 *
 * Under the launcher's own data directory, never the default. Transformers.js
 * caches inside `node_modules` unless told otherwise, and in a packaged build
 * that path is inside the read-only asar — so the default works perfectly in
 * development and fails on every installed copy, which is the worst shape a bug
 * can have.
 */
function cacheDir(): string {
  const dir = join(app.getPath('userData'), 'voice-models')
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Loads the model, downloading it the first time.
 *
 * Concurrent callers share one load rather than starting several: the launcher
 * companions and Minecraft can both ask on the same tick, and two simultaneous
 * downloads of the same few hundred megabytes would be a poor first impression.
 */
export async function ensureLoaded(build: BuildName = 'q4'): Promise<void> {
  if (status.state === 'ready' && loadedBuild === build) return
  if (loading && loadedBuild === build) return loading

  // A different build than the one loaded means a different model file.
  if (loadedBuild && loadedBuild !== build) shutdown()

  loadedBuild = build
  status = { state: 'loading', build }

  loading = new Promise<void>((resolve, reject) => {
    let child: ChildProcess
    try {
      child = startWorker()
    } catch (error) {
      status = { state: 'failed', message: error instanceof Error ? error.message : String(error) }
      reject(error)
      return
    }

    const done = (message: any): void => {
      if (message?.type === 'ready') {
        child.off('message', done)
        resolve()
      } else if (message?.type === 'failed') {
        child.off('message', done)
        reject(new Error(String(message.message ?? 'the voice model failed to load')))
      }
    }
    child.on('message', done)
    child.send({ type: 'load', cacheDir: cacheDir(), build })
  })

  try {
    await loading
  } finally {
    loading = null
  }
}

/**
 * One line, as WAV bytes.
 *
 * Returns the audio rather than playing it, because there is no audio output in
 * the main process at all — Electron's main process has no `Audio`. The bytes
 * go to whoever asked: the renderer plays them through a blob, and Minecraft
 * receives them over HTTP.
 */
export async function speak(
  text: string,
  voice: string = DEFAULT_VOICE,
  build: BuildName = 'q4'
): Promise<Buffer> {
  const line = text.trim()
  if (!line) throw new Error('nothing to say')

  await ensureLoaded(build)
  const child = worker
  if (!child) throw new Error('the voice model is not loaded')

  const known = status.state === 'ready' ? status.voices : []
  const chosen = known.includes(voice) ? voice : DEFAULT_VOICE

  const id = nextRequestId++
  return await new Promise<Buffer>((resolve, reject) => {
    pending.set(id, { resolve: resolve as never, reject })
    child.send({ type: 'speak', id, text: line, voice: chosen })

    // A wedged worker must not leave the caller waiting forever.
    setTimeout(() => {
      if (!pending.has(id)) return
      pending.delete(id)
      reject(new Error('the voice worker did not answer in time'))
    }, 60_000)
  })
}

/** Every voice the loaded model offers, or nothing if it is not loaded yet. */
export function voices(): string[] {
  return status.state === 'ready' ? status.voices : []
}


/**
 * What was said, from 16kHz mono floats.
 *
 * Runs in the same worker as the voice, for the same two reasons: the model
 * cache has to be a real directory rather than a path inside the asar, and the
 * JavaScript around the inference will stall the main process if it is called
 * there.
 *
 * Whisper is loaded on first use, not alongside the voice — most people never
 * speak to a companion, and the two models should not be downloaded together.
 */
export async function transcribe(samples: Float32Array, language?: string): Promise<string> {
  /*
   * The worker is started directly rather than through `ensureLoaded`, which
   * loads the *voice* model. Transcription needs the process, not the voice —
   * and pulling Kokoro in first would download a model nobody asked for.
   */
  const child = startWorker()
  const id = nextRequestId++

  return await new Promise<string>((resolve, reject) => {
    pending.set(id, { resolve: resolve as never, reject })
    child.send({
      type: 'transcribe',
      id,
      cacheDir: cacheDir(),
      // Sent as a plain array: a typed array does not survive process IPC.
      samples: Array.from(samples),
      language
    })

    // The first call downloads the model, so this is generous on purpose.
    setTimeout(() => {
      if (!pending.has(id)) return
      pending.delete(id)
      reject(new Error('the voice worker did not transcribe in time'))
    }, 300_000)
  })
}
