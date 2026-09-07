package dev.nexuscraft.ember.voice;

import de.maxhenkel.voicechat.api.VoicechatApi;
import de.maxhenkel.voicechat.api.VoicechatPlugin;
import de.maxhenkel.voicechat.api.VoicechatServerApi;
import de.maxhenkel.voicechat.api.events.EventRegistration;
import de.maxhenkel.voicechat.api.events.VoicechatServerStartedEvent;
import de.maxhenkel.voicechat.api.events.MicrophonePacketEvent;
import de.maxhenkel.voicechat.api.events.VoicechatServerStoppedEvent;
import dev.nexuscraft.ember.Ember;

/**
 * The hook Simple Voice Chat calls, if it is installed.
 *
 * Ember already had a voice in the sense that a text-to-speech engine could
 * read its lines — but that audio came out of the client's speakers flat, the
 * same volume from across a valley as from a foot away. Simple Voice Chat is
 * what turns it into a sound in the world: it comes from the lantern's actual
 * position, fades with distance, and everyone on the server hears it, which is
 * the whole difference between a companion and a narrator.
 *
 * Everything here is optional. The API is compiled against but not bundled, and
 * nothing on this path runs unless the player has the mod installed — Ember
 * simply keeps talking in chat.
 */
public class EmberVoicechatPlugin implements VoicechatPlugin {

    private static volatile VoicechatApi api;
    private static volatile VoicechatServerApi serverApi;

    /** Only used to say something the first time, and then never again. */
    private static long packets;
    private static boolean warnedAboutSender;

    @Override
    public String getPluginId() {
        return Ember.MOD_ID;
    }

    @Override
    public void initialize(VoicechatApi voicechatApi) {
        api = voicechatApi;
        Ember.LOG.info("Simple Voice Chat found — Ember will speak aloud");
    }

    @Override
    public void registerEvents(EventRegistration registration) {
        registration.registerEvent(VoicechatServerStartedEvent.class,
                event -> serverApi = event.getVoicechat());
        registration.registerEvent(VoicechatServerStoppedEvent.class,
                event -> serverApi = null);

        /*
         * Everything anyone says into a microphone.
         *
         * Handed straight to Ears, which does nothing here but decode and
         * buffer — this runs on Simple Voice Chat's own thread, twenty times a
         * second per speaker, and is no place to do work.
         */
        registration.registerEvent(MicrophonePacketEvent.class, event -> {
            /*
             * Loud about the first packet, silent thereafter.
             *
             * "It does not hear me" has several causes that look identical from
             * outside: no microphone chosen in Simple Voice Chat, voice chat
             * disabled for the connection, push-to-talk unbound, or the event
             * simply not firing. One line at the start separates them.
             */
            if (event.getSenderConnection() == null) {
                if (warnedAboutSender) return;
                warnedAboutSender = true;
                Ember.LOG.warn("a voice packet arrived with no sender — Ember cannot tell who spoke");
                return;
            }

            var player = event.getSenderConnection().getPlayer();
            if (player == null) return;

            if (packets++ == 0) {
                Ember.LOG.info("hearing {} — Ember is listening", player.getUuid());
            }

            Ears.hearPacket(player.getUuid(), event.getPacket().getOpusEncodedData());
        });
    }

    /** Null until the voice chat server is up, or forever if the mod is absent. */
    public static VoicechatServerApi server() {
        return serverApi;
    }

    public static VoicechatApi api() {
        return api;
    }

    /** Whether anything can actually be spoken right now. */
    public static boolean ready() {
        return api != null && serverApi != null;
    }
}
