package dev.nexuscraft.voice;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.zip.GZIPInputStream;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * How words are said, looked up rather than worked out.
 *
 * 126,066 English words with their stress marked, converted from CMUdict at
 * build time into the exact IPA symbols Kokoro's tokenizer accepts. See
 * tools/makelexicon.py for the conversion and why it lives there.
 *
 * Loaded on first use and kept — about 13MB of heap for the whole language,
 * which is less than one chunk of terrain and buys every word being right
 * rather than guessed. Nothing loads it unless the local voice is actually
 * switched on.
 *
 * Takes its own logger rather than Ember's. Touching Ember.LOG would initialise
 * the Ember class, which registers entity types into Minecraft's registries as
 * static fields — so a plain JVM checking the pronunciation of "creeper" would
 * boot half the game and fail. Nothing in this package may reach back into the
 * mod's main class, and that is what keeps it testable.
 */
public final class Lexicon {

    private static final Logger LOG = LoggerFactory.getLogger("Ember");

    private static final String RESOURCE = "/assets/nexusvoice/voice/lexicon.tsv.gz";

    private static Map<String, String> words;
    private static boolean tried;

    private Lexicon() {
    }

    /** The phonemes for a word, or null if it is not in the dictionary. */
    public static synchronized String lookup(String word) {
        load();
        return words == null ? null : words.get(word);
    }

    public static synchronized int size() {
        load();
        return words == null ? 0 : words.size();
    }

    private static void load() {
        if (tried) return;
        tried = true;

        long began = System.currentTimeMillis();
        Map<String, String> built = new HashMap<>(160_000);

        try (InputStream raw = Lexicon.class.getResourceAsStream(RESOURCE)) {
            if (raw == null) {
                LOG.error("the pronunciation dictionary is missing from the jar at {}", RESOURCE);
                return;
            }

            try (BufferedReader reader = new BufferedReader(
                    new InputStreamReader(new GZIPInputStream(raw), StandardCharsets.UTF_8))) {

                String line;
                while ((line = reader.readLine()) != null) {
                    int tab = line.indexOf('\t');
                    if (tab <= 0) continue;
                    built.put(line.substring(0, tab), line.substring(tab + 1));
                }
            }
        } catch (Exception e) {
            LOG.error("could not read the pronunciation dictionary: {}", e.toString());
            return;
        }

        words = built;
        LOG.info("pronunciation dictionary: {} words in {}ms",
                built.size(), System.currentTimeMillis() - began);
    }
}
