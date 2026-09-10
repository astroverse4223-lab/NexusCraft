package dev.nexuscraft.nexus;

import net.kyori.adventure.bossbar.BossBar;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.Sound;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.entity.Player;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;
import org.bukkit.potion.PotionEffect;
import org.bukkit.potion.PotionEffectType;

import java.util.HashMap;
import java.util.Map;
import java.util.Random;
import java.util.UUID;

/**
 * The dig site: a hole, a pack that fills, and a man who buys what is in it.
 *
 * The loop is the oldest one there is - dig, carry, sell, buy a better tool,
 * dig faster - and it works because every part of it is a number going up that
 * you chose to spend. What makes it different from prison, which is the same
 * shape, is the pack: prison pays you the moment you swing, so there is no
 * decision in it. Here you can only carry so much, and a full pack a long way
 * down is a climb you chose.
 *
 * Depth is the other half. The ground is layered, the good stuff is at the
 * bottom, and a better shovel is what lets you reach it before your pack fills
 * with topsoil.
 */
public final class DigSite {

    /* ---------------------------------------------------------------- shape */

    /** The camp you arrive at, and where the buyer stands. */
    private static final int SURFACE = 100;

    /** How far down the ground goes before bedrock. */
    private static final int FLOOR = 40;

    /** How wide the dig field is, from the middle. */
    private static final int REACH = 40;

    /* ------------------------------------------------------------ upgrades */

    /**
     * What each pack holds.
     *
     * The first is deliberately small. A pack that lasts a whole trip down
     * teaches nobody that there is a decision to make, and the moment it fills
     * halfway to the bottom is the moment the game starts.
     */
    static final int[] PACK_SIZE = {12, 20, 32, 48, 72, 110, 160, 240};

    /*
     * The first one is cheap on purpose.
     *
     * A starting pack of twelve topsoil is about twenty-five in the hand, so a
     * four hundred first upgrade is sixteen trips before anything changes -
     * which is a long time to play a game that has not started yet.
     */
    static final double[] PACK_COST = {0, 150, 900, 3_000, 8_000, 22_000, 60_000, 150_000};

    /**
     * What each shovel is worth, and how fast it swings.
     *
     * Speed is haste rather than a shorter cooldown, because haste is a thing
     * the game already draws on the screen and explains to people.
     */
    static final String[] SHOVEL_NAME = {
            "Rusted Spade", "Iron Spade", "Steel Spade", "Gilded Spade",
            "Diamond Spade", "Obsidian Spade", "Starforged Spade"
    };

    static final Material[] SHOVEL_ITEM = {
            Material.WOODEN_SHOVEL, Material.STONE_SHOVEL, Material.IRON_SHOVEL,
            Material.GOLDEN_SHOVEL, Material.DIAMOND_SHOVEL, Material.NETHERITE_SHOVEL,
            Material.NETHERITE_SHOVEL
    };

    static final double[] SHOVEL_COST = {0, 600, 2_000, 6_000, 18_000, 50_000, 140_000};

    /** How much more each find is worth with a better shovel. */
    static final double[] SHOVEL_WORTH = {1.0, 1.25, 1.6, 2.1, 2.8, 3.8, 5.2};

    private final Nexus nexus;
    private final Random random = new Random();

    private World world;

    /** What each digger is carrying, and the bar that shows it. */
    private final Map<UUID, BossBar> bars = new HashMap<>();

    public DigSite(Nexus nexus) {
        this.nexus = nexus;
    }

    /* ---------------------------------------------------------------- world */

    public World world() {
        if (world == null) {
            world = nexus.worlds().of(Worlds.Place.DIGSITE);
            /*
             * The bedrock under the field says whether this has been laid.
             *
             * It used to test a block in the generated camp - which is no
             * longer built, so the test was always true and the field would
             * have been laid again on every call, wiping anything standing on
             * it. The bedrock is written only here and cannot be dug, which
             * makes it the one block that always means what it says.
             */
            if (world.getBlockAt(0, FLOOR - 1, 0).getType() != Material.BEDROCK) build();
        }
        return world;
    }

    /**
     * Where arriving puts you.
     *
     * On the field's own north edge until somebody says otherwise, because the
     * field is solid ground and standing on it cannot drop anybody into the
     * void - which the generated platform managed to do.
     */
    public Location spawn() {
        Location chosen = nexus.settings().spotAt("digsite.spawn", world());
        if (chosen != null) return chosen;

        return new Location(world(), 0.5, SURFACE + 1, -REACH + 0.5, 0f, 0f);
    }

    /**
     * The camp and the ground under it.
     *
     * Built once. The field is refilled as it is dug out rather than rebuilt,
     * so somebody standing in a hole is never buried by the world being laid
     * down around them.
     */
    /**
     * Only the ground. The camp is built by hand.
     *
     * There was a generated platform here and it was a grey rectangle that did
     * not reach the field. A dig site's camp is the part anybody would want to
     * make look like something, and there is no version of it worth generating
     * when the person running the server would rather build it.
     *
     * Nothing above the field is written, so a camp built here is never
     * flattened by the world laying itself out again.
     */
    private void build() {
        fillField();
    }

    /**
     * The two people at the camp.
     *
     * Placed on arrival rather than once when the world is made, because a
     * greeter is not saved with the world - it is built from nothing each time
     * the server starts, the same way the lobby's are. Clearing first means
     * arriving twice does not leave two of each standing in the same spot.
     */
    public void placeNpcs() {
        World here = world();
        Npc.clear(here);

        /*
         * Both in one chunk, on purpose.
         *
         * A greeter is not saved with the world - it is rebuilt each start,
         * the way the lobby's are - which also means it is thrown away when
         * its chunk unloads. These two sat at x -4 and x 3, which is two
         * different chunks, so one of them could quietly vanish while the
         * other stayed: exactly what happened, and it was always the same one.
         */
        Location where = spawn();

        Npc.place(here, spotOr("digsite.buyer", where.clone().add(-2, 0, 2)),
                "Buyer", "sell your pack here",
                Npc.OPENS + "dig_buyer",
                org.bukkit.Color.fromRGB(0x2E7D32), Material.EMERALD_BLOCK,
                Material.GOLD_INGOT);

        Npc.place(here, spotOr("digsite.gear", where.clone().add(2, 0, 2)),
                "Quartermaster", "packs, shovels, detectors, museum",
                Npc.OPENS + "dig_gear",
                org.bukkit.Color.fromRGB(0x6D4C41), Material.CHEST,
                Material.IRON_SHOVEL);
    }

    /** A remembered spot, or one beside the arrival point until there is one. */
    private Location spotOr(String key, Location fallback) {
        Location chosen = nexus.settings().spotAt(key, world());
        return chosen != null ? chosen : fallback;
    }

    /** Puts one of the two where somebody is standing. */
    public void setSpot(Player player, String which) {
        String key = which.equalsIgnoreCase("buyer") ? "digsite.buyer"
                : which.equalsIgnoreCase("gear") ? "digsite.gear"
                : which.equalsIgnoreCase("spawn") ? "digsite.spawn" : null;

        if (key == null) {
            player.sendMessage(Text.bad("/nexus digspot <spawn|buyer|gear>"));
            return;
        }

        if (!player.getWorld().equals(world())) {
            player.sendMessage(Text.bad("Stand at the dig site first."));
            return;
        }

        nexus.settings().setSpot(key, player.getLocation());
        placeNpcs();

        player.sendMessage(Text.good(which + " is here now."));
    }

    /**
     * Puts them back if the world has thrown them away.
     *
     * Cheaper than it looks and worth it: the alternative is a camp with one
     * greeter at it and no way to tell whether that is the design. Only ever
     * does anything when somebody is actually standing there.
     */
    public void tick() {
        if (world == null || world.getPlayers().isEmpty()) return;

        int standing = 0;
        for (var entity : world.getEntities()) {
            if (entity.getScoreboardTags().contains(Npc.TAG)) standing++;
        }

        if (standing < 2) placeNpcs();
    }

    public static final Component TITLE = Component.text("Quartermaster");

    /** Where each thing sits in the window. */
    private static final int SELL_SLOT = 11;
    private static final int PACK_SLOT = 13;
    private static final int SHOVEL_SLOT = 15;
    private static final int DETECTOR_SLOT = 21;
    private static final int MUSEUM_SLOT = 22;
    private static final int PRESTIGE_SLOT = 23;

    /**
     * A window, because chat you have to open chat to click is not a shop.
     *
     * The first version wrote clickable lines instead, on the grounds that two
     * items is a thin inventory. That was the wrong thing to weigh: a chat
     * link only responds while the chat window is open, so somebody standing
     * at the counter reading "click to buy" clicks it and nothing happens.
     */
    public void openGear(Player player) {
        Stats.Record record = nexus.stats().of(player.getUniqueId());

        Inventory window = nexus.getServer().createInventory(null, 27, TITLE);

        // Selling lives here too, so the counter does everything even when the
        // buyer is not standing at it.
        ItemStack sell = new ItemStack(Material.GOLD_INGOT);
        sell.editMeta(meta -> {
            meta.displayName(Text.item("Sell your pack", NamedTextColor.GOLD));
            meta.lore(java.util.List.of(
                    Text.item(record.carrying + " of " + packSize(record) + " carried",
                            NamedTextColor.DARK_GRAY),
                    Text.item("Worth " + Stats.cash(record.dugValue), NamedTextColor.GRAY),
                    Text.item("You have " + Stats.cash(record.money), NamedTextColor.GOLD)));
        });
        window.setItem(SELL_SLOT, sell);

        /*
         * The detector, which is the only thing here that changes how the game
         * is played rather than how fast. Everything else is a bigger number.
         */
        int nextDetector = record.detectorLevel + 1;
        boolean moreDetector = nextDetector < DETECTOR_COST.length;

        ItemStack detector = new ItemStack(
                record.detectorLevel > 0 ? Material.CLOCK : Material.COMPASS);
        detector.editMeta(meta -> {
            meta.displayName(Text.item(moreDetector
                    ? DETECTOR_NAME[nextDetector]
                    : "Best detector there is", NamedTextColor.AQUA));

            meta.lore(java.util.List.of(
                    Text.item(record.detectorLevel > 0
                            ? "Yours: " + DETECTOR_NAME[record.detectorLevel]
                                    + ", hears " + DETECTOR_RANGE[record.detectorLevel] + "m"
                            : "You have no detector", NamedTextColor.DARK_GRAY),
                    Text.item(moreDetector
                            ? "Sweeps " + DETECTOR_RANGE[nextDetector] + "m for "
                                    + Stats.cash(DETECTOR_COST[nextDetector])
                            : "Nothing better exists", NamedTextColor.GRAY),
                    Text.item("1: sweeps the ground   2: tells you the depth",
                            NamedTextColor.DARK_GRAY),
                    Text.item("3: names what is down there before you dig",
                            NamedTextColor.DARK_GRAY),
                    Text.item("Finds buried caches. There are "
                            + caches.size() + " out there.", NamedTextColor.DARK_GRAY)));
        });
        window.setItem(DETECTOR_SLOT, detector);

        ItemStack museum = new ItemStack(Material.ITEM_FRAME);
        museum.editMeta(meta -> {
            meta.displayName(Text.item("The Museum", NamedTextColor.LIGHT_PURPLE));
            meta.lore(java.util.List.of(
                    Text.item(record.donated.size() + " of " + RELICS.length + " donated",
                            NamedTextColor.DARK_GRAY),
                    Text.item("Give a relic instead of selling it", NamedTextColor.GRAY),
                    Text.item("Each one is a permanent bonus", NamedTextColor.GRAY)));
        });
        window.setItem(MUSEUM_SLOT, museum);

        ItemStack prestige = new ItemStack(Material.NETHER_STAR);
        prestige.editMeta(meta -> {
            meta.displayName(Text.item("Start Over", NamedTextColor.GOLD));
            meta.lore(java.util.List.of(
                    Text.item("Prestige " + record.digPrestige + " - everything worth "
                            + String.format("%.2f", prestigeBonus(record)) + "x",
                            NamedTextColor.DARK_GRAY),
                    Text.item("Give up your pack and shovel", NamedTextColor.GRAY),
                    Text.item("Keep the money, gain a quarter more forever",
                            NamedTextColor.GRAY),
                    Text.item("Costs " + Stats.cash(prestigeCost(record)), NamedTextColor.GOLD)));
        });
        window.setItem(PRESTIGE_SLOT, prestige);

        int nextPack = record.packLevel + 1;
        boolean morePack = nextPack < PACK_SIZE.length;

        ItemStack pack = new ItemStack(morePack ? Material.CHEST : Material.ENDER_CHEST);
        pack.editMeta(meta -> {
            meta.displayName(Text.item(morePack ? "Pack of " + PACK_SIZE[nextPack]
                    : "The biggest pack there is", NamedTextColor.AQUA));

            meta.lore(morePack
                    ? java.util.List.of(
                            Text.item("Holds " + PACK_SIZE[nextPack] + ", up from "
                                    + packSize(record), NamedTextColor.DARK_GRAY),
                            Text.item(Stats.cash(PACK_COST[nextPack]), NamedTextColor.GRAY),
                            Text.item("Click to buy", NamedTextColor.GREEN))
                    : java.util.List.of(Text.item("Nothing left to buy", NamedTextColor.DARK_GRAY)));
        });
        window.setItem(PACK_SLOT, pack);

        int nextShovel = record.shovelLevel + 1;
        boolean moreShovel = nextShovel < SHOVEL_NAME.length;

        ItemStack shovel = new ItemStack(moreShovel
                ? SHOVEL_ITEM[nextShovel] : SHOVEL_ITEM[SHOVEL_ITEM.length - 1]);

        shovel.editMeta(meta -> {
            meta.displayName(Text.item(moreShovel ? SHOVEL_NAME[nextShovel]
                    : "There is no finer shovel", NamedTextColor.AQUA));

            meta.lore(moreShovel
                    ? java.util.List.of(
                            Text.item("Digs faster", NamedTextColor.DARK_GRAY),
                            Text.item("Finds worth " + SHOVEL_WORTH[nextShovel] + "x",
                                    NamedTextColor.DARK_GRAY),
                            Text.item(Stats.cash(SHOVEL_COST[nextShovel]), NamedTextColor.GRAY),
                            Text.item("Click to buy", NamedTextColor.GREEN))
                    : java.util.List.of(Text.item("Nothing left to buy", NamedTextColor.DARK_GRAY)));
        });
        window.setItem(SHOVEL_SLOT, shovel);

        player.openInventory(window);
    }

    /** A click in that window. */
    public void clicked(Player player, int slot) {
        switch (slot) {
            case SELL_SLOT -> sell(player);
            case DETECTOR_SLOT -> buyDetector(player);
            case MUSEUM_SLOT -> openMuseum(player);
            case PRESTIGE_SLOT -> prestige(player);
            case PACK_SLOT -> buyPack(player);
            case SHOVEL_SLOT -> buyShovel(player);
            default -> {
                return;
            }
        }

        // Reopened so the prices and the pack count are what they are now.
        openGear(player);
    }

    /**
     * Lays the camp and the field out again.
     *
     * Needed once, because the first version of this left the two unconnected
     * with a hole between them - and a world already built does not build
     * itself a second time.
     */
    /**
     * Lays the ground out again, and clears what used to stand beside it.
     *
     * The clearing reaches past the field to take out the old generated camp,
     * which is otherwise left floating next to a dig site that no longer has
     * anything to do with it. Anything built above the field goes too - which
     * is what "rebuild" has to mean, and why it is a command rather than
     * something that happens on its own.
     */
    public void rebuild() {
        World here = world();

        int reach = REACH + 24;

        for (int x = -reach; x <= reach; x++) {
            for (int z = -reach; z <= reach; z++) {
                for (int y = FLOOR - 2; y <= SURFACE + 24; y++) {
                    Block block = here.getBlockAt(x, y, z);
                    if (block.getType() != Material.AIR) block.setType(Material.AIR, false);
                }
            }
        }

        build();
        placeNpcs();
    }

    /** Placed at startup so the camp is never empty when somebody arrives. */
    public void warmUp() {
        placeNpcs();
        nexus.getLogger().info("the dig site is open");
    }

    /**
     * Whether this is something the field was laid with.
     *
     * Taken from the same list {@link #groundAt} lays down, so a layer added
     * there is diggable without anybody remembering to add it here too.
     */
    private static boolean isGround(Material material) {
        return material == Material.DIRT
                || material == Material.COARSE_DIRT
                || material == Material.CLAY
                || material == Material.GRAVEL
                || material == Material.STONE
                || material == Material.DEEPSLATE;
    }

    /** The ground, in layers, with the good things deepest. */
    private void fillField() {
        for (int x = -REACH; x <= REACH; x++) {
            for (int z = -REACH; z <= REACH; z++) {
                world.getBlockAt(x, FLOOR - 1, z).setType(Material.BEDROCK, false);

                // Up to and including the camp's own height, so stepping
                // from one to the other is a step rather than a drop.
                for (int y = FLOOR; y <= SURFACE; y++) {
                    world.getBlockAt(x, y, z).setType(groundAt(y), false);
                }
            }
        }
    }

    /**
     * What the ground is made of at a given depth.
     *
     * Named layers rather than a gradient, because a digger should be able to
     * tell how deep they are by looking at the wall beside them.
     */
    private Material groundAt(int y) {
        int depth = SURFACE - y;

        if (depth < 8) return Material.DIRT;
        if (depth < 18) return Material.COARSE_DIRT;
        if (depth < 28) return Material.CLAY;
        if (depth < 40) return Material.GRAVEL;
        if (depth < 50) return Material.STONE;

        return Material.DEEPSLATE;
    }

    /* ----------------------------------------------------------- the finds */

    /** One thing pulled out of the ground. */
    private record Find(String name, double worth, NamedTextColor colour) { }

    /**
     * What a swing at this depth turns up.
     *
     * Weighted so that the deep layers are worth going to rather than merely
     * slower to reach: the commonest find at the bottom is worth more than the
     * rarest at the top, which is what makes a pack upgrade feel like a door
     * rather than a bigger bucket.
     */
    private Find findAt(int y, int shovel, double bonus) {
        int depth = SURFACE - y;
        int roll = random.nextInt(1000);

        // The rare things, which get likelier with depth rather than only
        // better - a deep dig that turns up nothing is a story, not a game.
        // The museum's bonus rides on top, which is what it is paid for.
        int luck = (int) Math.round((depth / 2 + shovel * 6) * bonus);

        if (roll < luck / 3) return new Find("Ancient Relic", 900, NamedTextColor.LIGHT_PURPLE);
        if (roll < luck) return new Find("Gemstone", 260, NamedTextColor.AQUA);
        if (roll < luck * 3) return new Find("Old Coin", 90, NamedTextColor.GOLD);

        if (depth >= 50) return new Find("Deepslate Shard", 34, NamedTextColor.DARK_GRAY);
        if (depth >= 40) return new Find("Stone Chunk", 20, NamedTextColor.GRAY);
        if (depth >= 28) return new Find("Gravel", 12, NamedTextColor.GRAY);
        if (depth >= 18) return new Find("Clay Lump", 8, NamedTextColor.WHITE);
        if (depth >= 8) return new Find("Packed Soil", 4, NamedTextColor.DARK_GRAY);

        return new Find("Topsoil", 2, NamedTextColor.DARK_GREEN);
    }

    /* ---------------------------------------------------------- the digging */

    /** The pack, with whatever the museum has given back on top. */
    public int packSize(Stats.Record record) {
        return (int) Math.round(
                PACK_SIZE[Math.max(0, Math.min(PACK_SIZE.length - 1, record.packLevel))]
                        * museumBonus(record));
    }

    /** What the dig site wants done about a block somebody broke. */
    public enum Dig {
        /** Counted into the pack. Break it, but it must not drop anything. */
        COUNTED,
        /** Not theirs to break. */
        REFUSED,
        /** Nothing to do with the dig - let the server handle it normally. */
        IGNORED
    }

    /**
     * A block dug in the field.
     *
     * Three answers rather than two, because "let it break" and "count it" are
     * not the same thing and used to be. The pack is a number, so a counted dig
     * must not also drop a real block - when it did, every dig put dirt in the
     * player's inventory that selling never touched, because selling empties a
     * counter and knows nothing about items. A player who dug all day ended up
     * carrying the soil as well as the number.
     *
     * A builder is the case that keeps this from being a boolean: their breaks
     * are none of the dig site's business and should drop as normal.
     */
    public Dig dug(Player player, Block block) {
        if (!block.getWorld().equals(world())) return Dig.IGNORED;

        // The camp is not the field, and nor is the bedrock under it.
        if (Math.abs(block.getX()) > REACH || Math.abs(block.getZ()) > REACH
                || block.getY() < FLOOR || block.getY() > SURFACE) {

            if (nexus.hub().isBuilding(player.getUniqueId())) return Dig.IGNORED;

            player.sendActionBar(Component.text("Dig in the field", NamedTextColor.RED));
            return Dig.REFUSED;
        }

        /*
         * Only the ground itself, not what anybody has put on top of it.
         *
         * The bounds above say where the field is, which is not the same as
         * what the field is made of - a roof over the pit, a ladder down the
         * side or a hut in the middle all sit inside those bounds and were all
         * diggable. Checking the material means a build inside the dig is as
         * safe as one beside it, and it needs no list of protected blocks
         * kept up to date by hand.
         */
        if (!isGround(block.getType())) {
            if (nexus.hub().isBuilding(player.getUniqueId())) return Dig.IGNORED;

            player.sendActionBar(Component.text("That is not the ground",
                    NamedTextColor.RED));
            return Dig.REFUSED;
        }

        Stats.Record record = nexus.stats().of(player.getUniqueId());
        int room = packSize(record);

        if (record.carrying >= room) {
            player.sendActionBar(Component.text("Your pack is full - go and sell",
                    NamedTextColor.RED));
            return Dig.REFUSED;
        }

        Find find = findAt(block.getY(), record.shovelLevel, museumBonus(record));

        record.carrying++;
        record.dugValue += find.worth() * SHOVEL_WORTH[
                Math.max(0, Math.min(SHOVEL_WORTH.length - 1, record.shovelLevel))]
                * prestigeBonus(record);
        record.blocksDug++;

        // A cache pays on top of whatever the block itself was worth.
        tookCache(player, block, record);

        /*
         * Only the good ones are announced.
         *
         * A message for every clod of soil is a wall of text nobody reads, and
         * it would drown the one line that matters when a relic turns up.
         */
        if (find.worth() >= 90) {
            player.sendMessage(Component.text("  " + find.name(), find.colour())
                    .append(Component.text("  worth " + Stats.cash(find.worth()),
                            NamedTextColor.DARK_GRAY)));
            player.playSound(player, Sound.ENTITY_EXPERIENCE_ORB_PICKUP, 0.8f, 1.6f);
        }

        showBar(player);
        return Dig.COUNTED;
    }

    /* ---------------------------------------------------------- the buyer */

    public void sell(Player player) {
        Stats.Record record = nexus.stats().of(player.getUniqueId());

        if (record.carrying <= 0) {
            player.sendMessage(Text.bad("Your pack is empty."));
            return;
        }

        double paid = record.dugValue;
        int carried = record.carrying;

        record.carrying = 0;
        record.dugValue = 0;

        /*
         * What actually landed, not what was asked for.
         *
         * `pay` applies the server multiplier and any personal bonus on top, so
         * during a double money event the pack was worth one number and the
         * player received another - and the message reported the smaller one.
         */
        double before = record.money;
        nexus.stats().pay(player.getUniqueId(), paid);
        double gained = record.money - before;

        player.sendMessage(Text.good("Sold " + carried + " finds for " + Stats.cash(gained) + "."));

        if (gained > paid + 0.01) {
            player.sendMessage(Text.plain("  " + Stats.cash(paid) + " of finds, paid out at "
                    + String.format("%.1f", gained / paid) + "x."));
        }

        player.sendMessage(Text.plain("  You now have " + Stats.cash(record.money) + "."));
        player.playSound(player, Sound.ENTITY_VILLAGER_YES, 0.9f, 1.1f);

        showBar(player);
        nexus.stats().save();
    }

    /* --------------------------------------------------------- the upgrades */

    public void buyPack(Player player) {
        Stats.Record record = nexus.stats().of(player.getUniqueId());
        int next = record.packLevel + 1;

        if (next >= PACK_SIZE.length) {
            player.sendMessage(Text.says("That is the biggest pack there is."));
            return;
        }

        double cost = PACK_COST[next];
        if (!nexus.stats().charge(player.getUniqueId(), cost)) {
            player.sendMessage(Text.bad("A bigger pack costs " + Stats.cash(cost)
                    + " and you have " + Stats.cash(record.money) + "."));
            return;
        }

        record.packLevel = next;

        player.sendMessage(Text.good("Your pack holds " + PACK_SIZE[next] + " now."));
        player.playSound(player, Sound.ENTITY_PLAYER_LEVELUP, 0.8f, 1.2f);

        showBar(player);
        nexus.stats().save();
    }

    public void buyShovel(Player player) {
        Stats.Record record = nexus.stats().of(player.getUniqueId());
        int next = record.shovelLevel + 1;

        if (next >= SHOVEL_NAME.length) {
            player.sendMessage(Text.says("There is no finer shovel."));
            return;
        }

        double cost = SHOVEL_COST[next];
        if (!nexus.stats().charge(player.getUniqueId(), cost)) {
            player.sendMessage(Text.bad("That shovel costs " + Stats.cash(cost)
                    + " and you have " + Stats.cash(record.money) + "."));
            return;
        }

        record.shovelLevel = next;

        player.sendMessage(Text.good("A " + SHOVEL_NAME[next] + "."));
        player.sendMessage(Text.plain("  Digs faster, and finds are worth "
                + SHOVEL_WORTH[next] + " times as much."));

        equip(player);
        nexus.stats().save();
    }

    /* ------------------------------------------------------------ arriving */

    public void arrive(Player player) {
        world();
        placeNpcs();

        player.sendMessage(Text.heading("The Dig Site"));
        player.sendMessage(Text.plain("  Dig, fill your pack, sell it, buy a bigger one."));
        player.sendMessage(Text.plain("  /dig sell    /dig pack    /dig shovel"));
        player.sendMessage(Text.plain("  /dig camp to climb out when you are done."));

        equip(player);
        showBar(player);
    }

    /**
     * The shovel they have paid for, and the haste that comes with it.
     *
     * Given rather than kept, so a shovel cannot be lost, sold or left in a
     * chest - the upgrade is a number on their record and this is only how it
     * is shown.
     */
    public void equip(Player player) {
        Stats.Record record = nexus.stats().of(player.getUniqueId());
        int level = Math.max(0, Math.min(SHOVEL_NAME.length - 1, record.shovelLevel));

        player.getInventory().clear();

        ItemStack shovel = new ItemStack(SHOVEL_ITEM[level]);
        shovel.editMeta(meta -> {
            meta.displayName(Text.item(SHOVEL_NAME[level], NamedTextColor.AQUA));
            meta.setUnbreakable(true);
        });

        player.getInventory().setItem(0, shovel);
        player.getInventory().setHeldItemSlot(0);

        if (record.detectorLevel > 0) {
            int owned = Math.min(record.detectorLevel, DETECTOR_NAME.length - 1);

            ItemStack detector = new ItemStack(DETECTOR_ITEM);
            detector.editMeta(meta -> {
                meta.displayName(Text.item(DETECTOR_NAME[owned], NamedTextColor.AQUA));
                meta.lore(java.util.List.of(
                        Text.item("Hold it to sweep for buried caches", NamedTextColor.GRAY),
                        Text.item("Hears " + DETECTOR_RANGE[owned] + " metres",
                                NamedTextColor.DARK_GRAY)));
            });

            player.getInventory().setItem(1, detector);
        }

        if (level > 0) {
            player.addPotionEffect(new PotionEffect(
                    PotionEffectType.HASTE, Integer.MAX_VALUE, level - 1, false, false));
        }
    }

    /* ----------------------------------------------------------------- bar */

    public void showBar(Player player) {
        Stats.Record record = nexus.stats().of(player.getUniqueId());

        int room = packSize(record);
        float full = room == 0 ? 0f : Math.min(1f, (float) record.carrying / room);

        BossBar bar = bars.computeIfAbsent(player.getUniqueId(), id ->
                BossBar.bossBar(Component.empty(), 0f, BossBar.Color.YELLOW,
                        BossBar.Overlay.PROGRESS));

        /*
         * The balance belongs here too.
         *
         * The bar said what the pack was worth but never what any of it had
         * added up to, so the one number the whole loop is played for was the
         * one number never on screen. It is the last thing on the line because
         * it changes least often.
         */
        bar.name(Component.text("Pack  " + record.carrying + " / " + room,
                        record.carrying >= room ? NamedTextColor.RED : NamedTextColor.WHITE)
                .append(Component.text("   worth " + Stats.cash(record.dugValue),
                        NamedTextColor.GRAY))
                .append(Component.text("   you have " + Stats.cash(record.money),
                        NamedTextColor.GOLD)));

        bar.progress(full);
        bar.color(record.carrying >= room ? BossBar.Color.RED : BossBar.Color.YELLOW);

        player.showBossBar(bar);
    }

    public void hideBar(Player player) {
        BossBar bar = bars.remove(player.getUniqueId());
        if (bar != null) player.hideBossBar(bar);

        player.hideBossBar(clock);
    }

    /* ------------------------------------------------------- buried things */

    /**
     * Caches: the reason to dig here rather than there.
     *
     * Every block used to roll its own dice, which meant no spot was ever
     * better than any other and digging was holding the mouse down in a
     * direction. A cache is a real thing at a real place, so with something to
     * point at it the game becomes hunting rather than grinding.
     *
     * They live in memory and are laid again on every reset - the ground
     * closing up and the treasure moving are the same event, which is what
     * makes coming back worth it.
     */
    private record Cache(int x, int y, int z, String name, double worth, NamedTextColor colour) { }

    /**
     * How many are buried at a time.
     *
     * Sixteen across an eighty-one by eighty-one field is one per four hundred
     * columns, which is not treasure hunting - it is a lottery. Forty puts one
     * within a sweep of wherever somebody is standing, which is what makes the
     * detector worth carrying.
     */
    private static final int CACHE_COUNT = 40;

    /**
     * Dig within this many blocks of the middle and it is yours.
     *
     * Two, not one. A shaft dug straight down from a spot the detector called
     * hot is a one-block column, and needing to be within a single block of the
     * centre meant being told treasure was here and finding nothing.
     */
    private static final int CACHE_REACH = 2;

    /**
     * The detector is held, not owned quietly in the background.
     *
     * It began as a passive thing that simply worked once bought, which meant
     * buying one handed over nothing at all - and worse, its meter wrote to the
     * action bar twice a second, which is the same line "your pack is full" and
     * "that is not the ground" appear on. Those messages flashed and were gone
     * before anybody could read them. Holding it makes it an object, and leaves
     * the action bar alone the rest of the time.
     */
    private static final Material DETECTOR_ITEM = Material.RECOVERY_COMPASS;

    /**
     * How far across the ground a detector hears, by level.
     *
     * Across, not through. Measuring the straight-line distance meant a cache
     * forty blocks down was silent to somebody standing on top of it, so the
     * detector was useless from the surface - which is the only place anybody
     * starts. Sweeping horizontally finds the spot; the depth is then just how
     * far to dig.
     */
    private static final int[] DETECTOR_RANGE = { 0, 32, 56, 80 };
    private static final int[] DETECTOR_COST = { 0, 4_000, 18_000, 70_000 };
    private static final String[] DETECTOR_NAME = {
            "none", "Copper Detector", "Iron Detector", "Gilded Detector"
    };

    private final java.util.List<Cache> caches = new java.util.ArrayList<>();

    private final Map<UUID, Integer> pings = new HashMap<>();

    private void seedCaches() {
        caches.clear();

        for (int i = 0; i < CACHE_COUNT; i++) {
            int x = random.nextInt(REACH * 2 + 1) - REACH;
            int z = random.nextInt(REACH * 2 + 1) - REACH;

            /*
             * Never in the top few metres.
             *
             * A cache somebody falls over on the surface is not a find, and
             * one on the bedrock is a chore - so they sit in the part of the
             * field that has to be dug for.
             */
            int y = FLOOR + 2 + random.nextInt(SURFACE - FLOOR - 8);

            int roll = random.nextInt(100);

            if (roll < 8) {
                caches.add(new Cache(x, y, z, "Buried Hoard", 4200, NamedTextColor.LIGHT_PURPLE));
            } else if (roll < 32) {
                caches.add(new Cache(x, y, z, "Strongbox", 1600, NamedTextColor.AQUA));
            } else {
                caches.add(new Cache(x, y, z, "Old Satchel", 600, NamedTextColor.GOLD));
            }
        }
    }

    /** How far across the ground, ignoring depth entirely. */
    private double acrossTo(Cache cache, Location at) {
        double dx = cache.x() - at.getX();
        double dz = cache.z() - at.getZ();
        return Math.sqrt(dx * dx + dz * dz);
    }

    /** The nearest cache across the ground, or null when none is in range. */
    private Cache nearest(Location at, int range) {
        Cache best = null;
        double closest = Double.MAX_VALUE;

        for (Cache cache : caches) {
            double across = acrossTo(cache, at);

            if (across < closest && across <= range) {
                closest = across;
                best = cache;
            }
        }

        return best;
    }

    /**
     * Whether that block was a cache, paying out if it was.
     *
     * Checked with a small reach rather than an exact match, because hitting
     * one block in four hundred thousand is not a game.
     */
    private boolean tookCache(Player player, Block block, Stats.Record record) {
        for (int i = 0; i < caches.size(); i++) {
            Cache cache = caches.get(i);

            if (Math.abs(block.getX() - cache.x()) > CACHE_REACH) continue;
            if (Math.abs(block.getY() - cache.y()) > CACHE_REACH) continue;
            if (Math.abs(block.getZ() - cache.z()) > CACHE_REACH) continue;

            caches.remove(i);

            double worth = cache.worth() * prestigeBonus(record);
            record.dugValue += worth;

            player.sendMessage(Component.empty());
            player.sendMessage(Component.text("  " + cache.name(), cache.colour())
                    .append(Component.text("  worth " + Stats.cash(worth),
                            NamedTextColor.DARK_GRAY)));
            player.sendMessage(Component.empty());

            player.playSound(player, Sound.ENTITY_PLAYER_LEVELUP, 1f, 1.2f);
            player.playSound(player, Sound.BLOCK_AMETHYST_BLOCK_CHIME, 1f, 0.8f);

            /*
             * The whole server, not just whoever else is in the pit.
             *
             * A hoard is one of the few things on here worth interrupting
             * somebody for, and telling only the two people who happened to be
             * standing nearby is what made the server feel empty.
             */
            nexus.feed().say(player,
                    cache.worth() >= 4000 ? Feed.Weight.BIG : Feed.Weight.NOTE,
                    "dug up a " + cache.name() + " worth " + Stats.cash(worth) + ".");

            return true;
        }

        return false;
    }

    /**
     * The detector, twice a second.
     *
     * Distance on its own is a number nobody reads while digging, so it is a
     * meter and a ping that quickens - the same shape as every detector in
     * every game that has one, because it works without being explained.
     */
    public void detectorTick() {
        if (world == null) return;

        for (Player player : world.getPlayers()) {
            Stats.Record record = nexus.stats().of(player.getUniqueId());
            if (record.detectorLevel <= 0) continue;

            // Only while it is actually in hand, so the action bar is free for
            // the messages that explain why a dig was refused.
            if (player.getInventory().getItemInMainHand().getType() != DETECTOR_ITEM) continue;

            int level = Math.min(record.detectorLevel, DETECTOR_RANGE.length - 1);
            int range = DETECTOR_RANGE[level];

            Cache found = nearest(player.getLocation(), range);

            if (found == null) {
                player.sendActionBar(Component.text("[..........]  nothing in range",
                        NamedTextColor.DARK_GRAY));
                continue;
            }

            double across = acrossTo(found, player.getLocation());
            double down = player.getLocation().getY() - found.y();

            double heat = 1.0 - Math.min(1.0, across / range);
            int bars = (int) Math.round(heat * 10);

            NamedTextColor colour = heat > 0.8 ? NamedTextColor.RED
                    : heat > 0.5 ? NamedTextColor.GOLD
                    : heat > 0.25 ? NamedTextColor.YELLOW
                    : NamedTextColor.GRAY;

            String meter = "[" + "|".repeat(Math.max(0, bars))
                    + ".".repeat(Math.max(0, 10 - bars)) + "]";

            /*
             * Standing over it is the moment worth calling out.
             *
             * Within two blocks across is the same tolerance the cache itself
             * has, so "right here" means digging straight down will hit it.
             */
            /*
             * What each detector tells you, which is the real upgrade.
             *
             * Range alone was not one: the first detector already sweeps half
             * the caches on the field, so a bigger radius bought nothing and
             * the two dearer ones were money for no difference. What they buy
             * instead is knowing - how far down before you commit to the shaft,
             * and what is down there before you commit at all.
             */
            Component reading;

            if (across <= CACHE_REACH) {
                reading = Component.text("  RIGHT HERE", NamedTextColor.RED);

                reading = reading.append(level >= 2
                        ? Component.text("  dig " + Math.max(0, Math.round(down)) + "m down",
                                NamedTextColor.GOLD)
                        : Component.text("  dig down", NamedTextColor.GOLD));
            } else {
                reading = Component.text("   " + Math.round(across) + "m across",
                        NamedTextColor.GRAY);
            }

            if (level >= 3) {
                reading = reading.append(Component.text("  " + found.name(), found.colour()));
            }

            player.sendActionBar(Component.text(meter, colour).append(reading));

            /*
             * The ping, at a rate the distance sets.
             *
             * Sounded every tick it is a drone; gated on the heat it speeds up
             * as somebody closes in, which is the entire signal.
             */
            int count = pings.merge(player.getUniqueId(), 1, Integer::sum);
            int every = Math.max(1, (int) Math.round(6 - heat * 5));

            if (count % every == 0) {
                player.playSound(player, Sound.BLOCK_NOTE_BLOCK_HAT, 0.7f,
                        (float) (0.8 + heat * 1.2));
            }
        }
    }

    /** What prestige is worth, as a multiplier on everything dug. */
    public double prestigeBonus(Stats.Record record) {
        return 1.0 + record.digPrestige * 0.25;
    }

    /* ----------------------------------------------------- what money buys */

    public void buyDetector(Player player) {
        Stats.Record record = nexus.stats().of(player.getUniqueId());
        int next = record.detectorLevel + 1;

        if (next >= DETECTOR_COST.length) {
            player.sendMessage(Text.says("That is the best detector there is."));
            return;
        }

        if (!nexus.stats().charge(player.getUniqueId(), DETECTOR_COST[next])) {
            player.sendMessage(Text.bad("That costs " + Stats.cash(DETECTOR_COST[next]) + "."));
            return;
        }

        record.detectorLevel = next;

        player.sendMessage(Text.good("Bought a " + DETECTOR_NAME[next] + "."));
        player.sendMessage(Text.plain("  It is in your second slot. Hold it and sweep -"));
        player.sendMessage(Text.plain("  it hears " + DETECTOR_RANGE[next] + " metres."));
        player.playSound(player, Sound.BLOCK_AMETHYST_BLOCK_CHIME, 0.9f, 1.3f);

        // Into their hands rather than only into the record.
        equip(player);

        nexus.stats().save();
    }

    /* ------------------------------------------------------------ museum */

    /**
     * The museum: a reason not to sell the good stuff.
     *
     * Rare finds were only ever money, so a relic and its worth in soil were
     * the same thing and the interesting part of the loot table may as well
     * not have existed. Donating trades money for something permanent, which
     * is the choice that makes a rare find feel rare.
     */
    private static final String[] RELICS = {
            "Old Coin", "Gemstone", "Ancient Relic",
            "Old Satchel", "Strongbox", "Buried Hoard"
    };

    /** What each donation is worth, forever. */
    private static final int[] RELIC_COST = { 2_500, 9_000, 40_000, 6_000, 25_000, 90_000 };

    public void openMuseum(Player player) {
        Stats.Record record = nexus.stats().of(player.getUniqueId());

        player.sendMessage(Text.heading("The Museum"));

        for (int i = 0; i < RELICS.length; i++) {
            boolean done = record.donated.contains(RELICS[i]);

            player.sendMessage(Component.text("  " + (done ? "[given] " : "[      ] "),
                            done ? NamedTextColor.GREEN : NamedTextColor.DARK_GRAY)
                    .append(Component.text(RELICS[i],
                            done ? NamedTextColor.WHITE : NamedTextColor.GRAY))
                    .append(Component.text(done ? "" : "   " + Stats.cash(RELIC_COST[i]),
                            NamedTextColor.DARK_GRAY)));
        }

        player.sendMessage(Component.empty());
        player.sendMessage(Text.plain("  /dig give <name>   hand one over"));
        player.sendMessage(Text.plain("  Each one is +10% pack and +10% luck, forever."));
        player.sendMessage(Text.plain("  Donated: " + record.donated.size()
                + " of " + RELICS.length));
    }

    /** Donating by name, because a relic is a number here and not an item. */
    public void donate(Player player, String what) {
        Stats.Record record = nexus.stats().of(player.getUniqueId());

        for (int i = 0; i < RELICS.length; i++) {
            if (!RELICS[i].equalsIgnoreCase(what)) continue;

            if (record.donated.contains(RELICS[i])) {
                player.sendMessage(Text.says("The museum already has one of those."));
                return;
            }

            if (!nexus.stats().charge(player.getUniqueId(), RELIC_COST[i])) {
                player.sendMessage(Text.bad("That donation costs "
                        + Stats.cash(RELIC_COST[i]) + "."));
                return;
            }

            record.donated.add(RELICS[i]);

            player.sendMessage(Text.good("The museum thanks you for the " + RELICS[i] + "."));
            player.sendMessage(Text.plain("  Pack and luck up. " + record.donated.size()
                    + " of " + RELICS.length + " given."));
            player.playSound(player, Sound.ENTITY_PLAYER_LEVELUP, 0.8f, 1.4f);

            nexus.stats().save();
            return;
        }

        player.sendMessage(Text.bad("The museum does not want a \"" + what + "\"."));
        openMuseum(player);
    }

    /** What the museum has given back, as a multiplier. */
    public double museumBonus(Stats.Record record) {
        return 1.0 + record.donated.size() * 0.10;
    }

    /* ---------------------------------------------------------- prestige */

    public double prestigeCost(Stats.Record record) {
        return 50_000 * Math.pow(2, record.digPrestige);
    }

    /**
     * Giving up the tools for a permanent quarter more.
     *
     * Deliberately a bad trade in the short run - a fresh pack and a wooden
     * shovel after hours of upgrades - which is the only thing that makes it
     * a decision rather than a button everybody presses on sight.
     */
    public void prestige(Player player) {
        Stats.Record record = nexus.stats().of(player.getUniqueId());

        if (record.packLevel < 3 || record.shovelLevel < 3) {
            player.sendMessage(Text.says("Get your pack and shovel to level 3 first."));
            return;
        }

        double cost = prestigeCost(record);

        if (!nexus.stats().charge(player.getUniqueId(), cost)) {
            player.sendMessage(Text.bad("Starting over costs " + Stats.cash(cost) + "."));
            return;
        }

        record.packLevel = 0;
        record.shovelLevel = 0;
        record.carrying = 0;
        record.dugValue = 0;
        record.digPrestige++;

        player.sendMessage(Component.empty());
        player.sendMessage(Text.good("Prestige " + record.digPrestige + "."));
        player.sendMessage(Text.plain("  Everything you dig is now worth "
                + String.format("%.2f", prestigeBonus(record)) + "x, forever."));
        player.sendMessage(Component.empty());

        player.playSound(player, Sound.UI_TOAST_CHALLENGE_COMPLETE, 1f, 1f);
        nexus.feed().say(player, Feed.Weight.BIG,
                "started the dig over at prestige " + record.digPrestige + ".");

        equip(player);
        showBar(player);
        nexus.stats().save();
    }

    /* --------------------------------------------------------- the reset */

    /**
     * The field goes back to solid ground on a clock everybody can see.
     *
     * Without one it never came back at all: a hole dug was a hole forever,
     * and over a few weeks the site stops looking like a dig and starts
     * looking like a quarry that closed. A visible countdown also means the
     * refill is never a surprise - the one thing that would be unforgivable
     * is burying somebody who was halfway down without warning.
     */
    private static final int DEFAULT_MINUTES = 30;

    /** Under this many seconds the bar turns red and says so louder. */
    private static final int WARN_SECONDS = 30;

    private long resetsAt;

    private final BossBar clock = BossBar.bossBar(Component.empty(), 1f,
            BossBar.Color.BLUE, BossBar.Overlay.NOTCHED_10);

    private long every() {
        long minutes = nexus.getConfig().getLong("digsite.resetMinutes", DEFAULT_MINUTES);
        return Math.max(1L, minutes) * 60_000L;
    }

    public void startClock() {
        resetsAt = System.currentTimeMillis() + every();

        // The ground closing up and the treasure moving are one event.
        seedCaches();
    }

    /** How long is left, for anything else that wants to say so. */
    public long secondsLeft() {
        return Math.max(0L, (resetsAt - System.currentTimeMillis()) / 1000L);
    }

    /**
     * Once a second: the countdown, and the refill when it runs out.
     *
     * Separate from `tick`, which runs every five seconds and only checks the
     * greeters are still standing. A countdown showing seconds has to be read
     * every second or it visibly stutters.
     */
    public void resetTick() {
        if (world == null) return;
        if (resetsAt == 0L) startClock();

        if (System.currentTimeMillis() >= resetsAt) {
            resetField();
            startClock();
        }

        var here = world.getPlayers();
        if (here.isEmpty()) return;

        long left = secondsLeft();
        long minutes = left / 60;
        long seconds = left % 60;

        String when = minutes > 0
                ? minutes + "m " + String.format("%02d", seconds) + "s"
                : seconds + "s";

        boolean soon = left <= WARN_SECONDS;

        clock.name(Component.text(soon ? "Ground closes in " : "Ground resets in ",
                        soon ? NamedTextColor.RED : NamedTextColor.AQUA)
                .append(Component.text(when, NamedTextColor.WHITE)));

        long span = Math.max(1L, every() / 1000L);
        clock.progress(Math.max(0f, Math.min(1f, (float) left / span)));
        clock.color(soon ? BossBar.Color.RED : BossBar.Color.BLUE);

        for (Player player : here) player.showBossBar(clock);
    }

    /**
     * Puts the ground back, without putting it back over anybody.
     *
     * Only air is filled. Anything built down there - a ladder, a hut, the
     * roof over the pit - is left exactly where it is, so a reset restores the
     * dig without flattening what somebody made of it. That is the difference
     * between this and `rebuild`, which is a command precisely because it does
     * not spare any of that.
     */
    private void resetField() {
        // Out of the hole first. A player standing in the field when it fills
        // would be inside solid ground a tick later.
        for (Player player : world.getPlayers()) {
            var at = player.getLocation();

            if (Math.abs(at.getBlockX()) <= REACH && Math.abs(at.getBlockZ()) <= REACH
                    && at.getBlockY() <= SURFACE) {
                player.teleport(spawn());
                player.sendMessage(Text.says("The ground closed up - back at the camp."));
            }
        }

        /*
         * One slice of the field per tick, not all of it at once.
         *
         * The field is 81 by 81 by 61, which is 400,221 blocks. Walking that
         * in one go on the main thread stalls the whole server for seconds -
         * every player on every world, not just the diggers - so it is spread
         * over about four seconds instead and nobody feels it.
         */
        if (refilling) return;
        refilling = true;

        nexus.getServer().getScheduler().runTaskTimer(nexus, task -> {
            int done = 0;

            for (int z = -REACH; z <= REACH; z++) {
                /*
                 * A column with anything built in it is left entirely alone.
                 *
                 * Filling only air was not enough. A hut down in the pit keeps
                 * its walls that way - they are not air - but the rooms inside
                 * it are, so it would have been packed solid with dirt around
                 * somebody's furniture. Skipping the whole column instead means
                 * a build keeps its footprint and the ground grows back around
                 * it, which is the only version of this that is safe to run on
                 * a world somebody has built in.
                 */
                boolean built = false;

                for (int y = FLOOR; y <= SURFACE; y++) {
                    Material found = world.getBlockAt(slice, y, z).getType();

                    if (found != Material.AIR && !isGround(found)) {
                        built = true;
                        break;
                    }
                }

                if (built) continue;

                for (int y = FLOOR; y <= SURFACE; y++) {
                    Block block = world.getBlockAt(slice, y, z);
                    if (block.getType() != Material.AIR) continue;

                    block.setType(groundAt(y), false);
                    done++;
                }
            }

            refilled += done;
            slice++;

            if (slice > REACH) {
                task.cancel();
                refilling = false;
                slice = -REACH;

                if (refilled > 0) {
                    for (Player player : world.getPlayers()) {
                        player.sendMessage(Text.good("The dig site has been refilled."));
                        player.playSound(player, Sound.BLOCK_GRAVEL_PLACE, 0.9f, 0.7f);
                    }
                }

                nexus.getLogger().info("dig site reset: " + refilled + " blocks refilled");
                refilled = 0;
            }
        }, 1L, 1L);
    }

    /** Where the spread-out refill has got to, and whether one is running. */
    private boolean refilling;
    private int slice = -REACH;
    private int refilled;

    /**
     * Back to the surface.
     *
     * Not a convenience: the field is sixty blocks deep and digging into it
     * removes the ground you would climb, so without this the first thing
     * anybody does is bury themselves at the bottom of a hole with no way out
     * and no blocks to build with.
     */
    public void toCamp(Player player) {
        if (!player.getWorld().equals(world())) {
            player.sendMessage(Text.bad("You are not at the dig site."));
            return;
        }

        player.teleport(spawn());
        player.sendMessage(Text.says("Back at the camp."));
    }

    /* ---------------------------------------------------------------- help */

    public void help(Player player) {
        Stats.Record record = nexus.stats().of(player.getUniqueId());

        player.sendMessage(Text.heading("The Dig Site"));
        player.sendMessage(Text.plain("  Money: " + Stats.cash(record.money)));
        player.sendMessage(Text.plain("  Pack: " + record.carrying + " of "
                + packSize(record) + ", worth " + Stats.cash(record.dugValue)));
        player.sendMessage(Text.plain("  Shovel: "
                + SHOVEL_NAME[Math.max(0, Math.min(SHOVEL_NAME.length - 1, record.shovelLevel))]));
        player.sendMessage(Component.empty());

        player.sendMessage(Text.plain("  /dig sell     empty the pack for money"));
        player.sendMessage(Text.plain("  /dig camp     climb out, from anywhere down there"));
        player.sendMessage(Text.plain("  /dig pack     a bigger one"));
        player.sendMessage(Text.plain("  /dig shovel   a better one"));
        player.sendMessage(Text.plain("  /dig detector a metal detector - hold it to sweep"));
        player.sendMessage(Text.plain("  /dig museum   donate relics for permanent bonuses"));
        player.sendMessage(Text.plain("  /dig give     hand a relic to the museum"));
        player.sendMessage(Text.plain("  /dig prestige start over for a permanent multiplier"));
        player.sendMessage(Text.plain("  The deeper you go, the better it gets."));

        long left = secondsLeft();
        player.sendMessage(Text.plain("  Ground resets in " + (left / 60) + "m "
                + String.format("%02d", left % 60) + "s."));

        /*
         * How many are left, and where the closest one is.
         *
         * Without this a quiet detector is indistinguishable from a broken one,
         * and "it never finds anything" has two very different causes.
         */
        Cache closest = nearest(player.getLocation(), Integer.MAX_VALUE);

        player.sendMessage(Text.plain("  Caches buried: " + caches.size()
                + " of " + CACHE_COUNT));

        if (closest != null && record.detectorLevel > 0) {
            player.sendMessage(Text.plain("  Nearest is "
                    + Math.round(acrossTo(closest, player.getLocation()))
                    + "m across, at depth " + (SURFACE - closest.y()) + "."));
        } else if (closest != null) {
            player.sendMessage(Text.plain("  Buy a detector to find them."));
        }
    }
}
