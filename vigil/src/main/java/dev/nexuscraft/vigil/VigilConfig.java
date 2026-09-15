package dev.nexuscraft.vigil;

import net.fabricmc.loader.api.FabricLoader;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Properties;

/**
 * config/vigil.properties.
 *
 * A horror mod needs a volume knob more than most. Some people want it on every
 * night and some want it once a month, and the difference between "unsettling"
 * and "unplayable" is entirely in these numbers.
 */
public final class VigilConfig {

    private static VigilConfig current;

    /** False stops it ever arriving on its own. The command still works. */
    public final boolean hunt;

    /** Chance per night, per player, that one begins following them. */
    public final double nightlyChance;

    /** How many blocks it crosses each time it moves, unwatched. */
    public final double stride;

    /** Ticks between moves while unwatched — how fast it closes. */
    public final int moveInterval;

    /** Seconds of unbroken watching before it gives up and leaves. */
    public final int staredownSeconds;

    /** Whether spectators count as watchers. */
    public final boolean spectatorsWatch;

    /** Damage on the first time it reaches you is always zero; this is after. */
    public final double contactDamage;

    /** Minutes it stays away after reaching someone. */
    public final int dormantMinutes;

    private VigilConfig(Properties p) {
        this.hunt = !"false".equalsIgnoreCase(p.getProperty("hunt", "true").trim());
        this.nightlyChance = clamp(parseDouble(p.getProperty("nightlyChance"), 0.15), 0.0, 1.0);
        this.stride = clamp(parseDouble(p.getProperty("stride"), 4.0), 0.5, 24.0);
        this.moveInterval = parseInt(p.getProperty("moveInterval"), 8, 1, 200);
        this.staredownSeconds = parseInt(p.getProperty("staredownSeconds"), 9, 1, 120);
        this.spectatorsWatch = !"false".equalsIgnoreCase(p.getProperty("spectatorsWatch", "true").trim());
        this.contactDamage = clamp(parseDouble(p.getProperty("contactDamage"), 6.0), 0.0, 1000.0);
        this.dormantMinutes = parseInt(p.getProperty("dormantMinutes"), 3, 0, 240);
    }

    public static synchronized VigilConfig get() {
        if (current == null) current = load();
        return current;
    }

    /** Forgets what was read, so an edited file takes effect without a restart. */
    public static synchronized void reload() {
        current = null;
    }

    private static Path file() {
        return FabricLoader.getInstance().getConfigDir().resolve("vigil.properties");
    }

    private static VigilConfig load() {
        Properties properties = new Properties();
        Path path = file();

        if (Files.exists(path)) {
            try (InputStream in = Files.newInputStream(path)) {
                properties.load(in);
            } catch (IOException e) {
                Vigil.LOG.warn("could not read vigil.properties, using defaults: {}", e.getMessage());
            }
        } else {
            write(path);
        }

        return new VigilConfig(properties);
    }

    private static void write(Path path) {
        try {
            Files.createDirectories(path.getParent());
            try (OutputStream out = Files.newOutputStream(path)) {
                out.write(TEMPLATE.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            }
            Vigil.LOG.info("wrote a default {}", path);
        } catch (IOException e) {
            Vigil.LOG.warn("could not write vigil.properties: {}", e.getMessage());
        }
    }

    private static final String TEMPLATE = """
            # Vigil.
            #
            # Something follows you home. It cannot move while it is being
            # looked at, and it has all night.

            # false and it never comes on its own. /vigil send still works.
            hunt=true

            # Chance each nightfall, for each player, that one starts following.
            # 0.15 is roughly one week in seven. Turn it down for a long slow
            # dread, up if you want to be hunted properly.
            nightlyChance=0.15

            # How far it crosses each time it moves, and how often it moves.
            # Both together decide how fast it closes on you: the default is
            # four blocks every eight ticks, which is a fast walk. Raising the
            # stride is much more frightening than shortening the interval,
            # because the distance it covers in one blink is what you notice.
            stride=4.0
            moveInterval=8

            # Hold your eyes on it for this long, unbroken, and it gives up for
            # the night. This is the only way to win, so it should be long
            # enough to hurt: nine seconds is a long time to stand still in a
            # cave with your pickaxe down.
            staredownSeconds=9

            # Whether someone in spectator mode can pin it in place.
            spectatorsWatch=true

            # What it costs when it reaches you. The first time it ever reaches
            # a player it does no damage at all, whatever this says — that one
            # is an introduction. Set to 0 if you want it never to hurt anyone
            # and only ever to be horrible.
            contactDamage=6.0

            # How long it stays away afterwards.
            dormantMinutes=3
            """;

    private static int parseInt(String raw, int fallback, int min, int max) {
        if (raw == null) return fallback;
        try {
            return Math.max(min, Math.min(max, Integer.parseInt(raw.trim())));
        } catch (NumberFormatException e) {
            return fallback;
        }
    }

    private static double parseDouble(String raw, double fallback) {
        if (raw == null) return fallback;
        try {
            return Double.parseDouble(raw.trim());
        } catch (NumberFormatException e) {
            return fallback;
        }
    }

    private static double clamp(double value, double min, double max) {
        return Math.max(min, Math.min(max, value));
    }
}
