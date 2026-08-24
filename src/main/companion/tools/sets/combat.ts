/**
 * Fighting, and knowing when to stop.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { EDIBLE, FLEE_DISTANCE, MOVE_TO_PLACE_TIMEOUT_MS, RETREAT_HEALTH } from '../constants'
import type { Tool } from '../types'
import { bestWeapon, criticalStrike, isHostile, swingInterval } from '../support/combat'
import { goTo, pillarUp } from '../support/navigation'
import { wearBestArmour } from '../support/equipment'

export const TOOLS: Tool[] = [
  {
    schema: {
      name: 'attack_nearest',
      description: 'Attack the nearest hostile mob, or a named mob type. Equips the best weapon first.',
      parameters: {
        type: 'object',
        properties: { mob: { type: 'string', description: 'Optional mob name, e.g. zombie' } }
      }
    },
    execute: async (context, { mob }) => {
      const { bot, signal } = context
      const wanted = mob ? String(mob).replace(/^minecraft:/, '') : null

      /*
       * Only hostiles are attacked unless a mob is named outright. Matching on
       * `type === 'mob'` swept in cows, sheep and villagers, so an unqualified
       * "defend me" could have the companion slaughtering the player's own farm.
       */
      const target = bot.nearestEntity(
        (e: any) =>
          (wanted ? e.name === wanted : isHostile(e)) && e.position.distanceTo(bot.entity.position) < 24
      )
      if (!target) return wanted ? `no ${wanted} nearby` : 'no hostile mobs nearby'

      const weapon = bestWeapon(bot)
      if (weapon) {
        try {
          await bot.equip(weapon, 'hand')
        } catch (err) {
          context.log(`could not draw ${weapon.name}: ${(err as Error).message}`)
        }
      }

      // Armour first. Fighting in a shirt while carrying a full set is the
      // single most common way for the bot to die pointlessly.
      const worn = await wearBestArmour(bot)
      if (worn.length > 0) context.log(`put on ${worn.join(', ')} before fighting`)

      let problem = ''
      let brokeOff = false
      let healthAtBreak = 20
      let hits = 0
      let crits = 0
      const deadline = Date.now() + 20_000

      /*
       * Chase with a goal that tracks the target rather than pathing to where
       * it stood a moment ago.
       *
       * Walking to a fixed position is hopeless against anything that moves:
       * the bot arrived at empty ground, the path expired, and every fight
       * ended "could not finish the skeleton: walking there took too long"
       * without a blow landed. GoalFollow is recomputed as the target moves,
       * and runs in the background while this loop swings whenever in range.
       */
      const { goals } = context
      bot.pathfinder.setGoal(new goals.GoalFollow(target, 2), true)

      try {
        while (target.isValid && Date.now() < deadline && !signal.aborted) {
          /*
           * Know when to stop. Without this the bot fought to the death every
           * time, because nothing in the loop ever looked at its own health.
           */
          if (bot.health <= RETREAT_HEALTH) {
            // Capture it now: by the time this is reported the bot has fled and
            // eaten, so reading it later claimed it broke off at full health.
            brokeOff = true
            healthAtBreak = bot.health
            break
          }

          let waited = 200

          if (bot.entity.position.distanceTo(target.position) <= 3.5) {
            try {
              await bot.lookAt(target.position.offset(0, target.height * 0.5, 0))
              const crit = await criticalStrike(bot, target)
              if (crit) crits++
              hits++
              // Wait out the cooldown before swinging again, or the next blow
              // lands for a fraction of its damage.
              waited = swingInterval(bot)
            } catch (err) {
              problem = (err as Error).message
            }
          }

          await new Promise((r) => setTimeout(r, waited))
        }
      } finally {
        // Always drop the chase goal, or the bot keeps trailing the mob after
        // the tool has returned and looks possessed.
        bot.pathfinder.setGoal(null)
      }

      if (brokeOff) {
        /*
         * Actually leave. Stopping the attack loop and telling the model to
         * "get away" is not the same as getting away — the mob carries on
         * hitting a bot that is standing still deciding what to do next.
         */
        let fled = 0
        try {
          const here = bot.entity.position
          const away = here.minus(target.position).normalize().scaled(FLEE_DISTANCE)
          await goTo(context, here.x + away.x, here.y, here.z + away.z, 2, MOVE_TO_PLACE_TIMEOUT_MS)
          fled = Math.round(bot.entity.position.distanceTo(target.position))
        } catch {
          /* cornered on foot — going up is the way out */
        }

        /*
         * If backing away did not work, build upwards instead. Zombies keep
         * pace with a walking player, so a cornered bot that only knew how to
         * run was killed every time; three blocks of tower puts it beyond
         * anything that cannot climb.
         */
        let tower = 0
        if (fled < 4) {
          tower = await pillarUp(bot, 3)
          if (tower > 0) context.log(`walled up ${tower} blocks high to break contact`)
        }

        // Then eat, so the next decision is made at better health.
        const food = bot.inventory.items().find((i: any) => EDIBLE.test(i.name))
        if (food && bot.food < 20) {
          try {
            await bot.equip(food, 'hand')
            await bot.consume()
          } catch {
            /* eating can fail mid-fight; the retreat still stands */
          }
        }

        const health = Math.round(healthAtBreak)
        if (fled >= 4) return `broke off the fight with ${target.name} at ${health}/20 health and backed off ${fled} blocks.`
        if (tower > 0) {
          return `broke off the fight with ${target.name} at ${health}/20 health and towered ${tower} blocks up out of reach. Heal, then come down.`
        }
        return `broke off the fight with ${target.name} at ${health}/20 health but could not get clear and had nothing to build with — cornered.`
      }

      if (!target.isValid) {
        return `killed ${target.name}${weapon ? ` with ${weapon.name}` : ' bare-handed'} — ${hits} hits, ${crits} of them critical`
      }
      return problem
        ? `could not finish the ${target.name}: ${problem}`
        : `fought ${target.name} but it is still alive`
    }
  }
]
