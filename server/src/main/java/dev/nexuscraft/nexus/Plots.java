package dev.nexuscraft.nexus;

import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.Sound;
import org.bukkit.World;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.entity.Player;

import java.io.File;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Creative, divided up so people can build without ruining each other's work.
 *
 * The creative world was one flat sheet of quartz that anybody could edit
 * anywhere, which works until the second player joins. Now it is a grid: a plot
 * is yours, the roads between them are nobody's, and what you build cannot be
 * touched by anyone you have not named.
 *
 * The grid is generated as it is claimed rather than up front. A world of five
 * hundred empty plots costs the same to store as five hundred used ones, and
 * almost all of them would stay empty.
 */
public final class Plots {

    /** How wide a plot is, in blocks. */
    public static final int PLOT = 32;

    /** And the road between two of them. */
    public static final int ROAD = 8;

    /** So plot n starts at n * STEP. */
    public static final int STEP = PLOT + ROAD;

    /** The grass you build on. Everything below is filler. */
    public static final int GROUND = 64;

    private final Nexus nexus;
    private final File file;

    /** Plot key ("0,-2") to who owns it. */
    private final Map<String, UUID> owners = new HashMap<>();

    /** And who else may build there. */
    private final Map<String, Set<UUID>> trusted = new HashMap<>();


    public Plots(Nexus nexus) {
        this.nexus = nexus;
        this.file = new File(nexus.getDataFolder(), "plots.yml");
        load();
    }

    /* ------------------------------------------------------------ geometry */

    /** Which plot a coordinate is in. Roads belong to the plot behind them. */
    public static int indexOf(int coordinate) {
        return Math.floorDiv(coordinate, STEP);
    }

    private static String keyOf(int px, int pz) {
        return px + "," + pz;
    }

    /**
     * Whether a position is inside a plot's buildable square.
     *
     * The roads are deliberately nobody's. A plot that included its road would
     * let somebody wall themselves in and cut off the plots behind them.
     */
    public static boolean onPlot(int x, int z) {
        return Math.floorMod(x, STEP) < PLOT && Math.floorMod(z, STEP) < PLOT;
    }

    /** The middle of a plot, standing on the grass. */
    public Location centreOf(int px, int pz) {
        World world = nexus.worlds().of(Worlds.Place.CREATIVE);

        return new Location(world,
                px * STEP + PLOT / 2.0, GROUND + 1, pz * STEP + PLOT / 2.0);
    }

    /* --------------------------------------------------------------- owning */

    public UUID ownerOf(int px, int pz) {
        return owners.get(keyOf(px, pz));
    }

    /**
     * Whether somebody may build at this exact spot.
     *
     * The roads answer no for everybody, which is what keeps them roads.
     */
    public boolean mayBuild(Player player, Location at) {
        if (player.hasPermission("nexus.admin")) return true;
        if (!onPlot(at.getBlockX(), at.getBlockZ())) return false;

        String key = keyOf(indexOf(at.getBlockX()), indexOf(at.getBlockZ()));
        UUID owner = owners.get(key);

        if (owner == null) return false;
        if (owner.equals(player.getUniqueId())) return true;

        Set<UUID> friends = trusted.get(key);
        return friends != null && friends.contains(player.getUniqueId());
    }

    /** Every plot this player owns. */
    public List<String> ownedBy(UUID who) {
        List<String> out = new ArrayList<>();
        for (Map.Entry<String, UUID> entry : owners.entrySet()) {
            if (entry.getValue().equals(who)) out.add(entry.getKey());
        }
        return out;
    }

    /* -------------------------------------------------------------- ground */

    /**
     * Lays a plot's ground and the roads around it.
     *
     * Idempotent and cheap to ask for: a plot with its ground already down
     * returns immediately, so every command that might need ground can simply
     * ask rather than working out whether it should.
     */
    public void ensureGround(int px, int pz) {
        ensureGround(px, pz, false);
    }

    /**
     * @param force lay it again even though it is already there, which is what
     *              clearing a plot is.
     */
    public void ensureGround(int px, int pz, boolean force) {
        World world = nexus.worlds().of(Worlds.Place.CREATIVE);

        int x0 = px * STEP;
        int z0 = pz * STEP;

        /*
         * Asked of the world, not of a set held in memory.
         *
         * A remembered set is empty again after a restart, and the first thing
         * this class does on boot is lay the ground for the nine plots around
         * the origin - so every restart would have rewritten those nine plots
         * down to bare grass, with whatever was built on them inside the part
         * being rewritten. The bedrock under a plot is only ever put there by
         * this method, which makes it a reliable answer to whether this has
         * already run, and one that survives anything.
         */
        if (!force && world.getBlockAt(x0, GROUND - 4, z0).getType() == Material.BEDROCK) {
            return;
        }

        /*
         * The plot, and the road on two of its four sides.
         *
         * Two rather than four because the neighbour lays the other two. Doing
         * all four would mean every plot rewrote its neighbours' roads, and a
         * road that is rebuilt is a road with somebody's lamp posts missing.
         */
        for (int x = x0; x < x0 + STEP; x++) {
            for (int z = z0; z < z0 + STEP; z++) {
                boolean plot = (x - x0) < PLOT && (z - z0) < PLOT;

                world.getBlockAt(x, GROUND - 4, z).setType(Material.BEDROCK, false);
                for (int y = GROUND - 3; y < GROUND; y++) {
                    world.getBlockAt(x, y, z).setType(Material.DIRT, false);
                }

                world.getBlockAt(x, GROUND, z)
                        .setType(plot ? Material.GRASS_BLOCK : Material.POLISHED_ANDESITE, false);

                // And nothing above it, in case something was here before.
                for (int y = GROUND + 1; y <= GROUND + 6; y++) {
                    world.getBlockAt(x, y, z).setType(Material.AIR, false);
                }
            }
        }

        /*
         * Kerbs down both sides of this cell's road, not around this plot.
         *
         * Drawn around the plot, two of the four sides land in the
         * neighbouring cell - and laying that neighbour later paves straight
         * over them, so plots ended up with two edges and two open sides
         * depending on what order they were claimed in. Both of these rings
         * are inside this cell, so nothing else ever rewrites them: a plot's
         * low kerb is the previous cell's far one, and its high kerb is this
         * cell's near one.
         */
        for (int i = 0; i < STEP; i++) {
            edge(world, x0 + PLOT, z0 + i);
            edge(world, x0 + STEP - 1, z0 + i);
            edge(world, x0 + i, z0 + PLOT);
            edge(world, x0 + i, z0 + STEP - 1);
        }
    }

    private void edge(World world, int x, int z) {
        world.getBlockAt(x, GROUND, z).setType(Material.SMOOTH_STONE, false);
        world.getBlockAt(x, GROUND + 1, z).setType(Material.SMOOTH_STONE_SLAB, false);
    }

    /**
     * The plots around the origin, so arriving in creative is not a fall.
     *
     * Also the migration off the old world: the previous creative world was a
     * single quartz platform, and if it is still there it is cleared first -
     * otherwise the grid would be laid on top of it and the quartz would show
     * through wherever the two did not line up.
     */
    public void warmUp() {
        World world = nexus.worlds().of(Worlds.Place.CREATIVE);

        if (world.getBlockAt(0, GROUND, 0).getType() == Material.SMOOTH_QUARTZ) {
            for (int x = -64; x <= 64; x++) {
                for (int z = -64; z <= 64; z++) {
                    world.getBlockAt(x, GROUND, z).setType(Material.AIR, false);
                }
            }
            nexus.getLogger().info("cleared the old creative platform");
        }

        for (int px = -1; px <= 1; px++) {
            for (int pz = -1; pz <= 1; pz++) ensureGround(px, pz);
        }

        world.setSpawnLocation(-4, GROUND + 1, -4);
    }

    /* ------------------------------------------------------------ commands */

    /**
     * The first free plot, spiralling out from the middle.
     *
     * Outward from the centre so the world stays compact and people end up
     * near each other; a random free plot would scatter twenty builders over a
     * space that takes ten minutes to walk across.
     */
    public void auto(Player player) {
        for (int ring = 0; ring < 64; ring++) {
            for (int px = -ring; px <= ring; px++) {
                for (int pz = -ring; pz <= ring; pz++) {
                    if (Math.max(Math.abs(px), Math.abs(pz)) != ring) continue;
                    if (owners.containsKey(keyOf(px, pz))) continue;

                    give(player, px, pz);
                    return;
                }
            }
        }
        player.sendMessage(Text.bad("No free plots, which should not be possible."));
    }

    public void claim(Player player) {
        if (!inCreative(player)) return;

        int px = indexOf(player.getLocation().getBlockX());
        int pz = indexOf(player.getLocation().getBlockZ());

        UUID owner = ownerOf(px, pz);
        if (owner != null) {
            player.sendMessage(Text.bad(owner.equals(player.getUniqueId())
                    ? "This one is already yours."
                    : "This plot is taken."));
            return;
        }

        give(player, px, pz);
    }

    private void give(Player player, int px, int pz) {
        owners.put(keyOf(px, pz), player.getUniqueId());
        save();

        ensureGround(px, pz);
        player.teleport(centreOf(px, pz));

        player.sendMessage(Text.good("Plot " + px + ", " + pz + " is yours."));
        player.sendMessage(Text.plain("  /plot trust <name> to let somebody build."));
        player.sendMessage(Text.plain("  /plot clear to start it over."));
        player.playSound(player, Sound.ENTITY_PLAYER_LEVELUP, 0.8f, 1.3f);
    }

    public void home(Player player) {
        List<String> mine = ownedBy(player.getUniqueId());

        if (mine.isEmpty()) {
            player.sendMessage(Text.bad("You have no plot."));
            player.sendMessage(Text.plain("  /plot auto to be given one."));
            return;
        }

        String[] parts = mine.get(0).split(",");
        int px = Integer.parseInt(parts[0]);
        int pz = Integer.parseInt(parts[1]);

        ensureGround(px, pz);
        player.teleport(centreOf(px, pz));
    }

    public void visit(Player player, String name) {
        UUID id = nexus.getServer().getOfflinePlayer(name).getUniqueId();
        List<String> theirs = ownedBy(id);
        if (theirs.isEmpty()) {
            player.sendMessage(Text.bad(name + " has no plot."));
            return;
        }

        String[] parts = theirs.get(0).split(",");
        player.teleport(centreOf(Integer.parseInt(parts[0]), Integer.parseInt(parts[1])));
        player.sendMessage(Text.says(name + "'s plot."));
    }

    /** The plot somebody is standing on, if it is theirs to change. */
    private String mineHere(Player player) {
        if (!inCreative(player)) return null;

        int px = indexOf(player.getLocation().getBlockX());
        int pz = indexOf(player.getLocation().getBlockZ());
        String key = keyOf(px, pz);

        UUID owner = owners.get(key);
        if (owner == null) {
            player.sendMessage(Text.bad("Nobody owns this plot."));
            return null;
        }

        if (!owner.equals(player.getUniqueId()) && !player.hasPermission("nexus.admin")) {
            player.sendMessage(Text.bad("This is not your plot."));
            return null;
        }
        return key;
    }

    public void trust(Player player, String name) {
        String key = mineHere(player);
        if (key == null) return;

        Player who = nexus.getServer().getPlayerExact(name);
        if (who == null) {
            player.sendMessage(Text.bad(name + " is not online."));
            return;
        }

        trusted.computeIfAbsent(key, k -> new HashSet<>()).add(who.getUniqueId());
        save();

        player.sendMessage(Text.good(who.getName() + " can build here now."));
        who.sendMessage(Text.says(player.getName() + " trusted you on their plot."));
    }

    public void untrust(Player player, String name) {
        String key = mineHere(player);
        if (key == null) return;

        UUID id = nexus.getServer().getOfflinePlayer(name).getUniqueId();
        Set<UUID> friends = trusted.get(key);

        if (id == null || friends == null || !friends.remove(id)) {
            player.sendMessage(Text.bad(name + " was not trusted here."));
            return;
        }

        save();
        player.sendMessage(Text.good(name + " can no longer build here."));
    }

    /**
     * Back to flat grass, keeping the owner.
     *
     * Separate from giving it up, because wanting to start a build again is
     * much more common than wanting to lose the plot, and one command that did
     * both would eventually do the wrong one.
     */
    public void clear(Player player) {
        String key = mineHere(player);
        if (key == null) return;

        String[] parts = key.split(",");
        int px = Integer.parseInt(parts[0]);
        int pz = Integer.parseInt(parts[1]);

        ensureGround(px, pz, true);

        player.teleport(centreOf(px, pz));
        player.sendMessage(Text.good("Plot cleared."));
    }

    public void delete(Player player) {
        String key = mineHere(player);
        if (key == null) return;

        owners.remove(key);
        trusted.remove(key);
        save();

        player.sendMessage(Text.good("Plot given up."));
        player.sendMessage(Text.plain("  What you built is still there for whoever takes it."));
    }

    public void info(Player player) {
        if (!inCreative(player)) return;

        int px = indexOf(player.getLocation().getBlockX());
        int pz = indexOf(player.getLocation().getBlockZ());

        player.sendMessage(Text.heading("Plot " + px + ", " + pz));

        if (!onPlot(player.getLocation().getBlockX(), player.getLocation().getBlockZ())) {
            player.sendMessage(Text.plain("  You are on the road, which is nobody's."));
        }

        UUID owner = ownerOf(px, pz);
        if (owner == null) {
            player.sendMessage(Text.plain("  Unclaimed. /plot claim to take it."));
            return;
        }

        player.sendMessage(Text.plain("  Owner: " + nexus.getServer().getOfflinePlayer(owner).getName()));

        Set<UUID> friends = trusted.get(keyOf(px, pz));
        if (friends == null || friends.isEmpty()) return;

        List<String> names = new ArrayList<>();
        for (UUID id : friends) {
            names.add(nexus.getServer().getOfflinePlayer(id).getName());
        }

        player.sendMessage(Text.plain("  Trusted: " + String.join(", ", names)));
    }

    public void help(Player player) {
        player.sendMessage(Text.heading("Plots"));
        player.sendMessage(Text.plain("  /plot auto            take the next free one"));
        player.sendMessage(Text.plain("  /plot claim           take the one you stand on"));
        player.sendMessage(Text.plain("  /plot home            go to yours"));
        player.sendMessage(Text.plain("  /plot visit <name>    go to theirs"));
        player.sendMessage(Text.plain("  /plot trust <name>    let them build"));
        player.sendMessage(Text.plain("  /plot untrust <name>  stop them"));
        player.sendMessage(Text.plain("  /plot clear           back to flat grass"));
        player.sendMessage(Text.plain("  /plot delete          give it up"));
        player.sendMessage(Text.plain("  /plot info            who owns this one"));
    }

    private boolean inCreative(Player player) {
        if (player.getWorld().getName().equals(Worlds.Place.CREATIVE.world)) return true;

        player.sendMessage(Text.bad("Plots are in the creative world."));
        return false;
    }

    /* -------------------------------------------------------------- on disk */

    private void load() {
        if (!file.exists()) return;

        YamlConfiguration yaml = YamlConfiguration.loadConfiguration(file);
        var section = yaml.getConfigurationSection("plots");
        if (section == null) return;

        for (String key : section.getKeys(false)) {
            // Stored with a space, because a dot or a comma is a path
            // separator in YAML and "0,-2" would nest rather than be a key.
            String real = key.replace(' ', ',');

            String owner = yaml.getString("plots." + key + ".owner");
            if (owner == null) continue;

            try {
                owners.put(real, UUID.fromString(owner));
            } catch (IllegalArgumentException notAnId) {
                continue;
            }

            Set<UUID> friends = new HashSet<>();
            for (String raw : yaml.getStringList("plots." + key + ".trusted")) {
                try {
                    friends.add(UUID.fromString(raw));
                } catch (IllegalArgumentException notAnId) {
                    /* Hand-edited; skip it. */
                }
            }
            if (!friends.isEmpty()) trusted.put(real, friends);
        }
    }

    public void save() {
        YamlConfiguration yaml = new YamlConfiguration();

        for (Map.Entry<String, UUID> entry : owners.entrySet()) {
            String key = entry.getKey().replace(',', ' ');

            yaml.set("plots." + key + ".owner", entry.getValue().toString());

            Set<UUID> friends = trusted.get(entry.getKey());
            if (friends == null || friends.isEmpty()) continue;

            List<String> raw = new ArrayList<>();
            for (UUID id : friends) raw.add(id.toString());

            yaml.set("plots." + key + ".trusted", raw);
        }

        try {
            yaml.save(file);
        } catch (Exception e) {
            nexus.getLogger().warning("could not save plots: " + e);
        }
    }

    /** For tab completion: the names of people with plots. */
    public List<String> owners() {
        List<String> out = new ArrayList<>();
        for (UUID id : new HashSet<>(owners.values())) {
            out.add(nexus.getServer().getOfflinePlayer(id).getName());
        }
        return out;
    }
}
