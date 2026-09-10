package dev.nexuscraft.nexus;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextDecoration;

/**
 * How the server talks.
 *
 * One place, because the fastest way to make a server feel amateur is six
 * different prefixes and four shades of yellow. Everything the player reads
 * comes through here.
 */
public final class Text {

    /** The server's own colour, used for anything it says in its own voice. */
    public static final NamedTextColor BRAND = NamedTextColor.AQUA;

    private Text() {
    }

    public static Component plain(String message) {
        return Component.text(message, NamedTextColor.GRAY);
    }

    /** Something happened and it went well. */
    public static Component good(String message) {
        return Component.text(message, NamedTextColor.GREEN);
    }

    /** Something did not work, said without shouting. */
    public static Component bad(String message) {
        return Component.text(message, NamedTextColor.RED);
    }

    /** The server addressing you directly. */
    public static Component says(String message) {
        return Component.text("Nexus ", BRAND, TextDecoration.BOLD)
                .append(Component.text("» ", NamedTextColor.DARK_GRAY))
                .append(Component.text(message, NamedTextColor.WHITE));
    }

    /** A heading with rules either side, for stats pages and results. */
    public static Component heading(String title) {
        return Component.text("――――――― ", NamedTextColor.DARK_GRAY)
                .append(Component.text(title, BRAND, TextDecoration.BOLD))
                .append(Component.text(" ―――――――", NamedTextColor.DARK_GRAY));
    }

    /** A label and its value, lined up the same way everywhere. */
    public static Component field(String label, String value) {
        return Component.text("  " + label + ": ", NamedTextColor.GRAY)
                .append(Component.text(value, NamedTextColor.WHITE));
    }

    /** Strips italics, which Minecraft adds to every renamed item by default. */
    public static Component item(String name, NamedTextColor colour) {
        return Component.text(name, colour).decoration(TextDecoration.ITALIC, false);
    }

    /** Seconds as m:ss, for timers people are watching closely. */
    /**
     * A rough length of time, in the largest unit that fits.
     *
     * For anything that might run to hours or days, where `clock` would give a
     * four digit minute count. Deliberately only one unit: "2d" is what
     * somebody wants to know, and "2d 7h 13m" is the same answer with more
     * reading.
     */
    public static String roughly(int seconds) {
        if (seconds < 0) seconds = 0;

        if (seconds < 60) return seconds + "s";
        if (seconds < 3600) return (seconds / 60) + "m";
        if (seconds < 86400) return (seconds / 3600) + "h";
        return (seconds / 86400) + "d";
    }

    public static String clock(int seconds) {
        if (seconds < 0) seconds = 0;
        return String.format("%d:%02d", seconds / 60, seconds % 60);
    }
}
