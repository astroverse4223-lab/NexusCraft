package dev.nexuscraft.nexus;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.Sound;
import org.bukkit.World;
import org.bukkit.attribute.Attribute;
import org.bukkit.block.Block;
import org.bukkit.block.Chest;
import org.bukkit.block.CreatureSpawner;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.enchantments.Enchantment;
import org.bukkit.entity.EntityType;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;

import java.io.File;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.Set;
import java.util.UUID;

/**
 * Something to go and do in survival, and something to spend the gear on.
 *
 * Survival had a ceiling: full diamond, a base, and then nothing asks anything
 * of you. The nether and the end raised it, and the paid kits made good gear
 * buyable, but neither gave anybody a reason to put it on. A dungeon is that
 * reason - a place that is dangerous on purpose, with loot worth the trip and a
 * boss at the bottom that a single player in iron will not beat.
 *
 * Sites sit on a grid so they can be found rather than stumbled on, and each is
 * built the first time somebody walks near it. Building the world's dungeons up
 * front would be several million blocks, nearly all of them for rooms nobody
 * ever visits.
 */
public final class Dungeons {

    /** How far apart the sites are. Close enough to find, far enough to earn. */
    private static final int SPACING = 768;

    /** How near you have to be for one to be built. */
    private static final int BUILD_RANGE = 120;

    /** The floor. Deep enough to be underground almost anywhere. */
    private static final int FLOOR = 6;

    /** How long after being cleared until the chests fill and the boss returns. */
    private static final int RESET_HOURS = 6;

    private final Nexus nexus;
    private final File file;

    /** Site key ("2,-1") to when it was last cleared, in epoch seconds. */
    private final Map<String, Integer> cleared = new HashMap<>();

    /** Sites whose boss is up right now, so one does not become five. */
    private final Map<String, UUID> bosses = new HashMap<>();

    /** Bosses we are watching, so their death is ours to notice. */
    private final Set<UUID> ours = new HashSet<>();

    public Dungeons(Nexus nexus) {
        this.nexus = nexus;
        this.file = new File(nexus.getDataFolder(), "dungeons.yml");
        load();
    }

    /* ------------------------------------------------------------ geometry */

    /**
     * A box in the world, which is the only shape this builds with.
     *
     * Rooms and corridors are the same thing at different sizes, and a corridor
     * that overlaps a room by a couple of blocks punches its own doorway when
     * the interiors are hollowed - so there is no separate step for doors, and
     * no chance of a door that missed its wall.
     */
    private record Box(int x1, int y1, int z1, int x2, int y2, int z2) {

        boolean holds(int x, int y, int z) {
            return x >= x1 && x <= x2 && y >= y1 && y <= y2 && z >= z1 && z <= z2;
        }

        boolean inside(int x, int y, int z) {
            return x > x1 && x < x2 && y > y1 && y < y2 && z > z1 && z < z2;
        }
    }

    /** Where a site's rooms are, given its middle. */
    private List<Box> roomsOf(int cx, int cz) {
        List<Box> boxes = new ArrayList<>();

        // The two loot rooms and the boss hall, along one axis.
        boxes.add(new Box(cx + 10, FLOOR, cz - 8, cx + 24, FLOOR + 8, cz + 8));
        boxes.add(new Box(cx + 34, FLOOR, cz - 8, cx + 48, FLOOR + 8, cz + 8));
        boxes.add(new Box(cx + 58, FLOOR, cz - 12, cx + 84, FLOOR + 12, cz + 12));

        // The corridors, each overlapping what it joins so the way through is
        // carved rather than cut afterwards.
        boxes.add(new Box(cx - 2, FLOOR, cz - 2, cx + 12, FLOOR + 5, cz + 2));
        boxes.add(new Box(cx + 22, FLOOR, cz - 2, cx + 36, FLOOR + 5, cz + 2));
        boxes.add(new Box(cx + 46, FLOOR, cz - 2, cx + 60, FLOOR + 5, cz + 2));

        return boxes;
    }

    private static String keyOf(int gx, int gz) {
        return gx + "," + gz;
    }

    /**
     * The site nearest this position.
     *
     * Offset by half a spacing so that no site lands on the origin, which is
     * where survival spawn is - the first version put one exactly there, and
     * the entrance ruin would have been carved through spawn the first time
     * anybody stood still near it.
     */
    public int[] nearestSite(Location at) {
        int gx = Math.round((at.getBlockX() - SPACING / 2f) / SPACING);
        int gz = Math.round((at.getBlockZ() - SPACING / 2f) / SPACING);

        return new int[]{gx, gz};
    }

    private static int centreX(int gx) {
        return gx * SPACING + SPACING / 2;
    }

    private static int centreZ(int gz) {
        return gz * SPACING + SPACING / 2;
    }

    /* ------------------------------------------------------------ building */

    private World world() {
        return nexus.worlds().of(Worlds.Place.SURVIVAL);
    }

    /**
     * Whether this site already exists in the world.
     *
     * Asked of the ground rather than of a remembered list, for the same
     * reason the plots are: a list is empty again after a restart, and
     * rebuilding a dungeon somebody is standing in would bury them in it.
     */
    private boolean alreadyBuilt(int cx, int cz) {
        return world().getBlockAt(cx, FLOOR, cz).getType() == Material.CHISELED_STONE_BRICKS;
    }

    public void buildIfNeeded(int gx, int gz) {
        int cx = centreX(gx);
        int cz = centreZ(gz);

        if (alreadyBuilt(cx, cz)) return;

        /*
         * Not through anybody's land.
         *
         * The dungeon is deep, but its entrance shaft goes all the way to the
         * surface and puts a ruin on top - so a site that happens to land on
         * somebody's base would drive a hole through the middle of it. A site
         * that cannot be built is simply skipped; there is another every
         * SPACING blocks and nobody will miss this one.
         */
        if (claimedAnywhere(cx, cz)) {
            nexus.getLogger().info("skipped the dungeon at " + cx + ", " + cz + " - claimed land");
            return;
        }

        World world = world();
        List<Box> boxes = roomsOf(cx, cz);

        // The whole thing as solid stone first, then hollowed. Doing it the
        // other way leaves each box's walls cutting through its neighbour.
        Random grain = new Random(((long) cx << 32) ^ cz);

        int minX = cx - 4;
        int maxX = cx + 88;
        int minZ = cz - 16;
        int maxZ = cz + 16;

        for (int x = minX; x <= maxX; x++) {
            for (int z = minZ; z <= maxZ; z++) {
                for (int y = FLOOR; y <= FLOOR + 12; y++) {
                    if (!anyHolds(boxes, x, y, z)) continue;

                    world.getBlockAt(x, y, z).setType(wall(grain), false);
                }
            }
        }

        for (int x = minX; x <= maxX; x++) {
            for (int z = minZ; z <= maxZ; z++) {
                for (int y = FLOOR; y <= FLOOR + 12; y++) {
                    if (!anyInside(boxes, x, y, z)) continue;

                    world.getBlockAt(x, y, z).setType(Material.AIR, false);
                }
            }
        }

        shaft(world, cx, cz);
        furnish(world, cx, cz, grain);

        // The marker that says this site is done, in the doorway where nothing
        // else ever writes.
        world.getBlockAt(cx, FLOOR, cz).setType(Material.CHISELED_STONE_BRICKS, false);

        nexus.getLogger().info("built a dungeon at " + cx + ", " + cz);
    }

    /** Whether any part of the site's footprint is claimed by somebody. */
    private boolean claimedAnywhere(int cx, int cz) {
        World world = world();

        // Sampled every eight blocks along the length, which is finer than the
        // sixteen-block chunks claims are stored in - so no claimed chunk
        // inside the footprint can fall between two samples.
        for (int dx = -8; dx <= 92; dx += 8) {
            for (int dz = -16; dz <= 16; dz += 8) {
                if (nexus.claims().claimed(new Location(world, cx + dx, FLOOR, cz + dz))) {
                    return true;
                }
            }
        }
        return false;
    }

    private boolean anyHolds(List<Box> boxes, int x, int y, int z) {
        for (Box box : boxes) if (box.holds(x, y, z)) return true;
        return false;
    }

    private boolean anyInside(List<Box> boxes, int x, int y, int z) {
        for (Box box : boxes) if (box.inside(x, y, z)) return true;
        return false;
    }

    /** Old stone, unevenly. A dungeon of clean brick reads as a build, not a ruin. */
    private static Material wall(Random grain) {
        int roll = grain.nextInt(10);

        if (roll < 5) return Material.STONE_BRICKS;
        if (roll < 8) return Material.CRACKED_STONE_BRICKS;
        return Material.MOSSY_STONE_BRICKS;
    }

    /**
     * The way in, from the surface down.
     *
     * Cut after the rooms so it always meets them, and topped with a ruin so
     * that finding a dungeon is something you can do by looking rather than
     * only by running the command.
     */
    private void shaft(World world, int cx, int cz) {
        int top = world.getHighestBlockYAt(cx, cz) + 1;

        for (int y = FLOOR; y <= top + 4; y++) {
            for (int dx = -2; dx <= 2; dx++) {
                for (int dz = -2; dz <= 2; dz++) {
                    Block block = world.getBlockAt(cx + dx, y, cz + dz);

                    boolean edge = Math.abs(dx) == 2 || Math.abs(dz) == 2;

                    if (y > top + 1 && edge) {
                        // The ruin above ground: a broken ring, not a chimney.
                        block.setType((dx + dz) % 2 == 0
                                ? Material.MOSSY_STONE_BRICKS : Material.AIR, false);
                    } else if (edge) {
                        block.setType(Material.STONE_BRICKS, false);
                    } else {
                        block.setType(Material.AIR, false);
                    }
                }
            }
        }

        // Ladders down one wall, so going in is a climb rather than a fall.
        for (int y = FLOOR + 1; y <= top; y++) {
            Block block = world.getBlockAt(cx + 1, y, cz);
            block.setType(Material.LADDER, false);

            if (block.getBlockData() instanceof org.bukkit.block.data.Directional facing) {
                facing.setFacing(org.bukkit.block.BlockFace.WEST);
                block.setBlockData(facing, false);
            }
        }
    }

    /** Lights, spawners and chests, once the rooms are hollow. */
    private void furnish(World world, int cx, int cz, Random grain) {
        int[][] rooms = {
                {cx + 17, cz},
                {cx + 41, cz},
        };

        for (int[] room : rooms) {
            world.getBlockAt(room[0], FLOOR + 1, room[1]).setType(Material.SPAWNER, false);

            Block spawner = world.getBlockAt(room[0], FLOOR + 1, room[1]);
            if (spawner.getState() instanceof CreatureSpawner state) {
                state.setSpawnedType(grain.nextBoolean() ? EntityType.ZOMBIE : EntityType.SKELETON);
                state.setSpawnCount(4);
                state.setMaxNearbyEntities(8);
                state.setRequiredPlayerRange(12);
                state.update();
            }

            chest(world, room[0] - 5, room[1] - 5, false, grain);
            chest(world, room[0] + 5, room[1] + 5, false, grain);

            lantern(world, room[0] - 6, room[1] + 6);
            lantern(world, room[0] + 6, room[1] - 6);
        }

        // The one worth coming for, behind the boss.
        chest(world, cx + 80, cz, true, grain);

        lantern(world, cx + 62, cz - 10);
        lantern(world, cx + 62, cz + 10);
        lantern(world, cx + 80, cz - 10);
        lantern(world, cx + 80, cz + 10);
    }

    private void lantern(World world, int x, int z) {
        world.getBlockAt(x, FLOOR + 1, z).setType(Material.SOUL_LANTERN, false);
    }

    /**
     * A chest with something in it.
     *
     * The live inventory, not the snapshot one. {@code getState()} hands back a
     * copy of the block, and filling that fills nothing - the chest in the
     * world stays empty and there is no error to say so.
     */
    private void chest(World world, int x, int z, boolean best, Random grain) {
        Block block = world.getBlockAt(x, FLOOR + 1, z);
        block.setType(Material.CHEST, false);

        if (!(block.getState() instanceof Chest chest)) return;

        Inventory inside = chest.getBlockInventory();
        inside.clear();

        for (ItemStack stack : loot(best, grain)) {
            inside.setItem(grain.nextInt(inside.getSize()), stack);
        }
    }

    private List<ItemStack> loot(boolean best, Random grain) {
        List<ItemStack> out = new ArrayList<>();

        if (best) {
            ItemStack blade = new ItemStack(Material.DIAMOND_SWORD);
            blade.addUnsafeEnchantment(Enchantment.SHARPNESS, 4);
            blade.addUnsafeEnchantment(Enchantment.UNBREAKING, 3);
            out.add(blade);

            out.add(new ItemStack(Material.DIAMOND, 6 + grain.nextInt(6)));
            out.add(new ItemStack(Material.GOLDEN_APPLE, 3));
            out.add(new ItemStack(Material.ENDER_PEARL, 6));
            out.add(new ItemStack(Material.EXPERIENCE_BOTTLE, 16));
            return out;
        }

        out.add(new ItemStack(Material.IRON_INGOT, 4 + grain.nextInt(8)));
        out.add(new ItemStack(Material.GOLD_INGOT, 2 + grain.nextInt(5)));
        out.add(new ItemStack(Material.COOKED_BEEF, 8));

        if (grain.nextInt(3) == 0) out.add(new ItemStack(Material.DIAMOND, 1 + grain.nextInt(3)));
        if (grain.nextInt(4) == 0) out.add(new ItemStack(Material.GOLDEN_APPLE));

        return out;
    }

    /* ---------------------------------------------------------------- boss */

    private void wake(int gx, int gz) {
        String key = keyOf(gx, gz);
        if (bosses.containsKey(key)) return;

        Integer when = cleared.get(key);
        int now = (int) (System.currentTimeMillis() / 1000);

        if (when != null && now - when < RESET_HOURS * 3600) return;

        World world = world();
        Location at = new Location(world, centreX(gx) + 72, FLOOR + 1, centreZ(gz) + 0.5);

        /*
         * The one that is already down there, if there is one.
         *
         * The map of live bosses is memory only, so after a restart this class
         * believes every hall is empty - while the boss it spawned last night
         * is still standing in it, because it is marked not to despawn. Without
         * this, every restart added another Gaoler to the same room.
         */
        for (var nearby : world.getNearbyEntities(at, 40, 20, 40)) {
            if (!(nearby instanceof LivingEntity other)) continue;
            if (!ours.contains(other.getUniqueId())
                    && !Component.text("The Gaoler", NamedTextColor.DARK_RED)
                    .equals(other.customName())) {
                continue;
            }

            bosses.put(key, other.getUniqueId());
            ours.add(other.getUniqueId());
            return;
        }

        if (!(world.spawnEntity(at, EntityType.WITHER_SKELETON) instanceof LivingEntity beast)) {
            return;
        }

        var health = beast.getAttribute(Attribute.MAX_HEALTH);
        if (health != null) {
            health.setBaseValue(220);
            beast.setHealth(220);
        }

        beast.customName(Component.text("The Gaoler", NamedTextColor.DARK_RED));
        beast.setCustomNameVisible(true);
        beast.setRemoveWhenFarAway(false);

        var gear = beast.getEquipment();
        if (gear != null) {
            ItemStack blade = new ItemStack(Material.NETHERITE_SWORD);
            blade.addUnsafeEnchantment(Enchantment.SHARPNESS, 3);

            gear.setItemInMainHand(blade);
            gear.setHelmet(new ItemStack(Material.NETHERITE_HELMET));
            gear.setItemInMainHandDropChance(0.25f);
        }

        bosses.put(key, beast.getUniqueId());
        ours.add(beast.getUniqueId());

        for (Player player : world.getPlayers()) {
            if (player.getLocation().distanceSquared(at) > 60 * 60) continue;

            player.sendMessage(Text.bad("The Gaoler wakes."));
            player.playSound(player, Sound.ENTITY_WITHER_SPAWN, 0.6f, 1.2f);
        }
    }

    /**
     * A boss dying, which is the only reason this is worth doing.
     *
     * Returns whether it was one of ours, so the caller knows whether the
     * ordinary death handling still applies.
     */
    public boolean killed(LivingEntity beast, Player killer) {
        if (!ours.remove(beast.getUniqueId())) return false;

        String key = null;
        for (Map.Entry<String, UUID> entry : bosses.entrySet()) {
            if (entry.getValue().equals(beast.getUniqueId())) key = entry.getKey();
        }

        if (key != null) {
            bosses.remove(key);
            cleared.put(key, (int) (System.currentTimeMillis() / 1000));
            save();
        }

        if (killer != null) {
            nexus.stats().pay(killer.getUniqueId(), 5_000);
            killer.sendMessage(Text.good("The Gaoler falls. " + Stats.cash(5_000) + "."));
            killer.sendMessage(Text.plain("  The chest behind it is open now."));
        }

        nexus.getServer().broadcast(Component.text(
                (killer == null ? "Somebody" : killer.getName()) + " has beaten a dungeon.",
                NamedTextColor.GOLD));

        return true;
    }

    /* --------------------------------------------------------------- ticking */

    /**
     * Builds and wakes as people walk about.
     *
     * Called on a timer rather than from movement: a move handler runs several
     * times a second for every player on the server, and this needs to happen
     * about once every few seconds.
     */
    public void tick() {
        World survival = nexus.worlds().of(Worlds.Place.SURVIVAL);

        for (Player player : survival.getPlayers()) {
            int[] site = nearestSite(player.getLocation());

            int cx = centreX(site[0]);
            int cz = centreZ(site[1]);

            double away = Math.max(Math.abs(player.getLocation().getX() - cx),
                    Math.abs(player.getLocation().getZ() - cz));

            if (away > BUILD_RANGE) continue;

            buildIfNeeded(site[0], site[1]);

            // In the boss hall, which is the far end of the site.
            double intoHall = player.getLocation().getX() - cx;
            if (intoHall > 56 && intoHall < 88
                    && Math.abs(player.getLocation().getZ() - cz) < 14
                    && player.getLocation().getY() < FLOOR + 14) {
                wake(site[0], site[1]);
            }
        }
    }

    /* ------------------------------------------------------------- command */

    public void where(Player player) {
        if (nexus.worlds().placeOf(player) != Worlds.Place.SURVIVAL) {
            player.sendMessage(Text.bad("Dungeons are in survival."));
            return;
        }

        int[] site = nearestSite(player.getLocation());
        int cx = centreX(site[0]);
        int cz = centreZ(site[1]);

        String key = keyOf(site[0], site[1]);
        Integer when = cleared.get(key);
        int now = (int) (System.currentTimeMillis() / 1000);

        player.sendMessage(Text.heading("Dungeon"));
        player.sendMessage(Text.plain("  Entrance at " + cx + ", " + cz));
        player.sendMessage(Text.plain("  " + (int) player.getLocation().distance(
                new Location(player.getWorld(), cx, player.getLocation().getY(), cz))
                + " blocks away"));

        if (when != null && now - when < RESET_HOURS * 3600) {
            player.sendMessage(Text.plain("  Cleared. The Gaoler returns in "
                    + Text.roughly(RESET_HOURS * 3600 - (now - when)) + "."));
        } else {
            player.sendMessage(Text.plain("  The Gaoler is waiting."));
        }

        player.sendMessage(Text.plain("  They are every " + SPACING + " blocks."));
    }

    /* -------------------------------------------------------------- on disk */

    private void load() {
        if (!file.exists()) return;

        YamlConfiguration yaml = YamlConfiguration.loadConfiguration(file);
        var section = yaml.getConfigurationSection("cleared");
        if (section == null) return;

        for (String key : section.getKeys(false)) {
            cleared.put(key.replace(' ', ','), yaml.getInt("cleared." + key));
        }
    }

    public void save() {
        YamlConfiguration yaml = new YamlConfiguration();

        for (Map.Entry<String, Integer> entry : cleared.entrySet()) {
            // A comma is a path separator in YAML, so it is stored as a space.
            yaml.set("cleared." + entry.getKey().replace(',', ' '), entry.getValue());
        }

        try {
            yaml.save(file);
        } catch (Exception e) {
            nexus.getLogger().warning("could not save dungeons: " + e);
        }
    }
}
