package dev.nexuscraft.nexus;

import net.kyori.adventure.text.Component;
import org.bukkit.entity.Player;

import java.util.LinkedHashSet;
import java.util.Set;
import java.util.UUID;

/**
 * One game being played.
 *
 * A match owns its players and its world and nothing else owns either. The
 * shell starts it, ticks it once a second, and is told when it is over; it
 * never reaches inside. Every hook here is deliberately narrow, because the
 * moment the hub starts special-casing what a particular game needs, adding the
 * second game means changing the first.
 */
public abstract class Match {

    protected final Nexus nexus;
    protected final Set<UUID> players = new LinkedHashSet<>();

    /** Counts up in seconds from the moment the match starts. */
    protected int elapsed;

    private boolean over;

    protected Match(Nexus nexus) {
        this.nexus = nexus;
    }

    public abstract Game game();

    /** Everyone in it, whether alive or watching. */
    public Set<UUID> players() {
        return players;
    }

    public boolean isOver() {
        return over;
    }

    /**
     * Called once, with everybody who is playing.
     *
     * The world is built here rather than when the match object is made, so
     * that a queue which never fills costs nothing.
     */
    public abstract void start(Set<UUID> joining);

    /** Once a second. Timers, generators, the sidebar. */
    public abstract void tick();

    /** Called when the match ends, however it ends, exactly once. */
    protected abstract void teardown();

    /** Somebody left mid-match, by quitting the server or the game. */
    public abstract void remove(Player player);

    /* --------------------------------------------------------------- shared */

    /** Says something to everybody in this match and nobody outside it. */
    public void announce(Component message) {
        for (UUID id : players) {
            Player player = nexus.getServer().getPlayer(id);
            if (player != null) player.sendMessage(message);
        }
    }

    /**
     * Ends the match, once.
     *
     * Guarded because more than one thing can legitimately decide a game is
     * over in the same tick — the last player of a team dying is also the
     * moment their team loses — and running teardown twice deletes a world
     * somebody has already been moved out of.
     */
    protected final void finish() {
        if (over) return;
        over = true;
        teardown();
    }
}
