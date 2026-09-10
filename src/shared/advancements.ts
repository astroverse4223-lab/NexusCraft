/**
 * Custom advancements, as a data pack.
 *
 * The shapes below were read out of Minecraft's own jar rather than
 * remembered, because the format moved: the icon is `{"id": ...}` where it used
 * to be `{"item": ...}`, an inventory condition holds `items` inside `items`,
 * and a kill condition is a predicate list rather than a bare entity type.
 * Every one of those changes is silent - a pack with the old spelling loads and
 * simply never fires.
 */
import { resolveItemId } from './creations'

/** What has to happen for somebody to earn it. */
export type TriggerKind = 'obtain' | 'kill' | 'command'

export interface AdvancementDesign {
  id: string
  title: string
  description: string
  /** The item shown as its icon. */
  icon: string
  /** A task is a square, a goal a rounded box, a challenge a spiked one. */
  frame: 'task' | 'goal' | 'challenge'
  trigger: TriggerKind
  /** The item to obtain, or the mob to kill. Ignored for a command trigger. */
  target: string
  /** Experience given when it is earned. */
  experience: number
  hidden: boolean
}

export interface AdvancementPack {
  name: string
  advancements: AdvancementDesign[]
}

export const MAX_ADVANCEMENTS = 16

/** Entity ids are not in the item list, so they are checked by shape. */
function cleanEntity(value: string): string | null {
  const id = value.replace(/^minecraft:/, '').trim().toLowerCase()
  return /^[a-z_]{3,40}$/.test(id) ? id : null
}

export function advancementPrompt(): string {
  return [
    'You design Minecraft advancements for a datapack.',
    'Answer with one JSON object and nothing else.',
    '',
    'Shape: {"name":"<pack name>","advancements":[',
    '  {"id":"<lower_case_id>","title":"<short title>","description":"<one line>",',
    '   "icon":"<item id>","frame":"task","trigger":"obtain","target":"<item id>",',
    '   "experience":50,"hidden":false}]}',
    '',
    'trigger is one of: obtain (target is an item), kill (target is a mob id),',
    'or command (earned only when a command grants it - use this for anything',
    'the game cannot detect on its own).',
    'frame is task, goal or challenge. A challenge is for the hardest ones.',
    'icon is a plain item id such as diamond_sword.',
    'Titles are two or three words. Descriptions are one short sentence.',
    `At most ${MAX_ADVANCEMENTS}. No commentary, no code fences.`
  ].join('\n')
}

export function readAdvancements(
  raw: unknown
): { pack: AdvancementPack; dropped: string[] } | null {
  if (!raw || typeof raw !== 'object') return null
  const source = raw as Record<string, unknown>

  const dropped: string[] = []
  const advancements: AdvancementDesign[] = []
  const used = new Set<string>()

  for (const entry of Array.isArray(source.advancements) ? source.advancements : []) {
    if (advancements.length >= MAX_ADVANCEMENTS) break
    if (!entry || typeof entry !== 'object') continue

    const value = entry as Record<string, unknown>

    const id =
      typeof value.id === 'string'
        ? value.id.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '')
        : ''

    if (!id) {
      dropped.push('one with no id')
      continue
    }

    // Two advancements with one id would overwrite each other's file.
    if (used.has(id)) {
      dropped.push(`${id}: named twice`)
      continue
    }

    const icon = resolveItemId(typeof value.icon === 'string' ? value.icon : '')
    if (!icon) {
      dropped.push(`${id}: "${String(value.icon)}" is not an item to show as its icon`)
      continue
    }

    const trigger: TriggerKind =
      value.trigger === 'kill' ? 'kill' : value.trigger === 'command' ? 'command' : 'obtain'

    let target = ''

    if (trigger === 'obtain') {
      const item = resolveItemId(typeof value.target === 'string' ? value.target : '')
      if (!item) {
        dropped.push(`${id}: "${String(value.target)}" is not an item to obtain`)
        continue
      }
      target = item
    }

    if (trigger === 'kill') {
      const mob = cleanEntity(typeof value.target === 'string' ? value.target : '')
      if (!mob) {
        dropped.push(`${id}: "${String(value.target)}" is not a mob`)
        continue
      }
      target = mob
    }

    const frame =
      value.frame === 'goal' ? 'goal' : value.frame === 'challenge' ? 'challenge' : 'task'

    used.add(id)

    advancements.push({
      id,
      title: String(value.title ?? id).slice(0, 40) || id,
      description: String(value.description ?? '').slice(0, 120),
      icon,
      frame,
      trigger,
      target,
      experience: Math.max(0, Math.min(1000, Math.round(Number(value.experience) || 0))),
      hidden: value.hidden === true
    })
  }

  if (advancements.length === 0) return null

  const name =
    typeof source.name === 'string' && source.name.trim()
      ? source.name.trim().slice(0, 40)
      : 'Custom advancements'

  return { pack: { name, advancements }, dropped }
}

/**
 * The criteria for one advancement.
 *
 * A command-granted one uses `impossible`, which is exactly what it sounds
 * like: nothing the player does will ever satisfy it, so the only way in is
 * `/advancement grant`. That is what makes it useful for anything a plugin
 * decides rather than the game.
 */
function criteriaFor(design: AdvancementDesign): Record<string, unknown> {
  if (design.trigger === 'kill') {
    return {
      killed: {
        trigger: 'minecraft:player_killed_entity',
        conditions: {
          entity: [
            {
              condition: 'minecraft:entity_properties',
              entity: 'this',
              predicate: { 'minecraft:entity_type': `minecraft:${design.target}` }
            }
          ]
        }
      }
    }
  }

  if (design.trigger === 'command') {
    return { granted: { trigger: 'minecraft:impossible' } }
  }

  return {
    got: {
      trigger: 'minecraft:inventory_changed',
      conditions: { items: [{ items: `minecraft:${design.target}` }] }
    }
  }
}

export function advancementJson(
  design: AdvancementDesign,
  namespace: string,
  rootId: string
): string {
  const criteria = criteriaFor(design)

  const body: Record<string, unknown> = {
    parent: `${namespace}:${rootId}`,
    display: {
      icon: { id: `minecraft:${design.icon}` },
      title: { text: design.title },
      description: { text: design.description },
      frame: design.frame,
      show_toast: true,
      announce_to_chat: true,
      hidden: design.hidden
    },
    criteria,
    requirements: [Object.keys(criteria)]
  }

  if (design.experience > 0) body.rewards = { experience: design.experience }

  return JSON.stringify(body, null, 2)
}

/**
 * The tab the others hang from.
 *
 * Every advancement needs a parent or it becomes its own root, and a pack of
 * twelve roots is twelve tabs in the menu with one entry each. This is the one
 * root, and it carries the background the tab is drawn on.
 */
export function rootJson(packName: string, icon: string): string {
  return JSON.stringify(
    {
      display: {
        icon: { id: `minecraft:${icon}` },
        title: { text: packName },
        description: { text: 'Made in NexusCraft Launcher' },
        background: 'minecraft:gui/advancements/backgrounds/stone',
        frame: 'task',
        show_toast: false,
        announce_to_chat: false,
        hidden: false
      },
      criteria: { here: { trigger: 'minecraft:tick' } },
      requirements: [['here']]
    },
    null,
    2
  )
}
