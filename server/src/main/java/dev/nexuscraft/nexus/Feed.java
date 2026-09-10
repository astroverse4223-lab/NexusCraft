package dev.nexuscraft.nexus;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Sound;
import org.bukkit.entity.Player;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * The moments worth everybody seeing.
 *
 * A server with three people on feels empty even when all three are busy,
 * because none of them can see what the others are doing - somebody digs up a
 * hoard, ranks out of the mines, wins a duel, and the only person who knows is
 * them. Twenty-nine separate broadcasts already existed across the plugin and
 * none of them agreed on wording, colour, or whether Discord heard about it.
 *
 * This is the one road out. Anything notable goes through here, comes out
 * looking the same, reaches Discord without the caller thinking about it, and
 * is held back when it would be noise rather than news.
 */
public final class Feed {

    /** How big a thing has to be before the whole server hears about it. */
    public enum Weight {
        /** Worth a line in chat. A rank-up, a good find. */
        NOTE,
        /** Worth a line and a sound. A boss down, a season ending. */
        BIG
    }

    /**
     * The same person cannot fill the feed on their own.
     *
     * Somebody on a good run in the dig site would otherwise announce a find
     * every few seconds, which stops being interesting immediately and buries
     * whatever anybody else is doing.
     */
    private static final long PER_PLAYER_MS = 45_000L;

    /** And nor can everybody together. */
    private static final int MOST_PER_MINUTE = 8;

    private final Nexus nexus;

    private final Map<UUID, Long> lastFrom = new HashMap<>();
    private final Deque<Long> recent = new ArrayDeque<>();

    /** What has been said lately, so /feed can show somebody who just joined. */
    private final Deque<String> history = new ArrayDeque<>();

    public Feed(Nexus nexus) {
        this.nexus = nexus;
    }

    /**
     * Something one player did that the rest should see.
     *
     * The player is passed rather than just their name so the same person
     * cannot hold the floor, and so the line can be skipped entirely for
     * somebody the server would rather not shout about later.
     */
    public void say(Player who, Weight weight, String what) {
        if (who != null && quietFor(who.getUniqueId())) return;

        /*
         * The big ones are never held back.
         *
         * The limiter exists so one lucky digger cannot fill the feed, and a
         * boss rising is not that - but it was being counted against the same
         * eight-a-minute budget, so a busy few minutes could have swallowed
         * the one announcement everybody actually needed to see.
         */
        if (weight != Weight.BIG && tooMuch()) return;

        if (who != null) lastFrom.put(who.getUniqueId(), System.currentTimeMillis());
        recent.addLast(System.currentTimeMillis());

        String line = who == null ? what : who.getName() + " " + what;

        Component shown = Component.text("» ", NamedTextColor.DARK_GRAY)
                .append(Component.text(line, weight == Weight.BIG
                        ? NamedTextColor.GOLD : NamedTextColor.GRAY));

        nexus.getServer().broadcast(shown);

        if (weight == Weight.BIG) {
            for (Player player : nexus.getServer().getOnlinePlayers()) {
                player.playSound(player, Sound.BLOCK_NOTE_BLOCK_BELL, 0.4f, 1.5f);
            }
        }

        remember(line);
        nexus.discord().event(line);
    }

    /** Something the server did, with nobody to credit. */
    public void say(Weight weight, String what) {
        say(null, weight, what);
    }

    /** The last few lines, for somebody who has only just arrived. */
    public List<String> lately() {
        return List.copyOf(history);
    }

    public void show(Player player) {
        player.sendMessage(Text.heading("Lately"));

        if (history.isEmpty()) {
            player.sendMessage(Text.plain("  Nothing has happened yet."));
            return;
        }

        for (String line : history) {
            player.sendMessage(Component.text("  » ", NamedTextColor.DARK_GRAY)
                    .append(Component.text(line, NamedTextColor.GRAY)));
        }
    }

    /* ------------------------------------------------------------ holding back */

    private boolean quietFor(UUID who) {
        Long last = lastFrom.get(who);
        return last != null && System.currentTimeMillis() - last < PER_PLAYER_MS;
    }

    private boolean tooMuch() {
        long cutoff = System.currentTimeMillis() - 60_000L;
        while (!recent.isEmpty() && recent.peekFirst() < cutoff) recent.removeFirst();

        return recent.size() >= MOST_PER_MINUTE;
    }

    private void remember(String line) {
        history.addLast(line);
        while (history.size() > 8) history.removeFirst();
    }
}
