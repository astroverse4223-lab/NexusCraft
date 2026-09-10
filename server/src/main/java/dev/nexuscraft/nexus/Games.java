package dev.nexuscraft.nexus;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Sound;
import org.bukkit.entity.Player;

import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Every game the server has, who is waiting for one, and what is running.
 *
 * The queue is the piece that makes a network feel alive with six people on it.
 * A player picks a game and is told exactly where they stand — how many are
 * waiting, how many are needed, how long is left — instead of standing in a
 * lobby wondering whether anything is going to happen. Silence is what makes a
 * small server feel dead, and most of that silence is a queue that says nothing.
 */
public final class Games {

    private final Nexus nexus;

    private final Map<String, Game> games = new LinkedHashMap<>();

    /** Who is waiting, per game, in the order they arrived. */
    private final Map<String, Set<UUID>> waiting = new LinkedHashMap<>();

    /** Seconds left before a queue becomes a match, or -1 if it is not counting. */
    private final Map<String, Integer> countdown = new LinkedHashMap<>();

    private final List<Match> running = new ArrayList<>();

    public Games(Nexus nexus) {
        this.nexus = nexus;
    }

    public void register(Game game) {
        games.put(game.id(), game);
        waiting.put(game.id(), new LinkedHashSet<>());
        countdown.put(game.id(), -1);
    }

    public Collection<Game> all() {
        return games.values();
    }

    public Game byId(String id) {
        return games.get(id);
    }

    public int waitingFor(String gameId) {
        Set<UUID> queue = waiting.get(gameId);
        return queue == null ? 0 : queue.size();
    }

    public int countdownFor(String gameId) {
        return countdown.getOrDefault(gameId, -1);
    }

    /** The game this player is queued for, or null. */
    public String queuedFor(UUID who) {
        for (Map.Entry<String, Set<UUID>> entry : waiting.entrySet()) {
            if (entry.getValue().contains(who)) return entry.getKey();
        }
        return null;
    }

    public Match matchOf(UUID who) {
        for (Match match : running) {
            if (match.players().contains(who)) return match;
        }
        return null;
    }

    public List<Match> running() {
        return running;
    }

    /* ---------------------------------------------------------------- queue */

    /**
     * Puts somebody in a queue, with their party if they have one.
     *
     * A party joins or it does not — a group of four who queue together and get
     * split across two matches is the single most annoying thing a network can
     * do to a group of friends, and it is exactly what happens if members are
     * added one at a time into a queue that fills partway through.
     */
    public void join(Player player, Game game) {
        leave(player, true);

        List<Player> group = nexus.parties().membersOnline(player.getUniqueId());
        Set<UUID> queue = waiting.get(game.id());

        if (queue.size() + group.size() > game.maxPlayers()) {
            player.sendMessage(Text.bad("That queue does not have room for your party."));
            return;
        }

        for (Player member : group) {
            queue.add(member.getUniqueId());
            member.sendMessage(Text.says("Queued for " + game.name() + "."));
            nexus.hub().refresh(member);
        }

        announceQueue(game);
        considerStarting(game);
    }

    /** Takes somebody out of whatever queue they are in. Quiet if asked. */
    public void leave(Player player, boolean silent) {
        String was = queuedFor(player.getUniqueId());
        if (was == null) return;

        waiting.get(was).remove(player.getUniqueId());
        if (!silent) player.sendMessage(Text.says("Left the queue."));

        Game game = games.get(was);
        if (game != null) {
            // Dropping below the minimum stops the clock rather than starting a
            // match one short, which would put somebody in a game alone.
            if (waiting.get(was).size() < game.minPlayers() && countdown.get(was) >= 0) {
                countdown.put(was, -1);
                announce(game, Text.says("Not enough players. Countdown stopped."));
            }
            announceQueue(game);
        }
    }

    private void considerStarting(Game game) {
        Set<UUID> queue = waiting.get(game.id());
        if (queue.size() < game.minPlayers()) return;

        // A full lobby does not stand around waiting out a timer.
        if (queue.size() >= game.maxPlayers()) {
            countdown.put(game.id(), 0);
            return;
        }

        if (countdown.get(game.id()) < 0) {
            countdown.put(game.id(), game.countdownSeconds());
        }
    }

    /* ----------------------------------------------------------------- tick */

    /** Once a second: queue clocks, then every running match. */
    public void tick() {
        for (Game game : new ArrayList<>(games.values())) tickQueue(game);

        for (Match match : new ArrayList<>(running)) {
            if (match.isOver()) {
                running.remove(match);
                continue;
            }
            match.tick();
        }
    }

    private void tickQueue(Game game) {
        int left = countdown.getOrDefault(game.id(), -1);
        if (left < 0) return;

        if (left == 0) {
            countdown.put(game.id(), -1);
            begin(game);
            return;
        }

        // Counted down out loud only when it is worth interrupting for.
        if (left <= 5 || left % 10 == 0) {
            announce(game, Text.says("Starting in " + left + "..."));
            for (UUID id : waiting.get(game.id())) {
                Player player = nexus.getServer().getPlayer(id);
                if (player != null) {
                    player.playSound(player, Sound.BLOCK_NOTE_BLOCK_HAT, 1f, 1f);
                }
            }
        }

        countdown.put(game.id(), left - 1);
        for (UUID id : waiting.get(game.id())) {
            Player player = nexus.getServer().getPlayer(id);
            if (player != null) nexus.hub().refresh(player);
        }
    }

    private void begin(Game game) {
        Set<UUID> queue = waiting.get(game.id());

        Set<UUID> taking = new LinkedHashSet<>();
        for (UUID id : queue) {
            if (taking.size() >= game.maxPlayers()) break;
            if (nexus.getServer().getPlayer(id) != null) taking.add(id);
        }

        // Everyone who did not fit stays where they are and keeps their place.
        queue.removeAll(taking);

        if (taking.size() < game.minPlayers()) {
            announce(game, Text.bad("Not enough players left. Cancelled."));
            return;
        }

        /*
         * Everything they were carrying, put away before the match clears it.
         *
         * Every match type clears the inventory on spawn, and none of them
         * stashed it first - so queueing from survival with a full inventory
         * deleted all of it. Done here rather than in each match because
         * stash() overwrites, and two of them would store the emptied
         * inventory over the real one.
         *
         * Queueing from the lobby is a no-op: placeOf is null there, and stash
         * returns immediately for a null place.
         */
        for (UUID id : taking) {
            Player player = nexus.getServer().getPlayer(id);
            if (player != null) {
                nexus.backpacks().stash(player, nexus.worlds().placeOf(player));
            }
        }

        Match match = game.newMatch(nexus);
        running.add(match);
        match.start(taking);
    }

    /* -------------------------------------------------------------- talking */

    private void announceQueue(Game game) {
        Set<UUID> queue = waiting.get(game.id());
        announce(game, Component.text("  " + queue.size() + "/" + game.maxPlayers(), Text.BRAND)
                .append(Component.text(" waiting for " + game.name(), NamedTextColor.GRAY)));
    }

    private void announce(Game game, Component message) {
        for (UUID id : waiting.get(game.id())) {
            Player player = nexus.getServer().getPlayer(id);
            if (player != null) player.sendMessage(message);
        }
    }

    /** Somebody disconnected: out of the queue, and out of any match. */
    public void forget(Player player) {
        leave(player, true);

        Match match = matchOf(player.getUniqueId());
        if (match != null) match.remove(player);
    }

    /** Shutdown. Every match ends now, so no arena survives the restart. */
    public void stopEverything() {
        for (Match match : new ArrayList<>(running)) {
            for (UUID id : new ArrayList<>(match.players())) {
                Player player = nexus.getServer().getPlayer(id);
                if (player != null) match.remove(player);
            }
        }
        running.clear();
    }
}
