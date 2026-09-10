package dev.nexuscraft.nexus;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.Sound;
import org.bukkit.entity.Player;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;

import java.util.List;

/**
 * Put things in, close it, get paid.
 *
 * `/sell all` empties your whole inventory, which is fine when you have come
 * back from the mines with nothing but ore and terrifying when you are carrying
 * anything you care about. People do not use it twice after it eats something.
 *
 * A window you drop things into is the version everybody trusts, because you
 * can see exactly what you are selling before you commit, and closing it is a
 * decision rather than a keystroke.
 *
 * Anything that cannot be sold is handed straight back when the window closes.
 * Refusing to accept it on the way in would be tidier and much more annoying,
 * because "why will it not let me put this in" has no answer on screen.
 */
public final class SellWindow {

    public static final Component TITLE =
            Component.text("Sell", NamedTextColor.DARK_GRAY);

    private SellWindow() {
    }

    public static void open(Player player) {
        Inventory menu = Bukkit.createInventory(null, 54, TITLE);

        // The bottom row explains itself, because an empty chest with no
        // instructions is a chest people put things in and lose.
        ItemStack note = new ItemStack(Material.PAPER);
        note.editMeta(meta -> {
            meta.displayName(Text.item("Drop things in here", NamedTextColor.YELLOW));
            meta.lore(List.of(
                    Text.item("Close the window to sell them.", NamedTextColor.GRAY),
                    Text.item("Anything I cannot buy comes back.", NamedTextColor.GRAY),
                    Component.empty(),
                    Text.item("/sell prices for the list", NamedTextColor.DARK_GRAY)));
        });
        menu.setItem(53, note);

        player.openInventory(menu);
    }

    /**
     * Pays for what was left in the window.
     *
     * Called from the close handler, which is the only moment the contents are
     * final. Everything sellable is counted and paid for; everything else goes
     * back to the player, and anything that will not fit is dropped at their
     * feet rather than deleted.
     */
    public static void settle(Nexus nexus, Player player, Inventory menu) {
        double earned = 0;
        int sold = 0;

        for (int slot = 0; slot < menu.getSize(); slot++) {
            ItemStack stack = menu.getItem(slot);
            if (stack == null || stack.getType() == Material.AIR) continue;

            // The instruction card is furniture, not stock.
            if (slot == 53 && stack.getType() == Material.PAPER) continue;

            double each = Shops.priceOf(stack.getType());
            if (each <= 0) {
                for (ItemStack spare : player.getInventory().addItem(stack).values()) {
                    player.getWorld().dropItemNaturally(player.getLocation(), spare);
                }
                continue;
            }

            earned += each * stack.getAmount();
            sold += stack.getAmount();
        }

        menu.clear();

        if (sold == 0) {
            player.sendMessage(Text.says("Nothing there I can buy."));
            return;
        }

        nexus.stats().pay(player.getUniqueId(), earned);
        nexus.stats().of(player.getUniqueId()).soldValue += earned;
        nexus.quests().check(player);

        player.sendMessage(Text.good("Sold " + sold + " for " + Stats.cash(earned) + "."));
        player.sendMessage(Text.plain("  Balance: "
                + Stats.cash(nexus.stats().moneyOf(player.getUniqueId()))));
        player.playSound(player, Sound.ENTITY_EXPERIENCE_ORB_PICKUP, 1f, 1.2f);
    }
}
