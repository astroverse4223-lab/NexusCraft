package dev.nexuscraft.nexus;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.event.ClickEvent;
import net.kyori.adventure.text.event.HoverEvent;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.OfflinePlayer;
import org.bukkit.Sound;
import org.bukkit.World;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.entity.Player;

import java.io.File;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

/**
 * Warps players set themselves.
 *
 * Chest shops give people a reason to visit each other; this is how they find
 * out where to go. Without it a shop is only worth having if somebody already
 * knows where your base is, which means only your friends ever see it.
 *
 * Deliberately public and listed. A private warp is a home, and homes already
 * exist - the whole point of this one is being found by a stranger.
 */
public final class Warps {

    /** How many each rank may publish. */
    private static int allowance(Ranks rank) {
        return switch (rank) {
            case PLAYER -> 2;
            case VIP -> 4;
            case MVP -> 8;
            case ADMIN, OWNER -> 100;
        };
    }

    /** Worlds worth advertising a spot in. */
    private static boolean allowed(String world) {
        return world.equals(Worlds.Place.SURVIVAL.world);
    }

    private record Warp(UUID owner, String name, String world,
                        double x, double y, double z, float yaw, float pitch,
                        String note, long madeAt) {
    }

    private final Nexus nexus;
    private final File file;

    /** Keyed by the lowercase name, because that is what people type. */
    private final Map<String, Warp> warps = new HashMap<>();

    public Warps(Nexus nexus) {
        this.nexus = nexus;
        this.file = new File(nexus.getDataFolder(), "warps.yml");
        load();
    }

    /* --------------------------------------------------------------- making */

    /**
     * Publishes where somebody is standing.
     *
     * The name has to be theirs to take and safe to put in a command, so it is
     * held to letters, digits and dashes - a warp called `a b` or one with a
     * colour code in it is a warp nobody can type.
     */
    public void set(Player player, String rawName, String note) {
        String name = rawName.toLowerCase(Locale.ROOT).trim();

        if (!name.matches("[a-z0-9_-]{2,16}")) {
            player.sendMessage(Text.bad("Warp names are 2 to 16 letters, digits, - or _."));
            return;
        }

        if (!allowed(player.getWorld().getName())) {
            player.sendMessage(Text.bad("You can only set a warp in survival."));
            return;
        }

        if (!nexus.claims().mayBuild(player, player.getLocation().getBlock())) {
            player.sendMessage(Text.bad("You can only set a warp on land you own."));
            player.sendMessage(Text.plain("  Claim it first, and nobody can move your warp."));
            return;
        }

        Warp existing = warps.get(name);
        if (existing != null && !existing.owner().equals(player.getUniqueId())) {
            player.sendMessage(Text.bad("Somebody else has taken that name."));
            return;
        }

        if (existing == null) {
            int have = countOf(player.getUniqueId());
            int limit = allowance(nexus.stats().rankOf(player.getUniqueId()));

            if (have >= limit) {
                player.sendMessage(Text.bad("You already have all " + limit + " of your warps."));
                player.sendMessage(Text.plain("  /pwarp delete <name>, or rank up for more."));
                return;
            }
        }

        Location at = player.getLocation();
        warps.put(name, new Warp(player.getUniqueId(), name, at.getWorld().getName(),
                at.getX(), at.getY(), at.getZ(), at.getYaw(), at.getPitch(),
                note == null ? "" : note.trim(), System.currentTimeMillis()));
        save();

        player.sendMessage(Text.good((existing == null ? "Warp set: " : "Warp moved: ") + name));
        player.sendMessage(Text.plain("  Anybody can reach it with /pwarp " + name));
        player.playSound(player, Sound.BLOCK_AMETHYST_BLOCK_CHIME, 0.9f, 1.3f);
    }

    public void delete(Player player, String rawName) {
        String name = rawName.toLowerCase(Locale.ROOT).trim();
        Warp warp = warps.get(name);

        if (warp == null) {
            player.sendMessage(Text.says("There is no warp called that."));
            return;
        }
        if (!warp.owner().equals(player.getUniqueId()) && !player.hasPermission("nexus.admin")) {
            player.sendMessage(Text.bad("That is " + nameOf(warp.owner()) + "'s warp."));
            return;
        }

        warps.remove(name);
        save();
        player.sendMessage(Text.good("Warp removed: " + name));
    }

    /* ------------------------------------------------------------- visiting */

    public void go(Player player, String rawName) {
        String name = rawName.toLowerCase(Locale.ROOT).trim();
        Warp warp = warps.get(name);

        if (warp == null) {
            player.sendMessage(Text.bad("There is no warp called " + name + "."));
            player.sendMessage(Text.plain("  /pwarps to see them all."));
            return;
        }

        World world = Bukkit.getWorld(warp.world());
        if (world == null) {
            player.sendMessage(Text.bad("That warp is in a world that is not loaded."));
            return;
        }

        /*
         * Through the world system rather than teleported directly.
         *
         * A raw teleport into survival would carry whatever the player was
         * holding wherever they came from, which is the hole the world change
         * closes - and it is the reason warps are limited to survival.
         */
        if (nexus.worlds().placeOf(player) != Worlds.Place.SURVIVAL) {
            nexus.worlds().send(player, Worlds.Place.SURVIVAL);
        }

        player.teleport(new Location(world, warp.x(), warp.y(), warp.z(),
                warp.yaw(), warp.pitch()));

        player.sendMessage(Text.says("Warped to " + warp.name()
                + ", " + nameOf(warp.owner()) + "'s."));
        player.playSound(player, Sound.ENTITY_ENDERMAN_TELEPORT, 0.6f, 1.4f);
    }

    /**
     * Every warp, as a list you can click.
     *
     * Clickable because the alternative is reading a name off the screen and
     * typing it back in, and a directory people cannot be bothered to use is
     * the same as no directory.
     */
    public void list(Player player) {
        if (warps.isEmpty()) {
            player.sendMessage(Text.says("Nobody has set a warp yet."));
            player.sendMessage(Text.plain("  /pwarp set <name> on your own land."));
            return;
        }

        player.sendMessage(Text.heading("Player warps"));

        List<Warp> ordered = new ArrayList<>(warps.values());
        ordered.sort((a, b) -> a.name().compareTo(b.name()));

        for (Warp warp : ordered) {
            Component line = Component.text("  " + warp.name(), Text.BRAND)
                    .append(Component.text("  by " + nameOf(warp.owner()), NamedTextColor.DARK_GRAY))
                    .clickEvent(ClickEvent.runCommand("/pwarp " + warp.name()))
                    .hoverEvent(HoverEvent.showText(Component.text(
                            warp.note().isEmpty() ? "Click to visit" : warp.note(),
                            NamedTextColor.GRAY)));

            player.sendMessage(line);
            if (!warp.note().isEmpty()) {
                player.sendMessage(Component.text("    " + warp.note(), NamedTextColor.GRAY));
            }
        }

        player.sendMessage(Text.plain("  " + warps.size() + " in all. Click one to go."));
    }

    public void mine(Player player) {
        int limit = allowance(nexus.stats().rankOf(player.getUniqueId()));
        player.sendMessage(Text.heading("Your warps"));

        int shown = 0;
        for (Warp warp : warps.values()) {
            if (!warp.owner().equals(player.getUniqueId())) continue;
            player.sendMessage(Text.field(warp.name(),
                    warp.note().isEmpty() ? "no description" : warp.note()));
            shown++;
        }

        if (shown == 0) player.sendMessage(Text.plain("  None yet."));
        player.sendMessage(Text.plain("  " + shown + " of " + limit + "."));
    }

    /** Every warp name, for tab. */
    public java.util.List<String> names() {
        java.util.List<String> all = new ArrayList<>(warps.keySet());
        java.util.Collections.sort(all);
        return all;
    }

    /** The ones this player may delete, which is only their own. */
    public java.util.List<String> namesFor(UUID who) {
        java.util.List<String> mine = new ArrayList<>();
        for (Warp warp : warps.values()) {
            if (warp.owner().equals(who)) mine.add(warp.name());
        }
        java.util.Collections.sort(mine);
        return mine;
    }

    public int total() {
        return warps.size();
    }

    private int countOf(UUID who) {
        int count = 0;
        for (Warp warp : warps.values()) if (warp.owner().equals(who)) count++;
        return count;
    }

    private String nameOf(UUID who) {
        OfflinePlayer player = Bukkit.getOfflinePlayer(who);
        return player.getName() == null ? "somebody" : player.getName();
    }

    /* ------------------------------------------------------------- on disk */

    private void load() {
        if (!file.exists()) return;

        YamlConfiguration yaml = YamlConfiguration.loadConfiguration(file);
        for (String name : yaml.getKeys(false)) {
            try {
                warps.put(name, new Warp(
                        UUID.fromString(yaml.getString(name + ".owner", "")),
                        name,
                        yaml.getString(name + ".world", ""),
                        yaml.getDouble(name + ".x"),
                        yaml.getDouble(name + ".y"),
                        yaml.getDouble(name + ".z"),
                        (float) yaml.getDouble(name + ".yaw"),
                        (float) yaml.getDouble(name + ".pitch"),
                        yaml.getString(name + ".note", ""),
                        yaml.getLong(name + ".madeAt")));
            } catch (Exception broken) {
                nexus.getLogger().warning("skipping an unreadable warp: " + name);
            }
        }
    }

    public void save() {
        YamlConfiguration yaml = new YamlConfiguration();

        for (Warp warp : warps.values()) {
            String name = warp.name();
            yaml.set(name + ".owner", warp.owner().toString());
            yaml.set(name + ".world", warp.world());
            yaml.set(name + ".x", warp.x());
            yaml.set(name + ".y", warp.y());
            yaml.set(name + ".z", warp.z());
            yaml.set(name + ".yaw", warp.yaw());
            yaml.set(name + ".pitch", warp.pitch());
            yaml.set(name + ".note", warp.note());
            yaml.set(name + ".madeAt", warp.madeAt());
        }

        try {
            yaml.save(file);
        } catch (Exception broken) {
            nexus.getLogger().warning("could not save the warps: " + broken);
        }
    }
}
