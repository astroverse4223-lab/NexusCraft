import type { LibraryEntry } from './library'

/**
 * Redstone builds.
 *
 * Kept apart from the decorative library because they are a different kind of
 * object. A cottage is right if it looks right; a circuit is right only if
 * every component faces the way it must. So every entry here leans on block
 * states — `repeater[facing=north,delay=4]`, `observer[facing=up]`,
 * `sticky_piston[facing=east]` — which the schematic writers preserve. That is
 * what makes these work when pasted.
 *
 * Two honest limits, stated once rather than on every entry.
 *
 * A companion asked to build one of these will get the shape right and the
 * orientations wrong, because the placement tool sets a block and not its
 * state. These are meant to be exported and pasted with Litematica, WorldEdit
 * or a structure block — not built by the bot.
 *
 * And I cannot run Minecraft. These are laid out from how the components
 * behave, not from watching them tick. `redstone.test.ts` walks each grid and
 * proves two things: nothing that needs power is stranded out of reach of it,
 * and every run of dust still carries a signal at its far end. Both were
 * written after builds shipped broken — a door whose upper piston had no power
 * at all, and a field whose dust was threaded between the dispensers so only
 * the first one ever fired.
 *
 * What no test here can prove is that a circuit does what its name says, or
 * that a farm has anything planted in it. That last one is why the sugar cane
 * farm did nothing at all through two versions: the redstone was fine by then,
 * but it pasted as bare sand, so nothing ever grew for an observer to see.
 * Anything that grows or needs loading now ships loaded. Paste into a creative
 * world before trusting one with something you care about.
 *
 * Orientation convention: rows run north (row 0) to south, characters run west
 * (index 0) to east. `facing=south` points toward a higher row index,
 * `facing=east` toward a higher character index.
 */

export const REDSTONE_LIBRARY: LibraryEntry[] = [
  {
    id: 'lamp-strip',
    blurb: 'A 9x2 lever-switched lamp strip. The simplest thing that proves a wiring run works.',
    blueprint: {
      name: 'Lamp Strip',
      description: 'Redstone lamps under a dust line, switched by one lever, with a repeater to carry the signal.',
      palette: {
        s: 'smooth_stone',
        p: 'redstone_lamp',
        d: 'redstone_wire',
        // Dust fades after 15 blocks; the repeater refreshes it partway along.
        r: 'repeater[facing=east,delay=1]',
        l: 'lever[face=floor,facing=north]'
      },
      layers: [
        ['sssssssss', 'sssssssss'],
        ['ppppppppp', 'ldddrdddd']
      ]
    }
  },

  {
    id: 'clock',
    blurb: 'A 5x3 repeater clock with a lever and a lamp. Slow the repeaters to slow the pulse.',
    blueprint: {
      name: 'Repeater Clock',
      description: 'A dust loop with two repeaters pushing the signal round it, pulsing while the lever is on.',
      palette: {
        s: 'smooth_stone',
        d: 'redstone_wire',
        // The two repeaters drive the loop in opposite directions round the ring.
        n: 'repeater[facing=north,delay=4]',
        u: 'repeater[facing=south,delay=4]',
        l: 'lever[face=floor,facing=north]',
        p: 'redstone_lamp'
      },
      layers: [
        ['sssss', 'sssss', 'sssss'],
        ['ldddp', 'n...u', '.ddd.']
      ]
    }
  },

  {
    id: 'iron-door',
    blurb: 'A 5x3x3 iron doorway that opens for anyone who walks up to it, from either side.',
    blueprint: {
      name: 'Iron Door',
      description: 'An iron door in a stone wall with a pressure plate on each side, so it opens as you reach it.',
      palette: {
        s: 'stone_bricks',
        // A door is two blocks that must agree; the halves are separate states.
        i: 'iron_door[half=lower,facing=north]',
        j: 'iron_door[half=upper,facing=north]',
        p: 'stone_pressure_plate'
      },
      layers: [
        ['sssss', 'sssss', 'sssss'],
        // A plate either side of the wall, each touching the door it opens.
        ['..p..', 'ssiss', '..p..'],
        ['.....', 'ssjss', '.....']
      ]
    }
  },

  {
    id: 'secret-stash',
    blurb: 'A 5x3x3 hidden stash. The lever seals a chest behind what looks like plain wall.',
    blueprint: {
      name: 'Secret Stash',
      description: 'A sticky piston slides a matching block across the alcove. Lever on, the wall reads solid.',
      palette: {
        s: 'stone_bricks',
        w: 'sticky_piston[facing=east]',
        /*
         * The same block as the wall, on its own palette letter only so the
         * layout below shows which one moves. Matching the wall is the point.
         */
        p: 'stone_bricks',
        c: 'chest[facing=south]',
        l: 'lever[face=floor,facing=north]'
      },
      layers: [
        ['sssss', 'sssss', 'sssss'],
        /*
         * Shown open, which is how a piston rests. The piston sits a block back
         * from the gap on purpose: an extending piston's head fills the cell it
         * pushes into, so a panel flush against it can never uncover anything.
         * From here, powering it drives the panel across the gap and the wall
         * goes blank. Lever on to hide, off to open.
         */
        ['ssscs', 'swp.s', 'slsss'],
        ['sssss', 'sssss', 'sssss']
      ]
    }
  },

  {
    id: 'sugar-farm',
    blurb: 'A 7x5x4 observer sugar cane farm. Five columns, cut and dropped without you.',
    blueprint: {
      name: 'Sugar Cane Farm',
      description:
        'Observers watch the second cane block appear and fire pistons across the row to cut it. There is nothing to switch on — it runs itself.',
      palette: {
        s: 'smooth_stone',
        w: 'water',
        n: 'sand',
        /*
         * Piston and observer sit on opposite sides of the cane at the same
         * height, both looking at the block the cane grows into. The observer
         * fires when it appears; the piston takes it, leaving the base to
         * regrow. Their power runs the long way round, up the east column,
         * because an observer's output leaves from its back.
         */
        t: 'piston[facing=south]',
        o: 'observer[facing=north]',
        d: 'redstone_wire',
        /*
         * The trip from an observer's back, round the east column and along to
         * the far piston is 14 blocks of dust, which arrives at strength 1 —
         * working, but one block from silence. This refreshes it back to 15.
         */
        r: 'repeater[facing=north,delay=1]',
        // Planted, not left to the reader. A farm that ships as bare sand grows
        // nothing, so no observer ever fires and the whole thing sits dead.
        k: 'sugar_cane',
        h: 'hopper[facing=west]',
        c: 'chest[facing=south]'
      },
      layers: [
        ['sssssss', 'sssssss', 'sssssss', 'sssssss', 'sssssss'],
        // Water to keep the sand wet, and hoppers along the front for the drops.
        ['sssssss', 'swwwwws', 'snnnnns', 'chhhhhs', 'sssssss'],
        /*
         * The cane, already in the ground. The old version of this farm sat the
         * pistons straight on the sand, which left the cane nowhere to grow at
         * all, and pointed the observers into a wall.
         */
        ['sssssss', '......s', '.kkkkks', '......s', 'sssssss'],
        /*
         * The working level. Pistons north of the cane, observers south of it,
         * a dust line behind each, joined by the column at the east end so one
         * observer firing cuts the whole row.
         */
        ['.dddddd', '.tttttd', '......r', '.oooood', '.dddddd']
      ]
    }
  },

  {
    id: 'auto-smelter',
    blurb: 'A 3x5x5 furnace tower — fuel one side, ore on top, output to a chest below.',
    blueprint: {
      name: 'Auto Smelter',
      description: 'Hoppers feed a furnace from above and the side, and take the finished item out underneath.',
      palette: {
        s: 'smooth_stone',
        i: 'chest[facing=south]',
        o: 'chest[facing=north]',
        d: 'hopper[facing=down]',
        e: 'hopper[facing=east]',
        f: 'furnace[facing=south]'
      },
      layers: [
        ['sss', 'sss', 'sss', 'sss', 'sss'],
        // Output chest, fed by the hopper directly under the furnace.
        ['sss', 'sos', 'sds', 'sss', 'sss'],
        // The furnace, with a fuel hopper feeding its side.
        ['sss', 's.s', 'efs', 'sss', 'sss'],
        // Ore hopper sitting on top of the furnace.
        ['sss', 's.s', 'sds', 'sss', 'sss'],
        // Input chest on top of that.
        ['sss', 's.s', 'sis', 'sss', 'sss']
      ]
    }
  },

  {
    id: 'item-sorter',
    blurb: 'One sorting channel, 5x4x4. Stand several side by side to sort a whole wall of items.',
    blueprint: {
      name: 'Item Sorter (one channel)',
      description:
        'A comparator reads a filtered hopper; when the filter item arrives the hopper unlocks and drops it into the chest below.',
      palette: {
        s: 'smooth_stone',
        // Items travel east along the top line; the sorting hopper points down.
        f: 'hopper[facing=east]',
        v: 'hopper[facing=down]',
        c: 'chest[facing=north]',
        m: 'comparator[facing=east,mode=compare]',
        r: 'repeater[facing=east,delay=1]',
        d: 'redstone_wire',
        t: 'redstone_torch',
        b: 'redstone_block'
      },
      layers: [
        ['sssss', 'sssss', 'sssss', 'sssss'],
        // The chest that sorted items land in.
        ['sssss', 'scccs', 'sssss', 'sssss'],
        // Sorting hoppers above it, taking from the line that runs east.
        ['sssss', 'svvvs', 'sssss', 'sssss'],
        // The overflow line, with the comparator and torch that lock the hopper.
        ['sssss', 'sfffs', 'smrds', 'stbss']
      ]
    }
  },

  {
    id: 'lamp-post',
    blurb: 'A 5x5x5 lamp post that lights itself at dusk and goes out at dawn.',
    blueprint: {
      name: 'Daylight Lamp Post',
      description: 'An inverted daylight sensor sits on top of a lamp, so it powers up as the light fades.',
      palette: {
        s: 'smooth_stone',
        f: 'oak_fence',
        p: 'redstone_lamp',
        // Inverted: it outputs at night rather than during the day.
        d: 'daylight_detector[inverted=true]'
      },
      layers: [
        ['sssss', 'sssss', 'sssss', 'sssss', 'sssss'],
        ['.....', '.....', '..f..', '.....', '.....'],
        ['.....', '.....', '..f..', '.....', '.....'],
        ['.....', '.....', '..p..', '.....', '.....'],
        ['.....', '.....', '..d..', '.....', '.....']
      ]
    }
  },

  {
    id: 'doorbell',
    blurb: 'A 5x5x3 note block doorbell. One button plays three notes.',
    blueprint: {
      name: 'Note Block Doorbell',
      description: 'A button powers a dust line into three note blocks tuned to different notes.',
      palette: {
        s: 'smooth_stone',
        // Three notes of the same instrument; the block above each must stay clear.
        a: 'note_block[note=0]',
        b: 'note_block[note=4]',
        c: 'note_block[note=7]',
        d: 'redstone_wire',
        t: 'stone_button[face=floor,facing=north]'
      },
      layers: [
        ['sssss', 'sssss', 'sssss', 'sssss', 'sssss'],
        ['sssss', 'sabcs', 'sddds', 'sssss', 'sssss'],
        ['.....', '.....', '.....', 'sstss', '.....']
      ]
    }
  },

  {
    id: 'trapdoor-pit',
    blurb: 'A 5x4x2 trapdoor pit. Flip the lever and the floor drops out.',
    blueprint: {
      name: 'Trapdoor Pit',
      description: 'Six iron trapdoors form a floor over a drop, ringed by dust so one lever opens every one.',
      palette: {
        s: 'stone_bricks',
        // Bottom half, so the closed trapdoor sits level with the dust beside it.
        t: 'iron_trapdoor[half=bottom,facing=north]',
        d: 'redstone_wire',
        l: 'lever[face=floor,facing=north]'
      },
      layers: [
        // The drop. Left as dots so pasting does not fill the hole back in.
        ['sssss', 's...s', 's...s', 'sssss'],
        /*
         * The floor. The trapdoor area is three by two rather than three by
         * three on purpose: in a 3x3 the middle tile touches no dust, so it is
         * the one square that stays shut under someone's feet.
         */
        ['lddds', 'dtttd', 'dtttd', 'ddddd']
      ]
    }
  },

  {
    id: 'level-indicator',
    blurb: 'A 3x10x2 storage gauge. Lamps light along a bar to show how full the barrel is.',
    blueprint: {
      name: 'Storage Level Indicator',
      description:
        'A comparator measures the barrel; the fuller it is the further the signal runs, and the more of the bar lights.',
      palette: {
        s: 'smooth_stone',
        b: 'barrel[facing=up]',
        // Facing south: it reads the barrel behind it and drives the bar ahead.
        m: 'comparator[facing=south,mode=compare]',
        d: 'redstone_wire',
        p: 'redstone_lamp'
      },
      layers: [
        ['sss', 'sss', 'sss', 'sss', 'sss', 'sss', 'sss', 'sss', 'sss', 'sss'],
        /*
         * Eight lamp pairs flanking the dust. A full barrel gives 15 and lights
         * the lot; a nearly empty one dies after a block or two. The length is
         * the whole point — one lamp on one block of dust is not a gauge, it is
         * an "empty or not" light.
         */
        ['sbs', 'sms', 'pdp', 'pdp', 'pdp', 'pdp', 'pdp', 'pdp', 'pdp', 'pdp']
      ]
    }
  },

  {
    id: 'minecart-loader',
    blurb: 'A 5x3x4 minecart loader. A chest empties into whatever cart stops under it.',
    blueprint: {
      name: 'Minecart Loader',
      description: 'A detector rail stops the cart under a hopper, which drains the chest above it into the cart.',
      palette: {
        s: 'smooth_stone',
        c: 'chest[facing=south]',
        // Facing down: a hopper takes from the block above and pushes below. It
        // will not pull from a chest standing beside it, only one stacked on it.
        h: 'hopper[facing=down]',
        r: 'rail',
        e: 'detector_rail',
        g: 'powered_rail[powered=true]',
        b: 'redstone_block'
      },
      layers: [
        ['sssss', 'sssss', 'sssss'],
        // The line, with the redstone block set beside the powered rail it feeds.
        ['sssss', 'rregr', 'sssbs'],
        // The hopper, directly over the detector rail.
        ['sssss', 'sshss', 'sssss'],
        // And the chest stacked on the hopper.
        ['sssss', 'sscss', 'sssss']
      ]
    }
  },

  {
    id: 'firework-launcher',
    blurb: 'A 5x5x2 firework battery. One button sets off four dispensers together.',
    blueprint: {
      name: 'Firework Launcher',
      description: 'Four upward dispensers on a shared dust line. Load them with rockets and press the button.',
      palette: {
        s: 'smooth_stone',
        f: 'dispenser[facing=up]',
        d: 'redstone_wire',
        // A button rather than a lever: a dispenser fires on the rising edge, so
        // a lever would launch once and then sit there doing nothing.
        t: 'stone_button[face=floor,facing=north]'
      },
      layers: [
        ['sssss', 'sssss', 'sssss', 'sssss', 'sssss'],
        // Nothing is built above the dispensers, so the rockets have sky.
        ['sssss', 'sfsfs', 'tddds', 'sfsfs', 'sssss']
      ]
    }
  },

  {
    id: 'not-gate',
    blurb: 'A 5x3x2 inverter. The lamp is on while the lever is off.',
    blueprint: {
      name: 'NOT Gate',
      description:
        'A redstone torch goes out when the block it is stuck to is powered, which turns any signal into its opposite.',
      palette: {
        s: 'smooth_stone',
        l: 'lever[face=floor,facing=north]',
        d: 'redstone_wire',
        // facing=east means it hangs on the block to its west.
        t: 'redstone_wall_torch[facing=east]',
        p: 'redstone_lamp'
      },
      layers: [
        ['sssss', 'sssss', 'sssss'],
        ['sssss', 'ldstp', 'sssss']
      ]
    }
  },

  {
    id: 'or-gate',
    blurb: 'A 5x5x2 OR gate. Either lever lights the lamp.',
    blueprint: {
      name: 'OR Gate',
      description: 'Two dust lines joining into one. The simplest gate there is — no torches needed.',
      palette: {
        s: 'smooth_stone',
        l: 'lever[face=floor,facing=north]',
        d: 'redstone_wire',
        p: 'redstone_lamp'
      },
      layers: [
        ['sssss', 'sssss', 'sssss', 'sssss', 'sssss'],
        ['sssss', 'ldsss', 'sdddp', 'ldsss', 'sssss']
      ]
    }
  },

  {
    id: 'and-gate',
    blurb: 'An 8x5x2 AND gate. The lamp needs both levers, not either.',
    blueprint: {
      name: 'AND Gate',
      description:
        'Each lever is inverted by a torch, the two are joined, and the result inverted again — which is how you get "both" out of parts that only know "either".',
      palette: {
        s: 'smooth_stone',
        l: 'lever[face=floor,facing=north]',
        d: 'redstone_wire',
        t: 'redstone_wall_torch[facing=east]',
        p: 'redstone_lamp'
      },
      layers: [
        ['ssssssss', 'ssssssss', 'ssssssss', 'ssssssss', 'ssssssss'],
        [
          'ssssssss',
          // Lever, dust, block, torch: an inverted A.
          'ldstdsss',
          // The two inverted signals meet, then a second torch flips them back.
          'ssssdstp',
          'ldstdsss',
          'ssssssss'
        ]
      ]
    }
  },

  {
    id: 'hopper-clock',
    blurb: 'A 5x4x2 hopper clock — far slower than repeaters, and tuned by item count.',
    blueprint: {
      name: 'Hopper Clock',
      description:
        'Two hoppers pass a stack back and forth while a comparator reads one of them. Add items to slow it down, take some out to speed it up. It sits still until you put items in.',
      palette: {
        s: 'smooth_stone',
        // Facing into each other, so the items never settle.
        a: 'hopper[facing=east]',
        b: 'hopper[facing=west]',
        m: 'comparator[facing=north,mode=compare]',
        d: 'redstone_wire',
        p: 'redstone_lamp'
      },
      layers: [
        ['sssss', 'sssss', 'sssss', 'sssss'],
        ['sdpss', 'smsss', 'sabss', 'sssss']
      ]
    }
  },

  {
    id: 'sculk-alarm',
    blurb: 'A 5x3x2 sculk alarm. Lights up when anything moves nearby — including you.',
    blueprint: {
      name: 'Sculk Alarm',
      description: 'A sculk sensor hears footsteps, and anything else that makes a vibration, and lights the lamp.',
      palette: {
        s: 'smooth_stone',
        k: 'sculk_sensor',
        d: 'redstone_wire',
        p: 'redstone_lamp'
      },
      layers: [
        ['sssss', 'sssss', 'sssss'],
        ['sssss', 'skdps', 'sssss']
      ]
    }
  },

  {
    id: 'arrow-trap',
    blurb: 'A 7x3x2 corridor trap. Each plate fires the dispenser right beside it.',
    blueprint: {
      name: 'Arrow Trap',
      description: 'Pressure plates line a corridor, each touching its own dispenser. Load them with arrows.',
      palette: {
        s: 'stone_bricks',
        f: 'dispenser[facing=south]',
        // No dust anywhere: a plate powers what it touches directly.
        q: 'stone_pressure_plate'
      },
      layers: [
        ['sssssss', 'sssssss', 'sssssss'],
        ['sfffffs', 'sqqqqqs', 'sssssss']
      ]
    }
  },

  {
    id: 'crop-flush',
    blurb: 'A 9x6x3 harvester. One lever washes the whole field into the hoppers.',
    blueprint: {
      name: 'Water Flush Farm',
      description:
        'Dispensers loaded with water buckets flood the field on command, breaking the crops and carrying them to the hopper line. Flip it back and the dispensers take the water up again.',
      palette: {
        s: 'smooth_stone',
        l: 'lever[face=floor,facing=north]',
        d: 'redstone_wire',
        f: 'dispenser[facing=south]',
        g: 'farmland',
        // Sown, so the field is a farm on arrival rather than bare dirt.
        w: 'wheat[age=7]',
        h: 'hopper[facing=west]',
        c: 'chest[facing=south]'
      },
      layers: [
        ['sssssssss', 'sssssssss', 'sssssssss', 'sssssssss', 'sssssssss', 'sssssssss'],
        [
          /*
           * The dust gets a row to itself. Threading it between the dispensers
           * instead looks tidier and does not work: each stub is cut off from
           * the next, so only the dispenser nearest the lever ever fires.
           */
          'lddddddds',
          'sfffffffs',
          'sgggggggs',
          'sgggggggs',
          'sgggggggs',
          'chhhhhhhs'
        ],
        // Wheat sown on the farmland, so the field has something to harvest.
        ['.........', '.........', '.wwwwwww.', '.wwwwwww.', '.wwwwwww.', '.........']
      ]
    }
  },

  {
    id: 'lamp-path',
    blurb: 'A 7x3x2 lit walkway. The floor lights up under your feet as you walk it.',
    blueprint: {
      name: 'Lamp Path',
      description: 'Pressure plates down the middle with lamps either side, each plate touching the lamps beside it.',
      palette: {
        s: 'stone_bricks',
        p: 'redstone_lamp',
        q: 'stone_pressure_plate'
      },
      layers: [
        ['sssssss', 'sssssss', 'sssssss'],
        ['sppppps', 'sqqqqqs', 'sppppps']
      ]
    }
  },

  {
    id: 'bell-alarm',
    blurb: 'A 5x3x2 doorstep alarm. Anything that steps up rings the bell.',
    blueprint: {
      name: 'Bell Alarm',
      description:
        'A bell between two pressure plates. It rings for mobs as readily as for players, so it doubles as a warning.',
      palette: {
        s: 'stone_bricks',
        q: 'stone_pressure_plate',
        b: 'bell[attachment=floor,facing=north]'
      },
      layers: [
        ['sssss', 'sssss', 'sssss'],
        ['sssss', 'sqbqs', 'sssss']
      ]
    }
  },

  {
    id: 'target-practice',
    blurb: 'A 5x3x2 archery target. The lamp reads how close to centre you hit.',
    blueprint: {
      name: 'Target Practice',
      description: 'A target block outputs a signal by accuracy, so a centre hit drives the lamp hardest.',
      palette: {
        s: 'smooth_stone',
        t: 'target',
        m: 'comparator[facing=east,mode=compare]',
        d: 'redstone_wire',
        p: 'redstone_lamp'
      },
      layers: [
        ['sssss', 'sssss', 'sssss'],
        ['sssss', 'stmdp', 'sssss']
      ]
    }
  },

  {
    id: 'auto-composter',
    blurb: 'A 3x3x6 composter tower. Crops in the top, bone meal out of the bottom.',
    blueprint: {
      name: 'Auto Composter',
      description:
        'A hopper feeds the composter from above and another takes the bone meal out below. No redstone at all, just gravity and hoppers.',
      palette: {
        s: 'smooth_stone',
        i: 'chest[facing=south]',
        v: 'hopper[facing=down]',
        o: 'composter',
        c: 'chest[facing=north]'
      },
      layers: [
        ['sss', 'sss', 'sss'],
        ['sss', 'scs', 'sss'],
        ['sss', 'svs', 'sss'],
        ['sss', 'sos', 'sss'],
        ['sss', 'svs', 'sss'],
        ['sss', 'sis', 'sss']
      ]
    }
  },

  {
    id: 'bubble-lift',
    blurb: 'A 5x3x7 water lift — up one column, down the other. No redstone, and no ladders.',
    blueprint: {
      name: 'Bubble Lift',
      description:
        'Soul sand pushes you up a water column and magma pulls you down the one beside it. Swim in at the bottom and let go.',
      palette: {
        s: 'smooth_stone',
        /*
         * Soul sand lifts, magma drags down. Each needs its column filled with
         * source water rather than flowing water, or the bubbles stop partway.
         */
        u: 'soul_sand',
        m: 'magma_block',
        w: 'water'
      },
      layers: [
        ['sssss', 'susms', 'sssss'],
        ['sssss', 'swsws', 'sssss'],
        ['sssss', 'swsws', 'sssss'],
        ['sssss', 'swsws', 'sssss'],
        ['sssss', 'swsws', 'sssss'],
        ['sssss', 'swsws', 'sssss'],
        ['sssss', 'swsws', 'sssss']
      ]
    }
  }
]
