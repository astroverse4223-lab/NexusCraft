package dev.nexuscraft.hollow.director;

/**
 * One thing the companion can do to the world.
 *
 * This enum is the entire vocabulary. The model picks a name from this list and
 * nothing else — it never writes a command, never names a block, never supplies
 * coordinates. That is not a limitation to work around later; it is the only
 * reason it is safe to let a language model drive events in someone's world at
 * all. A model that can emit `/kill @p` eventually will.
 *
 * Each beat carries the earliest act it may appear in. A player who hears
 * breathing on their first night has been told the ending, so the catalogue is
 * gated rather than trusted: even if the model asks for STALK on day one, the
 * director refuses it.
 */
public enum Beat {
    /** Nothing. Deliberately first, and deliberately common — see Director. */
    NONE(Act.COMPANION),

    /** It speaks. The only beat available while it is still just a companion. */
    SPEAK(Act.COMPANION),

    /** A step, a door, a distant cave sound, from somewhere the player is not. */
    SOUND_NEARBY(Act.UNEASE),

    /** It stops mid-conversation and does not answer again for a while. */
    GO_QUIET(Act.UNEASE),

    /** A torch or lantern near the player gives out. */
    SNUFF_LIGHT(Act.UNEASE),

    /** It mentions something true that it was never told. */
    KNOW_TOO_MUCH(Act.UNEASE),

    /** Brief, wrong particles at the edge of vision. */
    GLIMPSE(Act.WATCHING),

    /** It is not behind the player any more. It is ahead of them. */
    STALK(Act.WATCHING),

    /** Something small the player left is not where they left it. */
    MOVE_SOMETHING(Act.WATCHING),

    /** It speaks with the pretence dropped. */
    SPEAK_AS_HOLLOW(Act.HOLLOW),

    /** The lights go, all of them, and it is close. */
    DARKNESS(Act.HOLLOW),

    /**
     * Something else arrives, and the companion stops reacting.
     *
     * The only beat that is not the companion doing something to you. It is the
     * companion allowing something to be done to you, which is why it is last.
     */
    HUNT(Act.HOLLOW);

    public final Act earliest;

    Beat(Act earliest) {
        this.earliest = earliest;
    }

    public boolean allowedIn(Act act) {
        return act.atLeast(earliest);
    }

    public static Beat fromName(String raw) {
        if (raw == null) return NONE;
        String cleaned = raw.trim().toUpperCase();
        for (Beat beat : values()) {
            if (beat.name().equals(cleaned)) return beat;
        }
        // An unrecognised name is the model improvising. Improvisation is what
        // the catalogue exists to prevent, so it becomes nothing at all.
        return NONE;
    }
}
