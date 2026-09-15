package dev.nexuscraft.hollow.entity;

import dev.nexuscraft.hollow.director.Act;

/**
 * What the mask is doing with its face.
 *
 * The director already decides this — it has been choosing between "◕‿◕" and
 * "◉_◉" since the first version, and the whole arc is written in those strings.
 * So this does not replace that judgement, it translates it: the same decision,
 * expressed as geometry instead of as punctuation.
 *
 * Which means the arc did not have to be rewritten to give Hollow a face. It
 * already had one; it just had no way to show it.
 */
public enum Expression {

    /** Eyes open, level. The resting face for most of the mod. */
    CALM,

    /** Curved up. The only genuinely warm one, and it stops appearing. */
    PLEASED,

    /** One eye narrowed, head tilted. Used while it waits on the model. */
    THINKING,

    /** Both eyes narrowed. Not hostile yet — just less open than it was. */
    UNEASY,

    /** Wide, round and unblinking. It has stopped looking away. */
    STARING,

    /** Eyes pulled down at the inner corner. The first properly wrong one. */
    ANGRY,

    /**
     * Nothing at all. No eyes, no mouth, a smooth plate.
     *
     * The last act, and the one the whole design is for. Everything else here
     * is a variation on a face; this is the absence of one, and it should read
     * as something being switched off rather than as an expression.
     */
    BLANK;

    public static Expression byId(byte id) {
        Expression[] all = values();
        return id >= 0 && id < all.length ? all[id] : CALM;
    }

    /**
     * The face the director asked for, as geometry.
     *
     * Matched on the characters rather than on an enum because the director
     * writes faces as strings and has done since before there was a model —
     * changing that would mean touching every beat it knows how to play, to fix
     * something that is really only a rendering concern.
     */
    public static Expression of(String face, Act act) {
        if (face == null || face.isBlank()) return restingFor(act);

        // The eyes carry it; the mouth is mostly decoration at this size.
        if (face.contains("╳") || face.contains("☓") || face.equals("•   •")) return BLANK;
        if (face.contains("益") || face.contains("◣") || face.contains("ಠ")) return ANGRY;
        if (face.contains("◉") || face.contains("⊙")) return STARING;
        if (face.contains("◔")) return THINKING;
        if (face.contains("ᴗ") || face.contains("‿")) return act == Act.COMPANION ? PLEASED : CALM;
        if (face.contains("︵")) return UNEASY;

        return restingFor(act);
    }

    /** Where the act sits when nothing more specific is happening. */
    public static Expression restingFor(Act act) {
        return switch (act) {
            case COMPANION -> PLEASED;
            case UNEASE -> CALM;
            case WATCHING -> STARING;
            case HOLLOW -> BLANK;
        };
    }

    /**
     * The colour burning inside the mask, as 0xRRGGBB.
     *
     * The same four colours the name tag used, kept deliberately: aqua while it
     * is a companion, white as that curdles, grey while it watches, red at the
     * end. Anybody who played the old version reads the change without being
     * told, and anybody who did not still sees a light going wrong.
     */
    public static int glowFor(Act act) {
        return switch (act) {
            case COMPANION -> 0x55FFFF;
            case UNEASE -> 0xFFFFFF;
            case WATCHING -> 0xAAAAAA;
            case HOLLOW -> 0xAA0000;
        };
    }
}
