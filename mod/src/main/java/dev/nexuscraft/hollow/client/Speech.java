package dev.nexuscraft.hollow.client;

import dev.nexuscraft.hollow.Hollow;

import javax.sound.sampled.AudioInputStream;
import javax.sound.sampled.AudioSystem;
import javax.sound.sampled.Clip;
import javax.sound.sampled.FloatControl;
import java.io.ByteArrayInputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * A real voice, from whichever engine you point it at.
 *
 * One implementation covers three of the four things people mean when they ask
 * for better voices, because they all speak the same HTTP call. OpenAI defined
 * `POST /v1/audio/speech`, and the usual way to run Kokoro locally —
 * Kokoro-FastAPI — deliberately implements the same endpoint, as do most of the
 * other self-hosted engines. So "offline neural voice" and "hosted voice" are
 * one code path and a different `speechUrl`, exactly like the language model.
 *
 * The fourth, Edge, is not here on purpose. Its free voices are not a public
 * API but a private WebSocket protocol behind a rolling signed token that
 * Microsoft changes without notice; a reimplementation works until it does not,
 * and then the mod is silent for a reason nobody can debug from inside
 * Minecraft. The game's own narrator covers "free, no setup" honestly.
 *
 * WAV rather than MP3, which is the one detail that makes this small: the JDK
 * can decode WAV out of the box and cannot decode MP3 without a library, so
 * asking for WAV turns playback into eight lines instead of a dependency.
 */
public final class Speech {

    private Speech() {}

    private static final HttpClient HTTP = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .build();

    /**
     * One voice at a time, and never on the render thread.
     *
     * Single-threaded so two lines cannot be spoken over each other, and a
     * daemon so a request in flight can never hold the game open on quit.
     */
    private static final ExecutorService WORKER = Executors.newSingleThreadExecutor(runnable -> {
        Thread thread = new Thread(runnable, "hollow-speech");
        thread.setDaemon(true);
        return thread;
    });

    private static volatile Clip playing;

    /**
     * How many lines are waiting their turn.
     *
     * Bounded, because the original reason this interrupted rather than queued
     * was real: a companion that falls behind ends up calmly narrating
     * something that happened four minutes ago. A short queue drains a burst of
     * dialogue in order; anything beyond it is dropped on arrival, which keeps
     * the voice current without losing a four-line greeting.
     */
    private static final java.util.concurrent.atomic.AtomicInteger waiting =
            new java.util.concurrent.atomic.AtomicInteger();

    private static final int MOST_WAITING = 5;

    /**
     * How stale a line may be before it is dropped unspoken.
     *
     * Synthesis takes a few seconds a line, so a burst of dialogue queues
     * faster than it can be said — and the arrival, which is six lines in one
     * tick, ended up being read aloud for half a minute after the text had
     * scrolled away and the player had walked off. A voice narrating something
     * that finished twenty seconds ago is worse than silence: it is not
     * atmosphere, it is a lag.
     *
     * So a line that has been waiting too long is thrown away rather than said
     * late. The text is already in chat; the audio was the garnish.
     */
    private static final long STALE_MS = 7_000L;

    /*
     * The loudness of the line currently being spoken, in 40ms frames.
     *
     * This exists so the mask's mouth can be driven by the actual audio rather
     * than by a loop. Built once when a line starts playing, read once a frame
     * by the renderer, and thrown away when the clip ends — so "is it talking"
     * and "how open is its mouth" are the same question with the same answer,
     * and neither can drift from what you can hear.
     */
    private static volatile float[] envelope;
    private static volatile long spokeAt;

    /** How much of a second each entry in the envelope covers. */
    private static final int FRAME_MS = 40;

    private static String url;
    private static String model;
    private static String voice;
    private static String key;
    private static float volume = 1.0f;
    private static boolean enabled = false;

    /** True synthesises here, in this process; false asks an engine over HTTP. */
    private static boolean local = true;

    /** Whether a failure has already been reported, so a dead engine is not spam. */
    private static boolean warned = false;

    public static void configure(String baseUrl, String modelName, String voiceName, String apiKey,
                                 double gain) {
        configure(baseUrl, modelName, voiceName, apiKey, gain, true);
    }

    public static void configure(String baseUrl, String modelName, String voiceName, String apiKey,
                                 double gain, boolean useLocal) {
        local = useLocal;
        // A fresh choice deserves a fresh chance; see disable().
        warned = false;
        url = baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
        model = modelName;
        voice = voiceName;
        key = apiKey;
        volume = (float) Math.min(Math.max(gain, 0.0), 1.0);
        enabled = true;

        /*
         * Load the model before anybody says anything.
         *
         * The first line of a session paid for reading an 82MB model off disk —
         * three and a half seconds — and the first line of a session is the
         * introduction, which is the one line that has to land. Warmed on the
         * speech worker so it is finished, or nearly, by the time it is wanted.
         */
        if (local) {
            WORKER.submit(() -> {
                try {
                    if (dev.nexuscraft.voice.Models.ready(voice)
                            || dev.nexuscraft.voice.Models.fetch(voice)) {
                        dev.nexuscraft.voice.KokoroVoice.ready();
                    }
                } catch (Throwable ignored) {
                    // A cold first line is a far smaller problem than a crash
                    // in a background thread at startup.
                }
            });
        }

        Hollow.LOG.info("speech: {} — {}", voiceName,
                local ? "running in the game" : modelName + " at " + url);
    }

    /**
     * Switches the voice off and forgets that it ever failed.
     *
     * The forgetting matters. `warned` and `enabled` are both latched by the
     * first failure, so an engine that was unreachable once stays off for the
     * session — which is right for a broken engine and wrong for somebody who
     * has just changed the setting to fix it.
     */
    public static void disable() {
        stop();
        enabled = false;
        warned = false;
    }

    public static boolean enabled() {
        return enabled;
    }

    /**
     * Says a line, interrupting whatever it was saying.
     *
     * Interrupting rather than queueing is deliberate and was learned the
     * expensive way on the launcher's companion: queued speech falls further and
     * further behind the game until something is calmly narrating an event from
     * four minutes ago, which is worse than silence.
     */
    public static void say(String text) {
        if (!enabled || text == null || text.isBlank()) return;

        /*
         * Queued, not interrupted.
         *
         * This used to call stop() first, which was fatal for anything that
         * spoke more than one line at a time: the four-line introduction was
         * submitted in a single tick, and each line killed the one before it, so
         * the player heard at most the last — and in practice not even that,
         * because the voice model was still loading when the last one was
         * discarded too. The whole arrival was silent.
         */
        if (waiting.get() >= MOST_WAITING) return;
        waiting.incrementAndGet();

        long said = System.currentTimeMillis();

        WORKER.submit(() -> {
            try {
                // Its moment has passed; let it go rather than say it late.
                if (System.currentTimeMillis() - said > STALE_MS) return;

                byte[] wav = local ? locally(text) : synthesise(text);
                if (wav != null && wav.length > 0) play(wav);
            } catch (Exception e) {
                /*
                 * A dead engine stands aside rather than holding the voice.
                 *
                 * Nothing here can tell at startup whether the configured
                 * engine is actually running — checking would mean a blocking
                 * request on the client thread before the menu draws. So the
                 * first line is the test, and failing it switches this off, at
                 * which point the narrator picks the lines up instead.
                 *
                 * Without this, choosing `both` with no engine installed was
                 * total silence: speech claimed the lines and then dropped
                 * every one of them, and the narrator never saw any.
                 */
                enabled = false;
                if (!warned) {
                    warned = true;
                    Hollow.LOG.warn("speech engine unreachable ({})", e.toString());
                    Hollow.LOG.warn("falling back to the game's narrator; check `speechUrl` "
                            + "in config/hollow.properties");
                }
                // The line that failed is still worth saying.
                Narration.narrate(text);
            } finally {
                waiting.decrementAndGet();
            }
        });
    }

    /**
     * The voice, synthesised in this process, as WAV bytes.
     *
     * Returned as a WAV rather than as raw samples so it goes through exactly
     * the same playback and volume control as the HTTP route — one path to be
     * wrong, not two. The header costs forty-four bytes.
     *
     * Kokoro answers at 24kHz and the mixer resamples on the way out, which it
     * is much better at than anything worth writing here.
     */
    private static byte[] locally(String text) throws Exception {
        if (!dev.nexuscraft.voice.Models.ready(voice)
                && !dev.nexuscraft.voice.Models.fetch(voice)) {
            throw new IllegalStateException("the voice model could not be prepared");
        }

        float[] audio = dev.nexuscraft.voice.KokoroVoice.speak(text, voice, 1.0f);
        if (audio == null || audio.length == 0) return null;

        java.nio.ByteBuffer pcm = java.nio.ByteBuffer.allocate(audio.length * 2)
                .order(java.nio.ByteOrder.LITTLE_ENDIAN);
        for (float sample : audio) {
            float clamped = Math.max(-1.0f, Math.min(1.0f, sample));
            pcm.putShort((short) Math.round(clamped * 32767.0f));
        }

        javax.sound.sampled.AudioFormat format = new javax.sound.sampled.AudioFormat(
                dev.nexuscraft.voice.KokoroVoice.SAMPLE_RATE, 16, 1, true, false);

        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        try (AudioInputStream stream = new AudioInputStream(
                new ByteArrayInputStream(pcm.array()), format, audio.length)) {
            AudioSystem.write(stream, javax.sound.sampled.AudioFileFormat.Type.WAVE, out);
        }
        return out.toByteArray();
    }

    /**
     * A JSON string literal.
     *
     * Hand-rolled rather than pulled from a library because the only thing
     * being encoded here is one line of dialogue, and that line comes from a
     * language model — so it genuinely does arrive containing quotation marks,
     * apostrophes and the occasional newline, and pasting it into a request
     * unescaped produces a 400 that looks like the engine being down.
     */
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
                    // Control characters are illegal raw in JSON strings.
                    if (c < 0x20) out.append(String.format("\\u%04x", (int) c));
                    else out.append(c);
                }
            }
        }
        return out.append('"').toString();
    }

    private static byte[] synthesise(String text) throws Exception {
        String body = "{\"model\":" + quote(model)
                + ",\"input\":" + quote(text)
                + ",\"voice\":" + quote(voice)
                + ",\"response_format\":\"wav\"}";

        HttpRequest.Builder request = HttpRequest.newBuilder()
                .uri(URI.create(url + "/audio/speech"))
                .timeout(Duration.ofSeconds(30))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body));

        // Local engines want no key at all, and sending an empty bearer token
        // makes some of them reject the request outright.
        if (key != null && !key.isBlank()) request.header("Authorization", "Bearer " + key);

        HttpResponse<byte[]> response =
                HTTP.send(request.build(), HttpResponse.BodyHandlers.ofByteArray());

        if (response.statusCode() / 100 != 2) {
            throw new IllegalStateException("HTTP " + response.statusCode() + " from " + url);
        }
        return response.body();
    }

    /**
     * How open the mouth should be right now, 0 to 1.
     *
     * Zero whenever nothing is playing, which covers the silent last act for
     * free: it stops talking, so the envelope is never built, so the mouth
     * never opens — no special case anywhere.
     */
    public static float mouthOpenness() {
        float[] frames = envelope;
        if (frames == null || playing == null) return 0.0f;

        int at = (int) ((System.currentTimeMillis() - spokeAt) / FRAME_MS);
        if (at < 0 || at >= frames.length) return 0.0f;
        return frames[at];
    }

    /**
     * The loudness of each 40ms of a line, normalised against its own peak.
     *
     * Normalised per line rather than absolutely because a quiet sentence
     * should still move the mouth — the mask is showing *that* it is speaking,
     * not how loudly, and a whisper that barely opens it reads as a bug.
     */
    private static float[] envelopeOf(byte[] wav) {
        try (AudioInputStream in = AudioSystem.getAudioInputStream(new ByteArrayInputStream(wav))) {
            javax.sound.sampled.AudioFormat format = in.getFormat();
            byte[] raw = in.readAllBytes();

            int bytesPerSample = Math.max(1, format.getSampleSizeInBits() / 8);
            int channels = Math.max(1, format.getChannels());
            int stride = bytesPerSample * channels;
            int perFrame = Math.max(1, (int) (format.getSampleRate() * FRAME_MS / 1000.0));

            int samples = raw.length / stride;
            float[] frames = new float[Math.max(1, samples / perFrame)];

            java.nio.ByteBuffer buffer = java.nio.ByteBuffer.wrap(raw)
                    .order(format.isBigEndian() ? java.nio.ByteOrder.BIG_ENDIAN
                                                : java.nio.ByteOrder.LITTLE_ENDIAN);

            float loudest = 0.0f;
            for (int frame = 0; frame < frames.length; frame++) {
                double energy = 0.0;
                for (int i = 0; i < perFrame; i++) {
                    int at = (frame * perFrame + i) * stride;
                    if (at + 1 >= raw.length) break;
                    float value = buffer.getShort(at) / 32768.0f;
                    energy += value * value;
                }
                frames[frame] = (float) Math.sqrt(energy / perFrame);
                loudest = Math.max(loudest, frames[frame]);
            }

            if (loudest > 0.0001f) {
                for (int i = 0; i < frames.length; i++) {
                    // Square-rooted so quiet consonants still register; a linear
                    // scale makes the mouth flap only on the loudest vowels.
                    frames[i] = (float) Math.sqrt(Math.min(1.0f, frames[i] / loudest));
                }
            }
            return frames;
        } catch (Exception e) {
            // No envelope simply means a mask that does not move its mouth.
            return null;
        }
    }

    private static void play(byte[] wav) throws Exception {
        float[] frames = envelopeOf(wav);

        try (AudioInputStream audio = AudioSystem.getAudioInputStream(new ByteArrayInputStream(wav))) {
            Clip clip = AudioSystem.getClip();
            clip.open(audio);

            /*
             * Set in decibels, because that is the only control the mixer
             * offers. A linear fraction sounds wrong applied directly — half is
             * barely quieter — so it is converted, and a gain of zero is treated
             * as silence rather than as log(0).
             */
            if (volume < 1.0f && clip.isControlSupported(FloatControl.Type.MASTER_GAIN)) {
                FloatControl control = (FloatControl) clip.getControl(FloatControl.Type.MASTER_GAIN);
                float decibels = volume <= 0f ? control.getMinimum()
                        : (float) (20.0 * Math.log10(volume));
                control.setValue(Math.max(control.getMinimum(), Math.min(decibels, control.getMaximum())));
            }

            envelope = frames;
            spokeAt = System.currentTimeMillis();
            playing = clip;
            clip.start();

            /*
             * Hold this worker until the line has actually been said.
             *
             * The executor is single-threaded, so blocking here is what makes
             * the queue a queue: the next line waits for this one to finish
             * instead of stamping on it. Capped so a wildly long clip cannot
             * wedge the voice shut.
             */
            long length = Math.min(clip.getMicrosecondLength() / 1000L, 20_000L);
            try {
                Thread.sleep(length + 60L);
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
            }

            // Released when it finishes, or the process accumulates open lines
            // until the mixer refuses to give out any more.
            clip.addLineListener(event -> {
                if (event.getType() == javax.sound.sampled.LineEvent.Type.STOP) {
                    clip.close();
                    if (playing == clip) playing = null;
                }
            });
        }
    }

    public static void stop() {
        envelope = null;
        Clip current = playing;
        if (current == null) return;
        try {
            current.stop();
            current.close();
        } catch (Exception ignored) {
            // Already closed by the listener; nothing to do.
        }
        playing = null;
    }
}
