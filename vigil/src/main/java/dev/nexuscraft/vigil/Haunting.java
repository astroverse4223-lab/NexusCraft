package dev.nexuscraft.vigil;

import net.fabricmc.loader.api.FabricLoader;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Properties;
import java.util.UUID;

/**
 * What it remembers about each person it has followed.
 *
 * Three facts, and they all exist to stop the mod being the same night twice.
 * How many times it has reached you decides how much the next one costs. When
 * it is next allowed to come decides that beating it buys you real quiet rather
 * than four seconds. And which night it last rolled for you stops one long
 * evening turning into six separate hauntings.
 *
 * A properties file rather than world data: it is three numbers per player, it
 * wants to survive a server restart, and a haunting that follows you between
 * worlds is thematically better than one that does not.
 */
public final class Haunting {

    private static final Properties STATE = new Properties();
    private static boolean loaded;

    private Haunting() {
    }

    /* --------------------------------------------------------------- reading */

    /** How many times it has actually reached this person. */
    public static synchronized int contacts(UUID who) {
        return number(who + ".contacts", 0);
    }

    /** Whether it is currently serving out a defeat. */
    public static synchronized boolean dormant(UUID who) {
        return System.currentTimeMillis() < number(who + ".dormantUntil", 0L);
    }

    /** The last in-game day it was rolled for, so a night rolls once. */
    public static synchronized long lastRolled(UUID who) {
        return number(who + ".lastRolled", -1L);
    }

    /* --------------------------------------------------------------- writing */

    public static synchronized void reached(UUID who) {
        set(who + ".contacts", contacts(who) + 1);
        rest(who, VigilConfig.get().dormantMinutes);
    }

    /** Sent away, either by being stared down or by somebody's command. */
    public static synchronized void rest(UUID who, int minutes) {
        set(who + ".dormantUntil", System.currentTimeMillis() + minutes * 60_000L);
    }

    public static synchronized void rolled(UUID who, long day) {
        set(who + ".lastRolled", day);
    }

    /** Everything forgotten — a fresh start for that player. */
    public static synchronized void forget(UUID who) {
        load();
        STATE.remove(who + ".contacts");
        STATE.remove(who + ".dormantUntil");
        STATE.remove(who + ".lastRolled");
        save();
    }

    /* ------------------------------------------------------------- the file */

    private static long number(String key, long fallback) {
        load();
        String raw = STATE.getProperty(key);
        if (raw == null) return fallback;
        try {
            return Long.parseLong(raw.trim());
        } catch (NumberFormatException e) {
            return fallback;
        }
    }

    private static int number(String key, int fallback) {
        return (int) number(key, (long) fallback);
    }

    private static void set(String key, long value) {
        load();
        STATE.setProperty(key, Long.toString(value));
        save();
    }

    private static Path file() {
        return FabricLoader.getInstance().getConfigDir().resolve("vigil-haunting.properties");
    }

    private static void load() {
        if (loaded) return;
        loaded = true;

        Path path = file();
        if (!Files.exists(path)) return;

        try (InputStream in = Files.newInputStream(path)) {
            STATE.load(in);
        } catch (IOException e) {
            Vigil.LOG.warn("could not read the haunting file: {}", e.getMessage());
        }
    }

    private static void save() {
        try {
            Files.createDirectories(file().getParent());
            try (OutputStream out = Files.newOutputStream(file())) {
                STATE.store(out, "Vigil — who it has followed, and how far it got.");
            }
        } catch (IOException e) {
            Vigil.LOG.warn("could not write the haunting file: {}", e.getMessage());
        }
    }
}
