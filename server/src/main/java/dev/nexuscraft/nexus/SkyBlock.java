package dev.nexuscraft.nexus;

import org.bukkit.Bukkit;
import org.bukkit.Location;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.block.Chest;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;

import java.util.UUID;

/**
 * Skyblock: a small island, a tree, and a chest.
 *
 * The oldest survival puzzle in Minecraft and still the best one, because every
 * constraint in it is real. There is no stone, so cobble comes from a generator
 * you have to build. There is no sand, so glass has to be traded for. Nothing
 * is arbitrary — the whole thing is one map with things deliberately left out,
 * and working out the order to solve it in is the game.
 *
 * The starting island is deliberately mean. Give people more and there is
 * nothing to work out; the classic layout is a dirt platform, one tree, one
 * chest with ice and lava in it, and that is genuinely enough to reach anything
 * in the game if you are careful and disastrous if you are not.
 *
 * Islands are placed the same way {@link OneBlock} places its blocks — derived
 * from the player id rather than allocated — so there is no registry to keep
 * and two players can never be handed the same spot.
 */
public final class SkyBlock {

    private static final int SPACING = 512;
    private static final int HEIGHT = 80;

    /**
     * What each block is worth towards the island level.
     *
     * The real Skyblock measure, and the right one: it scores what you have
     * *built*, not what you have mined. Cobble is infinite from a generator, so
     * scoring the mining would make the level a measure of how long you left
     * the game running. Scoring the island means the number only moves when you
     * smelt something, or store something, or finish something.
     *
     * Anything not listed is worth nothing, which keeps a hundred thousand
     * cobblestone from being a score.
     */
    private static final java.util.Map<Material, Integer> WORTH = new java.util.HashMap<>();

    static {
        /*
         * What an island is actually made of.
         *
         * These are cheap on purpose - a point each, so a wall of them is
         * progress and a mountain of them is not a shortcut. The point is that
         * building with what the island gives you counts for something, which
         * it did not: cobblestone was missing from this table entirely.
         */
        WORTH.put(Material.COBBLESTONE, 1);
        WORTH.put(Material.MOSSY_COBBLESTONE, 2);
        WORTH.put(Material.COBBLED_DEEPSLATE, 1);
        WORTH.put(Material.ANDESITE, 1);
        WORTH.put(Material.DIORITE, 1);
        WORTH.put(Material.GRANITE, 1);
        WORTH.put(Material.DEEPSLATE, 1);
        WORTH.put(Material.BASALT, 2);
        WORTH.put(Material.COBBLESTONE_STAIRS, 1);
        WORTH.put(Material.COBBLESTONE_SLAB, 1);
        WORTH.put(Material.STONE_STAIRS, 1);
        WORTH.put(Material.STONE_SLAB, 1);
        WORTH.put(Material.STONE_BRICK_STAIRS, 2);
        WORTH.put(Material.STONE_BRICK_SLAB, 2);

        WORTH.put(Material.STONE, 1);
        WORTH.put(Material.OAK_LOG, 2);
        WORTH.put(Material.OAK_PLANKS, 1);
        WORTH.put(Material.GLASS, 3);
        WORTH.put(Material.SAND, 2);
        WORTH.put(Material.CLAY, 3);
        WORTH.put(Material.BRICKS, 6);
        WORTH.put(Material.SMOOTH_STONE, 2);
        WORTH.put(Material.STONE_BRICKS, 3);
        WORTH.put(Material.FARMLAND, 2);
        WORTH.put(Material.HAY_BLOCK, 8);
        WORTH.put(Material.BOOKSHELF, 12);

        WORTH.put(Material.COAL_BLOCK, 18);
        WORTH.put(Material.COPPER_BLOCK, 22);
        WORTH.put(Material.IRON_BLOCK, 45);
        WORTH.put(Material.LAPIS_BLOCK, 40);
        WORTH.put(Material.REDSTONE_BLOCK, 35);
        WORTH.put(Material.GOLD_BLOCK, 70);
        WORTH.put(Material.DIAMOND_BLOCK, 140);
        WORTH.put(Material.EMERALD_BLOCK, 180);
        WORTH.put(Material.NETHERITE_BLOCK, 900);

        WORTH.put(Material.OBSIDIAN, 10);
        WORTH.put(Material.CRYING_OBSIDIAN, 25);
        WORTH.put(Material.SEA_LANTERN, 20);
        WORTH.put(Material.GLOWSTONE, 14);
        WORTH.put(Material.QUARTZ_BLOCK, 16);
        WORTH.put(Material.PRISMARINE, 12);
        WORTH.put(Material.SPONGE, 60);
        WORTH.put(Material.BEACON, 600);
        WORTH.put(Material.ENCHANTING_TABLE, 120);
        WORTH.put(Material.ANVIL, 60);
        WORTH.put(Material.ENDER_CHEST, 150);
        WORTH.put(Material.CONDUIT, 400);
        WORTH.put(Material.AMETHYST_BLOCK, 30);
        WORTH.put(Material.HONEYCOMB_BLOCK, 25);
        WORTH.put(Material.SHULKER_BOX, 200);
    }

    /** Points per level. Big enough that a level is an afternoon, not a minute. */
    /**
     * Points to a level.
     *
     * Two hundred rather than two hundred and fifty, and the change that
     * matters more is below: cobblestone was worth nothing at all. The entire
     * output of a generator - the thing somebody spends the day making - added
     * up to no progress whatsoever, and the only way to move the bar was to
     * smelt it first and place the stone, at one point a block.
     */
    public static final int PER_LEVEL = 200;

    /**
     * How much island is looked at.
     *
     * Bounded on purpose, and read through chunk snapshots rather than
     * getBlockAt. The first version did the obvious thing and called getBlockAt
     * eighty thousand times, and measuring it on a real server gave **756
     * milliseconds** - not the "few milliseconds" the comment claimed, and
     * enough to hold the entire server still for three quarters of a second
     * every time it ran.
     *
     * Almost all of that was chunk loading: getBlockAt on an unloaded chunk
     * loads it, synchronously, and a forty block radius spans two dozen chunks.
     * A snapshot is a flat array read, and chunks that are not already loaded
     * are simply skipped - if nobody is near that part of the island, there is
     * nothing new to score there either.
     */
    private static final int SCAN_RADIUS = 20;
    private static final int SCAN_BELOW = 15;
    private static final int SCAN_ABOVE = 35;

    private final Nexus nexus;
    private World world;

    /** One bar per player, shown only while they are on their island. */
    private final java.util.Map<UUID, net.kyori.adventure.bossbar.BossBar> bars =
            new java.util.HashMap<>();

    /** Rotated through, so one player is scanned per tick rather than all of them. */
    private int scanCursor;

    public SkyBlock(Nexus nexus) {
        this.nexus = nexus;
    }

    public World world() {
        if (world == null) world = nexus.worlds().of(Worlds.Place.SKYBLOCK);
        return world;
    }

    /**
     * Whether this position falls inside somebody's own island.
     *
     * The whole world is divided rather than a box drawn round each island, so
     * there is no no-man's land in between where anybody may build. The cell is
     * centred on the island, so it covers the ground somebody bridges out to as
     * well as the island itself.
     */
    /**
     * Whether this player may treat this spot as their island.
     *
     * True for the owner, and for anybody they have invited onto it. Skyblock
     * is a game people play together and this check is what decides whether
     * they can: with one owner and nobody else, a friend standing on your
     * island cannot place a single block.
     */
    public boolean isTheirs(UUID who, int x, int z) {
        if (ownsSpot(who, x, z)) return true;

        for (UUID host : nexus.islandTeam().hostsFor(who)) {
            if (ownsSpot(host, x, z)) return true;
        }
        return false;
    }

    /** Whether this is the spot the grid gives this player, invitations aside. */
    private boolean ownsSpot(UUID who, int x, int z) {
        int slot = slotOf(who);
        return cell(x) == slot % 64 && cell(z) == slot / 64;
    }

    private static int cell(int coordinate) {
        return Math.floorDiv(coordinate + SPACING / 2, SPACING);
    }

    /**
     * Which of the 4096 island spots belongs to somebody.
     *
     * The one definition of the grid. Both where an island is and whether a
     * position belongs to it come from here, so they cannot drift apart.
     */
    private static int slotOf(UUID who) {
        return Math.abs(who.hashCode()) % 4096;
    }

    public Location islandOf(UUID who) {
        int slot = slotOf(who);
        int x = (slot % 64) * SPACING;
        int z = (slot / 64) * SPACING;

        return new Location(world(), x + 0.5, HEIGHT + 1, z + 0.5);
    }

    public void arrive(Player player) {
        Location at = islandOf(player.getUniqueId());

        if (world().getBlockAt(at.getBlockX(), HEIGHT, at.getBlockZ()).getType() == Material.AIR) {
            build(player.getUniqueId());
        }

        player.sendMessage(Text.heading("Skyblock"));
        player.sendMessage(Text.plain("  A tree, a chest, and a long way down."));
        player.sendMessage(Text.plain("  /is to come back here. Do not lose the lava."));

        showBar(player);
        scan(player);
    }

    /* -------------------------------------------------------- island level */

    public static int levelOf(int points) {
        return points / PER_LEVEL + 1;
    }

    /**
     * Adds up what is on somebody's island.
     *
     * Only the blocks in {@link #WORTH} count, so the score is a measure of
     * what has been made rather than of volume — a mountain of cobble scores
     * nothing and a single beacon scores six hundred.
     */
    public void scan(Player player) {
        Location at = islandOf(player.getUniqueId());
        int cx = at.getBlockX();
        int cz = at.getBlockZ();

        int points = score(cx, cz, radiusFor(player.getUniqueId()));

        Stats.Record record = nexus.stats().of(player.getUniqueId());
        int was = record.islandLevel == 0 ? 1 : record.islandLevel;

        /*
         * The best the island has ever scored, not what it scores right now.
         *
         * The scan measures what is standing, so anything mined takes its
         * points away with it - and a generator forms a block and has it mined
         * every few seconds, which made the bar visibly count up and back down
         * while somebody worked. Losing progress for doing the main thing the
         * island is for is the opposite of what a progress bar is for.
         *
         * A high mark also settles what happens when somebody pulls a build
         * down to make a better one: the level they earned stays earned.
         */
        record.islandPoints = Math.max(record.islandPoints, points);
        record.islandLevel = levelOf(record.islandPoints);

        if (record.islandLevel > was) levelUp(player, record.islandLevel);
        updateBar(player);
    }

    /** Scores an island without needing its owner online. For measuring. */
    public int scanFor(UUID who) {
        Location at = islandOf(who);
        return score(at.getBlockX(), at.getBlockZ(), radiusFor(who));
    }

    /**
     * How far out an island is counted.
     *
     * The size upgrade buys reach rather than blocks: nothing stops anybody
     * building past the edge of the scan, but until they have paid for it, what
     * they build out there does not count towards the level.
     */
    private int radiusFor(UUID who) {
        return SCAN_RADIUS
                + nexus.islandUpgrades().levelOf(who, IslandUpgrades.Upgrade.SIZE) * 6;
    }

    /**
     * Adds up the island, one loaded chunk at a time.
     *
     * Snapshots rather than block lookups, and loaded chunks only. Both matter
     * and the second one more: forcing a chunk to load in order to count what
     * is in it is how a scoring pass becomes a freeze.
     */
    private int score(int cx, int cz, int radius) {
        int low = Math.max(world().getMinHeight(), HEIGHT - SCAN_BELOW);
        int high = Math.min(world().getMaxHeight() - 1, HEIGHT + SCAN_ABOVE);

        int points = 0;

        int fromChunkX = (cx - radius) >> 4;
        int toChunkX = (cx + radius) >> 4;
        int fromChunkZ = (cz - radius) >> 4;
        int toChunkZ = (cz + radius) >> 4;

        for (int chunkX = fromChunkX; chunkX <= toChunkX; chunkX++) {
            for (int chunkZ = fromChunkZ; chunkZ <= toChunkZ; chunkZ++) {
                if (!world().isChunkLoaded(chunkX, chunkZ)) continue;

                var snapshot = world().getChunkAt(chunkX, chunkZ)
                        .getChunkSnapshot(false, false, false);

                for (int inX = 0; inX < 16; inX++) {
                    int worldX = (chunkX << 4) + inX;
                    if (worldX < cx - SCAN_RADIUS || worldX > cx + SCAN_RADIUS) continue;

                    for (int inZ = 0; inZ < 16; inZ++) {
                        int worldZ = (chunkZ << 4) + inZ;
                        if (worldZ < cz - SCAN_RADIUS || worldZ > cz + SCAN_RADIUS) continue;

                        for (int y = low; y <= high; y++) {
                            Integer worth = WORTH.get(snapshot.getBlockType(inX, y, inZ));
                            if (worth != null) points += worth;
                        }
                    }
                }
            }
        }

        return points;
    }

    /**
     * Every player in the world, one per second, round robin.
     *
     * Scanning everybody at once is the same work in one tick instead of
     * several, and it is the sort of thing that is fine with two players and a
     * visible stutter with twenty.
     */
    public void tickScan() {
        if (world == null) return;

        /*
         * One player every five seconds, not everybody every second.
         *
         * An island does not change fast enough for a faster pass to tell you
         * anything, and the level is a number that goes up rather than a timer
         * anybody is watching.
         */
        if (++scanCursor % 5 != 0) return;

        var here = world.getPlayers();
        if (here.isEmpty()) return;

        scan(here.get((scanCursor / 5) % here.size()));
    }

    /* ------------------------------------------------------------- the bar */

    public void showBar(Player player) {
        net.kyori.adventure.bossbar.BossBar bar = bars.get(player.getUniqueId());
        if (bar == null) {
            bar = net.kyori.adventure.bossbar.BossBar.bossBar(
                    net.kyori.adventure.text.Component.empty(), 0f,
                    net.kyori.adventure.bossbar.BossBar.Color.GREEN,
                    net.kyori.adventure.bossbar.BossBar.Overlay.NOTCHED_10);
            bars.put(player.getUniqueId(), bar);
        }

        player.showBossBar(bar);
        updateBar(player);
    }

    private void updateBar(Player player) {
        net.kyori.adventure.bossbar.BossBar bar = bars.get(player.getUniqueId());
        if (bar == null) return;

        Stats.Record record = nexus.stats().of(player.getUniqueId());
        int level = levelOf(record.islandPoints);
        int into = record.islandPoints % PER_LEVEL;

        bar.name(net.kyori.adventure.text.Component.text("Island Level ",
                        NamedTextColor.GRAY)
                .append(net.kyori.adventure.text.Component.text(level,
                        NamedTextColor.GOLD))
                .append(net.kyori.adventure.text.Component.text("   " + into + "/" + PER_LEVEL,
                        NamedTextColor.DARK_GRAY)));

        // Green up to level 10, then blue, then purple: the colour alone tells
        // you roughly how far somebody has got.
        bar.color(level >= 25 ? net.kyori.adventure.bossbar.BossBar.Color.PURPLE
                : level >= 10 ? net.kyori.adventure.bossbar.BossBar.Color.BLUE
                : net.kyori.adventure.bossbar.BossBar.Color.GREEN);
        bar.progress(Math.min(1f, into / (float) PER_LEVEL));
    }

    public void hideBar(Player player) {
        net.kyori.adventure.bossbar.BossBar bar = bars.remove(player.getUniqueId());
        if (bar != null) player.hideBossBar(bar);
    }

    /**
     * A level, and something for it.
     *
     * The rewards are deliberately things you cannot get on the island: a
     * skyblock run is gated on materials that are simply absent, so the prize
     * for progress is a way past one of those gates rather than more of what
     * you already have.
     */
    private void levelUp(Player player, int level) {
        double money = 200 + level * 40.0;
        nexus.stats().pay(player.getUniqueId(), money);

        Material[] prizes = {
                Material.SAND, Material.GRAVEL, Material.CLAY_BALL, Material.OBSIDIAN,
                Material.IRON_INGOT, Material.GOLD_INGOT, Material.DIAMOND,
                Material.BONE_MEAL, Material.OAK_SAPLING, Material.WHEAT_SEEDS,
        };
        Material prize = prizes[Math.abs((player.getUniqueId().hashCode() + level)) % prizes.length];
        int many = Math.min(32, 4 + level * 2);

        for (var spare : player.getInventory()
                .addItem(new ItemStack(prize, many)).values()) {
            player.getWorld().dropItem(player.getLocation().add(0, 0.2, 0), spare);
        }

        player.showTitle(net.kyori.adventure.title.Title.title(
                net.kyori.adventure.text.Component.text("ISLAND LEVEL " + level,
                        NamedTextColor.GOLD),
                net.kyori.adventure.text.Component.text(many + "x "
                                + prize.name().toLowerCase().replace('_', ' ')
                                + "   +" + Stats.cash(money),
                        NamedTextColor.GREEN),
                net.kyori.adventure.title.Title.Times.times(java.time.Duration.ofMillis(200),
                        java.time.Duration.ofSeconds(3), java.time.Duration.ofMillis(400))));
        player.playSound(player, org.bukkit.Sound.UI_TOAST_CHALLENGE_COMPLETE, 1f, 1f);

        nexus.getServer().broadcast(net.kyori.adventure.text.Component
                .text(player.getName(), NamedTextColor.WHITE)
                .append(net.kyori.adventure.text.Component.text(" reached island level ",
                        NamedTextColor.GRAY))
                .append(net.kyori.adventure.text.Component.text(level,
                        NamedTextColor.GOLD)));
    }

    /**
     * The starting island.
     *
     * Shaped rather than stacked. The first one was a flat five by five slab of
     * grass, which from underneath — which is where you spend the first minute,
     * looking up at it — is a green ceiling. An island wants a silhouette: wider
     * at the top than the bottom, an uneven edge, and a point it tapers to.
     *
     * Still only dirt and grass, and that is not laziness. Stone has to be
     * unobtainable or the cobblestone generator is pointless, and the generator
     * is the gate the whole game is built behind. Every block here is one you
     * are meant to already have.
     */
    /** Makes the island if it is not there, without moving anybody. */
    public void prepare(UUID who) {
        Location at = islandOf(who);
        if (world().getBlockAt(at.getBlockX(), HEIGHT, at.getBlockZ()).getType() == Material.AIR) {
            build(who);
        }
    }

    public void build(UUID who) {
        /*
         * A saved island wins over the built-in one.
         *
         * Whatever was captured with /is template is exactly what everybody
         * gets - the shape, the chest and what is in it, the generator, all of
         * it. The code below is only the fallback for a server that has never
         * saved one.
         */
        if (nexus.islandTemplate().exists()) {
            nexus.islandTemplate().paste(islandOf(who));
            return;
        }

        Location at = islandOf(who);
        int cx = at.getBlockX();
        int cz = at.getBlockZ();

        /*
         * Each layer narrower than the one above, so it tapers to a point.
         *
         * The radii are picked rather than computed: 4, 4, 3, 2, 1 gives a
         * couple of blocks of straight edge at the top before it starts pulling
         * in, which reads as an island. A smooth cone reads as a spike.
         */
        int[] radii = {4, 4, 3, 2, 1};

        for (int depth = 0; depth < radii.length; depth++) {
            int y = HEIGHT - depth;
            int radius = radii[depth];

            for (int x = -radius; x <= radius; x++) {
                for (int z = -radius; z <= radius; z++) {
                    int distance = x * x + z * z;
                    if (distance > radius * radius) continue;

                    // The top course is bitten into at the corners, so the
                    // outline is not a circle somebody stamped out.
                    if (depth == 0 && distance > (radius - 1) * (radius - 1)
                            && ((x + z * 3) & 3) == 0) {
                        continue;
                    }

                    world().getBlockAt(cx + x, y, cz + z)
                            .setType(depth == 0 ? Material.GRASS_BLOCK : Material.DIRT, false);
                }
            }
        }

        // The anchor goes at the tip, out of sight, rather than one block under
        // your feet where it is the first thing you look at.
        world().getBlockAt(cx, HEIGHT - radii.length, cz).setType(Material.BEDROCK, false);

        tree(cx + 2, cz + 2);
        chest(cx - 2, cz - 2);
        generator(cx, cz);
        greenery(cx, cz);
    }

    /**
     * A cobblestone generator, already built.
     *
     * Making one is the first thing every skyblock player does and the first
     * thing every new one has to be told how to do - and getting it wrong wastes
     * the single bucket of lava the island is built around. Since the generator
     * is now where ore comes from, an island without one is an island with no
     * way to progress at all.
     *
     * Water one side, lava the other, a gap between them where the cobblestone
     * forms, and stone around it so neither escapes.
     */
    private void generator(int cx, int cz) {
        int top = HEIGHT;
        int row = cz - 1;

        /*
         * A sunken generator with the lava boxed in overhead.
         *
         *   dx:   -1     0    +1    +2
         *   top  [#]   [L]   [#]   [ ]   <- lava, walled on every side
         *   -1   [W]   [c]   [ ]   [ ]   <- water, cobblestone, then the pit
         *   -2   [#]   [#]   [#]   [#]
         *
         * One rule decides this whole thing: lava may only ever be able to flow
         * downwards. Water cannot flow upwards, so a lava source it can never
         * climb to is a lava source it can never turn to obsidian - and lava
         * that can only fall cannot spread across the island either.
         *
         * Every earlier attempt broke that rule somewhere. Lava level with the
         * water made obsidian; lava on an open ledge poured out over the grass;
         * a step in the floor did not help, because water falling into a step
         * still spreads sideways in the same tick.
         *
         * You drop into the pit at the right and mine the cobblestone from
         * there. The lava is boxed in above it, visible from the surface, and
         * out of reach.
         */

        // Floor under all of it.
        for (int dx = -2; dx <= 2; dx++) {
            world().getBlockAt(cx + dx, top - 2, row).setType(Material.STONE, false);
        }

        // Sides, since the island's own blocks do not reach every face here.
        for (int dz : new int[] { -1, 1 }) {
            for (int dx = -2; dx <= 2; dx++) {
                world().getBlockAt(cx + dx, top - 1, row + dz).setType(Material.STONE, false);
                world().getBlockAt(cx + dx, top, row + dz).setType(Material.STONE, false);
            }
        }

        // The lava's box: solid either side of it, so down is the only way out.
        world().getBlockAt(cx - 1, top, row).setType(Material.STONE, false);
        world().getBlockAt(cx + 1, top, row).setType(Material.STONE, false);
        world().getBlockAt(cx - 2, top, row).setType(Material.STONE, false);
        world().getBlockAt(cx - 2, top - 1, row).setType(Material.STONE, false);

        // The working level: water, the gap it forms in, and the pit to stand in.
        world().getBlockAt(cx, top - 1, row).setType(Material.AIR, false);
        world().getBlockAt(cx + 1, top - 1, row).setType(Material.AIR, false);
        world().getBlockAt(cx + 2, top - 1, row).setType(Material.AIR, false);

        // The way in, at the far end from the lava.
        world().getBlockAt(cx + 2, top, row).setType(Material.AIR, false);

        /*
         * The liquids last, and with physics.
         *
         * Everything else goes in with physics off, which is right for stone
         * and wrong for anything that flows: with no update a fluid is never
         * scheduled to tick and sits in its block as a still square.
         */
        world().getBlockAt(cx - 1, top - 1, row).setType(Material.WATER, true);
        world().getBlockAt(cx, top, row).setType(Material.LAVA, true);
    }

    /**
     * Grass and flowers on top.
     *
     * Free, in the sense that neither is a resource the puzzle depends on, and
     * they do more for how the island looks than anything else here — a bare
     * grass platform reads as a texture, and one with things growing out of it
     * reads as ground.
     */
    private void greenery(int cx, int cz) {
        Material[] plants = {
                Material.SHORT_GRASS, Material.SHORT_GRASS, Material.SHORT_GRASS,
                Material.POPPY, Material.DANDELION, Material.CORNFLOWER,
        };

        int seed = cx * 31 + cz;
        for (int x = -4; x <= 4; x++) {
            for (int z = -4; z <= 4; z++) {
                if (x * x + z * z > 16) continue;

                Block ground = world().getBlockAt(cx + x, HEIGHT, cz + z);
                Block above = world().getBlockAt(cx + x, HEIGHT + 1, cz + z);
                if (ground.getType() != Material.GRASS_BLOCK || above.getType() != Material.AIR) {
                    continue;
                }

                // Deterministic scatter: the same island always looks the same,
                // and no Random has to be kept anywhere.
                int roll = Math.abs((seed + x * 7919 + z * 104729) % 5);
                if (roll != 0) continue;

                above.setType(plants[Math.abs((seed + x * 13 + z * 29)) % plants.length], false);
            }
        }
    }

    private void tree(int cx, int cz) {
        for (int y = HEIGHT + 1; y <= HEIGHT + 5; y++) {
            world().getBlockAt(cx, y, cz).setType(Material.OAK_LOG, false);
        }

        for (int x = -2; x <= 2; x++) {
            for (int z = -2; z <= 2; z++) {
                for (int y = HEIGHT + 4; y <= HEIGHT + 7; y++) {
                    int spread = y >= HEIGHT + 6 ? 1 : 2;
                    if (Math.abs(x) > spread || Math.abs(z) > spread) continue;
                    if (x == 0 && z == 0 && y <= HEIGHT + 5) continue;

                    Block leaf = world().getBlockAt(cx + x, y, cz + z);
                    if (leaf.getType() == Material.AIR) leaf.setType(Material.OAK_LEAVES, false);
                }
            }
        }
    }

    /**
     * The chest, and the argument for everything in it.
     *
     * Ice: your only water, and you have to work out that melting it needs a
     * light source and somewhere for it to go. Lava: the cobblestone generator,
     * which is the gate every other material is behind. Saplings and bone meal:
     * a second tree, because losing the first one is how most runs end. Melon
     * and pumpkin seeds: food that needs neither bonemeal nor bees.
     */
    private void chest(int cx, int cz) {
        Block block = world().getBlockAt(cx, HEIGHT + 1, cz);
        block.setType(Material.CHEST, false);

        if (!(block.getState() instanceof Chest chest)) return;

        /*
         * Emptied before it is filled.
         *
         * Setting a block to CHEST when it is already a chest leaves the block
         * entity, and its contents, exactly where they were - so building an
         * island over an existing one added a second set of everything rather
         * than replacing the first. Six lava buckets, four ice, sixteen bread.
         *
         * Clearing first makes building twice mean the same as building once,
         * which is what anybody would assume it meant.
         */
        chest.getBlockInventory().clear();

        /*
         * getBlockInventory, not getInventory.
         *
         * This is why the first chest came out empty. block.getState() hands
         * back a *snapshot*, and getInventory() on a snapshot fills a copy that
         * is thrown away — the chest in the world never sees it, and there is
         * no error anywhere to say so. getBlockInventory() is the live one.
         *
         * For a double chest getInventory() would also return both halves,
         * which is a second reason to be specific.
         */
        /*
         * Three lava buckets and dripstone, which together are a lava farm.
         *
         * A pointed dripstone over a cauldron with lava above it refills the
         * cauldron on its own, so this is not three buckets of lava - it is
         * every bucket of lava from here on. Deliberate: with one bucket and no
         * way to make more, a single misplaced pour ends the smelting side of
         * the island for good, and starting again is the only fix.
         */
        chest.getBlockInventory().addItem(
                new ItemStack(Material.ICE, 2),
                new ItemStack(Material.LAVA_BUCKET, 1),
                new ItemStack(Material.LAVA_BUCKET, 1),
                new ItemStack(Material.LAVA_BUCKET, 1),
                new ItemStack(Material.POINTED_DRIPSTONE, 4),
                new ItemStack(Material.DRIPSTONE_BLOCK, 4),
                new ItemStack(Material.CAULDRON, 1),
                new ItemStack(Material.OAK_SAPLING, 2),
                new ItemStack(Material.BONE_MEAL, 8),
                new ItemStack(Material.MELON_SEEDS, 1),
                new ItemStack(Material.PUMPKIN_SEEDS, 1),
                new ItemStack(Material.BREAD, 8)
        );
    }

    /* -------------------------------------------------------- the generator */

    /**
     * What the cobble generator gives, and when.
     *
     * The same idea as One Block's phases, tied to island level instead of
     * blocks broken: at the start a generator is a source of cobblestone and
     * very little else, and by the end it is the mine the island does not have.
     * Without this the only way to get iron on a skyblock island is a mob
     * spawner and a lot of patience, which is where most people stop playing.
     *
     * Weighted by repetition, exactly as the One Block phases are - reading a
     * list and counting the entries is easier to judge at a glance than a table
     * of percentages that has to add up.
     */
    private record Tier(String name, int untilLevel, Material[] rolls,
                       org.bukkit.entity.EntityType[] mobs) {
    }

    private static final Tier[] TIERS = {
            new Tier("Bare rock", 5, weighted(
                    Material.COBBLESTONE, 18,
                    Material.COAL_ORE, 2),
                    new org.bukkit.entity.EntityType[] {
                            org.bukkit.entity.EntityType.CHICKEN,
                            org.bukkit.entity.EntityType.COW,
                    }),

            new Tier("Seams", 12, weighted(
                    Material.COBBLESTONE, 26,
                    Material.COAL_ORE, 8,
                    Material.COPPER_ORE, 4,
                    Material.IRON_ORE, 2),
                    new org.bukkit.entity.EntityType[] {
                            org.bukkit.entity.EntityType.CHICKEN,
                            org.bukkit.entity.EntityType.COW,
                            org.bukkit.entity.EntityType.SHEEP,
                            org.bukkit.entity.EntityType.PIG,
                    }),

            new Tier("Deep rock", 25, weighted(
                    Material.COBBLESTONE, 24,
                    Material.COAL_ORE, 6,
                    Material.COPPER_ORE, 4,
                    Material.IRON_ORE, 4,
                    Material.REDSTONE_ORE, 1,
                    Material.LAPIS_ORE, 1),
                    new org.bukkit.entity.EntityType[] {
                            org.bukkit.entity.EntityType.COW,
                            org.bukkit.entity.EntityType.SHEEP,
                            org.bukkit.entity.EntityType.PIG,
                            org.bukkit.entity.EntityType.ZOMBIE,
                            org.bukkit.entity.EntityType.SKELETON,
                    }),

            new Tier("The vein", Integer.MAX_VALUE, weighted(
                    Material.COBBLESTONE, 22,
                    Material.COAL_ORE, 6,
                    Material.COPPER_ORE, 4,
                    Material.IRON_ORE, 5,
                    Material.REDSTONE_ORE, 3,
                    Material.LAPIS_ORE, 3,
                    Material.GOLD_ORE, 3,
                    Material.DIAMOND_ORE, 1),
                    new org.bukkit.entity.EntityType[] {
                            org.bukkit.entity.EntityType.COW,
                            org.bukkit.entity.EntityType.SHEEP,
                            org.bukkit.entity.EntityType.ZOMBIE,
                            org.bukkit.entity.EntityType.SKELETON,
                            org.bukkit.entity.EntityType.SPIDER,
                            org.bukkit.entity.EntityType.CREEPER,
                            org.bukkit.entity.EntityType.ENDERMAN,
                    }),
    };

    /**
     * A roll table written as pairs rather than by repeating entries.
     *
     * The One Block phases repeat a material to weight it, which reads well at
     * ten entries and stops reading at forty - and forty is what it takes to
     * say "one in fifty" without the number being a lie. Diamonds matter here:
     * a generator handing one out every fourteen blocks is not a reward, it is
     * the end of the shops, the auction house and every job on the server.
     */
    private static Material[] weighted(Object... pairs) {
        java.util.List<Material> rolls = new java.util.ArrayList<>();

        for (int i = 0; i + 1 < pairs.length; i += 2) {
            Material what = (Material) pairs[i];
            int many = (Integer) pairs[i + 1];
            for (int n = 0; n < many; n++) rolls.add(what);
        }

        return rolls.toArray(new Material[0]);
    }

    private Tier tierFor(int level) {
        for (Tier tier : TIERS) {
            if (level < tier.untilLevel()) return tier;
        }
        return TIERS[TIERS.length - 1];
    }

    /**
     * Whose island this spot belongs to.
     *
     * Worked out from whoever is standing in the world rather than from the
     * grid, because the grid maps a player to a slot and not back again - the
     * slot is a hash, and a hash does not run in reverse. That costs nothing:
     * a generator only runs in a loaded chunk, and a chunk is only loaded
     * because somebody is near it.
     */
    private UUID ownerAt(int x, int z) {
        for (Player player : world().getPlayers()) {
            if (ownsSpot(player.getUniqueId(), x, z)) return player.getUniqueId();

            for (UUID host : nexus.islandTeam().hostsFor(player.getUniqueId())) {
                if (ownsSpot(host, x, z)) return host;
            }
        }
        return null;
    }

    /**
     * Somewhere with room to stand, near where the block was mined.
     *
     * Not the block's own position, which is where One Block puts them: there
     * the block is broken and stays broken, while a generator replaces itself
     * the same tick - so a cow spawned in the gap ended up inside the ore that
     * formed on top of it, and had to be hit out.
     *
     * Two blocks of clear air with something solid underneath, searched
     * outwards from the player. Their own feet are the fallback, since whatever
     * else is true, somebody is standing there.
     */
    private Location roomFor(Player player, Block block) {
        Location standing = player.getLocation();

        for (int dx = -2; dx <= 2; dx++) {
            for (int dz = -2; dz <= 2; dz++) {
                for (int dy = 0; dy <= 1; dy++) {
                    Block feet = block.getWorld().getBlockAt(
                            standing.getBlockX() + dx,
                            standing.getBlockY() + dy,
                            standing.getBlockZ() + dz);

                    if (!feet.getType().isAir()) continue;
                    if (!feet.getRelative(org.bukkit.block.BlockFace.UP).getType().isAir()) continue;
                    if (!feet.getRelative(org.bukkit.block.BlockFace.DOWN).getType().isSolid()) continue;

                    return feet.getLocation().add(0.5, 0, 0.5);
                }
            }
        }

        return standing;
    }

    /**
     * Whether this block is part of a generator rather than part of a wall.
     *
     * Touching water or lava, which is what a generator is. Without the test,
     * knocking a hole in your own cobblestone house would hatch livestock.
     */
    private boolean fromGenerator(Block block) {
        org.bukkit.block.BlockFace[] sides = {
                org.bukkit.block.BlockFace.NORTH, org.bukkit.block.BlockFace.SOUTH,
                org.bukkit.block.BlockFace.EAST, org.bukkit.block.BlockFace.WEST,
                org.bukkit.block.BlockFace.UP, org.bukkit.block.BlockFace.DOWN };

        for (org.bukkit.block.BlockFace face : sides) {
            Material touching = block.getRelative(face).getType();
            if (touching == Material.LAVA || touching == Material.WATER) return true;
        }
        return false;
    }

    /**
     * Something coming out of the generator when it is mined.
     *
     * The same idea as One Block, and for the same reason: an island in an empty
     * sky has no other way of producing an animal. Natural spawning needs grass,
     * light and room, and on a starter island that is a very long wait for a
     * single chicken - so the block that everything else comes out of provides
     * these too.
     *
     * One in eighteen, which is what One Block uses. Often enough to be a real
     * source and rare enough that a morning of mining does not bury the island
     * in cows.
     */
    public void mined(Player player, Block block) {
        if (world == null || !block.getWorld().equals(world)) return;
        if (!fromGenerator(block)) return;
        if (Math.random() >= 1.0 / 18.0) return;

        UUID owner = ownerAt(block.getX(), block.getZ());
        if (owner == null) return;

        int reach = levelOf(nexus.stats().of(owner).islandPoints)
                + nexus.islandUpgrades().levelOf(owner, IslandUpgrades.Upgrade.GENERATOR) * 6;

        org.bukkit.entity.EntityType[] mobs = tierFor(reach).mobs();
        if (mobs.length == 0) return;

        org.bukkit.entity.EntityType mob = mobs[(int) (Math.random() * mobs.length)];
        block.getWorld().spawnEntity(roomFor(player, block), mob);
    }

    /**
     * Cobblestone about to form in a generator, turned into ore.
     *
     * The block itself changes, rather than the drop being swapped when it is
     * mined. That is worth the extra work for three reasons: you can see the
     * ore sitting in the generator, Fortune multiplies it because it is a real
     * ore being broken, and Silk Touch collects the block - none of which is
     * true of a drop quietly replaced on the way out.
     */
    public void forming(org.bukkit.event.block.BlockFormEvent event) {
        if (world == null || !event.getBlock().getWorld().equals(world)) return;

        Material becoming = event.getNewState().getType();
        if (becoming != Material.COBBLESTONE && becoming != Material.STONE) return;

        UUID owner = ownerAt(event.getBlock().getX(), event.getBlock().getZ());
        if (owner == null) return;

        /*
         * The generator upgrade counts as island levels, rather than as its own
         * ladder. One table decides what a generator gives, and buying the
         * upgrade moves you up it - which is easier to explain to a player and
         * leaves one place to balance rather than two.
         */
        int reach = levelOf(nexus.stats().of(owner).islandPoints)
                + nexus.islandUpgrades().levelOf(owner, IslandUpgrades.Upgrade.GENERATOR) * 6;

        Tier tier = tierFor(reach);
        Material rolled = tier.rolls()[(int) (Math.random() * tier.rolls().length)];

        // Cobblestone is the common roll and needs no help.
        if (rolled == Material.COBBLESTONE) return;

        event.getNewState().setType(rolled);
    }

    /**
     * The best islands on the server, and a way to go and look at them.
     *
     * An island level that nobody else can see is a number in a bar. Made
     * clickable, because reading a name off the screen and typing it back in
     * is a step most people will not take.
     */
    public void top(Player player) {
        java.util.List<java.util.Map.Entry<UUID, Stats.Record>> best =
                new java.util.ArrayList<>(nexus.stats().everybody().entrySet());

        best.removeIf(entry -> entry.getValue().islandPoints <= 0);
        best.sort((a, b) -> Integer.compare(b.getValue().islandPoints, a.getValue().islandPoints));

        player.sendMessage(Text.heading("Island top"));

        if (best.isEmpty()) {
            player.sendMessage(Text.plain("  Nobody has built anything yet."));
            return;
        }

        int shown = 0;
        for (java.util.Map.Entry<UUID, Stats.Record> entry : best) {
            if (shown++ >= 10) break;

            String name = Bukkit.getOfflinePlayer(entry.getKey()).getName();
            if (name == null) name = "somebody";

            player.sendMessage(Component.text("  " + shown + ". ", NamedTextColor.DARK_GRAY)
                    .append(Component.text(name, Text.BRAND))
                    .append(Component.text("  level " + levelOf(entry.getValue().islandPoints),
                            NamedTextColor.GRAY))
                    .clickEvent(net.kyori.adventure.text.event.ClickEvent
                            .runCommand("/is visit " + name))
                    .hoverEvent(net.kyori.adventure.text.event.HoverEvent
                            .showText(Component.text("Go and look", NamedTextColor.GRAY))));
        }
    }

    /**
     * Standing on somebody else's island.
     *
     * Through the world system, so somebody cannot carry a creative inventory
     * in with them - the same reason warps go that way.
     */
    public void visit(Player player, String name) {
        org.bukkit.OfflinePlayer host = Bukkit.getOfflinePlayerIfCached(name);

        if (host == null) {
            player.sendMessage(Text.bad("Nobody here has been called that."));
            return;
        }

        if (nexus.worlds().placeOf(player) != Worlds.Place.SKYBLOCK) {
            nexus.worlds().send(player, Worlds.Place.SKYBLOCK);
        }

        prepare(host.getUniqueId());
        player.teleport(islandOf(host.getUniqueId()).add(0, 1, 0));

        player.sendMessage(Text.says("Visiting " + host.getName() + "'s island."));
        player.sendMessage(Text.plain("  /is to go back to your own."));
    }

    /**
     * Nudges crops along on islands that have paid for it.
     *
     * A handful of random spots near each player, once a tick, rather than the
     * whole island: the effect people notice is their own farm growing while
     * they stand in it, and scanning an entire island every tick to produce
     * that would cost far more than it is worth.
     */
    private void growth() {
        if (world == null) return;

        for (Player player : world.getPlayers()) {
            int bought = nexus.islandUpgrades()
                    .levelOf(player.getUniqueId(), IslandUpgrades.Upgrade.GROWTH);
            if (bought <= 0) continue;

            Location at = player.getLocation();

            for (int tries = 0; tries < bought * 2; tries++) {
                Block block = at.getWorld().getBlockAt(
                        at.getBlockX() + (int) (Math.random() * 17) - 8,
                        at.getBlockY() + (int) (Math.random() * 5) - 2,
                        at.getBlockZ() + (int) (Math.random() * 17) - 8);

                if (!(block.getBlockData() instanceof org.bukkit.block.data.Ageable crop)) continue;
                if (crop.getAge() >= crop.getMaximumAge()) continue;

                crop.setAge(crop.getAge() + 1);
                block.setBlockData(crop, false);
            }
        }
    }

    /**
     * Catches anybody who falls off.
     *
     * Same reasoning as One Block: there is nothing under the island but void,
     * and losing an evening to one misstep is how people stop playing. Unlike
     * One Block this one costs you the fall damage, because in Skyblock the
     * edge is a hazard you are supposed to respect.
     */
    public void tick() {
        if (world == null) return;

        growth();

        for (Player player : world.getPlayers()) {
            if (player.getLocation().getY() > HEIGHT - 45) continue;

            player.teleport(islandOf(player.getUniqueId()).clone().add(0, 2, 0));
            player.setFallDistance(0f);
            player.damage(4.0);
            player.sendMessage(Text.bad("That was close."));
        }
    }
}
