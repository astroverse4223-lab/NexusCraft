package dev.nexuscraft.nexus;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.title.Title;
import org.bukkit.Sound;
import org.bukkit.entity.Player;

import java.time.Duration;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Starting again, on purpose.
 *
 * Every server with an economy has the same ending: the people who were there
 * first have everything, nothing anybody does matters next to that, and new
 * players stop staying. It is not a bug in the economy, it is what an economy
 * with no sink does over time.
 *
 * Two answers here, and they are different.
 *
 * Prestige is voluntary. A player who has enough gives it all up for a number
 * beside their name and a permanent multiplier, which turns "I have finished
 * this" into "I am doing it again, faster". It costs the server nothing and
 * removes a great deal of money.
 *
 * A season is not voluntary and is not for the operator to do casually - it
 * wipes balances and progress for everybody and starts the leaderboard over.
 * What survives is deliberately only the things that are records of what
 * happened: prestige, achievements, cosmetics, skins and pets. Somebody who
 * played hard last season should still look like it.
 */
public final class Seasons {

    /** What each prestige is worth, as a share added to everything paid. */
    private static final double PER_PRESTIGE = 0.05;

    /** The most prestiges anybody can have, so the multiplier stays sane. */
    private static final int MOST = 10;

    /** What it costs to prestige the first time. Each one costs more. */
    private static final double FIRST_COST = 1_000_000;

    private final Nexus nexus;

    public Seasons(Nexus nexus) {
        this.nexus = nexus;
    }

    public int season() {
        return nexus.getConfig().getInt("season", 1);
    }

    /* ---------------------------------------------------------- the clock */

    /**
     * A season that never ends is not a season.
     *
     * Ending one was a command somebody had to remember to run, which means it
     * happened when an operator felt like it or never - and a leaderboard with
     * no finish is just a list. A start date and a length make it a thing
     * players can count down to and plan around.
     */
    private static final int DEFAULT_WEEKS = 6;

    /** When this season began, set the first time anybody asks. */
    public long startedAt() {
        long stored = nexus.getConfig().getLong("seasonStartedAt", 0L);

        if (stored <= 0L) {
            stored = System.currentTimeMillis();
            nexus.getConfig().set("seasonStartedAt", stored);
            nexus.saveConfig();
        }

        return stored;
    }

    public int weeks() {
        return Math.max(1, nexus.getConfig().getInt("seasonWeeks", DEFAULT_WEEKS));
    }

    public long endsAt() {
        return startedAt() + weeks() * 7L * 24L * 60L * 60L * 1000L;
    }

    public long secondsLeft() {
        return Math.max(0L, (endsAt() - System.currentTimeMillis()) / 1000L);
    }

    /** How long is left, in words somebody would use. */
    public String remaining() {
        long left = secondsLeft();

        long days = left / 86400;
        long hours = (left % 86400) / 3600;
        long minutes = (left % 3600) / 60;

        if (days > 0) return days + "d " + hours + "h";
        if (hours > 0) return hours + "h " + minutes + "m";
        return minutes + "m";
    }

    /** Which warnings have been given, so each is given once. */
    private final java.util.Set<Long> warned = new java.util.HashSet<>();

    /** The marks worth saying something at, in seconds. */
    private static final long[] WARN_AT = { 7 * 86400L, 86400L, 3600L, 600L, 60L };

    /**
     * Once a minute: warn as it closes, and end it when it is over.
     *
     * Nobody has to run anything, which is the point - the season ends whether
     * or not an operator is awake.
     */
    public void tick() {
        long left = secondsLeft();

        if (left <= 0L) {
            endSeason(nexus.getServer().getConsoleSender());
            return;
        }

        for (long mark : WARN_AT) {
            if (left > mark || warned.contains(mark)) continue;

            warned.add(mark);
            nexus.feed().say(Feed.Weight.BIG,
                    "Season " + season() + " ends in " + remaining() + ".");
            break;
        }
    }

    /** What the next prestige costs somebody. */
    public double costFor(int prestige) {
        return FIRST_COST * (prestige + 1);
    }

    /** The bonus somebody's prestige is worth, as a multiplier. */
    public double bonusFor(UUID who) {
        return 1.0 + PER_PRESTIGE * nexus.stats().of(who).prestige;
    }

    /* ------------------------------------------------------------- prestige */

    public void show(Player player) {
        Stats.Record record = nexus.stats().of(player.getUniqueId());
        double cost = costFor(record.prestige);

        player.sendMessage(Text.heading("Prestige"));
        player.sendMessage(Text.field("Season", season() + ", ends in " + remaining()));

        if (!record.trophies.isEmpty()) {
            player.sendMessage(Text.field("Won", String.join(", ", record.trophies)));
        }
        player.sendMessage(Text.field("Yours", record.prestige + " of " + MOST));
        player.sendMessage(Text.field("Earning",
                Math.round((bonusFor(player.getUniqueId()) - 1) * 100) + "% extra"));

        if (record.prestige >= MOST) {
            player.sendMessage(Text.good("  You have all of them. Nothing left to buy."));
            return;
        }

        player.sendMessage(Text.field("Next one", Stats.cash(cost)));
        player.sendMessage(Component.empty());
        player.sendMessage(Text.plain("  It takes your money, your prison rank and"));
        player.sendMessage(Text.plain("  your job levels. It keeps everything else."));
        player.sendMessage(Text.plain("  /prestige confirm"));
    }

    /**
     * Gives everything up for a permanent multiplier.
     *
     * Confirmed by typing the word rather than by clicking a menu, deliberately.
     * This is the one action here that destroys somebody's own progress on
     * purpose, and it should be impossible to do by misclicking.
     */
    public void prestige(Player player) {
        Stats.Record record = nexus.stats().of(player.getUniqueId());

        if (record.prestige >= MOST) {
            player.sendMessage(Text.bad("You already have all " + MOST + "."));
            return;
        }

        double cost = costFor(record.prestige);
        if (record.money < cost) {
            player.sendMessage(Text.bad("That costs " + Stats.cash(cost)
                    + ". You have " + Stats.cash(record.money) + "."));
            return;
        }

        record.prestige++;

        // What goes. Deliberately the things that can be earned again.
        record.money = 0;
        record.prisonRank = 0;
        record.jobLevel = 1;
        record.jobExperience = 0;
        record.jobLevels.clear();
        record.jobExperiences.clear();

        nexus.stats().save();

        player.showTitle(Title.title(
                Component.text("PRESTIGE " + record.prestige, NamedTextColor.LIGHT_PURPLE),
                Component.text("+" + Math.round(record.prestige * PER_PRESTIGE * 100)
                        + "% on everything", NamedTextColor.GREEN),
                Title.Times.times(Duration.ofMillis(400), Duration.ofSeconds(4),
                        Duration.ofMillis(800))));

        player.playSound(player, Sound.UI_TOAST_CHALLENGE_COMPLETE, 1f, 0.8f);

        nexus.getServer().broadcast(Component.text(player.getName(), NamedTextColor.WHITE)
                .append(Component.text(" has prestiged to ", NamedTextColor.GRAY))
                .append(Component.text(String.valueOf(record.prestige),
                        NamedTextColor.LIGHT_PURPLE)));

        nexus.discord().event(player.getName() + " prestiged to " + record.prestige);
    }

    /* --------------------------------------------------------------- season */

    /** Who did best this season, before it is wiped. */
    public void standings(org.bukkit.command.CommandSender asker) {
        List<Map.Entry<UUID, Stats.Record>> all =
                new ArrayList<>(nexus.stats().everybody().entrySet());

        all.sort(Comparator.comparingDouble(
                (Map.Entry<UUID, Stats.Record> e) -> e.getValue().money).reversed());

        asker.sendMessage(Text.heading("Season " + season()));

        int shown = 0;
        for (Map.Entry<UUID, Stats.Record> entry : all) {
            if (++shown > 10) break;

            String name = nexus.getServer().getOfflinePlayer(entry.getKey()).getName();
            Stats.Record record = entry.getValue();

            asker.sendMessage(Component.text("  " + shown + ".  ", NamedTextColor.DARK_GRAY)
                    .append(Component.text(name == null ? "somebody" : name,
                            NamedTextColor.WHITE))
                    .append(Component.text("   " + Stats.cash(record.money),
                            NamedTextColor.GOLD))
                    .append(Component.text(record.prestige > 0
                                    ? "   prestige " + record.prestige : "",
                            NamedTextColor.LIGHT_PURPLE)));
        }
    }

    /**
     * Ends the season and starts the next one.
     *
     * Everything that can be earned again is reset; everything that is a record
     * of what somebody did is kept. The distinction is the whole design: a
     * season that wipes achievements is one nobody wants to live through twice.
     *
     * Announced loudly and irreversibly. There is no undo, which is why the
     * command needs the word confirm and the season number typed out.
     */
    /**
     * Who topped what, written down before any of it is deleted.
     *
     * Has to run before the wipe: every number it reads is about to be set to
     * zero, and a trophy handed out afterwards would be for a leaderboard of
     * nothing.
     */
    private void awardTrophies(int ending) {
        record(ending, "Richest", java.util.Comparator.comparingDouble(r -> r.money));
        record(ending, "Deepest Miner", java.util.Comparator.comparingInt(r -> r.blocksMined));
        record(ending, "Best Digger", java.util.Comparator.comparingInt(r -> r.blocksDug));
        record(ending, "Most Wins", java.util.Comparator.comparingInt(r -> r.wins));
        record(ending, "Longest Played", java.util.Comparator.comparingInt(r -> r.minutesPlayed));
    }

    /** The one person at the top of a board, if anybody is actually on it. */
    private void record(int season, String title,
            java.util.Comparator<Stats.Record> by) {

        java.util.Map.Entry<UUID, Stats.Record> best = null;

        for (java.util.Map.Entry<UUID, Stats.Record> entry
                : nexus.stats().everybody().entrySet()) {
            if (best == null || by.compare(entry.getValue(), best.getValue()) > 0) best = entry;
        }

        // Nobody wins a board nobody scored on.
        if (best == null || by.compare(best.getValue(), new Stats.Record()) <= 0) return;

        best.getValue().trophies.add("S" + season + " " + title);

        nexus.feed().say(Feed.Weight.BIG,
                String.valueOf(nexus.getServer().getOfflinePlayer(best.getKey()).getName()) + " finished season " + season
                        + " as " + title + ".");
    }

    public void endSeason(org.bukkit.command.CommandSender asker) {
        int ending = season();

        standings(asker);
        awardTrophies(ending);

        for (Stats.Record record : nexus.stats().everybody().values()) {
            record.money = 0;
            record.prisonRank = 0;
            record.blocksMined = 0;
            record.oneBlockBroken = 0;
            record.islandPoints = 0;
            record.islandLevel = 0;
            record.soldValue = 0;
            record.coins = 0;

            record.wins = 0;
            record.losses = 0;
            record.kills = 0;
            record.deaths = 0;
            record.bedsBroken = 0;
            record.gamesPlayed = 0;
            record.streak = 0;
            record.bestStreak = 0;

            record.job = "NONE";
            record.jobLevel = 1;
            record.jobExperience = 0;
            record.jobEarned = 0;
            record.jobLevels.clear();
            record.jobExperiences.clear();

            record.bounty = 0;

            /*
             * Kept: prestige, achievements, cosmetics, skins, pets, ranks.
             *
             * All of them are records of something that happened rather than
             * progress towards something, and taking them away would punish the
             * people who played most for having played.
             */
        }

        /*
         * The clock starts again the moment the old one stops.
         *
         * Cleared warnings too, or the next season would think it had already
         * announced its own last week.
         */
        nexus.getConfig().set("season", ending + 1);
        nexus.getConfig().set("seasonStartedAt", System.currentTimeMillis());
        nexus.saveConfig();
        warned.clear();
        nexus.stats().save();

        nexus.getServer().broadcast(Component.text("Season " + ending + " is over.",
                NamedTextColor.GOLD));
        nexus.getServer().broadcast(Component.text("Season " + (ending + 1)
                + " starts now. Everything is back to zero.", NamedTextColor.GRAY));

        for (Player player : nexus.getServer().getOnlinePlayers()) {
            player.showTitle(Title.title(
                    Component.text("SEASON " + (ending + 1), Text.BRAND),
                    Component.text("Everybody starts again", NamedTextColor.GRAY),
                    Title.Times.times(Duration.ofMillis(400), Duration.ofSeconds(4),
                            Duration.ofMillis(800))));
        }

        nexus.discord().event("Season " + ending + " has ended. Season "
                + (ending + 1) + " starts now.");
    }
}
