package dev.nexuscraft.nexus;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.event.ClickEvent;
import net.kyori.adventure.text.event.HoverEvent;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.Sound;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.entity.Player;

import java.util.HashMap;
import java.util.Map;
import java.util.Random;
import java.util.UUID;

/**
 * Getting to each other, and getting back.
 *
 * The three most typed commands on any survival server, and none of them
 * existed here. Their absence is not felt as a missing feature so much as the
 * server feeling unfinished: two friends who want to play together have no way
 * to meet except comparing coordinates in chat and walking for ten minutes.
 *
 * `/back` is the important one. Dying two thousand blocks out with a full
 * inventory and no way to return is the single most common reason somebody
 * stops playing on a server, because the alternative to walking back is
 * accepting the loss - and most people only accept it once.
 */
public final class Teleports {

    /** How long a request stands before it lapses. */
    private static final int REQUEST_SECONDS = 60;

    /** How long between random teleports. */
    private static final int RTP_COOLDOWN = 180;

    /** How far out /rtp will throw you. */
    private static final int RTP_RANGE = 6000;

    /** A pending request: who asked, and which way round it goes. */
    private record Request(UUID from, boolean bringThemHere, int madeAt) {
    }

    private final Nexus nexus;
    private final Random random = new Random();

    /** Keyed by who has to answer it. */
    private final Map<UUID, Request> pending = new HashMap<>();

    /** Where each player was before the thing that moved them. */
    private final Map<UUID, Location> back = new HashMap<>();
    private final Map<UUID, Integer> rtpAt = new HashMap<>();

    private int seconds;

    public Teleports(Nexus nexus) {
        this.nexus = nexus;
    }

    /* -------------------------------------------------------------- asking */

    public void request(Player asker, String name, boolean bringThemHere) {
        Player target = nexus.getServer().getPlayerExact(name);

        if (target == null) {
            asker.sendMessage(Text.bad("They are not online."));
            return;
        }
        if (target.equals(asker)) {
            asker.sendMessage(Text.bad("You are already there."));
            return;
        }

        // A match is a closed world; somebody arriving mid-round from outside
        // is both unfair and a player standing in a world about to be deleted.
        if (nexus.games().matchOf(target.getUniqueId()) != null
                || nexus.games().matchOf(asker.getUniqueId()) != null) {
            asker.sendMessage(Text.bad("Not while somebody is in a game."));
            return;
        }

        pending.put(target.getUniqueId(),
                new Request(asker.getUniqueId(), bringThemHere, seconds));

        asker.sendMessage(Text.good("Asked " + target.getName()
                + ". It lapses in a minute."));

        target.sendMessage(Component.empty());
        target.sendMessage(Component.text("  " + asker.getName(), NamedTextColor.WHITE)
                .append(Component.text(bringThemHere
                                ? " wants you to come to them"
                                : " wants to teleport to you",
                        NamedTextColor.GRAY)));

        /*
         * Clickable, because the alternative is typing a command correctly
         * while somebody waits - and a request that lapses because it was
         * mistyped is the same as one that was refused.
         */
        target.sendMessage(Component.text("  [Accept]", NamedTextColor.GREEN)
                .hoverEvent(HoverEvent.showText(Component.text("/tpaccept")))
                .clickEvent(ClickEvent.runCommand("/tpaccept"))
                .append(Component.text("   "))
                .append(Component.text("[Deny]", NamedTextColor.RED)
                        .hoverEvent(HoverEvent.showText(Component.text("/tpdeny")))
                        .clickEvent(ClickEvent.runCommand("/tpdeny"))));

        target.playSound(target, Sound.BLOCK_NOTE_BLOCK_BELL, 0.7f, 1.4f);
    }

    public void accept(Player answering) {
        Request request = pending.remove(answering.getUniqueId());

        if (request == null) {
            answering.sendMessage(Text.says("Nobody is waiting on you."));
            return;
        }

        Player asker = nexus.getServer().getPlayer(request.from());
        if (asker == null) {
            answering.sendMessage(Text.bad("They have gone offline."));
            return;
        }

        Player moving = request.bringThemHere() ? answering : asker;
        Player staying = request.bringThemHere() ? asker : answering;

        send(moving, staying.getLocation());

        moving.sendMessage(Text.good("Off you go."));
        staying.sendMessage(Text.good(moving.getName() + " is on their way."));
    }

    public void deny(Player answering) {
        Request request = pending.remove(answering.getUniqueId());

        if (request == null) {
            answering.sendMessage(Text.says("Nobody is waiting on you."));
            return;
        }

        answering.sendMessage(Text.says("Turned down."));

        Player asker = nexus.getServer().getPlayer(request.from());
        if (asker != null) asker.sendMessage(Text.bad(answering.getName() + " said no."));
    }

    /* ---------------------------------------------------------------- back */

    /**
     * Remembers where somebody was before something moved them.
     *
     * Called before every teleport this class does and on every death, so
     * `/back` means "undo the last thing that moved me" rather than only
     * "go to where I died".
     */
    public void remember(Player player) {
        back.put(player.getUniqueId(), player.getLocation().clone());
    }

    public void goBack(Player player) {
        Location where = back.get(player.getUniqueId());

        if (where == null) {
            player.sendMessage(Text.says("Nothing to go back to yet."));
            return;
        }
        if (where.getWorld() == null) {
            player.sendMessage(Text.bad("That world is gone."));
            back.remove(player.getUniqueId());
            return;
        }
        if (nexus.games().matchOf(player.getUniqueId()) != null) {
            player.sendMessage(Text.bad("Not in the middle of a game."));
            return;
        }

        // Swapped rather than cleared, so a second /back returns you to where
        // you just were - which is what people expect after using it by mistake.
        Location from = player.getLocation().clone();
        arrive(player, where);
        back.put(player.getUniqueId(), from);

        player.sendMessage(Text.good("Back you go."));
        player.playSound(player, Sound.ENTITY_ENDERMAN_TELEPORT, 0.6f, 1.2f);
    }

    /* ----------------------------------------------------------------- rtp */

    /**
     * Somewhere else entirely.
     *
     * The chunk is loaded off the main thread before anything looks at it.
     * Reading a block in an ungenerated chunk generates it there and then, and
     * generating a chunk six thousand blocks out on the server thread is a
     * visible freeze for everybody on the server, not just the person who asked.
     */
    public void random(Player player) {
        Worlds.Place place = nexus.worlds().placeOf(player);

        if (place != Worlds.Place.SURVIVAL) {
            player.sendMessage(Text.bad("Only out in survival. /warp survival"));
            return;
        }

        int last = rtpAt.getOrDefault(player.getUniqueId(), -RTP_COOLDOWN);
        int wait = RTP_COOLDOWN - (seconds - last);

        if (wait > 0) {
            player.sendMessage(Text.bad("Again in " + Text.roughly(wait) + "."));
            return;
        }

        rtpAt.put(player.getUniqueId(), seconds);
        player.sendMessage(Text.says("Looking for somewhere..."));

        World world = player.getWorld();
        tryOnce(player, world, 0);
    }

    private void tryOnce(Player player, World world, int attempt) {
        if (attempt >= 8) {
            player.sendMessage(Text.bad("Could not find anywhere safe. Try again."));
            rtpAt.remove(player.getUniqueId());
            return;
        }

        int x = random.nextInt(RTP_RANGE * 2) - RTP_RANGE;
        int z = random.nextInt(RTP_RANGE * 2) - RTP_RANGE;

        world.getChunkAtAsync(x >> 4, z >> 4).thenAccept(chunk -> {
            if (!player.isOnline()) return;

            Location landing = safeSpot(world, x, z);

            if (landing == null) {
                tryOnce(player, world, attempt + 1);
                return;
            }

            // Not into somebody's back garden.
            if (nexus.claims().claimed(landing)) {
                tryOnce(player, world, attempt + 1);
                return;
            }

            remember(player);
            arrive(player, landing);

            player.sendMessage(Text.good("Dropped at " + landing.getBlockX()
                    + ", " + landing.getBlockZ() + "."));
            player.sendMessage(Text.plain("  /back if you did not mean it."));
            player.playSound(player, Sound.ENTITY_ENDERMAN_TELEPORT, 0.8f, 1f);
        });
    }

    /**
     * The highest solid block, if it is somewhere a person can stand.
     *
     * Returns null rather than a best guess, because the alternative to trying
     * again is dropping somebody into lava or the middle of an ocean, and both
     * of those are worse than a two second wait.
     */
    private Location safeSpot(World world, int x, int z) {
        Block ground = world.getHighestBlockAt(x, z);
        Material under = ground.getType();

        if (under == Material.WATER || under == Material.LAVA
                || under == Material.AIR || !under.isSolid()) {
            return null;
        }

        // Nothing directly overhead either, so nobody lands inside a tree.
        Block above = ground.getRelative(0, 1, 0);
        if (!above.getType().isAir()) return null;

        return new Location(world, x + 0.5, ground.getY() + 1.0, z + 0.5);
    }

    /* ---------------------------------------------------------------- tick */

    /** Once a second, to lapse requests nobody answered. */
    public void tick() {
        seconds++;

        pending.entrySet().removeIf(entry -> {
            if (seconds - entry.getValue().madeAt() < REQUEST_SECONDS) return false;

            Player asker = nexus.getServer().getPlayer(entry.getValue().from());
            if (asker != null) asker.sendMessage(Text.says("Your request lapsed."));

            return true;
        });
    }

    /**
     * Sends somebody somewhere, remembering where they were first.
     *
     * Everything that moves a player between worlds goes through here, because
     * a raw teleport across a world boundary skips three things that are not
     * optional: the backpack swap, the gamemode, and stripping what the last
     * place put on them.
     *
     * The backpack is the one that matters. Without it somebody can stand in
     * creative with a full inventory, teleport to a friend in survival, and
     * arrive holding all of it - which is the precise thing the backpack system
     * was written to stop.
     */
    private void send(Player player, Location to) {
        remember(player);
        arrive(player, to);
        player.playSound(player, Sound.ENTITY_ENDERMAN_TELEPORT, 0.6f, 1.2f);
    }

    /**
     * Puts somebody at a location, changing worlds properly if it is in another.
     *
     * The same shape as Homes.go, which had this right already. Worlds.send
     * teleports them to that world's spawn on the way, so the final teleport
     * afterwards is what actually puts them where they asked to be.
     */
    private void arrive(Player player, Location to) {
        if (to.getWorld() == null) return;

        // Into the lobby, which has an arrival routine of its own.
        if (to.getWorld().equals(nexus.hub().worldIfReady())) {
            nexus.hub().send(player);
            player.teleport(to);
            return;
        }

        String world = to.getWorld().getName();
        Worlds.Place place = null;
        for (Worlds.Place candidate : Worlds.Place.values()) {
            if (candidate.world.equals(world)) place = candidate;
        }

        if (place != null && nexus.worlds().placeOf(player) != place) {
            nexus.worlds().send(player, place);
        } else if (!player.getWorld().equals(to.getWorld())) {
            /*
             * Somewhere the world system does not know about.
             *
             * An arena, or a world added by hand. Nothing sensible can be done
             * about the backpack for it, but the effects still have to go -
             * otherwise this is the leak again by a different route.
             */
            Worlds.strip(player);
        }

        player.teleport(to);
    }

    public void forget(Player player) {
        pending.remove(player.getUniqueId());
        pending.values().removeIf(request -> request.from().equals(player.getUniqueId()));
    }

    public int waiting() {
        return pending.size();
    }
}
