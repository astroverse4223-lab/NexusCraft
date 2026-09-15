package dev.nexuscraft.hollow.client;

import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.util.math.BlockPos;

/**
 * Nights that are actually dark.
 *
 * Vanilla night is lit well enough to mine by, which is fine for a building
 * game and useless for this one — a companion whose face is the only thing
 * giving off light needs a dark to be the only thing in.
 *
 * The first version of this took the brightness slider down and could not
 * possibly have worked: vanilla clamps it at "Moody", which is dimmer than
 * default and nowhere near black, and no amount of easing gets past a floor. It
 * also meddled with a setting the player owns, which had to be remembered and
 * given back.
 *
 * This draws instead. A black rectangle over the world, under the HUD, with its
 * opacity worked out from the light where the player is standing — so a torch,
 * a campfire or the flashlight genuinely carve it back rather than being
 * cosmetic. It touches nothing the player owns and stops the instant it is
 * switched off.
 *
 * Under the HUD specifically. Drawn over the top it would dim the hearts and
 * the hotbar too, which is not atmosphere, it is a bug you cannot read your
 * health through.
 */
public final class NightFall {

    /**
     * How black it gets with no light at all.
     *
     * There is a ceiling on this that is lower than it looks, and it is worth
     * writing down because the number is tempting to raise.
     *
     * This is a black rectangle over the *screen*, so it dims everything drawn
     * underneath it — including the one thing the whole mod is for, which is a
     * pair of lit eyes in the dark. At 0.93 the world was genuinely black and
     * his eyes were a dull smear, because they were being dimmed by exactly the
     * same amount as the grass.
     *
     * Real darkness that leaves emissive things alone means changing the
     * lightmap, not painting over the picture. Until then this is the honest
     * compromise: dark enough to lose the horizon, bright enough that something
     * can still be seen burning in it.
     */
    private static float darkest = 0.94f;

    /**
     * The block light at which the dark is fully held off.
     *
     * Twelve rather than fifteen, so a single torch is a pool of safety rather
     * than a floodlight, and standing next to one still leaves the corners of
     * the room to the imagination.
     */
    private static final float ENOUGH_LIGHT = 12.0f;

    /** Eased per frame, so dusk arrives rather than being switched on. */
    private static final float EASE = 0.02f;

    private static float showing;
    private static boolean on = true;

    private NightFall() {
    }

    public static void setEnabled(boolean enabled) {
        on = enabled;
    }

    /** How black a moonless field gets, 0 to 1. From the config. */
    public static void setDarkest(double howDark) {
        darkest = (float) Math.max(0.0, Math.min(1.0, howDark));
    }

    /** How dark it is right now, so anything drawn over it can match. */
    public static float showing() {
        return showing;
    }

    /** Drawn every frame, beneath the HUD. */
    public static void draw(DrawContext context) {
        MinecraftClient client = MinecraftClient.getInstance();

        float want = wanted(client);
        showing += (want - showing) * EASE;

        if (showing < 0.004f) return;

        int alpha = (int) (Math.min(showing, 1.0f) * 255.0f) << 24;
        context.fill(0, 0, context.getScaledWindowWidth(), context.getScaledWindowHeight(), alpha);
    }

    /**
     * How dark it ought to be right now.
     *
     * Read from the light where the player is standing rather than from the
     * clock alone, which is what makes a light source mean something: the same
     * midnight is pitch black in a field and perfectly fine under a torch.
     */
    private static float wanted(MinecraftClient client) {
        if (!on || client.world == null || client.player == null) return 0.0f;
        if (client.player.isSpectator()) return 0.0f;
        if (!client.world.getDimension().hasSkyLight()) return 0.0f;

        long time = client.world.getTimeOfDay() % 24000L;
        if (time <= 12800L || time >= 23000L) return 0.0f;

        /*
         * Eased in at dusk and out at dawn over about ten minutes of real time,
         * so the world gets darker rather than the lights going out.
         */
        float night = Math.min(1.0f, Math.min(time - 12800L, 23000L - time) / 800.0f);

        BlockPos at = client.player.getBlockPos();

        /*
         * Only light somebody made counts.
         *
         * The first version asked the world for the light level at the player,
         * which folds the sky in — and outdoors at midnight that still reads
         * about four, so the darkest a field could ever get was a little over
         * half. Moonlight was holding off the night, which is precisely
         * backwards: the night *is* the moonlight.
         *
         * Block light only. A field under a full moon is now as black as a
         * sealed room, and the only things that push it back are a torch, a
         * fire, or the lamp in your hand.
         */
        int light = client.world.getLightLevel(net.minecraft.world.LightType.BLOCK, at);

        float unlit = Math.max(0.0f, (ENOUGH_LIGHT - light) / ENOUGH_LIGHT);
        return darkest * night * unlit;
    }
}
