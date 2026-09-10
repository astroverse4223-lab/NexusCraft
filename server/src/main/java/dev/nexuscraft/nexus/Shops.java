package dev.nexuscraft.nexus;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.Sound;
import org.bukkit.entity.Player;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Where money goes and where it comes from.
 *
 * An economy needs both halves or it is not one. A server with only a shop has
 * money that appears from nowhere; a server with only selling has money that
 * does nothing. What makes the loop work is that the sell prices are low enough
 * that buying anything is a decision, and that the things worth buying are the
 * things that make you better at earning.
 *
 * Prices are per item and deliberately round. A player should be able to look
 * at a stack of sixty-four coal and know what it is worth without a calculator.
 */
public final class Shops {

    public static final Component SHOP_TITLE =
            Component.text("Shop", NamedTextColor.DARK_GRAY);

    /** What the shop pays for things, per item. Anything absent cannot be sold. */
    private static final Map<Material, Double> SELLS = new LinkedHashMap<>();

    static {
        SELLS.put(Material.COBBLESTONE, 0.40);
        SELLS.put(Material.STONE, 0.80);
        SELLS.put(Material.COAL, 4.0);
        SELLS.put(Material.RAW_IRON, 9.0);
        SELLS.put(Material.IRON_INGOT, 11.0);
        SELLS.put(Material.RAW_GOLD, 18.0);
        SELLS.put(Material.GOLD_INGOT, 22.0);
        SELLS.put(Material.REDSTONE, 6.0);
        SELLS.put(Material.LAPIS_LAZULI, 7.0);
        SELLS.put(Material.DIAMOND, 45.0);
        SELLS.put(Material.EMERALD, 70.0);
        SELLS.put(Material.QUARTZ, 12.0);

        // Survival brings its own things to sell, so the two worlds share one
        // economy rather than each having a currency nobody can move.
        SELLS.put(Material.OAK_LOG, 1.5);
        SELLS.put(Material.WHEAT, 1.0);
        SELLS.put(Material.ROTTEN_FLESH, 0.5);
        SELLS.put(Material.BONE, 2.0);
        SELLS.put(Material.GUNPOWDER, 5.0);
        SELLS.put(Material.ENDER_PEARL, 25.0);
        SELLS.put(Material.SPRUCE_LOG, 1.5);
        SELLS.put(Material.BIRCH_LOG, 1.5);
        SELLS.put(Material.DARK_OAK_LOG, 1.8);
        SELLS.put(Material.NETHERRACK, 0.3);
        SELLS.put(Material.QUARTZ_BLOCK, 14.0);
        SELLS.put(Material.OBSIDIAN, 30.0);
        SELLS.put(Material.AMETHYST_SHARD, 16.0);
        SELLS.put(Material.COPPER_INGOT, 4.0);
        SELLS.put(Material.RAW_COPPER, 3.0);
        SELLS.put(Material.STRING, 3.0);
        SELLS.put(Material.SPIDER_EYE, 4.0);
        SELLS.put(Material.SLIME_BALL, 8.0);
        SELLS.put(Material.BLAZE_ROD, 30.0);
        SELLS.put(Material.GHAST_TEAR, 60.0);
        SELLS.put(Material.NETHERITE_SCRAP, 900.0);
        SELLS.put(Material.PRISMARINE_SHARD, 9.0);
        SELLS.put(Material.NAUTILUS_SHELL, 120.0);
        SELLS.put(Material.CARROT, 1.0);
        SELLS.put(Material.POTATO, 1.0);
        SELLS.put(Material.BEETROOT, 1.2);
        SELLS.put(Material.MELON_SLICE, 0.8);
        SELLS.put(Material.PUMPKIN, 3.0);
        SELLS.put(Material.SUGAR_CANE, 1.5);
        SELLS.put(Material.COCOA_BEANS, 2.0);
        SELLS.put(Material.LEATHER, 5.0);
        SELLS.put(Material.FEATHER, 2.0);
        SELLS.put(Material.PORKCHOP, 3.0);
        SELLS.put(Material.BEEF, 3.0);
        SELLS.put(Material.CHICKEN, 2.5);
        SELLS.put(Material.INK_SAC, 4.0);
        SELLS.put(Material.GLOW_INK_SAC, 12.0);
    }

    /** One thing on the shelf. */
    public record Buy(Material item, int amount, String name, double price) {
    }

    /**
     * A page of the shop.
     *
     * Categories rather than one long list, because a shop is the main thing
     * money is for and thirty items in one window is a wall you scan rather
     * than a shop you browse. Each page is small enough to take in at a glance,
     * which is the only way anybody notices you added something.
     */
    public record Aisle(String name, Material icon, List<Buy> stock) {
    }

    public static final List<Aisle> AISLES = List.of(
            new Aisle("Blocks", Material.BRICKS, List.of(
                    new Buy(Material.COBBLESTONE, 64, "Cobblestone", 90),
                    new Buy(Material.STONE, 64, "Stone", 180),
                    new Buy(Material.OAK_LOG, 32, "Oak Logs", 200),
                    new Buy(Material.SPRUCE_LOG, 32, "Spruce Logs", 200),
                    new Buy(Material.OAK_PLANKS, 64, "Planks", 160),
                    new Buy(Material.GLASS, 32, "Glass", 260),
                    new Buy(Material.STONE_BRICKS, 64, "Stone Bricks", 320),
                    new Buy(Material.DEEPSLATE_BRICKS, 64, "Deepslate Bricks", 420),
                    new Buy(Material.QUARTZ_BLOCK, 32, "Quartz", 900),
                    new Buy(Material.SAND, 64, "Sand", 120),
                    new Buy(Material.DIRT, 64, "Dirt", 60),
                    new Buy(Material.OBSIDIAN, 8, "Obsidian", 1_600)
            )),

            new Aisle("Tools", Material.IRON_PICKAXE, List.of(
                    new Buy(Material.IRON_PICKAXE, 1, "Iron Pickaxe", 400),
                    new Buy(Material.DIAMOND_PICKAXE, 1, "Diamond Pickaxe", 2_400),
                    new Buy(Material.NETHERITE_PICKAXE, 1, "Netherite Pickaxe", 45_000),
                    new Buy(Material.IRON_AXE, 1, "Iron Axe", 380),
                    new Buy(Material.DIAMOND_AXE, 1, "Diamond Axe", 2_300),
                    new Buy(Material.IRON_SHOVEL, 1, "Iron Shovel", 320),
                    new Buy(Material.DIAMOND_SHOVEL, 1, "Diamond Shovel", 2_000),
                    new Buy(Material.SHEARS, 1, "Shears", 300),
                    new Buy(Material.FISHING_ROD, 1, "Fishing Rod", 450),
                    new Buy(Material.FLINT_AND_STEEL, 1, "Flint and Steel", 350),
                    new Buy(Material.BUCKET, 1, "Bucket", 400),
                    new Buy(Material.SHIELD, 1, "Shield", 700)
            )),

            new Aisle("Armour", Material.DIAMOND_CHESTPLATE, List.of(
                    new Buy(Material.IRON_HELMET, 1, "Iron Helmet", 500),
                    new Buy(Material.IRON_CHESTPLATE, 1, "Iron Chestplate", 900),
                    new Buy(Material.IRON_LEGGINGS, 1, "Iron Leggings", 800),
                    new Buy(Material.IRON_BOOTS, 1, "Iron Boots", 450),
                    new Buy(Material.DIAMOND_HELMET, 1, "Diamond Helmet", 3_200),
                    new Buy(Material.DIAMOND_CHESTPLATE, 1, "Diamond Chestplate", 5_600),
                    new Buy(Material.DIAMOND_LEGGINGS, 1, "Diamond Leggings", 4_800),
                    new Buy(Material.DIAMOND_BOOTS, 1, "Diamond Boots", 3_000),
                    new Buy(Material.ELYTRA, 1, "Elytra", 250_000)
            )),

            new Aisle("Food", Material.COOKED_BEEF, List.of(
                    new Buy(Material.BREAD, 16, "Bread", 80),
                    new Buy(Material.COOKED_BEEF, 16, "Steak", 120),
                    new Buy(Material.COOKED_CHICKEN, 16, "Chicken", 100),
                    new Buy(Material.GOLDEN_CARROT, 8, "Golden Carrots", 700),
                    new Buy(Material.GOLDEN_APPLE, 1, "Golden Apple", 900),
                    new Buy(Material.ENCHANTED_GOLDEN_APPLE, 1, "Notch Apple", 60_000),
                    new Buy(Material.CAKE, 1, "Cake", 450),
                    new Buy(Material.WHEAT_SEEDS, 16, "Seeds", 60),
                    new Buy(Material.CARROT, 16, "Carrots", 90),
                    new Buy(Material.POTATO, 16, "Potatoes", 90)
            )),

            new Aisle("Utility", Material.ENDER_CHEST, List.of(
                    new Buy(Material.TORCH, 32, "Torches", 80),
                    new Buy(Material.LANTERN, 8, "Lanterns", 300),
                    new Buy(Material.CHEST, 4, "Chests", 150),
                    new Buy(Material.ENDER_CHEST, 1, "Ender Chest", 6_000),
                    new Buy(Material.CRAFTING_TABLE, 1, "Crafting Table", 100),
                    new Buy(Material.FURNACE, 2, "Furnaces", 200),
                    new Buy(Material.ANVIL, 1, "Anvil", 3_500),
                    new Buy(Material.ENCHANTING_TABLE, 1, "Enchanting Table", 12_000),
                    new Buy(Material.BOOKSHELF, 16, "Bookshelves", 4_000),
                    new Buy(Material.WATER_BUCKET, 1, "Water Bucket", 250),
                    new Buy(Material.LAVA_BUCKET, 1, "Lava Bucket", 900),
                    new Buy(Material.EXPERIENCE_BOTTLE, 16, "Experience", 1_200),
                    new Buy(Material.TNT, 8, "TNT", 1_800),
                    new Buy(Material.REDSTONE, 32, "Redstone", 400),
                    new Buy(Material.HOPPER, 4, "Hoppers", 1_600)
            )),

            new Aisle("Rare", Material.NETHER_STAR, List.of(
                    new Buy(Material.DIAMOND, 8, "Diamonds", 3_600),
                    new Buy(Material.EMERALD, 8, "Emeralds", 5_600),
                    new Buy(Material.NETHERITE_INGOT, 1, "Netherite Ingot", 40_000),
                    new Buy(Material.ANCIENT_DEBRIS, 4, "Ancient Debris", 120_000),
                    new Buy(Material.TOTEM_OF_UNDYING, 1, "Totem of Undying", 90_000),
                    new Buy(Material.SHULKER_BOX, 1, "Shulker Box", 45_000),
                    new Buy(Material.BEACON, 1, "Beacon", 300_000),
                    new Buy(Material.NETHER_STAR, 1, "Nether Star", 400_000)
            ))
    );

    /** Flattened, because a click only knows which page it was on. */
    public static List<Buy> stockOf(int aisle) {
        return aisle < 0 || aisle >= AISLES.size() ? List.of() : AISLES.get(aisle).stock();
    }

    private Shops() {
    }

    /* ----------------------------------------------------------- the shelf */

    public static void open(Nexus nexus, Player player) {
        Inventory menu = Bukkit.createInventory(null, 27, SHOP_TITLE);
        double money = nexus.stats().moneyOf(player.getUniqueId());

        for (int i = 0; i < AISLES.size(); i++) {
            Aisle aisle = AISLES.get(i);

            ItemStack item = new ItemStack(aisle.icon());
            item.editMeta(meta -> {
                meta.displayName(Text.item(aisle.name(), NamedTextColor.GREEN));
                meta.lore(List.of(
                        Text.item(aisle.stock().size() + " things", NamedTextColor.GRAY),
                        Component.empty(),
                        Text.item("Click to browse", NamedTextColor.YELLOW)));
            });
            menu.setItem(i + 10, item);
        }

        menu.setItem(26, balanceTag(money));
        player.openInventory(menu);
    }

    /** One page. The last row is the balance and the way back. */
    public static void openAisle(Nexus nexus, Player player, int index) {
        Aisle aisle = AISLES.get(index);
        double money = nexus.stats().moneyOf(player.getUniqueId());

        Inventory menu = Bukkit.createInventory(null, 45,
                Component.text(aisle.name(), NamedTextColor.DARK_GRAY));

        for (int i = 0; i < aisle.stock().size(); i++) {
            Buy buy = aisle.stock().get(i);
            boolean afford = money >= buy.price();

            ItemStack item = new ItemStack(buy.item(), buy.amount());
            item.editMeta(meta -> {
                meta.displayName(Text.item(buy.name(),
                        afford ? NamedTextColor.GREEN : NamedTextColor.RED));
                meta.lore(List.of(
                        Text.item(Stats.cash(buy.price()), NamedTextColor.GOLD),
                        Component.empty(),
                        Text.item(afford ? "Click to buy" : "You cannot afford this",
                                afford ? NamedTextColor.YELLOW : NamedTextColor.DARK_GRAY)));
            });
            menu.setItem(i, item);
        }

        ItemStack back = new ItemStack(Material.ARROW);
        back.editMeta(meta -> meta.displayName(Text.item("Back", NamedTextColor.GRAY)));
        menu.setItem(36, back);

        menu.setItem(44, balanceTag(money));
        player.openInventory(menu);
    }

    /** Which aisle a title belongs to, or -1. */
    public static int aisleFor(Component title) {
        for (int i = 0; i < AISLES.size(); i++) {
            if (title.equals(Component.text(AISLES.get(i).name(), NamedTextColor.DARK_GRAY))) {
                return i;
            }
        }
        return -1;
    }

    private static ItemStack balanceTag(double money) {
        ItemStack balance = new ItemStack(Material.SUNFLOWER);
        balance.editMeta(meta -> {
            meta.displayName(Text.item("Your balance", NamedTextColor.GOLD));
            meta.lore(List.of(
                    Text.item(Stats.cash(money), NamedTextColor.WHITE),
                    Component.empty(),
                    Text.item("/sell all to sell what you are carrying",
                            NamedTextColor.DARK_GRAY)));
        });
        return balance;
    }

    public static void buy(Nexus nexus, Player player, int aisle, int slot) {
        List<Buy> stock = stockOf(aisle);
        if (slot < 0 || slot >= stock.size()) return;
        Buy buy = stock.get(slot);

        if (!nexus.stats().charge(player.getUniqueId(), buy.price())) {
            player.sendMessage(Text.bad("That costs " + Stats.cash(buy.price()) + ". You have "
                    + Stats.cash(nexus.stats().moneyOf(player.getUniqueId())) + "."));
            player.playSound(player, Sound.ENTITY_VILLAGER_NO, 1f, 1f);
            return;
        }

        // Anything that will not fit goes on the floor rather than vanishing.
        var leftOver = player.getInventory().addItem(new ItemStack(buy.item(), buy.amount()));
        for (ItemStack spare : leftOver.values()) {
            player.getWorld().dropItemNaturally(player.getLocation(), spare);
        }

        player.sendMessage(Text.good("Bought " + buy.name() + " for " + Stats.cash(buy.price()) + "."));
        player.playSound(player, Sound.ENTITY_ITEM_PICKUP, 1f, 1.3f);
    }

    /* -------------------------------------------------------------- selling */

    public static double priceOf(Material material) {
        return SELLS.getOrDefault(material, 0.0);
    }

    /**
     * Sells everything sellable that they are carrying.
     *
     * Held items are skipped deliberately. "/sell all" with a diamond pickaxe
     * in hand should not sell the pickaxe, and the number of servers where it
     * does is the reason people are afraid to type it.
     */
    public static void sellAll(Nexus nexus, Player player) {
        double earned = 0;
        int sold = 0;

        ItemStack[] contents = player.getInventory().getStorageContents();
        for (int i = 0; i < contents.length; i++) {
            ItemStack stack = contents[i];
            if (stack == null) continue;

            // The compass, the claim wand and a hat are the server's, handed
            // out free - selling one is losing a tool for nothing.
            if (nexus.serverTool(stack)) continue;

            double each = priceOf(stack.getType());
            if (each <= 0) continue;

            earned += each * stack.getAmount();
            sold += stack.getAmount();
            player.getInventory().setItem(i, null);
        }

        if (sold == 0) {
            player.sendMessage(Text.says("Nothing you are carrying can be sold."));
            return;
        }

        nexus.stats().pay(player.getUniqueId(), earned);
        nexus.stats().of(player.getUniqueId()).soldValue += earned;
        nexus.quests().check(player);
        player.updateInventory();

        player.sendMessage(Text.good("Sold " + sold + " for " + Stats.cash(earned) + "."));
        player.sendMessage(Text.plain("  Balance: "
                + Stats.cash(nexus.stats().moneyOf(player.getUniqueId()))));
        player.playSound(player, Sound.ENTITY_EXPERIENCE_ORB_PICKUP, 1f, 1.2f);
    }

    /** The price list, so nobody has to guess what is worth carrying home. */
    public static void showPrices(Player player) {
        player.sendMessage(Text.heading("Sell Prices"));
        for (Map.Entry<Material, Double> entry : SELLS.entrySet()) {
            String name = entry.getKey().name().toLowerCase().replace('_', ' ');
            player.sendMessage(Text.field(name, Stats.cash(entry.getValue()) + " each"));
        }
    }
}
