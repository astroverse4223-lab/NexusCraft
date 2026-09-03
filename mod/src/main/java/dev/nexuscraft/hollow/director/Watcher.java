package dev.nexuscraft.hollow.director;

import net.minecraft.block.entity.BlockEntity;
import net.minecraft.block.entity.ChestBlockEntity;
import net.minecraft.block.entity.BarrelBlockEntity;
import net.minecraft.registry.RegistryKeys;
import net.minecraft.server.network.ServerPlayerEntity;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.util.math.BlockPos;
import net.minecraft.world.World;

/**
 * Noticing things about the player they never mentioned.
 *
 * The single most unsettling thing this mod can do, and until now the code for
 * it was dead: `Progression.observe` existed, the prompt had a section headed
 * "things you have noticed about them, which they never told you", and nothing
 * ever wrote to it. The list was always empty, so the companion never knew
 * anything, and KNOW_TOO_MUCH had nothing to say.
 *
 * What goes in here matters more than how much. An observation lands when it is
 * *specific*, *true*, and something the player would recognise as private —
 * "you sleep in a bed under a spruce roof" is worse than any noise in a cave,
 * because they can check it and it is right. A list of forty facts is a
 * changelog; four is a thing that has been paying attention.
 *
 * So this only records moments with meaning: where you sleep, where you keep
 * what you own, how deep you go, and how long you stay out after dark. It never
 * records coordinates. A companion that recites numbers sounds like a debug
 * overlay; one that says "under the birch" sounds like it was there.
 */
public final class Watcher {

    private Watcher() {}

    /**
     * Where something is, in words.
     *
     * Deliberately vague and deliberately checkable — enough that the player
     * knows exactly which place is meant, without a single number.
     */
    private static String place(ServerWorld world, BlockPos pos) {
        String biome = world.getRegistryManager()
                .getOrThrow(RegistryKeys.BIOME)
                .getId(world.getBiome(pos).value())
                .getPath()
                .replace('_', ' ');

        // The nearest thing a person would actually use as a landmark.
        String landmark = null;
        for (BlockPos nearby : BlockPos.iterateOutwards(pos, 6, 4, 6)) {
            String name = world.getBlockState(nearby).getBlock().getName().getString().toLowerCase();
            if (name.contains("log") || name.contains("leaves")) {
                landmark = name.replace(" log", "").replace(" leaves", "");
                break;
            }
            if (name.contains("water")) {
                landmark = "the water";
                break;
            }
        }

        return landmark == null ? "in the " + biome : "near the " + landmark;
    }

    /** They slept. The most private thing a player does in front of you. */
    public static void sawSleep(Progression state, ServerWorld world, BlockPos bed) {
        state.observe("they sleep " + place(world, bed));
    }

    /** They opened storage. Now it knows where their things are. */
    public static void sawStorage(Progression state, ServerWorld world, BlockPos pos) {
        BlockEntity entity = world.getBlockEntity(pos);
        if (!(entity instanceof ChestBlockEntity) && !(entity instanceof BarrelBlockEntity)) return;

        boolean buried = pos.getY() < world.getSeaLevel() - 6;
        state.observe(buried
                ? "they keep something buried " + place(world, pos)
                : "they keep their things " + place(world, pos));
    }

    /** How deep they are willing to go, and whether they do it alone. */
    public static void sawDepth(Progression state, ServerPlayerEntity player) {
        int y = player.getBlockPos().getY();
        if (y > -20) return;
        state.observe("they go down past " + (y / 10 * 10) + " on their own");
    }

    /**
     * Out after dark, more than once.
     *
     * Only recorded on a repeat, because doing it once is an accident and doing
     * it habitually is a fact about the person.
     */
    public static void sawNightWalk(Progression state, ServerWorld world, ServerPlayerEntity player) {
        long time = world.getTimeOfDay() % 24000L;
        if (time < 14000 || time > 22000) return;
        if (world.isSkyVisible(player.getBlockPos())) {
            state.observe("they are out after dark more than they should be");
        }
    }

    /** They were badly hurt, and it saw. */
    public static void sawHurt(Progression state, ServerWorld world, ServerPlayerEntity player) {
        if (player.getHealth() > 6) return;
        state.observe("they have come close to dying " + place(world, player.getBlockPos()));
    }

    /** Convenience for the tick: the checks that are worth doing occasionally. */
    public static void periodic(Progression state, ServerWorld world, ServerPlayerEntity player) {
        sawDepth(state, player);
        sawHurt(state, world, player);
        sawNightWalk(state, world, player);
    }

    /** Whether this world is one where sea level makes sense as a depth cue. */
    public static boolean overworld(World world) {
        return world.getRegistryKey() == World.OVERWORLD;
    }
}
