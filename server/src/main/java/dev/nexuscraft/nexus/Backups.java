package dev.nexuscraft.nexus;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.World;
import org.bukkit.command.CommandSender;

import java.io.File;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.file.FileVisitResult;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.attribute.BasicFileAttributes;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/**
 * Copies of everything, made without being asked.
 *
 * This server holds a lobby that was paid for, nineteen holograms that were
 * placed by hand and once had to be reconstructed from log files, and every
 * claim, balance and home anybody has earned. Until now there were no copies of
 * any of it. The backups folder existed and was empty, which is the worst of
 * both worlds: it looks like the problem has been thought about.
 *
 * The interesting part is not the zip, it is taking one safely. Minecraft holds
 * region files open and writes to them continuously, so copying a live world
 * gives a mixture of two moments in time - which usually loads, and occasionally
 * loads a chunk as void. So: flush every world to disk, turn auto-save off,
 * copy, then turn it back on. The copy itself runs off the main thread, because
 * zipping a hundred megabytes on the server thread is a hundred megabytes of
 * everybody standing still.
 *
 * Old ones are deleted on a count rather than an age. Disk fills up silently and
 * a server that cannot write its world is a server that loses it, which is the
 * exact thing this is here to prevent.
 */
public final class Backups {

    private static final DateTimeFormatter STAMP =
            DateTimeFormatter.ofPattern("yyyy-MM-dd_HH-mm-ss");

    private final Nexus nexus;
    private final File folder;

    private int minutes;
    private volatile boolean running;

    public Backups(Nexus nexus) {
        this.nexus = nexus;

        // Beside the server jar rather than inside the plugin folder, which is
        // where anybody looking for a backup will actually look.
        this.folder = new File(serverRoot(nexus), "backups");

        if (!folder.exists() && !folder.mkdirs()) {
            nexus.getLogger().warning("could not make the backups folder at " + folder);
        }
    }

    /**
     * The directory the server was started in.
     *
     * Taken through getAbsoluteFile first, because getDataFolder() is relative -
     * it comes back as `plugins/Nexus`, so walking up twice from it runs off
     * the end of the path and gives null rather than the server folder.
     */
    private static File serverRoot(Nexus nexus) {
        return nexus.getDataFolder().getAbsoluteFile().getParentFile().getParentFile();
    }

    private int everyMinutes() {
        return nexus.getConfig().getInt("backups.everyMinutes", 120);
    }

    private int keep() {
        return nexus.getConfig().getInt("backups.keep", 8);
    }

    /* ----------------------------------------------------------------- tick */

    /** Once a minute, from the plugin's clock. */
    public void tick() {
        if (!nexus.getConfig().getBoolean("backups.enabled", true)) return;

        int every = everyMinutes();
        if (every <= 0) return;

        if (++minutes < every) return;
        minutes = 0;

        take(nexus.getServer().getConsoleSender(), true);
    }

    /**
     * Takes one.
     *
     * The world flush and the auto-save toggle happen on the main thread,
     * because both touch live worlds. Everything after that is file copying and
     * runs on a worker.
     */
    public void take(CommandSender asker, boolean quiet) {
        if (running) {
            asker.sendMessage(Text.bad("A backup is already running."));
            return;
        }
        running = true;

        String name = "nexus-" + LocalDateTime.now().format(STAMP) + ".zip";
        File target = new File(folder, name);

        if (!quiet) asker.sendMessage(Text.says("Saving worlds first..."));

        List<World> worlds = new ArrayList<>(nexus.getServer().getWorlds());
        List<File> sources = new ArrayList<>();

        /*
         * Flushed and frozen before anything is read.
         *
         * Without this the zip is a mixture of two moments: some region files
         * as they were, some half rewritten. That usually loads fine, which is
         * the dangerous part - the damage shows up as one chunk of void weeks
         * later, in a backup nobody has any reason to distrust.
         */
        for (World world : worlds) {
            /*
             * Arena worlds are skipped.
             *
             * They are created per match and deleted when it ends, so they are
             * both worthless to keep and the most likely thing to vanish from
             * under the copy while it runs.
             */
            if (world.getName().startsWith("nexus_")
                    && world.getName().matches(".*_\\d+$")) {
                continue;
            }

            world.save();
            world.setAutoSave(false);
            sources.add(world.getWorldFolder());
        }

        /*
         * Worlds that exist on disk but nobody has loaded yet.
         *
         * Worlds here are made on first visit, so getWorlds() lists only where
         * somebody has been since the last restart - and on any morning nobody
         * has warped to survival, that list does not include it. The backup
         * would still run, still report success, and still be the wrong size to
         * notice, which is the worst way for this to fail.
         *
         * Nothing is writing to an unloaded world, so it is copied as it sits.
         */
        sources.addAll(unloadedWorlds(sources));

        // The plugin's own data, which is where claims, homes, stats, the
        // auction and the holograms live. Smaller than the worlds and more
        // painful to lose.
        sources.add(nexus.getDataFolder());

        long began = System.currentTimeMillis();

        nexus.getServer().getScheduler().runTaskAsynchronously(nexus, () -> {
            long bytes = 0;
            String failure = null;

            try {
                bytes = zip(sources, target);
            } catch (Exception broken) {
                failure = String.valueOf(broken);
                target.delete();
            }

            long took = System.currentTimeMillis() - began;
            long wrote = bytes;
            String why = failure;

            nexus.getServer().getScheduler().runTask(nexus, () -> {
                for (World world : worlds) world.setAutoSave(true);
                running = false;

                if (why != null) {
                    nexus.getLogger().warning("backup failed: " + why);
                    asker.sendMessage(Text.bad("Backup failed: " + why));
                    return;
                }

                int removed = prune();

                String size = String.format("%.1f MB", wrote / 1_048_576.0);
                nexus.getLogger().info("backup " + target.getName() + "  "
                        + size + "  in " + (took / 1000) + "s"
                        + (removed > 0 ? ", removed " + removed + " old" : ""));

                if (!quiet) {
                    asker.sendMessage(Text.good("Backup done: " + target.getName()));
                    asker.sendMessage(Text.plain("  " + size + " in " + (took / 1000)
                            + " seconds"));
                }
            });
        });
    }

    /**
     * World folders on disk that are not in the list already.
     *
     * A world folder is one with a level.dat in it, which is the same test the
     * server itself uses. Arenas are excluded for the same reason as above:
     * they are per-match and deleted when the match ends.
     */
    private List<File> unloadedWorlds(List<File> already) {
        List<File> found = new ArrayList<>();

        File[] entries = serverRoot(nexus).listFiles();
        if (entries == null) return found;

        for (File entry : entries) {
            if (!entry.isDirectory()) continue;
            if (!new File(entry, "level.dat").isFile()) continue;
            if (entry.getName().matches("nexus_[a-z]+_\\d+$")) continue;

            boolean known = false;
            for (File have : already) {
                if (have.getAbsolutePath().equals(entry.getAbsolutePath())) known = true;
            }
            if (!known) found.add(entry);
        }

        return found;
    }

    /* ------------------------------------------------------------- the copy */

    private long zip(List<File> sources, File target) throws IOException {
        long written = 0;

        try (OutputStream out = Files.newOutputStream(target.toPath());
             ZipOutputStream zip = new ZipOutputStream(out)) {

            // Fast rather than small. A backup that takes four minutes is one
            // that gets turned off; the disk is cheaper than the wait.
            zip.setLevel(1);

            for (File source : sources) {
                if (!source.exists()) continue;
                written += add(zip, source.toPath(), source.getName());
            }
        }
        return target.length();
    }

    private long add(ZipOutputStream zip, Path root, String prefix) throws IOException {
        final long[] written = {0};

        Files.walkFileTree(root, new SimpleFileVisitor<>() {
            @Override
            public FileVisitResult visitFile(Path path, BasicFileAttributes attributes) {
                /*
                 * Locks and sockets are skipped.
                 *
                 * session.lock is held open by the server for as long as it is
                 * running, and on Windows reading it throws - which would fail
                 * the whole backup over a file that is worthless to keep.
                 */
                String name = path.getFileName().toString();
                if (name.equals("session.lock") || name.endsWith(".lock")) {
                    return FileVisitResult.CONTINUE;
                }

                try {
                    String inside = prefix + "/" + root.relativize(path).toString()
                            .replace('\\', '/');

                    zip.putNextEntry(new ZipEntry(inside));
                    written[0] += Files.copy(path, zip);
                    zip.closeEntry();
                } catch (IOException skipped) {
                    // One unreadable file should not lose the other thousand.
                }
                return FileVisitResult.CONTINUE;
            }

            @Override
            public FileVisitResult visitFileFailed(Path path, IOException failed) {
                return FileVisitResult.CONTINUE;
            }
        });

        return written[0];
    }

    /** Deletes the oldest until only `keep` remain. */
    private int prune() {
        File[] all = folder.listFiles((dir, name) ->
                name.startsWith("nexus-") && name.endsWith(".zip"));

        if (all == null || all.length <= keep()) return 0;

        List<File> sorted = new ArrayList<>(List.of(all));
        sorted.sort(Comparator.comparingLong(File::lastModified));

        int removing = sorted.size() - keep();
        int removed = 0;

        for (int i = 0; i < removing; i++) {
            if (sorted.get(i).delete()) removed++;
        }
        return removed;
    }

    /* -------------------------------------------------------------- reading */

    public void list(CommandSender asker) {
        File[] all = folder.listFiles((dir, name) ->
                name.startsWith("nexus-") && name.endsWith(".zip"));

        asker.sendMessage(Text.heading("Backups"));

        if (all == null || all.length == 0) {
            asker.sendMessage(Text.bad("  None. Nothing here is backed up."));
            asker.sendMessage(Text.plain("  /nexus backup to take one now."));
            return;
        }

        List<File> sorted = new ArrayList<>(List.of(all));
        sorted.sort(Comparator.comparingLong(File::lastModified).reversed());

        long total = 0;
        for (File one : sorted) total += one.length();

        asker.sendMessage(Text.field("Kept", sorted.size() + " of " + keep()));
        asker.sendMessage(Text.field("Every", everyMinutes() + " minutes"));
        asker.sendMessage(Text.field("Using", String.format("%.1f MB", total / 1_048_576.0)));
        asker.sendMessage(Text.field("Folder", folder.getPath()));
        asker.sendMessage(Component.empty());

        int shown = 0;
        for (File one : sorted) {
            if (++shown > 8) break;

            int ago = (int) ((System.currentTimeMillis() - one.lastModified()) / 1000);
            asker.sendMessage(Component.text("  " + one.getName(), NamedTextColor.WHITE)
                    .append(Component.text(String.format("   %.1f MB",
                            one.length() / 1_048_576.0), NamedTextColor.GOLD))
                    .append(Component.text("   " + Text.roughly(ago) + " ago",
                            NamedTextColor.DARK_GRAY)));
        }
    }

    public int count() {
        File[] all = folder.listFiles((dir, name) ->
                name.startsWith("nexus-") && name.endsWith(".zip"));
        return all == null ? 0 : all.length;
    }

    /** How long since the newest one, in seconds, or -1 if there are none. */
    public int newestAge() {
        File[] all = folder.listFiles((dir, name) ->
                name.startsWith("nexus-") && name.endsWith(".zip"));
        if (all == null || all.length == 0) return -1;

        long newest = 0;
        for (File one : all) newest = Math.max(newest, one.lastModified());

        return (int) ((System.currentTimeMillis() - newest) / 1000);
    }
}
