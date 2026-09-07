package dev.nexuscraft.ember;

import net.minecraft.block.Block;
import net.minecraft.block.BlockState;
import net.minecraft.block.Blocks;
import net.minecraft.block.WallTorchBlock;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.sound.SoundCategory;
import net.minecraft.sound.SoundEvents;
import net.minecraft.state.property.Properties;
import net.minecraft.util.math.BlockPos;
import net.minecraft.util.math.Direction;
import net.minecraft.world.LightType;

/**
 * The part that actually earns its keep: putting torches where the dark is.
 *
 * A spawn needs block light zero, which is a thing the game already knows and
 * the player never can. Rather than lighting everything on sight, this looks
 * only at the places a mob could actually appear in front of the player, and
 * fixes the nearest one every few seconds — the room brightens as you walk
 * through it, which reads as company rather than as a floodlight.
 */
public class Lightbringer {

    /** Ticks between placements. Deliberately unhurried. */
    private static final int INTERVAL = 45;

    /**
     * How far up and down it will consider.
     *
     * The horizontal reach comes from how grown Ember is; this does not, because
     * a taller search finds spots on ledges nobody walks on.
     */
    private static final int VERTICAL = 3;

    /** Nothing is placed closer than this to the last one. */
    private static final double SPACING = 4.5;

    private boolean enabled = true;
    private int cooldown;
    private BlockPos lastPlaced;

    public boolean isEnabled() {
        return enabled;
    }

    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }

    public boolean toggle() {
        enabled = !enabled;
        return enabled;
    }

    /**
     * A pass over the dark nearby.
     *
     * `owner` may be null, which means Ember has been thrown somewhere and
     * should light where it is sitting rather than where the player is
     * standing — otherwise throwing it into a cave lights the field you threw
     * it from.
     */
    public void tick(ServerWorld world, EmberEntity ember, PlayerEntity owner) {
        if (!enabled) return;
        if (cooldown-- > 0) return;
        /*
         * How hard it works, and how far it can see to work, both follow how
         * grown it is — which is the whole point of growing.
         */
        Growth.Stage stage = ember.getStage();
        cooldown = owner == null ? stage.lightInterval / 3 : stage.lightInterval;

        BlockPos spot = findDarkSpot(world,
                owner == null ? ember.getBlockPos() : owner.getBlockPos(), stage.lightRadius);
        if (spot == null) return;

        BlockState torch = torchFor(world, spot);
        if (torch == null) return;

        if (!world.setBlockState(spot, torch)) return;

        lastPlaced = spot;
        if (ember.getOwnerId() != null) Growth.placedTorch(ember.getOwnerId());
        world.spawnParticles(net.minecraft.particle.ParticleTypes.SMALL_FLAME,
                spot.getX() + 0.5, spot.getY() + 0.5, spot.getZ() + 0.5, 6, 0.1, 0.1, 0.1, 0.01);
        world.playSound(null, spot, SoundEvents.BLOCK_WOOD_PLACE, SoundCategory.BLOCKS, 0.4f, 1.5f);
    }

    /**
     * The nearest place a mob could spawn in front of the player.
     *
     * Searched nearest-first so the light lands where it is most useful rather
     * than at whichever corner the loop happened to reach first.
     */
    private BlockPos findDarkSpot(ServerWorld world, BlockPos origin, int radius) {
        BlockPos best = null;
        double bestDistance = Double.MAX_VALUE;

        for (int dx = -radius; dx <= radius; dx++) {
            for (int dz = -radius; dz <= radius; dz++) {
                for (int dy = -VERTICAL; dy <= VERTICAL; dy++) {
                    BlockPos pos = origin.add(dx, dy, dz);

                    if (world.getLightLevel(LightType.BLOCK, pos) > 0) continue;
                    if (!world.getBlockState(pos).isAir()) continue;

                    /*
                     * Under open sky, only after dark.
                     *
                     * This used to skip every position the sky could reach,
                     * which sounded right — the sun handles those — and meant
                     * Ember did nothing whatsoever on the surface, including at
                     * midnight, which is precisely when the surface is the most
                     * dangerous place to stand. Daylight is the sun's problem;
                     * night is not.
                     */
                    if (world.isSkyVisible(pos) && world.getLightLevel(LightType.SKY, pos) > 7) continue;

                    double distance = pos.getSquaredDistance(origin);
                    if (distance >= bestDistance) continue;
                    if (lastPlaced != null && Math.sqrt(pos.getSquaredDistance(lastPlaced)) < SPACING) continue;
                    if (!canHoldTorch(world, pos)) continue;

                    best = pos;
                    bestDistance = distance;
                }
            }
        }

        return best;
    }

    private boolean canHoldTorch(ServerWorld world, BlockPos pos) {
        return torchFor(world, pos) != null;
    }

    /**
     * A standing torch where there is a floor, a wall torch where there is not.
     *
     * Placing a floor torch with nothing under it drops it as an item the
     * moment the block update runs, which looks exactly like Ember littering.
     */
    private BlockState torchFor(ServerWorld world, BlockPos pos) {
        BlockState floor = world.getBlockState(pos.down());
        if (floor.isSideSolidFullSquare(world, pos.down(), Direction.UP)) {
            return Blocks.TORCH.getDefaultState();
        }

        for (Direction facing : Direction.Type.HORIZONTAL) {
            BlockPos behind = pos.offset(facing.getOpposite());
            BlockState wall = world.getBlockState(behind);
            if (!wall.isSideSolidFullSquare(world, behind, facing)) continue;

            BlockState torch = Blocks.WALL_TORCH.getDefaultState()
                    .with(Properties.HORIZONTAL_FACING, facing);
            if (torch.canPlaceAt(world, pos)) return torch;
        }

        return null;
    }

    /** Kept so the class reads as owning the block choice, not guessing at it. */
    static boolean isTorch(Block block) {
        return block == Blocks.TORCH || block instanceof WallTorchBlock;
    }
}
