package dev.nexuscraft.ember;

import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.entity.player.PlayerInventory;
import net.minecraft.inventory.SimpleInventory;
import net.minecraft.screen.GenericContainerScreenHandler;
import net.minecraft.screen.NamedScreenHandlerFactory;
import net.minecraft.screen.ScreenHandler;
import net.minecraft.text.Text;

/**
 * What Ember carries for you.
 *
 * Promised when the growth stages were sketched and then not built, which is
 * how someone ends up hunting for an inventory that never existed. It is the
 * one reward for growing that you can use rather than only look at: a spark
 * carries nothing, and an old Ember has been trusted with two rows.
 *
 * Backed by an ordinary chest screen rather than a bespoke one — there is
 * nothing about holding nine items that needs new interface, and a screen
 * everybody already knows how to use is better than a clever one.
 */
public final class Satchel implements NamedScreenHandlerFactory {

    private final EmberEntity ember;

    public Satchel(EmberEntity ember) {
        this.ember = ember;
    }

    /** How many slots a stage has earned. Nine to a row. */
    public static int slotsFor(Growth.Stage stage) {
        return switch (stage) {
            case SPARK -> 0;
            case STEADY -> 9;
            case BRIGHT -> 18;
            case ELDER -> 27;
        };
    }

    @Override
    public Text getDisplayName() {
        return Text.literal("Ember");
    }

    @Override
    public ScreenHandler createMenu(int syncId, PlayerInventory playerInventory, PlayerEntity player) {
        SimpleInventory inventory = ember.satchel();
        int rows = Math.max(1, Math.min(3, inventory.size() / 9));

        /*
         * Built directly rather than through the createGeneric helpers.
         *
         * Only the three-row helper takes an inventory in 1.21.11; the others
         * make an empty one of their own, which would show the player an empty
         * chest and quietly drop anything they put in it.
         */
        return new GenericContainerScreenHandler(
                switch (rows) {
                    case 1 -> net.minecraft.screen.ScreenHandlerType.GENERIC_9X1;
                    case 2 -> net.minecraft.screen.ScreenHandlerType.GENERIC_9X2;
                    default -> net.minecraft.screen.ScreenHandlerType.GENERIC_9X3;
                },
                syncId, playerInventory, inventory, rows);
    }
}
