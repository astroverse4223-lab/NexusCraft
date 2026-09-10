package dev.nexuscraft.nexus;

import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.block.Block;
import org.bukkit.block.Container;
import org.bukkit.block.data.BlockData;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;

import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * The starter island, built by hand and copied.
 *
 * Generating one in code means describing a build in arithmetic, and six
 * attempts at a cobblestone generator that way produced obsidian, a flood, a
 * sealed stone box and a wall - because the person who knows what the island
 * should look like is not the one writing the loops.
 *
 * So it is built once, in game, by somebody who can see it, and everything
 * after that is a copy. Block data comes along, so stairs face the right way
 * and logs keep their grain; chests come with what is in them, so the starting
 * kit is whatever was packed rather than a list kept somewhere else.
 */
public final class IslandTemplate {

    /**
     * How far around the standing point is captured.
     *
     * Islands are five hundred and twelve apart, so this cannot reach a
     * neighbour even at the corners, and it is far larger than a starter island
     * has any business being.
     */
    private static final int REACH = 24;
    private static final int BELOW = 16;
    private static final int ABOVE = 32;

    /** Sign text as a string, colour codes and all, for the round trip. */
    private static final net.kyori.adventure.text.serializer.legacy.LegacyComponentSerializer LEGACY =
            net.kyori.adventure.text.serializer.legacy.LegacyComponentSerializer.legacySection();

    private final Nexus nexus;
    private final File file;

    /**
     * One saved block: where it goes, what it is, and anything inside it.
     *
     * Block data covers the shape and which way it faces; it carries nothing
     * about what a chest holds or what a sign says, because those live in the
     * block entity rather than in the block. Both have to be read and written
     * separately, which is why neither came along the first time.
     */
    private record Piece(int x, int y, int z, String data,
                         List<ItemStack> contents, List<String> lines) {
    }

    private final List<Piece> pieces = new ArrayList<>();

    public IslandTemplate(Nexus nexus) {
        this.nexus = nexus;
        this.file = new File(nexus.getDataFolder(), "islandtemplate.yml");
        load();
    }

    public boolean exists() {
        return !pieces.isEmpty();
    }

    public int size() {
        return pieces.size();
    }

    /* -------------------------------------------------------------- capture */

    /**
     * Saves what is around the player as the island everybody starts with.
     *
     * Their own position is the origin, and it is where players arrive - so
     * stand where you would want to be standing.
     */
    public void capture(Player player) {
        Location at = player.getLocation();
        int ox = at.getBlockX();
        int oy = at.getBlockY();
        int oz = at.getBlockZ();

        pieces.clear();

        int liquids = 0;
        int containers = 0;
        int signs = 0;

        for (int x = -REACH; x <= REACH; x++) {
            for (int z = -REACH; z <= REACH; z++) {
                for (int y = -BELOW; y <= ABOVE; y++) {
                    Block block = at.getWorld().getBlockAt(ox + x, oy + y, oz + z);
                    if (block.getType() == Material.AIR) continue;

                    List<ItemStack> holding = null;
                    List<String> lines = null;

                    if (block.getState() instanceof Container box) {
                        /*
                         * getBlockInventory for a chest, not getInventory.
                         *
                         * A block state is a snapshot, and a snapshot's
                         * getInventory hands back a copy - reading it returned
                         * an empty chest and saved a starter kit of nothing,
                         * with no error anywhere to say so. The same trap once
                         * made the starting chest come out empty to begin with.
                         */
                        var inventory = block.getState() instanceof org.bukkit.block.Chest chest
                                ? chest.getBlockInventory()
                                : box.getInventory();

                        holding = new ArrayList<>();
                        for (ItemStack stack : inventory.getContents()) {
                            if (stack != null && stack.getType() != Material.AIR) {
                                holding.add(stack.clone());
                            }
                        }
                        if (!holding.isEmpty()) containers++;
                    }

                    if (block.getState() instanceof org.bukkit.block.Sign sign) {
                        lines = new ArrayList<>();
                        for (org.bukkit.block.sign.Side side : org.bukkit.block.sign.Side.values()) {
                            for (net.kyori.adventure.text.Component line : sign.getSide(side).lines()) {
                                lines.add(LEGACY.serialize(line));
                            }
                        }
                        signs++;
                    }

                    if (block.isLiquid()) liquids++;

                    pieces.add(new Piece(x, y, z, block.getBlockData().getAsString(),
                            holding, lines));
                }
            }
        }

        save();

        player.sendMessage(Text.good("Saved this as the starter island."));
        player.sendMessage(Text.field("Blocks", String.valueOf(pieces.size())));
        player.sendMessage(Text.field("Liquids", String.valueOf(liquids)));
        player.sendMessage(Text.field("Chests with things in", String.valueOf(containers)));
        player.sendMessage(Text.field("Signs", String.valueOf(signs)));
        player.sendMessage(Text.plain("  Where you stood is where players will arrive."));
        player.sendMessage(Text.plain("  /newisland confirm to see it."));
    }

    public void forget(Player player) {
        pieces.clear();
        if (file.exists() && !file.delete()) {
            nexus.getLogger().warning("could not delete " + file);
        }
        player.sendMessage(Text.says("Starter island back to the built-in one."));
    }

    /* ---------------------------------------------------------------- paste */

    /**
     * Lays the saved island down at somebody's spot.
     *
     * Solid blocks first and liquids afterwards, for the same reason the old
     * generator needed: a liquid placed before the walls around it are there
     * runs out over everything, and one placed with physics off never flows at
     * all. Contents go in after the container exists.
     */
    public void paste(Location origin) {
        List<Piece> wet = new ArrayList<>();

        for (Piece piece : pieces) {
            Block block = origin.getWorld().getBlockAt(
                    origin.getBlockX() + piece.x(),
                    origin.getBlockY() + piece.y(),
                    origin.getBlockZ() + piece.z());

            BlockData data;
            try {
                data = Bukkit.createBlockData(piece.data());
            } catch (Exception broken) {
                nexus.getLogger().warning("island template has an unreadable block: " + piece.data());
                continue;
            }

            if (data.getMaterial() == Material.WATER || data.getMaterial() == Material.LAVA) {
                wet.add(piece);
                continue;
            }

            block.setBlockData(data, false);

            if (piece.contents() != null && block.getState() instanceof Container box) {
                var inventory = block.getState() instanceof org.bukkit.block.Chest chest
                        ? chest.getBlockInventory()
                        : box.getInventory();

                inventory.clear();
                for (ItemStack stack : piece.contents()) inventory.addItem(stack.clone());
            }

            if (piece.lines() != null && block.getState() instanceof org.bukkit.block.Sign sign) {
                org.bukkit.block.sign.Side[] sides = org.bukkit.block.sign.Side.values();

                for (int i = 0; i < piece.lines().size() && i / 4 < sides.length; i++) {
                    sign.getSide(sides[i / 4]).line(i % 4,
                            LEGACY.deserialize(piece.lines().get(i)));
                }
                sign.update(true, false);
            }
        }

        // And now the liquids, into a world that is already the right shape.
        for (Piece piece : wet) {
            Block block = origin.getWorld().getBlockAt(
                    origin.getBlockX() + piece.x(),
                    origin.getBlockY() + piece.y(),
                    origin.getBlockZ() + piece.z());
            try {
                block.setBlockData(Bukkit.createBlockData(piece.data()), true);
            } catch (Exception ignored) {
                /* reported already when it was read */
            }
        }
    }

    /* -------------------------------------------------------------- on disk */

    @SuppressWarnings("unchecked")
    private void load() {
        if (!file.exists()) return;

        YamlConfiguration yaml = YamlConfiguration.loadConfiguration(file);
        ConfigurationSection blocks = yaml.getConfigurationSection("blocks");
        if (blocks == null) return;

        for (String key : blocks.getKeys(false)) {
            try {
                String[] parts = key.split("_");
                List<ItemStack> holding = null;

                if (blocks.isList(key + ".contents")) {
                    holding = (List<ItemStack>) blocks.getList(key + ".contents");
                }

                List<String> lines = blocks.isList(key + ".lines")
                        ? blocks.getStringList(key + ".lines")
                        : null;

                pieces.add(new Piece(
                        Integer.parseInt(parts[0]),
                        Integer.parseInt(parts[1]),
                        Integer.parseInt(parts[2]),
                        blocks.getString(key + ".data", "minecraft:stone"),
                        holding,
                        lines));
            } catch (Exception broken) {
                nexus.getLogger().warning("skipping an unreadable template block: " + key);
            }
        }

        nexus.getLogger().info("island template loaded: " + pieces.size() + " blocks");
    }

    public void save() {
        YamlConfiguration yaml = new YamlConfiguration();

        for (Piece piece : pieces) {
            String key = "blocks." + piece.x() + "_" + piece.y() + "_" + piece.z();
            yaml.set(key + ".data", piece.data());
            if (piece.contents() != null && !piece.contents().isEmpty()) {
                yaml.set(key + ".contents", piece.contents());
            }
            if (piece.lines() != null && !piece.lines().isEmpty()) {
                yaml.set(key + ".lines", piece.lines());
            }
        }

        try {
            yaml.save(file);
        } catch (Exception broken) {
            nexus.getLogger().warning("could not save the island template: " + broken);
        }
    }
}
