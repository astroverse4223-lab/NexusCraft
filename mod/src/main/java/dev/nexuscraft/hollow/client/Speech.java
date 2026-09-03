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

    private static String url;
    private static String model;
    private static String voice;
    private static String key;
    private static float volume = 1.0f;
    private static boolean enabled = false;

    /** Whether a failure has already been reported, so a dead engine is not spam. */
    private static boolean warned = false;

    public static void configure(String baseUrl, String modelName, String voiceName, String apiKey,
                                 double gain) {
        url = baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
        model = modelName;
        voice = voiceName;
        key = apiKey;
        volume = (float) Math.min(Math.max(gain, 0.0), 1.0);
        enabled = true;
        Hollow.LOG.info("speech: {} ({}) at {}", voiceName, modelName, url);
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

        WORKER.submit(() -> {
            try {
                stop();
                byte[] wav = synthesise(text);
                if (wav != null && wav.length > 0) play(wav);
            } catch (Exception e) {
                if (!warned) {
                    warned = true;
                    Hollow.LOG.warn("speech engine unreachable ({}); falling back to silence", e.toString());
                    Hollow.LOG.warn("check `speechUrl` in config/hollow.properties, or set voice=narrator");
                }
            }
        });
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

    private static void play(byte[] wav) throws Exception {
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

            playing = clip;
            clip.start();

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
