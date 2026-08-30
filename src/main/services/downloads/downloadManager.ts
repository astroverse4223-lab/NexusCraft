import { createHash } from 'node:crypto'
import { mkdir, stat, chmod } from 'node:fs/promises'
import { dirname, basename } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { randomUUID } from 'node:crypto'
import type { DownloadError, DownloadPhase, DownloadProgress } from '@shared/types'
import { request, safeUrl } from '../../core/http'
import { LauncherError } from '../../core/errors'
import { createLogger } from '../../core/logger'
import { emit } from '../../core/events'
import { notifyDesktop } from '../../core/notifications'
import { openForWrite, removeFile, renameWhenFree } from '../../core/fileLocks'

const log = createLogger('downloads')

export interface DownloadItem {
  url: string
  destination: string
  /** Expected SHA-1. When present the file is verified after writing. */
  sha1?: string | null
  /** Expected size in bytes, used for progress totals and quick verification. */
  size?: number | null
  /** Mark the written file executable (used for downloaded Java runtimes). */
  executable?: boolean
  /** Friendly name shown in the UI. Defaults to the file name. */
  label?: string
}

export interface TaskOptions {
  instanceId?: string | null
  phase?: DownloadPhase
  label?: string
  concurrency?: number
  /**
   * 'quick' trusts an existing file when its size matches (fast path for the
   * thousands of tiny asset objects). 'full' re-hashes everything — used by
   * "Repair instance".
   */
  verifyMode?: 'quick' | 'full'
}

const MAX_ATTEMPTS = 4

/** One install job: a set of files downloaded together with shared progress. */
export class DownloadTask {
  readonly id = randomUUID()
  readonly instanceId: string | null

  private items: DownloadItem[] = []
  private queue: DownloadItem[] = []
  private failed: Array<{ item: DownloadItem; error: DownloadError }> = []
  private concurrency: number
  private verifyMode: 'quick' | 'full'

  private phase: DownloadPhase = 'idle'
  private label = ''
  private currentFile = ''
  private completedFiles = 0
  private totalFiles = 0
  private downloadedBytes = 0
  private totalBytes = 0

  private pausedFlag = false
  private pauseGate: Promise<void> = Promise.resolve()
  private releasePause: (() => void) | null = null
  private abort = new AbortController()
  private finished = false
  private active = false

  // Speed sampling
  private lastSampleAt = Date.now()
  private lastSampleBytes = 0
  private speedBps = 0
  private lastEmitAt = 0

  constructor(opts: TaskOptions = {}) {
    this.instanceId = opts.instanceId ?? null
    this.concurrency = Math.max(1, Math.min(opts.concurrency ?? 8, 24))
    this.verifyMode = opts.verifyMode ?? 'quick'
    this.phase = opts.phase ?? 'idle'
    this.label = opts.label ?? ''
  }

  setPhase(phase: DownloadPhase, label: string): void {
    this.phase = phase
    this.label = label
    this.emitProgress(true)
  }

  setVerifyMode(mode: 'quick' | 'full'): void {
    this.verifyMode = mode
  }

  /** Adds files to this task. Safe to call between phases. */
  add(items: DownloadItem[]): void {
    this.items.push(...items)
    this.queue.push(...items)
    this.totalFiles += items.length
    for (const item of items) this.totalBytes += item.size ?? 0
    this.emitProgress()
  }

  get pendingCount(): number {
    return this.queue.length
  }

  pause(): void {
    if (this.pausedFlag || this.finished) return
    this.pausedFlag = true
    this.pauseGate = new Promise((resolve) => {
      this.releasePause = resolve
    })
    this.emitProgress(true)
  }

  resume(): void {
    if (!this.pausedFlag) return
    this.pausedFlag = false
    this.releasePause?.()
    this.releasePause = null
    this.pauseGate = Promise.resolve()
    this.emitProgress(true)
  }

  cancel(): void {
    if (this.finished) return
    this.resume() // release any parked workers so they observe the abort
    this.abort.abort()
    this.phase = 'cancelled'
    this.emitProgress(true)
  }

  get cancelled(): boolean {
    return this.abort.signal.aborted
  }

  /** Re-queues only the files that failed, keeping completed work. */
  retryFailed(): void {
    if (this.failed.length === 0) return
    const retryable = this.failed.map((f) => f.item)
    this.failed = []
    // A cancelled task needs a fresh abort controller before it can run again.
    if (this.abort.signal.aborted) this.abort = new AbortController()
    this.queue.push(...retryable)
    this.finished = false
    this.emitProgress(true)
  }

  /** Runs everything currently queued. Resolves when the queue drains. */
  async run(): Promise<void> {
    if (this.queue.length === 0) {
      this.emitProgress(true)
      return
    }
    this.active = true
    const workerCount = Math.min(this.concurrency, this.queue.length)
    const workers = Array.from({ length: workerCount }, () => this.worker())
    try {
      await Promise.all(workers)
    } finally {
      this.active = false
    }

    if (this.cancelled) {
      this.phase = 'cancelled'
      this.emitProgress(true)
      return
    }
    if (this.failed.length > 0) {
      this.phase = 'error'
      this.emitProgress(true)
      throw new LauncherError(
        this.failed.some((f) => f.error.message.includes('checksum')) ? 'CHECKSUM_MISMATCH' : 'DOWNLOAD_FAILED',
        this.failed.map((f) => `${f.item.destination}: ${f.error.message}`).join('\n').slice(0, 1500)
      )
    }
    this.emitProgress(true)
  }

  private async worker(): Promise<void> {
    for (;;) {
      if (this.cancelled) return
      if (this.pausedFlag) await this.pauseGate
      const item = this.queue.shift()
      if (!item) return

      let lastMessage = 'unknown error'
      let succeeded = false
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        if (this.cancelled) return
        try {
          await this.fetchOne(item)
          succeeded = true
          break
        } catch (err) {
          if (this.cancelled) return
          lastMessage = (err as Error).message
          if (attempt < MAX_ATTEMPTS) {
            const wait = 400 * 2 ** (attempt - 1)
            log.warn(`retry ${attempt}/${MAX_ATTEMPTS} for ${safeUrl(item.url)}: ${lastMessage}`)
            await new Promise((r) => setTimeout(r, wait))
          }
        }
      }

      this.completedFiles++
      if (!succeeded) {
        this.failed.push({
          item,
          error: { file: basename(item.destination), message: lastMessage, attempts: MAX_ATTEMPTS }
        })
        log.error(`giving up on ${safeUrl(item.url)}: ${lastMessage}`)
      }
      this.emitProgress()
    }
  }

  private async fetchOne(item: DownloadItem): Promise<void> {
    this.currentFile = item.label ?? basename(item.destination)

    if (await this.alreadyValid(item)) {
      // Count skipped bytes so the bar reflects real completion, not just work done.
      if (item.size) this.downloadedBytes += item.size
      return
    }

    await mkdir(dirname(item.destination), { recursive: true })

    const response = await request(item.url, { signal: this.abort.signal, retries: 0, timeoutMs: 60_000 })
    if (!response.ok || !response.body) {
      throw new Error(`HTTP ${response.status} for ${safeUrl(item.url)}`)
    }

    // Write to a temp file first so an interrupted download never leaves a
    // half-written file that later looks valid by size.
    const tempPath = `${item.destination}.part`
    let written = 0

    const source = Readable.fromWeb(response.body as never)

    /*
     * Progress is measured by a Transform inside the pipeline rather than a
     * `source.on('data')` listener. Attaching a data listener switches the
     * stream into flowing mode before `pipeline()` attaches its own consumer,
     * which lets the bytes that get counted diverge from the bytes that get
     * written. Counting in-line makes the two the same stream of chunks.
     */
    const meter = new Transform({
      transform: (chunk: Buffer, _encoding, callback) => {
        written += chunk.length
        this.downloadedBytes += chunk.length
        this.sampleSpeed()
        this.emitProgress()
        callback(null, chunk)
      }
    })

    try {
      await pipeline(source, meter, await openForWrite(tempPath), { signal: this.abort.signal })
    } catch (err) {
      await removeFile(tempPath)
      // Roll the progress counter back so a retry does not double count.
      this.downloadedBytes -= written
      throw err
    }

    /*
     * Verify what actually landed on disk, not what went past in flight.
     * Hashing the stream proves only that the right bytes were received — it
     * says nothing about what the write stream committed, so a file damaged
     * on the way to disk would pass and be trusted forever after.
     */
    try {
      const info = await stat(tempPath)

      /*
       * The hash decides. The size is only consulted when there is no hash.
       *
       * Modpack manifests state file sizes that are quietly wrong by a byte or
       * two — a real pack failed to install because four of its mods were
       * declared as 122777, 1286460, 29962 and 215534 bytes when the files
       * served were 122778, 1286462, 29961 and 215533. Every one had a matching
       * checksum and was perfectly good, and every one was deleted for
       * disagreeing with a number the pack author never checked.
       *
       * A cryptographic digest proves the bytes are right; a size field is a
       * hint someone typed. Where both exist, only one of them is evidence.
       */
      if (item.sha1) {
        const digest = await sha1OfFile(tempPath)
        if (digest.toLowerCase() !== item.sha1.toLowerCase()) {
          throw new Error(`checksum mismatch for ${basename(item.destination)}`)
        }
      } else if (item.size != null && info.size !== item.size) {
        /*
         * No hash, so the size is all there is — but it is allowed the same
         * small inaccuracy seen in the wild, since rejecting a good file is
         * worse than accepting one a couple of bytes off with nothing better to
         * judge it by.
         */
        const drift = Math.abs(info.size - item.size)
        const allowed = Math.max(16, Math.floor(item.size * 0.001))
        if (drift > allowed) {
          throw new Error(
            `size mismatch for ${basename(item.destination)}: expected ${item.size} bytes, wrote ${info.size}`
          )
        }
      }
    } catch (err) {
      await removeFile(tempPath)
      this.downloadedBytes -= written
      throw err
    }

    await removeFile(item.destination)
    await renameWhenFree(tempPath, item.destination)
    if (item.executable) await chmod(item.destination, 0o755).catch(() => undefined)
  }

  private async alreadyValid(item: DownloadItem): Promise<boolean> {
    try {
      const info = await stat(item.destination)
      if (!info.isFile() || info.size === 0) return false

      if (this.verifyMode === 'full' && item.sha1) {
        return (await sha1OfFile(item.destination)) === item.sha1.toLowerCase()
      }
      // Same reasoning as above: a size within a whisker of the stated one is
      // not evidence of damage, and re-downloading it will not change anything.
      if (item.size != null) {
        const drift = Math.abs(info.size - item.size)
        return drift <= Math.max(16, Math.floor(item.size * 0.001))
      }
      // No size to compare against: only a hash can tell us, so re-download.
      return item.sha1 ? (await sha1OfFile(item.destination)) === item.sha1.toLowerCase() : true
    } catch {
      return false
    }
  }

  private sampleSpeed(): void {
    const now = Date.now()
    const elapsed = now - this.lastSampleAt
    if (elapsed < 500) return
    const instant = ((this.downloadedBytes - this.lastSampleBytes) * 1000) / elapsed
    // Exponential moving average keeps the readout stable on bursty connections.
    this.speedBps = this.speedBps === 0 ? instant : this.speedBps * 0.7 + instant * 0.3
    this.lastSampleAt = now
    this.lastSampleBytes = this.downloadedBytes
  }

  snapshot(): DownloadProgress {
    const remaining = Math.max(0, this.totalBytes - this.downloadedBytes)
    return {
      taskId: this.id,
      instanceId: this.instanceId,
      phase: this.phase,
      label: this.label,
      currentFile: this.currentFile,
      completedFiles: this.completedFiles,
      totalFiles: this.totalFiles,
      downloadedBytes: this.downloadedBytes,
      totalBytes: this.totalBytes,
      speedBps: Math.max(0, Math.round(this.speedBps)),
      etaSeconds: this.speedBps > 1024 && remaining > 0 ? Math.round(remaining / this.speedBps) : null,
      paused: this.pausedFlag,
      errors: this.failed.map((f) => f.error),
      active: this.active
    }
  }

  /** Throttled so a burst of chunk events cannot flood the renderer. */
  private emitProgress(force = false): void {
    const now = Date.now()
    if (!force && now - this.lastEmitAt < 200) return
    this.lastEmitAt = now
    emit('download:progress', this.snapshot())
  }

  markDone(): void {
    this.finished = true
    this.phase = this.failed.length ? 'error' : 'done'
    this.emitProgress(true)

    // A job big enough that the user plausibly tabbed away while it ran. The
    // helper stays silent when the launcher window is focused, so this never
    // duplicates an in-app toast the user is already reading.
    if (this.totalFiles >= 25 || this.totalBytes >= 64 * 1024 * 1024) {
      notifyDesktop(
        this.failed.length
          ? { title: 'Download finished with problems', body: `${this.label || 'A download'} had ${this.failed.length} failed file${this.failed.length === 1 ? '' : 's'}.` }
          : { title: 'Download complete', body: `${this.label || 'Your download'} is ready.` }
      )
    }
  }
}

export async function sha1OfFile(file: string): Promise<string> {
  const { createReadStream } = await import('node:fs')
  return await new Promise((resolve, reject) => {
    const hash = createHash('sha1')
    const stream = createReadStream(file)
    stream.on('error', reject)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

/* ------------------------------------------------------------- task registry */

const tasks = new Map<string, DownloadTask>()

export function createTask(opts: TaskOptions = {}): DownloadTask {
  const task = new DownloadTask(opts)
  tasks.set(task.id, task)
  // Keep the registry small: a completed task is only kept for late UI reads.
  if (tasks.size > 12) {
    const oldest = [...tasks.keys()][0]
    if (oldest && oldest !== task.id) tasks.delete(oldest)
  }
  return task
}

export function getTask(id: string): DownloadTask | undefined {
  return tasks.get(id)
}

export function activeTasks(): DownloadProgress[] {
  return [...tasks.values()].map((t) => t.snapshot()).filter((s) => s.active || s.phase === 'error' || s.paused)
}

export function cancelAll(): void {
  for (const task of tasks.values()) task.cancel()
}
