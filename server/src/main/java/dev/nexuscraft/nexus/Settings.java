package dev.nexuscraft.nexus;

import org.bukkit.Location;
import org.bukkit.World;
import org.bukkit.configuration.file.FileConfiguration;

/**
 * The bits an operator is meant to change.
 *
 * Almost everything here exists for one purpose: letting somebody use their own
 * spawn build instead of the generated one. A downloaded town from a schematic
 * site will always look better than anything generated, and a plugin that
 * insists on its own build is a plugin that has to be fought.
 *
 * So: set `spawn.custom` to true, paste whatever you like into the hub world
 * with WorldEdit, and put the coordinates in. The generator is then never run
 * and the plugin only places the NPCs where you say.
 */
public final class Settings {

    private final Nexus nexus;

    public Settings(Nexus nexus) {
        this.nexus = nexus;

        nexus.saveDefaultConfig();
        nexus.getConfig().options().copyDefaults(true);
        nexus.saveConfig();
    }

    private FileConfiguration config() {
        return nexus.getConfig();
    }

    /** True once somebody has pasted their own lobby and said so. */
    public boolean customSpawn() {
        return config().getBoolean("spawn.custom", false);
    }

    /**
     * Which world the lobby is.
     *
     * Named rather than fixed because the good way to use somebody else's build
     * is to drop the world folder into the server as it came - renaming a world
     * folder means editing level.dat, and a downloaded lobby that has to be
     * renamed is one people get wrong.
     */
    public String hubWorldName() {
        return config().getString("spawn.world", "nexus_hub");
    }

    /**
     * Which version of the generated lobby is standing.
     *
     * The build used to be skipped whenever anything was already at the middle
     * of the world, which is right the first time and wrong forever after: an
     * older lobby is something at the middle of the world, so upgrading the
     * plugin left the old one in place and the new build never appeared. The
     * fix arrived as "delete the world folder", which is not a fix, it is an
     * instruction somebody has to remember.
     *
     * Kept in its own file rather than in config.yml. It was in the config and
     * it did not survive: Bukkit rewrites that file from the jar defaults on
     * every startup, and a key the defaults do not contain is dropped on the
     * next boot. Which produced the worst possible version of this bug - it
     * worked in memory, so the rebuild was correctly skipped, and the marker
     * was gone from disk afterwards, so the boot after that rebuilt from
     * scratch. This is not a setting anybody should edit anyway.
     */
    public int builtVersion() {
        try {
            java.nio.file.Path marker = markerFile();
            if (!java.nio.file.Files.isRegularFile(marker)) return 0;
            return Integer.parseInt(java.nio.file.Files.readString(marker).trim());
        } catch (Exception unreadable) {
            // A marker that cannot be read means rebuild, which is the safe way
            // round: a wasted two seconds rather than a lobby nobody can see.
            return 0;
        }
    }

    public void setBuiltVersion(int version) {
        try {
            java.nio.file.Files.writeString(markerFile(), Integer.toString(version));
        } catch (Exception e) {
            nexus.getLogger().warning("could not record the lobby version: " + e);
        }
    }

    private java.nio.file.Path markerFile() {
        return nexus.getDataFolder().toPath().resolve("lobby.version");
    }

    /**
     * What version of a generated world is currently on disk.
     *
     * The same idea as the lobby's marker, for anything else this plugin
     * builds. Without one the only question a generator can ask is "does this
     * world exist yet", and the answer is yes long before the design stops
     * changing - so every later change silently applies to nobody.
     */
    public int builtVersion(String what) {
        try {
            java.nio.file.Path marker =
                    nexus.getDataFolder().toPath().resolve(what + ".version");

            if (!java.nio.file.Files.isRegularFile(marker)) return 0;
            return Integer.parseInt(java.nio.file.Files.readString(marker).trim());
        } catch (Exception unreadable) {
            return 0;
        }
    }

    public void setBuiltVersion(String what, int version) {
        try {
            java.nio.file.Files.writeString(
                    nexus.getDataFolder().toPath().resolve(what + ".version"),
                    Integer.toString(version));
        } catch (Exception e) {
            nexus.getLogger().warning("could not record the " + what
                    + " version: " + e);
        }
    }

    /**
     * Where players land in the hub.
     *
     * Falls back to the generated spawn, so a half-filled config never drops
     * somebody into the void — the commonest way a config like this goes wrong
     * is being switched on before the coordinates are filled in.
     */
    public Location hubSpawn(World hub, Location fallback) {
        if (!customSpawn() || !config().isSet("spawn.at.x")) return fallback;

        return new Location(hub,
                config().getDouble("spawn.at.x"),
                config().getDouble("spawn.at.y"),
                config().getDouble("spawn.at.z"),
                (float) config().getDouble("spawn.at.yaw"),
                (float) config().getDouble("spawn.at.pitch"));
    }

    /** Where the NPC with this id stands, or the first of several. */
    public Location npcAt(String id, World hub, Location fallback) {
        java.util.List<Location> all = npcsAt(id, hub);
        return all.isEmpty() ? fallback : all.get(0);
    }

    /**
     * Every position recorded for one bot id.
     *
     * There can be more than one now. A server wants a crate on each side of
     * the plaza and a shopkeeper at both entrances, and one position per id
     * made that impossible — placing a second simply moved the first, which
     * looks like the wand not working.
     *
     * Two shapes are read, because the older one is already written into
     * configs: a single position directly under the id, or a numbered list of
     * them. Anything already set up keeps working untouched.
     */
    public java.util.List<Location> npcsAt(String id, World hub) {
        java.util.List<Location> found = new java.util.ArrayList<>();
        String path = "spawn.npcs." + id;

        if (config().isSet(path + ".x")) {
            found.add(read(hub, path));
            return found;
        }

        var section = config().getConfigurationSection(path);
        if (section == null) return found;

        // Numbered keys, in order, so the list is stable between restarts.
        var keys = new java.util.ArrayList<>(section.getKeys(false));
        keys.sort(java.util.Comparator.comparingInt(key -> {
            try {
                return Integer.parseInt(key);
            } catch (NumberFormatException notANumber) {
                return Integer.MAX_VALUE;
            }
        }));

        for (String key : keys) {
            if (config().isSet(path + "." + key + ".x")) {
                found.add(read(hub, path + "." + key));
            }
        }
        return found;
    }

    private Location read(World hub, String path) {
        return new Location(hub,
                config().getDouble(path + ".x"),
                config().getDouble(path + ".y"),
                config().getDouble(path + ".z"),
                (float) config().getDouble(path + ".yaw"),
                (float) config().getDouble(path + ".pitch"));
    }

    /**
     * Writes a position into the config from where somebody is standing.
     *
     * Typing coordinates by hand is how an NPC ends up half a block inside a
     * wall. Standing where you want them and running a command is the only
     * version of this anybody actually uses.
     */
    /** Replaces every position for this id with one. */
    public void setNpc(String id, Location at) {
        config().set("spawn.npcs." + id, null);
        addNpc(id, at);
    }

    /** Adds another of this bot without disturbing the ones already placed. */
    public void addNpc(String id, Location at) {
        String path = "spawn.npcs." + id;

        // An old single-position entry is folded into the list first, or the
        // two shapes would end up in the same key and neither would read.
        if (config().isSet(path + ".x")) {
            Location had = read(at.getWorld(), path);
            config().set(path, null);
            write(path + ".0", had);
            write(path + ".1", at);
            nexus.saveConfig();
            return;
        }

        var section = config().getConfigurationSection(path);
        int next = section == null ? 0 : section.getKeys(false).size();

        write(path + "." + next, at);
        nexus.saveConfig();
    }

    /** Removes them all, or just the last one placed. */
    public boolean clearNpc(String id, boolean onlyLast) {
        String path = "spawn.npcs." + id;

        if (!onlyLast || config().isSet(path + ".x")) {
            boolean had = config().isSet(path);
            config().set(path, null);
            nexus.saveConfig();
            return had;
        }

        var section = config().getConfigurationSection(path);
        if (section == null || section.getKeys(false).isEmpty()) return false;

        var keys = new java.util.ArrayList<>(section.getKeys(false));
        keys.sort(java.util.Comparator.comparingInt(Integer::parseInt));

        config().set(path + "." + keys.get(keys.size() - 1), null);
        nexus.saveConfig();
        return true;
    }

    /* -------------------------------------------------------------- portals */

    /**
     * Somewhere the launcher remembers, by name.
     *
     * The same shape as the portal store and for the same reason: a position
     * somebody chose by standing in it, rather than a number in the source.
     */
    public Location spotAt(String key, World world) {
        String path = "spawn.spots." + key;
        if (!config().isSet(path + ".x")) return null;

        return read(world, path);
    }

    public void setSpot(String key, Location at) {
        write("spawn.spots." + key, at);
        nexus.saveConfig();
    }

    public boolean clearSpot(String key) {
        if (!config().isSet("spawn.spots." + key + ".x")) return false;

        config().set("spawn.spots." + key, null);
        nexus.saveConfig();
        return true;
    }

    public boolean hasPortal(String id) {
        return config().isSet("spawn.portals." + id + ".x");
    }

    /** Where somebody stood when they placed it, or null if there is none. */
    public Location portalAt(String id, World hub) {
        String path = "spawn.portals." + id;
        if (!config().isSet(path + ".x")) return null;

        return read(hub, path);
    }

    public void setPortal(String id, Location at) {
        write("spawn.portals." + id, at);
        nexus.saveConfig();
    }

    public boolean clearPortal(String id) {
        if (!hasPortal(id)) return false;

        config().set("spawn.portals." + id, null);
        nexus.saveConfig();
        return true;
    }

    /* ------------------------------------------------------------- builders */

    /**
     * Who is mid-build, remembered across restarts.
     *
     * Held in the config rather than in memory because it was in memory, and
     * every restart quietly dropped whoever was building back into adventure
     * mode with the lobby locked. Nothing said so - the lobby simply stopped
     * accepting blocks - which reads exactly like the feature being broken.
     */
    public java.util.Set<java.util.UUID> builders() {
        java.util.Set<java.util.UUID> out = new java.util.HashSet<>();

        for (String raw : config().getStringList("spawn.builders")) {
            try {
                out.add(java.util.UUID.fromString(raw));
            } catch (IllegalArgumentException notAnId) {
                /* Someone edited the file by hand; skip it rather than fail. */
            }
        }
        return out;
    }

    public void setBuilders(java.util.Set<java.util.UUID> who) {
        java.util.List<String> raw = new java.util.ArrayList<>();
        for (java.util.UUID id : who) raw.add(id.toString());

        config().set("spawn.builders", raw);
        nexus.saveConfig();
    }

    private void write(String path, Location at) {
        config().set(path + ".x", at.getX());
        config().set(path + ".y", at.getY());
        config().set(path + ".z", at.getZ());
        config().set(path + ".yaw", at.getYaw());
        config().set(path + ".pitch", at.getPitch());
    }

    public void setSpawn(Location at) {
        config().set("spawn.at.x", at.getX());
        config().set("spawn.at.y", at.getY());
        config().set("spawn.at.z", at.getZ());
        config().set("spawn.at.yaw", at.getYaw());
        config().set("spawn.at.pitch", at.getPitch());
        config().set("spawn.custom", true);
        nexus.saveConfig();
    }
}
