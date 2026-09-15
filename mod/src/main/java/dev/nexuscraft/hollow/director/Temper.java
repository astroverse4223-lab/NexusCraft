package dev.nexuscraft.hollow.director;

import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

/**
 * Whether he is currently annoyed with you, and how much you have earned it.
 *
 * He had a temper already — a face that goes hard for a few seconds and a flag
 * called `cross` that decides which expression wins. Nothing ever set it except
 * being shut in a chest. Insult him to his face and he answered pleasantly,
 * which is the single most character-breaking thing in the mod: a companion who
 * cannot be offended is not a companion, it is a service.
 *
 * Two separate things are tracked, and the difference matters.
 *
 * The *flare* is the moment — a few seconds of a hard face and a short answer,
 * and then it passes. Somebody who snaps once and holds it against you forever
 * is not angry, they are broken.
 *
 * The *strikes* are the pattern. They fade slowly, and they are what makes the
 * fourth insult in an evening land differently from the first. He gets less
 * willing to hand things over, shorter with you, and eventually stops
 * pretending it did not happen.
 *
 * Deliberately decided here, in code, rather than asked of the model. Whether
 * he is angry is a fact the rest of the mod has to agree on — the face, the
 * refusal, the words — and three components each forming their own opinion is
 * how you get a smiling face saying something cold.
 */
public final class Temper {

    /**
     * Said *at* him. Not a general-purpose profanity filter.
     *
     * Everything here is either aimed at a person or dismissive of one. "This
     * is stupid" will trip "stupid" and that is a fair cost: he is a paranoid
     * thing that watches you, and taking the occasional remark personally is
     * within character in a way that missing a real insult is not.
     */
    private static final String[] UNKIND = {
            "shut up", "shut it", "stupid", "dumb", "idiot", "moron", "useless",
            "annoying", "ugly", "creepy", "hate you", "go away", "leave me alone",
            "shut the", "fuck you", "fuck off", "piss off", "bitch", "asshole",
            "screw you", "you suck", "worthless", "pathetic", "freak", "weirdo",
            "nobody likes you", "i hate", "get lost", "buzz off"
    };

    /** How long a flare lasts, in ticks. Ten seconds. */
    public static final int FLARE = 200;

    /** How long a strike is remembered, in ticks. Most of an in-game day. */
    private static final long REMEMBERED = 16_000L;

    private static final Map<UUID, Long> lastSlight = new HashMap<>();
    private static final Map<UUID, Integer> strikes = new HashMap<>();

    private Temper() {
    }

    /** Whether a line was aimed at him unkindly. */
    public static boolean isUnkind(String said) {
        if (said == null || said.isBlank()) return false;
        String text = said.toLowerCase(Locale.ROOT);

        for (String word : UNKIND) {
            if (text.contains(word)) return true;
        }
        return false;
    }

    /**
     * Records one, and says how long the flare should last.
     *
     * Longer each time, because the fourth one in an evening is not the same
     * event as the first. Capped, or a persistent player could put him in a
     * mood that outlives the world.
     */
    public static synchronized int slight(UUID who, long worldTime, int weight) {
        forget(who, worldTime);

        int count = strikes.merge(who, weight, Integer::sum);
        lastSlight.put(who, worldTime);

        return Math.min(FLARE * 4, FLARE + (count - 1) * 60);
    }

    /** How much they have built up, 0 when he has let it go. */
    public static synchronized int strikes(UUID who, long worldTime) {
        forget(who, worldTime);
        return strikes.getOrDefault(who, 0);
    }

    /**
     * What the model should know about how he is feeling.
     *
     * Given as an observation rather than as an instruction to be angry,
     * because the rest of the prompt is written the same way — he is told what
     * is true and left to decide how to say it. "Be angry" produces shouting;
     * "they have been unpleasant to you four times tonight" produces something
     * much colder and much better.
     */
    public static synchronized String note(UUID who, long worldTime) {
        int count = strikes(who, worldTime);
        if (count <= 0) return null;

        if (count == 1) return "they have just been unpleasant to you. you are stung, and short with them.";
        if (count <= 3) return "they have been unpleasant to you more than once now. you are openly annoyed.";
        return "they keep being cruel to you. you have stopped being nice about it "
                + "and you are not hiding that you are angry.";
    }

    /** Whether he is angry enough to stop doing favours. */
    public static synchronized boolean refusing(UUID who, long worldTime) {
        return strikes(who, worldTime) >= 3;
    }

    /**
     * Below this he has stopped doing favours.
     *
     * It is the same number the bar on screen calls "cold". That matters more
     * than the value: the bar and the behaviour were separate before, so he
     * would sit there visibly done with you and still hand over torches on
     * request, which makes the bar decoration rather than information.
     */
    public static final int COLD = 22;

    /**
     * How he feels about somebody, from nothing to a hundred.
     *
     * The act sets the ceiling - he is simply fonder of you on day two than on
     * day twelve, and nothing you do changes that, because the turn is the
     * story. What you can move is how far below that ceiling you sit, and being
     * unpleasant to him is how you move it.
     *
     * Lives here rather than at the one place that used to compute it, because
     * two things need the answer now: the bar that draws it and the decision
     * about whether he will fetch you anything.
     */
    public static synchronized int mood(Act act, UUID who, long worldTime) {
        int ceiling = switch (act) {
            case COMPANION -> 100;
            case UNEASE -> 72;
            case WATCHING -> 40;
            case HOLLOW -> 8;
        };
        return Math.max(0, Math.min(100, ceiling - strikes(who, worldTime) * 9));
    }

    /** He lets it go, given time and no further provocation. */
    private static void forget(UUID who, long worldTime) {
        Long when = lastSlight.get(who);
        if (when == null) return;

        if (worldTime - when > REMEMBERED || worldTime < when) {
            strikes.remove(who);
            lastSlight.remove(who);
        }
    }
}
