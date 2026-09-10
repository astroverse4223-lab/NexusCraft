package dev.nexuscraft.nexus;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextDecoration;
import org.bukkit.Material;
import org.bukkit.Sound;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.entity.Player;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;

import java.io.File;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;

/**
 * Players selling to players.
 *
 * The shop buys and sells at fixed prices, which is what stops the economy
 * falling over but also means nothing anybody makes is worth more than the sum
 * of its parts. An enchanted pickaxe, a stack of shulker boxes, a spawner - the
 * shop has no price for any of it, so it either goes in a chest forever or gets
 * given away in chat.
 *
 * This is where those go. It is also the only place money moves between players
 * without either of them having to be online at the same time, which on a small
 * server is most of the time.
 *
 * Nothing is ever destroyed. An item is held by the auction from the moment it
 * is listed, and every path out of here - sold, cancelled, expired, or the
 * server restarting halfway through - ends with it in somebody's vault. That
 * property is worth more than any feature, because the failure it prevents is
 * the one nobody forgives.
 */
public final class Auction {

    public static final Component TITLE = Component.text("Auction House");

    /** How long a listing stands before it goes back. */
    private static final int DAYS = 3;

    /** The cut the server takes, which is the only thing removing money. */
    private static final double FEE = 0.05;

    /** How many any one person may have up at once. */
    private static int allowance(Ranks rank) {
        return switch (rank) {
            case PLAYER -> 3;
            case VIP -> 6;
            case MVP -> 10;
            case ADMIN, OWNER -> 40;
        };
    }

    /** One thing for sale. */
    private static final class Lot {
        UUID id;
        UUID seller;
        String sellerName;
        ItemStack item;
        double price;
        int listedAt;
    }

    private final Nexus nexus;
    private final File file;

    private final List<Lot> lots = new ArrayList<>();

    public Auction(Nexus nexus) {
        this.nexus = nexus;
        this.file = new File(nexus.getDataFolder(), "auction.yml");
        load();
    }

    private static int now() {
        return (int) (System.currentTimeMillis() / 1000);
    }

    /* -------------------------------------------------------------- selling */

    public void sell(Player player, double price) {
        ItemStack holding = player.getInventory().getItemInMainHand();

        if (holding.getType() == Material.AIR) {
            player.sendMessage(Text.bad("Hold what you want to sell."));
            return;
        }

        if (nexus.serverTool(holding)) {
            player.sendMessage(Text.bad("That one belongs to the server."));
            player.sendMessage(Text.plain("  It is free, and you would get it back anyway."));
            return;
        }
        if (price < 1) {
            player.sendMessage(Text.bad("Name a price. /ah sell <price>"));
            return;
        }
        if (price > 100_000_000) {
            player.sendMessage(Text.bad("That is more money than exists."));
            return;
        }

        int mine = 0;
        for (Lot lot : lots) if (lot.seller.equals(player.getUniqueId())) mine++;

        int allowed = allowance(nexus.stats().rankOf(player.getUniqueId()));
        if (mine >= allowed) {
            player.sendMessage(Text.bad("You already have " + allowed + " things up."));
            player.sendMessage(Text.plain("  /ah mine to take one down."));
            return;
        }

        Lot lot = new Lot();
        lot.id = UUID.randomUUID();
        lot.seller = player.getUniqueId();
        lot.sellerName = player.getName();
        lot.item = holding.clone();
        lot.price = price;
        lot.listedAt = now();

        /*
         * Taken out of the inventory before the listing is saved.
         *
         * The other order - list, then remove - duplicates the item if anything
         * goes wrong in between, and an auction house that prints diamonds is
         * an economy that is over by the weekend.
         */
        player.getInventory().setItemInMainHand(null);
        lots.add(lot);
        save();

        player.sendMessage(Text.good("Listed for " + Stats.cash(price) + "."));
        player.playSound(player, Sound.BLOCK_NOTE_BLOCK_PLING, 0.8f, 1.4f);

        nexus.getServer().broadcast(Component.text(player.getName(), NamedTextColor.WHITE)
                .append(Component.text(" is selling ", NamedTextColor.GRAY))
                .append(Component.text(describe(lot.item), Text.BRAND))
                .append(Component.text("  " + Stats.cash(price), NamedTextColor.GOLD))
                .append(Component.text("   /ah", NamedTextColor.DARK_GRAY)));
    }

    /* --------------------------------------------------------------- buying */

    public void open(Player player) {
        Inventory page = nexus.getServer().createInventory(null, 54, TITLE);

        List<Lot> showing = new ArrayList<>(lots);
        showing.sort(Comparator.comparingInt(lot -> lot.listedAt));

        int slot = 0;
        for (Lot lot : showing) {
            if (slot >= 45) break;

            ItemStack icon = lot.item.clone();
            boolean mine = lot.seller.equals(player.getUniqueId());
            int left = lot.listedAt + DAYS * 86400 - now();

            icon.editMeta(meta -> {
                List<Component> lore = meta.hasLore()
                        ? new ArrayList<>(meta.lore()) : new ArrayList<>();

                lore.add(Component.empty());
                lore.add(Text.item(Stats.cash(lot.price), NamedTextColor.GOLD));
                lore.add(Text.item("from " + lot.sellerName, NamedTextColor.GRAY));
                lore.add(Text.item(Text.roughly(Math.max(0, left)) + " left",
                        NamedTextColor.DARK_GRAY));
                lore.add(Component.empty());
                lore.add(Text.item(mine ? "Click to take it back" : "Click to buy",
                        mine ? NamedTextColor.YELLOW : NamedTextColor.GREEN));

                meta.lore(lore);
            });

            page.setItem(slot++, icon);
        }

        ItemStack info = new ItemStack(Material.PAPER);
        info.editMeta(meta -> {
            meta.displayName(Component.text(lots.size() + " for sale", NamedTextColor.AQUA)
                    .decoration(TextDecoration.ITALIC, false));
            meta.lore(List.of(
                    Text.item("/ah sell <price> to list what you are holding",
                            NamedTextColor.GRAY),
                    Text.item("Listings last " + DAYS + " days", NamedTextColor.DARK_GRAY),
                    Text.item("The server takes " + Math.round(FEE * 100) + "%",
                            NamedTextColor.DARK_GRAY)));
        });
        page.setItem(49, info);

        player.openInventory(page);
    }

    /**
     * A click on a listing.
     *
     * The slot is resolved against the same sort the menu was built with, which
     * is why both are sorted by listing time: a menu ordered one way and a click
     * resolved another sells somebody the wrong item, and they would have no way
     * of knowing it had happened.
     */
    public void clicked(Player player, int slot) {
        if (slot < 0 || slot >= 45) return;

        List<Lot> showing = new ArrayList<>(lots);
        showing.sort(Comparator.comparingInt(lot -> lot.listedAt));

        if (slot >= showing.size()) return;
        Lot lot = showing.get(slot);

        // Gone between the menu opening and the click. Somebody else was faster.
        if (!lots.contains(lot)) {
            player.sendMessage(Text.bad("Somebody just bought that."));
            open(player);
            return;
        }

        if (lot.seller.equals(player.getUniqueId())) {
            cancel(player, lot);
            return;
        }

        if (!nexus.stats().charge(player.getUniqueId(), lot.price)) {
            player.sendMessage(Text.bad("That costs " + Stats.cash(lot.price)
                    + ". You have " + Stats.cash(nexus.stats().moneyOf(player.getUniqueId()))
                    + "."));
            return;
        }

        lots.remove(lot);

        double takeHome = lot.price * (1 - FEE);
        nexus.stats().pay(lot.seller, takeHome);

        nexus.vault().give(player, lot.item);
        save();

        player.sendMessage(Text.good("Bought " + describe(lot.item)
                + " for " + Stats.cash(lot.price) + "."));
        player.playSound(player, Sound.ENTITY_EXPERIENCE_ORB_PICKUP, 1f, 1.2f);

        Player seller = nexus.getServer().getPlayer(lot.seller);
        if (seller != null) {
            seller.sendMessage(Text.good(player.getName() + " bought your "
                    + describe(lot.item) + " for " + Stats.cash(takeHome) + "."));
            seller.playSound(seller, Sound.BLOCK_NOTE_BLOCK_PLING, 0.8f, 1.6f);
        }

        open(player);
    }

    private void cancel(Player player, Lot lot) {
        lots.remove(lot);
        save();

        nexus.vault().give(player, lot.item);
        player.sendMessage(Text.says("Taken down. /vault if it did not fit."));
        open(player);
    }

    /** What somebody has up, and what it is worth. */
    public void mine(Player player) {
        player.sendMessage(Text.heading("Your listings"));

        int shown = 0;
        for (Lot lot : lots) {
            if (!lot.seller.equals(player.getUniqueId())) continue;

            int left = lot.listedAt + DAYS * 86400 - now();
            player.sendMessage(Component.text("  " + describe(lot.item), NamedTextColor.WHITE)
                    .append(Component.text("   " + Stats.cash(lot.price), NamedTextColor.GOLD))
                    .append(Component.text("   " + Text.roughly(Math.max(0, left))
                                    + " left",
                            NamedTextColor.DARK_GRAY)));
            shown++;
        }

        if (shown == 0) {
            player.sendMessage(Text.plain("  Nothing. Hold something and /ah sell <price>."));
            return;
        }
        player.sendMessage(Text.plain("  /ah and click one to take it down."));
    }

    /* -------------------------------------------------------------- expiry */

    private int ticks;

    /**
     * Returns anything nobody bought.
     *
     * Checked once a minute rather than on a timer per listing, because a
     * thousand scheduled tasks is a thousand things to cancel correctly when
     * the plugin unloads and one sweep is none.
     */
    public void tick() {
        if (++ticks % 60 != 0) return;

        int cutoff = now() - DAYS * 86400;
        List<Lot> expired = new ArrayList<>();

        for (Lot lot : lots) if (lot.listedAt < cutoff) expired.add(lot);
        if (expired.isEmpty()) return;

        for (Lot lot : expired) {
            lots.remove(lot);
            nexus.vault().store(lot.seller, lot.item);

            Player seller = nexus.getServer().getPlayer(lot.seller);
            if (seller != null) {
                seller.sendMessage(Text.says("Your " + describe(lot.item)
                        + " did not sell. It is in your vault."));
            }
        }
        save();
    }

    public int size() {
        return lots.size();
    }

    private static String describe(ItemStack item) {
        String name = item.getType().name().toLowerCase().replace('_', ' ');
        return item.getAmount() > 1 ? item.getAmount() + "x " + name : name;
    }

    /* -------------------------------------------------------------- on disk */

    /**
     * Items are stored the way Bukkit serialises them, not by material name.
     *
     * An enchanted, renamed, damaged item is most of what makes an auction house
     * worth having, and a material name throws all of that away - somebody would
     * list a Sharpness V sword and get a plain one back.
     */
    private void load() {
        if (!file.exists()) return;

        YamlConfiguration yaml = YamlConfiguration.loadConfiguration(file);

        for (String key : yaml.getKeys(false)) {
            ItemStack item = yaml.getItemStack(key + ".item");
            if (item == null) continue;

            Lot lot = new Lot();
            try {
                lot.id = UUID.fromString(key);
                lot.seller = UUID.fromString(yaml.getString(key + ".seller", ""));
            } catch (IllegalArgumentException notAnId) {
                continue;
            }

            lot.sellerName = yaml.getString(key + ".sellerName", "somebody");
            lot.item = item;
            lot.price = yaml.getDouble(key + ".price");
            lot.listedAt = yaml.getInt(key + ".listedAt");

            lots.add(lot);
        }

        nexus.getLogger().info(lots.size() + " auction listings loaded");
    }

    public void save() {
        YamlConfiguration yaml = new YamlConfiguration();

        for (Lot lot : lots) {
            String key = lot.id.toString();
            yaml.set(key + ".seller", lot.seller.toString());
            yaml.set(key + ".sellerName", lot.sellerName);
            yaml.set(key + ".item", lot.item);
            yaml.set(key + ".price", lot.price);
            yaml.set(key + ".listedAt", lot.listedAt);
        }

        try {
            yaml.save(file);
        } catch (Exception e) {
            nexus.getLogger().warning("could not save the auction: " + e);
        }
    }

    /**
     * Proves an item survives being written and read back.
     *
     * The one thing here that would be catastrophic and silent: a listing that
     * loads as a plain item has quietly eaten somebody's enchantments, and
     * nothing anywhere would say so.
     */
    public String selfTest() {
        ItemStack sword = new ItemStack(Material.DIAMOND_SWORD);
        sword.addUnsafeEnchantment(org.bukkit.enchantments.Enchantment.SHARPNESS, 5);
        sword.editMeta(meta -> meta.displayName(Component.text("Test Blade")));

        YamlConfiguration out = new YamlConfiguration();
        out.set("lot.item", sword);

        YamlConfiguration back = new YamlConfiguration();
        try {
            back.loadFromString(out.saveToString());
        } catch (Exception broken) {
            return "a listing cannot be written: " + broken;
        }

        ItemStack read = back.getItemStack("lot.item");
        if (read == null) return "a listed item came back as nothing";
        if (read.getType() != Material.DIAMOND_SWORD) return "came back a " + read.getType();

        int sharpness = read.getEnchantmentLevel(
                org.bukkit.enchantments.Enchantment.SHARPNESS);
        if (sharpness != 5) return "enchantment came back at level " + sharpness;

        if (!read.hasItemMeta() || read.getItemMeta().displayName() == null) {
            return "the name was lost";
        }
        return "ok";
    }
}
