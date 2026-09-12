import { existsSync } from 'node:fs'
import AdmZip from 'adm-zip'

import { versionJarPath } from '../../services/minecraft/versionService'
import { createLogger } from '../../core/logger'
import type { PaletteBlock } from '@shared/blocks'

const log = createLogger('palette')

/**
 * The blocks the studio offers, wearing the game's own faces.
 *
 * Read out of the version jar rather than drawn or approximated, because a
 * studio showing coloured squares is a studio you cannot judge a build in -
 * the whole point of laying one out is seeing whether the stone goes with the
 * planks, and two grey rectangles never answer that.
 *
 * A block id and its texture are not the same string often enough to matter.
 * `stone` is `block/stone.png`, but quartz is `quartz_block_side`, basalt is
 * `basalt_side`, and the nether woods are stems rather than logs. Where they
 * differ it is written down; every one below was checked against a 26.2 jar.
 */

interface Candidate {
  id: string
  group: string
  /** Only when the texture is not named after the block. */
  texture?: string
  /**
   * What the underside uses, when it is neither the top nor the side.
   *
   * Only the blocks that sit on the ground need this. A log's ends match, and
   * so do a hay bale's, but grass over dirt is dirt underneath - and reading
   * the top texture for it would put a lid of turf on the bottom of the world.
   */
  under?: string
}

const WOODS = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry', 'pale_oak']

const COLOURS = [
  'white',
  'light_gray',
  'gray',
  'black',
  'brown',
  'red',
  'orange',
  'yellow',
  'lime',
  'green',
  'cyan',
  'light_blue',
  'blue',
  'purple',
  'magenta',
  'pink'
]

function candidates(): Candidate[] {
  const out: Candidate[] = [
    { id: 'stone', group: 'Stone' },
    { id: 'smooth_stone', group: 'Stone' },
    { id: 'cobblestone', group: 'Stone' },
    { id: 'mossy_cobblestone', group: 'Stone' },
    { id: 'stone_bricks', group: 'Stone' },
    { id: 'mossy_stone_bricks', group: 'Stone' },
    { id: 'cracked_stone_bricks', group: 'Stone' },
    { id: 'chiseled_stone_bricks', group: 'Stone' },
    { id: 'andesite', group: 'Stone' },
    { id: 'polished_andesite', group: 'Stone' },
    { id: 'diorite', group: 'Stone' },
    { id: 'polished_diorite', group: 'Stone' },
    { id: 'granite', group: 'Stone' },
    { id: 'polished_granite', group: 'Stone' },
    { id: 'deepslate', group: 'Stone' },
    { id: 'cobbled_deepslate', group: 'Stone' },
    { id: 'polished_deepslate', group: 'Stone' },
    { id: 'deepslate_bricks', group: 'Stone' },
    { id: 'deepslate_tiles', group: 'Stone' },
    { id: 'chiseled_deepslate', group: 'Stone' },
    { id: 'tuff', group: 'Stone' },
    { id: 'calcite', group: 'Stone' },
    { id: 'blackstone', group: 'Stone' },
    { id: 'polished_blackstone', group: 'Stone' },
    { id: 'polished_blackstone_bricks', group: 'Stone' },
    { id: 'gilded_blackstone', group: 'Stone' },
    { id: 'basalt', group: 'Stone', texture: 'basalt_side' },
    { id: 'smooth_basalt', group: 'Stone' },
    { id: 'bricks', group: 'Stone' },
    { id: 'mud_bricks', group: 'Stone' },
    { id: 'packed_mud', group: 'Stone' },
    { id: 'sandstone', group: 'Stone' },
    { id: 'chiseled_sandstone', group: 'Stone' },
    { id: 'cut_sandstone', group: 'Stone' },
    { id: 'red_sandstone', group: 'Stone' },
    { id: 'prismarine', group: 'Stone' },
    { id: 'prismarine_bricks', group: 'Stone' },
    { id: 'dark_prismarine', group: 'Stone' },
    { id: 'quartz_block', group: 'Stone', texture: 'quartz_block_side' },
    { id: 'quartz_bricks', group: 'Stone' },
    { id: 'chiseled_quartz_block', group: 'Stone' },
    { id: 'purpur_block', group: 'Stone' },
    { id: 'end_stone', group: 'Stone' },
    { id: 'end_stone_bricks', group: 'Stone' },
    { id: 'obsidian', group: 'Stone' },
    { id: 'crying_obsidian', group: 'Stone' },
    { id: 'netherrack', group: 'Stone' },
    { id: 'nether_bricks', group: 'Stone' },
    { id: 'red_nether_bricks', group: 'Stone' },

    { id: 'dirt', group: 'Ground' },
    { id: 'coarse_dirt', group: 'Ground' },
    { id: 'rooted_dirt', group: 'Ground' },
    { id: 'podzol', group: 'Ground', texture: 'podzol_side', under: 'dirt' },
    { id: 'grass_block', group: 'Ground', texture: 'grass_block_side', under: 'dirt' },
    { id: 'sand', group: 'Ground' },
    { id: 'red_sand', group: 'Ground' },
    { id: 'gravel', group: 'Ground' },
    { id: 'clay', group: 'Ground' },
    { id: 'mud', group: 'Ground' },
    { id: 'snow_block', group: 'Ground', texture: 'snow' },
    { id: 'ice', group: 'Ground' },
    { id: 'packed_ice', group: 'Ground' },
    { id: 'blue_ice', group: 'Ground' },
    { id: 'moss_block', group: 'Ground' },
    { id: 'soul_sand', group: 'Ground' },
    { id: 'soul_soil', group: 'Ground' },

    { id: 'glass', group: 'Light and glass' },
    { id: 'tinted_glass', group: 'Light and glass' },
    { id: 'glowstone', group: 'Light and glass' },
    { id: 'shroomlight', group: 'Light and glass' },
    { id: 'sea_lantern', group: 'Light and glass' },
    { id: 'magma_block', group: 'Light and glass', texture: 'magma' },
    { id: 'honeycomb_block', group: 'Light and glass' },

    { id: 'iron_block', group: 'Metal and gem' },
    { id: 'gold_block', group: 'Metal and gem' },
    { id: 'diamond_block', group: 'Metal and gem' },
    { id: 'emerald_block', group: 'Metal and gem' },
    { id: 'netherite_block', group: 'Metal and gem' },
    { id: 'copper_block', group: 'Metal and gem' },
    { id: 'oxidized_copper', group: 'Metal and gem' },
    { id: 'amethyst_block', group: 'Metal and gem' },
    { id: 'lapis_block', group: 'Metal and gem' },
    { id: 'redstone_block', group: 'Metal and gem' },

    { id: 'bookshelf', group: 'Bits' },
    { id: 'crafting_table', group: 'Bits', texture: 'crafting_table_front', under: 'oak_planks' },
    { id: 'furnace', group: 'Bits', texture: 'furnace_front' },
    { id: 'hay_block', group: 'Bits', texture: 'hay_block_side' },
    { id: 'note_block', group: 'Bits' },
    { id: 'jukebox', group: 'Bits', texture: 'jukebox_side' },
    { id: 'tnt', group: 'Bits', texture: 'tnt_side' },
    { id: 'target', group: 'Bits', texture: 'target_side' },
    { id: 'bamboo_block', group: 'Wood' },
    { id: 'crimson_stem', group: 'Wood' },
    { id: 'warped_stem', group: 'Wood' },
    { id: 'crimson_planks', group: 'Wood' },
    { id: 'warped_planks', group: 'Wood' },
    { id: 'bamboo_planks', group: 'Wood' }
  ]

  for (const wood of WOODS) {
    out.push({ id: `${wood}_planks`, group: 'Wood' })
    out.push({ id: `${wood}_log`, group: 'Wood' })
    out.push({ id: `stripped_${wood}_log`, group: 'Wood' })
  }

  for (const colour of COLOURS) {
    out.push({ id: `${colour}_wool`, group: 'Wool' })
    out.push({ id: `${colour}_concrete`, group: 'Concrete' })
    out.push({ id: `${colour}_terracotta`, group: 'Terracotta' })
    out.push({ id: `${colour}_stained_glass`, group: 'Light and glass' })
  }

  return out
}

/** "polished_blackstone_bricks" reads better as "Polished blackstone bricks". */
function label(id: string): string {
  const words = id.replace(/_/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

const cache = new Map<string, PaletteBlock[]>()

/**
 * Every offered block that this version actually has a face for.
 *
 * Anything missing is dropped rather than shown blank. Block names move
 * between versions - the nether woods became stems, bamboo became a block -
 * and a palette that renders a hole for those is one somebody clicks anyway.
 */
export function blockPalette(minecraftVersion: string): PaletteBlock[] {
  const cached = cache.get(minecraftVersion)
  if (cached) return cached

  try {
    const jar = versionJarPath(minecraftVersion)
    if (!existsSync(jar)) return []

    const zip = new AdmZip(jar)
    const out: PaletteBlock[] = []
    let missing = 0

    /** A texture as a data url, or nothing if this version has no such file. */
    const read = (name: string): string | undefined => {
      const entry = zip.getEntry(`assets/minecraft/textures/block/${name}.png`)
      return entry ? 'data:image/png;base64,' + entry.getData().toString('base64') : undefined
    }

    for (const candidate of candidates()) {
      const name = candidate.texture ?? candidate.id
      const side = read(name)

      if (!side) {
        missing += 1
        continue
      }

      /*
       * Which faces differ is asked of the jar rather than listed here.
       * The naming is consistent - `_top`, `_bottom`, `_side` beside the block
       * - so the file being there is the answer, and it stays the answer when
       * a version adds a wood or changes a texture out from under us.
       */
      const top = read(`${candidate.id}_top`)
      const under = candidate.under ? read(candidate.under) : undefined

      const block: PaletteBlock = {
        id: candidate.id,
        label: label(candidate.id),
        group: candidate.group,
        texture: side
      }

      if (top) block.top = top

      // Falls back to the top, which is right for anything with two matching
      // ends: a log's rings, a hay bale's cut, a quartz pillar's cap.
      const bottom = read(`${candidate.id}_bottom`) ?? under
      if (bottom) block.bottom = bottom

      /*
       * Grass is the one block stored without its colour. The top is a grey
       * mask and so is the fringe down the sides, both tinted as the game
       * draws them, so they are passed on as-is and coloured by the renderer.
       */
      if (candidate.id === 'grass_block') {
        block.tintTop = true
        const overlay = read('grass_block_side_overlay')
        if (overlay) block.overlay = overlay
      }

      out.push(block)
    }

    if (missing > 0) {
      log.info(`${missing} palette block(s) have no texture in ${minecraftVersion}, left out`)
    }

    cache.set(minecraftVersion, out)
    return out
  } catch (err) {
    log.warn(`could not read the block palette: ${(err as Error).message}`)
    return []
  }
}
