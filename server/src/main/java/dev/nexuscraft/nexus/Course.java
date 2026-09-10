package dev.nexuscraft.nexus;

import org.bukkit.Material;

/**
 * One parkour course, described entirely by numbers.
 *
 * The old course was a single set of constants inside the generator, which made
 * "add another course" mean "copy the generator". Pulling the shape out here
 * means a new course is one entry in a list, and - more usefully - that the
 * difference between courses is something you can read at a glance rather than
 * infer from two hundred lines of block placing.
 *
 * Every gap here still has to be inside what a player can physically clear:
 * four blocks flat, three with a block of rise. A course with one impossible
 * jump is not a hard course, it is a broken one, and nobody who hits it can
 * tell which of the two it is.
 */
public record Course(
        String name,
        String blurb,

        /** How many jumps. */
        int jumps,

        /** A checkpoint every this many jumps. 0 means none at all. */
        int checkpointEvery,

        /** How far the course turns each jump. Higher is more wandering. */
        double wander,

        /** The longest flat gap. Four is the limit of a running jump. */
        int longestGap,

        /** Chance in ten that a jump rises a block. */
        int riseChance,

        /**
         * Chance in ten that a step is only a slab or a fence post.
         *
         * The difference between a course that is long and one that is hard:
         * a narrow landing punishes an imprecise jump that a full block would
         * have forgiven.
         */
        int narrowChance,

        /** Chance in ten that a step is ice, which you slide off. */
        int iceChance,

        /** What the ordinary steps are made of, so courses look different. */
        Material block,
        Material accent,

        /** Money for finishing, before the time bonus. */
        double pays,

        /** A time in seconds that counts as a good run on this course. */
        int par
) {

    /**
     * How far apart the courses sit, along x.
     *
     * Side by side rather than stacked. Stacking put the fifth course's floor
     * at y=340 against a build limit of 319, so none of its blocks were ever
     * placed - and because the course list lives in memory, everything counted
     * it as built. Laid out sideways every course has the whole usable height
     * above it, and no amount of climbing can reach the one next door.
     */
    public static final int APART = 512;

    /** The height every course starts at. */
    public static final int GROUND = 100;

    /**
     * The courses, easiest first.
     *
     * The numbers escalate in more than one direction on purpose. A course that
     * is only "the last one but longer" is not a new course, it is the same
     * course with more of it - so each one here changes what the difficulty
     * actually consists of: length, then precision, then footing, then nerve.
     */
    public static final Course[] ALL = {
            new Course("Warm Up", "60 jumps, plenty of checkpoints",
                    60, 10, 1.2, 4, 3, 0, 0,
                    Material.SMOOTH_QUARTZ, Material.QUARTZ_BLOCK, 600, 75),

            new Course("The Long Way", "90 jumps, and it turns more",
                    90, 15, 1.8, 4, 4, 0, 0,
                    Material.SMOOTH_STONE, Material.POLISHED_ANDESITE, 1_000, 110),

            new Course("Pin Drop", "half the landings are slabs",
                    80, 20, 1.6, 4, 4, 5, 0,
                    Material.POLISHED_BLACKSTONE, Material.GOLD_BLOCK, 1_600, 120),

            new Course("Cold Feet", "ice, and it does not forgive",
                    80, 20, 2.0, 3, 5, 3, 4,
                    Material.PACKED_ICE, Material.BLUE_ICE, 2_400, 130),

            new Course("No Net", "one checkpoint. Good luck",
                    100, 50, 2.2, 4, 5, 5, 3,
                    Material.CRYING_OBSIDIAN, Material.NETHERITE_BLOCK, 4_000, 160),
    };

    public static Course of(int index) {
        return ALL[Math.max(0, Math.min(ALL.length - 1, index))];
    }

    public static int count() {
        return ALL.length;
    }

    /** Where this course begins. Same height for all of them. */
    public static int originX(int index) {
        return index * APART;
    }

    public int floorY(int index) {
        return GROUND;
    }
}
