package dev.nexuscraft.ember;

import net.minecraft.block.Block;
import net.minecraft.block.Blocks;
import net.minecraft.registry.tag.BlockTags;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.util.math.BlockPos;
import net.minecraft.util.math.Direction;
import net.minecraft.world.Heightmap;
import net.minecraft.world.LightType;

import java.util.Locale;

/**
 * Finding a real place to match something Ember said.
 *
 * It could already lead you home and back to where you died, because those are
 * coordinates it was given. What it could not do was follow through on anything
 * it thought of itself — "follow me, I'll show you a nice spot by the river" is
 * a sentence about a place that exists only in the sentence.
 *
 * So the model names a *kind* of place and this finds one, which is the same
 * division of labour that made the item requests reliable: the model is good at
 * talking and bad at coordinates, and the world is right here to be searched.
 *
 * Everything is found by looking at blocks the server already has loaded. If
 * nothing matches, that is an answer too — better for Ember to say it cannot
 * see one than to lead you confidently into a field.
 */
public final class Landmarks {

    /** How far out to look. Beyond this the chunks are probably not loaded. */
    private static final int RADIUS = 64;

    /** Coarse steps: a landmark twelve blocks off is the same landmark. */
    private static final int STEP = 4;

    private Landmarks() {
    }

    /**
     * A place of the named kind, or null if none is in sight.
     *
     * The names are the ones a model reaches for unprompted, plus the obvious
     * synonyms — it will say "river" or "water" for the same thing and should
     * not have to guess which word this expects.
     */
    public static BlockPos find(ServerWorld world, BlockPos from, String kind) {
        if (kind == null || kind.isBlank()) return null;
        String want = kind.toLowerCase(Locale.ROOT).trim();

        if (contains(want, "water", "river", "lake", "sea", "ocean", "coast", "shore")) {
            return nearest(world, from, Landmarks::isWatersEdge);
        }
        if (contains(want, "cave", "cavern", "tunnel", "underground", "dark")) {
            return nearest(world, from, Landmarks::isCaveMouth);
        }
        if (contains(want, "tree", "wood", "forest")) {
            return nearest(world, from, Landmarks::isWoodland);
        }
        if (contains(want, "high", "hill", "peak", "view", "lookout", "mountain")) {
            return highest(world, from);
        }
        if (contains(want, "open", "clear", "flat", "field", "meadow", "build")) {
            return nearest(world, from, Landmarks::isOpenGround);
        }
        if (contains(want, "shelter", "safe", "cover", "camp")) {
            return nearest(world, from, Landmarks::isSheltered);
        }

        return null;
    }

    /**
     * Whether the player asked to be taken anywhere.
     *
     * The model decides what kind of place to lead to, and it turns out it will
     * also decide *that* there is leading to be done — asked for mending it
     * answered "follow me" and set off for a cave, because a cave is where ore
     * is and it had drifted from repairing a tool to finding one. Being walked
     * somewhere is a big thing to do to someone who did not ask for it, so the
     * asking is read here rather than left to the model.
     */
    public static boolean wasAsked(String message) {
        if (message == null || message.isBlank()) return false;
        String text = message.toLowerCase(Locale.ROOT).replaceAll("[^a-z ]", " ");

        return contains(text,
                "show me", "take me", "lead me", "guide me", "bring me to",
                "where should", "where can", "where do i", "where is", "wheres",
                "find me a", "find a", "look for", "know anywhere", "know a good",
                "is there a", "are there any", "any caves", "any water",
                "somewhere", "anywhere", "nearby", "near here", "around here",
                "lets go", "let s go", "go somewhere", "explore");
    }

    /** The kinds Ember can actually find, for telling the model. */
    public static String kinds() {
        return "\"water\", \"cave\", \"trees\", \"high ground\", \"open ground\", \"shelter\"";
    }

    /* ------------------------------------------------------------ searching */

    private interface Test {
        boolean matches(ServerWorld world, BlockPos at);
    }

    /**
     * The closest match, searched in rings outward.
     *
     * Outward rather than a full scan sorted afterwards: the nearest match is
     * almost always close, and a spiral finds it without looking at sixteen
     * thousand columns first.
     */
    private static BlockPos nearest(ServerWorld world, BlockPos from, Test test) {
        for (int ring = STEP; ring <= RADIUS; ring += STEP) {
            for (int dx = -ring; dx <= ring; dx += STEP) {
                for (int dz = -ring; dz <= ring; dz += STEP) {
                    // Only the edge of this ring; the inside was already done.
                    if (Math.abs(dx) != ring && Math.abs(dz) != ring) continue;

                    BlockPos column = from.add(dx, 0, dz);
                    BlockPos surface = world.getTopPosition(
                            Heightmap.Type.MOTION_BLOCKING_NO_LEAVES, column);

                    if (test.matches(world, surface)) return surface;
                }
            }
        }
        return null;
    }

    /** The highest ground within reach, which is what "a view" means. */
    private static BlockPos highest(ServerWorld world, BlockPos from) {
        BlockPos best = null;

        for (int dx = -RADIUS; dx <= RADIUS; dx += STEP) {
            for (int dz = -RADIUS; dz <= RADIUS; dz += STEP) {
                BlockPos surface = world.getTopPosition(
                        Heightmap.Type.MOTION_BLOCKING_NO_LEAVES, from.add(dx, 0, dz));

                if (world.getBlockState(surface.down()).isAir()) continue;
                if (best == null || surface.getY() > best.getY()) best = surface;
            }
        }

        // Somewhere no higher than here is not a view.
        return best != null && best.getY() > from.getY() + 4 ? best : null;
    }

    /* ------------------------------------------------------------- the tests */

    /** Land, with water beside it — the bank rather than the middle. */
    private static boolean isWatersEdge(ServerWorld world, BlockPos at) {
        if (world.getBlockState(at.down()).getBlock() == Blocks.WATER) return false;
        if (!world.getBlockState(at.down()).isSolidBlock(world, at.down())) return false;

        for (Direction face : Direction.Type.HORIZONTAL) {
            for (int reach = 1; reach <= 3; reach++) {
                BlockPos beside = at.offset(face, reach).down();
                if (world.getBlockState(beside).getBlock() == Blocks.WATER) return true;
            }
        }
        return false;
    }

    /**
     * An opening that goes down into the dark.
     *
     * Air below the surface with no sky reaching it — which is what a cave mouth
     * is, and distinguishes one from a shaded overhang.
     */
    private static boolean isCaveMouth(ServerWorld world, BlockPos at) {
        for (int down = 2; down <= 20; down++) {
            BlockPos below = at.down(down);
            if (!world.getBlockState(below).isAir()) continue;
            if (world.isSkyVisible(below)) continue;
            if (world.getLightLevel(LightType.SKY, below) > 4) continue;
            return true;
        }
        return false;
    }

    /** Several logs close together, which is a wood rather than a lone tree. */
    private static boolean isWoodland(ServerWorld world, BlockPos at) {
        int logs = 0;
        for (int dx = -3; dx <= 3; dx++) {
            for (int dz = -3; dz <= 3; dz++) {
                for (int dy = 0; dy <= 6; dy++) {
                    if (world.getBlockState(at.add(dx, dy, dz)).isIn(BlockTags.LOGS)) logs++;
                    if (logs >= 8) return true;
                }
            }
        }
        return false;
    }

    /** Flat, solid and unroofed — somewhere you could actually put a house. */
    private static boolean isOpenGround(ServerWorld world, BlockPos at) {
        if (!world.isSkyVisible(at)) return false;

        int level = at.getY();
        for (int dx = -3; dx <= 3; dx++) {
            for (int dz = -3; dz <= 3; dz++) {
                BlockPos surface = world.getTopPosition(
                        Heightmap.Type.MOTION_BLOCKING_NO_LEAVES, at.add(dx, 0, dz));

                if (Math.abs(surface.getY() - level) > 1) return false;
                Block under = world.getBlockState(surface.down()).getBlock();
                if (under == Blocks.WATER || under == Blocks.LAVA) return false;
            }
        }
        return true;
    }

    /** Solid over your head and solid at your back: a place to sit out a night. */
    private static boolean isSheltered(ServerWorld world, BlockPos at) {
        if (world.isSkyVisible(at)) return false;
        if (!world.getBlockState(at).isAir()) return false;
        if (!world.getBlockState(at.up()).isAir()) return false;

        int walls = 0;
        for (Direction face : Direction.Type.HORIZONTAL) {
            if (!world.getBlockState(at.offset(face)).isAir()) walls++;
        }
        return walls >= 2;
    }

    private static boolean contains(String text, String... words) {
        for (String word : words) {
            if (text.contains(word)) return true;
        }
        return false;
    }
}
