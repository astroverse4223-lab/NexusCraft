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
                short[] samples = config.speechLocal ? locally(config, line) : overHttp(config, line);
                if (samples == null || samples.length == 0) return;

                play(ember, samples);
            } catch (Exception e) {
                Ember.LOG.warn("Ember could not speak aloud: {}", e.getMessage());
            }
        });
    }

    /**
     * The voice, running inside this process. No server, nothing installed.
     *
     * The first line of a session pays for an 82MB download and loading the
     * model; every line after that is a few seconds of arithmetic on two CPU
     * threads. Both happen on this thread, which is not the server thread, so
     * the game does not wait for either.
     */
    private static short[] locally(EmberConfig config, String line) throws Exception {
        if (!dev.nexuscraft.voice.Models.ready(config.speechVoice)
                && !dev.nexuscraft.voice.Models.fetch(config.speechVoice)) {
            return null;
        }

        float[] audio = dev.nexuscraft.voice.KokoroVoice.speak(line, config.speechVoice, 1.0f);
        if (audio == null || audio.length == 0) return null;

        return resample(audio, dev.nexuscraft.voice.KokoroVoice.SAMPLE_RATE);
    }

    /** The voice, asked for over HTTP from whatever engine is running. */
    private static short[] overHttp(EmberConfig config, String line) throws Exception {
        byte[] audio = synthesise(config, line);
        return audio == null ? null : toSamples(audio);
    }

    /**
     * Kokoro's 24kHz floats as the 48kHz samples voice chat wants.
     *
     * Handed to the JDK's own converter rather than resampled here. Doubling a
     * sample rate looks like it should be "repeat every sample", and doing that
     * produces audible aliasing on sibilants — a voice that hisses. The audio
     * pipeline already knows how to do this properly and is already being used
     * for the HTTP path, so both routes end up sounding the same.
     */
    private static short[] resample(float[] audio, int sampleRate) throws Exception {
        ByteBuffer pcm = ByteBuffer.allocate(audio.length * 2).order(ByteOrder.LITTLE_ENDIAN);
        for (float sample : audio) {
            float clamped = Math.max(-1.0f, Math.min(1.0f, sample));
            pcm.putShort((short) Math.round(clamped * 32767.0f));
        }

        AudioFormat source = new AudioFormat(sampleRate, 16, 1, true, false);
        try (AudioInputStream raw = new AudioInputStream(
                new ByteArrayInputStream(pcm.array()), source, audio.length);
             AudioInputStream converted = AudioSystem.getAudioInputStream(TARGET, raw)) {

            return read(converted);
        }
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

            return read(converted);
        }
    }

    /** A converted stream, drained into samples. Shared by both routes. */
    private static short[] read(AudioInputStream converted) throws Exception {
        byte[] raw = converted.readAllBytes();
        ByteBuffer buffer = ByteBuffer.wrap(raw).order(ByteOrder.LITTLE_ENDIAN);

        short[] samples = new short[raw.length / 2];
        for (int i = 0; i < samples.length; i++) samples[i] = buffer.getShort();
        return samples;
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
