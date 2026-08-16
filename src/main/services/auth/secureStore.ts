import { safeStorage } from 'electron'
import { db } from '../../core/database'
import { createLogger } from '../../core/logger'

const log = createLogger('secure-store')
const PREFIX = 'secret:'

/**
 * Secret storage for OAuth tokens.
 *
 * Encryption is delegated to Electron's `safeStorage`, which on Windows uses
 * DPAPI keyed to the logged-in Windows user account. The ciphertext is what
 * lands in the database; the key never exists in our code or on disk, and
 * another Windows user copying the database cannot decrypt it.
 *
 * Nothing here is ever logged, returned over IPC, or included in error details.
 */

let warnedUnavailable = false

export function isEncryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

/**
 * When the OS refuses to provide encryption we deliberately do NOT fall back to
 * writing plaintext tokens. The user simply signs in each session instead.
 */
function guard(): boolean {
  if (isEncryptionAvailable()) return true
  if (!warnedUnavailable) {
    warnedUnavailable = true
    log.warn(
      'OS credential encryption is unavailable; refresh tokens will not be persisted and sign-in will be required each session'
    )
  }
  return false
}

export function setSecret(key: string, value: string): boolean {
  if (!guard()) return false
  try {
    const encrypted = safeStorage.encryptString(value)
    db().kvSet(PREFIX + key, encrypted.toString('base64'))
    return true
  } catch (err) {
    log.error(`failed to store secret "${key}"`, (err as Error).message)
    return false
  }
}

export function getSecret(key: string): string | null {
  if (!guard()) return null
  const stored = db().kvGet(PREFIX + key)
  if (!stored) return null
  try {
    return safeStorage.decryptString(Buffer.from(stored, 'base64'))
  } catch (err) {
    // Typically means the Windows profile changed or the DB was copied between
    // machines. The secret is unusable, so drop it and force a fresh sign-in.
    log.warn(`stored secret "${key}" could not be decrypted; discarding it`)
    db().kvRemove(PREFIX + key)
    return null
  }
}

export function removeSecret(key: string): void {
  db().kvRemove(PREFIX + key)
}

export const secretKeys = {
  msRefreshToken: (accountId: string) => `ms-refresh:${accountId}`,
  minecraftToken: (accountId: string) => `mc-token:${accountId}`
}
