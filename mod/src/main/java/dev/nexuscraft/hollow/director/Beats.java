package dev.nexuscraft.hollow.director;

import dev.nexuscraft.hollow.entity.Hunter;
import net.minecraft.block.Blocks;
import net.minecraft.particle.ParticleTypes;
import net.minecraft.registry.tag.BlockTags;
import net.minecraft.server.network.ServerPlayerEntity;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.sound.SoundCategory;
import net.minecraft.sound.SoundEvents;
import net.minecraft.text.Text;
import net.minecraft.util.Formatting;
import net.minecraft.util.math.BlockPos;
import net.minecraft.util.math.Vec3d;

import java.util.ArrayList;
import java.util.List;
import java.util.random.RandomGenerator;

/**
 * Carrying out a beat.
 *
 * Every one of these is something a server can do to an unmodified client,
 * which is what keeps the mod installable by one person on a server full of
 * people who have installed nothing.
 *
 * The rule they all follow: happen where the player is not looking. A sound in
 * front of you is an event; the same sound behind you is a presence. Almost
 * everything here picks a position out of view and works from there.
 */
public final class Beats {

    private Beats() {}

    /**
     * Runs a beat. Returns false when the world could not oblige — no torch to
     * put out, nowhere out of sight to make a noise — so the caller can leave
     * the pacing clock alone rather than burning a beat on nothing.
     */
    public static boolean perform(Beat beat, ServerPlayerEntity player, Act act, RandomGenerator random) {
        ServerWorld world = (ServerWorld) player.getEntityWorld();

        return switch (beat) {
            case NONE, SPEAK, SPEAK_AS_HOLLOW, GO_QUIET, KNOW_TOO_MUCH -> true; // dialogue only
            case SOUND_NEARBY -> soundNearby(world, player, act, random);
            case SNUFF_LIGHT -> snuffLight(world, player, random);
            case GLIMPSE -> glimpse(world, player, random);
            case STALK -> true; // handled by the companion's own positioning
            case MOVE_SOMETHING -> nudge(world, player, random);
            case DARKNESS -> darkness(world, player, random);
            case HUNT -> hunt(world, player, random);
        };
    }

    /**
     * A noise from somewhere behind.
     *
     * Played at a position rather than on the player, so it arrives with a
     * direction and a distance. A sound played at the player has neither, and
     * the brain files it as UI.
     */
    private static boolean soundNearby(ServerWorld world, ServerPlayerEntity player, Act act,
                                       RandomGenerator random) {
        Vec3d behind = outOfView(player, 6 + random.nextInt(8), random);

        /*
         * Typed as SoundEvent, and AMBIENT_CAVE unwrapped to match.
         * SoundEvents mixes the two: most constants are a plain SoundEvent
         * while the ambient ones are a RegistryEntry.Reference wrapping it, so
         * a switch over both infers Object and matches no overload.
         */
        net.minecraft.sound.SoundEvent sound = switch (random.nextInt(4)) {
            case 0 -> SoundEvents.BLOCK_STONE_STEP;
            case 1 -> SoundEvents.BLOCK_WOODEN_DOOR_CLOSE;
            case 2 -> SoundEvents.AMBIENT_CAVE.value();
            default -> SoundEvents.BLOCK_GRAVEL_STEP;
        };

        // Pitched down as the acts go on. The same footstep an octave lower is
        // not the same footstep.
        float pitch = act.atLeast(Act.WATCHING) ? 0.6f : 0.9f;
        world.playSound(null, behind.x, behind.y, behind.z, sound, SoundCategory.HOSTILE, 0.7f, pitch,
                random.nextLong());
        return true;
    }

    /** Puts out a torch the player is relying on. */
    private static boolean snuffLight(ServerWorld world, ServerPlayerEntity player, RandomGenerator random) {
        List<BlockPos> lights = new ArrayList<>();
        BlockPos at = player.getBlockPos();

        for (BlockPos pos : BlockPos.iterateOutwards(at, 8, 5, 8)) {
            if (world.getBlockState(pos).isIn(BlockTags.CANDLES)
                    || world.getBlockState(pos).isOf(Blocks.TORCH)
                    || world.getBlockState(pos).isOf(Blocks.WALL_TORCH)
                    || world.getBlockState(pos).isOf(Blocks.LANTERN)) {
                lights.add(pos.toImmutable());
            }
        }
        if (lights.isEmpty()) return false;

        BlockPos target = lights.get(random.nextInt(lights.size()));
        world.setBlockState(target, Blocks.AIR.getDefaultState());
        // The puff sells it. A torch that vanishes silently reads as a bug.
        world.spawnParticles(ParticleTypes.SMOKE, target.getX() + 0.5, target.getY() + 0.5,
                target.getZ() + 0.5, 8, 0.1, 0.1, 0.1, 0.01);
        world.playSound(null, target.getX() + 0.5, target.getY() + 0.5, target.getZ() + 0.5,
                SoundEvents.BLOCK_FIRE_EXTINGUISH, SoundCategory.BLOCKS, 0.6f, 1.2f, random.nextLong());
        return true;
    }

    /** Something at the edge of vision that is gone when you turn. */
    private static boolean glimpse(ServerWorld world, ServerPlayerEntity player, RandomGenerator random) {
        Vec3d spot = outOfView(player, 8 + random.nextInt(6), random);
        world.spawnParticles(ParticleTypes.SMOKE, spot.x, spot.y + 1.2, spot.z, 12, 0.15, 0.4, 0.15, 0.0);
        world.spawnParticles(ParticleTypes.SOUL_FIRE_FLAME, spot.x, spot.y + 1.5, spot.z, 2, 0.05, 0.05,
                0.05, 0.0);
        return true;
    }

    /**
     * Something small, moved.
     *
     * Only ever an item lying on the ground, and only ever a short shove. The
     * temptation is to touch what the player built; a mod that edits someone's
     * base has stopped being a horror mod and started being a grief.
     */
    private static boolean nudge(ServerWorld world, ServerPlayerEntity player, RandomGenerator random) {
        var items = world.getEntitiesByClass(net.minecraft.entity.ItemEntity.class,
                player.getBoundingBox().expand(12), entity -> true);
        if (items.isEmpty()) return false;

        var item = items.get(random.nextInt(items.size()));
        item.addVelocity((random.nextDouble() - 0.5) * 0.4, 0.15, (random.nextDouble() - 0.5) * 0.4);
        item.velocityDirty = true;
        return true;
    }

    /**
     * Sends something after them.
     *
     * Only at night, and only one at a time — both enforced in Hunter. Returns
     * false in daylight rather than spawning anyway, so the director simply
     * picks something else and the beat is not wasted.
     */
    private static boolean hunt(ServerWorld world, ServerPlayerEntity player, RandomGenerator random) {
        if (!Hunter.conditionsMet(world, Act.HOLLOW)) return false;
        if (Hunter.current(world, player) != null) return false;

        boolean released = Hunter.release(player, random) != null;
        if (released) {
            // Not a scream. The sound of something a long way off noticing you.
            world.playSound(null, player.getX(), player.getY(), player.getZ(),
                    SoundEvents.AMBIENT_CAVE.value(), SoundCategory.HOSTILE, 1.0f, 0.35f, random.nextLong());
        }
        return released;
    }

    /** Everything nearby goes out at once. */
    private static boolean darkness(ServerWorld world, ServerPlayerEntity player, RandomGenerator random) {
        boolean any = false;
        for (int i = 0; i < 6; i++) any |= snuffLight(world, player, random);

        player.addStatusEffect(new net.minecraft.entity.effect.StatusEffectInstance(
                net.minecraft.entity.effect.StatusEffects.BLINDNESS, 60, 0, false, false));
        world.playSound(null, player.getX(), player.getY(), player.getZ(), SoundEvents.AMBIENT_CAVE.value(),
                SoundCategory.HOSTILE, 1.0f, 0.5f, random.nextLong());
        return any;
    }

    /**
     * A point roughly behind the player.
     *
     * Behind, not merely away: the whole effect depends on it being somewhere
     * they would have to turn around to look at.
     */
    private static Vec3d outOfView(ServerPlayerEntity player, double distance, RandomGenerator random) {
        // Their facing, plus half a turn, plus a bit of slop.
        double angle = Math.toRadians(player.getYaw() + 180 + (random.nextDouble() - 0.5) * 90);
        return new Vec3d(
                player.getX() + Math.sin(angle) * distance,
                player.getY() + random.nextInt(2),
                player.getZ() - Math.cos(angle) * distance
        );
    }

    /** How the companion's voice appears in chat. */
    public static void say(ServerPlayerEntity player, String line, Act act) {
        Formatting colour = switch (act) {
            case COMPANION -> Formatting.AQUA;
            case UNEASE -> Formatting.WHITE;
            case WATCHING -> Formatting.GRAY;
            case HOLLOW -> Formatting.DARK_RED;
        };
        player.sendMessage(Text.literal("").append(Text.literal("◕ ").formatted(colour))
                .append(Text.literal(line).formatted(colour)), false);
    }
}
