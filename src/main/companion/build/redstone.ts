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

/*
 * Also empty, and for the same reason - see library.ts.
 *
 * A circuit that is nearly right does nothing while looking exactly like one
 * that works, which is the worst possible failure to ship untested. The
 * redstone designer under Generators is the replacement: you lay it out, the
 * app carries every facing and delay across exactly.
 */
export const REDSTONE_LIBRARY: LibraryEntry[] = []
