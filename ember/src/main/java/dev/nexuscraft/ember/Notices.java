package dev.nexuscraft.ember;

import net.minecraft.block.Block;
import net.minecraft.block.Blocks;
import net.minecraft.entity.LivingEntity;
import net.minecraft.entity.mob.CreeperEntity;
import net.minecraft.entity.mob.Monster;
import net.minecraft.server.network.ServerPlayerEntity;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.util.math.BlockPos;
import net.minecraft.util.math.Vec3d;
import net.minecraft.world.LightType;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * The things Ember spots and mentions without being asked.
 *
 * A companion that only answers questions is a search box that floats. What
 * makes one feel present is that it looks at the same world you do and
 * occasionally says something first.
 *
 * The hard part is restraint, not detection. Something that comments on
 * everything is worse company than something silent, so each kind of remark has
 * its own cooldown, there is a floor between any two remarks at all, and
 * anything already obvious to the player is left unsaid — nobody needs to be
 * told there is a zombie in front of them.
 */
public final class Notices {

    /** Never two remarks closer together than this, whatever happens. */
    private static final long FLOOR_MS = 25_000;

    /** Per-kind cooldowns, so one thing cannot dominate. */
    private static final long DANGER_MS = 45_000;
    private static final long HURT_MS = 60_000;
    private static final long NIGHTFALL_MS = 8 * 60_000;
    private static final long ORE_MS = 90_000;

    /** Ores worth interrupting for. Coal and copper are not. */
    private static final Set<Block> WORTH_MENTIONING = Set.of(
            Blocks.DIAMOND_ORE, Blocks.DEEPSLATE_DIAMOND_ORE,
            Blocks.ANCIENT_DEBRIS,
            Blocks.EMERALD_ORE, Blocks.DEEPSLATE_EMERALD_ORE);

    private static final Map<UUID, Map<String, Long>> SAID = new ConcurrentHashMap<>();

    private Notices() {
    }

    /** One thing worth saying, or null. Called a few times a second at most. */
    public static String spot(ServerWorld world, ServerPlayerEntity player, EmberEntity ember) {
        if (ember.getMood() == Mood.SULKING) return null;

        UUID who = player.getUuid();
        long now = System.currentTimeMillis();
        if (now - lastAnything(who) < FLOOR_MS) return null;

        String creeper = creeperBehind(world, player, who, now);
        if (creeper != null) return creeper;

        String hurt = badlyHurt(player, who, now);
        if (hurt != null) return hurt;

        String ore = orePassed(world, player, who, now);
        if (ore != null) return ore;

        return caughtOutside(world, player, who, now);
    }

    /**
     * Something dangerous behind them.
     *
     * Behind specifically: what is in front is already on their screen, and a
     * lantern announcing a zombie the player is currently looking at is the
     * sort of thing that makes people turn a mod off.
     */
    private static String creeperBehind(ServerWorld world, ServerPlayerEntity player,
                                        UUID who, long now) {
        if (!ready(who, "danger", DANGER_MS, now)) return null;

        Vec3d facing = Vec3d.fromPolar(0.0f, player.getYaw()).normalize();
        List<LivingEntity> hostiles = world.getEntitiesByClass(LivingEntity.class,
                player.getBoundingBox().expand(9.0),
                candidate -> candidate instanceof Monster && candidate.isAlive());

        for (LivingEntity hostile : hostiles) {
            Vec3d toward = hostile.getEntityPos().subtract(player.getEntityPos()).normalize();
            // Negative dot product means it is behind them.
            if (facing.dotProduct(toward) > -0.15) continue;

            double distance = hostile.distanceTo(player);
            if (distance > 8.0) continue;

            mark(who, "danger", now);
            String what = hostile instanceof CreeperEntity ? "a creeper" : "a " + hostile.getType().getName().getString();
            return "[Something is happening: " + what + " is " + Math.round(distance)
                    + " blocks behind them and they have not seen it. Warn them, in a few words.]";
        }
        return null;
    }

    private static String badlyHurt(ServerPlayerEntity player, UUID who, long now) {
        if (player.getHealth() > 6.0f) return null;
        if (!ready(who, "hurt", HURT_MS, now)) return null;

        mark(who, "hurt", now);
        return "[Something is happening: they are down to " + Math.round(player.getHealth())
                + " health. Say something about it — briefly, and without panicking.]";
    }

    /**
     * Something good in a wall they walked straight past.
     *
     * Only what is exposed and behind them, for the same reason as the mobs:
     * pointing at ore already on screen is noise.
     */
    private static String orePassed(ServerWorld world, ServerPlayerEntity player,
                                    UUID who, long now) {
        if (!ready(who, "ore", ORE_MS, now)) return null;

        BlockPos at = player.getBlockPos();
        for (int dx = -5; dx <= 5; dx++) {
            for (int dy = -4; dy <= 2; dy++) {
                for (int dz = -5; dz <= 5; dz++) {
                    BlockPos pos = at.add(dx, dy, dz);
                    if (!WORTH_MENTIONING.contains(world.getBlockState(pos).getBlock())) continue;

                    // Exposed to a space they could actually reach it from.
                    boolean open = false;
                    for (net.minecraft.util.math.Direction face : net.minecraft.util.math.Direction.values()) {
                        if (world.getBlockState(pos.offset(face)).isAir()) {
                            open = true;
                            break;
                        }
                    }
                    if (!open) continue;

                    mark(who, "ore", now);
                    String name = world.getBlockState(pos).getBlock().getName().getString();
                    return "[Something is happening: there is exposed " + name + " at "
                            + pos.getX() + ", " + pos.getY() + ", " + pos.getZ()
                            + ", close by and they have not touched it. Point it out.]";
                }
            }
        }
        return null;
    }

    /** Night falling while they are out in the open with nothing lit. */
    private static String caughtOutside(ServerWorld world, ServerPlayerEntity player,
                                        UUID who, long now) {
        long time = world.getTimeOfDay() % 24000L;
        if (time < 12200 || time > 13600) return null;
        if (!world.isSkyVisible(player.getBlockPos())) return null;
        if (world.getLightLevel(LightType.BLOCK, player.getBlockPos()) > 0) return null;
        if (!ready(who, "nightfall", NIGHTFALL_MS, now)) return null;

        mark(who, "nightfall", now);
        return "[Something is happening: the sun is going down and they are out in the open with "
                + "nothing lit nearby. Mention it.]";
    }

    /* --------------------------------------------------------- cooldowns */

    private static boolean ready(UUID who, String kind, long cooldown, long now) {
        Map<String, Long> theirs = SAID.get(who);
        if (theirs == null) return true;
        Long last = theirs.get(kind);
        return last == null || now - last >= cooldown;
    }

    private static void mark(UUID who, String kind, long now) {
        SAID.computeIfAbsent(who, id -> new ConcurrentHashMap<>()).put(kind, now);
        SAID.get(who).put("any", now);
    }

    private static long lastAnything(UUID who) {
        Map<String, Long> theirs = SAID.get(who);
        if (theirs == null) return 0L;
        return theirs.getOrDefault("any", 0L);
    }

    public static void forget(UUID who) {
        SAID.remove(who);
    }
}
