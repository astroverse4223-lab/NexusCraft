package dev.nexuscraft.nexus;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.OfflinePlayer;
import org.bukkit.Sound;
import org.bukkit.entity.Player;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Money on somebody's head.
 *
 * The only thing here that makes players do something to each other rather than
 * to the world, and it works because it needs no permission from anybody: you
 * put your own money on a name, and from then on there is a reason for people
 * who have never spoken to go looking for them.
 *
 * Deliberately kept out of the minigames. A bounty that pays in a Duel queue is
 * two friends taking turns killing each other for somebody else's money, and it
 * would be the first thing anybody tried. It pays in the worlds where finding
 * somebody is actually work.
 *
 * The amount lives on the target's own record rather than in a separate list,
 * which means it is saved, loaded and cleaned up by machinery that already
 * exists, and there is no second file to disagree with the first.
 */
public final class Bounties {

    /** Below this it is not worth the message it prints. */
    private static final double SMALLEST = 250;

    /** Worlds where a bounty pays out. */
    private static boolean counts(String world) {
        return world.equals(Worlds.Place.SURVIVAL.world)
                || world.equals(Worlds.Place.PRISON.world);
    }

    private final Nexus nexus;

    public Bounties(Nexus nexus) {
        this.nexus = nexus;
    }

    /* -------------------------------------------------------------- placing */

    public void place(Player payer, String name, double amount) {
        if (amount < SMALLEST) {
            payer.sendMessage(Text.bad("The smallest bounty is "
                    + Stats.cash(SMALLEST) + "."));
            return;
        }

        OfflinePlayer target = nexus.getServer().getOfflinePlayer(name);
        if (target.getName() == null) {
            payer.sendMessage(Text.bad("Nobody here by that name."));
            return;
        }

        if (target.getUniqueId().equals(payer.getUniqueId())) {
            payer.sendMessage(Text.bad("You cannot put a price on yourself."));
            return;
        }

        if (!nexus.stats().charge(payer.getUniqueId(), amount)) {
            payer.sendMessage(Text.bad("You do not have " + Stats.cash(amount) + "."));
            return;
        }

        Stats.Record record = nexus.stats().of(target.getUniqueId());
        record.bounty += amount;

        payer.sendMessage(Text.good("Bounty placed on " + target.getName() + "."));
        payer.playSound(payer, Sound.BLOCK_ANVIL_USE, 0.6f, 1.2f);

        /*
         * Announced to everybody, always.
         *
         * A bounty nobody knows about is a donation. The whole value of the
         * feature is the moment the server reads the name out.
         */
        nexus.getServer().broadcast(Component.text("Bounty  ", NamedTextColor.GOLD)
                .append(Component.text(Stats.cash(record.bounty), NamedTextColor.YELLOW))
                .append(Component.text(" on ", NamedTextColor.GRAY))
                .append(Component.text(target.getName(), NamedTextColor.WHITE))
                .append(Component.text("  placed by " + payer.getName(),
                        NamedTextColor.DARK_GRAY)));

        Player online = nexus.getServer().getPlayer(target.getUniqueId());
        if (online != null) {
            online.sendMessage(Text.bad("Somebody has put "
                    + Stats.cash(record.bounty) + " on your head."));
            online.playSound(online, Sound.ENTITY_WITHER_SPAWN, 0.4f, 1.6f);
        }

        nexus.discord().event("Bounty of " + Stats.cash(record.bounty)
                + " placed on " + target.getName());
    }

    /* -------------------------------------------------------------- paying */

    /**
     * Somebody killed somebody. Pays out if there was anything to pay.
     *
     * Called from the death listener rather than from anywhere a game could
     * reach, which is what keeps a Duel from being a cash machine.
     */
    public void killed(Player killer, Player victim) {
        if (killer == null || killer.equals(victim)) return;
        if (!counts(victim.getWorld().getName())) return;
        if (nexus.games().matchOf(victim.getUniqueId()) != null) return;

        Stats.Record theirs = nexus.stats().of(victim.getUniqueId());
        double prize = theirs.bounty;
        if (prize <= 0) return;

        theirs.bounty = 0;

        Stats.Record mine = nexus.stats().of(killer.getUniqueId());
        mine.bountiesClaimed += prize;
        nexus.stats().pay(killer.getUniqueId(), prize);

        killer.sendMessage(Text.good("Bounty collected: " + Stats.cash(prize)));
        killer.playSound(killer, Sound.ENTITY_PLAYER_LEVELUP, 1f, 1.2f);

        victim.sendMessage(Text.bad("They collected the "
                + Stats.cash(prize) + " on your head."));

        nexus.getServer().broadcast(Component.text(killer.getName(), NamedTextColor.WHITE)
                .append(Component.text(" claimed the bounty on ", NamedTextColor.GRAY))
                .append(Component.text(victim.getName(), NamedTextColor.WHITE))
                .append(Component.text("  " + Stats.cash(prize), NamedTextColor.GOLD)));

        nexus.discord().event(killer.getName() + " claimed the "
                + Stats.cash(prize) + " bounty on " + victim.getName());
    }

    /* -------------------------------------------------------------- reading */

    /** Everybody with a price on them, biggest first. */
    public void list(Player asker) {
        List<Map.Entry<UUID, Double>> wanted = new ArrayList<>();

        for (Map.Entry<UUID, Stats.Record> entry : nexus.stats().everybody().entrySet()) {
            if (entry.getValue().bounty > 0) {
                wanted.add(Map.entry(entry.getKey(), entry.getValue().bounty));
            }
        }

        asker.sendMessage(Text.heading("Wanted"));

        if (wanted.isEmpty()) {
            asker.sendMessage(Text.plain("  Nobody. /bounty <player> <amount>"));
            return;
        }

        wanted.sort(Comparator.comparingDouble((Map.Entry<UUID, Double> e) -> e.getValue())
                .reversed());

        int shown = 0;
        for (Map.Entry<UUID, Double> entry : wanted) {
            if (++shown > 10) break;

            String name = nexus.getServer().getOfflinePlayer(entry.getKey()).getName();
            boolean here = nexus.getServer().getPlayer(entry.getKey()) != null;

            asker.sendMessage(Component.text("  " + Stats.cash(entry.getValue()),
                            NamedTextColor.GOLD)
                    .append(Component.text("   " + (name == null ? "somebody" : name),
                            NamedTextColor.WHITE))
                    .append(Component.text(here ? "   online" : "",
                            NamedTextColor.GREEN)));
        }

        asker.sendMessage(Text.plain("  Only pays in survival and prison."));
    }

    public double on(UUID who) {
        return nexus.stats().of(who).bounty;
    }
}
