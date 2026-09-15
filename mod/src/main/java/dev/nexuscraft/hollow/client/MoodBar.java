package dev.nexuscraft.hollow.client;

import dev.nexuscraft.hollow.entity.MaskEntity;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.text.Text;

import java.util.List;

/**
 * How he feels about you, drawn where you can see it.
 *
 * Until now his mood was only legible in hindsight: he would answer coldly, or
 * refuse to fetch something, and the player had no way of knowing whether that
 * was the arc turning on schedule or something they had done. Both are true at
 * once in this mod, which is precisely why it needs a number — being unkind
 * costs you something, and a cost you cannot see is not a cost, it is a
 * surprise.
 *
 * One bar rather than two. Anger and happiness are the same axis read from
 * different ends, and drawing them separately invites the reading that you can
 * fill one without emptying the other. You cannot.
 *
 * Top right, and always up.
 *
 * It faded out when nothing had changed, on the theory that a permanent bar
 * becomes furniture. That reasoning was wrong here for a plain reason: this
 * number is the thing the player is meant to be managing, and a gauge you
 * cannot check on demand is not a gauge — it is a notification. You should be
 * able to glance at it and know where you stand before you say something.
 */
public final class MoodBar {

    private static final int WIDTH = 74;
    private static final int HEIGHT = 5;

    private static boolean on = true;

    private MoodBar() {
    }

    public static void setEnabled(boolean enabled) {
        on = enabled;
    }

    public static void draw(DrawContext context) {
        if (!on) return;

        MinecraftClient client = MinecraftClient.getInstance();
        if (client.world == null || client.player == null) return;
        if (client.options.hudHidden) return;

        MaskEntity him = nearest(client);
        if (him == null) return;

        int mood = him.mood();

        int alpha = 255;
        String label = label(mood);
        int labelWidth = client.textRenderer.getWidth(label);

        // Top right, clear of the effect icons vanilla puts there.
        int x = context.getScaledWindowWidth() - WIDTH - 10;
        int y = 10;

        // A dark bed, so it reads on grass as well as in a cave.
        context.fill(x - 1, y - 1, x + WIDTH + 1, y + HEIGHT + 1, (int) (alpha * 0.65f) << 24);

        int filled = Math.round(WIDTH * (mood / 100.0f));
        if (filled > 0) {
            context.fill(x, y, x + filled, y + HEIGHT, (alpha << 24) | colourFor(mood));
        }

        // Right-aligned under the bar, so both edges line up on any window.
        context.drawTextWithShadow(client.textRenderer, Text.literal(label),
                x + WIDTH - labelWidth, y + HEIGHT + 3, (alpha << 24) | 0xC8C8C8);
    }

    /**
     * Green through to red, in steps rather than a gradient.
     *
     * Steps because the point is to notice a change, and a smooth gradient
     * shifting by two percent a day is not something anybody notices. A bar
     * that was amber yesterday and is orange today gets looked at.
     */
    private static int colourFor(int mood) {
        if (mood >= 75) return 0x5BD16A;
        if (mood >= 50) return 0xD4CC55;
        if (mood >= 30) return 0xD98C3F;
        if (mood >= 12) return 0xC4552F;
        return 0x8E2020;
    }

    /** Said plainly, because a bare number invites optimising it. */
    private static String label(int mood) {
        if (mood >= 85) return "fond of you";
        if (mood >= 60) return "warm";
        if (mood >= 40) return "cooling";
        if (mood >= 22) return "watchful";
        if (mood >= 8) return "cold";
        return "done with you";
    }

    private static MaskEntity nearest(MinecraftClient client) {
        List<MaskEntity> found = client.world.getEntitiesByClass(
                MaskEntity.class, client.player.getBoundingBox().expand(40.0), any -> true);
        return found.isEmpty() ? null : found.get(0);
    }
}
