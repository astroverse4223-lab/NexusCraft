import { request, getJson, fetchImageAsDataUrl } from '../../core/http'
import { LauncherError } from '../../core/errors'
import { createLogger } from '../../core/logger'
import type { Cape } from '@shared/types'

const log = createLogger('mc-auth')

const XBL_AUTH_URL = 'https://user.auth.xboxlive.com/user/authenticate'
const XSTS_AUTH_URL = 'https://xsts.auth.xboxlive.com/xsts/authorize'
const XBOX_PROFILE_URL = 'https://profile.xboxlive.com/users/me/profile/settings?settings=Gamertag,GameDisplayPicRaw'
const MC_LOGIN_URL = 'https://api.minecraftservices.com/authentication/login_with_xbox'
const MC_ENTITLEMENTS_URL = 'https://api.minecraftservices.com/entitlements/mcstore'
const MC_PROFILE_URL = 'https://api.minecraftservices.com/minecraft/profile'

export interface XboxAuth {
  token: string
  userHash: string
}

export interface MinecraftToken {
  accessToken: string
  expiresAt: number
}

export interface MinecraftProfile {
  id: string
  name: string
  skinUrl: string | null
  skinVariant: 'classic' | 'slim'
  capes: Cape[]
}

export interface XboxProfile {
  gamertag: string | null
  avatarUrl: string | null
  xuid: string | null
}

/* -------------------------------------------------------------- Xbox Live */

/**
 * Reads a failed response body for diagnostics. The body is embedded in the
 * error detail, where `LauncherError` redacts any tokens before it is stored or
 * logged — without this, a failure is just a bare status code.
 */
async function errorBody(response: Response): Promise<string> {
  try {
    const text = (await response.text()).trim()
    return text ? text.slice(0, 500) : '(empty body)'
  } catch {
    return '(body could not be read)'
  }
}

/** Exchanges the Microsoft access token for an Xbox Live user token. */
export async function authenticateWithXboxLive(msAccessToken: string): Promise<XboxAuth> {
  const response = await request(XBL_AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      Properties: {
        AuthMethod: 'RPS',
        SiteName: 'user.auth.xboxlive.com',
        // The `d=` prefix marks this as a Microsoft access token rather than a
        // legacy RPS ticket.
        RpsTicket: `d=${msAccessToken}`
      },
      RelyingParty: 'http://auth.xboxlive.com',
      TokenType: 'JWT'
    }),
    retries: 2
  })

  if (!response.ok) {
    throw new LauncherError(
      'AUTH_FAILED',
      `POST user.auth.xboxlive.com/user/authenticate -> HTTP ${response.status}: ${await errorBody(response)}`,
      {
        title: 'Xbox Live would not accept the sign-in',
        message:
          'Microsoft signed you in, but Xbox Live rejected the token. Minecraft: Java Edition authenticates through Xbox Live, so this step has to succeed. This is almost always the Azure app registration rather than your account.',
        actions: [
          'In Azure, confirm the app\'s "Supported account types" is "Personal Microsoft accounts only"',
          'Confirm "Allow public client flows" is enabled under Authentication',
          'If you have never used this Microsoft account with Xbox, sign in once at minecraft.net to create the Xbox profile',
          'Open Settings → About → logs folder for the exact response'
        ]
      }
    )
  }

  const data = (await response.json()) as {
    Token: string
    DisplayClaims?: { xui?: Array<{ uhs?: string }> }
  }
  const userHash = data.DisplayClaims?.xui?.[0]?.uhs
  if (!data.Token || !userHash) {
    throw new LauncherError('AUTH_FAILED', 'Xbox Live response was missing the user hash')
  }
  return { token: data.Token, userHash }
}

/** Authorises the Xbox token against a relying party (Minecraft or Xbox profile). */
export async function authorizeXsts(xblToken: string, relyingParty: string): Promise<XboxAuth> {
  const response = await request(XSTS_AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      Properties: { SandboxId: 'RETAIL', UserTokens: [xblToken] },
      RelyingParty: relyingParty,
      TokenType: 'JWT'
    }),
    retries: 2
  })

  if (response.status === 401) {
    // XSTS reports account-level problems through XErr codes. Translating them
    // is the difference between "sign-in failed" and an actionable message.
    const raw = await response.text().catch(() => '')
    let body: { XErr?: number } = {}
    try {
      body = JSON.parse(raw) as { XErr?: number }
    } catch {
      /* a non-JSON 401 falls through to the default case below */
    }
    switch (body.XErr) {
      case 2148916233:
        throw new LauncherError('XBOX_NO_ACCOUNT', `XErr ${body.XErr}`)
      case 2148916235:
        throw new LauncherError('XBOX_REGION_BLOCKED', `XErr ${body.XErr}`)
      case 2148916236:
      case 2148916237:
        throw new LauncherError('AUTH_FAILED', `XErr ${body.XErr}`, {
          title: 'Adult verification required',
          message: 'Xbox Live needs this account to complete adult verification before it can sign in.',
          actions: ['Sign in at account.xbox.com and complete the prompts', 'Then try again here']
        })
      case 2148916238:
        throw new LauncherError('XBOX_CHILD_ACCOUNT', `XErr ${body.XErr}`)
      default:
        throw new LauncherError(
          'AUTH_FAILED',
          `POST xsts.auth.xboxlive.com (${relyingParty}) -> HTTP 401 XErr ${body.XErr ?? 'none'}: ${raw.slice(0, 500) || '(empty body)'}`,
          {
            title: 'Xbox declined to authorise this account',
            message:
              'Xbox Live accepted the sign-in but refused to issue the token Minecraft needs. This usually means the Microsoft account has no Xbox profile yet, or Xbox is unavailable in its region.',
            actions: [
              'Sign in once at minecraft.net in a browser to create the Xbox profile',
              'Check the country set on the Microsoft account',
              'Open Settings → About → logs folder for the exact response'
            ]
          }
        )
    }
  }
  if (!response.ok) {
    throw new LauncherError(
      'AUTH_FAILED',
      `POST xsts.auth.xboxlive.com (${relyingParty}) -> HTTP ${response.status}: ${await errorBody(response)}`,
      {
        title: 'Xbox authorisation failed',
        message: 'Xbox Live returned an unexpected response while authorising this account for Minecraft.',
        actions: ['Try signing in again in a moment', 'Open Settings → About → logs folder for the exact response']
      }
    )
  }

  const data = (await response.json()) as {
    Token: string
    DisplayClaims?: { xui?: Array<{ uhs?: string; xid?: string }> }
  }
  const claim = data.DisplayClaims?.xui?.[0]
  if (!data.Token || !claim?.uhs) {
    throw new LauncherError('AUTH_FAILED', 'XSTS response was missing the user hash')
  }
  return { token: data.Token, userHash: claim.uhs }
}

/* -------------------------------------------------------------- Minecraft */

/** Trades the XSTS token for a Minecraft services bearer token. */
export async function loginWithXbox(xsts: XboxAuth): Promise<MinecraftToken> {
  const response = await request(MC_LOGIN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ identityToken: `XBL3.0 x=${xsts.userHash};${xsts.token}` }),
    retries: 2
  })

  // 403 here is specific and extremely common for self-hosted launchers: the
  // Azure application has not been approved by Mojang for the Minecraft API.
  // Everything up to this point succeeded, so a generic "sign-in failed" sends
  // people hunting through their Azure config for a problem that is not there.
  if (response.status === 403) {
    throw new LauncherError(
      'APP_NOT_APPROVED',
      `POST api.minecraftservices.com/authentication/login_with_xbox -> HTTP 403: ${await errorBody(response)}`
    )
  }

  if (!response.ok) {
    throw new LauncherError(
      'AUTH_FAILED',
      `POST api.minecraftservices.com/authentication/login_with_xbox -> HTTP ${response.status}: ${await errorBody(response)}`,
      {
        title: 'Minecraft services rejected the sign-in',
        message:
          'Xbox Live authorised the account, but Mojang\'s Minecraft service would not issue a session token. This is usually a temporary Mojang outage.',
        actions: [
          'Try again in a few minutes',
          'Check status.mojang.com for a reported outage',
          'Open Settings → About → logs folder for the exact response'
        ]
      }
    )
  }

  const data = (await response.json()) as { access_token: string; expires_in: number }
  if (!data.access_token) {
    throw new LauncherError('AUTH_FAILED', 'Minecraft services returned no access token')
  }
  return {
    accessToken: data.access_token,
    expiresAt: Date.now() + Math.max(0, (data.expires_in ?? 86400) - 120) * 1000
  }
}

export interface EntitlementResult {
  owns: boolean
  source: 'purchase' | 'game_pass' | 'unknown' | 'none'
}

/**
 * Asks Mojang whether this account actually has Minecraft: Java Edition. The
 * answer always comes from the live entitlement API — it is never assumed.
 */
export async function checkEntitlements(minecraftToken: string): Promise<EntitlementResult> {
  const response = await request(MC_ENTITLEMENTS_URL, {
    method: 'GET',
    headers: { Authorization: `Bearer ${minecraftToken}`, Accept: 'application/json' },
    retries: 2
  })

  if (response.status === 401) throw new LauncherError('TOKEN_EXPIRED', 'entitlement check rejected the token')
  if (!response.ok) throw new LauncherError('NETWORK_ERROR', `entitlement check returned HTTP ${response.status}`)

  const data = (await response.json()) as { items?: Array<{ name?: string }> }
  const names = (data.items ?? []).map((item) => item.name ?? '')

  const ownsGame = names.some((n) => n === 'product_minecraft' || n === 'game_minecraft')
  const gamePass = names.some((n) => n.includes('game_pass') || n === 'product_game_pass_ultimate' || n === 'product_game_pass_pc')

  if (ownsGame) return { owns: true, source: 'purchase' }
  if (gamePass) return { owns: true, source: 'game_pass' }
  // An empty item list is Mojang's answer for "this account has no access".
  return { owns: names.length > 0, source: names.length > 0 ? 'unknown' : 'none' }
}

/**
 * Fetches the Minecraft profile. A 404 here is meaningful: the account has the
 * game but has never picked a username.
 */
export async function fetchMinecraftProfile(minecraftToken: string): Promise<MinecraftProfile> {
  const response = await request(MC_PROFILE_URL, {
    method: 'GET',
    headers: { Authorization: `Bearer ${minecraftToken}`, Accept: 'application/json' },
    retries: 2
  })

  if (response.status === 404) throw new LauncherError('NO_MINECRAFT_PROFILE', 'profile endpoint returned 404')
  if (response.status === 401) throw new LauncherError('TOKEN_EXPIRED', 'profile request rejected the token')
  if (!response.ok) throw new LauncherError('NETWORK_ERROR', `profile request returned HTTP ${response.status}`)

  const data = (await response.json()) as {
    id: string
    name: string
    skins?: Array<{ id: string; state: string; url: string; variant?: string }>
    capes?: Array<{ id: string; state: string; url: string; alias?: string }>
  }

  const activeSkin = data.skins?.find((s) => s.state === 'ACTIVE') ?? data.skins?.[0]
  const capes: Cape[] = []
  for (const cape of data.capes ?? []) {
    capes.push({
      id: cape.id,
      name: cape.alias ?? 'Cape',
      state: cape.state === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE',
      imageDataUrl: await fetchImageAsDataUrl(cape.url)
    })
  }

  return {
    id: data.id,
    name: data.name,
    skinUrl: activeSkin?.url ?? null,
    skinVariant: activeSkin?.variant?.toUpperCase() === 'SLIM' ? 'slim' : 'classic',
    capes
  }
}

/* ----------------------------------------------------------- Xbox profile */

/**
 * Gamertag and avatar come from the Xbox profile service, which needs its own
 * XSTS token for the `http://xboxlive.com` relying party.
 */
export async function fetchXboxProfile(xblToken: string): Promise<XboxProfile> {
  try {
    const xsts = await authorizeXsts(xblToken, 'http://xboxlive.com')
    const data = await getJson<{
      profileUsers?: Array<{ id?: string; settings?: Array<{ id: string; value: string }> }>
    }>(XBOX_PROFILE_URL, {
      headers: {
        Authorization: `XBL3.0 x=${xsts.userHash};${xsts.token}`,
        'x-xbl-contract-version': '3',
        Accept: 'application/json'
      },
      retries: 1
    })

    const user = data.profileUsers?.[0]
    const settings = new Map((user?.settings ?? []).map((s) => [s.id, s.value]))
    return {
      gamertag: settings.get('Gamertag') ?? null,
      avatarUrl: settings.get('GameDisplayPicRaw') ?? null,
      xuid: user?.id ?? null
    }
  } catch (err) {
    // The gamertag is a nice-to-have. Losing it must never block a sign-in that
    // Minecraft itself accepted.
    log.warn('could not read the Xbox profile:', (err as Error).message)
    return { gamertag: null, avatarUrl: null, xuid: null }
  }
}

/** Full chain: Microsoft access token -> everything the launcher needs. */
export interface FullAuthResult {
  minecraft: MinecraftToken
  profile: MinecraftProfile
  xbox: XboxProfile
  entitlement: EntitlementResult
  xuid: string | null
}

export async function completeMinecraftAuth(
  msAccessToken: string,
  onStage: (stage: 'xbox-live' | 'xsts' | 'minecraft' | 'entitlements' | 'profile', message: string) => void
): Promise<FullAuthResult> {
  onStage('xbox-live', 'Signing in to Xbox Live')
  const xbl = await authenticateWithXboxLive(msAccessToken)

  onStage('xsts', 'Authorising with Xbox')
  const xsts = await authorizeXsts(xbl.token, 'rp://api.minecraftservices.com/')

  onStage('minecraft', 'Signing in to Minecraft services')
  const minecraft = await loginWithXbox(xsts)

  onStage('entitlements', 'Checking your Minecraft licence')
  const entitlement = await checkEntitlements(minecraft.accessToken)
  if (!entitlement.owns) {
    throw new LauncherError('NO_MINECRAFT_ENTITLEMENT', 'entitlement API reported no Java Edition access')
  }

  onStage('profile', 'Loading your profile')
  const profile = await fetchMinecraftProfile(minecraft.accessToken)
  const xbox = await fetchXboxProfile(xbl.token)

  return { minecraft, profile, xbox, entitlement, xuid: xbox.xuid }
}
