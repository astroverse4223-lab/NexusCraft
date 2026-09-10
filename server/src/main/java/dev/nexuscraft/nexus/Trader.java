package dev.nexuscraft.nexus;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.Sound;
import org.bukkit.entity.Player;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Three deals a day, well above the going rate.
 *
 * Two jobs at once. The obvious one is a reason to log in tomorrow — the deals
 * change at midnight and one of them might be for something you have a chest
 * of. The quieter one is that it is a *sink for items*, which an economy needs
 * as much as it needs a sink for money: without one, everything anybody has
 * ever mined is still in a chest somewhere, and the shop price of iron is a
 * fiction.
 *
 * Paying over the odds is the whole mechanism. If the trader paid market rate
 * nobody would walk to him, and the premium is what makes checking worth doing.
 */
public final class Trader {

    public static final Component TITLE =
            Component.text("Wandering Trader", NamedTextColor.DARK_GRAY);

    /** What might be wanted, and roughly what it is worth ordinarily. */
    private record Wanted(Material item, int many, double each) {
    }

    /**
     * The pool the day's three are drawn from.
     *
     * Deliberately ordinary things. A deal for netherite is a deal nobody can
     * take; a deal for two hundred cobblestone is one that anybody who mined
     * this week can, which is what makes it worth walking over for.
     */
    private static final List<Wanted> POOL = List.of(
            new Wanted(Material.COBBLESTONE, 256, 0.40),
            new Wanted(Material.STONE, 128, 0.80),
            new Wanted(Material.COAL, 64, 4.0),
            new Wanted(Material.IRON_INGOT, 32, 11.0),
            new Wanted(Material.GOLD_INGOT, 24, 22.0),
            new Wanted(Material.REDSTONE, 64, 6.0),
            new Wanted(Material.LAPIS_LAZULI, 48, 7.0),
            new Wanted(Material.DIAMOND, 12, 45.0),
            new Wanted(Material.EMERALD, 12, 70.0),
            new Wanted(Material.OAK_LOG, 64, 1.5),
            new Wanted(Material.WHEAT, 64, 1.0),
            new Wanted(Material.CARROT, 64, 1.0),
            new Wanted(Material.PORKCHOP, 32, 3.0),
            new Wanted(Material.LEATHER, 32, 5.0),
            new Wanted(Material.STRING, 48, 3.0),
            new Wanted(Material.GUNPOWDER, 32, 5.0),
            new Wanted(Material.BONE, 48, 2.0),
            new Wanted(Material.ROTTEN_FLESH, 64, 0.5),
            new Wanted(Material.OBSIDIAN, 16, 30.0),
            new Wanted(Material.QUARTZ, 48, 12.0),
            new Wanted(Material.PRISMARINE_SHARD, 24, 9.0),
            new Wanted(Material.BLAZE_ROD, 12, 30.0)
    );

    /** How much more than market the trader pays. */
    private static final double PREMIUM = 2.4;

    private final Nexus nexus;

    /** Ticks since he last moved on. */
    private int settled;

    /** How long he stays in one place: five minutes. */
    private static final int STAY = 300;

    public Trader(Nexus nexus) {
        this.nexus = nexus;
    }

    /**
     * He actually wanders now.
     *
     * He was called the Wandering Trader and stood in one spot forever, which
     * is the sort of small dishonesty that makes a server feel like a menu.
     * Every few minutes he picks a different bit of the lobby, disappears in a
     * puff, and turns up there - which also means people have to look for him,
     * and looking for something is more interesting than walking to it.
     *
     * He announces the move rather than doing it silently, because a merchant
     * nobody can find is not a feature.
     */
    public void tick() {
        if (++settled < STAY) return;
        settled = 0;

        var hub = nexus.hub().world();
        var spots = nexus.settings().npcsAt("trader", hub);

        // Only wanders between places somebody has put him. One spot means
        // whoever set the lobby up wanted him there, and moving him anyway
        // would be overruling them.
        if (spots.size() < 2) return;

        var here = nexus.settings().npcAt("trader", hub, null);
        var next = spots.get(new java.util.Random().nextInt(spots.size()));

        if (here != null && next.distanceSquared(here) < 1) return;

        // Reordered so the chosen one is first, which is what npcAt reads.
        nexus.settings().setNpc("trader", next);
        for (var spot : spots) {
            if (spot.distanceSquared(next) > 1) nexus.settings().addNpc("trader", spot);
        }

        nexus.hub().placeNpcs();

        hub.spawnParticle(org.bukkit.Particle.POOF, next.clone().add(0, 1, 0),
                30, 0.4, 0.6, 0.4, 0.02);

        for (var player : hub.getPlayers()) {
            player.sendMessage(Text.says("The trader has moved on."));
            player.playSound(player, org.bukkit.Sound.ENTITY_WANDERING_TRADER_DISAPPEARED, 0.6f, 1f);
        }
    }

    private static int today() {
        return (int) LocalDate.now(ZoneId.systemDefault()).toEpochDay();
    }

    /**
     * Today's three, the same for everybody.
     *
     * Shared rather than per player on purpose — a deal everybody has is
     * something people talk about and trade toward, and one that is yours alone
     * is just a number on a screen.
     */
    private List<Wanted> todaysDeals() {
        int seed = today();

        int first = Math.floorMod(seed * 31, POOL.size());
        int second = Math.floorMod(seed * 17 + 7, POOL.size());
        int third = Math.floorMod(seed * 13 + 19, POOL.size());

        if (second == first) second = (second + 1) % POOL.size();
        if (third == first || third == second) third = (third + 2) % POOL.size();
        if (third == first || third == second) third = (third + 1) % POOL.size();

        return List.of(POOL.get(first), POOL.get(second), POOL.get(third));
    }

    private static double pays(Wanted wanted) {
        return Math.round(wanted.many() * wanted.each() * PREMIUM);
    }

    /* ---------------------------------------------------------------- menu */

    public void open(Player player) {
        Inventory menu = Bukkit.createInventory(null, 27, TITLE);

        List<Wanted> deals = todaysDeals();
        Stats.Record record = nexus.stats().of(player.getUniqueId());
        boolean freshDay = record.tradeDay != today();

        for (int i = 0; i < deals.size(); i++) {
            Wanted deal = deals.get(i);
            boolean taken = !freshDay && (record.tradesDone & (1 << i)) != 0;
            int carrying = count(player, deal.item());

            ItemStack item = new ItemStack(deal.item(), Math.min(64, deal.many()));
            int index = i;

            item.editMeta(meta -> {
                meta.displayName(Text.item(deal.many() + "x "
                                + deal.item().name().toLowerCase().replace('_', ' '),
                        taken ? NamedTextColor.DARK_GRAY
                                : carrying >= deal.many() ? NamedTextColor.GREEN
                                : NamedTextColor.RED));

                List<Component> lore = new ArrayList<>();
                if (taken) {
                    lore.add(Text.item("Done today. Back tomorrow.", NamedTextColor.GRAY));
                } else {
                    lore.add(Text.item("Pays " + Stats.cash(pays(deal)), NamedTextColor.GOLD));
                    lore.add(Text.item("About " + Math.round((PREMIUM - 1) * 100)
                            + "% over the shop", NamedTextColor.DARK_GRAY));
                    lore.add(Component.empty());
                    lore.add(Text.item("You have " + carrying,
                            carrying >= deal.many() ? NamedTextColor.WHITE : NamedTextColor.GRAY));
                    lore.add(Text.item(carrying >= deal.many()
                                    ? "Click to sell" : "Bring more",
                            carrying >= deal.many()
                                    ? NamedTextColor.YELLOW : NamedTextColor.DARK_GRAY));
                }
                meta.lore(lore);
            });

            menu.setItem(11 + index * 2, item);
        }

        player.openInventory(menu);
    }

    public void clicked(Player player, int slot) {
        int index = (slot - 11) / 2;
        if (slot < 11 || (slot - 11) % 2 != 0 || index < 0 || index > 2) return;

        List<Wanted> deals = todaysDeals();
        Wanted deal = deals.get(index);

        Stats.Record record = nexus.stats().of(player.getUniqueId());

        // A new day clears the whole set at the moment it is first looked at,
        // rather than needing something to run at midnight.
        if (record.tradeDay != today()) {
            record.tradeDay = today();
            record.tradesDone = 0;
        }

        if ((record.tradesDone & (1 << index)) != 0) {
            player.sendMessage(Text.says("You have done that one today."));
            return;
        }

        if (count(player, deal.item()) < deal.many()) {
            player.sendMessage(Text.bad("You need " + deal.many() + " of those."));
            player.playSound(player, Sound.ENTITY_VILLAGER_NO, 1f, 1f);
            return;
        }

        take(player, deal.item(), deal.many());

        double paid = pays(deal);
        nexus.stats().pay(player.getUniqueId(), paid);
        record.tradesDone |= (1 << index);

        player.sendMessage(Text.good("Sold " + deal.many() + " for " + Stats.cash(paid) + "."));
        player.playSound(player, Sound.ENTITY_VILLAGER_YES, 1f, 1f);

        if (record.tradesDone == 0b111) {
            nexus.crates().give(player, Crates.Tier.COMMON, 1);
            player.sendMessage(Text.good("All three deals done. Have a key."));
        }

        open(player);
    }

    private int count(Player player, Material material) {
        int total = 0;
        for (ItemStack stack : player.getInventory().getStorageContents()) {
            if (stack != null && stack.getType() == material) total += stack.getAmount();
        }
        return total;
    }

    private void take(Player player, Material material, int amount) {
        int left = amount;
        ItemStack[] contents = player.getInventory().getStorageContents();

        for (int i = 0; i < contents.length && left > 0; i++) {
            ItemStack stack = contents[i];
            if (stack == null || stack.getType() != material) continue;

            int taken = Math.min(left, stack.getAmount());
            stack.setAmount(stack.getAmount() - taken);
            left -= taken;

            if (stack.getAmount() <= 0) player.getInventory().setItem(i, null);
        }
        player.updateInventory();
    }

    /** The deals, in chat, for a hologram or somebody who asks. */
    public void show(Player player) {
        player.sendMessage(Text.heading("Today's Deals"));

        for (Wanted deal : todaysDeals()) {
            player.sendMessage(Text.field(
                    deal.many() + "x " + deal.item().name().toLowerCase().replace('_', ' '),
                    Stats.cash(pays(deal))));
        }
        player.sendMessage(Text.plain("  Changes at midnight. All three pays a key."));
    }

    public UUID nobody() {
        return null;
    }
}
