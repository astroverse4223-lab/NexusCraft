package dev.nexuscraft.nexus;

import org.bukkit.Bukkit;
import org.bukkit.Difficulty;
import org.bukkit.GameRule;
import org.bukkit.World;
import org.bukkit.WorldCreator;
import org.bukkit.generator.BiomeProvider;
import org.bukkit.generator.ChunkGenerator;
import org.bukkit.generator.WorldInfo;

import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Comparator;
import java.util.Random;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * A world per match, thrown away afterwards.
 *
 * Resetting an arena is the problem every minigame server has to solve, and
 * most solve it by remembering every block a player changed and putting it
 * back. That works until it does not: a TNT chain, a bucket of lava, a chest
 * that fell when its support was mined, a match that ended while a block was
 * still falling. Each one is a leak that leaves the next match slightly wrong,
 * and the bugs it causes are unreproducible by definition.
 *
 * An empty world built from nothing has no such state. The map is placed by
 * code, the match is played, the world is deleted. Reset is not a feature that
 * can be incomplete, because there is nothing to reset.
 *
 * It costs a few seconds and a few megabytes per match, which on a server for
 * friends is the cheapest possible price for never debugging a half-reverted
 * arena at midnight.
 */
public final class Arena {

    private static final AtomicInteger NEXT = new AtomicInteger(1);

    private Arena() {
    }

    /**
     * Nothing at all, in every direction.
     *
     * Every hook is overridden to generate nothing rather than relying on the
     * default, because the defaults differ between the noise, surface, caves
     * and decoration passes and one left on produces a world with, say, ore
     * veins hanging in the void.
     */
    public static final class Nothing extends ChunkGenerator {
        @Override
        public void generateNoise(WorldInfo info, Random random, int x, int z, ChunkData chunk) {
        }

        @Override
        public void generateSurface(WorldInfo info, Random random, int x, int z, ChunkData chunk) {
        }

        @Override
        public void generateBedrock(WorldInfo info, Random random, int x, int z, ChunkData chunk) {
        }

        @Override
        public void generateCaves(WorldInfo info, Random random, int x, int z, ChunkData chunk) {
        }

        @Override
        public boolean shouldGenerateNoise() {
            return false;
        }

        @Override
        public boolean shouldGenerateSurface() {
            return false;
        }

        @Override
        public boolean shouldGenerateCaves() {
            return false;
        }

        @Override
        public boolean shouldGenerateDecorations() {
            return false;
        }

        @Override
        public boolean shouldGenerateMobs() {
            return false;
        }

        @Override
        public boolean shouldGenerateStructures() {
            return false;
        }

        @Override
        public BiomeProvider getDefaultBiomeProvider(WorldInfo info) {
            return null;
        }
    }

    /** An empty world, ready to have a map put in it. */
    public static World create(String game) {
        String name = "nexus_" + game + "_" + NEXT.getAndIncrement();

        World world = new WorldCreator(name)
                .generator(new Nothing())
                .generateStructures(false)
                .createWorld();

        if (world == null) throw new IllegalStateException("could not create arena " + name);

        world.setDifficulty(Difficulty.NORMAL);
        world.setSpawnLocation(0, 80, 0);

        /*
         * The rules a match needs, rather than the ones a survival world wants.
         *
         * Daylight is frozen because a BedWars match that drifts into night
         * spawns mobs on every unlit island, and the fix players reach for is
         * torches, which is not what the game is about. The rest exist so that
         * nothing changes underneath a match that nobody caused.
         */
        world.setGameRule(GameRule.DO_DAYLIGHT_CYCLE, false);
        world.setGameRule(GameRule.DO_WEATHER_CYCLE, false);
        world.setGameRule(GameRule.DO_MOB_SPAWNING, false);
        world.setGameRule(GameRule.DO_FIRE_TICK, false);
        world.setGameRule(GameRule.MOB_GRIEFING, false);
        world.setGameRule(GameRule.ANNOUNCE_ADVANCEMENTS, false);
        world.setGameRule(GameRule.SHOW_DEATH_MESSAGES, false);
        world.setGameRule(GameRule.KEEP_INVENTORY, false);
        world.setGameRule(GameRule.NATURAL_REGENERATION, false);
        world.setTime(6000);

        return world;
    }

    /**
     * Unloads the world and deletes it from disk.
     *
     * Anybody still standing in it has to be moved first — Bukkit refuses to
     * unload a world with players in it, and the failure is a silently returned
     * false rather than an exception, so the folder quietly survives and the
     * next restart loads an arena full of somebody's half-built bridge.
     */
    public static void destroy(World world) {
        if (world == null) return;

        File folder = world.getWorldFolder();
        if (!Bukkit.unloadWorld(world, false)) return;

        try (var walk = Files.walk(folder.toPath())) {
            walk.sorted(Comparator.reverseOrder()).map(Path::toFile).forEach(File::delete);
        } catch (Exception e) {
            // Not worth failing a match over. The folder is named for the match
            // it belonged to, so a leftover is obvious and harmless.
            Bukkit.getLogger().warning("could not delete arena " + folder + ": " + e);
        }
    }
}
