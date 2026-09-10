package dev.nexuscraft.nexus;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextDecoration;
import net.kyori.adventure.title.Title;
import org.bukkit.Sound;
import org.bukkit.entity.Player;

import java.time.Duration;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Reasons to come back, and reasons to stay.
 *
 * These are the two oldest retention mechanics there are and they work for
 * different reasons. The daily gift works because of the streak — the reward
 * itself is beside the point, and what brings somebody back on day four is not
 * wanting to lose days one to three. The playtime payout works because it turns
 * time already spent into something visible, which makes a quiet evening on a
 * small server feel like it counted.
 *
 * Both are deliberately modest. A daily gift big enough to matter economically
 * is a reason to log in and immediately log out, which is the opposite of the
 * point.
 */
public final class Rewards {

    /** How often the playtime payout lands. */
    private static final int PAYOUT_MINUTES = 20;

    private static final double PAYOUT_MONEY = 350;

    /** Streak past this stops growing, so day 400 is not absurd. */
    private static final int STREAK_CAP = 30;

    private final Nexus nexus;

    /** Minutes each online player has been counted for, since they joined. */
    private final Map<UUID, Integer> minutes = new HashMap<>();

    /** Ticks, so the once-a-minute work does not run once a second. */
    private int ticks;

    public Rewards(Nexus nexus) {
        this.nexus = nexus;
    }

    /* ------------------------------------------------------------- daily */

    /** Days since the epoch, in the server's own timezone. */
    private static int today() {
        return (int) LocalDate.now(ZoneId.systemDefault()).toEpochDay();
    }

    public boolean canClaim(UUID who) {
        return nexus.stats().of(who).lastDailyDay < today();
    }

    /**
     * The daily gift.
     *
     * The streak is the mechanism. Missing a day resets it to one, and that
     * threat is worth more than anything in the reward — which is why the day
     * count is shown prominently and the money is not.
     */
    public void claim(Player player) {
        Stats.Record record = nexus.stats().of(player.getUniqueId());
        int now = today();

        if (record.lastDailyDay >= now) {
            player.sendMessage(Text.says("You have had today's. Come back tomorrow."));
            return;
        }

        // Consecutive only if yesterday was the last one.
        record.dailyStreak = record.lastDailyDay == now - 1
                ? Math.min(STREAK_CAP, record.dailyStreak + 1)
                : 1;
        record.lastDailyDay = now;

        double money = 500 + record.dailyStreak * 250.0;
        nexus.stats().pay(player.getUniqueId(), money);

        /*
         * Keys on a schedule rather than at random.
         *
         * A rare key every seventh day and a legendary every thirtieth gives
         * the streak two places to be aiming at. Random rewards on a streak
         * make the streak feel unrewarded exactly when it is longest.
         */
        Crates.Tier tier = record.dailyStreak % 30 == 0 ? Crates.Tier.LEGENDARY
                : record.dailyStreak % 7 == 0 ? Crates.Tier.RARE
                : Crates.Tier.COMMON;
        nexus.crates().give(player, tier, 1);

        player.showTitle(Title.title(
                Component.text("DAY " + record.dailyStreak, NamedTextColor.GOLD, TextDecoration.BOLD),
                Component.text("+" + Stats.cash(money), NamedTextColor.GREEN),
                Title.Times.times(Duration.ofMillis(200), Duration.ofSeconds(3), Duration.ofMillis(500))));
        player.playSound(player, Sound.UI_TOAST_CHALLENGE_COMPLETE, 1f, 1f);

        player.sendMessage(Text.heading("Daily Reward"));
        player.sendMessage(Text.field("Streak", record.dailyStreak + " day"
                + (record.dailyStreak == 1 ? "" : "s")));
        player.sendMessage(Text.field("Money", Stats.cash(money)));

        int toRare = 7 - (record.dailyStreak % 7);
        if (toRare < 7) {
            player.sendMessage(Text.plain("  " + toRare + " more day"
                    + (toRare == 1 ? "" : "s") + " for a Rare Key."));
        }
    }

    /** Told to them on join, if there is one waiting. */
    public void remind(Player player) {
        if (!canClaim(player.getUniqueId())) return;

        player.sendMessage(Component.text("  Your daily reward is waiting.  ", NamedTextColor.GRAY)
                .append(Component.text("/daily", Text.BRAND, TextDecoration.BOLD)));
    }

    /* ---------------------------------------------------------- playtime */

    /**
     * Once a minute, counting everybody who is actually here.
     *
     * "Actually" is doing work: somebody who has not moved in ten minutes is a
     * client left running, and paying them is paying an AFK machine. Checking
     * that they have moved is the cheapest test that is not trivially defeated
     * by standing on a pressure plate, and this is a friends server rather than
     * an arms race.
     */
    public void tick() {
        if (++ticks % 60 != 0) return;

        for (Player player : nexus.getServer().getOnlinePlayers()) {
            UUID who = player.getUniqueId();

            /*
             * Away means the clock stops, rather than paying and hoping.
             *
             * This is the whole point of tracking it: three hundred and fifty
             * every twenty minutes, paid to a client somebody left running, is
             * an economy anybody can print.
             */
            if (nexus.afk().isAway(who)) continue;

            int had = minutes.merge(who, 1, Integer::sum);
            if (had < PAYOUT_MINUTES) continue;

            minutes.put(who, 0);
            payout(player);
        }
    }

    private void payout(Player player) {
        Stats.Record record = nexus.stats().of(player.getUniqueId());
        record.minutesPlayed += PAYOUT_MINUTES;

        nexus.stats().pay(player.getUniqueId(), PAYOUT_MONEY);

        player.sendMessage(Text.says("Twenty minutes on the server. ")
                .append(Component.text("+" + Stats.cash(PAYOUT_MONEY), NamedTextColor.GREEN)));
        player.playSound(player, Sound.ENTITY_EXPERIENCE_ORB_PICKUP, 0.6f, 1.4f);

        // An hour of play is worth a key, which is what stops the payout being
        // just a number that goes up.
        if (record.minutesPlayed % 60 == 0) {
            nexus.crates().give(player, Crates.Tier.COMMON, 1);
        }
    }

    public void forget(Player player) {
        minutes.remove(player.getUniqueId());
    }

    public int minutesToward(UUID who) {
        return minutes.getOrDefault(who, 0);
    }

    public static int payoutMinutes() {
        return PAYOUT_MINUTES;
    }
}
