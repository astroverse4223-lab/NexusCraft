/**
 * Three things you design in the launcher and hand to the server.
 *
 * A server list message, a firework, and a custom item. They live together
 * because they are the same problem in three costumes: a description that a
 * language model can write as structured data, rendered locally, and applied
 * either as a server setting or as a `/give`.
 *
 * The vocabulary each of them is held to — enchantment ids, level caps,
 * firework shapes, item ids — is read out of the game in `itemData.ts` rather
 * than remembered, because every mistake there is silent. An enchantment the
 * game does not have makes a command that fails; a level cap guessed too high
 * makes one that succeeds and produces the wrong item.
 */
import { ENCHANTMENTS, FIREWORK_SHAPES, ITEMS } from './itemData'

export { ENCHANTMENTS, FIREWORK_SHAPES, ITEMS }

/* -------------------------------------------------------------------- motd */

/**
 * The sixteen colours a server list message can use, and what they look like.
 *
 * Section codes rather than hex. Hex works on some server software and not
 * others, and a message that renders as literal gibberish for half the people
 * looking at it is worse than one with fewer colours in it.
 */
export const MOTD_COLOURS: [string, string, string][] = [
  ['0', 'Black', '#000000'],
  ['1', 'Dark Blue', '#0000AA'],
  ['2', 'Dark Green', '#00AA00'],
  ['3', 'Dark Aqua', '#00AAAA'],
  ['4', 'Dark Red', '#AA0000'],
  ['5', 'Dark Purple', '#AA00AA'],
  ['6', 'Gold', '#FFAA00'],
  ['7', 'Gray', '#AAAAAA'],
  ['8', 'Dark Gray', '#555555'],
  ['9', 'Blue', '#5555FF'],
  ['a', 'Green', '#55FF55'],
  ['b', 'Aqua', '#55FFFF'],
  ['c', 'Red', '#FF5555'],
  ['d', 'Light Purple', '#FF55FF'],
  ['e', 'Yellow', '#FFFF55'],
  ['f', 'White', '#FFFFFF']
]

export const MOTD_STYLES: [string, string][] = [
  ['l', 'Bold'],
  ['o', 'Italic'],
  ['n', 'Underline'],
  ['m', 'Strikethrough'],
  ['k', 'Obfuscated'],
  ['r', 'Reset']
]

/** The most a server list will show before it truncates. */
export const MOTD_LINE_LIMIT = 45

export interface MotdDesign {
  line1: string
  line2: string
}

/** One run of text that shares a colour and a set of styles. */
export interface MotdRun {
  text: string
  colour: string
  bold: boolean
  italic: boolean
  underline: boolean
  strike: boolean
  obfuscated: boolean
}

/**
 * Splits a line into the runs a preview has to draw.
 *
 * Accepts `&` as well as `§`, because `§` cannot be typed on most keyboards and
 * every server owner alive is used to writing `&a`.
 */
export function readMotdLine(line: string): MotdRun[] {
  const runs: MotdRun[] = []

  let colour = '#AAAAAA'
  let bold = false
  let italic = false
  let underline = false
  let strike = false
  let obfuscated = false
  let text = ''

  const flush = (): void => {
    if (!text) return
    runs.push({ text, colour, bold, italic, underline, strike, obfuscated })
    text = ''
  }

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]

    if ((ch === '&' || ch === '§') && i + 1 < line.length) {
      const code = line[i + 1].toLowerCase()
      const found = MOTD_COLOURS.find(([key]) => key === code)

      if (found) {
        flush()
        colour = found[2]
        // A colour resets styling, which is what the game does.
        bold = italic = underline = strike = obfuscated = false
        i++
        continue
      }

      if ('lonmkr'.includes(code)) {
        flush()
        if (code === 'l') bold = true
        else if (code === 'o') italic = true
        else if (code === 'n') underline = true
        else if (code === 'm') strike = true
        else if (code === 'k') obfuscated = true
        else {
          colour = '#AAAAAA'
          bold = italic = underline = strike = obfuscated = false
        }
        i++
        continue
      }
    }

    text += ch
  }

  flush()
  return runs
}

/** How long the line reads as, ignoring the codes. */
export function motdLength(line: string): number {
  return readMotdLine(line).reduce((total, run) => total + run.text.length, 0)
}

/** The form server.properties wants: section codes, and the two lines joined. */
export function motdToProperty(design: MotdDesign): string {
  const clean = (line: string): string => line.replace(/&(?=[0-9a-fk-or])/gi, '§')
  const first = clean(design.line1)
  const second = clean(design.line2)
  return second.trim() ? `${first}\n${second}` : first
}

/** And back again, so an existing MOTD can be loaded into the designer. */
export function motdFromProperty(value: string): MotdDesign {
  const [first = '', second = ''] = value.split('\n')
  const friendly = (line: string): string => line.replace(/§/g, '&')
  return { line1: friendly(first), line2: friendly(second) }
}

export function motdPrompt(): string {
  return [
    'You write Minecraft server list messages (MOTDs).',
    'Answer with one JSON object and nothing else.',
    '',
    'Shape: {"line1":"<text>","line2":"<text>"}',
    '',
    'Colour with & codes: ' +
      MOTD_COLOURS.map(([code, name]) => `&${code} ${name.toLowerCase()}`).join(', '),
    'Styles: &l bold, &o italic, &n underline, &m strikethrough, &r reset.',
    '',
    `Each line must read as at most ${MOTD_LINE_LIMIT} characters not counting the codes.`,
    'Two short lines. The first names the server, the second says what it offers.',
    'No commentary, no code fences.'
  ].join('\n')
}

export function readMotd(raw: unknown): MotdDesign | null {
  if (!raw || typeof raw !== 'object') return null
  const source = raw as Record<string, unknown>

  const line = (v: unknown): string => (typeof v === 'string' ? v.slice(0, 200) : '')
  const design = { line1: line(source.line1), line2: line(source.line2) }

  return design.line1.trim() || design.line2.trim() ? design : null
}

/* ----------------------------------------------------------------- recipes */

/**
 * A custom crafting recipe, and a pack of them.
 *
 * The JSON shape is taken from the recipes the game itself ships rather than
 * from memory, because it changed in 1.21.2 and the old form fails silently -
 * a pack that loads and simply has no recipes in it. Checked against
 * `data/minecraft/recipe/hopper.json`: keys map to plain item ids, and the
 * result is an object with `id` and `count`.
 */
export interface RecipeDesign {
  id: string
  kind: 'shaped' | 'shapeless'
  /** Up to three rows of up to three characters. Shaped only. */
  pattern: string[]
  /** Which item each character in the pattern is. Shaped only. */
  keys: Record<string, string>
  /** Shapeless only. */
  ingredients: string[]
  result: string
  count: number
}

export interface RecipePack {
  name: string
  recipes: RecipeDesign[]
}

export const MAX_RECIPES = 12

export function recipePrompt(): string {
  return [
    'You design Minecraft crafting recipes for a datapack.',
    'Answer with one JSON object and nothing else.',
    '',
    'Shape: {"name":"<pack name>","recipes":[',
    '  {"id":"<lower_case_id>","kind":"shaped","pattern":["XXX"," X "," X "],',
    '   "keys":{"X":"<item id>"},"result":"<item id>","count":1},',
    '  {"id":"<lower_case_id>","kind":"shapeless","ingredients":["<item id>"],',
    '   "result":"<item id>","count":1}]}',
    '',
    'Patterns have 1 to 3 rows of 1 to 3 characters. A space means an empty slot.',
    'Every non-space character in a pattern must appear in keys.',
    'Item ids are plain Minecraft ids such as diamond or oak_planks.',
    '',
    'Make only the recipes the request describes. Do not add extra ones, and do',
    'not invent easier versions of them: asked for cobblestone and coal making',
    'stone, a second recipe turning cobblestone alone into stone makes the coal',
    'pointless and is not what was wanted.',
    `At most ${MAX_RECIPES} recipes. No commentary, no code fences.`
  ].join('\n')
}

/**
 * Reads a pack, dropping any recipe that would not load.
 *
 * A recipe with a key the pattern never uses, or a pattern character with no
 * key, is not a recipe the game will accept - and a datapack with one bad file
 * in it logs a warning nobody reads and carries on without it. Rejecting them
 * here means the pack that gets written is the pack that works.
 */
export function readRecipes(raw: unknown): { pack: RecipePack; dropped: string[] } | null {
  if (!raw || typeof raw !== 'object') return null
  const source = raw as Record<string, unknown>

  const dropped: string[] = []
  const recipes: RecipeDesign[] = []

  for (const entry of Array.isArray(source.recipes) ? source.recipes : []) {
    if (recipes.length >= MAX_RECIPES) break
    const r = entry as Record<string, unknown>

    const id = typeof r?.id === 'string' ? r.id.toLowerCase().replace(/[^a-z0-9_]/g, '_') : ''
    const result = resolveItemId(typeof r?.result === 'string' ? r.result : '')

    if (!id || !result) {
      dropped.push(`${id || '?'}: no such result item`)
      continue
    }

    const count = typeof r.count === 'number' ? Math.max(1, Math.min(64, Math.round(r.count))) : 1
    const shapeless = r.kind === 'shapeless'

    if (shapeless) {
      const ingredients = (Array.isArray(r.ingredients) ? r.ingredients : [])
        .map((i) => (typeof i === 'string' ? resolveItemId(i) : null))
        .filter((i): i is string => Boolean(i))
        .slice(0, 9)

      if (ingredients.length === 0) {
        dropped.push(`${id}: no usable ingredients`)
        continue
      }

      recipes.push({ id, kind: 'shapeless', pattern: [], keys: {}, ingredients, result, count })
      continue
    }

    const pattern = (Array.isArray(r.pattern) ? r.pattern : [])
      .filter((row): row is string => typeof row === 'string')
      .slice(0, 3)
      .map((row) => row.slice(0, 3))

    if (pattern.length === 0) {
      dropped.push(`${id}: no pattern`)
      continue
    }

    // Every row the same width, which the game requires.
    const width = Math.max(...pattern.map((row) => row.length))
    const padded = pattern.map((row) => row.padEnd(width, ' '))

    const rawKeys = (r.keys ?? {}) as Record<string, unknown>
    const used = new Set(padded.join('').split('').filter((c) => c !== ' '))

    const keys: Record<string, string> = {}
    let missing = false

    for (const symbol of used) {
      const wanted = typeof rawKeys[symbol] === 'string' ? (rawKeys[symbol] as string) : ''
      const item = resolveItemId(wanted)
      if (!item) {
        missing = true
        break
      }
      keys[symbol] = item
    }

    if (missing) {
      dropped.push(`${id}: a pattern character has no item`)
      continue
    }

    recipes.push({ id, kind: 'shaped', pattern: padded, keys, ingredients: [], result, count })
  }

  if (recipes.length === 0) return null

  const name =
    typeof source.name === 'string' && source.name.trim()
      ? source.name.trim().slice(0, 40)
      : 'Custom recipes'

  return { pack: { name, recipes }, dropped }
}

/**
 * The pack.mcmeta document, which is where a data pack lives or dies.
 *
 * From format 82 onwards Minecraft refuses a pack outright unless `min_format`
 * and `max_format` are present:
 *
 *   Pack declares support for version newer than 81, but is missing mandatory
 *   fields min_format and max_format
 *
 * It fails at the metadata stage, so nothing inside is ever read - the recipes
 * simply are not there, with no in-game sign that anything was installed. This
 * generator wrote the short form for every version, so on 1.21.9 and up (format
 * 88) every pack it produced was silently ignored.
 *
 * Written once, here, and used by both the generated packs and the built-in
 * catalogue - the bug existed because there were two copies and only one of
 * them knew.
 */
export function packMcmeta(format: number, description: string): Record<string, unknown> {
  if (format <= 81) {
    return { pack: { pack_format: format, description } }
  }

  return {
    pack: {
      pack_format: format,
      min_format: format,
      max_format: format,
      description
    }
  }
}

/** One recipe as the file the game reads. */
export function recipeJson(recipe: RecipeDesign): string {
  const result = { count: recipe.count, id: `minecraft:${recipe.result}` }

  const body =
    recipe.kind === 'shapeless'
      ? {
          type: 'minecraft:crafting_shapeless',
          ingredients: recipe.ingredients.map((i) => `minecraft:${i}`),
          result
        }
      : {
          type: 'minecraft:crafting_shaped',
          pattern: recipe.pattern,
          key: Object.fromEntries(
            Object.entries(recipe.keys).map(([k, v]) => [k, `minecraft:${v}`])
          ),
          result
        }

  return JSON.stringify(body, null, 2)
}

/* ------------------------------------------------------------------- loot */

/** One thing that can drop, and how often. */
export interface LootDrop {
  item: string
  /** Fewest and most that drop when it does. */
  min: number
  max: number
  /** 0 to 1. One in twenty is 0.05. */
  chance: number
}

/**
 * One vanilla loot table, with things added to it.
 *
 * `table` is a vanilla path such as `entities/zombie`, `blocks/stone` or
 * `chests/simple_dungeon`, because what this produces is an override of that
 * table - there is no way for a data pack to add to one without replacing it.
 */
export interface LootRule {
  id: string
  table: string
  drops: LootDrop[]
}

export interface LootPack {
  name: string
  rules: LootRule[]
}

export const MAX_LOOT_RULES = 12

export function lootPrompt(): string {
  return [
    'You design Minecraft loot tables for a datapack.',
    'Answer with one JSON object and nothing else.',
    '',
    'Shape: {"name":"<pack name>","rules":[',
    '  {"id":"<lower_case_id>","table":"entities/zombie",',
    '   "drops":[{"item":"emerald","min":1,"max":2,"chance":0.05}]}]}',
    '',
    'table is a vanilla loot table path. Mobs are entities/<mob>, blocks are',
    'blocks/<block>, and chests are chests/<name> such as chests/simple_dungeon.',
    'chance is between 0 and 1: one in twenty is 0.05.',
    'min and max are how many drop when it does, and min must not exceed max.',
    'Item ids are plain Minecraft ids such as diamond or emerald.',
    'Add only what the request asks for. The existing drops are kept for you,',
    'so never list things the table already drops.',
    `At most ${MAX_LOOT_RULES} rules. No commentary, no code fences.`
  ].join('\n')
}

/**
 * Reads what the model sent, keeping only rules that would work.
 *
 * The same shape as {@link readRecipes} and for the same reason: what comes
 * back is text from a language model, and every field of it is a guess until
 * it has been checked against the items the game actually has.
 */
export function readLoot(raw: unknown): { pack: LootPack; dropped: string[] } | null {
  if (!raw || typeof raw !== 'object') return null
  const source = raw as Record<string, unknown>

  const dropped: string[] = []
  const rules: LootRule[] = []

  const list = Array.isArray(source.rules) ? source.rules : []

  for (const entry of list) {
    if (rules.length >= MAX_LOOT_RULES) break
    if (!entry || typeof entry !== 'object') continue

    const rule = entry as Record<string, unknown>

    const id = typeof rule.id === 'string' ? rule.id.toLowerCase().replace(/[^a-z0-9_]+/g, '_') : ''
    const table = typeof rule.table === 'string' ? rule.table.trim().toLowerCase() : ''

    if (!id) {
      dropped.push('a rule with no id')
      continue
    }

    /*
     * A path, and only a path.
     *
     * This becomes a file name inside the pack, so anything that could climb
     * out of the folder is refused rather than cleaned up - a rule that tried
     * is not a rule anybody meant.
     */
    if (!/^[a-z_]+\/[a-z0-9_/]+$/.test(table) || table.includes('..')) {
      dropped.push(`${id}: "${table}" is not a loot table path`)
      continue
    }

    const drops: LootDrop[] = []

    for (const value of Array.isArray(rule.drops) ? rule.drops : []) {
      if (!value || typeof value !== 'object') continue
      const drop = value as Record<string, unknown>

      const item = resolveItemId(typeof drop.item === 'string' ? drop.item : '')
      if (!item) {
        dropped.push(`${id}: "${String(drop.item)}" is not an item`)
        continue
      }

      const min = Math.max(1, Math.min(64, Math.round(Number(drop.min) || 1)))
      const max = Math.max(min, Math.min(64, Math.round(Number(drop.max) || min)))

      const asked = Number(drop.chance)
      const chance = Number.isFinite(asked) && asked > 0 ? Math.min(1, asked) : 1

      drops.push({ item, min, max, chance })
    }

    if (drops.length === 0) {
      dropped.push(`${id}: nothing in it would drop`)
      continue
    }

    rules.push({ id, table, drops })
  }

  if (rules.length === 0) return null

  const name =
    typeof source.name === 'string' && source.name.trim()
      ? source.name.trim().slice(0, 40)
      : 'Custom loot'

  return { pack: { name, rules }, dropped }
}

/**
 * One drop as a loot pool, ready to be appended to a vanilla table.
 *
 * A pool each rather than one pool of weighted entries, so that "five percent
 * emeralds and ten percent diamonds" means exactly that. Sharing a pool would
 * make them compete, and the second number would quietly stop being true.
 */
export function lootPool(drop: LootDrop): Record<string, unknown> {
  const entry: Record<string, unknown> = {
    type: 'minecraft:item',
    name: `minecraft:${drop.item}`
  }

  if (drop.min !== 1 || drop.max !== 1) {
    entry.functions = [
      {
        function: 'minecraft:set_count',
        count: { type: 'minecraft:uniform', min: drop.min, max: drop.max }
      }
    ]
  }

  const pool: Record<string, unknown> = { rolls: 1, entries: [entry] }

  if (drop.chance < 1) {
    pool.conditions = [{ condition: 'minecraft:random_chance', chance: drop.chance }]
  }

  return pool
}

/** A pack namespace that cannot escape its folder. */
export function packNamespace(name: string): string {
  const clean = name.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '')
  return clean || 'custom'
}

/** Every file the pack needs, ready to be zipped. */
export function recipePackFiles(
  pack: RecipePack,
  packFormat: number
): { path: string; content: string }[] {
  const namespace = packNamespace(pack.name)

  const files = [
    {
      path: 'pack.mcmeta',
      content: JSON.stringify(packMcmeta(packFormat, pack.name), null, 2)
    }
  ]

  for (const recipe of pack.recipes) {
    files.push({
      path: `data/${namespace}/recipe/${recipe.id}.json`,
      content: recipeJson(recipe)
    })
  }

  return files
}

/* -------------------------------------------------------------------- logo */

/**
 * A server logo: the name, set in Minecraft's own lettering.
 *
 * Deliberately not a picture. Neither GLM nor Ollama can draw one, and a logo
 * that is a photograph of nothing in particular is worse than a wordmark - what
 * a server logo actually needs to do is say the name, legibly, in a way that
 * looks like the game. So the model picks the wording and the palette and the
 * canvas does the lettering, pixel for pixel.
 */
export interface LogoDesign {
  name: string
  tagline: string
  /** Left to right across the letters. One colour means no gradient. */
  colours: string[]
  outline: string
  background: string
  /** Whether the background is drawn at all, or left clear for overlaying. */
  transparent: boolean
  taglineColour: string
}

export const MAX_LOGO_COLOURS = 4

export function logoPrompt(): string {
  return [
    'You design wordmark logos for Minecraft servers.',
    'Answer with one JSON object and nothing else.',
    '',
    'Shape: {"name":"<the server name>","tagline":"<a few words, may be empty>",',
    '        "colours":["#rrggbb"],"outline":"#rrggbb","background":"#rrggbb",',
    '        "taglineColour":"#rrggbb"}',
    '',
    `colours runs left to right across the letters as a gradient - 1 to ${MAX_LOGO_COLOURS} of them.`,
    'outline is drawn around every letter, so it must contrast with the colours.',
    'background sits behind everything; pick something the letters stand out against.',
    'Keep the name short enough to read at a glance. No commentary, no code fences.'
  ].join('\n')
}

export function readLogo(raw: unknown): LogoDesign | null {
  if (!raw || typeof raw !== 'object') return null
  const source = raw as Record<string, unknown>

  const hex = (v: unknown, fallback: string): string =>
    typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : fallback

  const name = typeof source.name === 'string' ? source.name.trim().slice(0, 24) : ''
  if (!name) return null

  const colours = (Array.isArray(source.colours) ? source.colours : [])
    .filter((c): c is string => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c))
    .slice(0, MAX_LOGO_COLOURS)

  return {
    name,
    tagline: typeof source.tagline === 'string' ? source.tagline.trim().slice(0, 48) : '',
    colours: colours.length ? colours : ['#FFD83D', '#F9801D'],
    outline: hex(source.outline, '#1D1D21'),
    background: hex(source.background, '#0B1020'),
    taglineColour: hex(source.taglineColour, '#AAAAAA'),
    transparent: false
  }
}

/** The colour a letter takes, given where it sits across the word. */
export function gradientAt(colours: string[], fraction: number): string {
  if (colours.length === 1) return colours[0]

  const span = 1 / (colours.length - 1)
  const step = Math.min(colours.length - 2, Math.floor(fraction / span))
  const within = (fraction - step * span) / span

  const mix = (at: number): number => {
    const from = parseInt(colours[step].slice(at, at + 2), 16)
    const to = parseInt(colours[step + 1].slice(at, at + 2), 16)
    return Math.round(from + (to - from) * within)
  }

  const hex = (v: number): string => v.toString(16).padStart(2, '0')
  return `#${hex(mix(1))}${hex(mix(3))}${hex(mix(5))}`
}

/* --------------------------------------------------------------- fireworks */

export interface FireworkBurst {
  shape: string
  colours: string[]
  fades: string[]
  trail: boolean
  twinkle: boolean
}

export interface FireworkDesign {
  name: string
  /** 1 to 3. How long it climbs before it goes off. */
  flight: number
  bursts: FireworkBurst[]
}

/** The game caps a rocket at 3 gunpowder, so a flight beyond that is not real. */
export const MAX_FLIGHT = 3
export const MAX_BURSTS = 6

const isHex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)

/** `#RRGGBB` as the integer the firework component wants. */
export function colourToInt(hexish: string): number {
  return parseInt(hexish.slice(1), 16)
}

/**
 * The command that hands somebody this firework.
 *
 * Item components, which is 1.20.5 and later — the same cut-off the banner
 * command has, and checked by the caller in the same way.
 */
export function fireworkCommand(design: FireworkDesign, target: string): string {
  const bursts = design.bursts
    .map((burst) => {
      const colours = burst.colours.map(colourToInt).join(',')
      const fades = burst.fades.map(colourToInt).join(',')

      const parts = [`shape:"${burst.shape}"`, `colors:[I;${colours}]`]
      if (burst.fades.length) parts.push(`fade_colors:[I;${fades}]`)
      if (burst.trail) parts.push('has_trail:true')
      if (burst.twinkle) parts.push('has_twinkle:true')

      return `{${parts.join(',')}}`
    })
    .join(',')

  const name = design.name.trim()
  const named = name ? `,minecraft:custom_name=${quoted(JSON.stringify(name))}` : ''

  return (
    `give ${target} minecraft:firework_rocket[minecraft:fireworks=` +
    `{flight_duration:${design.flight},explosions:[${bursts}]}${named}] 1`
  )
}

export function fireworkPrompt(): string {
  return [
    'You design Minecraft fireworks. Answer with one JSON object and nothing else.',
    '',
    'Shape: {"name":"<short name>","flight":1,"bursts":[',
    '  {"shape":"<shape>","colours":["#rrggbb"],"fades":["#rrggbb"],"trail":true,"twinkle":false}]}',
    '',
    `Shapes: ${FIREWORK_SHAPES.join(', ')}`,
    `flight is 1, 2 or 3. Use 1 to ${MAX_BURSTS} bursts.`,
    'colours is required and may hold several. fades may be empty.',
    'No commentary, no code fences.'
  ].join('\n')
}

export function readFirework(raw: unknown): { design: FireworkDesign; dropped: number } | null {
  if (!raw || typeof raw !== 'object') return null
  const source = raw as Record<string, unknown>

  const listed = Array.isArray(source.bursts) ? source.bursts : []
  const bursts: FireworkBurst[] = []
  let dropped = 0

  for (const entry of listed) {
    if (bursts.length >= MAX_BURSTS) break
    const b = entry as Record<string, unknown>

    const shape = typeof b?.shape === 'string' ? b.shape.replace(/^minecraft:/, '') : ''
    const colours = (Array.isArray(b?.colours) ? b.colours : []).filter(isHex)
    const fades = (Array.isArray(b?.fades) ? b.fades : []).filter(isHex)

    if (!FIREWORK_SHAPES.includes(shape) || colours.length === 0) {
      dropped++
      continue
    }

    bursts.push({
      shape,
      colours: colours.slice(0, 8),
      fades: fades.slice(0, 8),
      trail: b.trail === true,
      twinkle: b.twinkle === true
    })
  }

  if (bursts.length === 0) return null

  const flight = typeof source.flight === 'number' ? Math.round(source.flight) : 1
  const name =
    typeof source.name === 'string' && source.name.trim()
      ? source.name.trim().slice(0, 48)
      : 'Firework'

  return {
    design: { name, flight: Math.max(1, Math.min(MAX_FLIGHT, flight)), bursts },
    dropped
  }
}

/* -------------------------------------------------------------------- items */

export interface ItemEnchant {
  id: string
  level: number
}

export interface ItemDesign {
  id: string
  name: string
  lore: string[]
  enchants: ItemEnchant[]
  unbreakable: boolean
  count: number
}

export const MAX_LORE = 8

const ITEM_IDS = new Set(ITEMS.map(([id]) => id))
const ENCHANT_BY_ID = new Map(ENCHANTMENTS.map((e) => [e.id, e]))

export function isItemId(value: string): boolean {
  return ITEM_IDS.has(value.replace(/^minecraft:/, ''))
}

/**
 * The item somebody meant, when what they wrote is not quite an id.
 *
 * Models name the kind of thing rather than the item: asked for a legendary
 * sword, a local model answered `"id":"sword"`, which is not an item and threw
 * away an otherwise perfectly good design over one field. So a bare word that
 * matches the tail of real ids resolves to the shortest of them - shortest
 * because it is deterministic and tends to be the plainest, and because the
 * caller is told what happened and the tab has a picker to change it in one
 * click.
 *
 * Returns null when there is nothing sensible to resolve to, which is still a
 * failure worth reporting rather than a guess worth making.
 */
export function resolveItemId(value: string): string | null {
  const wanted = value.replace(/^minecraft:/, '').trim().toLowerCase()
  if (!wanted) return null
  if (ITEM_IDS.has(wanted)) return wanted

  const tail = '_' + wanted
  const candidates = ITEMS.map(([id]) => id).filter((id) => id.endsWith(tail))
  if (candidates.length === 0) return null

  return candidates.reduce((best, id) => (id.length < best.length ? id : best))
}

/**
 * Text as a `/give` component wants it.
 *
 * Names and lore are text components, so they are JSON inside a command that is
 * itself picky about quoting. Single quotes around the JSON keeps the double
 * quotes inside it intact.
 */
function textComponent(text: string, italic: boolean): string {
  /*
   * `&a` becomes `§a` on the way out.
   *
   * The client still renders legacy codes inside a text component, but only
   * the section sign - an ampersand is just an ampersand, so a name written
   * `&6&lKingsbane` arrived in game reading exactly that, codes and all.
   */
  const coloured = text.replace(/&(?=[0-9a-fk-or])/gi, '\u00a7')
  return JSON.stringify(italic ? { text: coloured } : { text: coloured, italic: false })
}

/**
 * Whether this is something `/give` will accept as a target.
 *
 * Written because the target was a text box holding "@a", and typing a name
 * into it produced "@aDave0734" - which is a complete selector followed by
 * rubbish. The server took the command, refused it, and the launcher had
 * already said "Handed over in game", so the only sign anything was wrong was
 * an error in a log nobody was reading.
 */
export function validTarget(value: string): boolean {
  const target = value.trim()
  if (!target) return false

  // A selector, optionally with arguments: @a, @p, @s, @e[type=pig].
  if (target.startsWith('@')) return /^@[aprse](\[[^\]]*\])?$/.test(target)

  // Otherwise a player name, which is what Mojang allows one to be.
  return /^[A-Za-z0-9_]{3,16}$/.test(target)
}

/**
 * A JSON text component, wrapped as a single-quoted SNBT string.
 *
 * The wrapping used to be a bare pair of quotes, so an item called "Grand Line
 * Champion's Rod" ended its own string at the apostrophe and the rest of the
 * command became rubbish the parser could not read:
 *
 *   Expected ']' at position 90: ... Champion'
 *
 * Backslashes are escaped first, or escaping the quotes would then escape the
 * escapes.
 */
export function quoted(json: string): string {
  return "'" + json.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"
}

export function itemCommand(design: ItemDesign, target: string): string {
  const parts: string[] = []

  if (design.name.trim()) {
    parts.push(`minecraft:custom_name=${quoted(textComponent(design.name.trim(), false))}`)
  }

  const lore = design.lore.filter((l) => l.trim())
  if (lore.length) {
    parts.push(
      `minecraft:lore=[${lore.map((l) => quoted(textComponent(l, false))).join(',')}]`
    )
  }

  if (design.enchants.length) {
    const levels = design.enchants
      .map((e) => `"minecraft:${e.id}":${e.level}`)
      .join(',')
    parts.push(`minecraft:enchantments={${levels}}`)
  }

  if (design.unbreakable) parts.push('minecraft:unbreakable={}')

  const components = parts.length ? `[${parts.join(',')}]` : ''
  const count = Math.max(1, Math.min(99, design.count))

  return `give ${target} minecraft:${design.id}${components} ${count}`
}

export function itemPrompt(): string {
  /*
   * The enchantment list is given in full and the item list is not.
   *
   * There are forty-three enchantments and fifteen hundred items; naming them
   * all would be most of a prompt. Enchantments are the half a model gets wrong
   * - inventing "sharpness_v" or asking for Fortune on a sword - and an item id
   * that does not exist is caught by the reader below and reported.
   */
  return [
    'You design custom Minecraft items. Answer with one JSON object and nothing else.',
    '',
    'Shape: {"id":"<item id>","name":"<display name>","lore":["<line>"],',
    '        "enchants":[{"id":"<enchantment>","level":1}],"unbreakable":false,"count":1}',
    '',
    'id is a plain Minecraft item id such as diamond_sword or golden_apple.',
    '',
    'Enchantments, with the highest level each may have:',
    ENCHANTMENTS.map((e) => `${e.id} (${e.maxLevel})`).join(', '),
    '',
    `At most ${MAX_LORE} lines of lore. Colour name and lore with & codes if you like.`,
    'Only put enchantments on an item that could carry them. No commentary, no code fences.'
  ].join('\n')
}

export function readItem(raw: unknown): { design: ItemDesign; dropped: string[] } | null {
  if (!raw || typeof raw !== 'object') return null
  const source = raw as Record<string, unknown>

  const asked = typeof source.id === 'string' ? source.id : ''
  const id = resolveItemId(asked)
  if (!id) return null

  const dropped: string[] = []
  if (id !== asked.replace(/^minecraft:/, '').trim()) {
    dropped.push(`"${asked}" is not an item, used ${id}`)
  }
  const enchants: ItemEnchant[] = []

  for (const entry of Array.isArray(source.enchants) ? source.enchants : []) {
    const e = entry as Record<string, unknown>
    const ident = typeof e?.id === 'string' ? e.id.replace(/^minecraft:/, '') : ''
    const known = ENCHANT_BY_ID.get(ident)

    if (!known) {
      dropped.push(ident || '?')
      continue
    }

    /*
     * Clamped rather than refused. A model asking for Sharpness 10 wants a very
     * sharp sword, and the game's own maximum is a better answer than nothing -
     * but the caller is told, so the difference is never a surprise.
     */
    const asked = typeof e.level === 'number' ? Math.round(e.level) : 1
    const level = Math.max(1, Math.min(known.maxLevel, asked))
    if (level !== asked) dropped.push(`${ident} ${asked} capped to ${level}`)

    enchants.push({ id: ident, level })
  }

  const lore = (Array.isArray(source.lore) ? source.lore : [])
    .filter((l): l is string => typeof l === 'string')
    .slice(0, MAX_LORE)

  const count = typeof source.count === 'number' ? Math.round(source.count) : 1

  return {
    design: {
      id,
      name: typeof source.name === 'string' ? source.name.slice(0, 64) : '',
      lore,
      enchants,
      unbreakable: source.unbreakable === true,
      count: Math.max(1, Math.min(99, count))
    },
    dropped
  }
}
