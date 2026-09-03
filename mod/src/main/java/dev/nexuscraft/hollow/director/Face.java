package dev.nexuscraft.hollow.director;

import net.minecraft.text.Text;
import net.minecraft.util.Formatting;

import java.util.List;
import java.util.random.RandomGenerator;

/**
 * The face.
 *
 * The companion is a floating face and very little else, which turns out to be
 * the cheapest possible way to carry a whole performance: a smile that is
 * slightly wrong is worse than any model you could animate, and it costs one
 * string. It also means the horror never depends on the player installing
 * anything — a name tag renders on a vanilla client and always turns to face
 * you, which is exactly the behaviour a floating face wants.
 *
 * The arc is written into this file more than anywhere else. In the first act
 * the face is warm and unambiguous. By the last it is still recognisably the
 * same shape — that matters, it should never become a different character —
 * but nothing about it is warm any more.
 */
public final class Face {

    private Face() {}

    /** Ordinary faces for an act, picked from at random while nothing is happening. */
    private static final List<String> COMPANION = List.of("◕‿◕", "◠‿◠", "^‿^", "◕ᴗ◕");

    /**
     * Act two still smiles. That is the point of act two: nothing here is
     * openly wrong, the smile has just stopped reaching the eyes.
     */
    private static final List<String> UNEASE = List.of("◕‿◕", "◔_◔", "◕‿◕", "•‿•", "◕_◕");

    private static final List<String> WATCHING = List.of("◉_◉", "◕_◕", "⊙_⊙", "◉ ◉");

    private static final List<String> HOLLOW = List.of("◉︵◉", "╳_╳", "◉ ︵ ◉", "☓‿☓");

    /** Held for a moment when a beat fires, then it goes back to resting. */
    public static final String THINKING = "◔_◔";
    public static final String PLEASED = "◕ᴗ◕";
    public static final String REFUSING = "◕︵◕";
    public static final String STARING = "◉_◉";

    /**
     * Teeth.
     *
     * The one shape that is never in any resting pool, so it only ever appears
     * because of something the player did — thrown in lava, shut in a chest,
     * asked once too often for the thing he will not give. That is what makes
     * it land: every other face here is weather, and this one is a reaction.
     *
     * 益 is doing the work. It is a Han character, so it renders in Minecraft's
     * font on every platform without shipping a resource pack, and it happens to
     * look exactly like a mouthful of clenched teeth.
     */
    public static final String GRINNING = "◕益◕";

    /** The same teeth with the eyebrows down. Kept for the worst of it. */
    public static final String ANGRY = "◣益◢";

    /** Not angry yet. The look you get before the teeth come out. */
    public static final String ANNOYED = "ಠ_ಠ";

    /**
     * No expression at all, worn while something is hunting the player.
     *
     * Eyes and nothing else. Every other face in this file is doing something —
     * smiling, staring, refusing — and a blank one lands because it is the only
     * time it does nothing. The companion is still right there, still looking at
     * you, and has stopped reacting to what is happening to you.
     *
     * A face that turned angry or frightened here would read as the companion
     * having an opinion about the hunt. It does not have one, and that is worse.
     */
    public static final String BLANK = "•   •";

    public static String resting(Act act, RandomGenerator random) {
        List<String> pool = switch (act) {
            case COMPANION -> COMPANION;
            case UNEASE -> UNEASE;
            case WATCHING -> WATCHING;
            case HOLLOW -> HOLLOW;
        };
        return pool.get(random.nextInt(pool.size()));
    }

    /**
     * The face as it should be rendered.
     *
     * Colour does as much work as the shape. White reads as a UI element and is
     * easy to stop seeing; by the end it is red, and a player who has watched it
     * be white for a week does not need to be told that has changed.
     */
    public static Text render(String face, Act act) {
        Formatting colour = switch (act) {
            case COMPANION -> Formatting.AQUA;
            case UNEASE -> Formatting.WHITE;
            case WATCHING -> Formatting.GRAY;
            case HOLLOW -> Formatting.DARK_RED;
        };
        return Text.literal(face).formatted(colour);
    }
}
