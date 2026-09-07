package dev.nexuscraft.ember;

import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.util.math.BlockPos;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * The two places Ember keeps track of: where you live, and where you died.
 *
 * The journal already writes both down in prose, which is enough to talk about
 * and useless to walk to. These are the same facts as coordinates, so it can
 * actually lead you there — and the death one matters most, because it is the
 * moment a companion is worth having.
 *
 * Home is not asked for. It is wherever you last slept, which is the game's own
 * definition and needs no explaining; saying "this is home" overrides it.
 */
public final class Waypoints {

    public record Spot(String world, int x, int y, int z, long day) {
        public BlockPos pos() {
            return new BlockPos(x, y, z);
        }

        public String describe() {
            return x + ", " + y + ", " + z;
        }
    }

    private static final Map<UUID, Spot> HOMES = new LinkedHashMap<>();
    private static final Map<UUID, Spot> DEATHS = new LinkedHashMap<>();
    private static boolean loaded;

    private Waypoints() {
    }

    /* ------------------------------------------------------------ writing */

    public static synchronized void setHome(UUID who, String world, BlockPos at, long day) {
        load();
        HOMES.put(who, new Spot(world, at.getX(), at.getY(), at.getZ(), day));
        save();
    }

    public static synchronized void setDeath(UUID who, String world, BlockPos at, long day) {
        load();
        DEATHS.put(who, new Spot(world, at.getX(), at.getY(), at.getZ(), day));
        save();
    }

    /* ------------------------------------------------------------ reading */

    public static synchronized Spot home(UUID who) {
        load();
        return HOMES.get(who);
    }

    public static synchronized Spot death(UUID who) {
        load();
        return DEATHS.get(who);
    }

    /** A line for the model, so it can mention them without being led to them. */
    public static synchronized String describe(UUID who) {
        load();
        Spot home = HOMES.get(who);
        Spot death = DEATHS.get(who);
        if (home == null && death == null) return null;

        StringBuilder out = new StringBuilder("Places you know: ");
        if (home != null) out.append("their home is at ").append(home.describe()).append(". ");
        if (death != null) out.append("they last died at ").append(death.describe()).append(". ");
        return out.toString().trim();
    }

    /* ---------------------------------------------------------- the file */

    private static Path file() {
        return FabricLoader.getInstance().getConfigDir().resolve("ember-places.json");
    }

    private static void load() {
        if (loaded) return;
        loaded = true;

        Path path = file();
        if (!Files.exists(path)) return;

        try {
            String body = Files.readString(path, StandardCharsets.UTF_8);
            parseInto(body, "homes", HOMES);
            parseInto(body, "deaths", DEATHS);
        } catch (Exception e) {
            Ember.LOG.warn("could not read the places file: {}", e.getMessage());
        }
    }

    private static void parseInto(String body, String section, Map<UUID, Spot> into) {
        int at = body.indexOf('"' + section + '"');
        if (at < 0) return;

        int open = body.indexOf('{', at);
        int close = body.indexOf('}', open);
        // Each entry is itself an object, so walk them rather than slicing once.
        java.util.regex.Matcher entry = java.util.regex.Pattern
                .compile("\"([0-9a-fA-F-]{36})\"\\s*:\\s*\\{([^}]*)}")
                .matcher(body.substring(open < 0 ? 0 : open));

        while (entry.find()) {
            try {
                UUID who = UUID.fromString(entry.group(1));
                String chunk = "{" + entry.group(2) + "}";
                if (into.containsKey(who)) continue;
                into.put(who, new Spot(
                        String.valueOf(dev.nexuscraft.ember.ai.Json.stringField(chunk, "world")),
                        dev.nexuscraft.ember.ai.Json.intField(chunk, "x", 0),
                        dev.nexuscraft.ember.ai.Json.intField(chunk, "y", 64),
                        dev.nexuscraft.ember.ai.Json.intField(chunk, "z", 0),
                        dev.nexuscraft.ember.ai.Json.intField(chunk, "day", 0)));
            } catch (IllegalArgumentException ignored) {
                // A line that will not parse costs one waypoint, not the file.
            }
            if (close > 0 && entry.end() > close - open) break;
        }
    }

    private static void save() {
        try {
            Files.createDirectories(file().getParent());
            Files.writeString(file(), write(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            Ember.LOG.warn("could not write the places file: {}", e.getMessage());
        }
    }

    private static String write() {
        StringBuilder out = new StringBuilder("{\n  \"homes\": {\n");
        out.append(section(HOMES));
        out.append("  },\n  \"deaths\": {\n");
        out.append(section(DEATHS));
        return out.append("  }\n}\n").toString();
    }

    private static String section(Map<UUID, Spot> from) {
        StringBuilder out = new StringBuilder();
        boolean first = true;
        for (Map.Entry<UUID, Spot> e : from.entrySet()) {
            if (!first) out.append(",\n");
            first = false;
            Spot s = e.getValue();
            out.append("    \"").append(e.getKey()).append("\": {")
               .append("\"world\":\"").append(s.world()).append("\",")
               .append("\"x\":").append(s.x()).append(',')
               .append("\"y\":").append(s.y()).append(',')
               .append("\"z\":").append(s.z()).append(',')
               .append("\"day\":").append(s.day()).append('}');
        }
        if (!first) out.append('\n');
        return out.toString();
    }
}
