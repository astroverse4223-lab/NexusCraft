/**
 * Turning what was drawn in the studio into the shape the exporter reads.
 *
 * A blueprint is a character grid with a key, which is a good format to read
 * and a poor one to draw into - so the studio keeps a list of placed blocks
 * and this makes the grid at the moment it is needed. Nothing is lost in the
 * conversion except the order things were placed in.
 */

export interface StudioCell {
  x: number
  y: number
  z: number
  block: string
}

export interface StudioBlueprint {
  name: string
  /** One character per distinct block, mapped to its id. */
  palette: Record<string, string>
  /** Bottom layer first; each layer is rows running north to south. */
  layers: string[][]
  description?: string
}

/**
 * The characters a layer grid can be written with.
 *
 * A dot is air and cannot be reused, and the rest are chosen to be things that
 * read clearly in a file somebody might open - no quotes, no backslashes,
 * nothing that needs escaping.
 */
const KEYS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&*+-=?@'

export const MAX_DISTINCT_BLOCKS = KEYS.length

export function blueprintFromCells(
  name: string,
  cells: StudioCell[],
  width: number,
  depth: number,
  layers: number
): StudioBlueprint {
  /*
   * Only the blocks actually used get a key.
   *
   * Writing the whole palette in would put a hundred and eighty entries in the
   * key of a build that used four, and every reader of the file then has to
   * work out which of them appear.
   */
  const used: string[] = []
  const keyFor = new Map<string, string>()

  const placed = new Map<string, string>()

  for (const cell of cells) {
    if (cell.x < 0 || cell.x >= width) continue
    if (cell.z < 0 || cell.z >= depth) continue
    if (cell.y < 0 || cell.y >= layers) continue

    if (!keyFor.has(cell.block)) {
      // Beyond the key characters the grid stops being writable at all, so the
      // block is left out rather than silently drawn as something else.
      if (used.length >= KEYS.length) continue

      keyFor.set(cell.block, KEYS[used.length])
      used.push(cell.block)
    }

    placed.set(`${cell.x},${cell.y},${cell.z}`, keyFor.get(cell.block) as string)
  }

  const palette: Record<string, string> = { '.': 'air' }
  for (const [block, key] of keyFor) palette[key] = block

  const grid: string[][] = []

  for (let y = 0; y < layers; y += 1) {
    const rows: string[] = []

    for (let z = 0; z < depth; z += 1) {
      let row = ''
      for (let x = 0; x < width; x += 1) row += placed.get(`${x},${y},${z}`) ?? '.'
      rows.push(row)
    }

    grid.push(rows)
  }

  return { name: name.trim() || 'Build', palette, layers: grid }
}

/**
 * Drops the empty layers off the top.
 *
 * The studio has a fixed number of layers whether or not anything is on them,
 * and exporting the empty ones makes a structure taller than what was built -
 * which matters when it is pasted against a ceiling.
 */
export function trimmed(blueprint: StudioBlueprint): StudioBlueprint {
  const layers = [...blueprint.layers]

  while (layers.length > 1 && layers[layers.length - 1].every((row) => /^\.*$/.test(row))) {
    layers.pop()
  }

  return { ...blueprint, layers }
}
