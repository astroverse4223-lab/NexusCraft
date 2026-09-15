package dev.nexuscraft.voice;

import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Locale;

/**
 * Says a sentence, then listens to it. Both halves, with no game running.
 *
 * This is the test the local voice was always going to get, and it is a nicer
 * one than it has any right to be: the mod can already speak, so it can produce
 * its own test material. Kokoro says a line, Whisper reads it back, and the two
 * strings are compared. If the loop closes, both halves work and they work on
 * exactly the kind of audio they will meet in play.
 *
 * The comparison is loose on purpose — punctuation and capitals are the
 * transcriber's opinion, not a mistake. What is being checked is whether the
 * words survived, and a word-level score says that far more usefully than an
 * exact match, which would fail on a full stop.
 *
 *   java ... dev.nexuscraft.voice.HearingTest &lt;model dir&gt;
 */
public final class HearingTest {

    /** Things somebody actually says to a companion. */
    private static final String[] LINES = {
            "Follow me, I found something.",
            "Give me thirty gold.",
            "It is dark down here and I do not like it.",
            "Where should I build my house?",
            "Stop following me for a minute.",
            // Ran the invention on inside the same sentence, with no full stop
            // to cut at - the case that killed trimming by spoken length.
            "Can you take me back to my body where I died.",
    };

    private static int failures;
    private static PrintStream out;

    public static void main(String[] args) throws Exception {
        out = new PrintStream(System.out, true, StandardCharsets.UTF_8);

        Path where = Paths.get(args.length > 0 ? args[0] : ".");
        Models.keepIn(where);

        out.println("models in " + where.toAbsolutePath());

        if (!Models.fetch("am_michael")) {
            out.println("FAIL  could not get the speaking model");
            System.exit(1);
        }
        out.println("ok    speaking model ready");

        long began = System.currentTimeMillis();
        if (!Models.fetchHearing()) {
            out.println("FAIL  could not get the listening model");
            System.exit(1);
        }
        out.println("ok    listening model ready (" + (System.currentTimeMillis() - began) + "ms)");

        if (!Whisper.ready()) {
            out.println("FAIL  the listening model would not load");
            System.exit(1);
        }
        out.println("ok    listening session open");
        out.println();

        for (String line : LINES) {
            float[] spoken = KokoroVoice.speak(line, "am_michael", 1.0f);
            if (spoken == null || spoken.length == 0) {
                report(false, line, "(said nothing)", 0.0);
                continue;
            }

            short[] samples = new short[spoken.length];
            for (int i = 0; i < spoken.length; i++) {
                samples[i] = (short) Math.round(
                        Math.max(-1.0f, Math.min(1.0f, spoken[i])) * 32767.0f);
            }

            long listening = System.currentTimeMillis();
            String heard = Whisper.hear(samples, KokoroVoice.SAMPLE_RATE);
            long took = System.currentTimeMillis() - listening;

            double score = overlap(line, heard);
            report(score >= 0.7, line, heard, score);
            out.println("        " + took + "ms");
        }

        out.println();
        out.println(failures == 0 ? "all checks passed" : failures + " FAILED");
        if (failures > 0) System.exit(1);
    }

    /**
     * How many of the words came back, ignoring case and punctuation.
     *
     * Not an exact match: "thirty gold" and "30 gold" are both correct answers
     * and a string comparison calls one of them a bug.
     */
    private static double overlap(String said, String heard) {
        if (heard == null || heard.isBlank()) return 0.0;

        java.util.List<String> wanted = words(said);
        java.util.List<String> got = words(heard);
        if (wanted.isEmpty()) return 0.0;

        int found = 0;
        for (String word : wanted) {
            if (got.contains(word)) found++;
        }
        return (double) found / wanted.size();
    }

    private static java.util.List<String> words(String text) {
        java.util.List<String> out = new java.util.ArrayList<>();
        for (String word : text.toLowerCase(Locale.ROOT).split("[^a-z0-9]+")) {
            if (!word.isBlank()) out.add(word);
        }
        return out;
    }

    private static void report(boolean ok, String said, String heard, double score) {
        if (!ok) failures++;
        out.printf("%-5s %.0f%%  \"%s\"%n", ok ? "ok" : "FAIL", score * 100, said);
        out.printf("        heard: \"%s\"%n", heard);
    }
}
