package dev.nexuscraft.nexus.bedwars;

import dev.nexuscraft.nexus.Text;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.Sound;
import org.bukkit.entity.Player;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;

import java.util.ArrayList;
import java.util.List;

/**
 * Where the iron goes.
 *
 * BedWars is an economy game wearing a PvP game's clothes, and the shop is
 * where that actually happens: every decision that matters is whether to spend
 * on defence, on a rush, or on the tools to get more. The prices below are the
 * standard ones, because they have been balanced by a decade of people playing
 * them and anything I invented would be worse.
 *
 * Two menus. Items are bought over and over and are lost on death; upgrades are
 * bought once and belong to the team forever. Keeping them apart is not
 * tidiness — it is the difference between a purchase you make on reflex and one
 * you have to think about.
 */
public final class Shop {

    public static final Component ITEMS_TITLE =
            Component.text("Shop", NamedTextColor.DARK_GRAY);
    public static final Component UPGRADES_TITLE =
            Component.text("Team Upgrades", NamedTextColor.DARK_GRAY);

    /** One thing you can buy, and what it costs. */
    public record Offer(Material icon, int amount, String name, Material currency, int price) {
    }

    private static final Material IRON = Material.IRON_INGOT;
    private static final Material GOLD = Material.GOLD_INGOT;
    private static final Material EMERALD = Material.EMERALD;
    private static final Material DIAMOND = Material.DIAMOND;

    /**
     * The shelf.
     *
     * Ordered the way it is used rather than by price: blocks first because
     * every round starts with bridging, then the weapon, then the things you
     * only reach for once the game has gone somewhere.
     */
    public static final List<Offer> ITEMS = List.of(
            new Offer(Material.WHITE_WOOL, 16, "Wool", IRON, 4),
            new Offer(Material.END_STONE, 12, "End Stone", IRON, 24),
            new Offer(Material.LADDER, 8, "Ladders", IRON, 4),
            new Offer(Material.OAK_PLANKS, 16, "Planks", GOLD, 4),
            new Offer(Material.OBSIDIAN, 4, "Obsidian", EMERALD, 4),

            new Offer(Material.STONE_SWORD, 1, "Stone Sword", IRON, 10),
            new Offer(Material.IRON_SWORD, 1, "Iron Sword", GOLD, 7),
            new Offer(Material.DIAMOND_SWORD, 1, "Diamond Sword", EMERALD, 4),
            new Offer(Material.STICK, 1, "Knockback Stick", GOLD, 5),

            new Offer(Material.CHAINMAIL_BOOTS, 1, "Chainmail Armour", IRON, 40),
            new Offer(Material.IRON_BOOTS, 1, "Iron Armour", GOLD, 12),
            new Offer(Material.DIAMOND_BOOTS, 1, "Diamond Armour", EMERALD, 6),

            new Offer(Material.SHEARS, 1, "Shears", IRON, 20),
            new Offer(Material.WOODEN_PICKAXE, 1, "Pickaxe", IRON, 10),
            new Offer(Material.IRON_PICKAXE, 1, "Iron Pickaxe", GOLD, 8),

            new Offer(Material.BOW, 1, "Bow", GOLD, 12),
            new Offer(Material.ARROW, 6, "Arrows", GOLD, 2),
            new Offer(Material.GOLDEN_APPLE, 1, "Golden Apple", GOLD, 3),
            new Offer(Material.TNT, 1, "TNT", GOLD, 4),
            new Offer(Material.WATER_BUCKET, 1, "Water Bucket", GOLD, 3),
            new Offer(Material.FIRE_CHARGE, 1, "Fireball", IRON, 40),
            new Offer(Material.ENDER_PEARL, 1, "Ender Pearl", EMERALD, 4)
    );

    private Shop() {
    }

    /* ---------------------------------------------------------------- items */

    public static void openItems(Player player) {
        Inventory menu = Bukkit.createInventory(null, 36, ITEMS_TITLE);
        for (int i = 0; i < ITEMS.size(); i++) menu.setItem(i, display(ITEMS.get(i), player));
        player.openInventory(menu);
    }

    private static ItemStack display(Offer offer, Player player) {
        ItemStack item = new ItemStack(offer.icon(), offer.amount());
        boolean afford = held(player, offer.currency()) >= offer.price();

        item.editMeta(meta -> {
            meta.displayName(Text.item(offer.name(), afford ? NamedTextColor.GREEN : NamedTextColor.RED));
            meta.lore(List.of(
                    Text.item(offer.price() + " " + nameOf(offer.currency()),
                            colourOf(offer.currency())),
                    Component.empty(),
                    Text.item(afford ? "Click to buy" : "You cannot afford this",
                            afford ? NamedTextColor.YELLOW : NamedTextColor.DARK_GRAY)));
        });
        return item;
    }

    /** Buys whatever was clicked, if they can pay for it. */
    public static void buy(Player player, Squad squad, int slot) {
        if (slot < 0 || slot >= ITEMS.size()) return;
        Offer offer = ITEMS.get(slot);

        if (held(player, offer.currency()) < offer.price()) {
            player.sendMessage(Text.bad("You need " + offer.price() + " " + nameOf(offer.currency()) + "."));
            player.playSound(player, Sound.ENTITY_VILLAGER_NO, 1f, 1f);
            return;
        }

        take(player, offer.currency(), offer.price());
        give(player, squad, offer);

        player.playSound(player, Sound.ENTITY_ITEM_PICKUP, 1f, 1.4f);
    }

    /**
     * Hands over what was bought.
     *
     * Armour is a set rather than the boot shown in the menu, and it goes
     * straight onto the body — a player who buys iron armour and then has to
     * open their inventory to put it on during a fight has not bought anything.
     */
    private static void give(Player player, Squad squad, Offer offer) {
        switch (offer.icon()) {
            case CHAINMAIL_BOOTS -> armour(player, Material.CHAINMAIL_LEGGINGS, Material.CHAINMAIL_BOOTS);
            case IRON_BOOTS -> armour(player, Material.IRON_LEGGINGS, Material.IRON_BOOTS);
            case DIAMOND_BOOTS -> armour(player, Material.DIAMOND_LEGGINGS, Material.DIAMOND_BOOTS);

            case WHITE_WOOL -> {
                ItemStack wool = new ItemStack(squad.wool, offer.amount());
                player.getInventory().addItem(wool);
            }

            default -> player.getInventory().addItem(new ItemStack(offer.icon(), offer.amount()));
        }
    }

    private static void armour(Player player, Material legs, Material boots) {
        player.getInventory().setLeggings(new ItemStack(legs));
        player.getInventory().setBoots(new ItemStack(boots));
    }

    /* ------------------------------------------------------------- upgrades */

    /** A team upgrade: what it does, how far it goes, and what each step costs. */
    public record Upgrade(int slot, Material icon, String name, String blurb, int[] costs) {
    }

    public static final List<Upgrade> UPGRADES = List.of(
            new Upgrade(0, Material.IRON_SWORD, "Sharpened Swords",
                    "Every sword your team holds", new int[]{4}),
            new Upgrade(1, Material.IRON_CHESTPLATE, "Reinforced Armour",
                    "Protection for the whole team", new int[]{2, 4, 8, 16}),
            new Upgrade(2, Material.GOLDEN_PICKAXE, "Maniac Miner",
                    "Haste, so you break blocks faster", new int[]{2, 4}),
            new Upgrade(3, Material.FURNACE, "Iron Forge",
                    "Your base generator runs faster", new int[]{2, 4, 6, 8}),
            new Upgrade(4, Material.BEACON, "Heal Pool",
                    "Regeneration while you are at your base", new int[]{3})
    );

    public static void openUpgrades(Player player, Squad squad) {
        Inventory menu = Bukkit.createInventory(null, 27, UPGRADES_TITLE);

        for (Upgrade upgrade : UPGRADES) {
            int level = levelOf(squad, upgrade);
            boolean maxed = level >= upgrade.costs().length;
            int cost = maxed ? 0 : upgrade.costs()[level];
            boolean afford = !maxed && held(player, DIAMOND) >= cost;

            ItemStack item = new ItemStack(upgrade.icon());
            item.editMeta(meta -> {
                meta.displayName(Text.item(upgrade.name(),
                        maxed ? NamedTextColor.GRAY : afford ? NamedTextColor.GREEN : NamedTextColor.RED));

                List<Component> lore = new ArrayList<>();
                lore.add(Text.item(upgrade.blurb(), NamedTextColor.GRAY));
                lore.add(Text.item("Level " + level + " / " + upgrade.costs().length,
                        NamedTextColor.DARK_GRAY));
                lore.add(Component.empty());
                lore.add(maxed
                        ? Text.item("Fully upgraded", NamedTextColor.GRAY)
                        : Text.item(cost + " Diamonds", NamedTextColor.AQUA));
                meta.lore(lore);
            });

            menu.setItem(upgrade.slot(), item);
        }

        player.openInventory(menu);
    }

    public static int levelOf(Squad squad, Upgrade upgrade) {
        return switch (upgrade.slot()) {
            case 0 -> squad.sharpness;
            case 1 -> squad.protection;
            case 2 -> squad.haste;
            case 3 -> squad.forge;
            case 4 -> squad.healPool ? 1 : 0;
            default -> 0;
        };
    }

    /** Applies an upgrade to the team. Returns what to announce, or null. */
    public static String buyUpgrade(Player player, Squad squad, int slot) {
        Upgrade upgrade = UPGRADES.stream().filter(u -> u.slot() == slot).findFirst().orElse(null);
        if (upgrade == null) return null;

        int level = levelOf(squad, upgrade);
        if (level >= upgrade.costs().length) {
            player.sendMessage(Text.bad("That is already fully upgraded."));
            return null;
        }

        int cost = upgrade.costs()[level];
        if (held(player, DIAMOND) < cost) {
            player.sendMessage(Text.bad("You need " + cost + " diamonds."));
            player.playSound(player, Sound.ENTITY_VILLAGER_NO, 1f, 1f);
            return null;
        }

        take(player, DIAMOND, cost);

        switch (upgrade.slot()) {
            case 0 -> squad.sharpness++;
            case 1 -> squad.protection++;
            case 2 -> squad.haste++;
            case 3 -> squad.forge++;
            case 4 -> squad.healPool = true;
            default -> {
            }
        }

        return player.getName() + " bought " + upgrade.name() + " " + (level + 1);
    }

    /* --------------------------------------------------------------- money */

    /**
     * Currency is the actual items, counted in the inventory.
     *
     * There is no wallet. Iron you are carrying is iron you can lose, which is
     * why killing somebody on their way back from the middle is worth doing —
     * a number in a database would make the whole map pointless.
     */
    public static int held(Player player, Material currency) {
        int total = 0;
        for (ItemStack stack : player.getInventory().getContents()) {
            if (stack != null && stack.getType() == currency) total += stack.getAmount();
        }
        return total;
    }

    private static void take(Player player, Material currency, int amount) {
        int left = amount;
        ItemStack[] contents = player.getInventory().getContents();

        for (int i = 0; i < contents.length && left > 0; i++) {
            ItemStack stack = contents[i];
            if (stack == null || stack.getType() != currency) continue;

            int taken = Math.min(left, stack.getAmount());
            stack.setAmount(stack.getAmount() - taken);
            left -= taken;

            if (stack.getAmount() <= 0) player.getInventory().setItem(i, null);
        }
        player.updateInventory();
    }

    private static String nameOf(Material currency) {
        if (currency == IRON) return "Iron";
        if (currency == GOLD) return "Gold";
        if (currency == DIAMOND) return "Diamonds";
        return "Emeralds";
    }

    private static NamedTextColor colourOf(Material currency) {
        if (currency == IRON) return NamedTextColor.WHITE;
        if (currency == GOLD) return NamedTextColor.GOLD;
        if (currency == DIAMOND) return NamedTextColor.AQUA;
        return NamedTextColor.GREEN;
    }
}
