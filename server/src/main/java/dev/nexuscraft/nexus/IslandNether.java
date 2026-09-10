package dev.nexuscraft.nexus;

import org.bukkit.Difficulty;
import org.bukkit.GameRule;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.WorldCreator;
import org.bukkit.block.Block;
import org.bukkit.block.Chest;
import org.bukkit.block.data.Orientable;
import org.bukkit.entity.Player;
import org.bukkit.event.player.PlayerPortalEvent;
import org.bukkit.inventory.ItemStack;

import java.util.UUID;

/**
 * A second island, in the nether, for Skyblock and One Block.
 *
 * Both modes stop at the same place: once you have the trees, the farm and the
 * generator running, the only thing left is to make the numbers larger. The
 * nether is the standard answer because it is a whole second set of materials
 * that cannot be got any other way - quartz, blaze rods, wither skeletons,
 * soul sand - and reaching it is a build rather than a purchase.
 *
 * The island sits at the same grid position as the overworld one, so which
 * island you arrive at needs no lookup and cannot disagree with the other
 * world. Getting there is a portal you build yourself, out of obsidian you had
 * to make, which is the point.
 */
public final class IslandNether {

    /** The two worlds, named after the ones they belong to. */
    public static final String SKYBLOCK = "nexus_skyblock_nether";
    public static final String ONEBLOCK = "nexus_oneblock_nether";

    /** Same as the overworld islands, so the two grids line up exactly. */
    private static final int SPACING = 512;
    private static final int HEIGHT = 80;

    private final Nexus nexus;

    private World skyblock;
    private World oneblock;

    public IslandNether(Nexus nexus) {
        this.nexus = nexus;
    }

    /* --------------------------------------------------------------- worlds */

    public World of(Worlds.Place place) {
        return place == Worlds.Place.SKYBLOCK ? skyblockWorld() : oneblockWorld();
    }

    private World skyblockWorld() {
        if (skyblock == null) skyblock = make(SKYBLOCK);
        return skyblock;
    }

    private World oneblockWorld() {
        if (oneblock == null) oneblock = make(ONEBLOCK);
        return oneblock;
    }

    private World make(String name) {
        World world = new WorldCreator(name)
                .environment(World.Environment.NETHER)
                .generator(new Arena.Nothing())
                .generateStructures(false)
                .createWorld();

        if (world == null) throw new IllegalStateException("could not create " + name);

        /*
         * Alive, unlike the other void worlds.
         *
         * A nether island with mob spawning off is a red room with nothing in
         * it - no blazes, no wither skeletons, no piglins to trade with, which
         * is most of what anybody comes here for.
         */
        world.setDifficulty(Difficulty.NORMAL);
        world.setGameRule(GameRule.DO_MOB_SPAWNING, true);
        world.setGameRule(GameRule.KEEP_INVENTORY, true);
        world.setGameRule(GameRule.ANNOUNCE_ADVANCEMENTS, false);

        return world;
    }

    /** Which of the two a world is, or null if it is neither. */
    public static Worlds.Place placeOf(String world) {
        if (world.equals(SKYBLOCK)) return Worlds.Place.SKYBLOCK;
        if (world.equals(ONEBLOCK)) return Worlds.Place.ONEBLOCK;
        return null;
    }

    /* -------------------------------------------------------------- islands */

    /**
     * The same slot as the overworld island, worked out the same way.
     *
     * Copied rather than shared because {@link SkyBlock} and {@link OneBlock}
     * each keep their own private copy of it and neither exposes one - and
     * three identical definitions is still better than making the grid public
     * and letting something else start placing things on it.
     */
    private static int slotOf(UUID who) {
        return Math.abs(who.hashCode()) % 4096;
    }

    public Location islandOf(Worlds.Place place, UUID who) {
        int slot = slotOf(who);

        return new Location(of(place),
                (slot % 64) * SPACING + 0.5, HEIGHT + 1, (slot / 64) * SPACING + 0.5);
    }

    /** Whether this spot belongs to whoever is standing on it. */
    public boolean isTheirs(UUID who, int x, int z) {
        int slot = slotOf(who);

        int mine = (slot % 64) * SPACING;
        int theirs = (slot / 64) * SPACING;

        return Math.abs(x - mine) <= SPACING / 2 && Math.abs(z - theirs) <= SPACING / 2;
    }

    /**
     * Builds somebody's nether island if it is not there yet.
     *
     * Deliberately meagre. The overworld island hands you a tree and a chest
     * because you start there with nothing; by the time anybody reaches this
     * one they have a base, and the interesting part is the nether itself
     * rather than another box of supplies.
     */
    private void build(Worlds.Place place, UUID who) {
        Location at = islandOf(place, who);
        World world = at.getWorld();

        int cx = at.getBlockX();
        int cz = at.getBlockZ();

        for (int dx = -4; dx <= 4; dx++) {
            for (int dz = -4; dz <= 4; dz++) {
                if (dx * dx + dz * dz > 20) continue;

                world.getBlockAt(cx + dx, HEIGHT, cz + dz).setType(Material.NETHERRACK, false);
            }
        }

        // The makings of a basalt generator, which is this world's answer to
        // the cobblestone one and the reason to stay.
        world.getBlockAt(cx + 3, HEIGHT + 1, cz).setType(Material.SOUL_SOIL, false);
        world.getBlockAt(cx + 3, HEIGHT + 2, cz).setType(Material.BLUE_ICE, false);

        Block box = world.getBlockAt(cx, HEIGHT + 1, cz + 2);
        box.setType(Material.CHEST, false);

        if (box.getState() instanceof Chest chest) {
            var inside = chest.getBlockInventory();
            inside.clear();

            inside.addItem(new ItemStack(Material.LAVA_BUCKET));
            inside.addItem(new ItemStack(Material.SOUL_SAND, 8));
            inside.addItem(new ItemStack(Material.CRIMSON_FUNGUS, 2));
            inside.addItem(new ItemStack(Material.WARPED_FUNGUS, 2));
            inside.addItem(new ItemStack(Material.BONE_MEAL, 16));
        }

        // The way home, built and lit, so nobody is stranded by arriving
        // without the obsidian to get back.
        portalFrame(world, cx - 3, HEIGHT + 1, cz);
    }

    private void portalFrame(World world, int x, int y, int z) {
        for (int dy = -1; dy <= 4; dy++) {
            for (int dz = -1; dz <= 2; dz++) {
                boolean edge = dy == -1 || dy == 4 || dz == -1 || dz == 2;

                Block block = world.getBlockAt(x, y + dy, z + dz);

                if (edge) {
                    block.setType(Material.OBSIDIAN, false);
                    continue;
                }

                block.setType(Material.NETHER_PORTAL, false);

                if (block.getBlockData() instanceof Orientable orientable) {
                    orientable.setAxis(org.bukkit.Axis.Z);
                    block.setBlockData(orientable, false);
                }
            }
        }
    }

    /* --------------------------------------------------------------- travel */

    /**
     * A portal on an island, either way.
     *
     * Handled here rather than left to the server for the same reason the
     * survival one is: unhandled, it sends people to the default world's
     * nether, which is a dimension belonging to a world nobody plays in.
     */
    public void portal(PlayerPortalEvent event) {
        Player player = event.getPlayer();
        String from = player.getWorld().getName();

        Worlds.Place place = placeOf(from);

        if (place != null) {
            // Going home.
            event.setTo(place == Worlds.Place.SKYBLOCK
                    ? nexus.skyBlock().islandOf(player.getUniqueId())
                    : nexus.oneBlock().islandOf(player.getUniqueId()));

            event.setCanCreatePortal(false);
            return;
        }

        if (from.equals(Worlds.Place.SKYBLOCK.world)) place = Worlds.Place.SKYBLOCK;
        else if (from.equals(Worlds.Place.ONEBLOCK.world)) place = Worlds.Place.ONEBLOCK;
        else return;

        UUID who = player.getUniqueId();

        Location home = islandOf(place, who);

        // Built on the way in rather than up front, so an island nobody ever
        // lights a portal on costs nothing.
        if (of(place).getBlockAt(home.getBlockX(), HEIGHT, home.getBlockZ())
                .getType() == Material.AIR) {
            build(place, who);
        }

        event.setTo(home);
        event.setCanCreatePortal(false);

        player.sendMessage(Text.says("Your nether island."));
        player.sendMessage(Text.plain("  The portal here goes back."));
    }

    public void warmUp() {
        skyblockWorld();
        oneblockWorld();

        nexus.getLogger().info("skyblock and one block have a nether");
    }
}
