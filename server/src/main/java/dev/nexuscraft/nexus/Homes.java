package dev.nexuscraft.nexus;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Location;
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
 * Somewhere to come back to.
 *
 * The most missed command on any survival server, and the reason is simple
 * arithmetic: without it, every session begins with the same four minute walk,
 * and a player who dies far from home loses the walk twice. It is not a feature
 * people praise, it is one they only notice the absence of.
 *
 * How many you get depends on rank, which makes it the first thing a rank is
 * actually *for* — and unlike most rank perks, more homes is a convenience
 * rather than an advantage, which keeps it on the right side of what a server
 * is allowed to sell.
 */
public final class Homes {

    /** How many homes each rank may keep. */
    private static int allowance(Ranks rank) {
        return switch (rank) {
            case PLAYER -> 2;
            case VIP -> 4;
            case MVP -> 6;
            case ADMIN, OWNER -> 20;
        };
    }

    /** Where a home is, kept by world name so it survives a load order. */
    private record Spot(String world, double x, double y, double z, float yaw, float pitch) {

        Location at(Nexus nexus) {
            World found = nexus.getServer().getWorld(world);
            return found == null ? null : new Location(found, x, y, z, yaw, pitch);
        }
    }

    private final Nexus nexus;
    private final File file;

    private final Map<UUID, Map<String, Spot>> homes = new HashMap<>();

    public Homes(Nexus nexus) {
        this.nexus = nexus;
        this.file = new File(nexus.getDataFolder(), "homes.yml");
        load();
    }

    /* ---------------------------------------------------------------- using */

    /**
     * Records where somebody is standing.
     *
     * Refused in the lobby and in minigame arenas — a home in an arena is a
     * home in a world that is deleted when the match ends, and the failure that
     * causes happens days later somewhere unrelated.
     */
    public void set(Player player, String name) {
        Worlds.Place place = nexus.worlds().placeOf(player);

        if (place == null) {
            player.sendMessage(Text.bad("You cannot set a home here."));
            return;
        }
        if (place == Worlds.Place.PARKOUR || place == Worlds.Place.DROPPER) {
            player.sendMessage(Text.bad("Not in here."));
            return;
        }

        String key = name.toLowerCase(Locale.ROOT);
        Map<String, Spot> theirs = homes.computeIfAbsent(player.getUniqueId(),
                id -> new HashMap<>());

        int allowed = allowance(nexus.stats().rankOf(player.getUniqueId()));
        if (!theirs.containsKey(key) && theirs.size() >= allowed) {
            player.sendMessage(Text.bad("You can only keep " + allowed + " homes."));
            player.sendMessage(Text.plain("  /delhome <name> to make room, or rank up."));
            return;
        }

        Location at = player.getLocation();
        theirs.put(key, new Spot(at.getWorld().getName(),
                at.getX(), at.getY(), at.getZ(), at.getYaw(), at.getPitch()));
        save();

        player.sendMessage(Text.good("Home '" + key + "' set."
                + "  (" + theirs.size() + " of " + allowed + ")"));
        player.playSound(player, Sound.BLOCK_AMETHYST_BLOCK_CHIME, 0.8f, 1.3f);
    }

    public void go(Player player, String name) {
        Map<String, Spot> theirs = homes.get(player.getUniqueId());
        String key = name.toLowerCase(Locale.ROOT);

        if (theirs == null || theirs.isEmpty()) {
            player.sendMessage(Text.says("You have no homes. /sethome to make one."));
            return;
        }

        Spot spot = theirs.get(key);
        if (spot == null) {
            player.sendMessage(Text.bad("No home called '" + key + "'."));
            list(player);
            return;
        }

        Location at = spot.at(nexus);
        if (at == null) {
            player.sendMessage(Text.bad("That world is not loaded."));
            return;
        }

        /*
         * Sent through the world system rather than teleported directly.
         *
         * A home in survival reached from the lobby has to change gamemode and
         * swap inventories, and a raw teleport would leave somebody standing in
         * survival in adventure mode holding a lobby compass.
         */
        Worlds.Place place = null;
        for (Worlds.Place candidate : Worlds.Place.values()) {
            if (candidate.world.equals(spot.world())) place = candidate;
        }

        if (place != null && nexus.worlds().placeOf(player) != place) {
            nexus.worlds().send(player, place);
        }

        player.teleport(at);
        player.sendMessage(Text.says("Home."));
        player.playSound(player, Sound.ENTITY_ENDERMAN_TELEPORT, 0.6f, 1.4f);
    }

    public void remove(Player player, String name) {
        Map<String, Spot> theirs = homes.get(player.getUniqueId());
        String key = name.toLowerCase(Locale.ROOT);

        if (theirs == null || theirs.remove(key) == null) {
            player.sendMessage(Text.bad("No home called '" + key + "'."));
            return;
        }

        save();
        player.sendMessage(Text.good("Removed '" + key + "'."));
    }

    public void list(Player player) {
        Map<String, Spot> theirs = homes.get(player.getUniqueId());
        int allowed = allowance(nexus.stats().rankOf(player.getUniqueId()));

        if (theirs == null || theirs.isEmpty()) {
            player.sendMessage(Text.says("No homes yet. /sethome to make one."));
            return;
        }

        player.sendMessage(Text.heading("Homes"));
        for (Map.Entry<String, Spot> entry : theirs.entrySet()) {
            Spot spot = entry.getValue();

            player.sendMessage(Component.text("  " + entry.getKey(), Text.BRAND)
                    .append(Component.text("   " + Math.round(spot.x())
                                    + ", " + Math.round(spot.y())
                                    + ", " + Math.round(spot.z()),
                            NamedTextColor.DARK_GRAY)));
        }
        player.sendMessage(Text.plain("  " + theirs.size() + " of " + allowed + " used."));
    }

    /** The names they have, for tab completion. */
    public List<String> namesFor(UUID who) {
        Map<String, Spot> theirs = homes.get(who);
        return theirs == null ? List.of() : new ArrayList<>(theirs.keySet());
    }

    /* -------------------------------------------------------------- on disk */

    private void load() {
        if (!file.exists()) return;

        YamlConfiguration yaml = YamlConfiguration.loadConfiguration(file);
        for (String key : yaml.getKeys(false)) {
            UUID who;
            try {
                who = UUID.fromString(key);
            } catch (IllegalArgumentException notAnId) {
                continue;
            }

            var section = yaml.getConfigurationSection(key);
            if (section == null) continue;

            Map<String, Spot> theirs = new HashMap<>();
            for (String name : section.getKeys(false)) {
                String path = key + "." + name;
                theirs.put(name, new Spot(
                        yaml.getString(path + ".world", ""),
                        yaml.getDouble(path + ".x"),
                        yaml.getDouble(path + ".y"),
                        yaml.getDouble(path + ".z"),
                        (float) yaml.getDouble(path + ".yaw"),
                        (float) yaml.getDouble(path + ".pitch")));
            }
            if (!theirs.isEmpty()) homes.put(who, theirs);
        }
    }

    public void save() {
        YamlConfiguration yaml = new YamlConfiguration();

        for (Map.Entry<UUID, Map<String, Spot>> person : homes.entrySet()) {
            for (Map.Entry<String, Spot> entry : person.getValue().entrySet()) {
                String path = person.getKey() + "." + entry.getKey();
                Spot spot = entry.getValue();

                yaml.set(path + ".world", spot.world());
                yaml.set(path + ".x", spot.x());
                yaml.set(path + ".y", spot.y());
                yaml.set(path + ".z", spot.z());
                yaml.set(path + ".yaw", spot.yaw());
                yaml.set(path + ".pitch", spot.pitch());
            }
        }

        try {
            yaml.save(file);
        } catch (Exception e) {
            nexus.getLogger().warning("could not save homes: " + e);
        }
    }
}
