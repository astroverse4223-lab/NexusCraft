package dev.nexuscraft.hollow.director;

import net.minecraft.block.Blocks;
import net.minecraft.particle.ParticleTypes;
import net.minecraft.server.network.ServerPlayerEntity;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.sound.SoundCategory;
import net.minecraft.sound.SoundEvents;
import net.minecraft.util.math.BlockPos;

import java.util.List;
import java.util.random.RandomGenerator;

/**
 * How it arrives: shut in a box, asking to be let out.
 *
 * The mod used to simply have a face beside you from the first tick, and that
 * is the weakest possible opening — nothing happened, so there is nothing to
 * feel about it. Everything the last act does depends on the player having
 * liked this thing, and liking something starts with having done it a favour.
 *
 * So it starts trapped. It calls out, muffled, from inside a box near where you
 * spawn; you break it open; it thanks you and tells you its name. That is a
 * transaction — you chose to help it, which is a far better footing for what
 * happens later than "a face was there when I logged in".
 *
 * The lines from inside are the only place in the mod where it is frightened.
 * That is deliberate. It never sounds like this again, and by the last act a
 * player who remembers it will find the memory does not sit well.
 */
public final class Arrival {

    private Arrival() {}

    /** What it says from inside, in order, one per attempt. */
    private static final List<String> MUFFLED = List.of(
            "…hello? is someone there?",
            "please — I can hear you walking",
            "I've been in here a long time",
            "it's dark. would you open it?",
            "you're still there. good. please."
    );

    /** What it says the moment it is out. */
    public static final List<String> INTRODUCTION = List.of(
            "Oh — oh, thank you. Thank you.",
            "That's better. Hello.",
            "I'm Hollow. That's not a name so much as a description, but it'll do.",
            "I'll stay with you, if that's all right. I'm good company."
    );

    /**
     * Somewhere to put the box.
     *
     * On the ground, close enough to be found immediately, and never inside
     * anything. A box the player has to go looking for is a box they never open,
     * and the whole opening depends on them opening it.
     */
    public static BlockPos placeNear(ServerWorld world, ServerPlayerEntity player, RandomGenerator random) {
        /*
         * Floating, in front, at eye level.
         *
         * The first version dropped it on the ground somewhere within four
         * blocks, and a player reported nearly not finding it — which for the
         * one interaction the whole mod opens with is fatal. A chest resting on
         * the grass is scenery. A chest hanging in the air two blocks in front
         * of your face is unmistakably something.
         *
         * Placed with the game's own facing vector for the same reason the
         * companion is: hand-rolled trigonometry got the sign wrong three times.
         */
        net.minecraft.util.math.Vec3d look = player.getRotationVec(1f);
        net.minecraft.util.math.Vec3d forward =
                new net.minecraft.util.math.Vec3d(look.x, 0, look.z).normalize();

        for (double distance = 2.5; distance <= 5.0; distance += 1.0) {
            net.minecraft.util.math.Vec3d spot = player.getEntityPos()
                    .add(forward.multiply(distance))
                    .add(0, 1.2, 0);
            BlockPos candidate = BlockPos.ofFloored(spot);

            if (world.getBlockState(candidate).isReplaceable()) {
                world.setBlockState(candidate, Blocks.CHEST.getDefaultState());
                return candidate;
            }
        }

        /*
         * Every spot in front was solid — they spawned facing a wall. Directly
         * above them is always reachable and always visible, and a box over
         * your head is stranger than one in front of you rather than worse.
         */
        BlockPos above = player.getBlockPos().up(2);
        world.setBlockState(above, Blocks.CHEST.getDefaultState());
        return above;
    }

    /** A knock and a line, so the player knows where to look. */
    public static void callOut(ServerWorld world, ServerPlayerEntity player, BlockPos box, int attempt,
                               RandomGenerator random) {
        String line = MUFFLED.get(Math.min(attempt, MUFFLED.size() - 1));

        // Muffled: quiet, low, and from the box rather than from the player.
        world.playSound(null, box.getX() + 0.5, box.getY() + 0.5, box.getZ() + 0.5,
                SoundEvents.BLOCK_CHEST_LOCKED, SoundCategory.BLOCKS, 0.5f, 0.7f, random.nextLong());

        /*
         * Seen as well as heard. A line in chat tells you it exists; particles
         * tell you where, and a player who cannot find the box never opens it.
         */
        world.spawnParticles(ParticleTypes.END_ROD, box.getX() + 0.5, box.getY() + 1.1, box.getZ() + 0.5,
                6, 0.15, 0.15, 0.15, 0.01);

        player.sendMessage(net.minecraft.text.Text.literal("(from inside the box) " + line)
                .formatted(net.minecraft.util.Formatting.DARK_GRAY), false);
    }

    /**
     * Opened. The box breaks, and it is out.
     *
     * The box is removed rather than left standing — a chest that still sits
     * there afterwards is a chest, and the player will try to store things in it
     * and find it gone next session.
     */
    public static void release(ServerWorld world, ServerPlayerEntity player, BlockPos box,
                               RandomGenerator random) {
        world.breakBlock(box, false);

        world.spawnParticles(ParticleTypes.END_ROD, box.getX() + 0.5, box.getY() + 0.8, box.getZ() + 0.5,
                24, 0.25, 0.25, 0.25, 0.02);
        world.playSound(null, box.getX() + 0.5, box.getY() + 0.5, box.getZ() + 0.5,
                SoundEvents.BLOCK_CHEST_OPEN, SoundCategory.BLOCKS, 0.8f, 1.4f, random.nextLong());
        world.playSound(null, box.getX() + 0.5, box.getY() + 0.5, box.getZ() + 0.5,
                SoundEvents.ENTITY_ALLAY_ITEM_GIVEN, SoundCategory.NEUTRAL, 0.7f, 1.6f, random.nextLong());
    }

    /** Whether a block is the one holding it. */
    public static boolean isTheBox(BlockPos pos, BlockPos box) {
        return box != null && pos.equals(box);
    }
}
