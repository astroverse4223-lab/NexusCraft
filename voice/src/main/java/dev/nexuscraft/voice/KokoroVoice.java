package dev.nexuscraft.voice;

import ai.onnxruntime.OnnxTensor;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtSession;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;
import java.nio.LongBuffer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Kokoro, running inside Minecraft.
 *
 * The model itself is the easy part — one session, three inputs, one waveform
 * out. What took the work is either side of it: {@link Phonemes} turning
 * English into the alphabet it reads, and the small pile of exact conventions
 * below, none of which are written down anywhere and all of which produce
 * plausible noise rather than an error when you get them wrong.
 *
 * Those conventions, for whoever reads this next:
 *
 *   The token sequence is wrapped in id 0 at both ends. That is the "$" symbol
 *   in the vocabulary, and the tokenizer's post-processor adds it.
 *
 *   The voice is not a setting, it is a tensor. Each .bin holds 510 different
 *   256-float style vectors, and which one you use depends on *how long the
 *   sentence is* — index by the token count. Reading the first one always,
 *   which is the obvious thing to do, gives a voice that is subtly wrong in a
 *   way that is very hard to hear and impossible to place.
 *
 *   Output is 24kHz. Simple Voice Chat wants 48kHz. That resampling is the
 *   caller's problem and it is not optional.
 */
public final class KokoroVoice {

    private static final Logger LOG = LoggerFactory.getLogger("Ember");

    /** 24kHz mono float, which is what Kokoro produces. */
    public static final int SAMPLE_RATE = 24_000;

    /** The style vectors in one voice file; also the longest sentence it has. */
    private static final int STYLE_POSITIONS = 510;
    private static final int STYLE_WIDTH = 256;

    /** Longer than this and the style index would run off the end of the file. */
    private static final int MOST_TOKENS = 509;

    private static Map<String, Integer> vocabulary;
    private static OrtEnvironment environment;
    private static OrtSession session;
    private static final Map<String, float[]> STYLES = new HashMap<>();

    private KokoroVoice() {
    }

    /* ----------------------------------------------------------- the model */

    /**
     * Loads the session, once.
     *
     * Returns false rather than throwing: no voice is a state the mod handles
     * everywhere, and a missing model should read as quiet, not as a crash in
     * the middle of a sentence.
     */
    public static synchronized boolean ready() {
        if (session != null) return true;

        try {
            if (!Files.isRegularFile(Models.modelFile())) return false;

            long began = System.currentTimeMillis();
            environment = OrtEnvironment.getEnvironment();

            OrtSession.SessionOptions options = new OrtSession.SessionOptions();
            /*
             * Two threads, deliberately.
             *
             * This runs while a game is being played on the same machine, and
             * the default is one thread per core — which would hand every core
             * to a sentence of speech and drop frames to do it. Two is enough
             * to stay ahead of speech in real time.
             */
            options.setIntraOpNumThreads(2);
            options.setInterOpNumThreads(1);

            session = environment.createSession(Models.modelFile().toString(), options);

            LOG.info("voice model loaded in {}ms — inputs {}",
                    System.currentTimeMillis() - began, session.getInputNames());
            return true;
        } catch (Throwable e) {
            // Throwable: a missing native library arrives as an Error, not an
            // Exception, and it must not take the server thread with it.
            LOG.error("could not load the voice model: {}", e.toString());
            session = null;
            return false;
        }
    }

    /* ------------------------------------------------------------- speaking */

    /**
     * A line of English as 24kHz mono samples, or null when it cannot.
     *
     * Everything that can go wrong here — no model, no voice file, an empty
     * sentence, a failed inference — returns null, and the caller stays quiet.
     */
    public static float[] speak(String line, String voice, float speed) {
        String phonemes = Phonemes.of(line);
        if (phonemes.isEmpty()) return null;
        if (!ready()) return null;

        long[] tokens = tokenise(phonemes);
        if (tokens.length <= 2) return null;

        float[] style = style(voice, tokens.length);
        if (style == null) return null;

        try {
            Map<String, OnnxTensor> inputs = new LinkedHashMap<>();
            inputs.put("input_ids", OnnxTensor.createTensor(environment,
                    LongBuffer.wrap(tokens), new long[]{1, tokens.length}));
            inputs.put("style", OnnxTensor.createTensor(environment,
                    FloatBuffer.wrap(style), new long[]{1, STYLE_WIDTH}));
            inputs.put("speed", OnnxTensor.createTensor(environment,
                    FloatBuffer.wrap(new float[]{speed}), new long[]{1}));

            try (OrtSession.Result result = session.run(inputs)) {
                float[] audio = waveform(result.get(0).getValue());
                return audio;
            } finally {
                for (OnnxTensor tensor : inputs.values()) tensor.close();
            }
        } catch (Throwable e) {
            LOG.error("the voice model failed on \"{}\": {}", line, e.toString());
            return null;
        }
    }

    /** The waveform, whichever shape the model hands it back in. */
    private static float[] waveform(Object value) {
        if (value instanceof float[] flat) return flat;
        if (value instanceof float[][] batched && batched.length > 0) return batched[0];
        if (value instanceof float[][][] deeper && deeper.length > 0 && deeper[0].length > 0) {
            return deeper[0][0];
        }
        LOG.error("the voice model returned {}, which is not a waveform",
                value == null ? "nothing" : value.getClass());
        return null;
    }

    /* ------------------------------------------------------------- the parts */

    /**
     * Phonemes to token ids, wrapped in the boundary token at both ends.
     *
     * Symbols the vocabulary does not contain are dropped rather than
     * substituted. There is no sensible stand-in for a sound the model has
     * never been taught, and a wrong token is worse than a missing one.
     */
    static long[] tokenise(String phonemes) {
        loadVocabulary();
        if (vocabulary == null) return new long[0];

        long[] buffer = new long[Math.min(phonemes.length(), MOST_TOKENS) + 2];
        int at = 0;
        buffer[at++] = 0;

        for (int i = 0; i < phonemes.length() && at < buffer.length - 1; i++) {
            Integer id = vocabulary.get(String.valueOf(phonemes.charAt(i)));
            if (id != null) buffer[at++] = id;
        }

        buffer[at++] = 0;

        long[] exact = new long[at];
        System.arraycopy(buffer, 0, exact, 0, at);
        return exact;
    }

    /**
     * The style vector for a voice at this length.
     *
     * Indexed by the number of tokens between the boundary markers, which is
     * why the file holds 510 of them. Kokoro's own JavaScript does the same
     * arithmetic; it is not a heuristic, it is how the voice is stored.
     */
    private static float[] style(String voice, int tokenCount) {
        float[] all = styleFile(voice);
        if (all == null) return null;

        int position = Math.min(Math.max(tokenCount - 2, 0), MOST_TOKENS);
        int offset = position * STYLE_WIDTH;
        if (offset + STYLE_WIDTH > all.length) return null;

        float[] slice = new float[STYLE_WIDTH];
        System.arraycopy(all, offset, slice, 0, STYLE_WIDTH);
        return slice;
    }

    /** A whole voice file, read once and kept — 510KB each. */
    private static synchronized float[] styleFile(String voice) {
        float[] cached = STYLES.get(voice);
        if (cached != null) return cached;

        try {
            byte[] raw = Files.readAllBytes(Models.voiceFile(voice));
            if (raw.length < STYLE_POSITIONS * STYLE_WIDTH * 4) {
                LOG.error("the voice file for {} is {} bytes, which is too small", voice, raw.length);
                return null;
            }

            // Little endian: the files are numpy arrays written on x86.
            ByteBuffer buffer = ByteBuffer.wrap(raw).order(ByteOrder.LITTLE_ENDIAN);
            float[] floats = new float[STYLE_POSITIONS * STYLE_WIDTH];
            buffer.asFloatBuffer().get(floats);

            STYLES.put(voice, floats);
            return floats;
        } catch (Exception e) {
            LOG.error("could not read the voice {}: {}", voice, e.toString());
            return null;
        }
    }

    /** The 115 symbols and their ids, from the table shipped in the jar. */
    private static synchronized void loadVocabulary() {
        if (vocabulary != null) return;

        Map<String, Integer> built = new HashMap<>();
        try (InputStream raw = KokoroVoice.class
                .getResourceAsStream("/assets/nexusvoice/voice/kokoro-vocab.tsv")) {

            if (raw == null) {
                LOG.error("the phoneme vocabulary is missing from the jar");
                return;
            }

            try (BufferedReader reader = new BufferedReader(
                    new InputStreamReader(raw, StandardCharsets.UTF_8))) {

                String line;
                while ((line = reader.readLine()) != null) {
                    int tab = line.indexOf('\t');
                    if (tab <= 0) continue;
                    built.put(line.substring(tab + 1), Integer.parseInt(line.substring(0, tab)));
                }
            }
        } catch (Exception e) {
            LOG.error("could not read the phoneme vocabulary: {}", e.toString());
            return;
        }

        vocabulary = built;
    }
}
