package dev.nexuscraft.ember;

import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.item.Item;
import net.minecraft.item.ItemStack;
import net.minecraft.item.ItemUsageContext;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.sound.SoundCategory;
import net.minecraft.sound.SoundEvents;
import net.minecraft.text.Text;
import net.minecraft.util.ActionResult;
import net.minecraft.util.Hand;
import net.minecraft.util.math.Box;
import net.minecraft.util.math.Vec3d;
import net.minecraft.world.World;

import java.util.List;

/**
 * Calls Ember, sends it away, and tells it to stop lighting things.
 *
 * One item doing three jobs because a companion should not arrive with a
 * settings screen: right-click the air to call it or send it away, sneak and
 * right-click to tell it whether to keep placing torches.
 */
public class EmberLanternItem extends Item {

    public EmberLanternItem(Settings settings) {
        super(settings);
    }

    @Override
    public ActionResult use(World world, PlayerEntity player, Hand hand) {
        if (!(world instanceof ServerWorld serverWorld)) return ActionResult.SUCCESS;

        EmberEntity existing = findOwned(serverWorld, player);

        if (player.isSneaking()) {
            if (existing == null) {
                player.sendMessage(Text.translatable("item.ember.ember_lantern.none"), true);
                return ActionResult.SUCCESS;
            }
            boolean lighting = existing.lightbringer().toggle();
            player.sendMessage(Text.translatable(lighting
                    ? "item.ember.ember_lantern.lighting_on"
                    : "item.ember.ember_lantern.lighting_off"), true);
            return ActionResult.SUCCESS;
        }

        if (existing != null) {
            dismiss(serverWorld, existing, player);
            return ActionResult.SUCCESS;
        }

        summon(serverWorld, player, player.getEntityPos().add(0.0, 1.2, 0.0));
        return ActionResult.SUCCESS;
    }

    @Override
    public ActionResult useOnBlock(ItemUsageContext context) {
        PlayerEntity player = context.getPlayer();
        if (player == null) return ActionResult.PASS;
        return use(context.getWorld(), player, context.getHand());
    }

    private void summon(ServerWorld world, PlayerEntity player, Vec3d at) {
        EmberEntity ember = Ember.EMBER.create(world, net.minecraft.entity.SpawnReason.MOB_SUMMONED);
        if (ember == null) return;

        ember.refreshPositionAndAngles(at.x, at.y, at.z, player.getYaw(), 0.0f);
        ember.setOwner(player);
        world.spawnEntity(ember);

        world.spawnParticles(net.minecraft.particle.ParticleTypes.FLAME,
                at.x, at.y, at.z, 24, 0.25, 0.25, 0.25, 0.03);
        world.playSound(null, player.getBlockPos(), SoundEvents.BLOCK_LANTERN_PLACE,
                SoundCategory.NEUTRAL, 0.8f, 1.3f);
        player.sendMessage(Text.translatable("item.ember.ember_lantern.summoned"), true);
    }

    private void dismiss(ServerWorld world, EmberEntity ember, PlayerEntity player) {
        world.spawnParticles(net.minecraft.particle.ParticleTypes.SMOKE,
                ember.getX(), ember.getY() + 0.2, ember.getZ(), 18, 0.2, 0.2, 0.2, 0.02);
        world.playSound(null, ember.getBlockPos(), SoundEvents.BLOCK_FIRE_EXTINGUISH,
                SoundCategory.NEUTRAL, 0.5f, 1.4f);
        /*
         * Whatever it was carrying goes back to the player.
         *
         * The satchel lives on the entity, so dismissing it without this would
         * quietly delete everything they had trusted it with — the worst thing
         * a container can do, and completely silent.
         */
        int returned = 0;
        var carried = ember.satchel();
        for (int slot = 0; slot < carried.size(); slot++) {
            ItemStack held = carried.getStack(slot);
            if (held.isEmpty()) continue;
            returned += held.getCount();
            if (!player.getInventory().insertStack(held)) player.dropItem(held, false);
        }
        carried.clear();

        if (returned > 0) {
            player.sendMessage(Text.literal("Ember hands back " + returned + " items it was carrying.")
                    .formatted(net.minecraft.util.Formatting.GRAY), false);
        }

        ember.discard();
        player.sendMessage(Text.translatable("item.ember.ember_lantern.dismissed"), true);
    }

    /** The player's own Ember, if one is loaded nearby. */
    private EmberEntity findOwned(ServerWorld world, PlayerEntity player) {
        Box box = player.getBoundingBox().expand(48.0);
        List<EmberEntity> found = world.getEntitiesByClass(EmberEntity.class, box,
                candidate -> player.getUuid().equals(candidate.getOwnerId()));
        return found.isEmpty() ? null : found.get(0);
    }

    @Override
    public boolean hasGlint(ItemStack stack) {
        return true;
    }
}
