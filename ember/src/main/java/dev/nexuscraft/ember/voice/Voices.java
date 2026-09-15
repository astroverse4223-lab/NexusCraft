package dev.nexuscraft.ember.voice;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * The voices Ember can be given, for the command to offer.
 *
 * A written-down list rather than one asked for over the network, for two
 * reasons. Tab completion has to answer instantly and on the same thread, which
 * rules out an HTTP round trip; and the direction of travel is for the mod to
 * stop needing anything of ours to be running, so a list that only exists while
 * our launcher is open is the wrong shape.
 *
 * Nothing here is enforced. Any name typed at the command is accepted and sent
 * on as given, so a speech engine with its own voices still works — these are
 * suggestions, not a whitelist, and the mod has no business being the authority
 * on what some other program can say.
 *
 * The grades are not opinions. Kokoro ships a quality grade for every voice,
 * and they are worth showing, because they are startling: they run from A down
 * to F+, and the voice this mod shipped with as its default — af_sky — is a
 * C-. Nobody would guess that from the name, and nobody is going to audition
 * twenty-eight voices to find out.
 */
public final class Voices {

    /** One voice: how it sounds, and what its author thinks of it. */
    public record Voice(String id, String grade, String sounds) {
    }

    private static final List<Voice> ALL = new ArrayList<>();

    /** Voice id to entry, in the order they should be shown. */
    public static final Map<String, Voice> KNOWN = new LinkedHashMap<>();

    private static void add(String id, String grade, String sounds) {
        Voice voice = new Voice(id, grade, sounds);
        ALL.add(voice);
        KNOWN.put(id, voice);
    }

    static {
        // Best grade first inside each group, so the good ones are seen first.

        // American, female.
        add("af_heart", "A", "warm and unhurried — the best of them by some way");
        add("af_bella", "A-", "low and deliberate, a little amused");
        add("af_nicole", "B-", "soft and close, almost whispered");
        add("af_aoede", "C+", "clear and even");
        add("af_kore", "C+", "brighter, quicker");
        add("af_sarah", "C+", "plain and steady");
        add("af_alloy", "C", "flat and matter-of-fact");
        add("af_nova", "C", "crisp, a touch formal");
        add("af_sky", "C-", "light and dry; what Ember shipped with");
        add("af_jessica", "D", "young and conversational, and rough with it");
        add("af_river", "D", "slow and level, and thin");

        // American, male.
        add("am_fenrir", "C+", "deep and gravelly — the best male voice here");
        add("am_michael", "C+", "steady and easy");
        add("am_puck", "C+", "quick and playful");
        add("am_echo", "D", "quiet and distant");
        add("am_eric", "D", "brisk and clipped");
        add("am_liam", "D", "young and friendly");
        add("am_onyx", "D", "dark and slow");
        add("am_santa", "D-", "old, warm and ridiculous");
        add("am_adam", "F+", "flat and unbothered, and genuinely bad");

        // British, female.
        add("bf_emma", "B-", "measured and well-spoken — the best British voice");
        add("bf_isabella", "C", "richer, a little theatrical");
        add("bf_alice", "D", "light and precise, but brittle");
        add("bf_lily", "D", "small and gentle, and unsteady");

        // British, male.
        add("bm_fable", "C", "storytelling, unhurried");
        add("bm_george", "C", "dry and weathered — suits a lantern");
        add("bm_lewis", "D+", "lower and rougher");
        add("bm_daniel", "D", "even and professional, and dull");
    }

    private Voices() {
    }

    /** Every voice, in the order they should be listed. */
    public static List<Voice> all() {
        return ALL;
    }

    /** The entry for a name, or null when it is one we do not know. */
    public static Voice find(String voice) {
        return voice == null ? null : KNOWN.get(voice.toLowerCase(Locale.ROOT).trim());
    }

    /**
     * Where a voice is from, read straight off the name.
     *
     * Kokoro's ids carry it in the first two letters — "af" is American female,
     * "bm" British male — which is worth unpacking in the list rather than
     * leaving as a prefix people have to be told about.
     */
    public static String origin(String voice) {
        if (voice == null || voice.length() < 2) return "";
        String where = switch (voice.charAt(0)) {
            case 'a' -> "American";
            case 'b' -> "British";
            default -> "";
        };
        String who = switch (voice.charAt(1)) {
            case 'f' -> "female";
            case 'm' -> "male";
            default -> "";
        };
        return (where + " " + who).trim();
    }
}
