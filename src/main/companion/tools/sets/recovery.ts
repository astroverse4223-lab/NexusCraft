/**
 * Fetching your things back after you die.
 *
 * The one job a companion is strictly better at than the player. Dying starts a
 * five minute timer on everything you were carrying, and you are the one person
 * who cannot be there — you are at your bed, unarmed, however far that is. The
 * bot is already standing where it happened.
 *
 * Both tools are deliberately dumb about *whether* to go. The agent decides
 * that; these only report and act, so a player who says "leave it, it's just
 * dirt" is obeyed rather than argued with.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Tool } from '../types'
import { collectDropsNear, goTo } from '../support/navigation'
import { DESPAWN_MS } from '../support/deathWatch'

/** Human-readable time remaining, for saying out loud. */
function remaining(ms: number): string {
  if (ms <= 0) return 'they are already gone'
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `about ${seconds} seconds left`
  return `about ${Math.floor(seconds / 60)} minute${seconds >= 120 ? 's' : ''} left`
}

export const TOOLS: Tool[] = [
  {
    schema: {
      name: 'death_site',
      description:
        'Check whether the player died recently and how long their dropped items will last. Use this before offering to fetch anything back.',
      parameters: { type: 'object', properties: {} }
    },
    execute: async (context) => {
      const watch = context.deathWatch
      const site = watch?.site?.()
      if (!site) return 'They have not died recently, so there is nothing to fetch.'

      const left = watch!.timeLeft()
      const here = (context.bot as any).game?.dimension ?? 'overworld'
      const wrongDimension = site.dimension !== here

      return [
        `They died at ${Math.round(site.x)}, ${Math.round(site.y)}, ${Math.round(site.z)}`,
        wrongDimension ? ` in the ${site.dimension} (you are in the ${here})` : '',
        `. Their dropped items: ${remaining(left)}.`,
        site.cause ? ` The server said: "${site.cause}".` : ''
      ].join('')
    }
  },

  {
    schema: {
      name: 'recover_death_drops',
      description:
        'Travel to where the player last died and pick up everything they dropped. Only works within five minutes of the death, before the items despawn.',
      parameters: { type: 'object', properties: {} }
    },
    execute: async (context) => {
      const { bot, signal } = context
      const watch = context.deathWatch
      const site = watch?.site?.()

      if (!site) return 'They have not died recently, so there is nothing to fetch.'

      const left: number = watch!.timeLeft()
      if (left <= 0) {
        watch!.forget()
        return 'Their things have already despawned. Nothing left to fetch.'
      }

      const here = (bot as any).game?.dimension ?? 'overworld'
      if (site.dimension !== here) {
        // Refused rather than attempted: a bot that walks toward Nether
        // coordinates while in the Overworld ends up somewhere meaningless and
        // has spent the timer getting there.
        return `They died in the ${site.dimension} and I am in the ${here}. I cannot reach it from here.`
      }

      /*
       * Distance is checked against the time left rather than against a fixed
       * limit. Walking is about four blocks a second, so a trip that cannot be
       * finished is worth saying no to now — the player can still sprint for it
       * themselves if they know straight away.
       */
      const distance = bot.entity.position.distanceTo({ x: site.x, y: site.y, z: site.z } as any)
      const secondsNeeded = distance / 4
      if (secondsNeeded * 1000 > left) {
        return (
          `It is ${Math.round(distance)} blocks away and there is only ${remaining(left)}. ` +
          'I would not make it. Better you go yourself.'
        )
      }

      const { Vec3 } = require('vec3')
      const target = new Vec3(site.x, site.y, site.z)

      /*
       * Travel first, then collect. `collectDropsNear` only considers items
       * already loaded near a point — from five hundred blocks away the chunk
       * is not loaded and it would report finding nothing at all.
       */
      await goTo(context, site.x, site.y, site.z, 2)
      if (signal.aborted) return 'Stopped on the way.'

      const picked = await collectDropsNear(context, 16, target)
      watch!.forget()
      return picked > 0
        ? `Got to where they died and picked up ${picked} stack${picked === 1 ? '' : 's'}. Say the word and I will hand it over.`
        : 'Reached where they died but there was nothing left on the ground.'
    }
  }
]
