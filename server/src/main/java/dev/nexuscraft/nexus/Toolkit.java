package dev.nexuscraft.nexus;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextDecoration;
import org.bukkit.Location;
import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.Sound;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.block.data.BlockData;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.bukkit.persistence.PersistentDataType;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Enough of a world editor to build a lobby with.
 *
 * Making the hub look like anything by hand is placing several thousand blocks
 * one at a time, which is why servers install WorldEdit before they install
 * anything else. This is not WorldEdit - it is the dozen commands people
 * actually use, so that changing the lobby is an afternoon rather than a
 * fortnight.
 *
 * Everything is bounded on purpose. An edit covers at most {@link #MAX} blocks
 * and happens in one tick, which for a fifty thousand block cube is fast enough
 * not to notice; the alternative is spreading it over several ticks, and a
 * half-applied edit that another edit can interleave with is a much worse thing
 * to debug than a command that says no.
 */
public final class Toolkit {

    /**
     * The most blocks one command may touch.
     *
     * Fifty thousand is a 36-block cube, which is larger than anything a lobby
     * needs and small enough to finish inside a tick. It is a refusal rather
     * than a truncation - half an edit is worse than none, because you cannot
     * tell by looking which half you got.
     */
    public static final int MAX = 50_000;

    /** How many edits back you can walk. */
    private static final int UNDOS = 5;

    private final Nexus nexus;

    private final Map<UUID, Location> first = new HashMap<>();
    private final Map<UUID, Location> second = new HashMap<>();

    /** What was there before, most recent first. */
    private final Map<UUID, Deque<List<Was>>> history = new HashMap<>();

    /**
     * And what undo took away, so it can be put back.
     *
     * Cleared by the next real edit, which is the rule every editor follows:
     * undoing three steps and then building something new means the three
     * steps are gone, because there is no longer one history to return to.
     */
    private final Map<UUID, Deque<List<Was>>> future = new HashMap<>();

    /** A copied region, kept relative to where the player stood when copying. */
    private final Map<UUID, List<Piece>> clipboard = new HashMap<>();

    /** One block as it was, so an edit can be walked back. */
    private record Was(Location at, BlockData data) { }

    /** One block of a copied region, offset from the copier's feet. */
    private record Piece(int dx, int dy, int dz, BlockData data) { }

    public Toolkit(Nexus nexus) {
        this.nexus = nexus;
    }

    /* ----------------------------------------------------------- the wand */

    private NamespacedKey key() {
        return new NamespacedKey(nexus, "builder_wand");
    }

    /**
     * Marked rather than recognised by its name.
     *
     * A golden axe called the right thing is something anybody can make in an
     * anvil, and the wand is not a thing players should be able to forge.
     */
    public boolean isWand(ItemStack item) {
        if (item == null || item.getType() != Material.GOLDEN_AXE) return false;

        var meta = item.getItemMeta();
        return meta != null
                && meta.getPersistentDataContainer().has(key(), PersistentDataType.BYTE);
    }

    public void giveWand(Player player) {
        ItemStack wand = new ItemStack(Material.GOLDEN_AXE);

        wand.editMeta(meta -> {
            meta.displayName(Component.text("Builder's Wand", NamedTextColor.GOLD)
                    .decoration(TextDecoration.ITALIC, false));
            meta.lore(List.of(
                    Text.item("Left click a block   corner one", NamedTextColor.DARK_GRAY),
                    Text.item("Right click a block  corner two", NamedTextColor.DARK_GRAY),
                    Text.item("/set stone to fill it in", NamedTextColor.DARK_GRAY)));

            meta.getPersistentDataContainer().set(key(), PersistentDataType.BYTE, (byte) 1);
        });

        player.getInventory().addItem(wand);
        player.sendMessage(Text.good("Builder's wand."));
        player.sendMessage(Text.plain("  Left click one corner, right click the other."));
        player.sendMessage(Text.plain("  Then /set <block>. /buildhelp for the rest."));
    }

    /* ------------------------------------------------------------ corners */

    public void setFirst(Player player, Block block) {
        first.put(player.getUniqueId(), block.getLocation());
        told(player, "Corner one", block);
    }

    public void setSecond(Player player, Block block) {
        second.put(player.getUniqueId(), block.getLocation());
        told(player, "Corner two", block);
    }

    private void told(Player player, String which, Block block) {
        long size = countOf(player);

        player.sendMessage(Text.says(which + " at " + block.getX()
                + ", " + block.getY() + ", " + block.getZ()
                + (size > 0 ? "   " + size + " blocks" : "")));

        player.playSound(player, Sound.BLOCK_NOTE_BLOCK_HAT, 0.6f, 1.6f);
    }

    /** How big the selection is, or zero if it is not finished. */
    public long countOf(Player player) {
        Location a = first.get(player.getUniqueId());
        Location b = second.get(player.getUniqueId());

        if (a == null || b == null || !sameWorld(a, b)) return 0;

        long w = Math.abs(a.getBlockX() - b.getBlockX()) + 1L;
        long h = Math.abs(a.getBlockY() - b.getBlockY()) + 1L;
        long d = Math.abs(a.getBlockZ() - b.getBlockZ()) + 1L;

        return w * h * d;
    }

    private static boolean sameWorld(Location a, Location b) {
        return a.getWorld() != null && a.getWorld().equals(b.getWorld());
    }

    /**
     * The selection, or null with a reason already said.
     *
     * Returning null rather than throwing because every caller does the same
     * thing with a bad selection - stop, having told them why - and an
     * exception would make five commands each write that out.
     */
    private Region regionOf(Player player) {
        Location a = first.get(player.getUniqueId());
        Location b = second.get(player.getUniqueId());

        if (a == null || b == null) {
            player.sendMessage(Text.bad("Pick two corners first."));
            player.sendMessage(Text.plain("  /wand, then left and right click."));
            return null;
        }

        if (!sameWorld(a, b)) {
            player.sendMessage(Text.bad("Those corners are in different worlds."));
            return null;
        }

        long size = countOf(player);
        if (size > MAX) {
            player.sendMessage(Text.bad("That is " + size + " blocks, and the limit is " + MAX + "."));
            player.sendMessage(Text.plain("  Do it in pieces."));
            return null;
        }

        return new Region(a.getWorld(),
                Math.min(a.getBlockX(), b.getBlockX()), Math.max(a.getBlockX(), b.getBlockX()),
                Math.min(a.getBlockY(), b.getBlockY()), Math.max(a.getBlockY(), b.getBlockY()),
                Math.min(a.getBlockZ(), b.getBlockZ()), Math.max(a.getBlockZ(), b.getBlockZ()));
    }

    private record Region(World world, int x1, int x2, int y1, int y2, int z1, int z2) { }

    /* -------------------------------------------------------------- edits */

    /**
     * Reads a block name the way somebody would type it.
     *
     * Case and namespace are both forgiven, and anything that is not a block -
     * a sword, say - is refused here rather than becoming an invisible no-op
     * fifty thousand times over.
     */
    public static Material blockNamed(Player player, String written) {
        Material material = Material.matchMaterial(written);

        if (material == null || !material.isBlock()) {
            player.sendMessage(Text.bad("No block called '" + written + "'."));
            return null;
        }
        return material;
    }

    public void set(Player player, String written) {
        Material material = blockNamed(player, written);
        if (material == null) return;

        Region region = regionOf(player);
        if (region == null) return;

        apply(player, region, block -> material);
    }

    public void replace(Player player, String fromName, String toName) {
        Material from = blockNamed(player, fromName);
        Material to = blockNamed(player, toName);
        if (from == null || to == null) return;

        Region region = regionOf(player);
        if (region == null) return;

        apply(player, region, block -> block.getType() == from ? to : null);
    }

    /** The four sides, leaving the floor, ceiling and middle alone. */
    public void walls(Player player, String written) {
        Material material = blockNamed(player, written);
        if (material == null) return;

        Region region = regionOf(player);
        if (region == null) return;

        apply(player, region, block -> {
            boolean edge = block.getX() == region.x1() || block.getX() == region.x2()
                    || block.getZ() == region.z1() || block.getZ() == region.z2();
            return edge ? material : null;
        });
    }

    /** Every outside face: walls, floor and ceiling, hollow inside. */
    public void shell(Player player, String written) {
        Material material = blockNamed(player, written);
        if (material == null) return;

        Region region = regionOf(player);
        if (region == null) return;

        apply(player, region, block -> {
            boolean face = block.getX() == region.x1() || block.getX() == region.x2()
                    || block.getY() == region.y1() || block.getY() == region.y2()
                    || block.getZ() == region.z1() || block.getZ() == region.z2();
            return face ? material : null;
        });
    }

    /** Clears the inside, keeping whatever the outside faces already are. */
    public void hollow(Player player) {
        Region region = regionOf(player);
        if (region == null) return;

        apply(player, region, block -> {
            boolean face = block.getX() == region.x1() || block.getX() == region.x2()
                    || block.getY() == region.y1() || block.getY() == region.y2()
                    || block.getZ() == region.z1() || block.getZ() == region.z2();
            return face ? null : Material.AIR;
        });
    }

    /**
     * Runs one edit over the selection, remembering what it replaced.
     *
     * The decider returns the block to place or null to leave that one alone,
     * which is what lets fill, replace, walls and hollow all be four lines
     * each rather than four copies of the same three loops.
     */
    private void apply(Player player, Region region, Decider decider) {
        List<Was> undo = new ArrayList<>();
        int changed = 0;

        for (int x = region.x1(); x <= region.x2(); x++) {
            for (int y = region.y1(); y <= region.y2(); y++) {
                for (int z = region.z1(); z <= region.z2(); z++) {
                    Block block = region.world().getBlockAt(x, y, z);

                    Material wanted = decider.at(block);
                    if (wanted == null || block.getType() == wanted) continue;

                    undo.add(new Was(block.getLocation(), block.getBlockData()));

                    /*
                     * Physics off, like everywhere else that builds.
                     *
                     * With it on, a fill of sand falls as it is written and a
                     * fill of water floods the next edit; and every placement
                     * would tell its neighbours, which for fifty thousand
                     * blocks is where the time goes.
                     */
                    block.setType(wanted, false);
                    changed++;
                }
            }
        }

        remember(player, undo);

        player.sendMessage(Text.good(changed + " blocks."));
        if (changed > 0) player.playSound(player, Sound.BLOCK_STONE_PLACE, 0.7f, 1.1f);
    }

    private interface Decider {
        /** The block to place here, or null to leave this one as it is. */
        Material at(Block block);
    }

    /* ---------------------------------------------------- copy and paste */

    public void copy(Player player) {
        Region region = regionOf(player);
        if (region == null) return;

        Location feet = player.getLocation();
        List<Piece> pieces = new ArrayList<>();

        for (int x = region.x1(); x <= region.x2(); x++) {
            for (int y = region.y1(); y <= region.y2(); y++) {
                for (int z = region.z1(); z <= region.z2(); z++) {
                    Block block = region.world().getBlockAt(x, y, z);
                    if (block.getType() == Material.AIR) continue;

                    pieces.add(new Piece(
                            x - feet.getBlockX(), y - feet.getBlockY(), z - feet.getBlockZ(),
                            block.getBlockData()));
                }
            }
        }

        clipboard.put(player.getUniqueId(), pieces);

        player.sendMessage(Text.good(pieces.size() + " blocks copied."));
        player.sendMessage(Text.plain("  Stand where you want it and /paste."));
    }

    /**
     * Puts a design made somewhere else into somebody's clipboard.
     *
     * Loaded rather than pasted so it lands where they choose to stand, and so
     * /undo takes it away again - which matters more here than anywhere else
     * in this file. A circuit is something you try, look at, and try again two
     * blocks to the left.
     *
     * A block state that will not parse is skipped rather than failing the
     * whole load: one bad entry in forty should cost one block, and it is
     * written to the log so it is findable.
     */
    public int load(Player player, List<String> lines) {
        List<Piece> pieces = new ArrayList<>();

        for (String line : lines) {
            String[] bits = line.split(" ", 4);
            if (bits.length < 4) continue;

            try {
                pieces.add(new Piece(
                        Integer.parseInt(bits[0]),
                        Integer.parseInt(bits[1]),
                        Integer.parseInt(bits[2]),
                        Bukkit.createBlockData(bits[3])));
            } catch (IllegalArgumentException unusable) {
                nexus.getLogger().warning("circuit: could not read \"" + line + "\" - " + unusable.getMessage());
            }
        }

        if (pieces.isEmpty()) return 0;

        clipboard.put(player.getUniqueId(), pieces);
        return pieces.size();
    }

    public void paste(Player player) {
        List<Piece> pieces = clipboard.get(player.getUniqueId());

        if (pieces == null || pieces.isEmpty()) {
            player.sendMessage(Text.bad("Nothing copied yet."));
            player.sendMessage(Text.plain("  Select something and /copy."));
            return;
        }

        Location feet = player.getLocation();
        World world = feet.getWorld();
        List<Was> undo = new ArrayList<>();

        for (Piece piece : pieces) {
            Block block = world.getBlockAt(
                    feet.getBlockX() + piece.dx(),
                    feet.getBlockY() + piece.dy(),
                    feet.getBlockZ() + piece.dz());

            undo.add(new Was(block.getLocation(), block.getBlockData()));
            block.setBlockData(piece.data(), false);
        }

        remember(player, undo);

        player.sendMessage(Text.good(pieces.size() + " blocks pasted."));
        player.playSound(player, Sound.BLOCK_STONE_PLACE, 0.7f, 1.1f);
    }

    /* --------------------------------------------------------------- undo */

    /**
     * An edit somebody else is making, recorded so {@code /undo} covers it.
     *
     * Offered rather than letting {@link Blueprints} keep its own history,
     * because two undo stacks means two undo commands and somebody eventually
     * runs the wrong one. Placing a blueprint and filling a box are the same
     * kind of mistake and should take the same key to walk back.
     */
    public final class Change {

        private final List<Was> undo = new ArrayList<>();

        /**
         * Blocks already written down, so each is remembered as it first was.
         *
         * An edit may touch one block twice - move clears the old place and
         * then writes into it when the two overlap - and recording it twice
         * meant undo replayed the middle state last and left a hole where the
         * original block had been.
         */
        private final java.util.Set<Location> seen = new java.util.HashSet<>();

        private void note(Block block) {
            if (seen.add(block.getLocation())) {
                undo.add(new Was(block.getLocation(), block.getBlockData()));
            }
        }

        public void set(Block block, Material material) {
            if (block.getType() == material) return;

            note(block);
            block.setType(material, false);
        }

        /**
         * The same, keeping the block's own state.
         *
         * Stairs, slabs, logs and doors all carry which way round they are;
         * copying them by material alone turns a staircase into a pile of
         * north-facing steps.
         */
        public void set(Block block, org.bukkit.block.data.BlockData data) {
            if (block.getBlockData().equals(data)) return;

            note(block);
            block.setBlockData(data, false);
        }

        public int size() {
            return undo.size();
        }

        /** Files it under this player, and says how many blocks changed. */
        public int commit(Player player) {
            remember(player, undo);
            return undo.size();
        }
    }

    public Change change() {
        return new Change();
    }

    private void remember(Player player, List<Was> undo) {
        if (undo.isEmpty()) return;

        // A fresh edit means there is no longer one line to walk forward along.
        future.remove(player.getUniqueId());

        Deque<List<Was>> theirs =
                history.computeIfAbsent(player.getUniqueId(), id -> new ArrayDeque<>());

        theirs.addFirst(undo);
        while (theirs.size() > UNDOS) theirs.removeLast();
    }

    public void undo(Player player) {
        Deque<List<Was>> theirs = history.get(player.getUniqueId());

        if (theirs == null || theirs.isEmpty()) {
            player.sendMessage(Text.bad("Nothing to undo."));
            return;
        }

        List<Was> last = theirs.removeFirst();

        // What it is about to replace, so redo has something to go back to.
        List<Was> now = new ArrayList<>();
        for (Was was : last) {
            Block block = was.at().getBlock();
            now.add(new Was(was.at(), block.getBlockData()));
        }

        for (Was was : last) was.at().getBlock().setBlockData(was.data(), false);

        Deque<List<Was>> ahead =
                future.computeIfAbsent(player.getUniqueId(), id -> new ArrayDeque<>());

        ahead.addFirst(now);
        while (ahead.size() > UNDOS) ahead.removeLast();

        player.sendMessage(Text.good(last.size() + " blocks put back."));
        player.sendMessage(Text.plain("  " + theirs.size() + " more to undo."));
    }

    /** Puts back what undo took, until a new edit makes that meaningless. */
    public void redo(Player player) {
        Deque<List<Was>> ahead = future.get(player.getUniqueId());

        if (ahead == null || ahead.isEmpty()) {
            player.sendMessage(Text.bad("Nothing to redo."));
            return;
        }

        List<Was> next = ahead.removeFirst();

        List<Was> before = new ArrayList<>();
        for (Was was : next) {
            before.add(new Was(was.at(), was.at().getBlock().getBlockData()));
        }

        for (Was was : next) was.at().getBlock().setBlockData(was.data(), false);

        history.computeIfAbsent(player.getUniqueId(), id -> new ArrayDeque<>()).addFirst(before);

        player.sendMessage(Text.good(next.size() + " blocks redone."));
    }

    /** Dropped on quit, since the positions mean nothing without the player. */
    public void forget(Player player) {
        UUID who = player.getUniqueId();

        first.remove(who);
        second.remove(who);
        history.remove(who);
        future.remove(who);
        clipboard.remove(who);
    }

    /* ------------------------------------------------------------ direction */

    /**
     * A direction by name, or the way somebody is looking.
     *
     * Facing is the default because it is what a builder means. Standing at
     * the end of a wall and asking to stack it "that way" is the whole
     * gesture, and making them work out whether that way is north is the sort
     * of arithmetic this tool exists to remove.
     */
    private static int[] directionOf(Player player, String name) {
        String wanted = name == null ? "" : name.toLowerCase(java.util.Locale.ROOT);

        switch (wanted) {
            case "up", "u": return new int[]{0, 1, 0};
            case "down", "d": return new int[]{0, -1, 0};
            case "north", "n": return new int[]{0, 0, -1};
            case "south", "s": return new int[]{0, 0, 1};
            case "east", "e": return new int[]{1, 0, 0};
            case "west", "w": return new int[]{-1, 0, 0};
            default: break;
        }

        /*
         * Pitch first, so looking at your feet means down.
         *
         * Without it, standing over a floor and asking to stack downward
         * stacked sideways instead, because the yaw is whatever way you
         * happened to be turned.
         */
        float pitch = player.getLocation().getPitch();
        if (pitch < -60) return new int[]{0, 1, 0};
        if (pitch > 60) return new int[]{0, -1, 0};

        int quarter = Math.floorMod(Math.round(player.getLocation().getYaw() / 90f), 4);

        return switch (quarter) {
            case 0 -> new int[]{0, 0, 1};
            case 1 -> new int[]{-1, 0, 0};
            case 2 -> new int[]{0, 0, -1};
            default -> new int[]{1, 0, 0};
        };
    }

    /* -------------------------------------------------------- moving things */

    /** Everything in the selection, read out before anything is written. */
    private List<Was> read(Region region) {
        List<Was> out = new ArrayList<>();

        for (int x = region.x1(); x <= region.x2(); x++) {
            for (int y = region.y1(); y <= region.y2(); y++) {
                for (int z = region.z1(); z <= region.z2(); z++) {
                    Block block = region.world().getBlockAt(x, y, z);
                    out.add(new Was(block.getLocation(), block.getBlockData()));
                }
            }
        }
        return out;
    }

    /**
     * Repeats the selection along a direction.
     *
     * The commonest thing a builder does by hand: one bay of a wall, copied
     * twenty times. Read first and written after, because a stack that reads
     * as it writes copies its own output once the second run overlaps the
     * first - which shows up as a pattern that smears rather than repeats.
     */
    public void stack(Player player, int times, String dirName) {
        Region region = regionOf(player);
        if (region == null) return;

        if (times < 1 || times > 64) {
            player.sendMessage(Text.bad("Between 1 and 64 times."));
            return;
        }

        long size = countOf(player);
        if (size * times > MAX) {
            player.sendMessage(Text.bad(size * times + " blocks is past the limit of " + MAX + "."));
            return;
        }

        int[] step = directionOf(player, dirName);

        int width = region.x2() - region.x1() + 1;
        int height = region.y2() - region.y1() + 1;
        int depth = region.z2() - region.z1() + 1;

        List<Was> source = read(region);
        Change change = new Change();

        for (int n = 1; n <= times; n++) {
            int dx = step[0] * width * n;
            int dy = step[1] * height * n;
            int dz = step[2] * depth * n;

            for (Was was : source) {
                Block to = region.world().getBlockAt(
                        was.at().getBlockX() + dx,
                        was.at().getBlockY() + dy,
                        was.at().getBlockZ() + dz);

                change.set(to, was.data());
            }
        }

        int changed = change.commit(player);
        player.sendMessage(Text.good(changed + " blocks, " + times + " more copies."));
    }

    /** Shifts what is in the selection, leaving air behind it. */
    public void move(Player player, int distance, String dirName) {
        Region region = regionOf(player);
        if (region == null) return;

        if (distance < 1 || distance > 256) {
            player.sendMessage(Text.bad("Between 1 and 256 blocks."));
            return;
        }

        int[] step = directionOf(player, dirName);
        List<Was> source = read(region);

        Change change = new Change();

        // Cleared first, then written, or a short move erases what it just
        // put down where the old and new places overlap.
        for (Was was : source) change.set(was.at().getBlock(), Material.AIR);

        for (Was was : source) {
            Block to = region.world().getBlockAt(
                    was.at().getBlockX() + step[0] * distance,
                    was.at().getBlockY() + step[1] * distance,
                    was.at().getBlockZ() + step[2] * distance);

            change.set(to, was.data());
        }

        change.commit(player);

        // The selection follows it, or the next command works on empty air.
        first.put(player.getUniqueId(), first.get(player.getUniqueId())
                .clone().add(step[0] * distance, step[1] * distance, step[2] * distance));
        second.put(player.getUniqueId(), second.get(player.getUniqueId())
                .clone().add(step[0] * distance, step[1] * distance, step[2] * distance));

        player.sendMessage(Text.good("Moved " + distance + "."));
    }

    /** Grows or shrinks the selection without clicking again. */
    public void resize(Player player, int amount, String dirName, boolean grow) {
        Location a = first.get(player.getUniqueId());
        Location b = second.get(player.getUniqueId());

        if (a == null || b == null) {
            player.sendMessage(Text.bad("Pick two corners first."));
            return;
        }

        int[] step = directionOf(player, dirName);
        int by = grow ? amount : -amount;

        /*
         * The far corner moves, not both.
         *
         * Growing north has to move whichever of the two corners is further
         * north, whichever click made it - otherwise expanding shrinks half
         * the time, depending on the order the corners were picked in.
         *
         * One comparison, not two branches. The projection below is already
         * signed by the direction, so "greater" always means "further that
         * way"; the version that special-cased negative directions had the
         * test backwards and expanding west quietly contracted instead.
         */
        Location far = compare(a, b, step) >= 0 ? a : b;

        far.add(step[0] * by, step[1] * by, step[2] * by);

        player.sendMessage(Text.says((grow ? "Grown " : "Shrunk ") + amount
                + ".  " + countOf(player) + " blocks."));
    }

    /** How far along a direction one point is compared to another. */
    private static int compare(Location a, Location b, int[] step) {
        int one = a.getBlockX() * step[0] + a.getBlockY() * step[1] + a.getBlockZ() * step[2];
        int two = b.getBlockX() * step[0] + b.getBlockY() * step[1] + b.getBlockZ() * step[2];

        return Integer.compare(one, two);
    }

    /* ------------------------------------------------------------- shapes */

    /**
     * A ball centred where you stand.
     *
     * Round things are what a build tool is really for: a sphere by hand is an
     * afternoon of counting, and wrong at the poles when you finish.
     */
    public void sphere(Player player, String written, int radius, boolean hollow) {
        Material material = blockNamed(player, written);
        if (material == null) return;

        if (radius < 1 || radius > 40) {
            player.sendMessage(Text.bad("A radius between 1 and 40."));
            return;
        }

        Location middle = player.getLocation();
        Change change = new Change();

        long placed = 0;

        for (int dx = -radius; dx <= radius; dx++) {
            for (int dy = -radius; dy <= radius; dy++) {
                for (int dz = -radius; dz <= radius; dz++) {
                    double away = Math.sqrt(dx * dx + dy * dy + dz * dz);

                    if (away > radius + 0.5) continue;
                    if (hollow && away < radius - 0.5) continue;

                    if (++placed > MAX) {
                        player.sendMessage(Text.bad("That is past the limit of " + MAX + "."));
                        return;
                    }

                    change.set(middle.clone().add(dx, dy, dz).getBlock(), material);
                }
            }
        }

        int changed = change.commit(player);
        player.sendMessage(Text.good(changed + " blocks."));
    }

    /** A pillar or a disc, depending how tall you make it. */
    public void cylinder(Player player, String written, int radius, int height, boolean hollow) {
        Material material = blockNamed(player, written);
        if (material == null) return;

        if (radius < 1 || radius > 40 || height < 1 || height > 128) {
            player.sendMessage(Text.bad("Radius 1 to 40, height 1 to 128."));
            return;
        }

        if ((long) (radius * 2 + 1) * (radius * 2 + 1) * height > MAX) {
            player.sendMessage(Text.bad("That is past the limit of " + MAX + "."));
            return;
        }

        Location middle = player.getLocation();
        Change change = new Change();

        for (int dy = 0; dy < height; dy++) {
            for (int dx = -radius; dx <= radius; dx++) {
                for (int dz = -radius; dz <= radius; dz++) {
                    double away = Math.sqrt(dx * dx + dz * dz);

                    if (away > radius + 0.5) continue;
                    if (hollow && away < radius - 0.5 && dy != 0 && dy != height - 1) continue;

                    change.set(middle.clone().add(dx, dy, dz).getBlock(), material);
                }
            }
        }

        int changed = change.commit(player);
        player.sendMessage(Text.good(changed + " blocks."));
    }

    /** A stepped pyramid, widest at your feet. */
    public void pyramid(Player player, String written, int size, boolean hollow) {
        Material material = blockNamed(player, written);
        if (material == null) return;

        if (size < 1 || size > 40) {
            player.sendMessage(Text.bad("A size between 1 and 40."));
            return;
        }

        Location middle = player.getLocation();
        Change change = new Change();

        for (int level = 0; level < size; level++) {
            int reach = size - level - 1;

            for (int dx = -reach; dx <= reach; dx++) {
                for (int dz = -reach; dz <= reach; dz++) {
                    boolean edge = Math.abs(dx) == reach || Math.abs(dz) == reach;
                    if (hollow && !edge && level != 0) continue;

                    change.set(middle.clone().add(dx, level, dz).getBlock(), material);
                }
            }
        }

        int changed = change.commit(player);
        player.sendMessage(Text.good(changed + " blocks."));
    }

    /** A straight line from one corner to the other. */
    public void line(Player player, String written) {
        Material material = blockNamed(player, written);
        if (material == null) return;

        Location a = first.get(player.getUniqueId());
        Location b = second.get(player.getUniqueId());

        if (a == null || b == null || !sameWorld(a, b)) {
            player.sendMessage(Text.bad("Pick two corners first."));
            return;
        }

        int steps = (int) Math.max(1, Math.round(a.distance(b)));
        if (steps > MAX) {
            player.sendMessage(Text.bad("That is too long."));
            return;
        }

        Change change = new Change();

        for (int i = 0; i <= steps; i++) {
            double f = (double) i / steps;

            int x = (int) Math.round(a.getBlockX() + (b.getBlockX() - a.getBlockX()) * f);
            int y = (int) Math.round(a.getBlockY() + (b.getBlockY() - a.getBlockY()) * f);
            int z = (int) Math.round(a.getBlockZ() + (b.getBlockZ() - a.getBlockZ()) * f);

            change.set(a.getWorld().getBlockAt(x, y, z), material);
        }

        int changed = change.commit(player);
        player.sendMessage(Text.good(changed + " blocks."));
    }

    /* ------------------------------------------------------------ terrain */

    /**
     * A layer on top of whatever is already there.
     *
     * Grass over a hillside, snow over a roof. Only the highest solid block in
     * each column gets one, so it follows the shape rather than filling the
     * selection.
     */
    public void overlay(Player player, String written) {
        Material material = blockNamed(player, written);
        if (material == null) return;

        Region region = regionOf(player);
        if (region == null) return;

        Change change = new Change();

        for (int x = region.x1(); x <= region.x2(); x++) {
            for (int z = region.z1(); z <= region.z2(); z++) {
                for (int y = region.y2(); y >= region.y1(); y--) {
                    Block block = region.world().getBlockAt(x, y, z);
                    if (block.isPassable()) continue;

                    Block above = region.world().getBlockAt(x, y + 1, z);
                    if (above.isPassable()) change.set(above, material);

                    break;
                }
            }
        }

        int changed = change.commit(player);
        player.sendMessage(Text.good(changed + " blocks laid on top."));
    }

    /** Takes the water and lava out of everything nearby. */
    public void drain(Player player, int radius) {
        if (radius < 1 || radius > 40) {
            player.sendMessage(Text.bad("A radius between 1 and 40."));
            return;
        }

        Location middle = player.getLocation();
        Change change = new Change();

        for (int dx = -radius; dx <= radius; dx++) {
            for (int dy = -radius; dy <= radius; dy++) {
                for (int dz = -radius; dz <= radius; dz++) {
                    Block block = middle.clone().add(dx, dy, dz).getBlock();

                    if (block.getType() == Material.WATER || block.getType() == Material.LAVA) {
                        change.set(block, Material.AIR);
                    }
                }
            }
        }

        int changed = change.commit(player);
        player.sendMessage(Text.good(changed + " drained."));
    }

    /**
     * Up, with something under your feet.
     *
     * Standing on nothing is a fall, so a block is placed as you go - which is
     * how anybody scaffolds by hand, done in one keypress.
     */
    public void up(Player player, int distance) {
        if (distance < 1 || distance > 128) {
            player.sendMessage(Text.bad("Between 1 and 128 blocks."));
            return;
        }

        Location to = player.getLocation().add(0, distance, 0);

        Change change = new Change();
        change.set(to.clone().add(0, -1, 0).getBlock(), Material.GLASS);
        change.commit(player);

        player.teleport(to);
        player.sendMessage(Text.says("Up " + distance + "."));
    }

    /* ------------------------------------------------------------ counting */

    /** What the selection is made of, commonest first. */
    public void count(Player player) {
        Region region = regionOf(player);
        if (region == null) return;

        Map<Material, Integer> tally = new HashMap<>();

        for (int x = region.x1(); x <= region.x2(); x++) {
            for (int y = region.y1(); y <= region.y2(); y++) {
                for (int z = region.z1(); z <= region.z2(); z++) {
                    Material type = region.world().getBlockAt(x, y, z).getType();
                    if (type == Material.AIR) continue;

                    tally.merge(type, 1, Integer::sum);
                }
            }
        }

        if (tally.isEmpty()) {
            player.sendMessage(Text.says("Nothing but air."));
            return;
        }

        player.sendMessage(Text.heading("In the selection"));

        tally.entrySet().stream()
                .sorted((a, b) -> Integer.compare(b.getValue(), a.getValue()))
                .limit(12)
                .forEach(entry -> player.sendMessage(Text.plain("  " + entry.getValue()
                        + "  " + entry.getKey().name().toLowerCase().replace('_', ' '))));
    }

    /* --------------------------------------------------------------- help */

    public void help(Player player) {
        player.sendMessage(Text.heading("Building"));
        player.sendMessage(Text.plain("  /build              creative, and the lobby unlocks"));
        player.sendMessage(Text.plain("  /wand               the selection tool"));
        player.sendMessage(Text.plain("  /pos1  /pos2        corners where you stand"));
        player.sendMessage(Text.plain("  /sel                how big the selection is"));
        player.sendMessage(Text.plain("  /set <block>        fill it"));
        player.sendMessage(Text.plain("  /replace <a> <b>    swap one block for another"));
        player.sendMessage(Text.plain("  /walls <block>      the four sides"));
        player.sendMessage(Text.plain("  /shell <block>      every outside face"));
        player.sendMessage(Text.plain("  /hollow             empty the middle"));
        player.sendMessage(Text.plain("  /copy  /paste       pasted from where you stand"));
        player.sendMessage(Text.plain("  /undo  /redo        up to " + UNDOS + " edits back"));
        player.sendMessage(Component.empty());

        player.sendMessage(Text.plain("  /stack <n> [dir]    repeat the selection"));
        player.sendMessage(Text.plain("  /move <n> [dir]     shift what is in it"));
        player.sendMessage(Text.plain("  /expand <n> [dir]   grow the selection"));
        player.sendMessage(Text.plain("  /contract <n> [dir] shrink it"));
        player.sendMessage(Text.plain("  /count              what it is made of"));
        player.sendMessage(Component.empty());

        player.sendMessage(Text.plain("  /sphere <block> <r> [hollow]"));
        player.sendMessage(Text.plain("  /cyl <block> <r> [height] [hollow]"));
        player.sendMessage(Text.plain("  /pyramid <block> <size> [hollow]"));
        player.sendMessage(Text.plain("  /line <block>       corner to corner"));
        player.sendMessage(Component.empty());

        player.sendMessage(Text.plain("  /overlay <block>    a layer on top of the ground"));
        player.sendMessage(Text.plain("  /drain <radius>     take out water and lava"));
        player.sendMessage(Text.plain("  /up <n>             up, on a block"));
        player.sendMessage(Component.empty());

        player.sendMessage(Text.plain("  A direction is up, down, north, south, east, west."));
        player.sendMessage(Text.plain("  Left out, it is the way you are looking."));
        player.sendMessage(Text.plain("  Limit is " + MAX + " blocks at once."));
    }
}
