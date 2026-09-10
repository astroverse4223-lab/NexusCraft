package dev.nexuscraft.nexus;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.title.Title;
import org.bukkit.Material;
import org.bukkit.Sound;
import org.bukkit.entity.Player;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Predicate;

/**
 * Things worth having done.
 *
 * A server with quests already tells people what to do today. What it does not
 * do is remember what they have done ever, and that is a different feeling
 * entirely: quests reset, so nothing accumulates, and a player logging in on
 * their fortieth day has exactly as much to show for it as one on their first.
 *
 * Every one of these is measured from numbers the server already keeps, which
 * is the reason there are thirty of them rather than five. Nothing here needed
 * new tracking, so the interesting question was only ever which numbers people
 * would actually chase.
 *
 * Nothing is ever taken away. An achievement is a record of what happened, and
 * a record that can go backwards is worth nothing.
 */
public final class Achievements {

    /** One thing, and how to tell whether somebody has done it. */
    private record Feat(String id, String name, String how,
                        Material icon, int coins, double money,
                        Predicate<Stats.Record> done) {
    }

    /**
     * The list, in the order they appear.
     *
     * Grouped by what somebody is doing rather than by difficulty, so the page
     * reads as "here is what there is to do here" rather than as a ladder.
     */
    private static final List<Feat> FEATS = List.of(
            // Money.
            new Feat("first_thousand", "Pocket Money", "hold $1,000",
                    Material.GOLD_NUGGET, 20, 100, r -> r.money >= 1_000),
            new Feat("rich", "Comfortable", "hold $50,000",
                    Material.GOLD_INGOT, 60, 1_000, r -> r.money >= 50_000),
            new Feat("very_rich", "Loaded", "hold $250,000",
                    Material.GOLD_BLOCK, 200, 5_000, r -> r.money >= 250_000),
            new Feat("merchant", "Merchant", "sell $25,000 of goods",
                    Material.EMERALD, 60, 900, r -> r.soldValue >= 25_000),

            // Mining and building.
            new Feat("miner", "Pickaxe Broken In", "mine 1,000 blocks",
                    Material.STONE_PICKAXE, 25, 200, r -> r.blocksMined >= 1_000),
            new Feat("deep", "Down There Somewhere", "mine 25,000 blocks",
                    Material.DIAMOND_PICKAXE, 120, 2_500, r -> r.blocksMined >= 25_000),
            new Feat("oneblock_100", "Standing Start", "break 100 one blocks",
                    Material.GRASS_BLOCK, 25, 200, r -> r.oneBlockBroken >= 100),
            new Feat("oneblock_2500", "Made Something Of It", "break 2,500 one blocks",
                    Material.MOSS_BLOCK, 120, 2_000, r -> r.oneBlockBroken >= 2_500),
            new Feat("island_10", "Island Life", "reach island level 10",
                    Material.OAK_SAPLING, 40, 500, r -> r.islandLevel >= 10),
            new Feat("island_25", "Own Little World", "reach island level 25",
                    Material.CHERRY_SAPLING, 150, 3_000, r -> r.islandLevel >= 25),

            // Prison.
            new Feat("prison_5", "Halfway Out", "reach prison rank 5",
                    Material.IRON_BARS, 50, 600, r -> r.prisonRank >= 5),
            new Feat("prison_free", "Free Man", "finish the last prison rank",
                    Material.LADDER, 250, 6_000, r -> r.prisonRank >= 10),

            // Games.
            new Feat("first_win", "First Blood", "win a game",
                    Material.WOODEN_SWORD, 15, 100, r -> r.wins >= 1),
            new Feat("ten_wins", "Getting Good", "win 10 games",
                    Material.IRON_SWORD, 50, 600, r -> r.wins >= 10),
            new Feat("fifty_wins", "Regular", "win 50 games",
                    Material.DIAMOND_SWORD, 200, 4_000, r -> r.wins >= 50),
            new Feat("streak_5", "On A Run", "win 5 in a row",
                    Material.BLAZE_POWDER, 90, 1_500, r -> r.bestStreak >= 5),
            new Feat("streak_10", "Unbeatable", "win 10 in a row",
                    Material.BLAZE_ROD, 300, 7_500, r -> r.bestStreak >= 10),
            new Feat("kills_50", "Dangerous", "get 50 kills",
                    Material.BOW, 60, 700, r -> r.kills >= 50),
            new Feat("kills_500", "Feared", "get 500 kills",
                    Material.NETHERITE_SWORD, 350, 9_000, r -> r.kills >= 500),
            new Feat("beds_10", "Light Sleeper", "break 10 beds",
                    Material.RED_BED, 70, 900, r -> r.bedsBroken >= 10),
            new Feat("hundred_games", "Committed", "play 100 games",
                    Material.CLOCK, 120, 2_000, r -> r.gamesPlayed >= 100),

            // The other things there are to do.
            new Feat("parkour", "Sure Footed", "finish the parkour course",
                    Material.QUARTZ_STAIRS, 40, 400, r -> r.parkourBest > 0),
            new Feat("parkour_fast", "Quick Feet", "finish parkour in under 90 seconds",
                    Material.FEATHER, 120, 1_800,
                    r -> r.parkourBest > 0 && r.parkourBest < 90),
            new Feat("dropper", "Terminal Velocity", "clear a dropper level",
                    Material.WATER_BUCKET, 40, 400, r -> r.dropperLevels() >= 1),
            new Feat("dropper_all", "No Fear", "clear 5 dropper levels",
                    Material.BUCKET, 150, 2_500, r -> r.dropperLevels() >= 5),
            new Feat("chat_games", "Fast Typer", "win 10 chat games",
                    Material.PAPER, 50, 600, r -> r.chatWins >= 10),

            // Being here.
            new Feat("streak_7", "A Week Of It", "claim 7 daily rewards in a row",
                    Material.SUNFLOWER, 80, 1_200, r -> r.dailyStreak >= 7),
            new Feat("streak_30", "A Month Of It", "claim 30 daily rewards in a row",
                    Material.BEACON, 400, 12_000, r -> r.dailyStreak >= 30),
            new Feat("hours_10", "Settled In", "play for 10 hours",
                    Material.BREAD, 40, 500, r -> r.minutesPlayed >= 600),
            new Feat("hours_100", "Practically Staff", "play for 100 hours",
                    Material.CAKE, 400, 12_000, r -> r.minutesPlayed >= 6_000),
            new Feat("job_10", "Tradesman", "reach job level 10",
                    Material.IRON_AXE, 100, 1_600, r -> r.jobLevel >= 10),
            new Feat("quests_50", "Busy", "finish 50 quests",
                    Material.WRITABLE_BOOK, 150, 2_500, r -> r.questsDone >= 50));

    public static final Component TITLE = Component.text("Achievements");

    private final Nexus nexus;
    private int ticks;

    public Achievements(Nexus nexus) {
        this.nexus = nexus;
    }

    public static int total() {
        return FEATS.size();
    }

    /* -------------------------------------------------------------- earning */

    /**
     * Checks everybody, every few seconds.
     *
     * Polled rather than fired from each event, deliberately. Thirty
     * achievements read from a dozen different counters, and hooking each one
     * at the site that changes it means thirty call sites that all have to be
     * remembered - and the one that gets forgotten is an achievement that
     * simply never awards, with nothing anywhere saying so.
     *
     * The whole check is thirty predicates over a record already in memory, for
     * the handful of people online. That is cheaper than the message it sends.
     */
    public void tick() {
        if (++ticks % 5 != 0) return;

        for (Player player : nexus.getServer().getOnlinePlayers()) {
            check(player);
        }
    }

    public void check(Player player) {
        Stats.Record record = nexus.stats().of(player.getUniqueId());

        for (Feat feat : FEATS) {
            if (record.achievements.contains(feat.id())) continue;
            if (!feat.done().test(record)) continue;

            record.achievements.add(feat.id());
            award(player, feat);
        }
    }

    private void award(Player player, Feat feat) {
        Stats.Record record = nexus.stats().of(player.getUniqueId());
        record.coins += feat.coins();
        nexus.stats().pay(player.getUniqueId(), feat.money());

        player.showTitle(Title.title(
                Component.text(feat.name(), NamedTextColor.GOLD),
                Component.text(feat.how(), NamedTextColor.GRAY),
                Title.Times.times(Duration.ofMillis(300), Duration.ofSeconds(3),
                        Duration.ofMillis(600))));

        player.playSound(player, Sound.UI_TOAST_CHALLENGE_COMPLETE, 1f, 1f);

        player.sendMessage(Text.heading("Achievement"));
        player.sendMessage(Component.text("  " + feat.name(), NamedTextColor.GOLD)
                .append(Component.text("   " + feat.how(), NamedTextColor.DARK_GRAY)));
        player.sendMessage(Text.good("  +" + feat.coins() + " coins, +"
                + Stats.cash(feat.money())));

        /*
         * Announced to the server, because an achievement nobody sees is a
         * number in a menu. The rare ones are the ones worth interrupting
         * everybody for, so only those above a threshold are broadcast.
         */
        if (feat.coins() >= 150) {
            nexus.getServer().broadcast(Component.text(player.getName(), NamedTextColor.WHITE)
                    .append(Component.text(" earned ", NamedTextColor.GRAY))
                    .append(Component.text(feat.name(), NamedTextColor.GOLD)));
        }
    }

    /* -------------------------------------------------------------- showing */

    public void open(Player player) {
        Stats.Record record = nexus.stats().of(player.getUniqueId());

        int earned = 0;
        for (Feat feat : FEATS) if (record.achievements.contains(feat.id())) earned++;

        Inventory page = nexus.getServer().createInventory(null, 54, TITLE);

        int slot = 0;
        for (Feat feat : FEATS) {
            boolean has = record.achievements.contains(feat.id());

            ItemStack icon = new ItemStack(has ? feat.icon() : Material.GRAY_DYE);
            icon.editMeta(meta -> {
                meta.displayName(Component.text(feat.name(),
                                has ? NamedTextColor.GOLD : NamedTextColor.GRAY)
                        .decoration(net.kyori.adventure.text.format.TextDecoration.ITALIC, false));

                List<Component> lore = new ArrayList<>();
                lore.add(Text.item(feat.how(), NamedTextColor.WHITE));
                lore.add(Component.empty());
                lore.add(Text.item(feat.coins() + " coins, "
                        + Stats.cash(feat.money()), NamedTextColor.YELLOW));
                lore.add(Component.empty());
                lore.add(Text.item(has ? "Earned" : "Not yet",
                        has ? NamedTextColor.GREEN : NamedTextColor.DARK_GRAY));

                meta.lore(lore);
            });

            page.setItem(slot++, icon);
            if (slot >= 53) break;
        }

        // The tally, in the last slot rather than the title, so the title stays
        // the constant the click handler matches on.
        ItemStack tally = new ItemStack(Material.BOOK);
        int done = earned;
        tally.editMeta(meta -> {
            meta.displayName(Component.text(done + " of " + FEATS.size(),
                            NamedTextColor.AQUA)
                    .decoration(net.kyori.adventure.text.format.TextDecoration.ITALIC, false));
            meta.lore(List.of(Text.item("Nothing here is ever taken away",
                    NamedTextColor.DARK_GRAY)));
        });
        page.setItem(53, tally);

        player.openInventory(page);
    }

    /** How many somebody has, for the profile and the leaderboard. */
    public int earnedBy(java.util.UUID who) {
        return nexus.stats().of(who).achievements.size();
    }
}
