package dev.nexuscraft.voice;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Set;
import java.util.zip.GZIPInputStream;

/**
 * Turning English into phonemes, checked with nothing but a JVM.
 *
 * This is the piece that decides whether a local voice is possible at all.
 * Kokoro reads a fixed 115-symbol alphabet and nothing else, so there are two
 * separate questions and this asks both:
 *
 *   Does it produce the right sounds? Checked against words whose pronunciation
 *   is not in doubt, plus the ones the dictionary does not have and the fallback
 *   has to derive.
 *
 *   Does it produce only *legal* sounds? Every one of the 126,066 dictionary
 *   entries is swept for a symbol outside the vocabulary. One stray character —
 *   an ASCII "g" instead of the script ɡ, say — would be a token the model has
 *   never seen, and the failure would arrive as mangled audio rather than as an
 *   error. That check is worth more than all the others together.
 *
 * Run:  bash tools/run-tests.sh
 */
public final class PhonemeTest {

    private static int failures;
    private static PrintStream out;

    public static void main(String[] args) throws Exception {
        // IPA does not survive a Windows console's default encoding.
        out = new PrintStream(System.out, true, StandardCharsets.UTF_8);

        Set<String> vocabulary = vocabulary();
        out.println("vocabulary: " + vocabulary.size() + " symbols");
        out.println("dictionary: " + Lexicon.size() + " words");
        out.println();

        /* ------------------------------------------- straight from the book */

        // The stress mark sits in front of the vowel, after the onset
        // consonants — dˈɑɹk, not ˈdɑɹk. That is espeak's convention, and
        // espeak generated the phonemes Kokoro was trained on.

        says("hello", "həlˈoʊ");
        says("lantern", "lˈæntɚn");
        says("tunnel", "tˈʌnəl");
        says("diamond", "dˈaɪmənd");
        says("dark", "dˈɑɹk");

        /* -------------------------------- words no English dictionary has */

        says("netherite", "nˈɛðəɹaɪt");
        says("creeper", "kɹˈipɚ");

        /* ------------------------------- derived by taking the ending off */

        // None of these are in CMUdict; all of their stems are.
        derived("mineshafts");
        derived("torchlit");
        derived("unlit");

        /* ----------------------------------------------- whole sentences */

        sentence("It is dark down here, and I am the light.");
        sentence("I found a cave to the north. Follow me.");
        sentence("Give me 30 gold.");
        sentence("64 cobblestone, and 7 torches.");
        sentence("You died at 1247, 63, -890.");

        /* -------------------------------- nothing outside the alphabet */

        legal("every word in the dictionary", vocabulary);

        out.println();
        out.println(failures == 0 ? "all checks passed" : failures + " FAILED");
        if (failures > 0) System.exit(1);
    }

    /** The 115 symbols Kokoro's tokenizer will accept, from the shipped table. */
    private static Set<String> vocabulary() throws Exception {
        Set<String> symbols = new HashSet<>();
        try (InputStream raw = PhonemeTest.class.getResourceAsStream("/assets/nexusvoice/voice/kokoro-vocab.tsv");
             BufferedReader reader = new BufferedReader(
                     new InputStreamReader(raw, StandardCharsets.UTF_8))) {

            String line;
            while ((line = reader.readLine()) != null) {
                int tab = line.indexOf('\t');
                if (tab > 0) symbols.add(line.substring(tab + 1));
            }
        }
        return symbols;
    }

    private static void says(String word, String expected) {
        String got = Phonemes.word(word);
        report(expected.equals(got), word + " -> " + got
                + (expected.equals(got) ? "" : "  (expected " + expected + ")"));
    }

    /** Not in the dictionary, and the fallback found something for it. */
    private static void derived(String word) {
        boolean inBook = Lexicon.lookup(word) != null;
        String got = Phonemes.word(word);
        report(!inBook && got != null && !got.isBlank(),
                word + " -> " + got + (inBook ? "  (unexpectedly in the dictionary)" : "  (derived)"));
    }

    private static void sentence(String text) {
        String got = Phonemes.of(text);
        report(!got.isBlank(), "\"" + text + "\"");
        out.println("        " + got);
    }

    /**
     * Every symbol produced for every word is one the model knows.
     *
     * Swept over the whole dictionary rather than a sample, because this is
     * exactly the kind of fault that hides in the one entry nobody thought of.
     */
    private static void legal(String what, Set<String> vocabulary) throws Exception {
        int checked = 0;
        int bad = 0;
        Set<String> offenders = new HashSet<>();

        try (InputStream raw = PhonemeTest.class.getResourceAsStream("/assets/nexusvoice/voice/lexicon.tsv.gz");
             BufferedReader reader = new BufferedReader(new InputStreamReader(
                     new GZIPInputStream(raw), StandardCharsets.UTF_8))) {

            String line;
            while ((line = reader.readLine()) != null) {
                int tab = line.indexOf('\t');
                if (tab <= 0) continue;

                String phonemes = line.substring(tab + 1);
                checked++;

                for (int i = 0; i < phonemes.length(); i++) {
                    String symbol = String.valueOf(phonemes.charAt(i));
                    if (vocabulary.contains(symbol)) continue;

                    bad++;
                    if (offenders.size() < 12) {
                        offenders.add(symbol + " (U+" + String.format("%04X", (int) phonemes.charAt(i))
                                + ") in " + line.substring(0, tab));
                    }
                    break;
                }
            }
        }

        report(bad == 0, what + ": " + checked + " checked, " + bad + " with illegal symbols");
        for (String offender : offenders) out.println("        " + offender);
    }

    private static void report(boolean ok, String what) {
        if (!ok) failures++;
        out.printf("%-5s %s%n", ok ? "ok" : "FAIL", what);
    }
}
