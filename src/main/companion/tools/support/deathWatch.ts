/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Noticing where the player died.
 *
 * The one job a companion is strictly better at than a person. Dying in
 * Minecraft starts a five minute timer on everything you were carrying, and the
 * player is the one entity that cannot be in two places — they are back at
 * their bed, unarmed, a thousand blocks from a pile of their own diamonds. The
 * bot is already standing there.
 *
 * Death is watched three ways because none of them is reliable alone:
 *
 *   - The position is sampled continuously, because the moment they die the
 *     entity is gone and there is nothing left to ask.
 *   - `entityDead` fires for players in most cases and is the cleanest signal.
 *   - The server's death message is the fallback, since a player who dies in an
 *     unloaded chunk produces no entity event at all — and that is precisely
 *     the death worth recovering from.
 */

/** How long the drops last. Vanilla despawn is five minutes. */
export const DESPAWN_MS = 5 * 60_000

export interface DeathSite {
  x: number
  y: number
  z: number
  /** The dimension it happened in; drops in the Nether are not in the Overworld. */
  dimension: string
  at: number
  /** The server's message, when there was one — good for saying it back. */
  cause: string | null
}

export interface DeathWatch {
  /** Where they last died, or null. */
  site: () => DeathSite | null
  /** Milliseconds before the drops are gone; negative once they are. */
  timeLeft: () => number
  /** Called once per death, on the tick it is noticed. */
  onDeath: (handler: (site: DeathSite) => void) => void
  forget: () => void
  stop: () => void
}

/** Death messages name the player first; this matches the vanilla set loosely. */
function looksLikeDeath(message: string, owner: string): boolean {
  if (!message.startsWith(owner)) return false

  /*
   * Not their own chat. "Error420s: watch out, that creeper was close" starts
   * with the name and contains a death verb, and would otherwise send the
   * companion running across the map to recover a player who is fine.
   *
   * A server death message puts a space after the name; chat puts a colon, and
   * some servers wrap the name in brackets instead.
   */
  const after = message.charAt(owner.length)
  if (after !== ' ') return false
  if (message.includes('<') || / said:| whispers/i.test(message)) return false
  return /\b(was|died|fell|burned|drowned|blew|starved|withered|froze|suffocated|hit the ground|walked into|tried to swim|discovered the floor|went off with a bang)\b/i.test(
    message
  )
}

/**
 * Starts watching an owner.
 *
 * Sampling runs on a timer rather than on `move`, because a player who dies
 * mid-fall produces no further movement events and the last one you got is
 * several blocks above where the items land.
 */
export function watchOwnerDeath(bot: any, owner: string): DeathWatch {
  let lastSeen: { x: number; y: number; z: number; dimension: string } | null = null
  let site: DeathSite | null = null
  let handler: ((site: DeathSite) => void) | null = null

  const sample = setInterval(() => {
    const entity = bot.players?.[owner]?.entity
    if (!entity?.position) return
    lastSeen = {
      x: entity.position.x,
      y: entity.position.y,
      z: entity.position.z,
      dimension: bot.game?.dimension ?? 'overworld'
    }
  }, 1000)
  sample.unref?.()

  const record = (cause: string | null): void => {
    // Nothing was ever seen, so there is nowhere to send anyone.
    if (!lastSeen) return
    // Ignore a second signal for the same death; two of the three usually fire.
    if (site && Date.now() - site.at < 5000) return

    site = { ...lastSeen, at: Date.now(), cause }
    handler?.(site)
  }

  const onEntityDead = (entity: any): void => {
    if (entity?.type === 'player' && entity.username === owner) record(null)
  }

  const onMessage = (message: any): void => {
    const text = typeof message?.toString === 'function' ? message.toString() : String(message)
    if (looksLikeDeath(text.trim(), owner)) record(text.trim())
  }

  bot.on('entityDead', onEntityDead)
  bot.on('message', onMessage)

  return {
    site: () => site,
    timeLeft: () => (site ? DESPAWN_MS - (Date.now() - site.at) : -1),
    onDeath: (fn) => {
      handler = fn
    },
    forget: () => {
      site = null
    },
    stop: () => {
      clearInterval(sample)
      bot.removeListener('entityDead', onEntityDead)
      bot.removeListener('message', onMessage)
    }
  }
}
