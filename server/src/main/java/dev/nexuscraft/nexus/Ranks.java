package dev.nexuscraft.nexus;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.entity.Player;

import java.util.Locale;

/**
 * Who somebody is, in one word before their name.
 *
 * Ranks are the cheapest status a server has and they do a lot of work: they
 * make the chat legible at a glance, they give people something to want, and
 * they tell a new player instantly who is worth listening to. Five is enough —
 * a ladder with fifteen rungs means nothing at any of them.
 *
 * Stored on the player's record rather than in a permissions plugin, so the
 * server has no dependencies and an operator can hand one out with a command.
 */
public enum Ranks {

    /** Everyone, on arrival. Deliberately has no tag at all. */
    PLAYER("", NamedTextColor.GRAY, 0),

    VIP("VIP", NamedTextColor.GREEN, 1),
    MVP("MVP", NamedTextColor.AQUA, 2),

    /** Runs the place day to day. */
    ADMIN("ADMIN", NamedTextColor.RED, 3),

    /** Owns it. */
    OWNER("OWNER", NamedTextColor.GOLD, 4);

    public final String tag;
    public final NamedTextColor colour;

    /** Higher sorts first in the player list and outranks in commands. */
    public final int weight;

    Ranks(String tag, NamedTextColor colour, int weight) {
        this.tag = tag;
        this.colour = colour;
        this.weight = weight;
    }

    public static Ranks of(String name) {
        if (name == null) return PLAYER;
        try {
            return valueOf(name.toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException unknown) {
            return PLAYER;
        }
    }

    /** The name as it appears in chat and above the head. */
    public Component nameOf(Player player) {
        Component name = Component.text(player.getName(), colour);
        if (tag.isEmpty()) return name;

        return Component.text("[" + tag + "] ", colour).append(name);
    }

    /**
     * The tab list sorts alphabetically by team name, so the sort key is the
     * rank weight inverted and then the player's name — which puts staff at the
     * top without anybody having to maintain an order by hand.
     */
    public String sortKey(String playerName) {
        return (char) ('a' + (OWNER.weight - weight)) + playerName.toLowerCase(Locale.ROOT);
    }
}
