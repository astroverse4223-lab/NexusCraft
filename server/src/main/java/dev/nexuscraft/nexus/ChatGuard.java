package dev.nexuscraft.nexus;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Sound;
import org.bukkit.entity.Player;

import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * The first thing that gets tested on a public server.
 *
 * Not because most people are awful - they are not - but because the handful
 * who are arrive early and try everything at once: a slur, a link to somewhere
 * unpleasant, and forty messages in ten seconds. All three are cheap to stop
 * and expensive to be caught by, and none of them are things a human moderator
 * can be relied on to be awake for.
 *
 * Everything here refuses the message rather than punishing the sender. A
 * filter that bans on a false positive is a filter that has to be perfect;
 * one that just declines to send the message can afford to be approximate,
 * which is the only thing any word filter ever is.
 *
 * The word list is deliberately short and lives in the config. A long list
 * written by somebody else is how a server ends up unable to say "assassin".
 */
public final class ChatGuard {

    /** How many messages in the window before somebody is going too fast. */
    private static final int BURST = 5;
    private static final int WINDOW_SECONDS = 6;

    /** Shortest message worth checking for shouting. */
    private static final int CAPS_FROM = 8;

    /** Anything that looks like a web address. */
    private static final Pattern LINK = Pattern.compile(
            "(?i)(https?://|www\\.|\\b[a-z0-9-]+\\.(com|net|org|gg|io|me|tv|co|xyz|ru)\\b)");

    private final Nexus nexus;

    /** When each player's recent messages were sent. */
    private final Map<UUID, long[]> recent = new HashMap<>();
    private final Map<UUID, Integer> cursor = new HashMap<>();

    /** The last thing each person said, for catching a repeat. */
    private final Map<UUID, String> lastSaid = new HashMap<>();

    public ChatGuard(Nexus nexus) {
        this.nexus = nexus;
    }

    /* ---------------------------------------------------------------- rules */

    /**
     * Whether this message should be sent.
     *
     * Returns the reason it was refused, or null to let it through. Called on
     * the chat thread, so it touches nothing that is not its own and never
     * schedules anything.
     */
    public String refuse(Player player, String said) {
        UUID who = player.getUniqueId();

        // Staff are exempt from all of it. The rules exist to stop trouble
        // arriving, not to stop a moderator pasting a link to the rules.
        if (player.hasPermission("nexus.admin")) return null;

        Punishments.Entry mute = nexus.punishments().muteOn(who);
        if (mute != null) return "You are muted.";

        if (tooFast(who)) return "Slow down.";

        String trimmed = said.trim();

        if (trimmed.equalsIgnoreCase(lastSaid.get(who))) {
            return "You just said that.";
        }
        lastSaid.put(who, trimmed);

        if (nexus.getConfig().getBoolean("chat.blockLinks", true)
                && LINK.matcher(trimmed).find()
                && !allowed(trimmed)) {
            return "Links are not allowed here.";
        }

        String bad = swearIn(trimmed);
        if (bad != null) return "Not that word.";

        return null;
    }

    /**
     * Whether somebody has said too much too quickly.
     *
     * A ring of the last few timestamps rather than a counter that resets,
     * because a counter on a fixed window lets somebody send twice the limit by
     * straddling the boundary - which is exactly what a spam bot does.
     */
    private boolean tooFast(UUID who) {
        long[] times = recent.computeIfAbsent(who, id -> new long[BURST]);
        int at = cursor.getOrDefault(who, 0);

        long now = System.currentTimeMillis();
        long oldest = times[at];

        times[at] = now;
        cursor.put(who, (at + 1) % BURST);

        return oldest != 0 && now - oldest < WINDOW_SECONDS * 1000L;
    }

    /** Links the operator has decided are fine, such as their own Discord. */
    private boolean allowed(String said) {
        List<String> fine = nexus.getConfig().getStringList("chat.allowedLinks");
        String lower = said.toLowerCase(Locale.ROOT);

        for (String host : fine) {
            if (!host.isBlank() && lower.contains(host.toLowerCase(Locale.ROOT))) return true;
        }
        return false;
    }

    /**
     * Looks for a blocked word, seeing through the usual dodges.
     *
     * Letters repeated, punctuation in the middle and digits standing in for
     * letters are all normalised away first, because a filter that only matches
     * the plain spelling is one that is beaten in about four seconds.
     */
    private String swearIn(String said) {
        String flat = flatten(said);

        for (String word : nexus.getConfig().getStringList("chat.blockedWords")) {
            if (word.isBlank()) continue;
            if (flat.contains(flatten(word))) return word;
        }
        return null;
    }

    private static String flatten(String text) {
        String lower = text.toLowerCase(Locale.ROOT)
                .replace('4', 'a').replace('3', 'e').replace('1', 'i')
                .replace('0', 'o').replace('5', 's').replace('7', 't')
                .replace('@', 'a').replace('$', 's');

        StringBuilder out = new StringBuilder();
        char previous = 0;

        for (char c : lower.toCharArray()) {
            if (!Character.isLetter(c)) continue;

            // Repeated letters collapsed, so "shiiiit" reads as "shit".
            if (c == previous) continue;

            out.append(c);
            previous = c;
        }
        return out.toString();
    }

    /**
     * Shouting, turned back down rather than refused.
     *
     * All caps is rude rather than harmful, and a server that refuses the
     * message teaches people to retype it. Lowercasing it costs them nothing
     * and stops the shouting, which is the actual goal.
     */
    public String calm(Player player, String said) {
        if (player.hasPermission("nexus.admin")) return said;
        if (said.length() < CAPS_FROM) return said;

        int letters = 0;
        int shouting = 0;

        for (char c : said.toCharArray()) {
            if (!Character.isLetter(c)) continue;
            letters++;
            if (Character.isUpperCase(c)) shouting++;
        }

        if (letters < CAPS_FROM || shouting * 100 / letters < 70) return said;

        return said.substring(0, 1).toUpperCase(Locale.ROOT)
                + said.substring(1).toLowerCase(Locale.ROOT);
    }

    /** Tells somebody why nothing appeared, on the main thread. */
    public void explain(Player player, String why) {
        nexus.getServer().getScheduler().runTask(nexus, () -> {
            player.sendMessage(Component.text("  " + why, NamedTextColor.RED));
            player.playSound(player, Sound.BLOCK_NOTE_BLOCK_BASS, 0.5f, 0.8f);
        });
    }

    public void forget(Player player) {
        recent.remove(player.getUniqueId());
        cursor.remove(player.getUniqueId());
        lastSaid.remove(player.getUniqueId());
    }

    /**
     * Proves the filter sees through the obvious dodges.
     *
     * Every one of these is something somebody types within the first hour of a
     * public server existing, and a filter that only catches the plain spelling
     * gives the appearance of moderation without any of it.
     */
    public String selfTest() {
        String[][] shouldMatch = {
                {"badword", "badword"},
                {"badword", "BADWORD"},
                {"badword", "b a d w o r d"},
                {"badword", "b.a.d.w.o.r.d"},
                {"badword", "baaadwooord"},
                {"badword", "b4dw0rd"},
                {"badword", "you are a BadW0rd really"},
        };

        for (String[] pair : shouldMatch) {
            if (!flatten(pair[1]).contains(flatten(pair[0]))) {
                return "missed '" + pair[1] + "'";
            }
        }

        // And does not fire on words that merely contain one.
        if (flatten("assassin").contains(flatten("badword"))) {
            return "matched something it should not";
        }

        return "ok";
    }
}
