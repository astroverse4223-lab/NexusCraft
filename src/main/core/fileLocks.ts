import { unlink, rename, open as openFile } from 'node:fs/promises'
import type { WriteStream } from 'node:fs'

/*
 * On Windows a file that is deleted while another process still holds a handle
 * is not removed — it is marked "delete pending". The name stays in the
 * directory, and every open of that path fails with ERROR_ACCESS_DENIED, which
 * Node reports as EPERM, until the other handle closes. Real-time antivirus
 * opens each file the moment it is written, so a failed download whose temp
 * file is still being scanned will block its own retry.
 *
 * These helpers wait the scanner out instead of surfacing a locking artefact
 * as a download failure. The backoff runs to roughly four seconds in total,
 * which comfortably outlasts a scan of a file the size of a client jar.
 */

const LOCK_CODES = new Set(['EPERM', 'EBUSY', 'EACCES'])
const LOCK_ATTEMPTS = 7

export function isLockError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | undefined)?.code
  return code != null && LOCK_CODES.has(code)
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** Deletes a file, tolerating a scanner that has not let go of it yet. */
export async function removeFile(path: string): Promise<void> {
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt++) {
    try {
      await unlink(path)
      return
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
      if (!isLockError(err) || attempt === LOCK_ATTEMPTS - 1) return
      await delay(40 * 2 ** attempt)
    }
  }
}

/**
 * Opens the temp file for writing, retrying while a previous attempt's file is
 * still delete pending. Uses fs/promises so the failure is awaitable — a
 * `createWriteStream` open error only arrives later as an event, by which
 * point it is indistinguishable from a genuine write failure.
 */
export async function openForWrite(path: string): Promise<WriteStream> {
  let last: unknown
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt++) {
    try {
      const handle = await openFile(path, 'w')
      return handle.createWriteStream({ autoClose: true })
    } catch (err) {
      last = err
      if (!isLockError(err)) throw err
      await delay(40 * 2 ** attempt)
    }
  }
  throw last
}

/** Moves the verified temp file into place, waiting out a lock on either end. */
export async function renameWhenFree(from: string, to: string): Promise<void> {
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt++) {
    try {
      await rename(from, to)
      return
    } catch (err) {
      if (!isLockError(err) || attempt === LOCK_ATTEMPTS - 1) throw err
      await delay(40 * 2 ** attempt)
    }
  }
}
