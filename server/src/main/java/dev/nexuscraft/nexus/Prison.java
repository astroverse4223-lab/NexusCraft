package dev.nexuscraft.nexus;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.title.Title;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.Sound;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.enchantments.Enchantment;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;

import java.time.Duration;
import java.util.Random;
import java.util.UUID;

/**
 * Prison: a ladder made of rock.
 *
 * The whole genre is one loop — mine, sell, rank up, mine somewhere better —
 * and it works because every part of it is visible. You can see how much the
 * next rank costs, you can see the better ore in the mine you cannot enter yet,
 * and you can see the number going up while you do something mindless. It is
 * the most honest progression system in Minecraft and it needs no story at all.
 *
 * Ten ranks, A to J. Each has its own mine, each mine is richer than the last,
 * and each refills when it is mostly gone so nobody ever stands in an empty pit
 * waiting for something to happen.
 */
public final class Prison {

    /** The ladder. Cost is what it takes to leave that rank for the next. */
    public static final char[] LETTERS = {'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'};

    private static final double[] COSTS = {
            500, 1_500, 4_000, 10_000, 25_000,
            60_000, 140_000, 320_000, 750_000, 0,
    };

    /**
     * Where each mine sits, spaced so they genuinely never touch.
     *
     * Ten mines around a ring of 44 put their centres 27 blocks apart, and a
     * mine with its rim is 32 across - so every one of them overlapped its
     * neighbours by about five blocks. The walls between them were shared, the
     * pits ran into each other, and a block in the overlap belonged to
     * whichever mine happened to be checked first, which let a rank A player
     * dig sideways into ore they had not earned.
     *
     * At 72 the neighbours are 44 apart, which leaves a clear twelve blocks of
     * ground between one pit and the next.
     */
    private static final int MINE_SPACING = 72;
    private static final int MINE_RADIUS = 14;
    private static final int MINE_DEPTH = 10;
    private static final int MINE_FLOOR = 40;

    private static final int PLAZA = 70;

    private final Nexus nexus;
    private final Random random = new Random();

    private World world;

    public Prison(Nexus nexus) {
        this.nexus = nexus;
    }

    /* --------------------------------------------------------------- world */

    public Location spawn() {
        return new Location(world(), 0.5, PLAZA + 1, 0.5, 0f, 0f);
    }

    private World world() {
        if (world == null) {
            world = nexus.worlds().of(Worlds.Place.PRISON);
            if (world.getBlockAt(0, PLAZA, 0).getType() == Material.AIR) build();
        }
        return world;
    }

    /**
     * The yard, and ten mines around it.
     *
     * Laid out in a ring rather than a line so that every mine is the same walk
     * from the middle. In a line, rank J is a two-minute trudge from the shop
     * and the reward for reaching the top is a longer commute.
     */
    private void build() {
        // The yard.
        for (int x = -14; x <= 14; x++) {
            for (int z = -14; z <= 14; z++) {
                if (x * x + z * z > 14 * 14) continue;

                boolean rim = x * x + z * z > 13 * 13;
                world.getBlockAt(x, PLAZA, z).setType(
                        rim ? Material.POLISHED_ANDESITE : Material.SMOOTH_STONE, false);
                world.getBlockAt(x, PLAZA - 1, z).setType(Material.STONE_BRICKS, false);
            }
        }

        // Walls, because it is a prison.
        for (int angle = 0; angle < 360; angle += 2) {
            double radians = Math.toRadians(angle);
            int x = (int) Math.round(Math.cos(radians) * 14);
            int z = (int) Math.round(Math.sin(radians) * 14);

            for (int y = PLAZA + 1; y <= PLAZA + 4; y++) {
                world.getBlockAt(x, y, z).setType(Material.POLISHED_BLACKSTONE_BRICKS, false);
            }
            if (angle % 30 == 0) {
                world.getBlockAt(x, PLAZA + 5, z).setType(Material.SEA_LANTERN, false);
            }
        }

        for (int rank = 0; rank < LETTERS.length; rank++) mine(rank);
    }

    private Location mineCentre(int rank) {
        double angle = Math.toRadians(rank * (360.0 / LETTERS.length));
        return new Location(world,
                Math.cos(angle) * MINE_SPACING, MINE_FLOOR + MINE_DEPTH + 2, Math.sin(angle) * MINE_SPACING);
    }

    /** Where a player is put when they walk into a mine. */
    public Location mineEntrance(int rank) {
        Location centre = mineCentre(rank);
        return new Location(world, centre.getX(), MINE_FLOOR + MINE_DEPTH + 2, centre.getZ(), 0f, 0f);
    }

    /**
     * One mine: a walled pit, a lip to stand on, and a sign saying whose it is.
     *
     * The lip matters. Without somewhere to land you teleport into the middle
     * of solid stone and suffocate, which is a very funny bug to find out about
     * from a player rather than from the code.
     */
    private void mine(int rank) {
        Location centre = mineCentre(rank);
        int cx = centre.getBlockX();
        int cz = centre.getBlockZ();

        for (int x = -MINE_RADIUS - 2; x <= MINE_RADIUS + 2; x++) {
            for (int z = -MINE_RADIUS - 2; z <= MINE_RADIUS + 2; z++) {
                int distance = x * x + z * z;
                if (distance > (MINE_RADIUS + 2) * (MINE_RADIUS + 2)) continue;

                // The rim you stand on.
                if (distance > MINE_RADIUS * MINE_RADIUS) {
                    world.getBlockAt(cx + x, MINE_FLOOR + MINE_DEPTH + 1, cz + z)
                            .setType(Material.POLISHED_BLACKSTONE, false);
                    for (int y = MINE_FLOOR; y <= MINE_FLOOR + MINE_DEPTH; y++) {
                        world.getBlockAt(cx + x, y, cz + z).setType(Material.BEDROCK, false);
                    }
                    continue;
                }

                world.getBlockAt(cx + x, MINE_FLOOR - 1, cz + z).setType(Material.BEDROCK, false);
            }
        }

        refill(rank);
    }

    /**
     * Lays the whole prison out again from nothing.
     *
     * Needed because the mines moved: the old ones were built where the old
     * spacing put them, and simply building the new ones would leave the old
     * pits sitting beside them. Everything in the area is cleared first so
     * what is left is only what belongs.
     */
    public void rebuild() {
        World here = world();

        int reach = MINE_SPACING + MINE_RADIUS + 6;

        for (int x = -reach; x <= reach; x++) {
            for (int z = -reach; z <= reach; z++) {
                for (int y = MINE_FLOOR - 2; y <= PLAZA + 8; y++) {
                    Block block = here.getBlockAt(x, y, z);
                    if (block.getType() != Material.AIR) block.setType(Material.AIR, false);
                }
            }
        }

        build();
    }

    /* -------------------------------------------------------------- filling */

    /**
     * What is in each mine.
     *
     * Weighted so the cheap stuff never disappears entirely — a mine that is
     * all diamond is not a reward, it is a different game with no rhythm to it.
     * The good ore gets more common with rank rather than replacing what was
     * there.
     */
    private Material rock(int rank) {
        int roll = random.nextInt(100);

        if (rank >= 8 && roll < 6) return Material.EMERALD_ORE;
        if (rank >= 6 && roll < 10) return Material.DIAMOND_ORE;
        if (rank >= 5 && roll < 18) return Material.GOLD_ORE;
        if (rank >= 3 && roll < 26) return Material.REDSTONE_ORE;
        if (rank >= 2 && roll < 34) return Material.LAPIS_ORE;
        if (rank >= 1 && roll < 44) return Material.IRON_ORE;
        if (roll < 60) return Material.COAL_ORE;

        return Material.STONE;
    }

    public void refill(int rank) {
        Location centre = mineCentre(rank);
        int cx = centre.getBlockX();
        int cz = centre.getBlockZ();

        for (int x = -MINE_RADIUS; x <= MINE_RADIUS; x++) {
            for (int z = -MINE_RADIUS; z <= MINE_RADIUS; z++) {
                if (x * x + z * z > MINE_RADIUS * MINE_RADIUS) continue;

                for (int y = MINE_FLOOR; y <= MINE_FLOOR + MINE_DEPTH; y++) {
                    world.getBlockAt(cx + x, y, cz + z).setType(rock(rank), false);
                }
            }
        }
    }

    /**
     * Refills a mine once it is mostly gone.
     *
     * Sampled rather than counted: walking every block of ten mines once a
     * second is a hundred thousand block reads for a number that only has to be
     * roughly right. Forty samples is plenty to tell a full mine from an empty
     * one.
     */
    public void tick() {
        if (world == null) return;

        for (int rank = 0; rank < LETTERS.length; rank++) {
            Location centre = mineCentre(rank);
            int cx = centre.getBlockX();
            int cz = centre.getBlockZ();

            int air = 0;
            for (int sample = 0; sample < 40; sample++) {
                int x = random.nextInt(MINE_RADIUS * 2 + 1) - MINE_RADIUS;
                int z = random.nextInt(MINE_RADIUS * 2 + 1) - MINE_RADIUS;
                if (x * x + z * z > MINE_RADIUS * MINE_RADIUS) continue;

                int y = MINE_FLOOR + random.nextInt(MINE_DEPTH + 1);
                if (world.getBlockAt(cx + x, y, cz + z).getType() == Material.AIR) air++;
            }

            if (air < 28) continue;

            // Anybody standing in it gets lifted out first, or the refill
            // encases them in stone.
            for (Player player : world.getPlayers()) {
                if (player.getLocation().distanceSquared(centre) < (MINE_RADIUS + 3) * (MINE_RADIUS + 3)) {
                    player.teleport(mineEntrance(rank));
                    player.sendMessage(Text.says("Mine " + LETTERS[rank] + " is being refilled."));
                }
            }
            refill(rank);
        }
    }

    /* -------------------------------------------------------------- playing */

    public void arrive(Player player) {
        Stats.Record record = nexus.stats().of(player.getUniqueId());

        if (player.getInventory().getItemInMainHand().getType() == Material.AIR) {
            player.getInventory().addItem(pickaxe(record.prisonRank));
        }

        player.sendMessage(Text.heading("Prison"));
        player.sendMessage(Text.field("Rank", String.valueOf(LETTERS[record.prisonRank])));
        player.sendMessage(Text.field("Balance", Stats.cash(record.money)));
        player.sendMessage(Text.plain("  /mine to go to your mine, /sell all to sell, /rankup to climb."));
    }

    /** A better pickaxe every few ranks, so the climb is felt in the hand. */
    public static ItemStack pickaxe(int rank) {
        Material type = rank >= 8 ? Material.NETHERITE_PICKAXE
                : rank >= 6 ? Material.DIAMOND_PICKAXE
                : rank >= 3 ? Material.IRON_PICKAXE
                : Material.STONE_PICKAXE;

        ItemStack pick = new ItemStack(type);
        pick.editMeta(meta -> {
            meta.displayName(Text.item("Prison Pickaxe", NamedTextColor.AQUA));
            meta.setUnbreakable(true);
        });
        pick.addUnsafeEnchantment(Enchantment.EFFICIENCY, 3 + rank);
        return pick;
    }

    /** Which mine a position is in, or -1 if it is not in one. */
    public int mineAt(Location at) {
        if (world == null || !at.getWorld().equals(world)) return -1;

        for (int rank = 0; rank < LETTERS.length; rank++) {
            Location centre = mineCentre(rank);
            double dx = at.getX() - centre.getX();
            double dz = at.getZ() - centre.getZ();

            if (dx * dx + dz * dz < (MINE_RADIUS + 2) * (MINE_RADIUS + 2)) return rank;
        }
        return -1;
    }

    /**
     * Mining a block. The only place money enters the world.
     *
     * You may work any mine at or below your rank. Letting people back into the
     * earlier ones costs nothing and means a friend who just joined can be
     * shown around rather than left standing at the gate.
     */
    /**
     * Whether this block is part of what a mine is actually filled with.
     *
     * {@link #mineAt} answers a looser question - which mine's patch of the map
     * this is - using a radius two blocks wider than the ore and no height at
     * all. That was the only test, so the ring of wall around each mine counted
     * as being inside it, and so did the whole column of air above it and the
     * plaza floor seventy blocks up. Players dug through the walls between
     * mines and walked from rank A into rank J.
     *
     * These are the same bounds {@link #refill} fills, which is the definition
     * of what is meant to be dug.
     */
    private boolean diggable(Location at, int rank) {
        Location centre = mineCentre(rank);

        double dx = at.getX() - centre.getX();
        double dz = at.getZ() - centre.getZ();

        if (dx * dx + dz * dz > MINE_RADIUS * MINE_RADIUS) return false;

        int y = at.getBlockY();
        return y >= MINE_FLOOR && y <= MINE_FLOOR + MINE_DEPTH;
    }

    public boolean mined(Player player, Block block) {
        int mine = mineAt(block.getLocation());

        // The walls belong to the prison, not to the mine they surround.
        if (mine >= 0 && !diggable(block.getLocation(), mine)) mine = -1;

        /*
         * Anything that is not a mine is the prison itself.
         *
         * This used to allow it: a block outside every mine returned "not
         * refused", which is the answer for a world where digging is the
         * exception - and prison is the opposite. So the plaza floor, the
         * shaft and the walls between the mines were all diggable, and a
         * player could open a hole from rank A into rank J and skip the game
         * entirely.
         */
        if (mine < 0) {
            if (nexus.hub().isBuilding(player.getUniqueId())) return false;

            // On the action bar, because a player holding the button down
            // would otherwise be told twenty times a second.
            player.sendActionBar(Component.text(
                    "Only the mines can be dug here", NamedTextColor.RED));
            return true;
        }

        Stats.Record record = nexus.stats().of(player.getUniqueId());
        if (mine > record.prisonRank) {
            player.sendMessage(Text.bad("Mine " + LETTERS[mine] + " is for rank "
                    + LETTERS[mine] + " and above. You are " + LETTERS[record.prisonRank] + "."));
            return true;
        }

        record.blocksMined++;
        return false;
    }

    public void goToMine(Player player) {
        Stats.Record record = nexus.stats().of(player.getUniqueId());
        player.teleport(mineEntrance(record.prisonRank));
        player.sendMessage(Text.says("Mine " + LETTERS[record.prisonRank] + "."));
    }

    /* -------------------------------------------------------------- ranking */

    public double costOf(int rank) {
        return rank >= COSTS.length ? 0 : COSTS[rank];
    }

    /**
     * How much of the current mine you have to work before the next one opens.
     *
     * Rising with rank, so the later mines are a stint rather than a formality.
     * Money alone was not a gate: somebody arriving with savings from anywhere
     * else on the server could take every rank in a row without mining a block,
     * which is what made the mines after the first one pointless.
     */
    public int quotaFor(int rank) {
        return 120 + rank * 60;
    }

    public void rankUp(Player player) {
        Stats.Record record = nexus.stats().of(player.getUniqueId());

        if (record.prisonRank >= LETTERS.length - 1) {
            player.sendMessage(Text.says("You are rank J. There is nowhere left to go."));
            return;
        }

        int quota = quotaFor(record.prisonRank);
        int mined = record.blocksMined - record.rankMinedAt;

        if (mined < quota) {
            player.sendMessage(Text.bad("Mine " + (quota - mined) + " more block"
                    + (quota - mined == 1 ? "" : "s") + " in Mine "
                    + LETTERS[record.prisonRank] + " first."));
            player.sendMessage(Text.plain("  " + mined + " of " + quota + " done."));
            return;
        }

        double cost = costOf(record.prisonRank);
        if (!nexus.stats().charge(player.getUniqueId(), cost)) {
            player.sendMessage(Text.bad("Rank " + LETTERS[record.prisonRank + 1]
                    + " costs " + Stats.cash(cost) + ". You have "
                    + Stats.cash(record.money) + "."));
            return;
        }

        record.prisonRank++;
        record.rankMinedAt = record.blocksMined;

        // The pickaxe comes with the rank, and the old one goes, so nobody ends
        // up carrying four of them.
        player.getInventory().remove(Material.STONE_PICKAXE);
        player.getInventory().remove(Material.IRON_PICKAXE);
        player.getInventory().remove(Material.DIAMOND_PICKAXE);
        player.getInventory().remove(Material.NETHERITE_PICKAXE);
        player.getInventory().addItem(pickaxe(record.prisonRank));

        player.showTitle(Title.title(
                Component.text("RANK " + LETTERS[record.prisonRank], NamedTextColor.GOLD),
                Component.text("Mine " + LETTERS[record.prisonRank] + " is open", NamedTextColor.GRAY),
                Title.Times.times(Duration.ofMillis(300), Duration.ofSeconds(3), Duration.ofMillis(500))));
        player.playSound(player, Sound.UI_TOAST_CHALLENGE_COMPLETE, 1f, 1f);

        nexus.feed().say(player,
                record.prisonRank >= LETTERS.length - 2 ? Feed.Weight.BIG : Feed.Weight.NOTE,
                "reached prison rank " + LETTERS[record.prisonRank] + ".");
    }
}
