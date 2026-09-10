package dev.nexuscraft.nexus;

import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.block.Chest;
import org.bukkit.block.Container;
import org.bukkit.entity.Item;
import org.bukkit.entity.Player;
import org.bukkit.scheduler.BukkitTask;

import java.util.HashSet;
import java.util.Set;
import java.util.UUID;

/**
 * Clearing an island properly, without stopping the server to do it.
 *
 * Rebuilding the starting island is not the same as starting again: the old one
 * is still standing all around the new one, which is what /newisland used to
 * do and why it felt like it had not worked. Actually emptying somebody's plot
 * is millions of blocks, and millions of blocks in one tick is a server that
 * stops answering for a minute and drops everybody.
 *
 * So it is done a slice at a time across ticks, with the owner waiting in the
 * hub while it happens. Slower in wall-clock, and nobody else on the server can
 * tell it is running.
 */
public final class Wipe {

    /**
     * How far out the clear reaches, and the band of height it covers.
     *
     * Islands are five hundred and twelve apart, so a hundred and twenty-eight
     * cannot reach a neighbour's plot even at the corners. It is far more than
     * anybody builds around a skyblock island, and the vertical band covers
     * everything from well under the island to well over it.
     */
    private static final int RADIUS = 128;
    private static final int BELOW = 40;
    private static final int ABOVE = 80;

    /**
     * Blocks cleared per tick.
     *
     * Chosen to be busy but not a stall: at twenty thousand a plot this size
     * takes about twenty seconds and the server keeps its tick rate.
     */
    private static final int PER_TICK = 20_000;

    private final Nexus nexus;

    /** Who is having a plot cleared, so a second command cannot start another. */
    private final Set<UUID> running = new HashSet<>();

    public Wipe(Nexus nexus) {
        this.nexus = nexus;
    }

    /**
     * Takes everything out of a container before the container goes.
     *
     * Minecraft drops a chest's contents when the block is removed, so clearing
     * a plot full of chests fills the sky with what was in them - which is
     * exactly what happened: a wiped island came back with its old inventory
     * scattered over the grass.
     *
     * For a chest the live inventory is `getBlockInventory`, not
     * `getInventory`: the latter hands back a snapshot on a block state, and a
     * snapshot emptied is a copy emptied, with nothing to say it did nothing.
     */
    private void emptyFirst(Block block) {
        if (!(block.getState() instanceof Container box)) return;

        if (box instanceof Chest chest) chest.getBlockInventory().clear();
        else box.getInventory().clear();
    }

    /** Removes every dropped item over the plot. */
    private void sweepItems(World world, int cx, int cz) {
        for (Item dropped : world.getEntitiesByClass(Item.class)) {
            Location at = dropped.getLocation();
            if (Math.abs(at.getBlockX() - cx) <= RADIUS && Math.abs(at.getBlockZ() - cz) <= RADIUS) {
                dropped.remove();
            }
        }
    }

    public boolean busy(UUID who) {
        return running.contains(who);
    }

    /**
     * Empties the plot around a point, then calls back on the main thread.
     *
     * The callback is where the island is rebuilt and the owner brought home,
     * so that never happens against a plot that is still half full.
     */
    public void plot(Player owner, Location centre, Runnable whenDone) {
        UUID who = owner.getUniqueId();
        if (!running.add(who)) return;

        World world = centre.getWorld();
        int cx = centre.getBlockX();
        int cz = centre.getBlockZ();

        int lowY = Math.max(world.getMinHeight(), centre.getBlockY() - BELOW);
        int highY = Math.min(world.getMaxHeight() - 1, centre.getBlockY() + ABOVE);

        owner.sendMessage(Text.says("Clearing your island. This takes a moment."));

        // Anything loose in there goes with it, or the ground comes back
        // carpeted in whatever was floating when the blocks under it left.
        sweepItems(world, cx, cz);

        /*
         * Two passes, and the second is the reason water used to survive.
         *
         * The first takes everything. While it runs, water still in the plot
         * flows into what has just been emptied, so a lake at the edge follows
         * the clear across and is left running off the side of a brand new
         * island. Once the first pass is done there are no sources left, so
         * flowing water dries up on its own - and the second pass, which only
         * looks for liquid and is therefore far quicker, removes what is left.
         */
        /*
         * The liquid pass goes all the way to the bottom of the world.
         *
         * Water poured off the edge of an island does not stop at the bottom of
         * the band worth demolishing - it falls, and keeps falling, and ends up
         * hanging in the void forty blocks under a plot that has otherwise been
         * emptied. It is also the cheapest pass, because nearly everything it
         * looks at down there is already air.
         */
        pass(owner, world, cx, cz, lowY, highY, false, () ->
                nexus.getServer().getScheduler().runTaskLater(nexus, () ->
                        pass(owner, world, cx, cz, world.getMinHeight(), highY, true, () -> {
                            sweepItems(world, cx, cz);
                            running.remove(who);
                            whenDone.run();
                        }), 40L));
    }

    /**
     * One sweep of the plot.
     *
     * `liquidOnly` is the cheap pass: almost everything it looks at is already
     * air, so it reads far more than it writes and can afford a much larger
     * budget than the pass that is actually demolishing things.
     */
    private void pass(Player owner, World world, int cx, int cz, int lowY, int highY,
                      boolean liquidOnly, Runnable whenDone) {

        int fromX = cx - RADIUS;
        int toX = cx + RADIUS;
        int fromZ = cz - RADIUS;
        int toZ = cz + RADIUS;

        long total = (long) (toX - fromX + 1) * (toZ - fromZ + 1) * (highY - lowY + 1);
        int budget = liquidOnly ? PER_TICK * 10 : PER_TICK;

        // Downwards, so that whatever is above a block is already gone before
        // the block goes - nothing falls or drains into the space just made.
        final int[] cursor = { fromX, fromZ, highY };
        final long[] done = { 0 };
        final int[] lastReport = { 0 };

        BukkitTask[] task = new BukkitTask[1];
        task[0] = nexus.getServer().getScheduler().runTaskTimer(nexus, () -> {
            int left = budget;

            while (left > 0) {
                if (cursor[0] > toX) {
                    task[0].cancel();
                    whenDone.run();
                    return;
                }

                Block block = world.getBlockAt(cursor[0], cursor[2], cursor[1]);
                Material type = block.getType();

                boolean wanted = liquidOnly
                        ? type == Material.WATER || type == Material.LAVA
                        : type != Material.AIR;

                if (wanted) {
                    if (!liquidOnly) emptyFirst(block);
                    block.setType(Material.AIR, false);
                }

                left--;
                done[0]++;

                cursor[2]--;
                if (cursor[2] < lowY) {
                    cursor[2] = highY;
                    cursor[1]++;
                    if (cursor[1] > toZ) {
                        cursor[1] = fromZ;
                        cursor[0]++;
                    }
                }
            }

            if (liquidOnly) return;

            int percent = (int) (done[0] * 100 / Math.max(1, total));
            if (percent >= lastReport[0] + 25 && percent < 100) {
                lastReport[0] = percent - (percent % 25);
                if (owner.isOnline()) {
                    owner.sendActionBar(Text.plain("Clearing your island: " + percent + "%"));
                }
            }
        }, 1L, 1L);
    }
}
