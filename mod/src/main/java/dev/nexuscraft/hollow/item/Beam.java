package dev.nexuscraft.hollow.item;

import net.minecraft.block.Blocks;
import net.minecraft.block.LightBlock;
import net.minecraft.item.ItemStack;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.network.ServerPlayerEntity;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.util.hit.HitResult;
import net.minecraft.util.math.BlockPos;
import net.minecraft.util.math.Vec3d;
import net.minecraft.world.RaycastContext;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/**
 * The light the flashlight actually casts.
 *
 * One invisible light block, moved to wherever the player is looking, once
 * every few ticks. That is the whole trick, and the whole difficulty is in the
 * housekeeping: a light block left behind is a permanent bright spot in
 * somebody's world with no way to see it or remove it, and there are a dozen
 * ways to leave one — putting the lamp away, dying, logging out, walking
 * through a portal, the chunk unloading while you look at it.
 *
 * So every placement is recorded against the player who caused it, and there is
 * exactly one of them at a time. Anything that ends the beam clears it, and
 * anything this class cannot account for is cleared on the next tick anyway,
 * because the rule is "one light per player, wherever they are looking now".
 */
public final class Beam {

    /** How far the beam reaches. */
    private static final double RANGE = 11.0;

    /** Ticks between moves. Light updates are not free. */
    private static final int EVERY = 3;

    /** Where each player's light currently sits. */
    private static final Map<UUID, BlockPos> LIGHTS = new HashMap<>();

    private Beam() {
    }

    /** Called from the server tick. Cheap on the ticks it does nothing. */
    public static void tick(MinecraftServer server) {
        if (server.getTicks() % EVERY != 0) return;

        for (ServerPlayerEntity player : server.getPlayerManager().getPlayerList()) {
            ItemStack holding = held(player);

            if (holding == null || !FlashlightItem.isLit(holding)
                    || !FlashlightItem.hasCharge(holding)) {
                if (holding != null && FlashlightItem.isLit(holding)
                        && !FlashlightItem.hasCharge(holding)) {
                    // Ran out while lit. Switch it off so the click that turns
                    // it back on is the player's, not a flicker.
                    FlashlightItem.setLit(holding, false);
                }
                clear(player);
                continue;
            }

            /*
             * The battery drains here rather than in the item, because this is
             * the only place that knows the lamp is actually lit *and* in
             * somebody's hand. An item does not tick in an inventory.
             */
            holding.setDamage(Math.min(holding.getMaxDamage() - 1, holding.getDamage() + EVERY));

            move(player);
        }
    }

    /** The lit flashlight in either hand, or null. */
    private static ItemStack held(ServerPlayerEntity player) {
        ItemStack main = player.getMainHandStack();
        if (main.getItem() instanceof FlashlightItem) return main;

        ItemStack off = player.getOffHandStack();
        if (off.getItem() instanceof FlashlightItem) return off;

        return null;
    }

    /**
     * Puts the light where they are looking.
     *
     * Stopped one block short of whatever it hits, in the air, because a light
     * block cannot replace stone — and because a lamp pointed at a wall should
     * light the wall rather than the inside of it.
     */
    private static void move(ServerPlayerEntity player) {
        if (!(player.getEntityWorld() instanceof ServerWorld world)) return;

        Vec3d eye = player.getEyePos();
        Vec3d look = player.getRotationVec(1.0f);
        Vec3d end = eye.add(look.multiply(RANGE));

        var hit = world.raycast(new RaycastContext(
                eye, end,
                RaycastContext.ShapeType.COLLIDER,
                RaycastContext.FluidHandling.NONE,
                player));

        Vec3d landing = hit.getType() == HitResult.Type.MISS
                ? end
                : hit.getPos().subtract(look.multiply(0.6));

        BlockPos want = BlockPos.ofFloored(landing);
        BlockPos current = LIGHTS.get(player.getUuid());

        if (want.equals(current)) return;
        if (!world.getBlockState(want).isAir()) {
            // Looking into a solid corner. Keep the last light rather than
            // dropping it, or the beam strobes as you sweep across geometry.
            return;
        }

        clear(player);

        world.setBlockState(want, Blocks.LIGHT.getDefaultState()
                .with(LightBlock.LEVEL_15, 15), 2 | 16);
        LIGHTS.put(player.getUuid(), want);
    }

    /**
     * Takes a player's light away.
     *
     * Guarded on it still being a light block: the player may have built over
     * it, or a creeper may have removed the whole room, and turning whatever is
     * there now into air would be this mod quietly deleting somebody's wall.
     */
    public static void clear(ServerPlayerEntity player) {
        BlockPos at = LIGHTS.remove(player.getUuid());
        if (at == null) return;
        if (!(player.getEntityWorld() instanceof ServerWorld world)) return;

        if (world.getBlockState(at).isOf(Blocks.LIGHT)) {
            world.setBlockState(at, Blocks.AIR.getDefaultState(), 2 | 16);
        }
    }

    /** On disconnect, so nothing is left burning in an empty world. */
    public static void forget(ServerPlayerEntity player) {
        clear(player);
    }
}
