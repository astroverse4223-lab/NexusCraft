package dev.nexuscraft.vigil;

/**
 * How it is standing when you turn around.
 *
 * It never animates. It cannot — it only moves while nobody is watching, so
 * every frame you will ever see of it is a still. That sounds like a limitation
 * and it is actually the best thing about the design: instead of a walk cycle
 * you get a series of tableaux, and the horror is entirely in the cut between
 * them. The thing was upright by the door. Now it is folded almost double, four
 * blocks closer, and you did not see it happen.
 *
 * So the poses are chosen here rather than interpolated anywhere, one per
 * relocation, and they get worse as it gets nearer.
 */
public enum Pose {

    /** Upright, arms down, facing you. The one you see first, at distance. */
    WAITING,

    /** Head canted over hard, as though listening rather than looking. */
    TILTED,

    /** Bent forward at the waist, arms hanging past the knees. */
    STOOPED,

    /** Folded down onto its heels, low and small, watching from below. */
    CROUCHED,

    /** One arm out, reaching, fingers open. Only when it is nearly on you. */
    REACHING,

    /** Both arms raised over the head, filling the doorway. Nearly the end. */
    LOOMING;

    /** Sent to the client as a byte; anything unknown is just standing. */
    public static Pose byId(byte id) {
        Pose[] all = values();
        return id >= 0 && id < all.length ? all[id] : WAITING;
    }

    /**
     * A pose to hold at this distance, given a roll of 0 to 11.
     *
     * Far away it is only ever standing or tilted, which reads as a figure and
     * nothing more — the kind of thing you might talk yourself out of. The
     * postures that admit what it is are held back until it is close enough
     * that talking yourself out of it is not on the table.
     *
     * The roll is handed in rather than drawn here so this file needs nothing
     * from Minecraft at all, and the rule above — which is a design decision
     * and worth defending in a test — can be checked with a bare JVM. Twelve
     * because it divides by three and four both.
     */
    public static Pose pick(double distance, int roll) {
        int spin = Math.floorMod(roll, 12);

        if (distance > 24.0) {
            return spin % 4 == 0 ? TILTED : WAITING;
        }
        if (distance > 10.0) {
            return switch (spin % 3) {
                case 0 -> TILTED;
                case 1 -> STOOPED;
                default -> WAITING;
            };
        }
        if (distance > 4.0) {
            return switch (spin % 4) {
                case 0 -> STOOPED;
                case 1 -> CROUCHED;
                case 2 -> TILTED;
                default -> REACHING;
            };
        }
        return switch (spin % 3) {
            case 0 -> REACHING;
            case 1 -> CROUCHED;
            default -> LOOMING;
        };
    }
}
