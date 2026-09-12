/**
 * Redstone, as a thing you can lay out and then paste.
 *
 * The format is a list of blocks offset from one corner, each carrying a full
 * block state string - `minecraft:repeater[facing=north,delay=2]` - rather
 * than a material name. That is the whole reason this can work at all: a
 * repeater without its facing and delay is not a repeater, it is a repeater
 * pointing the wrong way with the wrong timing, and a circuit made of those
 * does nothing while looking exactly right.
 *
 * Every property name below was read out of the 26.2 jar's own blockstate
 * files rather than remembered.
 */

export type Facing = 'north' | 'east' | 'south' | 'west'

/** The faces a lever or torch can be stuck to. */
export type Face = 'floor' | 'wall' | 'ceiling'

/**
 * What a component needs to be described.
 *
 * `aim` says whether facing means anything for it: dust and a redstone block
 * have no direction, and offering one would be a control that does nothing.
 */
export interface Component {
  id: string
  label: string
  /** The block id, without the namespace. */
  block: string
  /** Whether it points somewhere. */
  aim: boolean
  /** Repeaters, and only repeaters, carry a delay. */
  delay?: boolean
  /** Levers and torches stick to a face rather than sitting on the ground. */
  face?: boolean
  /** Comparators can subtract. */
  mode?: boolean
  /** For the grid: a short mark and a colour, so a layout reads at a glance. */
  mark: string
  colour: string
}

export const COMPONENTS: Component[] = [
  { id: 'air', label: 'Erase', block: 'air', aim: false, mark: '', colour: 'transparent' },
  { id: 'dust', label: 'Dust', block: 'redstone_wire', aim: false, mark: '·', colour: '#d33' },
  { id: 'block', label: 'Redstone block', block: 'redstone_block', aim: false, mark: '■', colour: '#c22' },
  { id: 'torch', label: 'Torch', block: 'redstone_torch', aim: false, face: true, mark: '↑', colour: '#e55' },
  { id: 'repeater', label: 'Repeater', block: 'repeater', aim: true, delay: true, mark: '▸', colour: '#ccc' },
  { id: 'comparator', label: 'Comparator', block: 'comparator', aim: true, mode: true, mark: '◆', colour: '#bbb' },
  { id: 'observer', label: 'Observer', block: 'observer', aim: true, mark: '◉', colour: '#9aa' },
  { id: 'piston', label: 'Piston', block: 'piston', aim: true, mark: '▭', colour: '#b9a' },
  { id: 'sticky', label: 'Sticky piston', block: 'sticky_piston', aim: true, mark: '▤', colour: '#9b8' },
  { id: 'lever', label: 'Lever', block: 'lever', aim: true, face: true, mark: '/', colour: '#dc9' },
  { id: 'button', label: 'Button', block: 'stone_button', aim: true, face: true, mark: '•', colour: '#aaa' },
  { id: 'lamp', label: 'Lamp', block: 'redstone_lamp', aim: false, mark: '◎', colour: '#eb6' },
  { id: 'target', label: 'Target', block: 'target', aim: false, mark: '◍', colour: '#d98' },
  { id: 'hopper', label: 'Hopper', block: 'hopper', aim: true, mark: '▽', colour: '#889' },
  { id: 'dropper', label: 'Dropper', block: 'dropper', aim: true, mark: '▣', colour: '#998' },
  { id: 'dispenser', label: 'Dispenser', block: 'dispenser', aim: true, mark: '▨', colour: '#a98' },
  { id: 'note', label: 'Note block', block: 'note_block', aim: false, mark: '♪', colour: '#a87' },
  { id: 'solid', label: 'Solid block', block: 'smooth_stone', aim: false, mark: '□', colour: '#889' },
  { id: 'slab', label: 'Slab', block: 'smooth_stone_slab', aim: false, mark: '▁', colour: '#778' },
  { id: 'glass', label: 'Glass', block: 'glass', aim: false, mark: '▢', colour: '#7ab' }
]

export const componentFor = (id: string): Component | undefined => COMPONENTS.find((component) => component.id === id)

/** One placed component: where it sits, and how it is set. */
export interface Placed {
  x: number
  y: number
  z: number
  component: string
  facing: Facing
  /** 1 to 4, repeaters only. */
  delay: number
  face: Face
  subtract: boolean
}

export interface Circuit {
  name: string
  /** Footprint. Height is however many layers have anything on them. */
  width: number
  depth: number
  layers: number
  placed: Placed[]
}

export const MAX_SIDE = 32
export const MAX_LAYERS = 8

export function emptyCircuit(): Circuit {
  return { name: 'Circuit', width: 12, depth: 12, layers: 3, placed: [] }
}

/**
 * The block state string the server will be handed.
 *
 * Only the properties a block actually has are written. An unknown property
 * makes Bukkit refuse the whole string, so a repeater given a `face` would not
 * place at all - and the failure arrives as one line in a log rather than as
 * anything visible.
 */
export function blockDataFor(placed: Placed): string {
  const component = componentFor(placed.component)
  if (!component || component.block === 'air') return 'minecraft:air'

  const props: string[] = []

  if (component.aim && !component.face) props.push(`facing=${placed.facing}`)
  if (component.delay) props.push(`delay=${Math.min(4, Math.max(1, placed.delay))}`)
  if (component.mode) props.push(`mode=${placed.subtract ? 'subtract' : 'compare'}`)

  /*
   * A lever or button on the floor or ceiling still carries a facing, which
   * is the direction it points when placed there. On a wall the block id stays
   * the same and `face=wall` is what changes - unlike a torch, which becomes a
   * different block entirely.
   */
  if (component.face && component.id !== 'torch') {
    props.push(`face=${placed.face}`)
    props.push(`facing=${placed.facing}`)
  }

  // A torch on a wall is `redstone_wall_torch`, not `redstone_torch[face=wall]`.
  if (component.id === 'torch' && placed.face === 'wall') {
    return `minecraft:redstone_wall_torch[facing=${placed.facing}]`
  }

  return props.length > 0 ? `minecraft:${component.block}[${props.join(',')}]` : `minecraft:${component.block}`
}

/** What gets sent: one entry per placed block, offset from the near corner. */
export interface CircuitPiece {
  dx: number
  dy: number
  dz: number
  data: string
}

export function piecesOf(circuit: Circuit): CircuitPiece[] {
  return circuit.placed
    .filter((placed) => placed.component !== 'air')
    .map((placed) => ({
      dx: placed.x,
      dy: placed.y,
      dz: placed.z,
      data: blockDataFor(placed)
    }))
}

/** Turning the whole design a quarter turn, facings included. */
const CLOCKWISE: Record<Facing, Facing> = {
  north: 'east',
  east: 'south',
  south: 'west',
  west: 'north'
}

/**
 * Rotates the layout a quarter turn clockwise.
 *
 * Every facing turns with it, which is the part worth having: rotating the
 * positions alone leaves a circuit that looks turned and is wired across
 * itself, and that is not obvious until it fails to work.
 */
export function rotate(circuit: Circuit): Circuit {
  return {
    ...circuit,
    width: circuit.depth,
    depth: circuit.width,
    placed: circuit.placed.map((placed) => ({
      ...placed,
      x: circuit.depth - 1 - placed.z,
      z: placed.x,
      facing: CLOCKWISE[placed.facing]
    }))
  }
}
