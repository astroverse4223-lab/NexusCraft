package dev.nexuscraft.nexus;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.event.ClickEvent;
import net.kyori.adventure.text.event.HoverEvent;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Sound;
import org.bukkit.entity.Player;

import java.util.Locale;

/**
 * Something to spend an island level on.
 *
 * The level bar counted up and did nothing. A number that only goes up is a
 * scoreboard, and a scoreboard is a poor reason to keep playing - what makes
 * people carry on is the next thing they are saving for.
 *
 * Three upgrades, each of which changes how the island plays rather than how it
 * scores. Paid for with money, gated on level: money alone would let somebody
 * who made theirs elsewhere skip the whole ladder, and level alone would make
 * them free.
 */
public final class IslandUpgrades {

    public enum Upgrade {
        GENERATOR("Generator", "Better ore from the generator, sooner", 3),
        SIZE("Island size", "More of what you build counts towards your level", 4),
        GROWTH("Growth", "Crops and trees grow faster on your island", 3);

        public final String label;
        public final String blurb;
        public final int max;

        Upgrade(String label, String blurb, int max) {
            this.label = label;
            this.blurb = blurb;
            this.max = max;
        }
    }

    /**
     * What the next step costs, and the island level it needs.
     *
     * Both climb steeply. The first is affordable off a morning of mining; the
     * last is a project, which is the point of having one.
     */
    private static double costOf(int have) {
        return 2_500 * Math.pow(4, have);
    }

    private static int levelFor(int have) {
        return (have + 1) * 5;
    }

    private final Nexus nexus;

    public IslandUpgrades(Nexus nexus) {
        this.nexus = nexus;
    }

    /* ---------------------------------------------------------------- state */

    public int levelOf(java.util.UUID who, Upgrade upgrade) {
        Stats.Record record = nexus.stats().of(who);
        return switch (upgrade) {
            case GENERATOR -> record.upgradeGenerator;
            case SIZE -> record.upgradeSize;
            case GROWTH -> record.upgradeGrowth;
        };
    }

    private void setLevel(java.util.UUID who, Upgrade upgrade, int value) {
        Stats.Record record = nexus.stats().of(who);
        switch (upgrade) {
            case GENERATOR -> record.upgradeGenerator = value;
            case SIZE -> record.upgradeSize = value;
            case GROWTH -> record.upgradeGrowth = value;
        }
    }

    /* ----------------------------------------------------------------- shop */

    public void show(Player player) {
        java.util.UUID who = player.getUniqueId();
        int islandLevel = SkyBlock.levelOf(nexus.stats().of(who).islandPoints);

        player.sendMessage(Text.heading("Island upgrades"));
        player.sendMessage(Text.plain("  Island level " + islandLevel
                + ", " + Stats.cash(nexus.stats().moneyOf(who))));

        for (Upgrade upgrade : Upgrade.values()) {
            int have = levelOf(who, upgrade);

            if (have >= upgrade.max) {
                player.sendMessage(Component.text("  " + upgrade.label + " ", Text.BRAND)
                        .append(Component.text(have + " of " + upgrade.max, NamedTextColor.WHITE))
                        .append(Component.text("  done", NamedTextColor.DARK_GRAY)));
                continue;
            }

            double cost = costOf(have);
            int needs = levelFor(have);
            boolean canAfford = nexus.stats().moneyOf(who) >= cost;
            boolean highEnough = islandLevel >= needs;

            NamedTextColor colour = canAfford && highEnough
                    ? NamedTextColor.GREEN
                    : NamedTextColor.DARK_GRAY;

            player.sendMessage(Component.text("  " + upgrade.label + " ", Text.BRAND)
                    .append(Component.text(have + " of " + upgrade.max, NamedTextColor.WHITE))
                    .append(Component.text("  " + Stats.cash(cost), colour))
                    .append(Component.text(highEnough ? "" : "  needs island level " + needs,
                            NamedTextColor.RED))
                    .clickEvent(ClickEvent.runCommand(
                            "/is upgrade " + upgrade.name().toLowerCase(Locale.ROOT)))
                    .hoverEvent(HoverEvent.showText(
                            Component.text(upgrade.blurb, NamedTextColor.GRAY))));
        }

        player.sendMessage(Text.plain("  Click one to buy it."));
    }

    public void buy(Player player, String name) {
        Upgrade upgrade = null;
        for (Upgrade candidate : Upgrade.values()) {
            if (candidate.name().equalsIgnoreCase(name)) upgrade = candidate;
        }

        if (upgrade == null) {
            player.sendMessage(Text.bad("Upgrades are: generator, size, growth."));
            return;
        }

        java.util.UUID who = player.getUniqueId();
        int have = levelOf(who, upgrade);

        if (have >= upgrade.max) {
            player.sendMessage(Text.says(upgrade.label + " is already as good as it goes."));
            return;
        }

        int islandLevel = SkyBlock.levelOf(nexus.stats().of(who).islandPoints);
        int needs = levelFor(have);

        if (islandLevel < needs) {
            player.sendMessage(Text.bad("That needs island level " + needs
                    + " and yours is " + islandLevel + "."));
            return;
        }

        double cost = costOf(have);
        if (!nexus.stats().charge(who, cost)) {
            player.sendMessage(Text.bad(upgrade.label + " costs " + Stats.cash(cost)
                    + " and you have " + Stats.cash(nexus.stats().moneyOf(who)) + "."));
            return;
        }

        setLevel(who, upgrade, have + 1);

        player.sendMessage(Text.good(upgrade.label + " is now " + (have + 1)
                + " of " + upgrade.max + "."));
        player.sendMessage(Text.plain("  " + upgrade.blurb + "."));
        player.playSound(player, Sound.ENTITY_PLAYER_LEVELUP, 0.8f, 1.2f);
    }
}
