package dev.nexuscraft.voice;

import ai.onnxruntime.OnnxTensor;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtSession;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.FloatBuffer;
import java.nio.LongBuffer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Whisper, running inside Minecraft. Listening with nothing installed.
 *
 * The other half of the local voice. Speaking has been in-process for a while;
 * hearing still went out over HTTP to whatever was answering on port 8880,
 * which in practice meant the launcher had to be open for a microphone to do
 * anything at all — and a companion you can only talk to while a second program
 * is running is not really one you can talk to.
 *
 * Two graphs. The encoder turns thirty seconds of sound into 1500 vectors, once.
 * The decoder then produces the sentence one token at a time, each pass fed the
 * token before it and the attention cache from the pass before that — which is
 * why the model has forty inputs and why most of the code below is bookkeeping
 * rather than arithmetic.
 *
 * Greedy, deliberately. Beam search would find a slightly better sentence for
 * several times the work, and the sentence in question is "put a torch here".
 */
public final class Whisper {

    private static final Logger LOG = LoggerFactory.getLogger("NexusVoice");

    /** Whisper's own special tokens, from the tokenizer this ships with. */
    private static final long START = 50257;   // <|startoftranscript|>
    private static final long END = 50256;     // <|endoftext|>

    private static final long NO_TIMESTAMPS = 50362;

    /**
     * How sure the model has to be before a word is believed.
     *
     * This exists because of a specific, unavoidable problem: the model takes
     * exactly thirty seconds of audio, so a two-second sentence arrives padded
     * with twenty-eight seconds of silence - and Whisper transcribes silence
     * rather than ignoring it. "Give me thirty gold" came back as "Give me 30
     * gold. Or get our theme video."
     *
     * Two fixes were tried and both were wrong. Timestamps are the principled
     * one and do not work here: real Whisper forces timestamp tokens with logit
     * rules during decoding, and plain greedy argmax never picks one - the
     * model emitted none at all. Trimming by how long somebody spoke works only
     * while the invention starts a new sentence; asked "can you take me back to
     * my body where I died", it ran the fiction on inside the same sentence and
     * there was nothing to cut on.
     *
     * What does separate them is the model's own confidence. Measured over the
     * test sentences, real speech runs 0.6 to 1.0 while invented speech runs
     * 0.05 to 0.5 - and although the odd invented word scores well, a run of
     * four never does.
     */
    private static final double SURE = 0.55;

    /**
     * How many tokens are judged together.
     *
     * One at a time is too jumpy in both directions: a mumbled real word dips
     * below the line, and an invented one lands on a confident "me". Four in a
     * row is enough that neither decides anything on its own.
     */
    private static final int WINDOW = 4;

    /** The first id that is a marker rather than text. */
    private static final long FIRST_SPECIAL = 50256;

    /** Layers and heads, from config.json. Shapes the cache. */
    private static final int LAYERS = 4;
    private static final int HEADS = 6;
    private static final int HEAD_WIDTH = 64;

    /** Long enough for anything anybody says to a companion. */
    private static final int MOST_TOKENS = 180;

    private static OrtEnvironment environment;
    private static OrtSession encoder;
    private static OrtSession decoder;

    private static Map<Integer, String> vocabulary;
    private static int[] fromUnicode;

    private Whisper() {
    }

    /* ---------------------------------------------------------- the models */

    /** Whether it is ready, loading it if the files are there. */
    public static synchronized boolean ready() {
        if (decoder != null) return true;

        try {
            if (!Files.isRegularFile(Models.whisperEncoder())
                    || !Files.isRegularFile(Models.whisperDecoder())) {
                return false;
            }

            long began = System.currentTimeMillis();
            environment = OrtEnvironment.getEnvironment();

            OrtSession.SessionOptions options = new OrtSession.SessionOptions();
            /*
             * Two threads, for the same reason Kokoro gets two: this runs while
             * somebody is playing a game on the same machine, and the default
             * is one thread per core.
             */
            options.setIntraOpNumThreads(2);
            options.setInterOpNumThreads(1);

            encoder = environment.createSession(Models.whisperEncoder().toString(), options);
            decoder = environment.createSession(Models.whisperDecoder().toString(), options);

            loadVocabulary();

            LOG.info("listening model loaded in {}ms", System.currentTimeMillis() - began);
            return vocabulary != null;
        } catch (Throwable e) {
            // Throwable: a missing native arrives as an Error, not an Exception.
            LOG.error("could not load the listening model: {}", e.toString());
            encoder = null;
            decoder = null;
            return false;
        }
    }

    /* ---------------------------------------------------------- listening */

    /**
     * What somebody said, or null.
     *
     * Takes samples at whatever rate they arrived at — voice chat hands over
     * 48kHz and the model wants 16kHz, and that conversion belongs here rather
     * than in every caller.
     */
    public static synchronized String hear(short[] samples, int sampleRate) {
        if (samples == null || samples.length == 0) return null;
        if (!ready()) return null;

        try {
            float[] audio = new float[samples.length];
            for (int i = 0; i < samples.length; i++) audio[i] = samples[i] / 32768.0f;

            float[] mel = Mel.spectrogram(Mel.resample(audio, sampleRate));

            float[] encoded = encode(mel);
            if (encoded == null) return null;

            return decode(encoded);
        } catch (Throwable e) {
            LOG.error("could not transcribe: {}", e.toString());
            return null;
        }
    }

    /** Thirty seconds of sound to 1500 vectors, once per utterance. */
    private static float[] encode(float[] mel) throws Exception {
        try (OnnxTensor features = OnnxTensor.createTensor(environment,
                FloatBuffer.wrap(mel), new long[]{1, Mel.BANDS, Mel.FRAMES});
             OrtSession.Result result = encoder.run(Map.of("input_features", features))) {

            Object value = result.get(0).getValue();
            if (!(value instanceof float[][][] batched)) {
                LOG.error("the encoder returned {}", value == null ? "nothing" : value.getClass());
                return null;
            }

            float[][] states = batched[0];
            float[] flat = new float[states.length * states[0].length];

            int at = 0;
            for (float[] row : states) {
                System.arraycopy(row, 0, flat, at, row.length);
                at += row.length;
            }
            return flat;
        }
    }

    /**
     * The sentence, one token at a time.
     *
     * The first pass sees the whole prompt and an empty cache; every pass after
     * sees one token and the cache from before. That distinction is what
     * `use_cache_branch` selects, and getting it the wrong way round produces a
     * model that re-reads its own prompt forever and never finishes a sentence.
     */
    private static String decode(float[] encoded) throws Exception {
        int frames = encoded.length / 384;

        List<Long> produced = new ArrayList<>();
        List<Double> sureness = new ArrayList<>();
        List<Long> prompt = new ArrayList<>(List.of(START, NO_TIMESTAMPS));

        Map<String, Cached> cache = new HashMap<>();
        boolean first = true;

        for (int step = 0; step < MOST_TOKENS; step++) {
            long[] ids = first
                    ? prompt.stream().mapToLong(Long::longValue).toArray()
                    : new long[]{produced.get(produced.size() - 1)};

            Map<String, OnnxTensor> inputs = new LinkedHashMap<>();
            try {
                inputs.put("input_ids", OnnxTensor.createTensor(environment,
                        LongBuffer.wrap(ids), new long[]{1, ids.length}));
                inputs.put("encoder_hidden_states", OnnxTensor.createTensor(environment,
                        FloatBuffer.wrap(encoded), new long[]{1, frames, 384}));
                inputs.put("use_cache_branch", OnnxTensor.createTensor(environment,
                        java.nio.ByteBuffer.wrap(new byte[]{(byte) (first ? 0 : 1)}),
                        new long[]{1}, ai.onnxruntime.OnnxJavaType.BOOL));

                /*
                 * The cache is fed back exactly as it came out.
                 *
                 * An earlier version worked the lengths out from the tokens so
                 * far and from the encoder's frame count, which is right in
                 * theory and wrong in practice: this export emits some of the
                 * present tensors empty on the first pass, and a length that
                 * disagrees with the data is an index error rather than a bad
                 * transcript. Whatever the model handed back, with whatever
                 * length it had, goes straight back in.
                 */
                for (int layer = 0; layer < LAYERS; layer++) {
                    put(inputs, "past_key_values." + layer + ".decoder.key", cache);
                    put(inputs, "past_key_values." + layer + ".decoder.value", cache);
                    put(inputs, "past_key_values." + layer + ".encoder.key", cache);
                    put(inputs, "past_key_values." + layer + ".encoder.value", cache);
                }

                try (OrtSession.Result result = decoder.run(inputs)) {
                    double[] sure = new double[1];
                    long next = pick(result, sure);
                    if (next == END) break;

                    produced.add(next);
                    sureness.add(sure[0]);
                    remember(result, cache);
                    first = false;
                }
            } finally {
                for (OnnxTensor tensor : inputs.values()) tensor.close();
            }
        }

        return text(believed(produced, sureness));
    }

    /**
     * The most likely next token, and how sure the model was of it.
     *
     * The probability is a softmax over the logits, shifted by the largest
     * before exponentiating - without that shift a confident step overflows to
     * infinity and every token comes back equally certain.
     */
    private static long pick(OrtSession.Result result, double[] confidence) throws Exception {
        float[][][] logits = (float[][][]) result.get(0).getValue();
        float[] last = logits[0][logits[0].length - 1];

        int best = 0;
        for (int i = 1; i < last.length; i++) {
            if (last[i] > last[best]) best = i;
        }

        double total = 0.0;
        for (float value : last) total += Math.exp(value - last[best]);
        confidence[0] = 1.0 / total;

        return best;
    }

    /** One cached tensor, and how long it actually is. */
    private record Cached(float[] data, int length) {
    }

    /**
     * Keeps the attention cache for the next pass.
     *
     * Empty tensors are kept as empty rather than skipped. The model emits some
     * of them with a zero length and expects them back that way; dropping them
     * would mean the next pass invents a length for a tensor the model has
     * already told us the size of.
     */
    private static void remember(OrtSession.Result result, Map<String, Cached> cache) throws Exception {
        for (var entry : result) {
            String name = entry.getKey();
            if (!name.startsWith("present.")) continue;

            Object value = entry.getValue().getValue();
            if (!(value instanceof float[][][][] shaped) || shaped.length == 0) continue;

            cache.put("past_key_values." + name.substring("present.".length()), flatten(shaped));
        }
    }

    private static void put(Map<String, OnnxTensor> inputs, String name,
                            Map<String, Cached> cache) throws Exception {

        Cached held = cache.get(name);
        float[] data = held == null ? new float[0] : held.data();
        int length = held == null ? 0 : held.length();

        inputs.put(name, OnnxTensor.createTensor(environment, FloatBuffer.wrap(data),
                new long[]{1, HEADS, length, HEAD_WIDTH}));
    }

    private static Cached flatten(float[][][][] shaped) {
        float[][][] batch = shaped[0];
        int heads = batch.length;
        if (heads == 0) return new Cached(new float[0], 0);

        int length = batch[0].length;
        if (length == 0) return new Cached(new float[0], 0);

        int width = batch[0][0].length;

        float[] flat = new float[heads * length * width];
        int at = 0;
        for (float[][] head : batch) {
            for (float[] row : head) {
                System.arraycopy(row, 0, flat, at, width);
                at += width;
            }
        }
        return new Cached(flat, length);
    }

    /* ------------------------------------------------------------- the text */

    /**
     * Token ids back into a sentence.
     *
     * Whisper writes text as bytes disguised as printable characters — a space
     * is "Ġ" — so the pieces are joined, mapped back to bytes, and read as
     * UTF-8. Doing it per token instead breaks any character that spans two of
     * them, which in English is mostly punctuation nobody notices until an
     * apostrophe comes out as two question marks.
     */
    private static String text(List<Long> tokens) {
        StringBuilder joined = new StringBuilder();

        for (long token : tokens) {
            // Markers and timestamps are structure, not words.
            if (token >= FIRST_SPECIAL) continue;
            String piece = vocabulary.get((int) token);
            if (piece != null) joined.append(piece);
        }

        byte[] bytes = new byte[joined.length()];
        int at = 0;
        for (int i = 0; i < joined.length(); i++) {
            int mapped = fromUnicode[joined.charAt(i) & 0xFFFF];
            if (mapped >= 0) bytes[at++] = (byte) mapped;
        }

        return new String(bytes, 0, at, StandardCharsets.UTF_8).trim();
    }

    /**
     * Drops whatever the model invented for the silence.
     *
     * Cuts at the first token that is both unsure itself and sits at the head
     * of an unsure run. Both halves matter: the run alone would cut a sentence
     * short at a confident word that happens to precede a mumble, and the
     * single token alone would cut at the one uncertain word in an otherwise
     * clear sentence.
     *
     * A cut is never made in the last couple of tokens. Whisper is routinely
     * unsure about a closing full stop, and dropping it gains nothing while
     * making the transcript look truncated.
     */
    private static List<Long> believed(List<Long> tokens, List<Double> sureness) {
        int count = tokens.size();

        for (int i = 0; i < count - 1; i++) {
            if (sureness.get(i) >= SURE) continue;

            double total = 0.0;
            int seen = 0;
            for (int j = i; j < Math.min(count, i + WINDOW); j++) {
                total += sureness.get(j);
                seen++;
            }

            if (total / seen < SURE) return tokens.subList(0, i);
        }

        return tokens;
    }

    private static void loadVocabulary() throws Exception {
        Map<Integer, String> built = new HashMap<>(60_000);

        try (InputStream raw = Whisper.class.getResourceAsStream(
                "/assets/nexusvoice/voice/whisper-vocab.tsv.gz")) {

            if (raw == null) {
                LOG.error("the listening vocabulary is missing from the jar");
                return;
            }

            try (BufferedReader reader = new BufferedReader(new InputStreamReader(
                    new java.util.zip.GZIPInputStream(raw), StandardCharsets.UTF_8))) {

                String line;
                while ((line = reader.readLine()) != null) {
                    int tab = line.indexOf('\t');
                    if (tab <= 0) continue;
                    built.put(Integer.parseInt(line.substring(0, tab)), line.substring(tab + 1));
                }
            }
        }

        vocabulary = built;
        fromUnicode = byteMap();
    }

    /**
     * GPT-2's byte-to-character table, reversed.
     *
     * Every byte gets a printable character so that a tokenizer built for text
     * can carry arbitrary bytes. The 188 that are already printable map to
     * themselves; the rest are pushed up past 256 in order.
     */
    private static int[] byteMap() {
        int[] reverse = new int[65_536];
        java.util.Arrays.fill(reverse, -1);

        List<Integer> printable = new ArrayList<>();
        for (int b = '!'; b <= '~'; b++) printable.add(b);
        for (int b = 0xA1; b <= 0xAC; b++) printable.add(b);
        for (int b = 0xAE; b <= 0xFF; b++) printable.add(b);

        List<Integer> characters = new ArrayList<>(printable);

        int extra = 0;
        for (int b = 0; b < 256; b++) {
            if (printable.contains(b)) continue;
            printable.add(b);
            characters.add(256 + extra++);
        }

        for (int i = 0; i < printable.size(); i++) {
            reverse[characters.get(i)] = printable.get(i);
        }
        return reverse;
    }
}
