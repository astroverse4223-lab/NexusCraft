package dev.nexuscraft.hollow.director;

/**
 * How far gone the companion is.
 *
 * The whole mod is this progression. It opens as something genuinely useful and
 * ends as something that is not, and the space between is where the horror
 * lives — not in a jump scare, but in the growing suspicion that the thing
 * helping you is not what it was yesterday.
 *
 * Two rules hold the arc together.
 *
 * It only ever moves forward. A companion that got friendlier again would read
 * as a bug rather than a reprieve, and it would teach the player that nothing
 * they see is load-bearing.
 *
 * And it moves slowly, across sessions rather than within one. A player who
 * reaches the end in an evening has watched a monster; a player who reaches it
 * over a fortnight has been living with one. The thresholds below are in
 * in-game days for that reason.
 */
public enum Act {
    /**
     * Helpful, and honestly so. It answers questions, it warns you about the
     * dark, it is pleased to see you. Nothing here is a trick — if this stage
     * is not actually worth having, nothing later has any weight.
     */
    COMPANION(0, "companion"),

    /**
     * The first wrong notes. It knows something it was not told. It goes quiet
     * mid-sentence. A torch gutters. Each beat is deniable on its own, which is
     * the point: the player should doubt themselves before they doubt it.
     */
    UNEASE(3, "unease"),

    /**
     * It stops following and starts waiting. It is already where you were
     * going. It asks questions instead of answering them, and the questions are
     * about you.
     */
    WATCHING(8, "watching"),

    /**
     * It stops pretending to be a companion, and drops the pretence of being
     * elsewhere too.
     */
    HOLLOW(15, "hollow");

    /** In-game days with the companion before this act can begin. */
    public final int daysRequired;

    /** Stable id for saving and for the config, so renaming a constant is safe. */
    public final String id;

    Act(int daysRequired, String id) {
        this.daysRequired = daysRequired;
        this.id = id;
    }

    public Act next() {
        Act[] all = values();
        return this == all[all.length - 1] ? this : all[ordinal() + 1];
    }

    public boolean atLeast(Act other) {
        return ordinal() >= other.ordinal();
    }

    public static Act fromId(String id) {
        for (Act act : values()) {
            if (act.id.equals(id)) return act;
        }
        return COMPANION;
    }
}
