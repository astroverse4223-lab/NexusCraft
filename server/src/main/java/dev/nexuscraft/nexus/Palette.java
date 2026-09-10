package dev.nexuscraft.nexus;

import org.bukkit.Material;

import java.util.Random;

/**
 * The stone the castle is made of.
 *
 * The first version rolled between three shades of stone brick, and the verdict
 * on it was correct: "all the same block, repetitive and ugly". Three variants
 * of one material is not a palette, it is a texture with noise on it — at a
 * distance the noise averages out and you are looking at a flat grey box again.
 *
 * What actually reads as masonry is *courses*: different stone at different
 * heights, in bands, the way a real wall is built out of whatever was to hand
 * at that stage. A dark plinth at the bottom, lighter stone above it, a band of
 * something else where the floors are, and a different material entirely for
 * the parapet. The eye reads the horizontal lines as construction rather than
 * as pattern, and that is the whole difference.
 *
 * So this is not "pick a random stone". It is "pick the stone for that part of
 * the building", and the randomness inside each band is only there to stop the
 * band itself looking printed.
 */
public final class Palette {

    private final Random random;

    public Palette(long seed) {
        this.random = new Random(seed);
    }

    /** True one time in `n`, for scattering detail without a field of it. */
    public boolean sometimes(int n) {
        return random.nextInt(n) == 0;
    }

    public int between(int low, int high) {
        return low + random.nextInt(high - low + 1);
    }

    /**
     * The base course: dark, heavy, and wet-looking where it meets the ground.
     *
     * Every real wall gets darker at the bottom. Skipping this is the single
     * commonest reason a Minecraft build floats rather than sits.
     */
    public Material plinth() {
        int roll = random.nextInt(20);
        if (roll < 8) return Material.DEEPSLATE_BRICKS;
        if (roll < 13) return Material.COBBLED_DEEPSLATE;
        if (roll < 16) return Material.POLISHED_DEEPSLATE;
        if (roll < 18) return Material.DEEPSLATE_TILES;
        return Material.CRACKED_DEEPSLATE_BRICKS;
    }

    /** The main body of a wall. */
    public Material wall() {
        int roll = random.nextInt(24);
        if (roll < 10) return Material.STONE_BRICKS;
        if (roll < 14) return Material.COBBLESTONE;
        if (roll < 17) return Material.MOSSY_STONE_BRICKS;
        if (roll < 19) return Material.CRACKED_STONE_BRICKS;
        if (roll < 21) return Material.ANDESITE;
        if (roll < 23) return Material.MOSSY_COBBLESTONE;
        return Material.CHISELED_STONE_BRICKS;
    }

    /**
     * Upper storeys, lighter than the body.
     *
     * Real castles were finished over decades and the top is usually newer and
     * cleaner than the bottom. Copying that gives a building a history for free.
     */
    public Material upper() {
        int roll = random.nextInt(20);
        if (roll < 9) return Material.STONE_BRICKS;
        if (roll < 13) return Material.POLISHED_ANDESITE;
        if (roll < 16) return Material.SMOOTH_STONE;
        if (roll < 18) return Material.ANDESITE;
        return Material.CHISELED_STONE_BRICKS;
    }

    /** The band that marks a floor line or the top of a course. */
    public Material band() {
        return random.nextInt(3) == 0 ? Material.POLISHED_ANDESITE : Material.STONE_BRICKS;
    }

    /** Parapets and merlons: darker again, so the skyline has an edge. */
    public Material parapet() {
        int roll = random.nextInt(12);
        if (roll < 6) return Material.DEEPSLATE_BRICKS;
        if (roll < 9) return Material.POLISHED_DEEPSLATE;
        if (roll < 11) return Material.COBBLED_DEEPSLATE;
        return Material.CRACKED_DEEPSLATE_BRICKS;
    }

    /** Roof tiles. Dark, so the towers read against the sky. */
    public Material roof() {
        int roll = random.nextInt(16);
        if (roll < 8) return Material.DEEPSLATE_TILES;
        if (roll < 12) return Material.POLISHED_DEEPSLATE;
        if (roll < 14) return Material.DEEPSLATE_BRICKS;
        return Material.CRACKED_DEEPSLATE_BRICKS;
    }

    /** Timber, for beams, hoardings and anything built after the stone. */
    public Material timber() {
        int roll = random.nextInt(10);
        if (roll < 5) return Material.SPRUCE_LOG;
        if (roll < 8) return Material.DARK_OAK_LOG;
        return Material.STRIPPED_SPRUCE_LOG;
    }

    public Material planks() {
        int roll = random.nextInt(10);
        if (roll < 5) return Material.SPRUCE_PLANKS;
        if (roll < 8) return Material.DARK_OAK_PLANKS;
        return Material.OAK_PLANKS;
    }

    /** The courtyard floor, which should not be one paving stone either. */
    public Material paving() {
        int roll = random.nextInt(16);
        if (roll < 6) return Material.STONE_BRICKS;
        if (roll < 9) return Material.COBBLESTONE;
        if (roll < 11) return Material.ANDESITE;
        if (roll < 13) return Material.POLISHED_ANDESITE;
        if (roll < 15) return Material.MOSSY_COBBLESTONE;
        return Material.GRAVEL;
    }

    /** Grass, with the odd patch of something else growing through it. */
    public Material ground() {
        int roll = random.nextInt(24);
        if (roll < 18) return Material.GRASS_BLOCK;
        if (roll < 21) return Material.COARSE_DIRT;
        if (roll < 23) return Material.PODZOL;
        return Material.MOSS_BLOCK;
    }

    public Material flower() {
        Material[] flowers = {
                Material.POPPY, Material.DANDELION, Material.CORNFLOWER,
                Material.AZURE_BLUET, Material.OXEYE_DAISY, Material.SHORT_GRASS,
                Material.SHORT_GRASS, Material.SHORT_GRASS,
        };
        return flowers[random.nextInt(flowers.length)];
    }
}
