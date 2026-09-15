package dev.nexuscraft.hollow.client;

import dev.nexuscraft.hollow.director.Act;
import net.fabricmc.fabric.api.client.screen.v1.ScreenEvents;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.TitleScreen;
import net.minecraft.text.Text;

import java.util.List;
import java.util.random.RandomGenerator;

/**
 * The part that follows you out of the world.
 *
 * Everything else this mod does happens inside a save file, which is a box the
 * player can close. This draws on the title screen — the one place they go to
 * get away from it — and it is the single cheapest thing in the mod for the
 * effect it has.
 *
 * Three rules keep it from being a gimmick.
 *
 * A fresh install shows nothing at all. Someone who has never played sees the
 * ordinary menu, because a first-time player shown "he is waiting for you" has
 * been handed the ending before their first night.
 *
 * It reflects how far a world actually got, read from `hollow-seen.txt`, which
 * lives in the config directory rather than in any save. Deleting the world
 * does not clear it. That is the whole point: the box is not a box.
 *
 * And it is quiet. One line, small, low contrast, in the corner — something you
 * are not certain you saw. A splash of red text across the logo is a poster for
 * a horror mod; a sentence you have to look twice at is the thing itself.
 *
 * Drawn through Fabric's screen events rather than a mixin on the splash text.
 * A mixin would have to match a private method on a class Mojang renames freely
 * and would break on the next version for no gain — this only needs to put a
 * string on a screen.
 */
public final class MenuHaunt {

    private MenuHaunt() {}

    private static final RandomGenerator RANDOM = RandomGenerator.getDefault();

    /**
     * Lines for each act.
     *
     * Written to be deniable at first. "you left something running" is a thing
     * a launcher might legitimately say; by the last act there is no reading of
     * it that is about software.
     */
    private static List<String> linesFor(Act act) {
        return switch (act) {
            /*
             * Act one says something, but only to somebody who has played.
             *
             * This used to be an empty list, which meant that in practice
             * nobody ever saw the menu haunted at all: it is the act every
             * player spends their first several nights in, so "it starts in the
             * second act" reads exactly the same as "it is broken" — and that
             * is the report it got.
             *
             * The rule it was protecting still holds and is enforced in
             * `register` instead: a fresh install, which has never written a
             * memory file, shows nothing. These lines are warm. They are only
             * frightening later, once you know what was saying them.
             */
            case COMPANION -> List.of(
                    "he asked when you were coming back",
                    "he said to say hello",
                    "he's fine on his own"
            );
            case UNEASE -> List.of(
                    "you left something running",
                    "it waited",
                    "still here"
            );
            case WATCHING -> List.of(
                    "it noticed you closed the game",
                    "it has been counting the days",
                    "you were gone a while",
                    "it knows where you sleep"
            );
            case HOLLOW -> List.of(
                    "it is still wearing the face",
                    "you should not have left it alone",
                    "it is waiting for you",
                    "come back"
            );
        };
    }

    /**
     * How visible the line is, by act.
     *
     * Dim grey to start, and only the last act gets a colour that draws the eye.
     * Escalating the *legibility* rather than the wording does most of the work:
     * the player notices they can suddenly read it easily.
     */
    private static int colourFor(Act act) {
        return switch (act) {
            /*
             * Faint, but actually drawn. The old act-one value was fully
             * transparent black, so even once there was a line to show there
             * was nothing on the screen — an invisible feature reads as a
             * missing one, and it was reported as missing.
             */
            case COMPANION -> 0x50FFFFFF;
            case UNEASE -> 0x70FFFFFF;
            case WATCHING -> 0xA0AAAAAA;
            case HOLLOW -> 0xFFAA0000;
        };
    }

    private static final net.minecraft.util.Identifier FIGURE =
            dev.nexuscraft.hollow.Hollow.id("textures/gui/menu_hollow.png");

    private static final int FIGURE_W = 64;
    private static final int FIGURE_H = 128;

    /**
     * Him, standing on the title screen.
     *
     * The haunt used to be a line of red text at the bottom of the menu, which
     * says the right thing and shows nothing — and the whole point of the last
     * act is that he stopped talking. So he is simply there instead.
     *
     * He fades in over eight seconds rather than appearing. Nobody who alt-tabs
     * back to the menu sees him arrive; they look up at some point and he is
     * already standing there, which is the difference between a jump scare and
     * the feeling that you missed something.
     *
     * Drawn at the right, away from the buttons, and dark enough to be missed —
     * against the panorama he is a shape you are not certain about until the
     * eyes resolve. A clearly lit monster on the menu would be a poster.
     */
    private static void drawHim(DrawContext draw, int width, int height, long began, Act act) {
        // Only once he has stopped pretending. Earlier acts get the text alone.
        if (act != Act.WATCHING && act != Act.HOLLOW) return;

        float age = (System.currentTimeMillis() - began) / 8000.0f;
        float shown = Math.min(1.0f, age) * (act == Act.HOLLOW ? 0.92f : 0.55f);
        if (shown < 0.02f) return;

        /*
         * Sized off the window, so he is the same height on any screen — a
         * fixed pixel size makes him a postage stamp at 4K and a wall at 720p.
         */
        int tall = (int) (height * 0.62f);
        int wide = tall * FIGURE_W / FIGURE_H;

        int x = (int) (width * 0.80f) - wide / 2;
        int y = height - tall - (int) (height * 0.06f);

        int alpha = (int) (shown * 255.0f) << 24;

        draw.drawTexture(net.minecraft.client.gl.RenderPipelines.GUI_TEXTURED, FIGURE,
                x, y, 0.0f, 0.0f, wide, tall, FIGURE_W, FIGURE_H,
                alpha | 0x00FFFFFF);
    }

    public static void register() {
        ScreenEvents.AFTER_INIT.register((client, screen, width, height) -> {
            if (!(screen instanceof TitleScreen)) return;

            /*
             * Nothing at all until a world has been played.
             *
             * The memory file is written the first time the client syncs with a
             * running world, so its mere existence is the test for "this person
             * has met him" — which is the line that must not be crossed. A
             * first-time player opening the game to a sentence about someone
             * waiting for them has been handed the whole idea for free.
             */
            if (!HollowClient.hasPlayed()) return;

            Act act = HollowClient.known();
            List<String> lines = linesFor(act);
            if (lines.isEmpty()) return;

            /*
             * Chosen once per visit to the screen, not per frame. Picking inside
             * the render callback would reroll it sixty times a second and
             * produce an unreadable flicker.
             */
            String line = lines.get(RANDOM.nextInt(lines.size()));
            int colour = colourFor(act);

            long began = System.currentTimeMillis();

            ScreenEvents.afterRender(screen).register((rendered, context, mouseX, mouseY, delta) -> {
                DrawContext draw = context;

                drawHim(draw, width, height, began, act);

                // Bottom left, under the version string, where the eye goes last.
                draw.drawTextWithShadow(
                        client.textRenderer,
                        Text.literal(line),
                        4,
                        height - 30,
                        colour
                );
            });
        });
    }
}
