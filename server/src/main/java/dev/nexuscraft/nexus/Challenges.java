package dev.nexuscraft.nexus;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.event.ClickEvent;
import net.kyori.adventure.text.event.HoverEvent;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Material;
import org.bukkit.Sound;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;

import java.util.Locale;
import java.util.UUID;

/**
 * A list of things worth doing next.
 *
 * A fresh skyblock island is a dirt block and a tree in an empty sky, and the
 * commonest way for somebody to stop playing is not knowing what they are
 * supposed to do with it. Quests elsewhere on the server are daily and random;
 * these are a ladder, in order, and they say out loud what the island is for.
 *
 * The cost is taken from the inventory and the reward given back, so a
 * challenge is a trade rather than a tickbox - you have to actually have the
 * thing, and you have to be willing to hand it over.
 */
public final class Challenges {

    /**
     * One rung.
     *
     * `wants` is taken; `gives` is handed back, along with the money. Ordered
     * as they are listed, and each becomes visible once the one before it is
     * done - a list of forty things to do is its own kind of blank sky.
     */
    private record Challenge(String id, String name, String blurb,
                             Material wants, int amount,
                             double money, Material gives, int giveAmount) {
    }

    private static final Challenge[] LADDER = {
            new Challenge("cobble", "A start", "Hand over 64 cobblestone",
                    Material.COBBLESTONE, 64, 250, Material.OAK_SAPLING, 2),

            new Challenge("logs", "Something to build with", "Hand over 32 oak logs",
                    Material.OAK_LOG, 32, 500, Material.SHEEP_SPAWN_EGG, 2),

            new Challenge("iron", "The first iron", "Hand over 16 iron ingots",
                    Material.IRON_INGOT, 16, 1_200, Material.HOPPER, 1),

            /*
             * Two of each animal, never one.
             *
             * Passive mobs do spawn on a lit grass island, but slowly and only
             * where there is room - on a starter island that can be a very long
             * wait. These make a herd possible rather than likely, and one of
             * anything is a dead end: you cannot breed a single cow.
             */
            new Challenge("wheat", "Farming", "Hand over 64 wheat",
                    Material.WHEAT, 64, 900, Material.COW_SPAWN_EGG, 2),

            new Challenge("stone", "Digging in", "Hand over 128 stone",
                    Material.STONE, 128, 1_500, Material.CHICKEN_SPAWN_EGG, 2),

            new Challenge("coal", "Fuel", "Hand over 64 coal",
                    Material.COAL, 64, 1_800, Material.LAVA_BUCKET, 1),

            new Challenge("gold", "Shiny", "Hand over 16 gold ingots",
                    Material.GOLD_INGOT, 16, 4_000, Material.GOLDEN_APPLE, 2),

            new Challenge("redstone", "Wiring", "Hand over 64 redstone",
                    Material.REDSTONE, 64, 3_500, Material.PISTON, 4),

            new Challenge("diamond", "The real thing", "Hand over 8 diamonds",
                    Material.DIAMOND, 8, 12_000, Material.DIAMOND_PICKAXE, 1),

            new Challenge("emerald", "Rich", "Hand over 16 emeralds",
                    Material.EMERALD, 16, 25_000, Material.ENCHANTED_GOLDEN_APPLE, 1),
    };

    /**
     * The one a player could actually hand in, for tab.
     *
     * Only the next unfinished rung, not all ten: suggesting a challenge that
     * is already done, or one four steps ahead, is a suggestion that produces
     * an error message.
     */
    public java.util.List<String> claimable(UUID who) {
        for (Challenge challenge : LADDER) {
            if (!nexus.stats().of(who).challengesDone.contains(challenge.id())) {
                return java.util.List.of(challenge.id());
            }
        }
        return java.util.List.of();
    }

    private final Nexus nexus;

    public Challenges(Nexus nexus) {
        this.nexus = nexus;
    }

    private boolean done(UUID who, String id) {
        return nexus.stats().of(who).challengesDone.contains(id);
    }

    /* ----------------------------------------------------------------- list */

    public void show(Player player) {
        UUID who = player.getUniqueId();

        player.sendMessage(Text.heading("Island challenges"));

        int completed = 0;
        boolean shownNext = false;

        for (Challenge challenge : LADDER) {
            if (done(who, challenge.id())) {
                completed++;
                player.sendMessage(Component.text("  " + challenge.name(), NamedTextColor.DARK_GRAY)
                        .append(Component.text("  done", NamedTextColor.DARK_GREEN)));
                continue;
            }

            /*
             * Only the next one, and nothing beyond it.
             *
             * A list of everything at once is the same problem as an empty sky:
             * too much to look at and no obvious place to start.
             */
            if (shownNext) continue;
            shownNext = true;

            int have = count(player, challenge.wants());
            boolean ready = have >= challenge.amount();

            player.sendMessage(Component.text("  " + challenge.name(), Text.BRAND)
                    .append(Component.text("  " + challenge.blurb(), NamedTextColor.GRAY)));

            player.sendMessage(Component.text("    " + have + " of " + challenge.amount(),
                            ready ? NamedTextColor.GREEN : NamedTextColor.DARK_GRAY)
                    .append(Component.text("   pays " + Stats.cash(challenge.money())
                            + " and " + challenge.giveAmount() + " x "
                            + pretty(challenge.gives()), NamedTextColor.GRAY)));

            if (ready) {
                player.sendMessage(Component.text("    Click to hand it in", NamedTextColor.GREEN)
                        .clickEvent(ClickEvent.runCommand("/challenges claim " + challenge.id()))
                        .hoverEvent(HoverEvent.showText(
                                Component.text("Takes the items, gives the reward",
                                        NamedTextColor.GRAY))));
            }
        }

        player.sendMessage(Text.plain("  " + completed + " of " + LADDER.length + " done."));

        if (completed == LADDER.length) {
            player.sendMessage(Text.good("Every one of them. There is nothing left to ask of you."));
        }
    }

    /* ---------------------------------------------------------------- claim */

    public void claim(Player player, String id) {
        UUID who = player.getUniqueId();

        for (Challenge challenge : LADDER) {
            if (!challenge.id().equalsIgnoreCase(id)) continue;

            if (done(who, challenge.id())) {
                player.sendMessage(Text.says("You have already done that one."));
                return;
            }

            int have = count(player, challenge.wants());
            if (have < challenge.amount()) {
                player.sendMessage(Text.bad("That wants " + challenge.amount() + " x "
                        + pretty(challenge.wants()) + " and you have " + have + "."));
                return;
            }

            /*
             * Taken before anything is given.
             *
             * The other order pays out and then discovers the items were not
             * really there, which is a challenge that can be handed in twice.
             */
            player.getInventory().removeItem(new ItemStack(challenge.wants(), challenge.amount()));

            nexus.stats().pay(who, challenge.money());
            nexus.stats().of(who).challengesDone.add(challenge.id());

            ItemStack reward = new ItemStack(challenge.gives(), challenge.giveAmount());
            for (ItemStack spare : player.getInventory().addItem(reward).values()) {
                player.getWorld().dropItemNaturally(player.getLocation(), spare);
            }

            player.sendMessage(Text.good(challenge.name() + " done."));
            player.sendMessage(Text.plain("  " + Stats.cash(challenge.money()) + " and "
                    + challenge.giveAmount() + " x " + pretty(challenge.gives()) + "."));
            player.playSound(player, Sound.UI_TOAST_CHALLENGE_COMPLETE, 1f, 1.2f);

            /*
             * The end of the ladder, which had nothing to mark it.
             *
             * Every rung paid money and handed over an item, including the
             * last one, so finishing the whole thing felt like finishing the
             * ninth. A set of armour nobody can craft is the one reward that
             * says a player got to the end of something.
             */
            if (challenge.id().equals(LADDER[LADDER.length - 1].id())) {
                String set = nexus.armoury().dropSet("ladder");

                if (set != null && nexus.armoury().give(player, set)) {
                    nexus.feed().say(Feed.Weight.BIG, player.getName()
                            + " finished every challenge and earned the "
                            + nexus.armoury().get(set).label() + " set.");
                }
            }

            show(player);
            return;
        }

        player.sendMessage(Text.bad("There is no challenge called that."));
    }

    private static int count(Player player, Material what) {
        int found = 0;
        for (ItemStack stack : player.getInventory().getStorageContents()) {
            if (stack != null && stack.getType() == what) found += stack.getAmount();
        }
        return found;
    }

    private static String pretty(Material what) {
        String words = what.name().toLowerCase(Locale.ROOT).replace('_', ' ');
        return Character.toUpperCase(words.charAt(0)) + words.substring(1);
    }
}
