import type { Blueprint } from './blueprint'
import { REDSTONE_LIBRARY } from './redstone'

/**
 * Structures that ship with the launcher, drawn by hand.
 *
 * A model asked to design a building produces something plausible about three
 * times in four; the fourth is a box with a hole in it. These are the fallback
 * that always works, and the reference the model is shown when it is asked to
 * draw its own — every one of them is a legal blueprint under the same rules,
 * with real doorways, real windows and nothing floating.
 *
 * Layer 0 is the ground course. Rows run north to south, characters west to
 * east. A dot leaves the space alone, which is what makes openings possible.
 */

/**
 * What kind of thing a blueprint is, for grouping in the picker.
 *
 * The list had grown to thirty-five entries in one flat grid, and finding the
 * cottage among two dozen redstone contraptions meant reading every card. A
 * player looking for a house is not browsing; they know what they want.
 */
export type BlueprintCategory = 'building' | 'redstone' | 'farm'

export interface LibraryEntry {
  id: string
  /** One line on what it is and what it costs, for the picker. */
  blurb: string
  /** Which section it belongs to. Defaults to a building. */
  category?: BlueprintCategory
  blueprint: Blueprint
}

const STRUCTURES: LibraryEntry[] = [
  {
    id: 'cottage',
    blurb: 'A 7x7 oak cottage with a doorway, four windows and a pitched roof. Good first build.',
    blueprint: {
      name: 'Oak Cottage',
      description: 'A small home with a peaked roof, a doorway and windows on every side.',
      // No door in the palette on purpose: a door is a two-block item that the
      // single-block placement tool cannot set properly, so the opening is left
      // as a doorway rather than claiming a door that never appears.
      palette: { c: 'cobblestone', p: 'oak_planks', l: 'oak_log', g: 'glass', s: 'oak_stairs' },
      layers: [
        // Foundation
        ['ccccccc', 'ccccccc', 'ccccccc', 'ccccccc', 'ccccccc', 'ccccccc', 'ccccccc'],
        // Walls, with a doorway in the south face
        ['lpppppl', 'p.....p', 'p.....p', 'p.....p', 'p.....p', 'p.....p', 'lpp.ppl'],
        // Windows
        ['lpgpgpl', 'g.....g', 'p.....p', 'g.....g', 'p.....p', 'g.....g', 'lpg.gpl'],
        // Top course of the walls
        ['lpppppl', 'p.....p', 'p.....p', 'p.....p', 'p.....p', 'p.....p', 'lpppppl'],
        /*
         * The roof, in solid courses rather than rings.
         *
         * It was three hollow rings, each inset one block from the one below,
         * and that cannot be built at all: an inset ring sits diagonally above
         * the ring beneath it and shares a face with nothing. In game every one
         * of those blocks was refused, which is where "placed 56 of 168 blocks;
         * 99 failed" came from - the walls went up and the roof could not.
         *
         * Solid courses each rest squarely on the one below, so every block has
         * something to be placed against, and a stepped roof is what it looks
         * like from outside either way.
         */
        ['sssssss', 'sssssss', 'sssssss', 'sssssss', 'sssssss', 'sssssss', 'sssssss'],
        ['.......', '.sssss.', '.sssss.', '.sssss.', '.sssss.', '.sssss.', '.......'],
        ['.......', '.......', '..ppp..', '..ppp..', '..ppp..', '.......', '.......']
      ]
    }
  },

  {
    id: 'watchtower',
    blurb: 'A 5x5 stone tower, 13 high, with arrow slits and a crenellated top.',
    blueprint: {
      name: 'Stone Watchtower',
      description: 'A lookout tower with a ladder shaft, arrow slits and battlements.',
      palette: { s: 'stone_bricks', c: 'cobblestone', l: 'ladder', g: 'glass' },
      layers: [
        ['ccccc', 'ccccc', 'ccccc', 'ccccc', 'ccccc'],
        ['sssss', 's...s', 'sl..s', 's...s', 'ss.ss'],
        ['sssss', 's...s', 'sl..s', 's...s', 'sssss'],
        ['sgsgs', 's...s', 'sl..s', 's...s', 'sgsgs'],
        ['sssss', 's...s', 'sl..s', 's...s', 'sssss'],
        ['sssss', 's...s', 'sl..s', 's...s', 'sssss'],
        ['sgsgs', 's...s', 'sl..s', 's...s', 'sgsgs'],
        ['sssss', 's...s', 'sl..s', 's...s', 'sssss'],
        ['sssss', 's...s', 'sl..s', 's...s', 'sssss'],
        ['sgsgs', 's...s', 'sl..s', 's...s', 'sgsgs'],
        ['sssss', 'sssss', 'ss.ss', 'sssss', 'sssss'],
        ['s.s.s', '.....', 's...s', '.....', 's.s.s'],
        ['s...s', '.....', '.....', '.....', 's...s']
      ]
    }
  },

  {
    id: 'well',
    blurb: 'A 5x5 village well with a roof and a bucket. Cheap and charming.',
    blueprint: {
      name: 'Village Well',
      description: 'A cobblestone well with a shingled roof on four posts.',
      palette: { c: 'cobblestone', w: 'water', l: 'oak_log', s: 'oak_stairs', p: 'oak_planks' },
      layers: [
        ['ccccc', 'ccccc', 'ccwcc', 'ccccc', 'ccccc'],
        ['ccccc', 'c...c', 'c.w.c', 'c...c', 'ccccc'],
        ['l...l', '.....', '.....', '.....', 'l...l'],
        ['l...l', '.....', '.....', '.....', 'l...l'],
        // Solid, so the cap above has something to sit on. An inset ring over
        // a hollow one touches nothing and can never be placed.
        ['sssss', 'sssss', 'sssss', 'sssss', 'sssss'],
        ['.....', '.ppp.', '.ppp.', '.ppp.', '.....']
      ]
    }
  },

  {
    id: 'bridge',
    blurb: 'A 5-wide, 16-long arched stone bridge with railings and lanterns.',
    blueprint: {
      name: 'Stone Bridge',
      description: 'A flat-decked crossing with railings and a lantern at each end.',
      palette: { s: 'stone_bricks', c: 'cobblestone', f: 'stone_brick_wall', t: 'lantern' },
      layers: [
        [
          'ccccc', 'ccccc', 'c...c', 'c...c', 'c...c', 'c...c', 'c...c', 'c...c',
          'c...c', 'c...c', 'c...c', 'c...c', 'c...c', 'c...c', 'ccccc', 'ccccc'
        ],
        [
          'sssss', 'sssss', 'sssss', 'sssss', 'sssss', 'sssss', 'sssss', 'sssss',
          'sssss', 'sssss', 'sssss', 'sssss', 'sssss', 'sssss', 'sssss', 'sssss'
        ],
        [
          'f...f', 'f...f', 'f...f', 'f...f', 'f...f', 'f...f', 'f...f', 'f...f',
          'f...f', 'f...f', 'f...f', 'f...f', 'f...f', 'f...f', 'f...f', 'f...f'
        ],
        [
          't...t', '.....', '.....', '.....', '.....', '.....', '.....', '.....',
          '.....', '.....', '.....', '.....', '.....', '.....', '.....', 't...t'
        ]
      ]
    }
  },

  {
    id: 'lighthouse',
    blurb: 'A 7x7 tapering lighthouse, 15 high, with a glass lantern room.',
    blueprint: {
      name: 'Lighthouse',
      description: 'A white tower with a glazed light chamber at the top.',
      palette: { w: 'white_concrete', r: 'red_concrete', s: 'stone_bricks', g: 'glass', t: 'glowstone', o: 'oak_slab' },
      layers: [
        ['sssssss', 'sssssss', 'sssssss', 'sssssss', 'sssssss', 'sssssss', 'sssssss'],
        ['.wwwww.', 'w.....w', 'w.....w', 'w.....w', 'w.....w', 'w.....w', '.wwwww.'],
        ['.wwwww.', 'w.....w', 'w.....w', 'w.....w', 'w.....w', 'w.....w', '.ww.ww.'],
        ['.rrrrr.', 'r.....r', 'r.....r', 'r.....r', 'r.....r', 'r.....r', '.rrrrr.'],
        ['.wwwww.', 'w.....w', 'w.....w', 'w.....w', 'w.....w', 'w.....w', '.wwwww.'],
        ['..www..', '.w...w.', 'w.....w', 'w.....w', 'w.....w', '.w...w.', '..www..'],
        ['..rrr..', '.r...r.', 'r.....r', 'r.....r', 'r.....r', '.r...r.', '..rrr..'],
        ['..www..', '.w...w.', 'w.....w', 'w.....w', 'w.....w', '.w...w.', '..www..'],
        ['..www..', '.w...w.', 'w.....w', 'w.....w', 'w.....w', '.w...w.', '..www..'],
        ['..rrr..', '.r...r.', 'r.....r', 'r.....r', 'r.....r', '.r...r.', '..rrr..'],
        ['..ooo..', '.ooooo.', 'ooooooo', 'ooooooo', 'ooooooo', '.ooooo.', '..ooo..'],
        ['.......', '..ggg..', '.g...g.', '.g.t.g.', '.g...g.', '..ggg..', '.......'],
        ['.......', '..ggg..', '.g...g.', '.g.t.g.', '.g...g.', '..ggg..', '.......'],
        ['.......', '..ooo..', '.ooooo.', '.ooooo.', '.ooooo.', '..ooo..', '.......'],
        ['.......', '.......', '..ooo..', '..ooo..', '..ooo..', '.......', '.......']
      ]
    }
  },

  {
    id: 'keep',
    blurb: 'An 11x11 castle keep with corner towers, a gate and battlements. The big one.',
    blueprint: {
      name: 'Castle Keep',
      description: 'A square keep with four corner towers, a gatehouse and a walkable parapet.',
      palette: { s: 'stone_bricks', c: 'cobblestone', g: 'glass', o: 'oak_planks' },
      layers: [
        [
          'ccccccccccc', 'ccccccccccc', 'ccccccccccc', 'ccccccccccc', 'ccccccccccc', 'ccccccccccc',
          'ccccccccccc', 'ccccccccccc', 'ccccccccccc', 'ccccccccccc', 'ccccccccccc'
        ],
        [
          'sss.....sss', 'sss.....sss', 's.........s', '...........', '...........', '...........',
          '...........', '...........', 's.........s', 'sss.....sss', 'sss..s..sss'
        ],
        [
          'sssssssssss', 's.........s', 's.........s', 's.........s', 's.........s', 's.........s',
          's.........s', 's.........s', 's.........s', 's.........s', 'sssss.sssss'
        ],
        [
          'sssgsgsssss', 's.........s', 'g.........g', 's.........s', 's.........s', 'g.........g',
          's.........s', 's.........s', 'g.........g', 's.........s', 'sssgs.gssss'
        ],
        [
          'sssssssssss', 's.........s', 's.........s', 's.........s', 's.........s', 's.........s',
          's.........s', 's.........s', 's.........s', 's.........s', 'sssssssssss'
        ],
        [
          'sssgsgsssss', 's.........s', 'g.........g', 's.........s', 's.........s', 'g.........g',
          's.........s', 's.........s', 'g.........g', 's.........s', 'sssgsgsssss'
        ],
        [
          'sssssssssss', 'sooooooooos', 'sooooooooos', 'sooooooooos', 'sooooooooos', 'sooooooooos',
          'sooooooooos', 'sooooooooos', 'sooooooooos', 'sooooooooos', 'sssssssssss'
        ],
        [
          's.s.s.s.s.s', 's.........s', 's.........s', 's.........s', 's.........s', 's.........s',
          's.........s', 's.........s', 's.........s', 's.........s', 's.s.s.s.s.s'
        ],
        [
          'sss.....sss', 's.........s', 's.........s', '...........', '...........', '...........',
          '...........', '...........', 's.........s', 's.........s', 'sss.....sss'
        ]
      ]
    }
  },

  {
    id: 'a-frame',
    blurb: 'A steep spruce A-frame with a glass gable. Roof reaches the ground.',
    blueprint: {
      name: 'Spruce A-Frame',
      description: 'A tall cabin whose roof runs from the ridge to the floor, with a glazed gable end.',
      palette: { c: 'cobblestone', p: 'spruce_planks', l: 'spruce_log', g: 'glass' },
      layers: [
        ['ccccccccc', 'ccccccccc', 'ccccccccc', 'ccccccccc', 'ccccccccc', 'ccccccccc', 'ccccccccc', 'ccccccccc', 'ccccccccc'],
        ['pppl.lppp', 'p.......p', 'p.......p', 'p.......p', 'p.......p', 'p.......p', 'p.......p', 'p.......p', 'ppppppppp'],
        ['.ppgggpp.', '.p.....p.', '.p.....p.', '.p.....p.', '.p.....p.', '.p.....p.', '.p.....p.', '.p.....p.', '.pppgppp.'],
        ['..ppgpp..', '..p...p..', '..p...p..', '..p...p..', '..p...p..', '..p...p..', '..p...p..', '..p...p..', '..ppppp..'],
        ['...ppp...', '...p.p...', '...p.p...', '...p.p...', '...p.p...', '...p.p...', '...p.p...', '...p.p...', '...ppp...'],
        ['....p....', '....p....', '....p....', '....p....', '....p....', '....p....', '....p....', '....p....', '....p....']
      ]
    }
  },

  {
    id: 'villa',
    blurb: 'A flat-roofed modern villa in quartz and glass. Wide windows.',
    blueprint: {
      name: 'Modern Villa',
      description: 'A pale box of quartz with full-height glazing on all four sides and a flat roof.',
      palette: { s: 'smooth_stone', q: 'quartz_block', g: 'glass', d: 'dark_oak_log' },
      layers: [
        ['sssssssss', 'sssssssss', 'sssssssss', 'sssssssss', 'sssssssss', 'sssssssss', 'sssssssss'],
        ['qqqd.dqqq', 'q.......q', 'q.......q', 'q.......q', 'q.......q', 'q.......q', 'qqqqqqqqq'],
        ['qqgg.ggqq', 'q.......q', 'g.......g', 'g.......g', 'g.......g', 'q.......q', 'qqgggggqq'],
        ['qqgggggqq', 'q.......q', 'g.......g', 'g.......g', 'g.......g', 'q.......q', 'qqgggggqq'],
        ['qqqqqqqqq', 'q.......q', 'q.......q', 'q.......q', 'q.......q', 'q.......q', 'qqqqqqqqq'],
        ['qqqqqqqqq', 'qqqqqqqqq', 'qqqqqqqqq', 'qqqqqqqqq', 'qqqqqqqqq', 'qqqqqqqqq', 'qqqqqqqqq']
      ]
    }
  },

  {
    id: 'townhouse',
    blurb: 'A two-storey brick townhouse with a stepped roof and windows all round.',
    blueprint: {
      name: 'Brick Townhouse',
      description: 'Two floors of brick over a cobble footing, with an upper floor and a stepped roof.',
      palette: { c: 'cobblestone', b: 'bricks', g: 'glass', o: 'oak_planks' },
      layers: [
        ['ccccccc', 'ccccccc', 'ccccccc', 'ccccccc', 'ccccccc', 'ccccccc', 'ccccccc'],
        ['bbb.bbb', 'b.....b', 'b.....b', 'b.....b', 'b.....b', 'b.....b', 'bbbbbbb'],
        ['bgbbbgb', 'b.....b', 'b.....b', 'g.....g', 'b.....b', 'b.....b', 'bbbgbbb'],
        ['bbbbbbb', 'b.....b', 'b.....b', 'b.....b', 'b.....b', 'b.....b', 'bbbbbbb'],
        ['ooooooo', 'o.ooooo', 'ooooooo', 'ooooooo', 'ooooooo', 'ooooooo', 'ooooooo'],
        ['bbbbbbb', 'b.....b', 'b.....b', 'b.....b', 'b.....b', 'b.....b', 'bbbbbbb'],
        ['bbgbgbb', 'b.....b', 'g.....b', 'b.....b', 'b.....g', 'b.....b', 'bbgbgbb'],
        ['bbbbbbb', 'b.....b', 'b.....b', 'b.....b', 'b.....b', 'b.....b', 'bbbbbbb'],
        ['ooooooo', 'ooooooo', 'ooooooo', 'ooooooo', 'ooooooo', 'ooooooo', 'ooooooo'],
        ['.......', '.ooooo.', '.ooooo.', '.ooooo.', '.ooooo.', '.ooooo.', '.......'],
        ['.......', '.......', '..ooo..', '..ooo..', '..ooo..', '.......', '.......']
      ]
    }
  },

  {
    id: 'stilt-hut',
    blurb: 'A plank hut raised on four legs, with an overhanging roof. Good over water.',
    blueprint: {
      name: 'Stilt Hut',
      description: 'A single room on stilts with an overhanging roof, for shorelines and swamps.',
      palette: { l: 'oak_log', p: 'oak_planks', g: 'glass' },
      layers: [
        ['.......', '.l...l.', '.......', '.......', '.......', '.l...l.', '.......'],
        ['.......', '.l...l.', '.......', '.......', '.......', '.l...l.', '.......'],
        ['.......', '.l...l.', '.......', '.......', '.......', '.l...l.', '.......'],
        ['ppppppp', 'ppppppp', 'ppppppp', 'ppppppp', 'ppppppp', 'ppppppp', 'ppppppp'],
        ['.......', '.lp.pl.', '.p...p.', '.p...p.', '.p...p.', '.lpppl.', '.......'],
        ['.......', '.lgpgl.', '.p...p.', '.p...p.', '.p...p.', '.lpgpl.', '.......'],
        ['.......', '.lpppl.', '.p...p.', '.p...p.', '.p...p.', '.lpppl.', '.......'],
        ['ppppppp', 'ppppppp', 'ppppppp', 'ppppppp', 'ppppppp', 'ppppppp', 'ppppppp']
      ]
    }
  }
]

/*
 * Buildings and circuits in one list, because the interface offers them the
 * same way. They are authored separately: a circuit is only correct if every
 * component's block state is right, which a decorative build never has to care
 * about.
 */
/**
 * Everything the launcher ships, each tagged with the section it belongs to.
 *
 * The categories are applied here rather than repeated on every entry: the two
 * source arrays already are the distinction, and a tag written out thirty-five
 * times is thirty-five chances to write it wrong.
 */
export const BLUEPRINT_LIBRARY: LibraryEntry[] = [
  ...STRUCTURES.map((entry) => ({ ...entry, category: entry.category ?? ('building' as const) })),
  ...REDSTONE_LIBRARY.map((entry) => ({ ...entry, category: entry.category ?? ('redstone' as const) }))
]

export function findLibraryBlueprint(id: string): LibraryEntry | undefined {
  return BLUEPRINT_LIBRARY.find((entry) => entry.id === id.toLowerCase().trim())
}

/** Words that carry no meaning when matching a request to a structure. */
const NOISE = new Set([
  'a', 'an', 'the', 'small', 'little', 'big', 'large', 'nice', 'cosy', 'cozy',
  'simple', 'basic', 'me', 'my', 'build', 'make', 'please', 'with', 'and', 'of',
  'for', 'some', 'new', 'good'
])

/**
 * The library entry a request is asking for, or nothing if it is not clear.
 *
 * Exact ids are the normal case and win outright. Everything else is scored on
 * how many meaningful words the request shares with an entry's id, name and
 * blurb, and a weak best match is no match at all.
 *
 * The refusal is the point. A companion asked for "a small welcome outpost"
 * picked `well` out of the list and built one — a well, with a bucket, instead
 * of a house — and reported success. Guessing wrong and saying so is recoverable;
 * guessing wrong silently is not.
 */
export function matchLibraryBlueprint(
  query: string
): { entry: LibraryEntry; exact: boolean } | null {
  const cleaned = query.toLowerCase().trim()
  if (!cleaned) return null

  const exact = findLibraryBlueprint(cleaned)
  if (exact) return { entry: exact, exact: true }

  const words = cleaned
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2 && !NOISE.has(word))
  if (words.length === 0) return null

  let best: LibraryEntry | null = null
  let bestScore = 0

  for (const entry of BLUEPRINT_LIBRARY) {
    const haystack = `${entry.id} ${entry.blueprint.name} ${entry.blurb}`.toLowerCase()
    let score = 0
    for (const word of words) {
      // The id and name are what the thing *is*; the blurb only describes it.
      if (`${entry.id} ${entry.blueprint.name}`.toLowerCase().includes(word)) score += 3
      else if (haystack.includes(word)) score += 1
    }
    if (score > bestScore) {
      bestScore = score
      best = entry
    }
  }

  // One passing mention in a blurb is not enough to build something on.
  return best && bestScore >= 3 ? { entry: best, exact: false } : null
}
