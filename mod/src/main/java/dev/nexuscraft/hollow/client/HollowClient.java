package dev.nexuscraft.hollow.client;

import dev.nexuscraft.hollow.Hollow;
import dev.nexuscraft.hollow.director.Act;
import net.fabricmc.api.ClientModInitializer;

/**
 * The part of the mod that reaches the menu.
 *
 * Everything else runs on the server, where it can be tested and where it works
 * for anyone who joins. This exists for the one thing a server physically
 * cannot touch: the screens drawn before a world is loaded. Splash text and the
 * title screen are rendered by the client with no server in the picture, so
 * making the launcher itself feel wrong has to happen here.
 *
 * It is also the most effective place in the whole mod. The moment the horror
 * stops being contained inside the save file — when the thing follows you out
 * to the menu and is waiting there before you have loaded anything — is worth
 * more than any number of noises in a cave.
 *
 * What it must never do is spoil the arc. The menu reflects how far a world has
 * actually got; a fresh install shows nothing unusual, because a first-time
 * player seeing the ending on the title screen has been handed the twist before
 * the first night.
 */
public class HollowClient implements ClientModInitializer {

    /**
     * The furthest any world on this client has reached.
     *
     * Client-side and deliberately sticky: it is remembered across worlds, so
     * the menu stays wrong once a world has gone wrong. Reset it by deleting
     * the file, which is the only way back — there is no in-game undo, on
     * purpose.
     */
    private static Act known = Act.COMPANION;

    public static Act known() {
        return known;
    }

    /**
     * Whether this client has ever been in a world with him in it.
     *
     * The memory file existing is the whole test. It is written on the first
     * sync with a running world, so it separates "has played, and is still in
     * the first act" from "has never played" — which the act alone cannot do,
     * since both of those are {@code COMPANION}, and treating them the same is
     * what made the title screen look broken.
     */
    public static boolean hasPlayed() {
        return ClientMemory.exists();
    }

    public static void remember(Act act) {
        if (act.ordinal() > known.ordinal()) {
            known = act;
            ClientMemory.save(known);
            return;
        }

        /*
         * Written even when nothing has changed, if the file is not there yet.
         *
         * Only saving on an increase meant that at act one — where the value is
         * already the starting one — the file was never created at all, so
         * there was no way to tell "the menu is correctly showing nothing" from
         * "the sync is broken and has never run". A file saying `companion` is
         * the difference between those two.
         */
        if (!ClientMemory.exists()) ClientMemory.save(known);
    }

    /**
     * Keeps the client's memory in step with the world it is playing.
     *
     * Read straight off the integrated server rather than sent as a packet.
     * In single player the client and the server share a process, so the world
     * state is simply there to be asked — and a packet would be a protocol to
     * maintain for a value that changes four times in a fortnight.
     *
     * The cost is that this only tracks single player. Joining a dedicated
     * server running Hollow will not haunt your menu, because the client has no
     * way to know how far that world got. That is the right trade for now: the
     * menu is a single player effect, and it should not lie about someone
     * else's world.
     */
    private static void followTheWorld(net.minecraft.client.MinecraftClient client) {
        var server = client.getServer();
        if (server == null) return;

        var overworld = server.getOverworld();
        if (overworld == null) return;

        remember(dev.nexuscraft.hollow.director.Progression.get(overworld).act());
    }

    @Override
    public void onInitializeClient() {
        known = ClientMemory.load();
        MenuHaunt.register();

        /*
         * The client reads the same properties file the server side does.
         *
         * In single player they are one process and one file, so there is
         * nothing to synchronise. On a server the player's own copy decides
         * whether they hear a voice, which is the right owner for that choice.
         */
        var config = dev.nexuscraft.hollow.HollowConfig.load();
        Narration.register();

        /*
         * A speech engine, if one has been asked for.
         *
         * Nothing is contacted here — the engine is only called when there is a
         * line to say, so pointing this at a local server that is not running
         * costs nothing until he speaks, and then fails once, quietly, into the
         * log rather than into the player's face.
         */
        if (config.voice.contains("speech") || config.voice.contains("both")) {
            Speech.configure(config.speechUrl, config.speechModel, config.speechVoice,
                    config.speechKey, config.speechVolume);
        }

        /*
         * The game's narrator, but only if nothing better is set up.
         *
         * Turning it on flips one of the player's accessibility settings, which
         * is not something to do uninvited and certainly not to do for a voice
         * that is then never going to be heard because a speech engine is
         * answering instead.
         */
        if (!Speech.enabled() && (config.voice.contains("narrator") || config.voice.contains("both"))) {
            net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents.END_CLIENT_TICK.register(
                    new net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents.EndTick() {
                        private boolean done = false;

                        @Override
                        public void onEndTick(net.minecraft.client.MinecraftClient client) {
                            // Once, after the options exist to be changed.
                            if (done || client.options == null) return;
                            done = true;
                            Narration.enable(client);
                        }
                    });
        }

        // Once every ten seconds. The act changes on the scale of days.
        net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents.END_CLIENT_TICK.register(client -> {
            if (client.world != null && client.world.getTime() % 200 == 0) followTheWorld(client);
        });
        Hollow.LOG.info("Hollow client ready (menu reflects {})", known.id);
    }
}
