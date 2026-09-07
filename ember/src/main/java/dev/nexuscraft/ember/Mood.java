package dev.nexuscraft.ember;

/**
 * Everything Ember has instead of a face.
 *
 * Hollow is a face with no body. Ember is the inversion: a body with no face at
 * all, so every feeling has to arrive as light, posture and motion. The flame
 * carries colour, the shutters carry openness, and the hands carry agitation —
 * between them there is more range than a mouth would have given, and none of
 * it needs a texture swap.
 */
public enum Mood {
    /** Nothing is wrong. Amber, shutters half open, slow drift. */
    CONTENT(0),

    /** Something hostile is near. White and flaring, shutters thrown wide. */
    ALERT(1),

    /** The player is hurt. Blue and guttering, shutters drawn in close. */
    WORRIED(2),

    /** It was hit, by the one it follows. Shutters closed, no light at all. */
    SULKING(3);

    private final byte id;

    Mood(int id) {
        this.id = (byte) id;
    }

    public byte id() {
        return id;
    }

    public static Mood byId(byte id) {
        for (Mood mood : values()) {
            if (mood.id == id) return mood;
        }
        return CONTENT;
    }

    /**
     * How far the shutters stand open, 0 shut to 1 wide.
     *
     * Read by the model as an angle and by the lighting as a radius, so the one
     * number keeps what you see and what it does in step — a sulking Ember is
     * visibly shut and genuinely stops lighting the room.
     */
    public float openness() {
        return switch (this) {
            case CONTENT -> 0.55f;
            case ALERT -> 1.0f;
            case WORRIED -> 0.3f;
            case SULKING -> 0.0f;
        };
    }
}
