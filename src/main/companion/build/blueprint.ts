/**
 * Blueprints: what to build, as data.
 *
 * The format is deliberately a picture rather than a list of coordinates. A
 * language model asked for 400 `{x,y,z,block}` objects produces a wall with
 * three holes in it and runs out of output tokens halfway through a roof; asked
 * for a stack of layers drawn as characters, it produces something that looks
 * like the thing, because it can see the shape while writing it. The same
 * blueprint is also an order of magnitude smaller.
 *
 * A layer is a grid of characters, each one indexing into a palette. A dot
 * means "leave whatever is there", which is what makes doors, windows and
 * hollow interiors expressible.
 */

export interface Blueprint {
  name: string
  /** One entry per character used in the layers, mapping to a Minecraft block id. */
  palette: Record<string, string>
  /**
   * Bottom layer first. Each layer is an array of rows (increasing z), each row
   * a string of characters (increasing x). Every row in a blueprint is the same
   * length, and every layer has the same number of rows.
   */
  layers: string[][]
  /** A sentence about what it is, shown to the player. */
  description?: string
}

export interface BlueprintBlock {
  /** Offset from the build origin, not world coordinates. */
  dx: number
  dy: number
  dz: number
  /** Plain block name, for placing in game. */
  block: string
  /** Name plus any block state, for writing to a schematic. */
  id: string
}

/**
 * Splits `oak_stairs[facing=east,half=top]` into its name and its properties.
 *
 * Palette entries may carry a block state, and for redstone they must: a
 * repeater without a facing is a repeater pointing the wrong way, and a circuit
 * of correctly placed blocks in the wrong orientations does nothing at all.
 * Everything that only needs to know *which* block strips the state; the
 * schematic writers keep it.
 */
export function baseBlockName(id: string): string {
  return id.replace(/^minecraft:/, '').replace(/\[.*$/, '').trim()
}

export function blockState(id: string): Record<string, string> {
  const match = /\[([^\]]*)\]/.exec(id)
  if (!match) return {}

  const state: Record<string, string> = {}
  for (const pair of match[1].split(',')) {
    const [key, value] = pair.split('=')
    if (key && value) state[key.trim()] = value.trim()
  }
  return state
}

/** The character that means "do not place anything here". */
const SKIP = '.'

export interface BlueprintProblem {
  message: string
}

/**
 * Checks a blueprint is usable before anything is placed.
 *
 * A model gets these wrong in predictable ways — ragged row lengths, a
 * character with no palette entry, a palette naming a block that does not
 * exist — and each one produces a build that fails a third of the way in.
 * Catching them up front means the failure is a sentence rather than a
 * half-finished ruin.
 */
export function validateBlueprint(
  blueprint: Blueprint,
  isKnownBlock: (name: string) => boolean
): BlueprintProblem[] {
  const problems: BlueprintProblem[] = []

  if (!Array.isArray(blueprint.layers) || blueprint.layers.length === 0) {
    return [{ message: 'the blueprint has no layers' }]
  }

  const height = blueprint.layers.length
  const depth = blueprint.layers[0]?.length ?? 0
  const width = blueprint.layers[0]?.[0]?.length ?? 0

  if (depth === 0 || width === 0) return [{ message: 'the blueprint has an empty layer' }]

  for (let y = 0; y < height; y += 1) {
    const layer = blueprint.layers[y]
    if (!Array.isArray(layer) || layer.length !== depth) {
      problems.push({ message: `layer ${y + 1} has ${layer?.length ?? 0} rows, expected ${depth}` })
      continue
    }
    for (let z = 0; z < depth; z += 1) {
      if (typeof layer[z] !== 'string' || layer[z].length !== width) {
        problems.push({ message: `layer ${y + 1} row ${z + 1} is ${layer[z]?.length ?? 0} wide, expected ${width}` })
      }
    }
  }

  const used = new Set<string>()
  for (const layer of blueprint.layers) {
    for (const row of layer ?? []) {
      for (const character of String(row)) {
        if (character !== SKIP) used.add(character)
      }
    }
  }

  for (const character of used) {
    const block = blueprint.palette?.[character]
    if (!block) {
      problems.push({ message: `the character "${character}" is used but not in the palette` })
      continue
    }
    if (!isKnownBlock(baseBlockName(block))) {
      problems.push({ message: `"${block}" is not a Minecraft block` })
    }
  }

  return problems
}

export interface BlueprintSize {
  width: number
  height: number
  depth: number
}

export function blueprintSize(blueprint: Blueprint): BlueprintSize {
  return {
    height: blueprint.layers.length,
    depth: blueprint.layers[0]?.length ?? 0,
    width: blueprint.layers[0]?.[0]?.length ?? 0
  }
}

/**
 * Flattens a blueprint into the blocks to place, in the order to place them.
 *
 * Bottom to top, because a block in mid-air needs something below it to build
 * against — and within a layer, in a spiral from the outside in, so the bot
 * never walls itself into the middle of what it is building.
 */
export function blueprintBlocks(blueprint: Blueprint): BlueprintBlock[] {
  const blocks: BlueprintBlock[] = []
  const { width, depth } = blueprintSize(blueprint)

  for (let y = 0; y < blueprint.layers.length; y += 1) {
    const layer = blueprint.layers[y]
    const inLayer: BlueprintBlock[] = []

    for (let z = 0; z < layer.length; z += 1) {
      const row = layer[z]
      for (let x = 0; x < row.length; x += 1) {
        const character = row[x]
        if (character === SKIP) continue
        const block = blueprint.palette[character]
        if (!block) continue
        /*
         * The state is kept on the entry so the schematic writers can use it,
         * while `block` stays a plain name because the placement tool takes one.
         */
        inLayer.push({ dx: x, dy: y, dz: z, block: baseBlockName(block), id: block.replace(/^minecraft:/, '') })
      }
    }

    /*
     * Outside-in within each layer. Distance from the centre, descending: the
     * walls go up before the floor inside them is filled, so the bot spends its
     * time on the perimeter rather than standing where the next block goes.
     */
    const centreX = (width - 1) / 2
    const centreZ = (depth - 1) / 2
    inLayer.sort((a, b) => {
      const distanceA = Math.max(Math.abs(a.dx - centreX), Math.abs(a.dz - centreZ))
      const distanceB = Math.max(Math.abs(b.dx - centreX), Math.abs(b.dz - centreZ))
      return distanceB - distanceA
    })

    blocks.push(...inLayer)
  }

  return blocks
}

/** How many of each block the whole thing needs. */
export function billOfMaterials(blueprint: Blueprint): Map<string, number> {
  const bill = new Map<string, number>()
  for (const block of blueprintBlocks(blueprint)) {
    bill.set(block.block, (bill.get(block.block) ?? 0) + 1)
  }
  return bill
}

/**
 * Parses whatever the model returned into a blueprint.
 *
 * Models wrap JSON in prose and code fences however they feel, so the object is
 * located rather than assumed.
 */
export function parseBlueprint(text: string): Blueprint {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
  const candidate = fenced ? fenced[1] : text

  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('no JSON object in the reply')

  const parsed = JSON.parse(candidate.slice(start, end + 1)) as Partial<Blueprint>

  if (!parsed.palette || typeof parsed.palette !== 'object') throw new Error('the blueprint has no palette')
  if (!Array.isArray(parsed.layers)) throw new Error('the blueprint has no layers')

  return {
    name: String(parsed.name ?? 'Structure').slice(0, 60),
    description: parsed.description ? String(parsed.description).slice(0, 300) : undefined,
    palette: Object.fromEntries(
      Object.entries(parsed.palette).map(([key, value]) => [key.slice(0, 1), String(value).slice(0, 60)])
    ),
    layers: parsed.layers.map((layer) => (Array.isArray(layer) ? layer.map((row) => String(row)) : []))
  }
}
