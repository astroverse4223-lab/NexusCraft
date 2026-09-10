package dev.nexuscraft.nexus;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.BanList;
import org.bukkit.OfflinePlayer;
import org.bukkit.Sound;
import org.bukkit.command.CommandSender;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.entity.Player;

import java.io.File;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

/**
 * What happens when somebody is a problem.
 *
 * Vanilla gives you exactly two tools: a permanent ban and a kick. No duration,
 * no reason attached to anything, no mute at all, and no memory - so the third
 * time somebody is a nuisance nobody can tell whether it is the third time or
 * the first. On a server for friends that is fine, because the moderation
 * happens in a group chat. The moment strangers can join it stops being fine.
 *
 * Three things this adds, in order of how much they matter:
 *
 * A mute, because the offence that actually happens is somebody being vile in
 * chat, and the only vanilla answer to that is banning them, which is wildly
 * disproportionate and so tends not to happen at all.
 *
 * A duration, because "a day to cool off" is the right answer far more often
 * than "never come back", and without it every punishment is the maximum one.
 *
 * A record, because the question a moderator actually has is never "what did
 * they just do" - they watched it happen - but "is this a pattern".
 *
 * Bans go through Bukkit's own ban list rather than a private one, so vanilla
 * `/ban`, `/pardon` and banned-players.json all keep working and agreeing with
 * this. The record here sits alongside, holding what vanilla cannot store.
 */
public final class Punishments {

    /** What was done to somebody, and why. */
    public record Entry(String kind, UUID who, String name, String by,
                        String reason, long at, long until) {

        boolean expired() {
            return until > 0 && System.currentTimeMillis() > until;
        }

        boolean active() {
            return !expired();
        }
    }

    private final Nexus nexus;
    private final File file;

    private final List<Entry> entries = new ArrayList<>();

    public Punishments(Nexus nexus) {
        this.nexus = nexus;
        this.file = new File(nexus.getDataFolder(), "punishments.yml");
        load();
    }

    /* ------------------------------------------------------------- duration */

    /**
     * Reads "30m", "2h", "7d", "forever" into milliseconds.
     *
     * Returns -1 for anything it does not understand rather than guessing, so a
     * typo produces a message instead of a punishment of surprising length.
     * Zero means permanent.
     */
    public static long readDuration(String text) {
        if (text == null) return -1;

        String lower = text.toLowerCase(Locale.ROOT);
        if (lower.equals("forever") || lower.equals("perm") || lower.equals("permanent")) {
            return 0;
        }

        java.util.regex.Matcher match =
                java.util.regex.Pattern.compile("^(\\d+)([smhdw])$").matcher(lower);
        if (!match.matches()) return -1;

        long amount = Long.parseLong(match.group(1));

        return switch (match.group(2)) {
            case "s" -> amount * 1000L;
            case "m" -> amount * 60_000L;
            case "h" -> amount * 3_600_000L;
            case "d" -> amount * 86_400_000L;
            case "w" -> amount * 604_800_000L;
            default -> -1;
        };
    }

    /** "2 days" rather than a count of milliseconds. */
    private static String describe(long until) {
        if (until <= 0) return "forever";

        long left = until - System.currentTimeMillis();
        if (left <= 0) return "expired";

        return Text.roughly((int) (left / 1000));
    }

    /* --------------------------------------------------------------- muting */

    /**
     * Whether somebody may speak.
     *
     * Read on every chat message and every private message, so it walks the
     * list backwards and stops at the first mute it finds - the newest one is
     * the one that counts, and an unmute is recorded as its own entry.
     */
    public Entry muteOn(UUID who) {
        for (int i = entries.size() - 1; i >= 0; i--) {
            Entry entry = entries.get(i);
            if (!entry.who().equals(who)) continue;

            if (entry.kind().equals("unmute")) return null;
            if (entry.kind().equals("mute")) return entry.active() ? entry : null;
        }
        return null;
    }

    public void mute(CommandSender by, String name, String durationText, String reason) {
        OfflinePlayer target = nexus.getServer().getOfflinePlayer(name);

        if (target.getName() == null) {
            by.sendMessage(Text.bad("Nobody here by that name."));
            return;
        }

        long span = readDuration(durationText);
        if (span < 0) {
            by.sendMessage(Text.bad("How long? 30m, 2h, 7d, or forever."));
            return;
        }

        long until = span == 0 ? 0 : System.currentTimeMillis() + span;
        record("mute", target, by.getName(), reason, until);

        by.sendMessage(Text.good("Muted " + target.getName()
                + " for " + describe(until) + "."));

        Player online = nexus.getServer().getPlayer(target.getUniqueId());
        if (online != null) {
            online.sendMessage(Text.bad("You have been muted for " + describe(until) + "."));
            online.sendMessage(Text.plain("  Reason: " + reason));
            online.playSound(online, Sound.BLOCK_ANVIL_LAND, 0.6f, 0.7f);
        }

        announce(target.getName() + " was muted", reason, by.getName());
    }

    public void unmute(CommandSender by, String name) {
        OfflinePlayer target = nexus.getServer().getOfflinePlayer(name);

        if (target.getName() == null || muteOn(target.getUniqueId()) == null) {
            by.sendMessage(Text.bad("They are not muted."));
            return;
        }

        record("unmute", target, by.getName(), "", 0);
        by.sendMessage(Text.good("Unmuted " + target.getName() + "."));

        Player online = nexus.getServer().getPlayer(target.getUniqueId());
        if (online != null) online.sendMessage(Text.good("You can talk again."));
    }

    /* --------------------------------------------------------------- banning */

    public void ban(CommandSender by, String name, String durationText, String reason) {
        OfflinePlayer target = nexus.getServer().getOfflinePlayer(name);

        if (target.getName() == null) {
            by.sendMessage(Text.bad("Nobody here by that name."));
            return;
        }
        if (target.getUniqueId().equals(senderId(by))) {
            by.sendMessage(Text.bad("You cannot ban yourself."));
            return;
        }

        long span = readDuration(durationText);
        if (span < 0) {
            by.sendMessage(Text.bad("How long? 30m, 2h, 7d, or forever."));
            return;
        }

        long until = span == 0 ? 0 : System.currentTimeMillis() + span;
        record("ban", target, by.getName(), reason, until);

        /*
         * Written into Bukkit's own ban list as well as the record here.
         *
         * That is what actually stops them connecting, and it means vanilla
         * `/pardon` and banned-players.json still tell the truth. Keeping a
         * private list instead would give two sources of who is banned, and
         * they would disagree the first time anybody used a vanilla command.
         */
        nexus.getServer().getBanList(BanList.Type.NAME).addBan(
                target.getName(), reason,
                until == 0 ? null : new Date(until), by.getName());

        Player online = nexus.getServer().getPlayer(target.getUniqueId());
        if (online != null) {
            online.kick(Component.text("Banned for " + describe(until), NamedTextColor.RED)
                    .append(Component.newline())
                    .append(Component.text(reason, NamedTextColor.GRAY)));
        }

        by.sendMessage(Text.good("Banned " + target.getName()
                + " for " + describe(until) + "."));

        announce(target.getName() + " was banned", reason, by.getName());
    }

    public void unban(CommandSender by, String name) {
        OfflinePlayer target = nexus.getServer().getOfflinePlayer(name);
        String real = target.getName() == null ? name : target.getName();

        nexus.getServer().getBanList(BanList.Type.NAME).pardon(real);
        record("unban", target, by.getName(), "", 0);

        by.sendMessage(Text.good("Unbanned " + real + "."));
    }

    /* -------------------------------------------------------------- warning */

    public void warn(CommandSender by, String name, String reason) {
        OfflinePlayer target = nexus.getServer().getOfflinePlayer(name);

        if (target.getName() == null) {
            by.sendMessage(Text.bad("Nobody here by that name."));
            return;
        }

        record("warn", target, by.getName(), reason, 0);
        int total = countOf(target.getUniqueId(), "warn");

        by.sendMessage(Text.good("Warned " + target.getName()
                + ".  That is warning " + total + "."));

        Player online = nexus.getServer().getPlayer(target.getUniqueId());
        if (online != null) {
            online.sendMessage(Text.bad("Warning " + total + ": " + reason));
            online.playSound(online, Sound.BLOCK_NOTE_BLOCK_BASS, 1f, 0.6f);

            online.showTitle(net.kyori.adventure.title.Title.title(
                    Component.text("WARNING", NamedTextColor.RED),
                    Component.text(reason, NamedTextColor.GRAY),
                    net.kyori.adventure.title.Title.Times.times(
                            java.time.Duration.ofMillis(300),
                            java.time.Duration.ofSeconds(4),
                            java.time.Duration.ofMillis(600))));
        }

        // Three warnings is a pattern rather than a bad evening, and saying so
        // is the point of keeping the count at all.
        if (total >= 3) {
            by.sendMessage(Text.plain("  They now have " + total
                    + " warnings. /history " + target.getName()));
        }
    }

    public void kick(CommandSender by, String name, String reason) {
        Player target = nexus.getServer().getPlayerExact(name);

        if (target == null) {
            by.sendMessage(Text.bad("They are not online."));
            return;
        }

        record("kick", target, by.getName(), reason, 0);
        target.kick(Component.text("Kicked", NamedTextColor.RED)
                .append(Component.newline())
                .append(Component.text(reason, NamedTextColor.GRAY)));

        by.sendMessage(Text.good("Kicked " + target.getName() + "."));
        announce(target.getName() + " was kicked", reason, by.getName());
    }

    /* -------------------------------------------------------------- reading */

    /** Everything that has happened to one player. */
    public void history(CommandSender asker, String name) {
        OfflinePlayer target = nexus.getServer().getOfflinePlayer(name);
        UUID who = target.getUniqueId();

        List<Entry> theirs = new ArrayList<>();
        for (Entry entry : entries) if (entry.who().equals(who)) theirs.add(entry);

        asker.sendMessage(Text.heading(
                (target.getName() == null ? name : target.getName()) + "'s record"));

        if (theirs.isEmpty()) {
            asker.sendMessage(Text.plain("  Nothing. They have been no trouble."));
            return;
        }

        asker.sendMessage(Text.field("Warnings", String.valueOf(countOf(who, "warn"))));
        asker.sendMessage(Text.field("Kicks", String.valueOf(countOf(who, "kick"))));
        asker.sendMessage(Text.field("Bans", String.valueOf(countOf(who, "ban"))));
        asker.sendMessage(Text.field("Mutes", String.valueOf(countOf(who, "mute"))));

        Entry mute = muteOn(who);
        if (mute != null) {
            asker.sendMessage(Text.bad("  Muted right now, " + describe(mute.until()) + " left."));
        }

        asker.sendMessage(Component.empty());

        // Newest first, and only the last ten - a record from four months ago
        // is context, not something anybody scrolls back through in chat.
        int shown = 0;
        for (int i = theirs.size() - 1; i >= 0 && shown < 10; i--, shown++) {
            Entry entry = theirs.get(i);
            int ago = (int) ((System.currentTimeMillis() - entry.at()) / 1000);

            asker.sendMessage(Component.text("  " + Text.roughly(ago) + " ago",
                            NamedTextColor.DARK_GRAY)
                    .append(Component.text("  " + entry.kind(), colourOf(entry.kind())))
                    .append(Component.text("  by " + entry.by(), NamedTextColor.GRAY))
                    .append(Component.text(entry.reason().isEmpty()
                            ? "" : "  \"" + entry.reason() + "\"", NamedTextColor.WHITE)));
        }
    }

    private static NamedTextColor colourOf(String kind) {
        return switch (kind) {
            case "ban" -> NamedTextColor.DARK_RED;
            case "kick", "mute" -> NamedTextColor.RED;
            case "warn" -> NamedTextColor.GOLD;
            default -> NamedTextColor.GREEN;
        };
    }

    private int countOf(UUID who, String kind) {
        int count = 0;
        for (Entry entry : entries) {
            if (entry.who().equals(who) && entry.kind().equals(kind)) count++;
        }
        return count;
    }

    public int total() {
        return entries.size();
    }

    /* --------------------------------------------------------------- saying */

    /**
     * Told to everybody, deliberately.
     *
     * Moderation done quietly looks like moderation not happening, and a server
     * where people cannot see that the rules are enforced is one where they
     * assume they are not.
     */
    private void announce(String what, String reason, String by) {
        nexus.getServer().broadcast(Component.text(what, NamedTextColor.RED)
                .append(Component.text(reason.isEmpty() ? "" : "  " + reason,
                        NamedTextColor.GRAY)));

        nexus.discord().event(what + (reason.isEmpty() ? "" : " — " + reason)
                + " (by " + by + ")");
    }

    private UUID senderId(CommandSender sender) {
        return sender instanceof Player player ? player.getUniqueId() : new UUID(0, 0);
    }

    private void record(String kind, OfflinePlayer target, String by,
                        String reason, long until) {
        entries.add(new Entry(kind, target.getUniqueId(),
                target.getName() == null ? "somebody" : target.getName(),
                by, reason, System.currentTimeMillis(), until));
        save();
    }

    /* -------------------------------------------------------------- on disk */

    private void load() {
        if (!file.exists()) return;

        YamlConfiguration yaml = YamlConfiguration.loadConfiguration(file);
        for (String key : yaml.getKeys(false)) {
            try {
                entries.add(new Entry(
                        yaml.getString(key + ".kind", "warn"),
                        UUID.fromString(yaml.getString(key + ".who", "")),
                        yaml.getString(key + ".name", "somebody"),
                        yaml.getString(key + ".by", "somebody"),
                        yaml.getString(key + ".reason", ""),
                        yaml.getLong(key + ".at"),
                        yaml.getLong(key + ".until")));
            } catch (IllegalArgumentException damaged) {
                // A hand-edited file should not stop the server starting.
            }
        }

        nexus.getLogger().info(entries.size() + " punishment records loaded");
    }

    public void save() {
        YamlConfiguration yaml = new YamlConfiguration();

        int index = 0;
        for (Entry entry : entries) {
            String key = "p" + (index++);
            yaml.set(key + ".kind", entry.kind());
            yaml.set(key + ".who", entry.who().toString());
            yaml.set(key + ".name", entry.name());
            yaml.set(key + ".by", entry.by());
            yaml.set(key + ".reason", entry.reason());
            yaml.set(key + ".at", entry.at());
            yaml.set(key + ".until", entry.until());
        }

        try {
            yaml.save(file);
        } catch (Exception e) {
            nexus.getLogger().warning("could not save punishments: " + e);
        }
    }

    /**
     * Proves a duration is read as the length it says.
     *
     * Worth a test because every one of these is a number that decides how long
     * somebody is shut out, and the failure mode is silent: "7d" parsed as
     * seven milliseconds is a ban that ends before the message finishes
     * printing, and nothing anywhere would say so.
     */
    public String selfTest() {
        record Case(String text, long expected) {
        }

        Case[] cases = {
                new Case("30s", 30_000L),
                new Case("15m", 900_000L),
                new Case("2h", 7_200_000L),
                new Case("7d", 604_800_000L),
                new Case("1w", 604_800_000L),
                new Case("forever", 0L),
                new Case("perm", 0L),
                new Case("", -1L),
                new Case("soon", -1L),
                new Case("7", -1L),
                new Case("-3d", -1L),
        };

        for (Case one : cases) {
            long got = readDuration(one.text());
            if (got != one.expected()) {
                return "'" + one.text() + "' read as " + got
                        + ", expected " + one.expected();
            }
        }
        return "ok";
    }
}
