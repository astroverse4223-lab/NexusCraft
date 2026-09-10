package dev.nexuscraft.nexus;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.block.Block;
import org.bukkit.block.data.BlockData;
import org.bukkit.entity.Player;

import java.io.BufferedWriter;
import java.io.File;
import java.io.FileWriter;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * Who touched what, and when.
 *
 * Claims stop the grief that happens on land somebody owns. This is for
 * everything else - the shared road, the spawn, the chunk they had not claimed
 * yet, the trusted friend who turned out not to be one. Without it, "somebody
 * burned my house down" is a story with no ending, because there is nothing on
 * the server that knows who was standing there.
 *
 * Deliberately not a database. CoreProtect and friends run MySQL or SQLite and
 * are better than this at scale, but they are also a dependency, a schema, and
 * a thing to keep running. This is an append-only text file and a list in
 * memory, which is enough for a server with a few dozen people on it and has
 * the property that when it breaks you can read it with Notepad.
 *
 * What it costs is bounded on purpose: entries older than the keep window are
 * dropped at startup, and the list is capped, because a log that grows forever
 * eventually becomes the reason the server will not start.
 */
public final class BlockLog {

    /** How far back the log goes. */
    private static final int KEEP_DAYS = 14;

    /** The most entries held in memory at once, oldest dropped first. */
    private static final int CAP = 400_000;

    /** How often, in seconds, new entries are written out. */
    private static final int FLUSH_EVERY = 10;

    /** One thing somebody did to one block. */
    private record Change(int at, UUID who, boolean placed,
                          String world, int x, int y, int z, String data) {

        String line() {
            return at + "|" + who + "|" + (placed ? "P" : "B") + "|"
                    + world + "|" + x + "|" + y + "|" + z + "|" + data;
        }

        static Change read(String line) {
            String[] parts = line.split("\\|", 8);
            if (parts.length < 8) return null;

            try {
                return new Change(
                        Integer.parseInt(parts[0]),
                        UUID.fromString(parts[1]),
                        parts[2].equals("P"),
                        parts[3],
                        Integer.parseInt(parts[4]),
                        Integer.parseInt(parts[5]),
                        Integer.parseInt(parts[6]),
                        parts[7]);
            } catch (RuntimeException damaged) {
                return null;
            }
        }
    }

    private final Nexus nexus;
    private final File file;

    private final Deque<Change> history = new ArrayDeque<>();

    /** Written but not yet flushed. Swapped out whole on the main thread. */
    private List<Change> pending = new ArrayList<>();

    /** Who is holding the inspector. */
    private final Set<UUID> inspecting = new HashSet<>();

    private int ticks;

    public BlockLog(Nexus nexus) {
        this.nexus = nexus;
        this.file = new File(nexus.getDataFolder(), "blocks.log");
        load();
    }

    /* -------------------------------------------------------------- writing */

    public void placed(Player player, Block block) {
        note(player, block, true, block.getBlockData().getAsString());
    }

    /**
     * A block about to be broken.
     *
     * Must be called before the break happens, because what is worth recording
     * is what was there - the material, the direction a stair faced, whether
     * the chest was the left half. Reading it afterwards records air.
     */
    public void broke(Player player, Block block) {
        note(player, block, false, block.getBlockData().getAsString());
    }

    private void note(Player player, Block block, boolean placed, String data) {
        // Only worlds people build in. Logging a minigame arena that is deleted
        // when the match ends is pure cost.
        String world = block.getWorld().getName();
        if (!worth(world)) return;

        Change change = new Change(
                (int) (System.currentTimeMillis() / 1000),
                player.getUniqueId(), placed, world,
                block.getX(), block.getY(), block.getZ(), data);

        history.addLast(change);
        pending.add(change);

        while (history.size() > CAP) history.removeFirst();
    }

    private static boolean worth(String world) {
        return world.equals(Worlds.Place.SURVIVAL.world)
                || world.equals(Worlds.Place.CREATIVE.world)
                || world.equals(Worlds.Place.SKYBLOCK.world)
                || world.equals(Worlds.Place.ONEBLOCK.world);
    }

    /* -------------------------------------------------------------- reading */

    /** Right-click while inspecting. */
    public boolean isInspecting(UUID who) {
        return inspecting.contains(who);
    }

    /** Somebody has left, so they are not holding the inspector any more. */
    public void forget(Player player) {
        inspecting.remove(player.getUniqueId());
    }

    public void toggleInspect(Player player) {
        if (inspecting.remove(player.getUniqueId())) {
            player.sendMessage(Text.good("Inspector off."));
            return;
        }
        inspecting.add(player.getUniqueId());
        player.sendMessage(Text.good("Inspector on. Click a block to see its history."));
        player.sendMessage(Text.plain("  /inspect again to stop."));
    }

    /**
     * Everything that ever happened at one position.
     *
     * Newest first, because the question is almost always "who did this", not
     * "how did this come to be".
     */
    public void show(Player player, Block block) {
        List<Change> found = new ArrayList<>();

        for (Change change : history) {
            if (change.x() == block.getX() && change.y() == block.getY()
                    && change.z() == block.getZ()
                    && change.world().equals(block.getWorld().getName())) {
                found.add(change);
            }
        }

        player.sendMessage(Text.heading(block.getX() + ", " + block.getY()
                + ", " + block.getZ()));

        if (found.isEmpty()) {
            player.sendMessage(Text.plain("  Nothing in the last "
                    + KEEP_DAYS + " days."));
            return;
        }

        int now = (int) (System.currentTimeMillis() / 1000);

        for (int i = found.size() - 1; i >= 0 && i >= found.size() - 8; i--) {
            Change change = found.get(i);

            player.sendMessage(Component.text("  " + Text.roughly(now - change.at()),
                            NamedTextColor.DARK_GRAY)
                    .append(Component.text("  " + nameOf(change.who()), NamedTextColor.WHITE))
                    .append(Component.text(change.placed() ? " placed " : " broke ",
                            change.placed() ? NamedTextColor.GREEN : NamedTextColor.RED))
                    .append(Component.text(shortName(change.data()), Text.BRAND)));
        }
    }

    /** What one player has been doing lately, wherever they did it. */
    public void recent(org.bukkit.command.CommandSender asker, String name, int minutes) {
        UUID who = nexus.getServer().getOfflinePlayer(name).getUniqueId();
        int since = (int) (System.currentTimeMillis() / 1000) - minutes * 60;

        List<Change> found = new ArrayList<>();
        for (Change change : history) {
            if (change.who().equals(who) && change.at() >= since) found.add(change);
        }

        asker.sendMessage(Text.heading(name + ", last " + minutes + " minutes"));

        if (found.isEmpty()) {
            asker.sendMessage(Text.plain("  Nothing."));
            return;
        }

        asker.sendMessage(Text.field("Changes", String.valueOf(found.size())));

        for (int i = found.size() - 1; i >= 0 && i >= found.size() - 10; i--) {
            Change change = found.get(i);

            asker.sendMessage(Component.text("  " + (change.placed() ? "+ " : "- "),
                            change.placed() ? NamedTextColor.GREEN : NamedTextColor.RED)
                    .append(Component.text(shortName(change.data()), NamedTextColor.WHITE))
                    .append(Component.text("  " + change.x() + ", " + change.y()
                            + ", " + change.z(), NamedTextColor.DARK_GRAY)));
        }
    }

    /* ------------------------------------------------------------ undoing it */

    /**
     * Putting back what one player changed.
     *
     * Applied newest first, which matters: somebody who broke a block and then
     * placed another in the same hole has two entries for one position, and
     * replaying them forwards leaves the wrong one standing.
     *
     * Spread over ticks rather than done at once. A rollback of an hour of
     * somebody with a TNT habit is tens of thousands of blocks, and doing that
     * inside one tick is a server that appears to have crashed.
     */
    public void rollback(org.bukkit.command.CommandSender asker, String name, int minutes) {
        UUID who = nexus.getServer().getOfflinePlayer(name).getUniqueId();
        int since = (int) (System.currentTimeMillis() / 1000) - minutes * 60;

        List<Change> undo = new ArrayList<>();
        for (Change change : history) {
            if (change.who().equals(who) && change.at() >= since) undo.add(change);
        }

        if (undo.isEmpty()) {
            asker.sendMessage(Text.says(name + " has changed nothing in the last "
                    + minutes + " minutes."));
            return;
        }

        asker.sendMessage(Text.good("Rolling back " + undo.size() + " changes by " + name + "."));

        int[] cursor = {undo.size() - 1};
        int[] done = {0};

        nexus.getServer().getScheduler().runTaskTimer(nexus, task -> {
            int budget = 0;

            while (cursor[0] >= 0 && budget++ < 800) {
                Change change = undo.get(cursor[0]--);

                var world = nexus.getServer().getWorld(change.world());
                if (world == null) continue;

                // Skipped rather than loaded. Forcing a chunk in for every
                // block of a big rollback is what makes them take minutes.
                if (!world.isChunkLoaded(change.x() >> 4, change.z() >> 4)) continue;

                Block block = world.getBlockAt(change.x(), change.y(), change.z());

                if (change.placed()) {
                    block.setType(Material.AIR, false);
                } else {
                    try {
                        BlockData data = Bukkit.createBlockData(change.data());
                        block.setBlockData(data, false);
                    } catch (IllegalArgumentException gone) {
                        // A block from a version that no longer has it.
                        continue;
                    }
                }
                done[0]++;
            }

            if (cursor[0] < 0) {
                task.cancel();
                asker.sendMessage(Text.good("Rolled back " + done[0] + " blocks."));

                if (done[0] < undo.size()) {
                    asker.sendMessage(Text.plain("  " + (undo.size() - done[0])
                            + " were in chunks nobody has loaded. Go there and run it again."));
                }
            }
        }, 1L, 1L);
    }

    /* -------------------------------------------------------------- on disk */

    /** Called once a second by the plugin's clock. */
    public void tick() {
        if (++ticks % FLUSH_EVERY != 0) return;
        flush();
    }

    /**
     * Appends what is new, on a worker thread.
     *
     * The list is swapped on the main thread before the write starts, so the
     * writer never touches a list anything else is adding to.
     */
    public void flush() {
        write(true);
    }

    /**
     * The same, but written before this call returns.
     *
     * Needed at shutdown, and it is not a detail: Bukkit refuses to schedule
     * anything once a plugin is disabling, so the ordinary flush threw there
     * and every block change in the last ten seconds before a restart was
     * silently thrown away. Exactly the ten seconds somebody would be asking
     * about, since a griefer's last act is usually to leave.
     */
    public void flushNow() {
        write(false);
    }

    private void write(boolean async) {
        if (pending.isEmpty()) return;

        List<Change> writing = pending;
        pending = new ArrayList<>();

        Runnable job = () -> {
            try (BufferedWriter out = new BufferedWriter(new FileWriter(file, true))) {
                for (Change change : writing) {
                    out.write(change.line());
                    out.newLine();
                }
            } catch (Exception e) {
                nexus.getLogger().warning("could not write the block log: " + e);
            }
        };

        if (async) nexus.getServer().getScheduler().runTaskAsynchronously(nexus, job);
        else job.run();
    }

    /**
     * Reads the log back, dropping what has expired.
     *
     * The file is rewritten with only what survived, which is what keeps it
     * from growing without limit - the trimming happens at startup, when a
     * pause costs nobody anything, rather than while people are playing.
     */
    private void load() {
        if (!file.exists()) return;

        int cutoff = (int) (System.currentTimeMillis() / 1000) - KEEP_DAYS * 86400;
        int read = 0;
        int dropped = 0;

        try {
            for (String line : Files.readAllLines(file.toPath(), StandardCharsets.UTF_8)) {
                read++;
                Change change = Change.read(line);

                if (change == null || change.at() < cutoff) {
                    dropped++;
                    continue;
                }

                history.addLast(change);
                while (history.size() > CAP) {
                    history.removeFirst();
                    dropped++;
                }
            }
        } catch (Exception e) {
            nexus.getLogger().warning("could not read the block log: " + e);
            return;
        }

        nexus.getLogger().info(history.size() + " block changes loaded"
                + (dropped > 0 ? ", " + dropped + " expired" : ""));

        if (dropped > 0) rewrite();
    }

    private void rewrite() {
        List<Change> keeping = new ArrayList<>(history);

        try (BufferedWriter out = new BufferedWriter(new FileWriter(file, false))) {
            for (Change change : keeping) {
                out.write(change.line());
                out.newLine();
            }
        } catch (Exception e) {
            nexus.getLogger().warning("could not trim the block log: " + e);
        }
    }

    /**
     * Proves a logged change can be read back and actually replaced.
     *
     * The interesting part is the block data string. A stair is stored as
     * `minecraft:oak_stairs[facing=north,half=bottom,shape=straight,
     * waterlogged=false]` - full of the separators a naive format would choke
     * on - and if it does not survive the round trip, the log looks complete
     * and every rollback quietly puts back the wrong block.
     */
    public String selfTest() {
        String data;
        try {
            data = Bukkit.createBlockData(Material.OAK_STAIRS).getAsString();
        } catch (RuntimeException noSuchBlock) {
            return "cannot make a stair: " + noSuchBlock;
        }

        Change wrote = new Change(1_700_000_000,
                UUID.nameUUIDFromBytes("nexus-selftest".getBytes()),
                false, "nexus_survival", -40, 63, 128, data);

        Change read = Change.read(wrote.line());
        if (read == null) return "a written line could not be read back";

        if (!read.equals(wrote)) return "read back as " + read.line();

        try {
            Bukkit.createBlockData(read.data());
        } catch (IllegalArgumentException unusable) {
            return "the stored block data cannot be placed: " + unusable;
        }

        return "ok";
    }

    /* --------------------------------------------------------------- saying */

    private String nameOf(UUID who) {
        String name = nexus.getServer().getOfflinePlayer(who).getName();
        return name == null ? "somebody" : name;
    }

    /** `minecraft:oak_stairs[facing=north,...]` read as `oak stairs`. */
    private static String shortName(String data) {
        String name = data;

        int bracket = name.indexOf('[');
        if (bracket > 0) name = name.substring(0, bracket);

        int colon = name.indexOf(':');
        if (colon >= 0) name = name.substring(colon + 1);

        return name.replace('_', ' ');
    }

    public int size() {
        return history.size();
    }
}
