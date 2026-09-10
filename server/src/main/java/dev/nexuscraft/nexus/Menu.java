package dev.nexuscraft.nexus;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextDecoration;
import org.bukkit.Material;
import org.bukkit.entity.Player;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;

import java.util.ArrayList;
import java.util.List;

/**
 * Everything the server can do, on one page.
 *
 * There are now more than fifty commands here, which is past the number anybody
 * remembers and well past the number a new player will ever discover. A server
 * where half the features are only reachable by somebody who already knows they
 * exist has, in practice, half the features.
 *
 * Clicking runs the command, so nothing has to be memorised or typed correctly.
 * That matters more than it sounds: the commands people actually lose are the
 * ones they saw once, a week ago, and can only half remember the name of.
 */
public final class Menu {

    public static final Component TITLE = Component.text("Nexus");

    /** One button: what it says, what it runs, and whether it is for staff. */
    private record Entry(Material icon, String name, String blurb,
                         String command, boolean staff) {
    }

    private static Entry item(Material icon, String name, String blurb, String command) {
        return new Entry(icon, name, blurb, command, false);
    }

    /**
     * Laid out by what somebody is trying to do, in rows of nine.
     *
     * Grouped rather than alphabetical because the question people arrive with
     * is "how do I make money", not "what begins with S".
     */
    private static final List<Entry> ENTRIES = List.of(
            // Row one: where to go.
            item(Material.COMPASS, "Games", "queue for anything", "play"),
            item(Material.GRASS_BLOCK, "Survival", "build something", "warp survival"),
            item(Material.IRON_PICKAXE, "Prison", "mine and climb", "warp prison"),
            item(Material.OAK_SAPLING, "Skyblock", "an island and a chest", "warp skyblock"),
            item(Material.MOSS_BLOCK, "One Block", "everything from one block", "warp oneblock"),
            item(Material.BRICKS, "Creative", "no rules", "warp creative"),
            item(Material.RED_BED, "Hub", "back to the lobby", "hub"),
            item(Material.ENDER_PEARL, "Home", "go to a home you set", "home"),
            item(Material.WHITE_BED, "Set Home", "remember this spot", "sethome"),

            // Row two: money.
            item(Material.EMERALD, "Balance", "what you have", "balance"),
            item(Material.CHEST, "Shop", "buy things", "shop"),
            item(Material.HOPPER, "Sell", "sell what you are carrying", "sell all"),
            item(Material.GOLD_INGOT, "Auction", "buy and sell to players", "ah"),
            item(Material.VILLAGER_SPAWN_EGG, "Deals", "today's trades", "deals"),
            item(Material.IRON_AXE, "Jobs", "get paid for what you do", "jobs"),
            item(Material.ENDER_CHEST, "Vault", "what is waiting for you", "vault"),
            item(Material.BUNDLE, "Kits", "a box of things", "kits"),
            item(Material.SUNFLOWER, "Daily", "today's reward", "daily"),

            // Row three: things to chase.
            item(Material.WRITABLE_BOOK, "Quests", "three tasks a day", "quests"),
            item(Material.BOOK, "Achievements", "everything there is to do", "achievements"),
            item(Material.TRIPWIRE_HOOK, "Keys", "what you can open", "keys"),
            item(Material.PLAYER_HEAD, "Stats", "your record", "stats"),
            item(Material.GOLDEN_APPLE, "Leaderboard", "the best here", "leaderboard"),
            item(Material.NETHER_STAR, "Prestige", "start again, for a badge", "prestige"),
            item(Material.WITHER_SKELETON_SKULL, "Bounties", "who has a price", "bounties"),
            item(Material.BONE, "Pets", "something to follow you", "pets"),
            item(Material.LEATHER_CHESTPLATE, "Cosmetics", "trails and hats", "cosmetics"),

            // Row four: land, people and the rest.
            item(Material.OAK_FENCE, "Claim", "this land is yours", "claim"),
            item(Material.MAP, "Your Land", "what you have claimed", "claims"),
            item(Material.LEAD, "Trust", "let a friend build", "trust"),
            item(Material.CAKE, "Party", "play with friends", "party"),
            item(Material.NAME_TAG, "Skins", "change how you look", "skin"),
            item(Material.CLOCK, "Away", "stop the clock", "afk"),
            item(Material.ENCHANTED_BOOK, "Guide", "how this server works", "guide"),

            new Entry(Material.COMMAND_BLOCK, "Operator", "the admin commands",
                    "nexus", true));

    private Menu() {
    }

    public static void open(Nexus nexus, Player player) {
        Inventory page = nexus.getServer().createInventory(null, 54, TITLE);
        boolean staff = player.hasPermission("nexus.admin");

        int slot = 0;
        for (Entry entry : ENTRIES) {
            if (entry.staff() && !staff) continue;
            if (slot >= 54) break;

            ItemStack icon = new ItemStack(entry.icon());
            icon.editMeta(meta -> {
                meta.displayName(Component.text(entry.name(), Text.BRAND)
                        .decoration(TextDecoration.ITALIC, false));

                List<Component> lore = new ArrayList<>();
                lore.add(Text.item(entry.blurb(), NamedTextColor.GRAY));
                lore.add(Component.empty());
                lore.add(Text.item("/" + entry.command(), NamedTextColor.DARK_GRAY));
                meta.lore(lore);
            });

            page.setItem(slot++, icon);
        }

        player.openInventory(page);
    }

    /**
     * Runs whatever was clicked.
     *
     * The window is closed first. A command that opens another menu - which
     * most of these do - cannot open one while this one is still on screen,
     * and the symptom is a click that visibly does nothing at all.
     */
    public static void clicked(Nexus nexus, Player player, int slot) {
        boolean staff = player.hasPermission("nexus.admin");

        List<Entry> showing = new ArrayList<>();
        for (Entry entry : ENTRIES) {
            if (entry.staff() && !staff) continue;
            showing.add(entry);
        }

        if (slot < 0 || slot >= showing.size()) return;
        Entry picked = showing.get(slot);

        player.closeInventory();
        nexus.getServer().getScheduler().runTask(nexus,
                () -> player.performCommand(picked.command()));
    }
}
