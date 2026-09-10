package dev.nexuscraft.nexus;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextDecoration;
import org.bukkit.Sound;
import org.bukkit.entity.Player;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.UUID;

/**
 * Three things to do today.
 *
 * Quests solve a problem a sandbox always has: a new player logs in, sees six
 * worlds and a shop, and has no idea what they are supposed to do first. Three
 * concrete tasks answer that better than any amount of explaining, and they
 * give somebody who has already done everything a reason to open the game.
 *
 * Deliberately three, deliberately daily, and deliberately achievable in an
 * evening. A quest list that cannot be finished is a chore list.
 *
 * The tasks are the things the server already counts, which is the whole trick
 * — nothing here needs new bookkeeping, it reads numbers that were being kept
 * anyway.
 */
public final class Quests {

    /** What a quest asks for. */
    public enum Task {
        MINE("Mine %d blocks", 200, 1_200),
        SELL("Earn %s from selling", 2_500, 1_500),
        WIN("Win %d minigames", 2, 2_000),
        BREAK_ONE_BLOCK("Break %d blocks in One Block", 150, 1_400),
        PLAY("Spend %d minutes on the server", 40, 900);

        public final String wording;
        public final int target;
        public final int pays;

        Task(String wording, int target, int pays) {
            this.wording = wording;
            this.target = target;
            this.pays = pays;
        }

        public String describe() {
            return this == SELL
                    ? String.format(wording, Stats.cash(target))
                    : String.format(wording, target);
        }
    }

    private final Nexus nexus;

    public Quests(Nexus nexus) {
        this.nexus = nexus;
    }

    private static int today() {
        return (int) LocalDate.now(ZoneId.systemDefault()).toEpochDay();
    }

    /**
     * Today's three, chosen from the day and the player.
     *
     * Derived rather than rolled and stored: the same player gets the same
     * three all day whatever happens to the server, everybody's differ, and
     * nothing has to be saved or reset at midnight. A stored list would need a
     * rollover job, and a rollover job is a thing that fails while you sleep.
     */
    public List<Task> today(UUID who) {
        Task[] all = Task.values();
        int seed = today() * 31 + who.hashCode();

        int first = Math.floorMod(seed, all.length);
        int second = Math.floorMod(seed / 7 + 1, all.length);
        int third = Math.floorMod(seed / 13 + 2, all.length);

        // Nudged apart rather than reshuffled, so three different ones come out
        // without a loop that can spin.
        if (second == first) second = (second + 1) % all.length;
        if (third == first || third == second) third = (third + 2) % all.length;
        if (third == first || third == second) third = (third + 1) % all.length;

        return List.of(all[first], all[second], all[third]);
    }

    /** How far along they are, against what the server already counts. */
    public int progress(UUID who, Task task) {
        Stats.Record record = nexus.stats().of(who);

        return switch (task) {
            case MINE -> record.blocksMined - record.questBaseMined;
            case SELL -> (int) (record.soldValue - record.questBaseSold);
            case WIN -> record.wins - record.questBaseWins;
            case BREAK_ONE_BLOCK -> record.oneBlockBroken - record.questBaseOneBlock;
            case PLAY -> record.minutesPlayed - record.questBaseMinutes;
        };
    }

    /**
     * Resets the baselines at the start of a new day.
     *
     * Progress is "how much since this morning", measured against a snapshot
     * taken the first time they are seen each day. Counting from zero would
     * need per-quest counters that have to be cleared, and clearing things on a
     * timer is where daily systems break.
     */
    public void newDayIfNeeded(Player player) {
        Stats.Record record = nexus.stats().of(player.getUniqueId());
        if (record.questDay == today()) return;

        record.questDay = today();
        record.questBaseMined = record.blocksMined;
        record.questBaseSold = record.soldValue;
        record.questBaseWins = record.wins;
        record.questBaseOneBlock = record.oneBlockBroken;
        record.questBaseMinutes = record.minutesPlayed;
        record.questsDone = 0;
    }

    /**
     * Called whenever a counted thing happens. Pays for anything just finished.
     *
     * Checked on the event rather than on a timer so the reward lands on the
     * block that finished it, which is the difference between a quest system
     * and a list you have to remember to go and look at.
     */
    public void check(Player player) {
        Stats.Record record = nexus.stats().of(player.getUniqueId());
        newDayIfNeeded(player);

        List<Task> tasks = today(player.getUniqueId());

        for (int i = 0; i < tasks.size(); i++) {
            int bit = 1 << i;
            if ((record.questsDone & bit) != 0) continue;

            Task task = tasks.get(i);
            if (progress(player.getUniqueId(), task) < task.target) continue;

            record.questsDone |= bit;
            nexus.stats().pay(player.getUniqueId(), task.pays);

            player.sendMessage(Text.heading("Quest Complete"));
            player.sendMessage(Text.field(task.describe(), "+" + Stats.cash(task.pays)));
            player.playSound(player, Sound.UI_TOAST_CHALLENGE_COMPLETE, 1f, 1.2f);

            // All three is worth a key on top, so the third one is worth doing.
            if (record.questsDone == 0b111) {
                nexus.crates().give(player, Crates.Tier.RARE, 1);
                player.sendMessage(Text.good("All three done. Rare Key."));
            }
        }
    }

    /** The list, as somebody asking for it wants to read it. */
    public void show(Player player) {
        newDayIfNeeded(player);

        Stats.Record record = nexus.stats().of(player.getUniqueId());
        List<Task> tasks = today(player.getUniqueId());

        player.sendMessage(Text.heading("Today"));

        for (int i = 0; i < tasks.size(); i++) {
            Task task = tasks.get(i);
            boolean done = (record.questsDone & (1 << i)) != 0;

            int at = Math.min(task.target, Math.max(0, progress(player.getUniqueId(), task)));

            player.sendMessage(Component.text(done ? "  ✔ " : "  • ",
                            done ? NamedTextColor.GREEN : NamedTextColor.DARK_GRAY)
                    .append(Component.text(task.describe(),
                            done ? NamedTextColor.GRAY : NamedTextColor.WHITE))
                    .append(Component.text(done ? "" : "   " + at + "/" + task.target,
                            NamedTextColor.DARK_GRAY)));
        }

        player.sendMessage(Text.plain("  All three pays a Rare Key."));

        if (nexus.rewards().canClaim(player.getUniqueId())) {
            player.sendMessage(Component.text("  Daily reward waiting:  ", NamedTextColor.GRAY)
                    .append(Component.text("/daily", Text.BRAND, TextDecoration.BOLD)));
        }
    }
}
