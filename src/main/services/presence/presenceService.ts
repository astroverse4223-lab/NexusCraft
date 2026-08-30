import { DiscordRpcClient } from './discordRpc'
import { createLogger } from '../../core/logger'
import { getSettings } from '../settings/settingsService'
import { findInstance } from '../instances/instanceService'
import type { LaunchState } from '@shared/types'

const log = createLogger('presence')

/**
 * Shows what the player is doing in Discord.
 *
 * The launch state machine already publishes everything worth saying — which
 * instance, which stage, since when — so this is a translation layer over it
 * rather than a source of truth of its own. It never blocks or throws into a
 * caller: Discord being absent is the normal case, not a fault.
 */

/**
 * The Discord application this presence belongs to.
 *
 * Not a secret — an application id is public by design and appears in every
 * client that uses rich presence. Replace it with your own app's id (and
 * upload art assets named `nexuscraft`/`minecraft` to it) to control the
 * name and images Discord shows.
 */
const DISCORD_APP_ID = process.env.NEXUSCRAFT_DISCORD_APP_ID?.trim() || '1315123456789012345'

let client: DiscordRpcClient | null = null
let connecting = false

/** The game that owns the presence right now, so a second instance cannot steal it. */
let activeInstanceId: string | null = null

async function ensureClient(): Promise<DiscordRpcClient | null> {
  if (client?.isConnected) return client
  if (connecting) return null

  connecting = true
  try {
    const next = new DiscordRpcClient(DISCORD_APP_ID)
    const ok = await next.connect()
    if (!ok) {
      log.info('Discord is not running; presence is off for now')
      return null
    }
    next.on('disconnected', () => {
      log.info('Discord disconnected')
      client = null
    })
    client = next
    return client
  } catch (err) {
    log.warn(`could not reach Discord: ${(err as Error).message}`)
    return null
  } finally {
    connecting = false
  }
}

/** Idle presence — the launcher is open but nothing is running. */
export async function showIdlePresence(): Promise<void> {
  if (!getSettings().discordPresence) return
  if (activeInstanceId) return

  const rpc = await ensureClient()
  rpc?.setActivity({
    details: 'In the launcher',
    state: 'Browsing mods and instances',
    largeImageKey: 'nexuscraft',
    largeImageText: 'NexusCraft Launcher'
  })
}

/**
 * Follows a launch through its stages.
 *
 * Only 'running' and the terminal stages are worth publishing: the preparing
 * and downloading stages churn several times a second and would make the
 * Discord status flicker.
 */
export async function updatePresenceFromLaunch(state: LaunchState): Promise<void> {
  if (!getSettings().discordPresence) return

  if (state.stage === 'running') {
    const instance = findInstance(state.instanceId)
    if (!instance) return

    activeInstanceId = state.instanceId
    const rpc = await ensureClient()

    const loader =
      instance.loader === 'vanilla'
        ? 'Vanilla'
        : instance.loader.charAt(0).toUpperCase() + instance.loader.slice(1)

    rpc?.setActivity({
      details: instance.name,
      state: `${loader} ${instance.minecraftVersion}`,
      startTimestamp: state.startedAt ?? Date.now(),
      largeImageKey: 'minecraft',
      largeImageText: `Minecraft ${instance.minecraftVersion}`,
      smallImageKey: 'nexuscraft',
      smallImageText: 'NexusCraft Launcher'
    })
    return
  }

  if (state.stage === 'exited' || state.stage === 'error') {
    // Another instance may still be up; only the owner clears the presence.
    if (activeInstanceId !== state.instanceId) return
    activeInstanceId = null
    void showIdlePresence()
  }
}

/** Called when the user turns the setting off, and at shutdown. */
export function clearPresence(): void {
  activeInstanceId = null
  client?.setActivity(null)
}

export function shutdownPresence(): void {
  activeInstanceId = null
  client?.destroy()
  client = null
}

/** Connects a few seconds after boot so it never competes with startup work. */
export function initPresence(): void {
  if (!getSettings().discordPresence) return
  setTimeout(() => void showIdlePresence(), 6000).unref()
}
