package dev.nexuscraft.ember.client;

import dev.nexuscraft.ember.Ember;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.world.ClientWorld;
import net.minecraft.particle.DustParticleEffect;
import net.minecraft.util.math.BlockPos;
import net.minecraft.util.math.Direction;
import net.minecraft.world.LightType;

import java.util.ArrayList;
import java.util.List;

/**
 * Shows which blocks a mob could actually spawn on.
 *
 * The game knows the block light level of every position and the player never
 * can — you learn to squint at a cave floor and guess, and you are wrong often
 * enough to come back to a creeper in your basement. Ember spends its existence
 * fixing exactly this, so letting you see what it is looking at costs nothing
 * and turns cave-proofing from a guess into a job with an end.
 *
 * Drawn with particles rather than a custom render pass on purpose. 1.21.11
 * reworked the render pipeline, and a coloured dust particle at a block face is
 * a fraction of the surface area, works with every shader pack, and cannot
 * break anyone's game if it is wrong.
 */
public final class DarkSight {

    /** How far around the player it looks. */
    private static final int RADIUS = 12;
    private static final int VERTICAL = 6;

    /** Ticks between sweeps. Fast enough to feel live, slow enough to be free. */
    private static final int INTERVAL = 10;

    /** Nothing is drawn beyond this many marks, however dark the room is. */
    private static final int MAX_MARKS = 220;

    /** A dull red, which reads as a warning without drowning the torchlight. */
    private static final DustParticleEffect MARK =
            new DustParticleEffect(0xE0553F, 0.8f);

    private static int cooldown;

    private DarkSight() {
    }

    /**
     * Called every client tick.
     *
     * Only while the lantern is actually in a hand: this is a tool you hold up
     * to look at a room, not a permanent overlay, and permanently marking the
     * world would make every cave look like a hazard sign.
     */
    public static void tick() {
        MinecraftClient client = MinecraftClient.getInstance();
        if (client.player == null || client.world == null) return;
        if (client.isPaused()) return;

        if (!holdingTheLantern(client)) {
            cooldown = 0;
            return;
        }

        if (cooldown-- > 0) return;
        cooldown = INTERVAL;

        for (BlockPos spot : spawnableSpots(client.world, client.player.getBlockPos())) {
            client.world.addParticleClient(MARK,
                    spot.getX() + 0.5,
                    // Just above the floor it would spawn on, so the mark reads
                    // as being on the surface rather than floating in the room.
                    spot.getY() + 0.08,
                    spot.getZ() + 0.5,
                    0.0, 0.0, 0.0);
        }
    }

    private static boolean holdingTheLantern(MinecraftClient client) {
        if (client.player == null) return false;
        return client.player.getMainHandStack().getItem() == Ember.EMBER_LANTERN
                || client.player.getOffHandStack().getItem() == Ember.EMBER_LANTERN;
    }

    /**
     * Every position a hostile could appear in.
     *
     * The real rule is block light zero, room for the mob, and something solid
     * underneath. Sky light is deliberately ignored: a spot that is safe at
     * noon because the sun reaches it is exactly the spot that kills you at
     * midnight, and marking it is the useful answer.
     */
    private static List<BlockPos> spawnableSpots(ClientWorld world, BlockPos around) {
        List<BlockPos> found = new ArrayList<>();

        for (int dx = -RADIUS; dx <= RADIUS && found.size() < MAX_MARKS; dx++) {
            for (int dz = -RADIUS; dz <= RADIUS && found.size() < MAX_MARKS; dz++) {
                for (int dy = -VERTICAL; dy <= VERTICAL && found.size() < MAX_MARKS; dy++) {
                    BlockPos pos = around.add(dx, dy, dz);

                    if (world.getLightLevel(LightType.BLOCK, pos) > 0) continue;

                    // Room to stand: two blocks of space over a solid floor.
                    if (!world.getBlockState(pos).isAir()) continue;
                    if (!world.getBlockState(pos.up()).isAir()) continue;

                    BlockPos below = pos.down();
                    if (!world.getBlockState(below).isSideSolidFullSquare(world, below, Direction.UP)) {
                        continue;
                    }

                    found.add(pos);
                }
            }
        }

        return found;
    }
}
