package dev.nexuscraft.ember.voice;

import de.maxhenkel.voicechat.api.opus.OpusDecoder;
import dev.nexuscraft.ember.Ember;
import dev.nexuscraft.ember.EmberConfig;

import java.io.ByteArrayOutputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.BiConsumer;

/**
 * Ember listening to you speak, instead of you typing at it.
 *
 * Simple Voice Chat hands the server one small Opus packet per twenty
 * milliseconds while a microphone is open. Those are decoded and kept until the
 * packets stop, which is what the end of a sentence sounds like from here — and
 * then the whole utterance goes to a transcription service in one piece,
 * because Whisper is far better at a sentence than at fifty fragments of one.
 *
 * The audio never leaves the machine unless the player points this at something
 * remote; the default is the same local endpoint the speech engine uses.
 */
public final class Ears {

    /** Simple Voice Chat's format: 48kHz, mono, 16-bit. */
    private static final int SAMPLE_RATE = 48000;

    /** Silence this long means they have stopped talking. */
    private static final long END_OF_SPEECH_MS = 900;

    /** Ignore a blip — a cough, a knocked desk, half a syllable. */
    private static final long MINIMUM_SPEECH_MS = 350;

    /** And refuse to buffer forever if someone leaves a mic keyed open. */
    private static final long MAXIMUM_SPEECH_MS = 30_000;

    private static final ExecutorService TRANSCRIBING =
            Executors.newSingleThreadExecutor(runnable -> {
                Thread thread = new Thread(runnable, "ember-ears");
                thread.setDaemon(true);
                return thread;
            });

    private static final HttpClient HTTP = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .build();

    /** One in-progress utterance per speaker. */
    private static final Map<UUID, Utterance> LISTENING = new ConcurrentHashMap<>();

    private Ears() {
    }

    private static final class Utterance {
        final ByteArrayOutputStream pcm = new ByteArrayOutputStream();
        final OpusDecoder decoder;
        long lastPacketAt;
        final long startedAt;

        Utterance(OpusDecoder decoder) {
            this.decoder = decoder;
            this.startedAt = System.currentTimeMillis();
            this.lastPacketAt = this.startedAt;
        }

        long lengthMs() {
            // Two bytes a sample, mono.
            return (pcm.size() / 2L) * 1000L / SAMPLE_RATE;
        }
    }

    /**
     * One packet of somebody talking.
     *
     * Called from Simple Voice Chat's own thread, so it does nothing expensive:
     * decode, append, note the time.
     */
    public static void hearPacket(UUID speaker, byte[] opus) {
        if (!EmberConfig.get().listen) return;

        Utterance utterance = LISTENING.computeIfAbsent(speaker, id -> {
            OpusDecoder decoder = EmberVoicechatPlugin.api().createDecoder();
            return decoder == null ? null : new Utterance(decoder);
        });
        if (utterance == null) return;

        try {
            short[] samples = utterance.decoder.decode(opus);
            if (samples != null) {
                ByteBuffer buffer = ByteBuffer.allocate(samples.length * 2).order(ByteOrder.LITTLE_ENDIAN);
                for (short sample : samples) buffer.putShort(sample);
                utterance.pcm.write(buffer.array());
            }
            utterance.lastPacketAt = System.currentTimeMillis();
        } catch (Exception e) {
            Ember.LOG.debug("could not decode a voice packet: {}", e.getMessage());
        }
    }

    /**
     * Called every server tick. Closes off anyone who has stopped talking.
     *
     * `onHeard` is given the speaker and what they said, on the caller's thread
     * — which is the server thread, and the only safe place to act on it.
     */
    public static void tick(BiConsumer<UUID, String> onHeard) {
        if (LISTENING.isEmpty()) return;

        long now = System.currentTimeMillis();

        for (Map.Entry<UUID, Utterance> entry : LISTENING.entrySet()) {
            Utterance utterance = entry.getValue();
            boolean quiet = now - utterance.lastPacketAt >= END_OF_SPEECH_MS;
            boolean overlong = now - utterance.startedAt >= MAXIMUM_SPEECH_MS;
            if (!quiet && !overlong) continue;

            UUID speaker = entry.getKey();
            LISTENING.remove(speaker);
            utterance.decoder.close();

            if (utterance.lengthMs() < MINIMUM_SPEECH_MS) continue;

            byte[] wav = wrapAsWav(utterance.pcm.toByteArray());
            long spokenFor = utterance.lengthMs();

            TRANSCRIBING.submit(() -> {
                Ember.LOG.info("transcribing {}ms of speech", spokenFor);
                String heard = transcribe(wav);

                if (heard == null) {
                    // transcribe() has already said why.
                    return;
                }
                if (heard.isBlank()) {
                    Ember.LOG.info("heard {}ms but it came back empty — background noise, probably",
                            spokenFor);
                    return;
                }

                Ember.LOG.info("heard: {}", heard.trim());
                onHeard.accept(speaker, heard.trim());
            });
        }
    }

    /** Forgets a speaker, for when they disconnect mid-sentence. */
    public static void forget(UUID speaker) {
        Utterance utterance = LISTENING.remove(speaker);
        if (utterance != null) utterance.decoder.close();
    }

    /**
     * POST /v1/audio/transcriptions — the shape Whisper servers copy.
     *
     * Written as a multipart body by hand rather than pulling in a client
     * library for one request; the mod ships no dependencies of its own.
     */
    private static String transcribe(byte[] wav) {
        EmberConfig config = EmberConfig.get();
        String boundary = "----ember" + UUID.randomUUID().toString().replace("-", "");

        try {
            ByteArrayOutputStream body = new ByteArrayOutputStream();
            body.write(part(boundary, "model", config.sttModel));
            body.write(part(boundary, "response_format", "json"));
            // Left to the service unless someone pins it; Whisper's own
            // detection is better than a guess from a mod.
            if (!config.sttLanguage.isBlank()) {
                body.write(part(boundary, "language", config.sttLanguage));
            }

            body.write(("--" + boundary + "\r\n"
                    + "Content-Disposition: form-data; name=\"file\"; filename=\"speech.wav\"\r\n"
                    + "Content-Type: audio/wav\r\n\r\n").getBytes(StandardCharsets.UTF_8));
            body.write(wav);
            body.write(("\r\n--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8));

            HttpRequest.Builder request = HttpRequest.newBuilder()
                    .uri(URI.create(config.sttUrl + "/audio/transcriptions"))
                    .timeout(Duration.ofSeconds(config.timeoutSeconds))
                    .header("Content-Type", "multipart/form-data; boundary=" + boundary)
                    .POST(HttpRequest.BodyPublishers.ofByteArray(body.toByteArray()));

            if (!config.sttKey.isEmpty()) request.header("Authorization", "Bearer " + config.sttKey);

            HttpResponse<String> response =
                    HTTP.send(request.build(), HttpResponse.BodyHandlers.ofString());

            if (response.statusCode() / 100 != 2) {
                Ember.LOG.warn("transcription returned HTTP {} — is a speech-to-text service running at {}?",
                        response.statusCode(), config.sttUrl);
                return null;
            }

            return dev.nexuscraft.ember.ai.Json.stringField(response.body(), "text");
        } catch (java.net.ConnectException e) {
            Ember.LOG.warn("nothing answered at {} — Ember cannot hear you without a "
                    + "speech-to-text service", config.sttUrl);
            return null;
        } catch (Exception e) {
            Ember.LOG.warn("could not transcribe: {}", e.getMessage());
            return null;
        }
    }

    private static byte[] part(String boundary, String name, String value) {
        return ("--" + boundary + "\r\n"
                + "Content-Disposition: form-data; name=\"" + name + "\"\r\n\r\n"
                + value + "\r\n").getBytes(StandardCharsets.UTF_8);
    }

    /**
     * A RIFF header around the raw samples.
     *
     * Whisper servers accept a dozen formats and reliably accept this one, and
     * writing 44 bytes is cheaper than depending on an encoder.
     */
    static byte[] wrapAsWav(byte[] pcm) {
        ByteBuffer out = ByteBuffer.allocate(44 + pcm.length).order(ByteOrder.LITTLE_ENDIAN);

        out.put("RIFF".getBytes(StandardCharsets.US_ASCII));
        out.putInt(36 + pcm.length);
        out.put("WAVE".getBytes(StandardCharsets.US_ASCII));

        out.put("fmt ".getBytes(StandardCharsets.US_ASCII));
        out.putInt(16);                 // PCM header length
        out.putShort((short) 1);        // uncompressed
        out.putShort((short) 1);        // mono
        out.putInt(SAMPLE_RATE);
        out.putInt(SAMPLE_RATE * 2);    // bytes per second
        out.putShort((short) 2);        // block align
        out.putShort((short) 16);       // bits per sample

        out.put("data".getBytes(StandardCharsets.US_ASCII));
        out.putInt(pcm.length);
        out.put(pcm);

        return out.array();
    }
}
