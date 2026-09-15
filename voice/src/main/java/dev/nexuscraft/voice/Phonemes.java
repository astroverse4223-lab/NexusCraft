package dev.nexuscraft.voice;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Text in, phonemes out. The part of local speech that is actually hard.
 *
 * Kokoro will not read English. It reads a string of IPA symbols, and getting
 * from one to the other — grapheme-to-phoneme — is the whole reason this could
 * not simply be "call the model from Java". The dictionary does the heavy
 * lifting for the 126,000 words somebody has already written down. This handles
 * everything else, in three falling-back layers:
 *
 *   1. Look the word up. Right by construction, and covers most sentences whole.
 *   2. Take the ending off and look up the stem. "creeper" is not in CMUdict and
 *      "creep" is, so the ending is where the answer lives — and this recovers
 *      an enormous number of words for about thirty lines.
 *   3. Sound it out. Crude letter-to-sound rules, for genuinely invented words.
 *      This is the layer that will be wrong occasionally, and it is reached only
 *      by words no dictionary has ever contained.
 *
 * Punctuation is kept, not stripped: Kokoro's vocabulary includes commas, full
 * stops and question marks, and it uses them for phrasing. Dropping them is what
 * makes synthesised speech run on without breathing.
 */
public final class Phonemes {

    /** Endings that can be removed to find a word the dictionary knows. */
    private static final Map<String, String[]> ENDINGS = new LinkedHashMap<>();

    static {
        // ending -> { what to add back, ...alternative stems to try }
        // Longest first, so "-ingly" is tried before "-ly".
        ENDINGS.put("ingly", new String[]{"ɪŋli"});
        ENDINGS.put("ing", new String[]{"ɪŋ"});
        ENDINGS.put("edly", new String[]{"ɪdli"});
        ENDINGS.put("ers", new String[]{"ɚz"});
        ENDINGS.put("er", new String[]{"ɚ"});
        ENDINGS.put("est", new String[]{"ɪst"});
        ENDINGS.put("ness", new String[]{"nəs"});
        ENDINGS.put("less", new String[]{"ləs"});
        ENDINGS.put("ful", new String[]{"fəl"});
        ENDINGS.put("ly", new String[]{"li"});
        ENDINGS.put("ed", new String[]{"d"});
        ENDINGS.put("es", new String[]{"z"});
        ENDINGS.put("s", new String[]{"z"});
    }

    /** Single letters, for spelling out anything that survives everything else. */
    private static final Map<Character, String> LETTERS = new LinkedHashMap<>();

    static {
        LETTERS.put('a', "ˈeɪ"); LETTERS.put('b', "bˈi"); LETTERS.put('c', "sˈi");
        LETTERS.put('d', "dˈi"); LETTERS.put('e', "ˈi"); LETTERS.put('f', "ˈɛf");
        LETTERS.put('g', "ʤˈi"); LETTERS.put('h', "ˈeɪʧ"); LETTERS.put('i', "ˈaɪ");
        LETTERS.put('j', "ʤˈeɪ"); LETTERS.put('k', "kˈeɪ"); LETTERS.put('l', "ˈɛl");
        LETTERS.put('m', "ˈɛm"); LETTERS.put('n', "ˈɛn"); LETTERS.put('o', "ˈoʊ");
        LETTERS.put('p', "pˈi"); LETTERS.put('q', "kjˈu"); LETTERS.put('r', "ˈɑɹ");
        LETTERS.put('s', "ˈɛs"); LETTERS.put('t', "tˈi"); LETTERS.put('u', "jˈu");
        LETTERS.put('v', "vˈi"); LETTERS.put('w', "dˈʌbəljˌu"); LETTERS.put('x', "ˈɛks");
        LETTERS.put('y', "wˈaɪ"); LETTERS.put('z', "zˈi");
    }

    private static final String[] ONES = {
            "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
            "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
            "seventeen", "eighteen", "nineteen"
    };

    private static final String[] TENS = {
            "", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"
    };

    /** Punctuation Kokoro's vocabulary actually has, and uses for phrasing. */
    private static final String KEPT_PUNCTUATION = ";:,.!?—…\"()“”";

    private Phonemes() {
    }

    /**
     * A sentence as Kokoro wants it.
     *
     * Returns an empty string when there is nothing sayable, which the caller
     * should treat as "do not synthesise" rather than as silence.
     */
    public static String of(String text) {
        if (text == null || text.isBlank()) return "";

        StringBuilder out = new StringBuilder();
        for (String token : tokenise(text)) {
            if (token.length() == 1 && KEPT_PUNCTUATION.indexOf(token.charAt(0)) >= 0) {
                // Punctuation joins the previous word rather than floating free.
                out.append(token);
                continue;
            }

            String said = word(token);
            if (said.isEmpty()) continue;

            if (out.length() > 0) out.append(' ');
            out.append(said);
        }

        return out.toString().trim();
    }

    /**
     * Words and punctuation, in order.
     *
     * Apostrophes stay inside words, because "don't" and "it's" are in the
     * dictionary and "don" and "t" are a different sentence.
     */
    private static List<String> tokenise(String text) {
        List<String> tokens = new ArrayList<>();
        StringBuilder word = new StringBuilder();

        for (char raw : text.toCharArray()) {
            char c = Character.toLowerCase(raw);

            if (Character.isLetterOrDigit(c) || c == '\'' || c == '’') {
                word.append(c == '’' ? '\'' : c);
                continue;
            }

            if (word.length() > 0) {
                tokens.add(word.toString());
                word.setLength(0);
            }
            if (KEPT_PUNCTUATION.indexOf(c) >= 0) tokens.add(String.valueOf(c));
        }

        if (word.length() > 0) tokens.add(word.toString());
        return tokens;
    }

    /** One word, by whichever of the three layers can answer. */
    public static String word(String raw) {
        String token = raw.toLowerCase(Locale.ROOT);
        if (token.isEmpty()) return "";

        if (token.chars().allMatch(Character::isDigit)) return number(token);

        String known = Lexicon.lookup(token);
        if (known != null) return known;

        String derived = fromEnding(token);
        if (derived != null) return derived;

        return soundOut(token);
    }

    /**
     * The word without its ending, plus the ending's own sound.
     *
     * "creeper" is not in CMUdict; "creep" is. So is "creeps", "creeping" and
     * most of what people actually type. A dictionary of stems plus a handful
     * of suffixes covers far more English than the dictionary alone.
     */
    private static String fromEnding(String token) {
        for (Map.Entry<String, String[]> ending : ENDINGS.entrySet()) {
            String suffix = ending.getKey();
            if (token.length() <= suffix.length() + 1 || !token.endsWith(suffix)) continue;

            String stem = token.substring(0, token.length() - suffix.length());
            String said = Lexicon.lookup(stem);

            // "running" -> "runn" -> "run"; "hoped" -> "hope".
            if (said == null && stem.length() > 2
                    && stem.charAt(stem.length() - 1) == stem.charAt(stem.length() - 2)) {
                said = Lexicon.lookup(stem.substring(0, stem.length() - 1));
            }
            if (said == null) said = Lexicon.lookup(stem + "e");

            if (said != null) return said + ending.getValue()[0];
        }
        return null;
    }

    /**
     * Sounding out a word nobody has written down.
     *
     * Deliberately simple. Anything reaching here is invented — a username, a
     * mod's name, a word somebody made up — and there is no rule set short of
     * espeak's that gets those right. The aim is only to produce something
     * pronounceable rather than silence, and short strings of consonants get
     * spelled out instead, because that is usually what they are.
     */
    private static String soundOut(String token) {
        if (token.length() <= 3 && token.chars().noneMatch(Phonemes::isVowel)) {
            StringBuilder spelled = new StringBuilder();
            for (char c : token.toCharArray()) {
                String letter = LETTERS.get(c);
                if (letter != null) spelled.append(letter).append(' ');
            }
            return spelled.toString().trim();
        }

        StringBuilder out = new StringBuilder();
        char[] letters = token.toCharArray();
        boolean stressed = false;

        for (int i = 0; i < letters.length; i++) {
            char c = letters[i];
            char next = i + 1 < letters.length ? letters[i + 1] : '\0';
            boolean last = i == letters.length - 1;

            // Digraphs first, or "th" becomes "t" followed by "h".
            if (next != '\0') {
                String pair = "" + c + next;
                String both = switch (pair) {
                    case "th" -> "θ";
                    case "sh" -> "ʃ";
                    case "ch" -> "ʧ";
                    case "ph" -> "f";
                    case "ck" -> "k";
                    case "ng" -> "ŋ";
                    case "qu" -> "kw";
                    case "oo" -> "u";
                    case "ee" -> "i";
                    case "ea" -> "i";
                    case "ai" -> "eɪ";
                    case "ay" -> "eɪ";
                    case "ou" -> "aʊ";
                    case "ow" -> "aʊ";
                    case "oi" -> "ɔɪ";
                    case "oy" -> "ɔɪ";
                    default -> null;
                };
                if (both != null) {
                    if (!stressed && isVowelSound(both)) {
                        out.append("ˈ");
                        stressed = true;
                    }
                    out.append(both);
                    i++;
                    continue;
                }
            }

            String one = switch (c) {
                case 'a' -> "æ";
                case 'e' -> last ? "" : "ɛ";
                case 'i' -> "ɪ";
                case 'o' -> "ɑ";
                case 'u' -> "ʌ";
                case 'y' -> i == 0 ? "j" : "i";
                case 'c' -> (next == 'e' || next == 'i') ? "s" : "k";
                case 'g' -> "ɡ";
                case 'j' -> "ʤ";
                case 'q' -> "k";
                case 'r' -> "ɹ";
                case 'x' -> "ks";
                case '\'' -> "";
                default -> String.valueOf(c);
            };

            if (one.isEmpty()) continue;
            if (!stressed && isVowelSound(one)) {
                out.append("ˈ");
                stressed = true;
            }
            out.append(one);
        }

        return out.toString();
    }

    /**
     * A number, said the way a person says it.
     *
     * Digit by digit is the easy version and it is wrong in the sentence this
     * mod hears most often: "give me 30 gold" came out as "three zero gold".
     * Spelling it into English words first and then looking those up means the
     * dictionary does the pronouncing, so "thirty" is right for the same reason
     * every other word is.
     *
     * Long strings of digits are read out singly on purpose — a coordinate or a
     * seed is not a quantity, and nobody wants to hear "one hundred and twelve
     * million" when Ember mentions where it is standing.
     */
    private static String number(String digits) {
        StringBuilder out = new StringBuilder();

        if (digits.length() <= 4) {
            long value = Long.parseLong(digits);
            for (String part : spell(value).split(" ")) {
                if (part.isBlank()) continue;
                if (out.length() > 0) out.append(' ');
                out.append(word(part));
            }
            return out.toString();
        }

        for (char c : digits.toCharArray()) {
            if (out.length() > 0) out.append(' ');
            out.append(word(ONES[c - '0']));
        }
        return out.toString();
    }

    /** 0 to 9999 in English words. */
    private static String spell(long value) {
        if (value < 20) return ONES[(int) value];

        if (value < 100) {
            long tens = value / 10;
            long rest = value % 10;
            return TENS[(int) tens] + (rest == 0 ? "" : " " + ONES[(int) rest]);
        }

        if (value < 1000) {
            long hundreds = value / 100;
            long rest = value % 100;
            return ONES[(int) hundreds] + " hundred" + (rest == 0 ? "" : " " + spell(rest));
        }

        long thousands = value / 1000;
        long rest = value % 1000;
        return spell(thousands) + " thousand" + (rest == 0 ? "" : " " + spell(rest));
    }

    private static boolean isVowel(int c) {
        return "aeiouy".indexOf(c) >= 0;
    }

    private static boolean isVowelSound(String ipa) {
        return !ipa.isEmpty() && "æɛɪɑʌuiaeoɔʊəɚɜ".indexOf(ipa.charAt(0)) >= 0;
    }
}
