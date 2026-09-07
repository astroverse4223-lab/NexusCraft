package dev.nexuscraft.ember;

import net.minecraft.block.Block;
import net.minecraft.block.Blocks;
import net.minecraft.entity.LivingEntity;
import net.minecraft.entity.mob.Monster;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.util.math.BlockPos;
import net.minecraft.util.math.Direction;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * What Ember saw while it was over there.
 *
 * Throwing it into a room you would rather not walk into already lights the
 * place. This is the other half of why you would do that: it comes back with
 * something to say about what was in there.
 *
 * Everything here is a scan of blocks and entities the server already has
 * loaded — the same kind of look the torch placement takes, over a wider area
 * and for different things. The findings are written as plain facts and handed
 * to the model to say in its own words, so the report sounds like a lantern
 * describing a cave rather than a list.
 */
public final class Survey {

    /** How far it looks from where it landed. */
    private static final int RADIUS = 12;
    private static final int VERTICAL = 8;

    /** Ores worth mentioning. Coal and copper are not news. */
    private static final Map<Block, String> NOTABLE = new LinkedHashMap<>();

    static {
        NOTABLE.put(Blocks.DIAMOND_ORE, "diamonds");
        NOTABLE.put(Blocks.DEEPSLATE_DIAMOND_ORE, "diamonds");
        NOTABLE.put(Blocks.ANCIENT_DEBRIS, "ancient debris");
        NOTABLE.put(Blocks.EMERALD_ORE, "emeralds");
        NOTABLE.put(Blocks.DEEPSLATE_EMERALD_ORE, "emeralds");
        NOTABLE.put(Blocks.GOLD_ORE, "gold");
        NOTABLE.put(Blocks.DEEPSLATE_GOLD_ORE, "gold");
        NOTABLE.put(Blocks.IRON_ORE, "iron");
        NOTABLE.put(Blocks.DEEPSLATE_IRON_ORE, "iron");
        NOTABLE.put(Blocks.REDSTONE_ORE, "redstone");
        NOTABLE.put(Blocks.DEEPSLATE_REDSTONE_ORE, "redstone");
        NOTABLE.put(Blocks.LAPIS_ORE, "lapis");
    }

    private Survey() {
    }

    /**
     * What is here, and a signature for deciding whether it is news.
     *
     * The prose changes every time it drifts a block — one mob becomes two, an
     * ore comes into range — and comparing prose meant reporting the same cave
     * three times in twenty seconds. The signature is the *kinds* of thing
     * present, with no counts in it, so a second mob wandering in is not a
     * discovery.
     */
    public record Findings(String facts, String signature) {}

    public static Findings of(ServerWorld world, BlockPos from) {
        Map<String, Integer> ores = new LinkedHashMap<>();
        int openings = 0;
        boolean lava = false;
        boolean water = false;
        String spawner = null;
        BlockPos chest = null;

        int deepest = from.getY();

        for (int dx = -RADIUS; dx <= RADIUS; dx++) {
            for (int dz = -RADIUS; dz <= RADIUS; dz++) {
                for (int dy = -VERTICAL; dy <= VERTICAL; dy++) {
                    BlockPos pos = from.add(dx, dy, dz);
                    Block block = world.getBlockState(pos).getBlock();

                    String ore = NOTABLE.get(block);
                    if (ore != null && exposed(world, pos)) {
                        ores.merge(ore, 1, Integer::sum);
                    }

                    if (block == Blocks.SPAWNER) {
                        spawner = describeSpawner(world, pos);
                    } else if (block == Blocks.CHEST || block == Blocks.BARREL) {
                        if (chest == null) chest = pos;
                    } else if (block == Blocks.LAVA) {
                        lava = true;
                    } else if (block == Blocks.WATER) {
                        water = true;
                    }

                    // Air at the edge of the scan means the space keeps going.
                    if (world.getBlockState(pos).isAir()) {
                        if (Math.abs(dx) == RADIUS || Math.abs(dz) == RADIUS
                                || Math.abs(dy) == VERTICAL) {
                            openings++;
                        }
                        if (pos.getY() < deepest) deepest = pos.getY();
                    }
                }
            }
        }

        List<LivingEntity> hostiles = world.getEntitiesByClass(LivingEntity.class,
                new net.minecraft.util.math.Box(from).expand(RADIUS),
                candidate -> candidate instanceof Monster && candidate.isAlive());

        if (ores.isEmpty() && spawner == null && chest == null && hostiles.isEmpty()
                && !lava && openings < 40) {
            return null;
        }

        // Kinds only — no numbers, so counts drifting is not news.
        StringBuilder kinds = new StringBuilder();
        if (spawner != null) kinds.append("spawner:").append(spawner).append(' ');
        if (!hostiles.isEmpty()) kinds.append("mobs ");
        for (String ore : ores.keySet()) kinds.append(ore).append(' ');
        if (chest != null) kinds.append("chest ");
        if (lava) kinds.append("lava ");
        if (water) kinds.append("water ");
        kinds.append(openings > 120 ? "vast" : openings > 40 ? "open" : "small");

        StringBuilder facts = new StringBuilder("You were thrown into a space and had a look around. ");

        if (spawner != null) facts.append("There is a ").append(spawner).append(" spawner in here. ");
        if (!hostiles.isEmpty()) {
            facts.append("You can see ").append(hostiles.size())
                 .append(hostiles.size() == 1 ? " hostile mob. " : " hostile mobs. ");
        }
        if (!ores.isEmpty()) {
            facts.append("There is exposed ");
            facts.append(String.join(", ", ores.keySet()));
            facts.append(". ");
        }
        /*
         * Named, not located.
         *
         * Coordinates in its speech read as a debug line wearing a character's
         * name. It is leading them there or it is not; either way a lantern
         * says "there is a chest", not three numbers.
         */
        if (chest != null) facts.append("There is a chest in here. ");
        if (lava) facts.append("There is lava. ");
        if (water) facts.append("There is water. ");

        if (openings > 120) facts.append("The space keeps going a long way in several directions. ");
        else if (openings > 40) facts.append("It opens out further on. ");
        else facts.append("It is a small space, more or less enclosed. ");

        // How far down, not to what altitude — the same reason as the chest.
        if (deepest < from.getY() - 6) {
            facts.append("It drops away below you, about ").append(from.getY() - deepest)
                 .append(" blocks down. ");
        }

        return new Findings(facts.toString().trim(), kinds.toString().trim());
    }

    /** Only ore you could actually reach counts as worth mentioning. */
    private static boolean exposed(ServerWorld world, BlockPos pos) {
        for (Direction face : Direction.values()) {
            if (world.getBlockState(pos.offset(face)).isAir()) return true;
        }
        return false;
    }

    private static String describeSpawner(ServerWorld world, BlockPos pos) {
        var entity = world.getBlockEntity(pos);
        if (entity instanceof net.minecraft.block.entity.MobSpawnerBlockEntity spawner) {
            var type = spawner.getLogic().getRenderedEntity(world, pos);
            if (type != null) return type.getType().getName().getString().toLowerCase();
        }
        return "mob";
    }
}
