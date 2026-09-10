package dev.nexuscraft.nexus;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.Sound;
import org.bukkit.enchantments.Enchantment;
import org.bukkit.entity.Player;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.Damageable;

import java.util.ArrayList;
import java.util.List;

/**
 * Pay money to make your gear better.
 *
 * The best money sink a server can have, and the reason is that demand for it
 * never runs out. A shop sells you a diamond pickaxe once; an enchanter sells
 * you Efficiency on every pickaxe you will ever own, forever, at a price that
 * rises with the level. An economy with five ways to earn and two ways to spend
 * inflates until money stops meaning anything, and this is the cheapest thing
 * that fixes it without taking anything away from anybody.
 *
 * Works on whatever is in your hand. Deliberately not a table with lapis and
 * random outcomes — you are paying to choose, and paying for a dice roll is a
 * different and much less satisfying thing.
 */
public final class Enchanter {

    public static final Component TITLE =
            Component.text("Enchanter", NamedTextColor.DARK_GRAY);

    /** One thing on offer: what it does, how far it goes, and what a level costs. */
    private record Offer(Enchantment enchantment, String name, Material icon,
                         int most, double base) {
    }

    /**
     * What is for sale.
     *
     * Prices rise steeply with level on purpose. The first level of anything is
     * affordable to somebody who has just started, and the fifth is a target
     * for somebody who has been playing a fortnight — which is the whole span
     * the sink has to cover.
     */
    private static final List<Offer> OFFERS = List.of(
            new Offer(Enchantment.SHARPNESS, "Sharpness", Material.DIAMOND_SWORD, 5, 2_500),
            new Offer(Enchantment.PROTECTION, "Protection", Material.DIAMOND_CHESTPLATE, 4, 3_000),
            new Offer(Enchantment.EFFICIENCY, "Efficiency", Material.DIAMOND_PICKAXE, 5, 2_000),
            new Offer(Enchantment.UNBREAKING, "Unbreaking", Material.ANVIL, 3, 4_000),
            new Offer(Enchantment.FORTUNE, "Fortune", Material.DIAMOND, 3, 9_000),
            new Offer(Enchantment.LOOTING, "Looting", Material.GOLDEN_SWORD, 3, 7_500),
            new Offer(Enchantment.POWER, "Power", Material.BOW, 5, 2_200),
            new Offer(Enchantment.FEATHER_FALLING, "Feather Falling", Material.DIAMOND_BOOTS, 4, 2_800),
            new Offer(Enchantment.MENDING, "Mending", Material.EXPERIENCE_BOTTLE, 1, 60_000),
            new Offer(Enchantment.SILK_TOUCH, "Silk Touch", Material.SHEARS, 1, 25_000)
    );

    /** Repairing is priced by how broken it is, so a scratch is cheap. */
    private static final double REPAIR_PER_POINT = 6.0;

    private Enchanter() {
    }

    /* ---------------------------------------------------------------- menu */

    public static void open(Nexus nexus, Player player) {
        ItemStack holding = player.getInventory().getItemInMainHand();
        Inventory menu = Bukkit.createInventory(null, 27, TITLE);

        double money = nexus.stats().moneyOf(player.getUniqueId());

        for (int i = 0; i < OFFERS.size(); i++) {
            Offer offer = OFFERS.get(i);
            menu.setItem(i, describe(offer, holding, money));
        }

        menu.setItem(22, repairTag(holding, money));
        player.openInventory(menu);
    }

    private static ItemStack describe(Offer offer, ItemStack holding, double money) {
        int has = holding == null ? 0 : holding.getEnchantmentLevel(offer.enchantment());
        int next = has + 1;

        boolean maxed = has >= offer.most();
        boolean fits = holding != null && holding.getType() != Material.AIR
                && offer.enchantment().canEnchantItem(holding);
        double price = priceOf(offer, next);

        ItemStack item = new ItemStack(offer.icon());
        item.editMeta(meta -> {
            meta.displayName(Text.item(offer.name() + (maxed ? "" : " " + roman(next)),
                    maxed ? NamedTextColor.GRAY
                            : !fits ? NamedTextColor.DARK_GRAY
                            : money >= price ? NamedTextColor.GREEN : NamedTextColor.RED));

            List<Component> lore = new ArrayList<>();
            if (!fits) {
                lore.add(Text.item("Hold something this fits on", NamedTextColor.DARK_GRAY));
            } else if (maxed) {
                lore.add(Text.item("Already at " + roman(offer.most()), NamedTextColor.GRAY));
            } else {
                if (has > 0) {
                    lore.add(Text.item("Currently " + roman(has), NamedTextColor.GRAY));
                }
                lore.add(Text.item(Stats.cash(price), NamedTextColor.GOLD));
                lore.add(Component.empty());
                lore.add(Text.item(money >= price ? "Click to buy" : "You cannot afford this",
                        money >= price ? NamedTextColor.YELLOW : NamedTextColor.DARK_GRAY));
            }
            meta.lore(lore);
        });
        return item;
    }

    /** Each level costs more than the last, steeply. */
    private static double priceOf(Offer offer, int level) {
        return offer.base() * Math.pow(2.1, level - 1);
    }

    private static ItemStack repairTag(ItemStack holding, double money) {
        int damage = holding != null && holding.getItemMeta() instanceof Damageable damageable
                ? damageable.getDamage() : 0;
        double price = damage * REPAIR_PER_POINT;

        ItemStack item = new ItemStack(Material.ANVIL);
        item.editMeta(meta -> {
            meta.displayName(Text.item("Repair", damage == 0 ? NamedTextColor.GRAY
                    : money >= price ? NamedTextColor.GREEN : NamedTextColor.RED));

            meta.lore(damage == 0
                    ? List.of(Text.item("Nothing in your hand needs it", NamedTextColor.DARK_GRAY))
                    : List.of(
                            Text.item("Fully repairs what you are holding", NamedTextColor.GRAY),
                            Text.item(Stats.cash(price), NamedTextColor.GOLD),
                            Component.empty(),
                            Text.item(money >= price ? "Click to repair" : "You cannot afford this",
                                    money >= price ? NamedTextColor.YELLOW : NamedTextColor.DARK_GRAY)));
        });
        return item;
    }

    /* -------------------------------------------------------------- buying */

    public static void clicked(Nexus nexus, Player player, int slot) {
        ItemStack holding = player.getInventory().getItemInMainHand();

        if (holding.getType() == Material.AIR) {
            player.sendMessage(Text.bad("Hold the thing you want worked on."));
            return;
        }

        if (slot == 22) {
            repair(nexus, player, holding);
            open(nexus, player);
            return;
        }

        if (slot < 0 || slot >= OFFERS.size()) return;
        Offer offer = OFFERS.get(slot);

        if (!offer.enchantment().canEnchantItem(holding)) {
            player.sendMessage(Text.bad("That does not go on this."));
            return;
        }

        int next = holding.getEnchantmentLevel(offer.enchantment()) + 1;
        if (next > offer.most()) {
            player.sendMessage(Text.bad("Already at " + roman(offer.most()) + "."));
            return;
        }

        double price = priceOf(offer, next);
        if (!nexus.stats().charge(player.getUniqueId(), price)) {
            player.sendMessage(Text.bad("That costs " + Stats.cash(price) + "."));
            player.playSound(player, Sound.ENTITY_VILLAGER_NO, 1f, 1f);
            return;
        }

        holding.addUnsafeEnchantment(offer.enchantment(), next);
        player.updateInventory();

        player.sendMessage(Text.good(offer.name() + " " + roman(next)
                + " for " + Stats.cash(price) + "."));
        player.playSound(player, Sound.BLOCK_ENCHANTMENT_TABLE_USE, 1f, 1.2f);
        player.getWorld().spawnParticle(org.bukkit.Particle.ENCHANT,
                player.getLocation().add(0, 1.4, 0), 40, 0.4, 0.5, 0.4, 0.6);

        open(nexus, player);
    }

    private static void repair(Nexus nexus, Player player, ItemStack holding) {
        if (!(holding.getItemMeta() instanceof Damageable damageable) || damageable.getDamage() == 0) {
            player.sendMessage(Text.says("That does not need repairing."));
            return;
        }

        double price = damageable.getDamage() * REPAIR_PER_POINT;
        if (!nexus.stats().charge(player.getUniqueId(), price)) {
            player.sendMessage(Text.bad("That costs " + Stats.cash(price) + "."));
            return;
        }

        holding.editMeta(Damageable.class, meta -> meta.setDamage(0));
        player.updateInventory();

        player.sendMessage(Text.good("Repaired for " + Stats.cash(price) + "."));
        player.playSound(player, Sound.BLOCK_ANVIL_USE, 0.8f, 1.2f);
    }

    private static String roman(int number) {
        return switch (number) {
            case 1 -> "I";
            case 2 -> "II";
            case 3 -> "III";
            case 4 -> "IV";
            case 5 -> "V";
            default -> String.valueOf(number);
        };
    }
}
