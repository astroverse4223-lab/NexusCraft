/**
 * Building things from a description.
 *
 * "Build me a castle" is the request an AI companion exists to answer, and the
 * one it is worst at if you let the model place every block itself. So this
 * splits the job the way a builder would: one pass to draw the plan, then the
 * plan carried out to the letter.
 *
 * The drawing pass is a second, separate model call — not part of the agent's
 * conversation — because a blueprint is a big structured answer and mixing it
 * into a turn full of tool calls is what makes models produce three walls and
 * a roof floating in the air.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Tool } from '../types'
import { chat } from '../../llm'
import {
  billOfMaterials,
  blueprintSize,
  parseBlueprint,
  validateBlueprint,
  type Blueprint
} from '../../build/blueprint'
import { buildBlueprint, describeResult, groundedOrigin, shortfall } from '../../build/builder'
import { BLUEPRINT_LIBRARY, findLibraryBlueprint } from '../../build/library'

/** The last blueprint drawn, so it can be built again without redrawing it. */
let lastBlueprint: Blueprint | null = null

const BLUEPRINT_PROMPT = `You draw Minecraft structures as layered blueprints. Reply with JSON only:

{
  "name": "short name",
  "description": "one sentence",
  "palette": { "w": "oak_planks", "s": "cobblestone", "g": "glass" },
  "layers": [
    ["sssss", "s...s", "s...s", "s...s", "sssss"],
    ["w.w.w", ".....", "....."]
  ]
}

Rules:
- layers[0] is the BOTTOM layer, and each next layer is one block higher.
- Every layer must have the SAME number of rows, and every row the SAME length. This is the most common mistake — count them.
- A row runs along +x; rows run along +z.
- "." means leave that space empty. Use it for doorways, windows and interiors — a solid block of stone is not a building.
- Every character used must be in the palette, and every palette value must be a real Minecraft block id without the "minecraft:" prefix.
- Prefer common, craftable blocks: oak_planks, cobblestone, stone, oak_log, glass, oak_stairs, torch, oak_door.
- Keep it buildable: no floating blocks with nothing under or beside them, and leave a way in.
- Output the JSON object and nothing else.`

/**
 * Hands the bot a blueprint chosen in the launcher — a library entry or an
 * imported schematic — so "Build this" in the interface and "build the castle"
 * in chat end up in exactly the same executor.
 */
export function setPendingBlueprint(blueprint: Blueprint): void {
  lastBlueprint = blueprint
}

export const TOOLS: Tool[] = [
  {
    schema: {
      name: 'build_structure',
      description:
        'Design and build a structure from a description — a house, a tower, a bridge, a wall. Say what you want and roughly how big; the structure is planned first, then built block by block. Use this instead of placing blocks one at a time.',
      parameters: {
        type: 'object',
        properties: {
          description: {
            type: 'string',
            description: 'What to build, e.g. "a small cottage with a peaked roof and two windows"'
          },
          width: { type: 'number', description: 'Roughly how wide, in blocks. 5-16 works well. Default 7.' },
          depth: { type: 'number', description: 'Roughly how deep, in blocks. Default: same as width.' },
          height: { type: 'number', description: 'Roughly how tall, in blocks. 3-12 works well. Default 5.' },
          x: { type: 'number', description: 'Where to build; omit to build just in front of where you are standing.' },
          y: { type: 'number' },
          z: { type: 'number' }
        },
        required: ['description']
      }
    },

    execute: async (context, args) => {
      const { bot, mcData, llm } = context as typeof context & { llm?: any }

      if (!llm) {
        return 'building from a description needs a language model, and this companion is running a routine instead'
      }

      const description = String(args.description ?? '').trim()
      if (!description) return 'say what to build'

      // Clamped: a 30x30x30 request is 27,000 placements, which is hours of
      // work and a blueprint no model can hold in one answer.
      const width = Math.min(Math.max(Math.round(Number(args.width) || 7), 3), 16)
      const depth = Math.min(Math.max(Math.round(Number(args.depth) || width), 3), 16)
      const height = Math.min(Math.max(Math.round(Number(args.height) || 5), 2), 12)

      context.log(`planning "${description}" (${width}x${height}x${depth})`)

      /* 1. draw it */

      let blueprint: Blueprint
      try {
        const reply = await chat(
          { ...llm, temperature: 0.4 },
          [
            { role: 'system', content: BLUEPRINT_PROMPT },
            {
              role: 'user',
              content: `Draw: ${description}\nSize: ${width} wide, ${depth} deep, ${height} tall. Use exactly ${height} layers, each with exactly ${depth} rows of exactly ${width} characters.`
            }
          ],
          [],
          context.signal
        )
        blueprint = parseBlueprint(reply.content ?? '')
      } catch (err) {
        return `could not plan that: ${(err as Error).message}`
      }

      const problems = validateBlueprint(blueprint, (name) => Boolean(mcData.blocksByName[name]))
      if (problems.length > 0) {
        // Worth saying precisely: the model gets a second attempt from the
        // agent loop, and a specific complaint is what makes the retry work.
        return `the plan came out malformed — ${problems
          .slice(0, 3)
          .map((problem) => problem.message)
          .join('; ')}. Try again, being careful that every row is the same length.`
      }

      lastBlueprint = blueprint
      const size = blueprintSize(blueprint)

      /* 2. work out where it goes */

      const position = bot.entity.position
      const asked =
        args.x != null && args.y != null && args.z != null
          ? { x: Math.floor(Number(args.x)), y: Math.floor(Number(args.y)), z: Math.floor(Number(args.z)) }
          : {
              // Just in front of the bot, so it is not standing inside its own
              // building when the walls go up.
              x: Math.floor(position.x) + 2,
              y: Math.floor(position.y),
              z: Math.floor(position.z) + 2
            }
      // Settle it onto the ground; a blueprint started in mid-air places nothing.
      const origin = groundedOrigin(bot, asked, size)

      /* 3. check the materials before starting */

      const missing = shortfall(bot, blueprint)
      if (missing.length > 0) {
        const bill = [...billOfMaterials(blueprint)]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 6)
          .map(([block, count]) => `${count}x ${block}`)
          .join(', ')

        return (
          `planned "${blueprint.name}" (${size.width}x${size.height}x${size.depth}), but it needs ${missing
            .slice(0, 5)
            .map((entry) => `${entry.short} more ${entry.block}`)
            .join(', ')}. ` +
          `The full bill is ${bill}. Gather or craft those, then call build_last_plan to put it up.`
        )
      }

      /* 4. build it */

      context.log(`building "${blueprint.name}" at ${origin.x} ${origin.y} ${origin.z}`)

      const result = await buildBlueprint(context, blueprint, {
        origin,
        onProgress: (progress) => context.log(`${progress.placed}/${progress.total} blocks placed`)
      })

      return describeResult(blueprint, result)
    }
  },

  {
    schema: {
      name: 'build_from_library',
      description:
        'Build one of the structures that ship with the launcher — these are hand-drawn and always work, so prefer them over designing your own when one fits. Call with no name to hear the list.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: `Which one: ${BLUEPRINT_LIBRARY.map((entry) => entry.id).join(', ')}`
          },
          x: { type: 'number', description: 'Where to build; omit to build in front of where you are standing.' },
          y: { type: 'number' },
          z: { type: 'number' }
        }
      }
    },

    execute: async (context, args) => {
      const wanted = String(args.name ?? '').trim()
      if (!wanted) {
        return `the library has: ${BLUEPRINT_LIBRARY.map((entry) => `${entry.id} (${entry.blurb})`).join('; ')}`
      }

      const entry = findLibraryBlueprint(wanted)
      if (!entry) {
        return `there is no "${wanted}" in the library. It has: ${BLUEPRINT_LIBRARY.map((e) => e.id).join(', ')}`
      }

      lastBlueprint = entry.blueprint

      const missing = shortfall(context.bot, entry.blueprint)
      if (missing.length > 0) {
        return (
          `"${entry.blueprint.name}" needs ${missing
            .slice(0, 5)
            .map((item) => `${item.short} more ${item.block}`)
            .join(', ')}. Gather those, then call build_last_plan.`
        )
      }

      const position = context.bot.entity.position
      const asked =
        args.x != null && args.y != null && args.z != null
          ? { x: Math.floor(Number(args.x)), y: Math.floor(Number(args.y)), z: Math.floor(Number(args.z)) }
          : {
              x: Math.floor(position.x) + 2,
              y: Math.floor(position.y),
              z: Math.floor(position.z) + 2
            }
      const origin = groundedOrigin(context.bot, asked, blueprintSize(entry.blueprint))

      context.log(`building "${entry.blueprint.name}" at ${origin.x} ${origin.y} ${origin.z}`)
      const result = await buildBlueprint(context, entry.blueprint, {
        origin,
        onProgress: (progress) => context.log(`${progress.placed}/${progress.total} blocks placed`)
      })
      return describeResult(entry.blueprint, result)
    }
  },

  {
    schema: {
      name: 'build_last_plan',
      description:
        'Build the structure you last planned, without designing it again. Use this after gathering the materials a plan said were missing.',
      parameters: {
        type: 'object',
        properties: {
          x: { type: 'number', description: 'Where to build; omit to build in front of where you are standing.' },
          y: { type: 'number' },
          z: { type: 'number' }
        }
      }
    },

    execute: async (context, args) => {
      if (!lastBlueprint) return 'there is no plan to build — use build_structure first'

      const { bot } = context
      const position = bot.entity.position
      const asked =
        args.x != null && args.y != null && args.z != null
          ? { x: Math.floor(Number(args.x)), y: Math.floor(Number(args.y)), z: Math.floor(Number(args.z)) }
          : { x: Math.floor(position.x) + 2, y: Math.floor(position.y), z: Math.floor(position.z) + 2 }
      const origin = groundedOrigin(bot, asked, blueprintSize(lastBlueprint))

      const result = await buildBlueprint(context, lastBlueprint, {
        origin,
        onProgress: (progress) => context.log(`${progress.placed}/${progress.total} blocks placed`)
      })

      return describeResult(lastBlueprint, result)
    }
  },

  {
    schema: {
      name: 'material_list',
      description:
        'Check what the structure you last planned needs, and how much of it you are missing. Use this before going out to gather.',
      parameters: { type: 'object', properties: {} }
    },

    execute: async (context) => {
      if (!lastBlueprint) return 'there is no plan yet — use build_structure first'

      const bill = [...billOfMaterials(lastBlueprint)]
        .sort((a, b) => b[1] - a[1])
        .map(([block, count]) => `${count}x ${block}`)
        .join(', ')

      const missing = shortfall(context.bot, lastBlueprint)

      return missing.length === 0
        ? `"${lastBlueprint.name}" needs ${bill} — and you have all of it.`
        : `"${lastBlueprint.name}" needs ${bill}. Still short of ${missing
            .map((entry) => `${entry.short}x ${entry.block}`)
            .join(', ')}.`
    }
  }
]
