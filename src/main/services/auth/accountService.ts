import type { Account, AuthStage, DeviceCodePrompt } from '@shared/types'
import { db, Collections } from '../../core/database'
import { emit } from '../../core/events'
import { LauncherError } from '../../core/errors'
import { createLogger } from '../../core/logger'
import { fetchImageAsDataUrl } from '../../core/http'
import { getSettings } from '../settings/settingsService'
import { getSecret, setSecret, removeSecret, secretKeys, isEncryptionAvailable } from './secureStore'
import { deviceCodeFlow, refreshTokens, startBrowserRedirectFlow, type MsTokens } from './microsoftOAuth'
import { completeMinecraftAuth } from './minecraftAuth'

const log = createLogger('accounts')

/**
 * Minecraft access tokens are held in memory only for the life of the process.
 * Only the long-lived Microsoft refresh token is persisted, and only through
 * the OS-encrypted secure store.
 */
const liveTokens = new Map<string, { accessToken: string; expiresAt: number }>()

let currentFlow: AbortController | null = null
/** The sign-in currently in progress, if any. */
let inFlight: Promise<Account> | null = null
/** The last device code issued, replayed when a second sign-in is requested. */
let lastPrompt: DeviceCodePrompt | null = null

function progress(stage: AuthStage, message: string): void {
  emit('auth:progress', { stage, message })
}

export function listAccounts(): Account[] {
  return db()
    .all<Account>(Collections.accounts)
    .sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.addedAt - b.addedAt)
}

export function getActiveAccount(): Account | null {
  return listAccounts().find((a) => a.isActive) ?? null
}

function broadcastAccounts(): void {
  emit('auth:accounts-changed', listAccounts())
}

function saveAccount(account: Account): void {
  db().put(Collections.accounts, account.id, account)
}

/* -------------------------------------------------------------- sign in */

export async function beginSignIn(): Promise<Account> {
  // Clicking sign in again — or from a second screen — must not tear down the
  // flow already running. Re-show the outstanding code and join that flow
  // instead, otherwise the aborted one surfaces as a spurious error.
  if (inFlight) {
    if (lastPrompt && lastPrompt.expiresAt > Date.now()) {
      emit('auth:device-code', lastPrompt)
      progress('polling', 'Waiting for you to finish signing in')
    }
    return inFlight
  }

  const settings = getSettings()
  if (!settings.clientId) {
    progress('error', 'Microsoft sign-in is not configured')
    throw new LauncherError('AUTH_NOT_CONFIGURED', 'client id is empty')
  }

  const controller = new AbortController()
  currentFlow = controller

  const run = (async (): Promise<Account> => {
    try {
      progress('awaiting-user', 'Waiting for you to approve the sign-in')

      let tokens: MsTokens
      if (settings.authFlow === 'browser-redirect') {
        tokens = await startBrowserRedirectFlow(settings.clientId, controller.signal)
      } else {
        tokens = await deviceCodeFlow(
          settings.clientId,
          (prompt: DeviceCodePrompt) => {
            lastPrompt = prompt
            emit('auth:device-code', prompt)
            progress('polling', 'Waiting for you to finish signing in')
          },
          controller.signal
        )
      }

      const account = await finalise(tokens)
      progress('done', `Signed in as ${account.username}`)
      return account
    } catch (err) {
      const cancelled = err instanceof LauncherError && (err.code === 'CANCELLED' || err.code === 'AUTH_DECLINED')
      progress(cancelled ? 'idle' : 'error', cancelled ? '' : err instanceof LauncherError ? err.message : 'Sign-in failed')
      throw err
    } finally {
      if (currentFlow === controller) currentFlow = null
      lastPrompt = null
    }
  })()

  inFlight = run
  try {
    return await run
  } finally {
    if (inFlight === run) inFlight = null
  }
}

export function cancelSignIn(): void {
  currentFlow?.abort()
  currentFlow = null
  inFlight = null
  lastPrompt = null
  progress('idle', 'Sign-in cancelled')
}

/** Runs the Xbox/Minecraft chain and persists the resulting account. */
async function finalise(tokens: MsTokens): Promise<Account> {
  const result = await completeMinecraftAuth(tokens.accessToken, (stage, message) => progress(stage, message))

  const existing = db().get<Account>(Collections.accounts, result.profile.id)
  const skinDataUrl = result.profile.skinUrl ? await fetchImageAsDataUrl(result.profile.skinUrl) : null
  const avatarDataUrl = result.xbox.avatarUrl ? await fetchImageAsDataUrl(result.xbox.avatarUrl) : null

  const account: Account = {
    id: result.profile.id,
    username: result.profile.name,
    gamertag: result.xbox.gamertag,
    xuid: result.xuid,
    ownsMinecraft: result.entitlement.owns,
    entitlementSource: result.entitlement.source,
    avatarDataUrl,
    skinDataUrl,
    skinVariant: result.profile.skinVariant,
    capes: result.profile.capes,
    expiresAt: result.minecraft.expiresAt,
    isActive: true,
    addedAt: existing?.addedAt ?? Date.now()
  }

  // Only one account is active at a time.
  for (const other of listAccounts()) {
    if (other.id !== account.id && other.isActive) saveAccount({ ...other, isActive: false })
  }
  saveAccount(account)

  liveTokens.set(account.id, { accessToken: result.minecraft.accessToken, expiresAt: result.minecraft.expiresAt })
  if (tokens.refreshToken) {
    const stored = setSecret(secretKeys.msRefreshToken(account.id), tokens.refreshToken)
    if (!stored) {
      log.warn('refresh token was not persisted; this account will need to sign in again next session')
    }
  }

  log.info(`signed in as ${account.username} (entitlement: ${account.entitlementSource})`)
  broadcastAccounts()
  return account
}

/* ------------------------------------------------------------- refreshing */

/**
 * Returns a valid Minecraft access token for the account, renewing it silently
 * through the stored refresh token when needed. Throws TOKEN_EXPIRED when the
 * user must sign in interactively again.
 *
 * The returned token is for main-process use only and must never be sent to the
 * renderer or written to a log.
 */
export async function getValidMinecraftToken(accountId: string): Promise<string> {
  const cached = liveTokens.get(accountId)
  if (cached && cached.expiresAt > Date.now()) return cached.accessToken

  const refreshToken = getSecret(secretKeys.msRefreshToken(accountId))
  if (!refreshToken) {
    throw new LauncherError(
      'TOKEN_EXPIRED',
      isEncryptionAvailable() ? 'no stored refresh token' : 'secure storage unavailable on this system'
    )
  }

  const settings = getSettings()
  log.info(`renewing session for account ${accountId.slice(0, 8)}…`)

  let tokens: MsTokens
  try {
    tokens = await refreshTokens(settings.clientId, refreshToken)
  } catch (err) {
    // A rejected refresh token is dead — remove it so we stop retrying.
    if (err instanceof LauncherError && err.code === 'TOKEN_EXPIRED') {
      removeSecret(secretKeys.msRefreshToken(accountId))
    }
    throw err
  }

  const result = await completeMinecraftAuth(tokens.accessToken, () => undefined)
  if (tokens.refreshToken) setSecret(secretKeys.msRefreshToken(accountId), tokens.refreshToken)
  liveTokens.set(accountId, { accessToken: result.minecraft.accessToken, expiresAt: result.minecraft.expiresAt })

  // Refresh the cached display data at the same time — skins and gamertags change.
  const existing = db().get<Account>(Collections.accounts, accountId)
  if (existing) {
    saveAccount({
      ...existing,
      username: result.profile.name,
      gamertag: result.xbox.gamertag ?? existing.gamertag,
      xuid: result.xuid ?? existing.xuid,
      ownsMinecraft: result.entitlement.owns,
      entitlementSource: result.entitlement.source,
      skinDataUrl: result.profile.skinUrl ? await fetchImageAsDataUrl(result.profile.skinUrl) : existing.skinDataUrl,
      skinVariant: result.profile.skinVariant,
      capes: result.profile.capes,
      expiresAt: result.minecraft.expiresAt
    })
    broadcastAccounts()
  }

  return result.minecraft.accessToken
}

/** Refreshes an account's displayed details on demand. */
export async function refreshAccount(accountId: string): Promise<Account> {
  await getValidMinecraftToken(accountId)
  const account = db().get<Account>(Collections.accounts, accountId)
  if (!account) throw new LauncherError('NOT_FOUND', 'account no longer exists')
  return account
}

/* ------------------------------------------------------- switch / sign out */

export function setActiveAccount(accountId: string): Account {
  const target = db().get<Account>(Collections.accounts, accountId)
  if (!target) throw new LauncherError('NOT_FOUND', 'account no longer exists')

  for (const account of listAccounts()) {
    const shouldBeActive = account.id === accountId
    if (account.isActive !== shouldBeActive) saveAccount({ ...account, isActive: shouldBeActive })
  }
  broadcastAccounts()
  return { ...target, isActive: true }
}

export function logout(accountId: string): void {
  const wasActive = db().get<Account>(Collections.accounts, accountId)?.isActive ?? false

  // Remove the persisted secret first: if anything below fails we must not be
  // left holding a token for an account the user believes is signed out.
  removeSecret(secretKeys.msRefreshToken(accountId))
  removeSecret(secretKeys.minecraftToken(accountId))
  liveTokens.delete(accountId)
  db().remove(Collections.accounts, accountId)

  // Promote another account so the launcher is not left with none selected.
  if (wasActive) {
    const remaining = listAccounts()
    if (remaining.length > 0) saveAccount({ ...remaining[0], isActive: true })
  }

  log.info(`signed out account ${accountId.slice(0, 8)}…`)
  broadcastAccounts()
}

/**
 * Called at startup: tries to restore a working session without user
 * interaction. Failure here is normal (expired token) and is not an error.
 */
export async function restoreSession(): Promise<void> {
  const active = getActiveAccount()
  if (!active) return
  try {
    await getValidMinecraftToken(active.id)
    log.info('restored the previous session')
  } catch (err) {
    log.info('could not restore the previous session:', (err as Error).message)
  }
}

/** True when the account has a usable in-memory token right now. */
export function hasLiveToken(accountId: string): boolean {
  const token = liveTokens.get(accountId)
  return !!token && token.expiresAt > Date.now()
}
