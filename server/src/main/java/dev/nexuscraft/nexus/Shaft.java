package dev.nexuscraft.nexus;

import org.bukkit.Material;

/**
 * One dropper shaft, and the shape of what is in it.
 *
 * The three shafts that were here differed only in how much of the same random
 * scatter they contained - density 0.30, 0.40, 0.50. That reads as one level
 * three times, because random scatter has no shape to learn: you cannot get
 * better at it, you can only be luckier, and the second run feels exactly like
 * the first.
 *
 * A pattern can be learned. A ring has a gap you can aim for; a corridor has a
 * slot; a spiral moves predictably. Getting better at a shaft means finding the
 * line through it, and that is the difference between a level and a longer one.
 */
public record Shaft(
        String name,
        Pattern pattern,

        /** How much of each layer is filled, 0 to 1. */
        double density,

        /** Blocks between layers. Closer together leaves less time to react. */
        int spacing,

        Material palette,
        double pays
) {

    /**
     * What the obstacles are arranged into.
     *
     * The point of each is a different question being asked of the player:
     * where is the gap, how wide is the gap, which way is the gap moving.
     */
    public enum Pattern {
        /** Random blocks, thinning downward. The original, kept as the opener. */
        SCATTER,

        /** Concentric rings with one gap. Find the gap and hold it. */
        RINGS,

        /** A wall with a single slot across it, alternating direction. */
        CORRIDORS,

        /** Alternating squares, offset each layer, so you weave. */
        CHECKER,

        /** Columns you fall between rather than plates you fall through. */
        PILLARS,

        /** A gap that rotates a little each layer. */
        SPIRAL,
    }

    /**
     * The shafts, easiest first.
     *
     * Ordered so that the pattern is learnable before it is fast: open air
     * first because most of it is nothing, rings next because a ring's gap is
     * visible from further up, and the spiral last because it is the only one
     * where the right answer at one layer is the wrong answer at the next.
     */
    public static final Shaft[] ALL = {
            /*
             * Thinner and further apart than the rest, because it is first.
             *
             * It was 0.30 every seven blocks, which is a third of the shaft
             * filled with obstacles arranged at random - the hardest thing to
             * read, given to somebody who has never played it.
             */
            new Shaft("Open Air", Pattern.SCATTER, 0.18, 10,
                    Material.LIGHT_BLUE_CONCRETE, 500),

            new Shaft("Rings", Pattern.RINGS, 0.55, 7,
                    Material.LIME_CONCRETE, 800),

            new Shaft("Slots", Pattern.CORRIDORS, 0.70, 6,
                    Material.YELLOW_CONCRETE, 1_200),

            new Shaft("Weave", Pattern.CHECKER, 0.50, 6,
                    Material.ORANGE_CONCRETE, 1_700),

            new Shaft("Forest", Pattern.PILLARS, 0.45, 5,
                    Material.RED_CONCRETE, 2_300),

            new Shaft("Corkscrew", Pattern.SPIRAL, 0.72, 5,
                    Material.PURPLE_CONCRETE, 3_200),
    };

    public static Shaft of(int index) {
        return ALL[Math.max(0, Math.min(ALL.length - 1, index))];
    }

    public static int count() {
        return ALL.length;
    }
}
