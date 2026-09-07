package dev.nexuscraft.ember.client;

import dev.nexuscraft.ember.Ember;
import dev.nexuscraft.ember.EmberEntity;
import dev.nexuscraft.ember.net.EmberAction;
import net.fabricmc.fabric.api.client.keybinding.v1.KeyBindingHelper;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayNetworking;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.option.KeyBinding;
import net.minecraft.client.util.InputUtil;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.util.math.Box;
import net.minecraft.util.math.Vec3d;
import org.lwjgl.glfw.GLFW;

/**
 * Ember's controls, on keys of their own.
 *
 * It used to be right-clicked like any other mob, which required the crosshair
 * to be able to find it — and anything the crosshair can find will sooner or
 * later steal a click meant for a block. Moving it out of the way did not work:
 * behind the player it was invisible, in front it blocked mining, beside it was
 * invisible again, above it fouled fighting and building upward.
 *
 * It is now not clickable at all, and these keys find it instead. That makes
 * the position purely a question of what looks good, because it can no longer
 * be in anybody's way.
 */
public final class EmberKeys {

    /** How far away it can be reached with a key. */
    private static final double REACH = 7.0;

    /**
     * How generous the aim is: the cosine of the angle from the look
     * direction. Wide on purpose — this is not a weapon, and nothing else in
     * the world competes for these keys.
     */
    private static final double AIM = 0.86;

    public static KeyBinding grab;
    public static KeyBinding satchel;

    private EmberKeys() {
    }

    public static void register() {
        KeyBinding.Category category = KeyBinding.Category.create(Ember.id("ember"));

        grab = KeyBindingHelper.registerKeyBinding(new KeyBinding(
                "key.ember.grab", InputUtil.Type.MOUSE,
                GLFW.GLFW_MOUSE_BUTTON_MIDDLE, category));

        satchel = KeyBindingHelper.registerKeyBinding(new KeyBinding(
                "key.ember.satchel", InputUtil.Type.KEYSYM,
                GLFW.GLFW_KEY_G, category));
    }

    /** Called every client tick. */
    public static void tick(MinecraftClient client) {
        if (client.player == null || grab == null) return;

        boolean wantsGrab = false;
        while (grab.wasPressed()) wantsGrab = true;

        boolean wantsSatchel = false;
        while (satchel.wasPressed()) wantsSatchel = true;

        if (!wantsGrab && !wantsSatchel) return;

        EmberEntity target = nearestInView(client.player);
        if (target == null) return;

        if (wantsSatchel) {
            ClientPlayNetworking.send(new EmberAction(target.getId(), EmberAction.SATCHEL));
            return;
        }

        // Sneaking turns the same key into a throw, which is the gesture people
        // already expect for "do the other thing".
        ClientPlayNetworking.send(new EmberAction(target.getId(),
                client.player.isSneaking() ? EmberAction.THROW : EmberAction.GRAB));
    }

    /**
     * The player's own Ember, nearest to where they are looking.
     *
     * A raycast of its own rather than the crosshair's, because the crosshair
     * deliberately cannot see it any more. Scores by angle rather than
     * requiring a hit, so it does not have to be aimed at precisely — a glance
     * in its direction is enough.
     */
    private static EmberEntity nearestInView(PlayerEntity player) {
        Vec3d eye = player.getEyePos();
        Vec3d look = player.getRotationVec(1.0f).normalize();

        EmberEntity best = null;
        double bestAim = AIM;

        /*
         * Not filtered by owner here.
         *
         * The owner is a server-side field and is never sent to the client, so
         * asking for it from here always answered null and nothing was ever
         * found — the keys did nothing at all. The server checks ownership when
         * the request arrives, which is the only place the answer is true
         * anyway, and where it would have to be checked regardless.
         */
        Box around = player.getBoundingBox().expand(REACH);
        java.util.List<EmberEntity> nearby = player.getEntityWorld()
                .getEntitiesByClass(EmberEntity.class, around, e -> true);

        /*
         * Something already in your hand needs no aiming at.
         *
         * Carried, it hangs at the hand — below the eyeline and barely in
         * front, which is a steep angle from wherever you are looking. It fell
         * outside the aim cone, so putting it down or throwing it meant
         * snapping the camera down and left to catch your own hand. Carry state
         * is tracked, so the client can simply ask.
         */
        for (EmberEntity carried : nearby) {
            if (carried.getCarry() == dev.nexuscraft.ember.Carry.CARRIED) return carried;
        }

        for (EmberEntity candidate : nearby) {

            Vec3d toward = candidate.getEntityPos().add(0.0, 0.25, 0.0).subtract(eye);
            if (toward.length() > REACH) continue;

            double aim = look.dotProduct(toward.normalize());
            if (aim <= bestAim) continue;

            bestAim = aim;
            best = candidate;
        }

        return best;
    }
}
