package dev.nexuscraft.nexus;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Chunk;
import org.bukkit.Location;
import org.bukkit.OfflinePlayer;
import org.bukkit.Sound;
import org.bukkit.block.Block;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.Material;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.ItemMeta;

import java.io.File;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Land that belongs to somebody.
 *
 * The single thing this server could not be hosted without. Survival with
 * strangers and no claims has one ending, and everybody who has ever run a
 * server knows what it is: somebody builds for three weeks, somebody else
 * arrives with flint and steel, and the first person never logs in again.
 *
 * Claims are whole chunks rather than a selected box. It is a real limitation -
 * you cannot claim a circle, and a house on a chunk border needs two - but it
 * buys something worth much more than precision: deciding whether a block is
 * protected is a hash lookup on coordinates the game already computes, so it
 * costs nothing to check on every single block event, which is what protection
 * has to do. A box-based scheme has to test every claim against every event,
 * and the servers that do it are the servers that lag when they get busy.
 *
 * How much you can claim depends on rank, which is a real reason to rank up
 * that costs nobody else anything.
 */
public final class Claims {

    /** How many chunks each rank may hold. */
    private static int allowance(Ranks rank) {
        return switch (rank) {
            case PLAYER -> 40;
            case VIP -> 90;
            case MVP -> 160;
            case ADMIN, OWNER -> 5000;
        };
    }

    /** Worlds where claiming means anything. */
    private static boolean claimable(String world) {
        return world.equals(Worlds.Place.SURVIVAL.world);
    }

    /** One claimed chunk. */
    private record Plot(UUID owner, Set<UUID> trusted) {
    }

    private final Nexus nexus;
    private final File file;

    /** Keyed "world:chunkX:chunkZ", which is what makes the lookup free. */
    private final Map<String, Plot> plots = new HashMap<>();

    /** Who is looking at claim borders, and who has protection switched off. */
    private final Set<UUID> ignoring = new HashSet<>();

    /**
     * A corner somebody has marked with the wand.
     *
     * Held in memory only. A half finished selection is not worth writing to
     * disk, and a stale one loaded at startup would be worse than none.
     */
    private record Corner(String world, int x, int z) {
    }

    private final Map<UUID, Corner> first = new HashMap<>();
    private final Map<UUID, Corner> second = new HashMap<>();

    /** Marks the wand, so a renamed shovel from an anvil is not one. */
    private final org.bukkit.NamespacedKey wandKey;

    public Claims(Nexus nexus) {
        this.nexus = nexus;
        this.file = new File(nexus.getDataFolder(), "claims.yml");
        this.wandKey = new org.bukkit.NamespacedKey(nexus, "claim_wand");
        load();
    }

    /* ---------------------------------------------------------------- wand */

    /**
     * The tool for marking out a plot.
     *
     * A golden shovel, because that is what every server that has ever had one
     * used, so it needs no explaining. Marked in its own data rather than by
     * its name: a name can be typed into an anvil, and a shovel that claims
     * land because somebody renamed it is not a feature.
     */
    public ItemStack wand() {
        ItemStack item = new ItemStack(Material.GOLDEN_SHOVEL);
        ItemMeta meta = item.getItemMeta();

        meta.displayName(plain("Claim Wand", NamedTextColor.GOLD));
        meta.lore(java.util.List.of(
                plain("Left click  one corner", NamedTextColor.GRAY),
                plain("Right click the other", NamedTextColor.GRAY),
                plain("/claim to keep it", NamedTextColor.GRAY)));
        meta.getPersistentDataContainer()
                .set(wandKey, org.bukkit.persistence.PersistentDataType.BYTE, (byte) 1);

        item.setItemMeta(meta);
        return item;
    }

    /** Item text without the italics Minecraft adds to anything renamed. */
    private static Component plain(String text, NamedTextColor colour) {
        return Component.text(text, colour)
                .decoration(net.kyori.adventure.text.format.TextDecoration.ITALIC, false);
    }

    public boolean isWand(ItemStack item) {
        if (item == null || item.getType() != Material.GOLDEN_SHOVEL) return false;
        ItemMeta meta = item.getItemMeta();
        return meta != null && meta.getPersistentDataContainer()
                .has(wandKey, org.bukkit.persistence.PersistentDataType.BYTE);
    }

    public void giveWand(Player player) {
        player.getInventory().addItem(wand());
        player.sendMessage(Text.good("Claim wand."));
        player.sendMessage(Text.plain("  Left click one corner, right click the other, then /claim."));
    }

    /**
     * Marks a corner.
     *
     * Snapped to chunks as they click, because a claim is chunks. Showing
     * somebody a neat rectangle and then protecting a different, chunk shaped
     * area would be a lie told in particles.
     */
    public void mark(Player player, Block block, boolean firstCorner) {
        if (!claimable(block.getWorld().getName())) {
            player.sendMessage(Text.bad("You can only claim land in survival."));
            return;
        }

        Corner corner = new Corner(block.getWorld().getName(),
                block.getChunk().getX(), block.getChunk().getZ());

        (firstCorner ? first : second).put(player.getUniqueId(), corner);
        player.playSound(player, Sound.BLOCK_AMETHYST_BLOCK_CHIME, 0.7f,
                firstCorner ? 1.0f : 1.4f);

        Corner other = (firstCorner ? second : first).get(player.getUniqueId());

        if (other == null || !other.world().equals(corner.world())) {
            player.sendMessage(Text.says((firstCorner ? "First" : "Second") + " corner set."));
            return;
        }

        int wide = Math.abs(corner.x() - other.x()) + 1;
        int tall = Math.abs(corner.z() - other.z()) + 1;

        player.sendMessage(Text.says(wide + " x " + tall + " chunks, " + (wide * tall)
                + " claim" + (wide * tall == 1 ? "" : "s") + "."));
        player.sendMessage(Text.plain("  /claim to keep it."));
    }

    /** The chunk keys a selection covers, or null when there is not a whole one. */
    private List<String> selected(UUID who) {
        Corner a = first.get(who);
        Corner b = second.get(who);
        if (a == null || b == null || !a.world().equals(b.world())) return null;

        List<String> keys = new ArrayList<>();
        for (int x = Math.min(a.x(), b.x()); x <= Math.max(a.x(), b.x()); x++) {
            for (int z = Math.min(a.z(), b.z()); z <= Math.max(a.z(), b.z()); z++) {
                keys.add(key(a.world(), x, z));
            }
        }
        return keys;
    }

    public boolean hasSelection(UUID who) {
        return selected(who) != null;
    }

    public void clearSelection(UUID who) {
        first.remove(who);
        second.remove(who);
    }

    /**
     * Claims everything inside the marked box.
     *
     * All of it or none of it. Claiming as much as the allowance covers and
     * stopping partway would leave somebody with a protected L shape they did
     * not ask for and cannot see the edges of.
     */
    public void claimSelection(Player player) {
        List<String> keys = selected(player.getUniqueId());
        if (keys == null) {
            player.sendMessage(Text.bad("Mark two corners with the wand first."));
            return;
        }

        List<String> taken = new ArrayList<>();
        int mine = 0;

        for (String key : keys) {
            Plot plot = plots.get(key);
            if (plot == null) continue;
            if (plot.owner().equals(player.getUniqueId())) mine++;
            else taken.add(key);
        }

        if (!taken.isEmpty()) {
            Plot plot = plots.get(taken.get(0));
            player.sendMessage(Text.bad(taken.size() + " of those chunks are somebody else's."));
            player.sendMessage(Text.plain("  The first belongs to " + nameOf(plot.owner()) + "."));
            return;
        }

        int wanted = keys.size() - mine;
        if (wanted == 0) {
            player.sendMessage(Text.says("You already own all of that."));
            return;
        }

        int have = countOf(player.getUniqueId());
        int allowed = allowance(nexus.stats().rankOf(player.getUniqueId()));

        if (have + wanted > allowed) {
            player.sendMessage(Text.bad("That needs " + wanted + " claims and you have "
                    + (allowed - have) + " left."));
            player.sendMessage(Text.plain("  Mark a smaller area, /unclaim some, or rank up."));
            return;
        }

        for (String key : keys) {
            plots.putIfAbsent(key, new Plot(player.getUniqueId(), new HashSet<>()));
        }
        save();
        clearSelection(player.getUniqueId());

        player.sendMessage(Text.good("Claimed " + wanted + " chunk"
                + (wanted == 1 ? "" : "s") + ".  (" + (have + wanted) + " of " + allowed + ")"));
        player.playSound(player, Sound.BLOCK_AMETHYST_BLOCK_CHIME, 0.9f, 1.2f);
    }

    /**
     * Draws the edges people are standing near, for anyone holding the wand.
     *
     * Only the outside edge of a run of chunks, not every chunk boundary: a
     * grid drawn over a twenty chunk claim is a wall of particles you cannot
     * see the shape of. An edge is drawn where the chunk beyond it is not part
     * of the same thing.
     */
    public void tick() {
        for (Player player : nexus.getServer().getOnlinePlayers()) {
            if (!isWand(player.getInventory().getItemInMainHand())) continue;
            if (!claimable(player.getWorld().getName())) continue;

            UUID who = player.getUniqueId();
            List<String> box = selected(who);
            double y = player.getLocation().getY() + 0.2;

            Chunk here = player.getLocation().getChunk();
            String world = player.getWorld().getName();

            for (int dx = -3; dx <= 3; dx++) {
                for (int dz = -3; dz <= 3; dz++) {
                    int cx = here.getX() + dx;
                    int cz = here.getZ() + dz;
                    String key = key(world, cx, cz);

                    boolean inBox = box != null && box.contains(key);
                    Plot plot = plots.get(key);
                    boolean owned = plot != null;

                    if (!inBox && !owned) continue;

                    // Selection wins the colour, since that is what is being
                    // decided; otherwise yours and somebody else's differ.
                    org.bukkit.Particle particle = inBox
                            ? org.bukkit.Particle.WAX_ON
                            : plot.owner().equals(who)
                                    ? org.bukkit.Particle.HAPPY_VILLAGER
                                    : org.bukkit.Particle.SMALL_FLAME;

                    edges(player, world, cx, cz, y, inBox ? box : null, particle);
                }
            }
        }
    }

    /** The sides of one chunk that face something different. */
    private void edges(Player player, String world, int cx, int cz, double y,
                       List<String> box, org.bukkit.Particle particle) {
        int baseX = cx << 4;
        int baseZ = cz << 4;

        boolean north = !same(world, cx, cz - 1, box);
        boolean south = !same(world, cx, cz + 1, box);
        boolean west = !same(world, cx - 1, cz, box);
        boolean east = !same(world, cx + 1, cz, box);

        for (int step = 0; step <= 16; step += 2) {
            if (north) player.spawnParticle(particle, baseX + step, y, baseZ, 1, 0, 0.3, 0, 0);
            if (south) player.spawnParticle(particle, baseX + step, y, baseZ + 16, 1, 0, 0.3, 0, 0);
            if (west) player.spawnParticle(particle, baseX, y, baseZ + step, 1, 0, 0.3, 0, 0);
            if (east) player.spawnParticle(particle, baseX + 16, y, baseZ + step, 1, 0, 0.3, 0, 0);
        }
    }

    /** Whether the neighbouring chunk belongs to the same thing being drawn. */
    private boolean same(String world, int cx, int cz, List<String> box) {
        String key = key(world, cx, cz);
        if (box != null) return box.contains(key);

        Plot plot = plots.get(key);
        return plot != null;
    }

    private static String key(String world, int x, int z) {
        return world + ":" + x + ":" + z;
    }

    private static String key(Chunk chunk) {
        return key(chunk.getWorld().getName(), chunk.getX(), chunk.getZ());
    }

    /* ------------------------------------------------------------ the answer */

    /**
     * Whether somebody may change this block.
     *
     * The hot path. Called from block break, block place, bucket use, and every
     * container opened anywhere on the server, so it does no allocation and no
     * iteration in the common case of unclaimed land.
     */
    public boolean mayBuild(Player player, Block block) {
        UUID who = player.getUniqueId();
        String world = block.getWorld().getName();

        /*
         * The island worlds answer for themselves.
         *
         * Skyblock and one block put every player on their own island on a
         * fixed grid, so who owns a position is arithmetic - there is nothing
         * to claim and nothing to run out of, and the protection is complete
         * from the first day rather than only where somebody remembered.
         */
        if (world.equals(Worlds.Place.SKYBLOCK.world)) {
            return nexus.skyBlock().isTheirs(who, block.getX(), block.getZ())
                    || overriding(player);
        }
        /*
         * A nether island belongs to whoever the overworld one belongs to.
         *
         * Asked before the two world checks below, because the nether worlds
         * are not either of those names and would otherwise fall through to
         * the claim grid - which has no claims out there, so every island
         * would have been open to anybody who found it.
         */
        Worlds.Place island = IslandNether.placeOf(world);
        if (island != null) {
            return nexus.islandNether().isTheirs(who, block.getX(), block.getZ())
                    || overriding(player);
        }

        if (world.equals(Worlds.Place.ONEBLOCK.world)) {
            return nexus.oneBlock().isTheirs(who, block.getX(), block.getZ())
                    || overriding(player);
        }

        Plot plot = plots.get(key(world, block.getX() >> 4, block.getZ() >> 4));
        if (plot == null) return true;

        if (plot.owner().equals(who) || plot.trusted().contains(who)) return true;

        /*
         * Your guild's land is your land.
         *
         * The alternative is every member running /trust for every other
         * member on every claim, which is n-squared commands and is wrong
         * again the moment somebody joins.
         */
        if (nexus.guilds().together(plot.owner(), who)) return true;

        return overriding(player);
    }

    /** Staff who have deliberately switched protection off for themselves. */
    private boolean overriding(Player player) {
        // Admin alone is not enough - an admin who forgets is an admin who
        // accidentally rearranges a stranger's house.
        return ignoring.contains(player.getUniqueId())
                && player.hasPermission("nexus.admin");
    }

    /** Same question, with the refusal message people actually see. */
    public boolean refuse(Player player, Block block) {
        if (mayBuild(player, block)) return false;

        Plot plot = plots.get(key(block.getWorld().getName(),
                block.getX() >> 4, block.getZ() >> 4));

        // No plot means an island world, where there is nobody to name: the
        // grid knows the ground is not yours without knowing whose it is.
        player.sendMessage(plot == null
                ? Text.bad("This is somebody else's island.")
                : Text.bad("This land belongs to " + nameOf(plot.owner()) + "."));

        player.playSound(player, Sound.BLOCK_NOTE_BLOCK_BASS, 0.6f, 0.6f);
        return true;
    }

    /** Whether anything at all is claimed here, for explosions and fire. */
    public boolean claimed(Location at) {
        return plots.containsKey(key(at.getWorld().getName(),
                at.getBlockX() >> 4, at.getBlockZ() >> 4));
    }

    /* -------------------------------------------------------------- claiming */

    public void claim(Player player) {
        Chunk chunk = player.getLocation().getChunk();
        String world = chunk.getWorld().getName();

        if (!claimable(world)) {
            player.sendMessage(Text.bad("You can only claim land in survival."));
            return;
        }

        Plot already = plots.get(key(chunk));
        if (already != null) {
            player.sendMessage(already.owner().equals(player.getUniqueId())
                    ? Text.says("You already own this.")
                    : Text.bad("Claimed by " + nameOf(already.owner()) + "."));
            return;
        }

        int have = countOf(player.getUniqueId());
        int allowed = allowance(nexus.stats().rankOf(player.getUniqueId()));

        if (have >= allowed) {
            player.sendMessage(Text.bad("You have used all " + allowed + " of your claims."));
            player.sendMessage(Text.plain("  /unclaim to free one up, or rank up for more."));
            return;
        }

        plots.put(key(chunk), new Plot(player.getUniqueId(), new HashSet<>()));
        save();

        player.sendMessage(Text.good("Claimed."
                + "  (" + (have + 1) + " of " + allowed + ")"));
        player.playSound(player, Sound.BLOCK_AMETHYST_BLOCK_CHIME, 0.9f, 1.2f);
        outline(player, chunk);
    }

    public void unclaim(Player player) {
        Chunk chunk = player.getLocation().getChunk();
        Plot plot = plots.get(key(chunk));

        if (plot == null) {
            player.sendMessage(Text.says("Nothing is claimed here."));
            return;
        }
        if (!plot.owner().equals(player.getUniqueId()) && !player.hasPermission("nexus.admin")) {
            player.sendMessage(Text.bad("That is " + nameOf(plot.owner()) + "'s."));
            return;
        }

        plots.remove(key(chunk));
        save();
        player.sendMessage(Text.good("Unclaimed."));
    }

    /**
     * Letting somebody else build on all of your land.
     *
     * Per player rather than per chunk, deliberately. Trusting a friend chunk
     * by chunk sounds more careful and is in practice how people end up with a
     * friend who can open eleven of their twelve chests.
     */
    public void trust(Player player, String name) {
        OfflinePlayer them = nexus.getServer().getOfflinePlayer(name);

        if (them.getUniqueId().equals(player.getUniqueId())) {
            player.sendMessage(Text.says("You already trust yourself."));
            return;
        }

        int touched = 0;
        for (Plot plot : plots.values()) {
            if (!plot.owner().equals(player.getUniqueId())) continue;
            if (plot.trusted().add(them.getUniqueId())) touched++;
        }

        if (touched == 0) {
            player.sendMessage(Text.says("You have no land to share. /claim first."));
            return;
        }

        save();
        player.sendMessage(Text.good(name + " can now build on your " + touched + " claims."));

        Player online = nexus.getServer().getPlayerExact(name);
        if (online != null) {
            online.sendMessage(Text.says(player.getName() + " trusted you with their land."));
        }
    }

    public void untrust(Player player, String name) {
        OfflinePlayer them = nexus.getServer().getOfflinePlayer(name);

        int touched = 0;
        for (Plot plot : plots.values()) {
            if (!plot.owner().equals(player.getUniqueId())) continue;
            if (plot.trusted().remove(them.getUniqueId())) touched++;
        }

        save();
        player.sendMessage(touched == 0
                ? Text.says(name + " was not trusted.")
                : Text.good(name + " can no longer build on your land."));
    }

    /** What is under your feet, and who else may touch it. */
    public void info(Player player) {
        Chunk chunk = player.getLocation().getChunk();
        Plot plot = plots.get(key(chunk));

        player.sendMessage(Text.heading("This land"));

        if (plot == null) {
            player.sendMessage(Text.plain("  Nobody owns it."));
            player.sendMessage(claimable(chunk.getWorld().getName())
                    ? Text.plain("  /claim to take it.")
                    : Text.plain("  Land here cannot be claimed."));
            return;
        }

        player.sendMessage(Text.field("Owner", nameOf(plot.owner())));

        if (plot.trusted().isEmpty()) {
            player.sendMessage(Text.field("Trusted", "nobody"));
        } else {
            List<String> names = new ArrayList<>();
            for (UUID id : plot.trusted()) names.add(nameOf(id));
            player.sendMessage(Text.field("Trusted", String.join(", ", names)));
        }

        outline(player, chunk);
    }

    public void list(Player player) {
        int have = countOf(player.getUniqueId());
        int allowed = allowance(nexus.stats().rankOf(player.getUniqueId()));

        player.sendMessage(Text.heading("Your land"));
        player.sendMessage(Text.field("Claims", have + " of " + allowed));

        int shown = 0;
        for (Map.Entry<String, Plot> entry : plots.entrySet()) {
            if (!entry.getValue().owner().equals(player.getUniqueId())) continue;
            if (++shown > 12) continue;

            String[] parts = entry.getKey().split(":");
            int blockX = Integer.parseInt(parts[1]) << 4;
            int blockZ = Integer.parseInt(parts[2]) << 4;

            player.sendMessage(Component.text("  " + blockX + ", " + blockZ,
                    NamedTextColor.DARK_GRAY));
        }
        if (shown > 12) player.sendMessage(Text.plain("  and " + (shown - 12) + " more."));
    }

    /**
     * Staff switching protection off for themselves.
     *
     * Announced in their own chat every time it changes because the failure it
     * prevents is silent: an admin who left it on, forgot, and spent an hour
     * rearranging a stranger's base believing it was unclaimed.
     */
    public void toggleIgnore(Player player) {
        if (ignoring.remove(player.getUniqueId())) {
            player.sendMessage(Text.good("Claims are protected from you again."));
            return;
        }
        ignoring.add(player.getUniqueId());
        player.sendMessage(Text.bad("You can now build inside other people's claims."));
    }

    /* --------------------------------------------------------------- showing */

    /**
     * Drawing the edge of a chunk so you can see what you own.
     *
     * Particles rather than blocks, because the alternative - the glowing gold
     * outline other servers use - means placing and removing real blocks in
     * somebody's build, and a crash halfway through leaves them there.
     */
    private void outline(Player player, Chunk chunk) {
        int baseX = chunk.getX() << 4;
        int baseZ = chunk.getZ() << 4;
        double y = player.getLocation().getY() + 0.2;

        for (int step = 0; step <= 16; step++) {
            spark(player, baseX + step, y, baseZ);
            spark(player, baseX + step, y, baseZ + 16);
            spark(player, baseX, y, baseZ + step);
            spark(player, baseX + 16, y, baseZ + step);
        }
    }

    private void spark(Player player, double x, double y, double z) {
        player.spawnParticle(org.bukkit.Particle.HAPPY_VILLAGER, x, y, z, 1, 0, 0.4, 0, 0);
    }

    private int countOf(UUID who) {
        int count = 0;
        for (Plot plot : plots.values()) if (plot.owner().equals(who)) count++;
        return count;
    }

    private String nameOf(UUID who) {
        String name = nexus.getServer().getOfflinePlayer(who).getName();
        return name == null ? "somebody" : name;
    }

    public int total() {
        return plots.size();
    }

    /**
     * Proves a claim key survives being written and read back.
     *
     * Worth a test rather than a look because of how it failed last time: YAML
     * treats a colon inside a key as the end of the key, so `world:3:4` comes
     * back as three nested sections and every claim silently disappears. That
     * is the same shape of bug that emptied the holograms file, and it does not
     * announce itself - the file looks fine, the server starts fine, and the
     * land is simply unprotected.
     *
     * Done entirely in memory, so running it cannot damage the real file.
     */
    public String selfTest() {
        UUID owner = UUID.nameUUIDFromBytes("nexus-selftest".getBytes());
        UUID friend = UUID.nameUUIDFromBytes("nexus-selftest-friend".getBytes());

        // Negative coordinates included, since a minus sign is the other thing
        // that can be read as syntax rather than as part of a name.
        String original = key("nexus_survival", -3, 4);

        YamlConfiguration out = new YamlConfiguration();
        String at = original.replace(':', ',');
        out.set(at + ".owner", owner.toString());
        out.set(at + ".trusted", List.of(friend.toString()));

        YamlConfiguration back = new YamlConfiguration();
        try {
            back.loadFromString(out.saveToString());
        } catch (Exception broken) {
            return "claims cannot be written: " + broken;
        }

        List<String> keys = new ArrayList<>(back.getKeys(false));
        if (keys.size() != 1) return "one claim wrote " + keys.size() + " entries";

        String read = keys.get(0).replace(',', ':');
        if (!read.equals(original)) return "key came back as " + read;

        String readOwner = back.getString(keys.get(0) + ".owner");
        if (!owner.toString().equals(readOwner)) return "owner came back as " + readOwner;

        List<String> readTrusted = back.getStringList(keys.get(0) + ".trusted");
        if (readTrusted.size() != 1 || !readTrusted.get(0).equals(friend.toString())) {
            return "trusted came back as " + readTrusted;
        }

        return islandTest();
    }

    /**
     * The island worlds, where ownership is arithmetic rather than a record.
     *
     * Checks the two edges that matter: the far corner of somebody's own cell
     * still belongs to them, and the block after it does not.
     */
    private String islandTest() {
        UUID probe = UUID.nameUUIDFromBytes("nexus-selftest".getBytes());

        Location island = nexus.skyBlock().islandOf(probe);
        int x = island.getBlockX();
        int z = island.getBlockZ();

        if (!nexus.skyBlock().isTheirs(probe, x, z)) {
            return "an island does not belong to the person it was made for";
        }
        if (!nexus.skyBlock().isTheirs(probe, x + 255, z + 255)) {
            return "the far corner of an island is not theirs";
        }
        if (!nexus.skyBlock().isTheirs(probe, x - 256, z - 256)) {
            return "the near corner of an island is not theirs";
        }
        if (nexus.skyBlock().isTheirs(probe, x + 256, z)) {
            return "the next island along counts as theirs";
        }
        if (nexus.skyBlock().isTheirs(probe, x, z - 257)) {
            return "the island behind counts as theirs";
        }

        return "ok";
    }

    /* -------------------------------------------------------------- on disk */

    private void load() {
        if (!file.exists()) return;

        YamlConfiguration yaml = YamlConfiguration.loadConfiguration(file);
        for (String at : yaml.getKeys(false)) {
            String owner = yaml.getString(at + ".owner");
            if (owner == null) continue;

            Set<UUID> trusted = new HashSet<>();
            for (String id : yaml.getStringList(at + ".trusted")) {
                try {
                    trusted.add(UUID.fromString(id));
                } catch (IllegalArgumentException notAnId) {
                    // A hand-edited file should not stop the server loading.
                }
            }

            try {
                // Colons are the separator, so the key is stored with commas.
                plots.put(at.replace(',', ':'), new Plot(UUID.fromString(owner), trusted));
            } catch (IllegalArgumentException notAnId) {
                nexus.getLogger().warning("skipping claim with a bad owner: " + at);
            }
        }

        nexus.getLogger().info(plots.size() + " claims loaded");
    }

    public void save() {
        YamlConfiguration yaml = new YamlConfiguration();

        for (Map.Entry<String, Plot> entry : plots.entrySet()) {
            /*
             * Colons become commas on the way to disk.
             *
             * YAML reads a colon in a key as the end of the key, so a world
             * called `nexus_survival` at chunk 3:4 would come back as three
             * nested sections. Learned the hard way on the holograms file.
             */
            String at = entry.getKey().replace(':', ',');

            yaml.set(at + ".owner", entry.getValue().owner().toString());

            List<String> trusted = new ArrayList<>();
            for (UUID id : entry.getValue().trusted()) trusted.add(id.toString());
            if (!trusted.isEmpty()) yaml.set(at + ".trusted", trusted);
        }

        try {
            yaml.save(file);
        } catch (Exception e) {
            nexus.getLogger().warning("could not save claims: " + e);
        }
    }
}
