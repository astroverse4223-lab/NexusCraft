package dev.nexuscraft.hollow.client;

import dev.nexuscraft.hollow.Hollow;
import net.fabricmc.fabric.api.client.message.v1.ClientReceiveMessageEvents;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.option.NarratorMode;

/**
 * Reading its lines out loud, in a real voice.
 *
 * Minecraft already ships a text-to-speech engine — the accessibility narrator
 * on Ctrl+B, which drives the operating system's own speech. It is right there,
 * it needs no model, no download and no dependency, and nothing was using it.
 *
 * That is worth far more than the chirps: a companion that says "I've been in
 * here a long time" out loud, in a flat synthetic voice, from a box you have not
 * opened yet, is doing something no amount of note blocks can.
 *
 * Only its own lines are read. Every line the mod writes carries a marker, and
 * anything without one is left alone — narrating all of chat would read out
 * every death message, advancement and join notice on the server, which is what
 * the narrator already does if you want it and is not what this is for.
 *
 * The narrator has to be on for any of this to make a sound, and it is off by
 * default. Turning someone's accessibility setting on without asking is not on,
 * so this only does it when the config has explicitly asked for the narrator
 * voice — and it says so in the log when it does.
 */
public final class Narration {

    private Narration() {}

    /**
     * The marker every line from the mod starts with.
     *
     * The face character itself, which the chat formatting already puts in
     * front of everything it says. Using the text we already emit means there
     * is no second channel to keep in step.
     */
    private static final String SPOKEN_MARKER = "◕";

    /** The box speaks before it has a face, so its lines are marked too. */
    private static final String BOX_MARKER = "(from inside the box)";

    private static boolean enabled = false;

    /**
     * Turns it on, enabling the game's narrator if it is off.
     *
     * `SYSTEM` rather than `ALL`: system messages are narrated, ordinary chat
     * is not, so switching this on does not suddenly read out everything
     * everyone says on a server.
     */
    public static void enable(MinecraftClient client) {
        enabled = true;

        var option = client.options.getNarrator();
        if (option.getValue() == NarratorMode.OFF) {
            option.setValue(NarratorMode.SYSTEM);
            client.getNarratorManager().onModeChange(NarratorMode.SYSTEM);
            Hollow.LOG.info("turned the game's narrator on so the companion can speak aloud");
        }
    }

    public static void register() {
        ClientReceiveMessageEvents.GAME.register((message, overlay) -> {
            if (!enabled || overlay) return;

            String text = message.getString();
            if (text == null) return;

            boolean ours = text.startsWith(SPOKEN_MARKER) || text.startsWith(BOX_MARKER);
            if (!ours) return;

            /*
             * The marker is stripped before speaking. A synthesiser reading the
             * face out as "black circle" at the head of every sentence is the
             * sort of detail that turns a good effect into a funny one.
             */
            String spoken = text.replace(SPOKEN_MARKER, "").replace(BOX_MARKER, "").trim();
            if (spoken.isEmpty()) return;

            /*
             * A real speech engine takes priority over the game's narrator.
             *
             * Both being on at once means the line is read twice, over itself,
             * in two different voices — so when one is configured it is the one
             * that speaks and the narrator is left for players who have chosen
             * it deliberately.
             */
            if (Speech.enabled()) {
                Speech.say(spoken);
                return;
            }

            MinecraftClient client = MinecraftClient.getInstance();
            if (client == null) return;

            // Immediately, rather than queued: it should interrupt itself if it
            // has more to say, the same as the in-app companion voice does.
            client.getNarratorManager().narrateSystemImmediately(spoken);
        });
    }
}
