import type { Blueprint } from './blueprint'

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

export interface LibraryEntry {
  id: string
  /** One line on what it is and what it costs, for the picker. */
  blurb: string
  blueprint: Blueprint
}

export const BLUEPRINT_LIBRARY: LibraryEntry[] = [
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
        // Eaves
        ['sssssss', 's.....s', 's.....s', 's.....s', 's.....s', 's.....s', 'sssssss'],
        // Roof, stepping in
        ['.......', '.sssss.', '.s...s.', '.s...s.', '.s...s.', '.sssss.', '.......'],
        // Ridge
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
      palette: { s: 'stone_bricks', c: 'cobblestone', l: 'ladder', g: 'glass', t: 'torch' },
      layers: [
        ['ccccc', 'ccccc', 'ccccc', 'ccccc', 'ccccc'],
        ['sssss', 's...s', 's.l.s', 's...s', 'ss.ss'],
        ['sssss', 's...s', 's.l.s', 's...s', 'sssss'],
        ['sgsgs', 's...s', 's.l.s', 's...s', 'sgsgs'],
        ['sssss', 's...s', 's.l.s', 's...s', 'sssss'],
        ['sssss', 's...s', 's.l.s', 's...s', 'sssss'],
        ['sgsgs', 's...s', 's.l.s', 's...s', 'sgsgs'],
        ['sssss', 's...s', 's.l.s', 's...s', 'sssss'],
        ['sssss', 's...s', 's.l.s', 's...s', 'sssss'],
        ['sgsgs', 's.t.s', 's.l.s', 's...s', 'sgsgs'],
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
        ['sssss', 's...s', 's...s', 's...s', 'sssss'],
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
      palette: { s: 'stone_bricks', c: 'cobblestone', g: 'glass', t: 'torch', o: 'oak_planks' },
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
          'sssgsgsssss', 's.........s', 'g...ttt...g', 's.........s', 's.........s', 'g.........g',
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
  }
]

export function findLibraryBlueprint(id: string): LibraryEntry | undefined {
  return BLUEPRINT_LIBRARY.find((entry) => entry.id === id.toLowerCase().trim())
}
