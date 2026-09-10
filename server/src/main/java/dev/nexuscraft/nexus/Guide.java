package dev.nexuscraft.nexus;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.event.ClickEvent;
import net.kyori.adventure.text.event.HoverEvent;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.title.Title;
import org.bukkit.Sound;
import org.bukkit.entity.Player;

import java.time.Duration;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Somebody to tell a new player what any of this is.
 *
 * A network with nine worlds, seven games, jobs, quests, crates, claims and an
 * auction house is not self-explanatory, and the usual answer - a wall of text
 * in the join message - is read by nobody. Seven hundred words at the moment
 * somebody arrives is the same as no words.
 *
 * So it is paced: one short thing at a time, thirty seconds apart, each one a
 * single idea with a command you can click. It runs once, the first time
 * somebody joins, and can be replayed with /guide. Anybody can stop it.
 *
 * The steps are ordered by what a new player needs first rather than by what is
 * most impressive, which is why the auction house is near the end and "here is
 * how you get money" is second.
 */
public final class Guide {

    /** One thing worth knowing, and the command that does it. */
    private record Step(String headline, String detail, String command) {
    }

    private static final List<Step> STEPS = List.of(
            new Step("Welcome",
                    "Everything here is one menu away. Try it.", "menu"),
            new Step("Money",
                    "You are paid for playing. Mine, sell, and take a job.", "jobs"),
            new Step("Free things",
                    "There is a starter kit waiting for you.", "kit starter"),
            new Step("Somewhere to build",
                    "Survival is where people build. Go and have a look.",
                    "warp survival"),
            new Step("Make it yours",
                    "Stand where you want to build and claim the ground. "
                            + "Nobody else can touch it after that.", "claim"),
            new Step("Getting back",
                    "Set a home so you never walk here again.", "sethome"),
            new Step("Every day",
                    "There is a reward for turning up, and it grows.", "daily"),
            new Step("Something to do",
                    "Three quests a day, and they pay.", "quests"),
            new Step("Games",
                    "Seven of them. Sumo takes a minute, Bed Wars takes twenty.",
                    "play"),
            new Step("Selling to people",
                    "The shop will not buy an enchanted pickaxe. Players will.",
                    "ah"),
            new Step("That is everything",
                    "The rest is in the menu. Have fun.", "menu"));

    /** How long between steps, in seconds. */
    private static final int PACE = 30;

    private final Nexus nexus;

    /** Which step each player is on, and when the next one is due. */
    private final Map<UUID, Integer> step = new HashMap<>();
    private final Map<UUID, Integer> due = new HashMap<>();

    private int seconds;

    public Guide(Nexus nexus) {
        this.nexus = nexus;
    }

    /* -------------------------------------------------------------- running */

    /**
     * Starts the guide for somebody who has never been here.
     *
     * "Never" is measured by minutes played rather than by a flag of its own,
     * because the record already knows and a second source of truth is a second
     * thing to get out of step.
     */
    public void greetIfNew(Player player) {
        if (nexus.stats().of(player.getUniqueId()).minutesPlayed > 5) return;
        begin(player);
    }

    public void begin(Player player) {
        step.put(player.getUniqueId(), 0);

        // First step after a moment, not instantly - somebody who just joined is
        // still looking at the loading screen.
        due.put(player.getUniqueId(), seconds + 6);

        player.sendMessage(Text.says("I will show you round. /guide stop at any time."));
    }

    public void stop(Player player) {
        step.remove(player.getUniqueId());
        due.remove(player.getUniqueId());
        player.sendMessage(Text.says("Stopped. /guide to start again."));
    }

    public boolean running(UUID who) {
        return step.containsKey(who);
    }

    public void forget(Player player) {
        step.remove(player.getUniqueId());
        due.remove(player.getUniqueId());
    }

    /** Once a second. */
    public void tick() {
        seconds++;

        for (UUID who : new java.util.ArrayList<>(step.keySet())) {
            Player player = nexus.getServer().getPlayer(who);

            if (player == null) {
                step.remove(who);
                due.remove(who);
                continue;
            }

            // Paused rather than talked over. Nobody reads a tip while they are
            // in the middle of a Bed Wars match.
            if (nexus.games().matchOf(who) != null) continue;

            Integer when = due.get(who);
            if (when == null || seconds < when) continue;

            int index = step.get(who);
            if (index >= STEPS.size()) {
                step.remove(who);
                due.remove(who);
                continue;
            }

            show(player, STEPS.get(index), index);
            step.put(who, index + 1);
            due.put(who, seconds + PACE);
        }
    }

    private void show(Player player, Step showing, int index) {
        player.sendMessage(Component.empty());
        player.sendMessage(Component.text("  " + showing.headline(), Text.BRAND)
                .append(Component.text("   " + (index + 1) + " of " + STEPS.size(),
                        NamedTextColor.DARK_GRAY)));

        player.sendMessage(Component.text("  " + showing.detail(), NamedTextColor.GRAY));

        /*
         * The command is clickable, and says so.
         *
         * A tip that ends in "type /claim" is a tip most people do not act on,
         * because acting on it means leaving whatever they were doing to type
         * something exactly right. One click is a different thing entirely.
         */
        player.sendMessage(Component.text("  /" + showing.command(), NamedTextColor.YELLOW)
                .hoverEvent(HoverEvent.showText(
                        Component.text("Click to run it", NamedTextColor.GRAY)))
                .clickEvent(ClickEvent.runCommand("/" + showing.command())));

        player.playSound(player, Sound.BLOCK_NOTE_BLOCK_BELL, 0.5f, 1.6f);

        if (index == 0) {
            player.showTitle(Title.title(
                    Component.text("Welcome", Text.BRAND),
                    Component.text("Watch the chat", NamedTextColor.GRAY),
                    Title.Times.times(Duration.ofMillis(400), Duration.ofSeconds(3),
                            Duration.ofMillis(600))));
        }
    }

    public static int steps() {
        return STEPS.size();
    }
}
