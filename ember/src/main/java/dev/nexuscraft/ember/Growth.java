package dev.nexuscraft.ember;

import net.fabricmc.loader.api.FabricLoader;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Ember getting older, and better at what it does.
 *
 * It was the same on the first night as on the two hundredth, which makes it a
 * tool rather than a companion — nothing about it could tell you it had been
 * anywhere. This is the record of what the two of you have actually done: how
 * long it has been with you, how much dark it has pushed back, and how often it
 * has put itself between you and something.
 *
 * Deliberately not experience points. There is nothing to grind and no bar to
 * fill; the numbers are things that happened, and the stages are what those
 * numbers add up to. An Ember on day two hundred is brighter because it has
 * lit two hundred days of caves, not because it levelled up.
 */
public final class Growth {

    /** What a companion becomes, given enough nights. */
    public enum Stage {
        /** A few days old. Small flame, short reach, easily rattled. */
        SPARK(0, 7, 45, 240, "a spark"),

        /** It has found its footing. */
        STEADY(1, 9, 38, 200, "steady"),

        /** Confident, and noticeably brighter. */
        BRIGHT(2, 12, 30, 160, "bright"),

        /** Old. The copper has gone green and the light carries. */
        ELDER(3, 16, 22, 120, "old");

        private final byte id;

        /** How far it looks for dark to fix. */
        public final int lightRadius;

        /** Ticks between torches; lower is more diligent. */
        public final int lightInterval;

        /** Ticks between flares. */
        public final int flareCooldown;

        /** A word for it, for the model to use. */
        public final String word;

        Stage(int id, int lightRadius, int lightInterval, int flareCooldown, String word) {
            this.id = (byte) id;
            this.lightRadius = lightRadius;
            this.lightInterval = lightInterval;
            this.flareCooldown = flareCooldown;
            this.word = word;
        }

        public byte id() {
            return id;
        }

        public static Stage byId(byte id) {
            for (Stage stage : values()) {
                if (stage.id == id) return stage;
            }
            return SPARK;
        }
    }

    /** Everything that counts toward it, and nothing that does not. */
    public record Life(long firstDay, long lastDay, int torches, int flares) {
        public long daysTogether() {
            return Math.max(0, lastDay - firstDay);
        }

        /**
         * What all of it adds up to.
         *
         * Time carries the most weight, because that is what "old" means, but
         * work counts too — an Ember that has lit a thousand torches in a
         * fortnight has earned more than one that hovered through a month.
         */
        public Stage stage() {
            long score = daysTogether() * 3L + torches / 12L + flares * 2L;
            if (score >= 260) return Stage.ELDER;
            if (score >= 90) return Stage.BRIGHT;
            if (score >= 24) return Stage.STEADY;
            return Stage.SPARK;
        }
    }

    private static final Map<UUID, Life> LIVES = new LinkedHashMap<>();
    private static boolean loaded;

    private Growth() {
    }

    /* ------------------------------------------------------------ reading */

    public static synchronized Life of(UUID who) {
        load();
        return LIVES.getOrDefault(who, new Life(0, 0, 0, 0));
    }

    public static synchronized Stage stageOf(UUID who) {
        return of(who).stage();
    }

    /** A line for the model, so it can talk about its own age truthfully. */
    public static synchronized String describe(UUID who) {
        load();
        Life life = LIVES.get(who);
        if (life == null) return null;

        return "About yourself: you have been with them " + life.daysTogether()
                + (life.daysTogether() == 1 ? " day" : " days")
                + ", you have placed " + life.torches() + " torches for them"
                + (life.flares() > 0 ? ", and driven something off them " + life.flares()
                    + (life.flares() == 1 ? " time" : " times") : "")
                + ". You are " + life.stage().word + " now.";
    }

    /* ------------------------------------------------------------ writing */

    /** Called whenever Ember is with someone, to keep the day count honest. */
    public static synchronized void seen(UUID who, long day) {
        load();
        Life life = LIVES.get(who);

        if (life == null) {
            LIVES.put(who, new Life(day, day, 0, 0));
            save();
            return;
        }

        // Only a change of day is worth writing to disk.
        if (day <= life.lastDay()) return;
        LIVES.put(who, new Life(life.firstDay(), day, life.torches(), life.flares()));
        save();
    }

    public static synchronized void placedTorch(UUID who) {
        bump(who, 1, 0);
    }

    public static synchronized void flared(UUID who) {
        bump(who, 0, 1);
    }

    private static void bump(UUID who, int torches, int flares) {
        load();
        Life life = LIVES.getOrDefault(who, new Life(0, 0, 0, 0));
        LIVES.put(who, new Life(life.firstDay(), life.lastDay(),
                life.torches() + torches, life.flares() + flares));

        /*
         * Written every twenty torches rather than every one.
         *
         * A torch goes down every couple of seconds when it is working hard,
         * and rewriting a file that often for a counter is a waste. Losing a
         * few on a crash costs nothing anyone would notice.
         */
        if ((life.torches() + torches) % 20 == 0 || flares > 0) save();
    }

    /* ---------------------------------------------------------- the file */

    private static Path file() {
        return FabricLoader.getInstance().getConfigDir().resolve("ember-growth.json");
    }

    private static void load() {
        if (loaded) return;
        loaded = true;

        Path path = file();
        if (!Files.exists(path)) return;

        try {
            String body = Files.readString(path, StandardCharsets.UTF_8);
            java.util.regex.Matcher entry = java.util.regex.Pattern
                    .compile("\"([0-9a-fA-F-]{36})\"\\s*:\\s*\\{([^}]*)}")
                    .matcher(body);

            while (entry.find()) {
                try {
                    String chunk = "{" + entry.group(2) + "}";
                    LIVES.put(UUID.fromString(entry.group(1)), new Life(
                            dev.nexuscraft.ember.ai.Json.intField(chunk, "firstDay", 0),
                            dev.nexuscraft.ember.ai.Json.intField(chunk, "lastDay", 0),
                            dev.nexuscraft.ember.ai.Json.intField(chunk, "torches", 0),
                            dev.nexuscraft.ember.ai.Json.intField(chunk, "flares", 0)));
                } catch (IllegalArgumentException ignored) {
                    // One unreadable line costs one Ember's history, not the file.
                }
            }
        } catch (Exception e) {
            Ember.LOG.warn("could not read the growth file: {}", e.getMessage());
        }
    }

    private static void save() {
        StringBuilder out = new StringBuilder("{\n");
        boolean first = true;

        for (Map.Entry<UUID, Life> e : LIVES.entrySet()) {
            if (!first) out.append(",\n");
            first = false;
            Life l = e.getValue();
            out.append("  \"").append(e.getKey()).append("\": {")
               .append("\"firstDay\":").append(l.firstDay()).append(',')
               .append("\"lastDay\":").append(l.lastDay()).append(',')
               .append("\"torches\":").append(l.torches()).append(',')
               .append("\"flares\":").append(l.flares()).append('}');
        }

        try {
            Files.createDirectories(file().getParent());
            Files.writeString(file(), out.append("\n}\n").toString(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            Ember.LOG.warn("could not write the growth file: {}", e.getMessage());
        }
    }
}
