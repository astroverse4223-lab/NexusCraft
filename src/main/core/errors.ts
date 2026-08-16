import type { LauncherErrorCode, LauncherErrorPayload } from '@shared/types'
import { redact } from './logger'

interface Template {
  title: string
  message: string
  actions: string[]
}

/**
 * Every failure the user can hit is described here in plain language. The
 * renderer shows these; raw stack traces are only ever written to the log file.
 */
const CATALOGUE: Record<LauncherErrorCode, Template> = {
  // Not a failure: something was superseded or deliberately stopped. The UI
  // treats this code as "say nothing" rather than showing an error.
  CANCELLED: {
    title: 'Cancelled',
    message: 'That operation was stopped before it finished.',
    actions: []
  },
  AUTH_NOT_CONFIGURED: {
    title: 'Microsoft sign-in is not configured',
    message:
      'This build of NexusCraft has no Azure application (client) ID, so it cannot talk to Microsoft sign-in. A client ID identifies the launcher to Microsoft; it is not a password and is not secret.',
    actions: [
      'Open Settings → Account and paste your Azure application (client) ID',
      'See the README section "Configuring Microsoft authentication" to create one for free',
      'Restart the sign-in once the ID is saved'
    ]
  },
  APP_NOT_APPROVED: {
    title: 'This Azure app is not approved for Minecraft yet',
    message:
      'You signed in successfully and Xbox Live authorised the account — but Mojang refused the final step with HTTP 403. Since 2022, Mojang requires every Azure application to be individually approved before it may use the Minecraft services API. Approval is free, and this is a one-time step for the application, not for your account.',
    actions: [
      'Apply for approval at https://aka.ms/mce-reviewappid using your Azure application (client) ID',
      'Approval is granted by Mojang and can take several days',
      'Nothing else needs changing — sign-in will work once the app is approved',
      'See "Getting your app approved by Mojang" in the README'
    ]
  },
  AUTH_DECLINED: {
    title: 'Sign-in was cancelled',
    message: 'The sign-in was closed or declined before Microsoft could confirm your account.',
    actions: ['Press "Sign in with Microsoft" to try again']
  },
  AUTH_TIMEOUT: {
    title: 'Sign-in timed out',
    message:
      'The code shown expired before it was entered. Microsoft sign-in codes are only valid for a few minutes.',
    actions: ['Start the sign-in again', 'Have the browser window ready before you begin']
  },
  AUTH_FAILED: {
    title: 'Microsoft sign-in failed',
    message: 'Microsoft rejected the sign-in attempt.',
    actions: [
      'Check that you are signing in with the account that owns Minecraft',
      'Confirm your Azure app has "Allow public client flows" enabled',
      'Try again in a moment'
    ]
  },
  XBOX_NO_ACCOUNT: {
    title: 'No Xbox profile on this account',
    message:
      'This Microsoft account has no Xbox Live profile. Minecraft: Java Edition sign-in goes through Xbox Live, so one is required.',
    actions: [
      'Sign in at minecraft.net once in a browser to create the Xbox profile',
      'Then return here and sign in again'
    ]
  },
  XBOX_CHILD_ACCOUNT: {
    title: 'This account needs to join a family',
    message:
      'Xbox Live reports this as a child account that is not part of a family group. Microsoft blocks sign-in until an adult adds it to a Microsoft family.',
    actions: ['Add the account to a Microsoft family group at account.microsoft.com/family', 'Sign in again afterwards']
  },
  XBOX_REGION_BLOCKED: {
    title: 'Xbox Live is unavailable in this region',
    message: 'Xbox Live is not available for the country set on this Microsoft account.',
    actions: ['Check the country/region on your Microsoft account', 'Contact Xbox support if it looks correct']
  },
  NO_MINECRAFT_ENTITLEMENT: {
    title: 'No Minecraft: Java Edition on this account',
    message:
      'Sign-in worked, but this Microsoft account does not own or have access to Minecraft: Java Edition. NexusCraft only launches the game for accounts that own it.',
    actions: [
      'Check you signed in with the right Microsoft account',
      'If you own the game on a different account, switch accounts',
      'If you have Game Pass, launch Minecraft once from the official launcher to activate it'
    ]
  },
  NO_MINECRAFT_PROFILE: {
    title: 'Minecraft profile not set up',
    message:
      'This account has access to Minecraft: Java Edition but has not chosen a username yet, so there is no profile to play with.',
    actions: ['Set your username at minecraft.net/profile', 'Then sign in again here']
  },
  TOKEN_EXPIRED: {
    title: 'Your session expired',
    message: 'The stored Microsoft session is no longer valid and could not be renewed automatically.',
    actions: ['Sign in again from the Account screen']
  },
  NETWORK_ERROR: {
    title: 'Cannot reach the internet',
    message:
      'NexusCraft could not reach Mojang or Microsoft servers. This is usually local connectivity, a VPN, or a firewall rule.',
    actions: [
      'Check your internet connection',
      'Allow NexusCraft through your firewall',
      'Disable any VPN or proxy and retry',
      'Mojang services may be down — check status.mojang.com'
    ]
  },
  DOWNLOAD_FAILED: {
    title: 'A download did not finish',
    message: 'One or more game files could not be downloaded after several attempts.',
    actions: ['Press Retry to resume the failed files only', 'Check your connection or antivirus settings']
  },
  CHECKSUM_MISMATCH: {
    title: 'A downloaded file was corrupt',
    message:
      'A file arrived with the wrong checksum, which means it was damaged in transit or altered by another program.',
    actions: [
      'Press Retry — the file will be downloaded again',
      'If it keeps failing, add NexusCraft to your antivirus exclusions'
    ]
  },
  JAVA_NOT_FOUND: {
    title: 'No Java runtime found',
    message: 'Minecraft: Java Edition needs a Java runtime, and none was found on this PC.',
    actions: [
      'Press "Install Java automatically" to fetch the runtime Mojang ships for this version',
      'Or set a Java path yourself in Settings → Java'
    ]
  },
  JAVA_VERSION_MISMATCH: {
    title: 'Wrong Java version',
    message: 'The selected Java runtime is a different major version than this Minecraft version requires.',
    actions: [
      'Let NexusCraft install the matching runtime automatically',
      'Or pick a different Java installation in Settings → Java'
    ]
  },
  INSTANCE_CORRUPT: {
    title: 'This instance is incomplete',
    message: 'Files this instance needs are missing or unreadable, so it cannot be launched as it stands.',
    actions: ['Press "Repair instance" to re-verify and re-download the missing files']
  },
  MISSING_LIBRARIES: {
    title: 'Game libraries are missing',
    message: 'Some of the libraries Minecraft loads at startup are not on disk.',
    actions: ['Press "Repair instance" to download them', 'Check that antivirus is not quarantining files']
  },
  LOADER_INSTALL_FAILED: {
    title: 'Mod loader installation failed',
    message: 'The mod loader could not be installed for this Minecraft version.',
    actions: [
      'Check that the loader supports this Minecraft version',
      'Try a different loader version',
      'Make sure Java is installed — Forge and NeoForge need it to run their installer'
    ]
  },
  MOD_CONFLICT: {
    title: 'Mods conflict with each other',
    message: 'Two or more mods clash, or a mod does not match this instance. Minecraft would crash on startup.',
    actions: ['Open the Mods screen and review the highlighted mods', 'Disable one of each conflicting pair']
  },
  LAUNCH_FAILED: {
    title: 'Minecraft did not start',
    message: 'The game process could not be started.',
    actions: [
      'Press "Repair instance" and try again',
      'Check the launch log for the last few lines',
      'Make sure your antivirus is not blocking Java'
    ]
  },
  GAME_CRASHED: {
    title: 'Minecraft closed unexpectedly',
    message: 'The game started but exited with an error. Mods are the most common cause.',
    actions: ['Open the log to see the final lines', 'Disable recently added mods', 'Try launching without mods']
  },
  ALREADY_RUNNING: {
    title: 'This instance is already running',
    message: 'Minecraft is already open for this instance. Running the same instance twice can corrupt worlds.',
    actions: ['Switch to the running game', 'Or stop it from the Play screen first']
  },
  NOT_FOUND: {
    title: 'Not found',
    message: 'The item you asked for no longer exists.',
    actions: ['Refresh the screen']
  },
  INVALID_INPUT: {
    title: 'That input is not valid',
    message: 'The value provided did not pass validation and was rejected.',
    actions: ['Check the highlighted field and try again']
  },
  UNKNOWN: {
    title: 'Something went wrong',
    message: 'An unexpected problem occurred.',
    actions: ['Try again', 'If it keeps happening, check the launcher log from Settings']
  }
}

export class LauncherError extends Error {
  readonly code: LauncherErrorCode
  /** Extra technical context, already redacted. */
  readonly detail: string | null
  /** Overrides for the catalogue defaults. */
  private readonly overrides: Partial<Template>

  constructor(
    code: LauncherErrorCode,
    detail?: unknown,
    overrides: Partial<Template> = {}
  ) {
    const template = CATALOGUE[code] ?? CATALOGUE.UNKNOWN
    super(overrides.title ?? template.title)
    this.name = 'LauncherError'
    this.code = code
    this.detail = detail === undefined || detail === null ? null : redact(detail).slice(0, 2000)
    this.overrides = overrides
  }

  toPayload(): LauncherErrorPayload {
    const template = CATALOGUE[this.code] ?? CATALOGUE.UNKNOWN
    return {
      code: this.code,
      title: this.overrides.title ?? template.title,
      message: this.overrides.message ?? template.message,
      actions: this.overrides.actions ?? template.actions,
      detail: this.detail
    }
  }
}

/** Converts anything thrown anywhere into a safe, user-readable payload. */
export function toErrorPayload(err: unknown): LauncherErrorPayload {
  if (err instanceof LauncherError) return err.toPayload()

  // Map common low-level failures onto friendly codes.
  const code = (err as NodeJS.ErrnoException | undefined)?.code
  if (code && ['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'ENETUNREACH', 'EAI_AGAIN', 'ECONNRESET'].includes(code)) {
    return new LauncherError('NETWORK_ERROR', err).toPayload()
  }
  if (code === 'ENOENT') {
    return new LauncherError('NOT_FOUND', err).toPayload()
  }
  return new LauncherError('UNKNOWN', err).toPayload()
}
