package dev.nexuscraft.nexus;

import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.entity.Player;

import java.util.ArrayList;
import java.util.List;

/**
 * Doorways in the lobby you walk through instead of clicking a bot.
 *
 * {@link Npc} argues against exactly this, and for the fifteen minigames it is
 * right: a portal is a trap you cross by accident chasing somebody, and you
 * cannot stand next to one to read what it says. That argument is about a
 * courtyard of fourteen identical archways nobody can tell apart.
 *
 * It does not hold for the two worlds people actually live in. Survival and
 * Creative are not a menu choice, they are somewhere you go and stay, and the
 * walk through a portal is worth more there than a saved click costs.
 *
 * Nothing here builds anything. The first version generated a frame from a
 * template, which is the wrong way round - it made every portal on the server
 * look the same, in a lobby whose whole point is being built by hand. So a
 * portal is something you build and light yourself, out of whatever you like
 * and at whatever size, and this only remembers which one leads where.
 */
public final class Portals {

    /** How far a portal block may be from you when you register it. */
    private static final int REACH = 10;

    /**
     * How close an entered portal must be to a registered one to count as it.
     *
     * Generous, because a portal can be up to twenty-one blocks wide and the
     * position stored is one block of it - the one that happened to be nearest
     * when it was registered, which for a wide portal is an end rather than
     * the middle.
     */
    private static final double CLAIM = 24.0;

    /** How many portal changes can be walked back. */
    private static final int UNDOS = 10;

    private final Nexus nexus;

    /**
     * What each change replaced, most recent first.
     *
     * Held in memory rather than on disk on purpose. Undo is for the minute
     * after you got it wrong, and an undo stack that survived a restart would
     * offer to revert a portal somebody set up last week - by which point the
     * frame it pointed at has probably been built over.
     */
    private final java.util.Deque<Change> undo = new java.util.ArrayDeque<>();

    /** A portal setting as it was, where null means there was none. */
    private record Change(String id, Location was) { }

    public Portals(Nexus nexus) {
        this.nexus = nexus;
    }

    /* ------------------------------------------------------------- storing */

    public boolean has(String id) {
        return nexus.settings().hasPortal(id);
    }

    /** Every destination with a portal registered, for tab completion and Hub. */
    public List<String> placed() {
        List<String> out = new ArrayList<>();
        for (Hub.Destination destination : Hub.DESTINATIONS) {
            if (has(destination.id())) out.add(destination.id());
        }
        return out;
    }

    /**
     * Points a destination at the portal somebody is standing next to.
     *
     * Finds the portal rather than being told where it is, because the useful
     * gesture is standing in the thing you just built and naming it. Typing
     * coordinates is how you end up pointing survival at a portal one block
     * from the one you meant.
     */
    public boolean set(String id, Player player) {
        Block found = nearestPortalBlock(player.getLocation());

        if (found == null) {
            player.sendMessage(Text.bad("No lit portal within " + REACH + " blocks of you."));
            player.sendMessage(Text.plain("  Build the frame, light it, stand in it, then try again."));
            return false;
        }

        remember(id);
        nexus.settings().setPortal(id, found.getLocation());
        return true;
    }

    public boolean clear(String id) {
        if (!has(id)) return false;

        remember(id);
        return nexus.settings().clearPortal(id);
    }

    private void remember(String id) {
        World hub = nexus.hub().worldIfReady();

        undo.addFirst(new Change(id, hub == null ? null : nexus.settings().portalAt(id, hub)));
        while (undo.size() > UNDOS) undo.removeLast();
    }

    /**
     * Puts the last portal change back, and says what it did.
     *
     * Returns the description rather than sending it, so the command decides
     * how to say it and this stays about portals.
     */
    public String undoLast() {
        if (undo.isEmpty()) return null;

        Change change = undo.removeFirst();

        if (change.was() == null) {
            nexus.settings().clearPortal(change.id());
            return change.id() + " has no portal again";
        }

        nexus.settings().setPortal(change.id(), change.was());
        return change.id() + " points back at where it did";
    }

    public int undosLeft() {
        return undo.size();
    }

    /**
     * The closest lit portal block, or null if there is none nearby.
     *
     * Searched as a box rather than by what the player has in their crosshair,
     * since standing inside a portal means looking through it at whatever is
     * on the other side.
     */
    private Block nearestPortalBlock(Location from) {
        World world = from.getWorld();
        if (world == null) return null;

        Block best = null;
        double nearest = Double.MAX_VALUE;

        for (int dx = -REACH; dx <= REACH; dx++) {
            for (int dy = -REACH; dy <= REACH; dy++) {
                for (int dz = -REACH; dz <= REACH; dz++) {
                    Block block = world.getBlockAt(
                            from.getBlockX() + dx, from.getBlockY() + dy, from.getBlockZ() + dz);

                    if (block.getType() != Material.NETHER_PORTAL) continue;

                    double away = block.getLocation().distanceSquared(from);
                    if (away >= nearest) continue;

                    nearest = away;
                    best = block;
                }
            }
        }
        return best;
    }

    /**
     * Says so in the log when a registered portal is no longer there.
     *
     * Somebody rebuilding the lobby will break one sooner or later, and a
     * doorway that silently stopped working is a much harder thing to notice
     * than a line on startup naming the one that broke.
     */
    public void check() {
        World hub = nexus.hub().worldIfReady();
        if (hub == null) return;

        for (String id : placed()) {
            Location at = nexus.settings().portalAt(id, hub);
            if (at == null) continue;

            if (at.getBlock().getType() != Material.NETHER_PORTAL) {
                nexus.getLogger().warning("the " + id + " portal is gone; stand in a new one"
                        + " and run /nexus setportal " + id);
            }
        }
    }

    /* -------------------------------------------------------------- travel */

    /**
     * Somebody standing in a portal in the lobby.
     *
     * Returns whether it was handled, so the caller can cancel the vanilla
     * journey either way - an unhandled portal block in the overworld sends
     * people to the default world's nether, a dimension belonging to a world
     * nobody plays in and a bad place to be left.
     */
    public boolean entered(Player player, Location where) {
        if (!nexus.hub().isHub(player)) return false;

        /*
         * A builder holding sneak can stand in one; otherwise they travel.
         *
         * This used to exempt builders entirely, on the grounds that being
         * thrown into survival while working on a portal would make it
         * impossible to build. That was solving a problem that does not exist -
         * registering reaches ten blocks, so you are never required to stand
         * inside the thing - and it caused a worse one: build mode persists, so
         * the person who built the portal was permanently unable to test it,
         * and the portal looked broken to the only person who could fix it.
         *
         * Sneak is the escape hatch, which is needed about as often as standing
         * inside a lit portal is, and costs nothing the rest of the time.
         */
        if (nexus.hub().isBuilding(player.getUniqueId()) && player.isSneaking()) return true;

        World hub = where.getWorld();
        if (hub == null) return false;

        String best = null;
        double nearest = CLAIM * CLAIM;

        for (Hub.Destination destination : Hub.DESTINATIONS) {
            Location at = nexus.settings().portalAt(destination.id(), hub);
            if (at == null) continue;

            /*
             * Nearest wins, rather than first past the post.
             *
             * Two portals built near each other would otherwise both match and
             * which one you got would depend on the order the destinations
             * happen to be declared in - so walking into Creative would send
             * you to Survival, because Survival is listed first.
             */
            double away = at.distanceSquared(where);
            if (away > nearest) continue;

            nearest = away;
            best = destination.id();
        }

        if (best != null) {
            nexus.travel(player, best);
            return true;
        }

        // A portal in the lobby that is not one of ours: still not the nether.
        // Somebody is mid-build, or an old one was left behind.
        return true;
    }
}
