package dev.nexuscraft.hollow.voice;

import de.maxhenkel.voicechat.api.VoicechatApi;
import de.maxhenkel.voicechat.api.VoicechatPlugin;
import de.maxhenkel.voicechat.api.events.EventRegistration;
import de.maxhenkel.voicechat.api.events.MicrophonePacketEvent;
import de.maxhenkel.voicechat.api.opus.OpusDecoder;
import dev.nexuscraft.hollow.Hollow;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * The hook Simple Voice Chat calls, so you can talk to him out loud.
 *
 * He could always speak; he could never listen. Typing at something standing in
 * the room with you is the single biggest reminder that it is software, and it
 * is a strange gap in a mod whose whole subject is whether the thing beside you
 * is a person.
 *
 * Everything here is optional. The API is compiled against but not bundled, so
 * none of it runs unless the player has the voice chat mod installed — without
 * it, he simply keeps reading chat.
 *
 * The decoding is done here rather than in the shared library on purpose: the
 * library would otherwise have to depend on a mod that may not be present, and
 * this is six lines that each companion can run for itself.
 */
public class HollowVoicechatPlugin implements VoicechatPlugin {

    /** One decoder per speaker; they carry state between packets. */
    private static final Map<UUID, OpusDecoder> DECODERS = new ConcurrentHashMap<>();

    private static volatile VoicechatApi api;

    @Override
    public String getPluginId() {
        return Hollow.MOD_ID;
    }

    @Override
    public void initialize(VoicechatApi voicechatApi) {
        api = voicechatApi;
        Hollow.LOG.info("Simple Voice Chat found — he can hear you now");
    }

    @Override
    public void registerEvents(EventRegistration registration) {
        registration.registerEvent(MicrophonePacketEvent.class, event -> {
            if (!dev.nexuscraft.voice.Ears.enabled()) return;
            if (event.getSenderConnection() == null) return;

            UUID speaker = event.getSenderConnection().getPlayer().getUuid();
            byte[] opus = event.getPacket().getOpusEncodedData();
            if (opus == null || opus.length == 0) return;

            try {
                OpusDecoder decoder = DECODERS.computeIfAbsent(speaker, id -> api.createDecoder());
                if (decoder == null) return;

                dev.nexuscraft.voice.Ears.hear(speaker, decoder.decode(opus));
            } catch (Exception e) {
                /*
                 * A packet that will not decode is one packet, not a problem.
                 *
                 * This runs twenty times a second per speaker; anything louder
                 * than debug here would bury the log in the first minute of
                 * somebody talking.
                 */
                Hollow.LOG.debug("could not decode a voice packet: {}", e.getMessage());
            }
        });
    }

    /** Dropped when they leave, so a decoder is not kept for nobody. */
    public static void forget(UUID speaker) {
        DECODERS.remove(speaker);
        dev.nexuscraft.voice.Ears.forget(speaker);
    }
}
