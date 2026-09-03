/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Tool } from '../types'
import { openContainerNearby, CONTAINERS } from '../support/containers'

/**
 * Knowing where things are kept.
 *
 * A companion's memory is a short list of sentences, which is the wrong shape
 * for "there are 34 iron ingots in the chest at 118, 64, -203". Asked where
 * something was, it would either guess or say it did not know, and the only way
 * to find anything was to open every chest by hand.
 *
 * So containers get their own index: survey once, then answer from what was
 * seen. The index is deliberately reported as a snapshot with a timestamp
 * rather than as fact — a chest someone emptied an hour ago is a memory, not a
 * promise, and saying so is better than sending the player across the map.
 */

interface ChestEntry {
  x: number
  y: number
  z: number
  kind: string
  /** Item name to total count, as of `at`. */
  contents: Record<string, number>
  at: number
}

/**
 * The index, held per bot process rather than persisted.
 *
 * A survey is cheap to repeat and a stale index is worse than none: chests
 * change constantly, and carrying yesterday's picture across a restart would
 * mean confidently wrong answers on the first question of every session.
 */
let index: ChestEntry[] = []
let surveyedAt = 0

function agoText(at: number): string {
  const minutes = Math.round((Date.now() - at) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  return `${Math.round(minutes / 60)}h ago`
}

export const TOOLS: Tool[] = [
  {
    schema: {
      name: 'survey_chests',
      description:
        'Look inside every nearby chest, barrel and shulker box and remember what is in them, so you can answer questions about where things are kept. Do this once when you arrive somewhere, then use recall_item.',
      parameters: {
        type: 'object',
        properties: {
          radius: { type: 'number', description: 'How far to search, in blocks. 16-48 is sensible. Default 32.' }
        }
      }
    },

    execute: async (context, args) => {
      const { bot } = context
      const radius = Math.min(Math.max(Math.round(Number(args.radius) || 32), 4), 64)

      const blocks: any[] = bot.findBlocks({
        matching: (block: any) => block && CONTAINERS.includes(block.name),
        maxDistance: radius,
        count: 40
      })

      if (blocks.length === 0) return `no chests or barrels within ${radius} blocks`

      const found: ChestEntry[] = []
      let unreachable = 0

      for (const position of blocks) {
        if (context.signal.aborted) break
        const block = bot.blockAt(position)
        if (!block) continue

        let container: any
        try {
          container = await openContainerNearby(context, block)
        } catch {
          unreachable += 1
          continue
        }

        const contents: Record<string, number> = {}
        try {
          for (const item of container.containerItems() as any[]) {
            contents[item.name] = (contents[item.name] ?? 0) + item.count
          }
        } finally {
          try {
            container.close()
          } catch {
            /* already gone */
          }
        }

        found.push({
          x: position.x,
          y: position.y,
          z: position.z,
          kind: block.name,
          contents,
          at: Date.now()
        })
      }

      index = found
      surveyedAt = Date.now()

      const kinds = new Set<string>()
      for (const entry of found) for (const name of Object.keys(entry.contents)) kinds.add(name)

      return (
        `surveyed ${found.length} container(s) within ${radius} blocks, holding ${kinds.size} different item(s)` +
        (unreachable > 0 ? `; ${unreachable} could not be reached` : '')
      )
    }
  },

  {
    schema: {
      name: 'recall_item',
      description:
        'Say where an item was last seen, from the chests you surveyed. Use this when asked "where is" or "do we have any" — it is instant and costs nothing, unlike searching by hand.',
      parameters: {
        type: 'object',
        properties: {
          item: { type: 'string', description: 'Item name or part of one, e.g. diamond, iron_ingot, oak_log' }
        },
        required: ['item']
      }
    },

    execute: async (_context, args) => {
      const wanted = String(args.item ?? '').toLowerCase().replace(/^minecraft:/, '').trim()
      if (!wanted) return 'say which item'
      if (index.length === 0) return 'no chests have been surveyed yet — use survey_chests first'

      const hits: Array<{ entry: ChestEntry; name: string; count: number }> = []
      for (const entry of index) {
        for (const [name, count] of Object.entries(entry.contents)) {
          if (name.includes(wanted)) hits.push({ entry, name, count })
        }
      }

      if (hits.length === 0) {
        return `no ${wanted} in any of the ${index.length} container(s) surveyed ${agoText(surveyedAt)}`
      }

      hits.sort((a, b) => b.count - a.count)
      const total = hits.reduce((sum, hit) => sum + hit.count, 0)

      const where = hits
        .slice(0, 4)
        .map((hit) => `${hit.count}x ${hit.name} in the ${hit.entry.kind} at ${hit.entry.x} ${hit.entry.y} ${hit.entry.z}`)
        .join('; ')

      return `${total} total, as of ${agoText(surveyedAt)}: ${where}${hits.length > 4 ? `, and ${hits.length - 4} more` : ''}`
    }
  },

  {
    schema: {
      name: 'fetch_item',
      description:
        'Go to the chest an item was last seen in and take some. Use after recall_item, or on its own when asked to go and get something.',
      parameters: {
        type: 'object',
        properties: {
          item: { type: 'string', description: 'Item name or part of one' },
          count: { type: 'number', description: 'How many to take. Default 64.' }
        },
        required: ['item']
      }
    },

    execute: async (context, args) => {
      const wanted = String(args.item ?? '').toLowerCase().replace(/^minecraft:/, '').trim()
      if (!wanted) return 'say which item'
      if (index.length === 0) return 'no chests have been surveyed yet — use survey_chests first'

      // The chest holding the most of it is the one worth walking to.
      let best: { entry: ChestEntry; name: string; count: number } | null = null
      for (const entry of index) {
        for (const [name, count] of Object.entries(entry.contents)) {
          if (!name.includes(wanted)) continue
          if (!best || count > best.count) best = { entry, name, count }
        }
      }

      if (!best) return `no ${wanted} was seen in any surveyed container`

      const take = Math.min(Math.max(Math.round(Number(args.count) || 64), 1), 64)
      const { bot } = context
      const { Vec3 } = require('vec3')

      const block = bot.blockAt(new Vec3(best.entry.x, best.entry.y, best.entry.z))
      if (!block || !CONTAINERS.includes(block.name)) {
        return `the ${best.entry.kind} at ${best.entry.x} ${best.entry.y} ${best.entry.z} is no longer there — survey again`
      }

      let container: any
      try {
        container = await openContainerNearby(context, block)
      } catch (err) {
        return `could not reach the ${best.entry.kind} at ${best.entry.x} ${best.entry.y} ${best.entry.z}: ${(err as Error).message}`
      }

      try {
        const item = (container.containerItems() as any[]).find((entry) => entry.name === best!.name)
        if (!item) {
          // Somebody emptied it since the survey; the index is now a lie.
          delete best.entry.contents[best.name]
          return `the ${best.entry.kind} no longer has any ${best.name} — someone has been in it since the survey`
        }
        const amount = Math.min(take, item.count)
        await container.withdraw(item.type, null, amount)

        // Keep the index honest about what was taken.
        const left = (best.entry.contents[best.name] ?? 0) - amount
        if (left > 0) best.entry.contents[best.name] = left
        else delete best.entry.contents[best.name]

        return `took ${amount}x ${best.name} from the ${best.entry.kind} at ${best.entry.x} ${best.entry.y} ${best.entry.z}`
      } catch (err) {
        return `could not take it: ${(err as Error).message}`
      } finally {
        try {
          container.close()
        } catch {
          /* already gone */
        }
      }
    }
  }
]
