package dev.nexuscraft.ember;

/**
 * What Ember is doing with itself.
 *
 * A lantern that only ever trails behind you is scenery. Being able to take
 * hold of it, and to throw it into a room you do not want to walk into yet,
 * turns it into a tool as well as company — and it is the thing people
 * remember about a companion they can physically handle.
 */
public enum Carry {

    /** The normal state: hovering at the shoulder. */
    FOLLOWING(0),

    /** Held, hanging at the hand, moving with the player. */
    CARRIED(1),

    /** In the air, on its way to wherever it was aimed. */
    THROWN(2),

    /**
     * Landed, and working.
     *
     * It lights hard from where it sits rather than drifting back at once,
     * which is the whole point of throwing it into a dark room.
     */
    PLANTED(3),

    /** Coming home, ignoring everything else on the way. */
    RETURNING(4);

    private final byte id;

    Carry(int id) {
        this.id = (byte) id;
    }

    public byte id() {
        return id;
    }

    public static Carry byId(byte id) {
        for (Carry state : values()) {
            if (state.id == id) return state;
        }
        return FOLLOWING;
    }

    /** Whether the ordinary follow-the-shoulder steering applies. */
    public boolean follows() {
        return this == FOLLOWING;
    }
}
