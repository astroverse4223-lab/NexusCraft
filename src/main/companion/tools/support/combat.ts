/**
 * Judging threats and hitting them.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { DAMAGE_BEFORE_STOPPING, RETREAT_HEALTH } from '../constants'

/**
 * True when the server has the bot in creative mode.
 *
 * `bot.game.gameMode` is set at login and does not reliably follow a later
 * `/gamemode` change — it kept reporting creative while blocks were plainly
 * dropping, which is survival behaviour. The player list entry is updated by
 * the server whenever the mode changes, so it is trusted first.
 */
/**
 * Whether an entity is something that attacks the player.
 *
 * mineflayer's `type` is 'mob' for every living creature, passive ones
 * included, so it cannot be used to decide what is safe to hit. `kind` carries
 * the category when the version data provides it; the name list covers the rest.
 */
export const HOSTILE_NAMES = new Set([
  'zombie', 'husk', 'drowned', 'zombie_villager', 'zombified_piglin',
  'skeleton', 'stray', 'bogged', 'wither_skeleton',
  'creeper', 'spider', 'cave_spider', 'enderman', 'endermite',
  'witch', 'slime', 'magma_cube', 'blaze', 'ghast', 'phantom',
  'pillager', 'vindicator', 'evoker', 'ravager', 'vex', 'illusioner',
  'silverfish', 'guardian', 'elder_guardian', 'shulker', 'hoglin', 'zoglin',
  'piglin_brute', 'warden', 'breeze', 'creaking'
])

export function isHostile(entity: any): boolean {
  if (!entity || entity.type === 'player') return false
  if (typeof entity.kind === 'string' && entity.kind.toLowerCase().includes('hostile')) return true
  return HOSTILE_NAMES.has(String(entity.name ?? '').replace(/^minecraft:/, ''))
}

/** Picks the hardest-hitting weapon carried, ranked by material and type. */
export const WEAPON_TIER = ['wooden', 'golden', 'stone', 'iron', 'diamond', 'netherite']

export function bestWeapon(bot: any): any | null {
  const score = (name: string): number => {
    const tier = WEAPON_TIER.findIndex((material) => name.startsWith(`${material}_`))
    if (tier < 0) return -1
    // A sword of a given material out-damages the axe of that material for
    // sustained fighting, so it wins ties.
    if (name.endsWith('_sword')) return tier * 2 + 1
    if (name.endsWith('_axe')) return tier * 2
    return -1
  }

  let best: any = null
  let bestScore = 0
  for (const item of bot.inventory.items()) {
    const value = score(item.name)
    if (value > bestScore) {
      bestScore = value
      best = item
    }
  }
  return best
}

/**
 * Watches for the bot being hurt part-way through a long job.
 *
 * Without this the bot mined placidly on while something chewed it from full
 * health to nothing — it noticed the death afterwards but never the attack. A
 * job is not worth finishing if it kills you; stopping lets the model fight,
 * flee or shelter while there is still health to spend.
 */
export function watchForDanger(bot: any): { hurt: () => boolean; damage: () => number; stop: () => void } {
  let lowest = bot.health ?? 20
  const start = bot.health ?? 20
  const onHealth = (): void => {
    if (bot.health < lowest) lowest = bot.health
  }
  bot.on('health', onHealth)
  return {
    hurt: () => start - lowest >= DAMAGE_BEFORE_STOPPING || bot.health <= RETREAT_HEALTH,
    damage: () => Math.round(start - lowest),
    stop: () => bot.removeListener('health', onHealth)
  }
}

/** Hostiles close enough to be the reason. */
export function nearbyThreats(bot: any): string[] {
  return (Object.values(bot.entities) as any[])
    .filter((e) => isHostile(e) && e.position && e.position.distanceTo(bot.entity.position) < 16)
    .map((e) => `${e.name} at ${Math.round(e.position.distanceTo(bot.entity.position))}m`)
    .slice(0, 4)
}

/**
 * How long to wait between swings, by what is being held.
 *
 * Minecraft has charged attacks: a swing before the cooldown has recharged does
 * a fraction of full damage. The bot was hitting every 400ms and landing weak
 * blows all fight — busy, and barely hurting anything. These are the recharge
 * times for each weapon class.
 */
export function swingInterval(bot: any): number {
  const held = bot.heldItem?.name ?? ''
  if (/_sword$/.test(held)) return 640
  if (/_axe$/.test(held)) return 1_120
  if (/_pickaxe$/.test(held)) return 850
  if (/_shovel$/.test(held)) return 1_020
  if (/_hoe$/.test(held)) return 500
  return 280
}

/**
 * Strikes on the way down from a jump — a critical hit, worth 1.5x damage.
 *
 * Only from the ground, and only when not already falling, since a crit needs
 * downward motion that the jump itself provides. If the timing does not come
 * together the blow still lands, just without the bonus.
 */
export async function criticalStrike(bot: any, target: any): Promise<boolean> {
  if (!bot.entity.onGround) return false

  bot.setControlState('jump', true)
  await new Promise((r) => setTimeout(r, 90))
  bot.setControlState('jump', false)

  // Wait for the descent, but never long enough to miss the swing entirely.
  for (let tick = 0; tick < 12; tick++) {
    if (bot.entity.velocity.y < -0.08) {
      bot.attack(target)
      return true
    }
    await new Promise((r) => setTimeout(r, 40))
  }

  bot.attack(target)
  return false
}
