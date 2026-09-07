package dev.nexuscraft.ember.voice;

import de.maxhenkel.voicechat.api.VoicechatServerApi;
import de.maxhenkel.voicechat.api.audiochannel.AudioPlayer;
import de.maxhenkel.voicechat.api.audiochannel.EntityAudioChannel;
import dev.nexuscraft.ember.Ember;
import dev.nexuscraft.ember.EmberConfig;
import dev.nexuscraft.ember.EmberEntity;

import javax.sound.sampled.AudioFormat;
import javax.sound.sampled.AudioInputStream;
import javax.sound.sampled.AudioSystem;
import java.io.ByteArrayInputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.time.Duration;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Ember out loud, at the place it is actually hovering.
 *
 * Two halves. The first is text to speech over HTTP, using the endpoint OpenAI
 * defined and Kokoro-FastAPI deliberately copies, so a local neural voice and a
 * hosted one are the same code and a different address. The second is handing
 * that audio to Simple Voice Chat as a channel attached to the entity, which is
 * what makes it fall off with distance and reach the other people on the
 * server instead of only the person who asked.
 *
 * Everything is best-effort: no voice chat, no speech engine, or a request that
 * fails all leave the chat line exactly as it was.
 */
public final class Speech {

    /**
     * What Simple Voice Chat expects: 48kHz, mono, 16-bit signed, little endian.
     * Anything else has to be converted before it is handed over, which is what
     * the JDK's own audio pipeline is for.
     */
    private static final AudioFormat TARGET =
            new AudioFormat(48000f, 16, 1, true, false);

    private static final ExecutorService SPEAKING =
            Executors.newSingleThreadExecutor(runnable -> {
                Thread thread = new Thread(runnable, "ember-speech");
                thread.setDaemon(true);
                return thread;
            });

    private static final HttpClient HTTP = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .build();

    private Speech() {
    }

    /**
     * Says a line aloud from the lantern's position, if that is possible.
     *
     * Returns immediately; the synthesis and playback happen on their own
     * thread. Failure is silent by design — the line is already in chat, and a
     * companion that interrupts itself to complain about a speech engine is
     * worse company than a quiet one.
     */
    public static void say(EmberEntity ember, String line) {
        EmberConfig config = EmberConfig.get();
        if (!config.speak || line == null || line.isBlank()) return;
        if (ember == null || !EmberVoicechatPlugin.ready()) return;

        SPEAKING.submit(() -> {
            try {
                byte[] audio = synthesise(config, line);
                if (audio == null) return;

                short[] samples = toSamples(audio);
                if (samples == null || samples.length == 0) return;

                play(ember, samples);
            } catch (Exception e) {
                Ember.LOG.warn("Ember could not speak aloud: {}", e.getMessage());
            }
        });
    }

    /** POST /v1/audio/speech — the shape every self-hosted engine copies. */
    private static byte[] synthesise(EmberConfig config, String line) throws Exception {
        String body = "{"
                + "\"model\":" + quote(config.speechModel) + ","
                + "\"voice\":" + quote(config.speechVoice) + ","
                + "\"input\":" + quote(line) + ","
                // WAV rather than mp3: the JDK can read and resample it without
                // a decoder, and the extra bytes never leave this machine.
                + "\"response_format\":\"wav\""
                + "}";

        HttpRequest.Builder request = HttpRequest.newBuilder()
                .uri(URI.create(config.speechUrl + "/audio/speech"))
                .timeout(Duration.ofSeconds(config.timeoutSeconds))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body));

        if (!config.speechKey.isEmpty()) {
            request.header("Authorization", "Bearer " + config.speechKey);
        }

        HttpResponse<byte[]> response =
                HTTP.send(request.build(), HttpResponse.BodyHandlers.ofByteArray());

        if (response.statusCode() / 100 != 2) {
            Ember.LOG.warn("speech engine returned HTTP {} — is one running at {}?",
                    response.statusCode(), config.speechUrl);
            return null;
        }
        return response.body();
    }

    /**
     * Whatever came back, as 48kHz mono 16-bit samples.
     *
     * The engine decides its own sample rate — Kokoro answers at 24kHz — so the
     * JDK's converter does the resampling rather than this doing it by hand and
     * getting it subtly wrong.
     */
    private static short[] toSamples(byte[] audio) throws Exception {
        try (AudioInputStream source = AudioSystem.getAudioInputStream(new ByteArrayInputStream(audio));
             AudioInputStream converted = AudioSystem.getAudioInputStream(TARGET, source)) {

            byte[] raw = converted.readAllBytes();
            ByteBuffer buffer = ByteBuffer.wrap(raw).order(ByteOrder.LITTLE_ENDIAN);

            short[] samples = new short[raw.length / 2];
            for (int i = 0; i < samples.length; i++) samples[i] = buffer.getShort();
            return samples;
        }
    }

    /** Opens a channel on the entity and plays the samples through it. */
    private static void play(EmberEntity ember, short[] samples) {
        VoicechatServerApi server = EmberVoicechatPlugin.server();
        if (server == null) return;

        /*
         * A fresh channel each time, keyed on a random id.
         *
         * Reusing one would mean a second line cutting the first off mid-word;
         * a new channel lets the previous one finish, which is what happens when
         * two people talk over each other and reads as natural rather than as a
         * glitch.
         */
        EntityAudioChannel channel = server.createEntityAudioChannel(
                UUID.randomUUID(),
                EmberVoicechatPlugin.api().fromEntity(ember));

        if (channel == null) return;

        channel.setDistance(EmberConfig.get().speechDistance);

        AudioPlayer player = server.createAudioPlayer(
                channel,
                EmberVoicechatPlugin.api().createEncoder(),
                samples);

        player.startPlaying();
    }

    /** Minimal JSON string escaping; the payload is one short line of prose. */
    private static String quote(String raw) {
        StringBuilder out = new StringBuilder("\"");
        for (int i = 0; i < raw.length(); i++) {
            char c = raw.charAt(i);
            switch (c) {
                case '"' -> out.append("\\\"");
                case '\\' -> out.append("\\\\");
                case '\n' -> out.append("\\n");
                case '\r' -> out.append("\\r");
                case '\t' -> out.append("\\t");
                default -> {
                    if (c < 0x20) out.append(String.format("\\u%04x", (int) c));
                    else out.append(c);
                }
            }
        }
        return out.append('"').toString();
    }
}
