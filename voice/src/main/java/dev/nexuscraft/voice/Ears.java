package dev.nexuscraft.voice;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

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
 * Listening, so you can talk to them instead of typing.
 *
 * Simple Voice Chat hands the server one small packet per twenty milliseconds
 * while a microphone is open. Those are kept until the packets stop, which is
 * what the end of a sentence sounds like from here, and then the whole
 * utterance goes to transcription in one piece — a speech model is far better
 * at a sentence than at fifty fragments of one.
 *
 * Deliberately takes decoded samples rather than Opus packets. Decoding needs
 * the voice chat API, and if this took that type then the shared library would
 * depend on a mod that may not be installed, for the sake of six lines that
 * each companion can perfectly well run itself. Every mod decodes its own
 * audio and hands the result here.
 *
 * Nothing is sent anywhere until somebody points it at an address, and the
 * default is a local one.
 */
public final class Ears {

    private static final Logger LOG = LoggerFactory.getLogger("NexusVoice");

    /** Simple Voice Chat's format: 48kHz, mono, 16-bit. */
    private static final int SAMPLE_RATE = 48_000;

    /** Silence this long means they have stopped talking. */
    private static final long END_OF_SPEECH_MS = 900;

    /** Ignore a blip — a cough, a knocked desk, half a syllable. */
    private static final long LEAST_SPEECH_MS = 350;

    /** And refuse to buffer forever if a mic is left keyed open. */
    private static final long MOST_SPEECH_MS = 30_000;

    /**
     * Where transcription happens, and whether to bother.
     *
     * `local` runs Whisper here, in the game's own process, and is the default
     * for the same reason the voice is: a companion that only hears you while
     * a launcher happens to be running is a companion that mostly does not
     * hear you. Everything after it is only read when local is off.
     */
    public record Listening(boolean enabled, boolean local, String url,
                            String model, String key, String language) {
    }

    private static volatile Listening settings =
            new Listening(false, true, "", "whisper-1", "", "");

    /**
     * Told once when transcription cannot be reached.
     *
     * A microphone that does nothing is indistinguishable from a microphone
     * that is not plugged in, and the log is not somewhere a player looks. The
     * failure cost a whole session of "he cannot hear me" before anybody
     * thought to check whether anything was answering — so it says so, in
     * front of them, the first time it happens.
     */
    private static volatile java.util.function.Consumer<String> trouble;

    private static volatile boolean complained;

    private static final ExecutorService TRANSCRIBING =
            Executors.newSingleThreadExecutor(runnable -> {
                Thread thread = new Thread(runnable, "nexusvoice-ears");
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

    public static void configure(Listening listening) {
        settings = listening;
        complained = false;

        /*
         * Fetch the model now rather than when somebody first speaks.
         *
         * It was lazy, so that a player who never opens their microphone never
         * paid for it. That was the wrong trade: the forty megabytes landed in
         * the middle of the first conversation instead, and ten seconds of
         * silence after you talk is indistinguishable from a companion that
         * cannot hear you. It is much better spent while the world is loading.
         *
         * On the transcription thread, so anything said during the download
         * simply queues behind it, and nothing has to wait on the game.
         */
        if (listening.enabled() && listening.local() && !Models.hearingReady()) {
            TRANSCRIBING.submit(Models::fetchHearing);
        }
    }

    /** Where to say it when the microphone is going nowhere. */
    public static void onTrouble(java.util.function.Consumer<String> say) {
        trouble = say;
    }

    public static boolean enabled() {
        Listening now = settings;
        return now.enabled() && (now.local() || !now.url().isBlank());
    }

    private static final class Utterance {
        final ByteArrayOutputStream pcm = new ByteArrayOutputStream();
        long lastPacketAt = System.currentTimeMillis();

        long lengthMs() {
            // Two bytes a sample, mono.
            return (pcm.size() / 2L) * 1000L / SAMPLE_RATE;
        }
    }

    /**
     * Some more of somebody talking.
     *
     * Called from the voice chat's own thread, twenty times a second per
     * speaker, so it does nothing but append and note the time.
     */
    public static void hear(UUID speaker, short[] samples) {
        if (!enabled() || samples == null || samples.length == 0) return;

        Utterance utterance = LISTENING.computeIfAbsent(speaker, id -> new Utterance());

        ByteBuffer buffer = ByteBuffer.allocate(samples.length * 2).order(ByteOrder.LITTLE_ENDIAN);
        for (short sample : samples) buffer.putShort(sample);

        synchronized (utterance) {
            if (utterance.lengthMs() < MOST_SPEECH_MS) {
                utterance.pcm.write(buffer.array(), 0, buffer.array().length);
            }
            utterance.lastPacketAt = System.currentTimeMillis();
        }
    }

    /**
     * Called every server tick. Closes off anyone who has stopped talking.
     *
     * `onHeard` is handed the speaker and what they said — but on the
     * transcription thread, so callers must hop back to the server thread
     * themselves before touching the world.
     */
    public static void tick(BiConsumer<UUID, String> onHeard) {
        if (LISTENING.isEmpty()) return;

        long now = System.currentTimeMillis();

        for (Map.Entry<UUID, Utterance> entry : LISTENING.entrySet()) {
            Utterance utterance = entry.getValue();
            if (now - utterance.lastPacketAt < END_OF_SPEECH_MS) continue;

            UUID speaker = entry.getKey();
            LISTENING.remove(speaker);

            byte[] pcm;
            long length;
            synchronized (utterance) {
                pcm = utterance.pcm.toByteArray();
                length = utterance.lengthMs();
            }

            // Too short to be a sentence; almost always a noise in the room.
            if (length < LEAST_SPEECH_MS) continue;

            TRANSCRIBING.submit(() -> {
                String heard = settings.local() ? locally(pcm) : transcribe(wav(pcm));
                if (heard != null && !heard.isBlank()) onHeard.accept(speaker, heard.trim());
            });
        }
    }

    public static void forget(UUID speaker) {
        LISTENING.remove(speaker);
    }

    /** Raw samples with a WAV header on the front, which is what the API wants. */
    private static byte[] wav(byte[] pcm) {
        ByteBuffer out = ByteBuffer.allocate(44 + pcm.length).order(ByteOrder.LITTLE_ENDIAN);

        out.put("RIFF".getBytes(StandardCharsets.US_ASCII));
        out.putInt(36 + pcm.length);
        out.put("WAVE".getBytes(StandardCharsets.US_ASCII));
        out.put("fmt ".getBytes(StandardCharsets.US_ASCII));
        out.putInt(16);
        out.putShort((short) 1);          // PCM
        out.putShort((short) 1);          // mono
        out.putInt(SAMPLE_RATE);
        out.putInt(SAMPLE_RATE * 2);      // bytes per second
        out.putShort((short) 2);          // block align
        out.putShort((short) 16);         // bits per sample
        out.put("data".getBytes(StandardCharsets.US_ASCII));
        out.putInt(pcm.length);
        out.put(pcm);

        return out.array();
    }

    /**
     * Whisper, in this process, with nothing else running.
     *
     * The model is fetched the first time somebody speaks rather than at
     * startup — it is forty megabytes, and a player who never opens their
     * microphone should never pay for it. The download happens on the
     * transcription thread, so the first sentence of a session is slow and
     * every one after it is not.
     */
    private static String locally(byte[] pcm) {
        if (!Models.hearingReady() && !Models.fetchHearing()) {
            grumble("Could not download the listening model — check the connection,"
                    + " or point sttUrl at a transcription server instead.");
            return null;
        }

        if (!Whisper.ready()) {
            grumble("The listening model would not load. See the log for why.");
            return null;
        }

        short[] samples = new short[pcm.length / 2];
        ByteBuffer buffer = ByteBuffer.wrap(pcm).order(ByteOrder.LITTLE_ENDIAN);
        for (int i = 0; i < samples.length; i++) samples[i] = buffer.getShort();

        return Whisper.hear(samples, SAMPLE_RATE);
    }

    /**
     * POST /v1/audio/transcriptions, the shape OpenAI defined.
     *
     * The multipart body is written by hand rather than pulling in an HTTP
     * client library for it: it is one file and three fields, and the whole
     * thing is shorter than the dependency would be.
     */
    private static String transcribe(byte[] wav) {
        Listening now = settings;
        String boundary = "----nexusvoice" + UUID.randomUUID().toString().replace("-", "");

        try {
            ByteArrayOutputStream body = new ByteArrayOutputStream();
            body.write(part(boundary, "model", now.model()));
            body.write(part(boundary, "response_format", "json"));
            if (!now.language().isBlank()) body.write(part(boundary, "language", now.language()));

            body.write(("--" + boundary + "\r\n"
                    + "Content-Disposition: form-data; name=\"file\"; filename=\"speech.wav\"\r\n"
                    + "Content-Type: audio/wav\r\n\r\n").getBytes(StandardCharsets.UTF_8));
            body.write(wav);
            body.write(("\r\n--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8));

            HttpRequest.Builder request = HttpRequest.newBuilder()
                    .uri(URI.create(now.url() + "/audio/transcriptions"))
                    .timeout(Duration.ofSeconds(45))
                    .header("Content-Type", "multipart/form-data; boundary=" + boundary)
                    .POST(HttpRequest.BodyPublishers.ofByteArray(body.toByteArray()));

            if (!now.key().isBlank()) request.header("Authorization", "Bearer " + now.key());

            HttpResponse<String> response =
                    HTTP.send(request.build(), HttpResponse.BodyHandlers.ofString());

            if (response.statusCode() / 100 != 2) {
                LOG.warn("transcription returned HTTP {} — is one running at {}?",
                        response.statusCode(), now.url());
                grumble("Transcription answered HTTP " + response.statusCode()
                        + " from " + now.url() + ".");
                return null;
            }

            return field(response.body(), "text");
        } catch (java.net.ConnectException unreachable) {
            LOG.warn("nothing is answering at {} — speech cannot be transcribed", now.url());
            grumble("Nothing is listening at " + now.url()
                    + " — start the launcher, or set listen=false to stop trying.");
            return null;
        } catch (Exception e) {
            LOG.warn("could not transcribe: {}", e.toString());
            grumble("Could not transcribe what you said: " + e);
            return null;
        }
    }

    /** Once a session, so a dead endpoint is not a stream of complaints. */
    private static void grumble(String what) {
        if (complained) return;
        complained = true;

        java.util.function.Consumer<String> say = trouble;
        if (say != null) say.accept(what);
    }

    private static byte[] part(String boundary, String name, String value) {
        return ("--" + boundary + "\r\n"
                + "Content-Disposition: form-data; name=\"" + name + "\"\r\n\r\n"
                + value + "\r\n").getBytes(StandardCharsets.UTF_8);
    }

    /** The one string field wanted out of a small, known reply. */
    private static String field(String json, String name) {
        int at = json.indexOf('"' + name + '"');
        if (at < 0) return null;

        int open = json.indexOf('"', json.indexOf(':', at) + 1);
        if (open < 0) return null;

        StringBuilder out = new StringBuilder();
        for (int i = open + 1; i < json.length(); i++) {
            char c = json.charAt(i);
            if (c == '\\' && i + 1 < json.length()) {
                char next = json.charAt(++i);
                out.append(switch (next) {
                    case 'n' -> '\n';
                    case 't' -> '\t';
                    case 'r' -> '\r';
                    default -> next;
                });
                continue;
            }
            if (c == '"') break;
            out.append(c);
        }
        return out.toString();
    }
}
