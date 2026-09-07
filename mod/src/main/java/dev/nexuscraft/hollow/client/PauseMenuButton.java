package dev.nexuscraft.hollow.client;

import net.fabricmc.fabric.api.client.screen.v1.ScreenEvents;
import net.fabricmc.fabric.api.client.screen.v1.Screens;
import net.minecraft.client.gui.screen.GameMenuScreen;
import net.minecraft.client.gui.widget.ButtonWidget;
import net.minecraft.text.Text;

/**
 * A way in, from the pause menu.
 *
 * Vanilla Minecraft has no mods button — that is ModMenu, which is a separate
 * download. So a player who pauses the game looking for the mod they just
 * installed finds nothing at all, concludes it is not loaded, and they are not
 * being unreasonable: there is genuinely nothing on the screen that says
 * otherwise.
 *
 * One button fixes that, with no dependency on anything. Added through Fabric's
 * screen events rather than a mixin on `GameMenuScreen`, because this only
 * needs to put a widget on a screen, and a mixin against a class Mojang rewrites
 * every few versions would be a maintenance cost with no benefit.
 *
 * Placed in the bottom-left corner rather than in the main column. The pause
 * menu's buttons are laid out in a fixed grid and inserting into it pushes
 * everything the player has muscle memory for down by a row — which is a worse
 * thing to do to somebody than making them look for a small button once.
 */
public final class PauseMenuButton {

    private PauseMenuButton() {}

    public static void register() {
        ScreenEvents.AFTER_INIT.register((client, screen, width, height) -> {
            if (!(screen instanceof GameMenuScreen)) return;

            Screens.getButtons(screen).add(ButtonWidget.builder(
                    Text.literal("◕ Hollow"),
                    button -> client.setScreen(new HollowSettingsScreen(screen))
            ).dimensions(6, height - 26, 74, 20).build());
        });
    }
}
