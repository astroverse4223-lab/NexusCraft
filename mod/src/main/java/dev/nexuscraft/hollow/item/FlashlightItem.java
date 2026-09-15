package dev.nexuscraft.hollow.item;

import net.minecraft.component.DataComponentTypes;
import net.minecraft.component.type.NbtComponent;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.item.Item;
import net.minecraft.item.ItemStack;
import net.minecraft.item.ItemUsageContext;
import net.minecraft.nbt.NbtCompound;
import net.minecraft.sound.SoundCategory;
import net.minecraft.sound.SoundEvents;
import net.minecraft.util.ActionResult;
import net.minecraft.util.Hand;
import net.minecraft.world.World;

/**
 * A torch you point.
 *
 * Minecraft has no directional light and cannot be given one without rewriting
 * how the world is lit, so this does the thing every mod that has solved it
 * does: it puts an invisible light block where you are looking and moves it as
 * you look elsewhere. What you get is a pool of light out in front of you that
 * travels with your gaze, which is close enough to a beam that nobody asks.
 *
 * The battery is the point of it, not a tax. A lamp that never runs out turns a
 * dark night into a slightly inconvenient day; one with eleven minutes in it
 * turns every trip out of the house into a decision. It drains only while lit,
 * and switching it off is always available — which means the tension is
 * entirely in what you are willing to walk back through unlit.
 */
public class FlashlightItem extends Item {

    /** Ticks of light in a full battery. Eleven minutes and a bit. */
    public static final int BATTERY = 13_400;

    /** Where the on/off flag lives, inside the stack's own data. */
    private static final String LIT = "Lit";

    public FlashlightItem(Settings settings) {
        super(settings);
    }

    /* --------------------------------------------------------- the switch */

    public static boolean isLit(ItemStack stack) {
        NbtComponent data = stack.get(DataComponentTypes.CUSTOM_DATA);
        return data != null && data.copyNbt().getBoolean(LIT, false);
    }

    public static void setLit(ItemStack stack, boolean lit) {
        NbtCompound nbt = new NbtCompound();
        NbtComponent existing = stack.get(DataComponentTypes.CUSTOM_DATA);
        if (existing != null) nbt = existing.copyNbt();

        nbt.putBoolean(LIT, lit);
        stack.set(DataComponentTypes.CUSTOM_DATA, NbtComponent.of(nbt));
    }

    /** Whether there is anything left in it. */
    public static boolean hasCharge(ItemStack stack) {
        return stack.getDamage() < stack.getMaxDamage() - 1;
    }

    /* ---------------------------------------------------------- using it */

    @Override
    public ActionResult use(World world, PlayerEntity player, Hand hand) {
        ItemStack stack = player.getStackInHand(hand);

        /*
         * A flat battery can still be clicked, and says so by refusing to
         * light. Silently doing nothing reads as a broken item; a click that
         * makes the switch sound and produces no light reads as a flat battery,
         * which is the thing that has actually happened.
         */
        boolean wants = !isLit(stack);
        if (wants && !hasCharge(stack)) {
            world.playSound(null, player.getX(), player.getY(), player.getZ(),
                    SoundEvents.BLOCK_LEVER_CLICK, SoundCategory.PLAYERS, 0.4f, 0.7f);
            return ActionResult.CONSUME;
        }

        setLit(stack, wants);
        world.playSound(null, player.getX(), player.getY(), player.getZ(),
                SoundEvents.BLOCK_LEVER_CLICK, SoundCategory.PLAYERS,
                0.5f, wants ? 1.4f : 1.0f);

        return ActionResult.SUCCESS;
    }

    /**
     * Clicking a block with it toggles too, rather than doing nothing.
     *
     * Without this, using the lamp while facing a wall — which in a dark
     * corridor is most of the time — silently fails, because a block use takes
     * priority over an air use and this item has no block behaviour.
     */
    @Override
    public ActionResult useOnBlock(ItemUsageContext context) {
        PlayerEntity player = context.getPlayer();
        if (player == null) return ActionResult.PASS;
        return use(context.getWorld(), player, context.getHand());
    }
}
