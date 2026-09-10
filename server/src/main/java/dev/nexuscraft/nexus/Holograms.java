package dev.nexuscraft.nexus;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextDecoration;
import org.bukkit.Color;
import org.bukkit.Location;
import org.bukkit.World;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.entity.Display;
import org.bukkit.entity.Entity;
import org.bukkit.entity.TextDisplay;
import org.bukkit.util.Transformation;
import org.joml.AxisAngle4f;
import org.joml.Vector3f;

import java.io.File;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Floating text, at whatever size you want it.
 *
 * Rebuilt on text display entities rather than armour stands. The old version
 * worked and could not be resized at all — a name tag is drawn at one fixed
 * size, and every "big" hologram made of armour stands is really just more
 * lines. A display entity carries a transformation, so a title can genuinely be
 * four times the size of the line under it.
 *
 * The move fixes three other things quietly. One entity now holds every line
 * instead of one per line, so a hologram cannot half-disappear; the text turns
 * to face whoever is reading it; and there is a dark panel available behind it,
 * which is the difference between readable and not against a bright build.
 */
public final class Holograms {

    /** Marks ours, so nothing in somebody's build is ever touched. */
    public static final String TAG = "nexus_hologram";

    /** Text that stands in for a live value, rewritten every few seconds. */
    public static final String LEADERBOARD = "{leaderboard}";
    public static final String ONLINE = "{online}";

    private final Nexus nexus;
    private final File file;

    private final List<Standing> standing = new ArrayList<>();

    /**
     * One hologram, stored by world *name* rather than by world.
     *
     * This is the whole fix. Holograms are loaded when the plugin starts, and
     * at that moment the lobby world has not been loaded yet — so resolving the
     * name to a World returned nothing and every hologram was silently dropped.
     * They then never came back after a restart, and the next time anything
     * called save() the empty list was written over the file and they were gone
     * for good.
     *
     * A name cannot fail to resolve at the wrong moment because it is not
     * resolved until something actually needs to draw it.
     */
    private record Standing(String world, double x, double y, double z,
                            List<String> lines, float scale, boolean backdrop) {

        /** The place this sits, or null if that world is not loaded. */
        Location at(Nexus nexus) {
            World found = nexus.getServer().getWorld(world);
            return found == null ? null : new Location(found, x, y, z);
        }

        Standing movedTo(double newY) {
            return new Standing(world, x, newY, z, lines, scale, backdrop);
        }

        Standing sized(float newScale) {
            return new Standing(world, x, y, z, lines, newScale, backdrop);
        }

        Standing panelled(boolean on) {
            return new Standing(world, x, y, z, lines, scale, on);
        }
    }

    public Holograms(Nexus nexus) {
        this.nexus = nexus;
        this.file = new File(nexus.getDataFolder(), "holograms.yml");
        load();
    }

    /* ------------------------------------------------------------- placing */

    public void add(Location at, List<String> lines) {
        add(at, lines, 1.0f, false);
    }

    public void add(Location at, List<String> lines, float scale, boolean backdrop) {
        if (at.getWorld() == null) return;

        standing.add(new Standing(at.getWorld().getName(),
                at.getX(), at.getY(), at.getZ(),
                new ArrayList<>(lines), scale, backdrop));
        save();
        rebuild();
    }

    public boolean removeNearest(Location to) {
        Standing nearest = nearestTo(to);
        if (nearest == null) return false;

        standing.remove(nearest);
        save();
        rebuild();
        return true;
    }

    /** Grows or shrinks whichever is nearest. Returns the new size, or -1. */
    public float resizeNearest(Location to, float scale) {
        Standing nearest = nearestTo(to);
        if (nearest == null) return -1;

        // Bounded: below a quarter it is unreadable and above ten it is a wall.
        float clamped = Math.max(0.25f, Math.min(10f, scale));

        standing.set(standing.indexOf(nearest), nearest.sized(clamped));
        save();
        rebuild();
        return clamped;
    }

    /** Moves the nearest up or down, since eye height is never quite right. */
    public boolean raiseNearest(Location to, double by) {
        Standing nearest = nearestTo(to);
        if (nearest == null) return false;

        standing.set(standing.indexOf(nearest), nearest.movedTo(nearest.y() + by));
        save();
        rebuild();
        return true;
    }

    /** Toggles the dark panel behind the text. */
    public boolean backdropNearest(Location to) {
        Standing nearest = nearestTo(to);
        if (nearest == null) return false;

        standing.set(standing.indexOf(nearest), nearest.panelled(!nearest.backdrop()));
        save();
        rebuild();
        return true;
    }

    private Standing nearestTo(Location to) {
        if (to.getWorld() == null) return null;
        String here = to.getWorld().getName();

        Standing nearest = standing.stream()
                .filter(one -> one.world().equals(here))
                .min(Comparator.comparingDouble(one -> away(one, to)))
                .orElse(null);

        return nearest == null || away(nearest, to) > 64 ? null : nearest;
    }

    private static double away(Standing one, Location to) {
        double dx = one.x() - to.getX();
        double dy = one.y() - to.getY();
        double dz = one.z() - to.getZ();
        return dx * dx + dy * dy + dz * dz;
    }

    public int count() {
        return standing.size();
    }

    /** Redraws any signs belonging to a chunk that has just loaded. */
    public void drawInChunk(org.bukkit.Chunk chunk) {
        for (var entity : chunk.getEntities()) {
            if (entity.getScoreboardTags().contains(TAG)) entity.remove();
        }

        for (Standing one : standing) {
            Location at = one.at(nexus);
            if (at == null || !at.getWorld().equals(chunk.getWorld())) continue;

            if ((at.getBlockX() >> 4) == chunk.getX()
                    && (at.getBlockZ() >> 4) == chunk.getZ()) {
                draw(at.getWorld(), one, at);
            }
        }
    }

    public void clearAll() {
        standing.clear();
        save();
        rebuild();
    }

    /* ------------------------------------------------------------- drawing */

    public void rebuild() {
        for (World world : nexus.getServer().getWorlds()) {
            for (Entity entity : world.getEntities()) {
                if (entity.getScoreboardTags().contains(TAG)) entity.remove();
            }
        }

        for (Standing one : standing) {
            Location at = one.at(nexus);
            if (at == null) continue;

            // Only into chunks already loaded. Drawing into an unloaded one
            // would load it, and a lobby spread over a whole map would then
            // keep hundreds of chunks ticking for the sake of scenery.
            if (!at.getWorld().isChunkLoaded(at.getBlockX() >> 4, at.getBlockZ() >> 4)) {
                continue;
            }
            draw(at.getWorld(), one, at);
        }
    }

    /**
     * One display entity holding the whole hologram.
     *
     * Every line in a single entity, joined by newlines, for two reasons: a
     * hologram made of several entities can lose one and leave a gap nobody can
     * explain, and a scale applied to five stacked entities spaces them wrongly
     * the moment it is not exactly 1.
     */
    private void draw(World world, Standing one, Location at) {
        Component text = Component.empty();
        List<String> lines = expand(one.lines());

        for (int i = 0; i < lines.size(); i++) {
            if (i > 0) text = text.append(Component.newline());
            text = text.append(colour(lines.get(i)));
        }

        Component built = text;

        world.spawn(at, TextDisplay.class, display -> {
            display.text(built);

            // Turns to face the reader, which is the whole reason to prefer
            // these: a flat hologram is unreadable from three quarters of the
            // places somebody might be standing.
            display.setBillboard(Display.Billboard.CENTER);
            display.setAlignment(TextDisplay.TextAlignment.CENTER);
            display.setShadowed(true);
            display.setSeeThrough(false);
            display.setPersistent(false);
            display.setViewRange(2.0f);

            display.setDefaultBackground(false);
            display.setBackgroundColor(one.backdrop()
                    ? Color.fromARGB(140, 0, 0, 0) : Color.fromARGB(0, 0, 0, 0));

            display.setTransformation(new Transformation(
                    new Vector3f(0, 0, 0),
                    new AxisAngle4f(0, 0, 0, 1),
                    new Vector3f(one.scale(), one.scale(), one.scale()),
                    new AxisAngle4f(0, 0, 0, 1)));

            display.addScoreboardTag(TAG);
        });
    }

    /** Turns the placeholders into what they stand for. */
    private List<String> expand(List<String> lines) {
        List<String> out = new ArrayList<>();

        for (String line : lines) {
            String trimmed = line.trim();

            if (trimmed.equals(LEADERBOARD)) {
                var top = nexus.stats().top(
                        Comparator.comparingInt(record -> record.wins), 10);

                if (top.isEmpty()) {
                    out.add("&7Nobody has won anything yet");
                    continue;
                }

                int place = 1;
                for (Map.Entry<UUID, Stats.Record> entry : top) {
                    String name = nexus.getServer().getOfflinePlayer(entry.getKey()).getName();
                    out.add("&8" + place++ + ". &f" + (name == null ? "someone" : name)
                            + "  &b" + entry.getValue().wins + " wins");
                }
            } else if (trimmed.equals(ONLINE)) {
                out.add("&b" + nexus.getServer().getOnlinePlayers().size() + " &7online");
            } else if (trimmed.startsWith("{players:") && trimmed.endsWith("}")) {
                int count = nexus.hub().countAt(trimmed.substring(9, trimmed.length() - 1));
                out.add(count < 0 ? "&8?" : "&b" + count + " &7playing");
            } else {
                out.add(line);
            }
        }

        return out;
    }

    /** Ampersand colour codes, because that is what people expect to work. */
    private Component colour(String text) {
        Component out = Component.empty();
        NamedTextColor current = NamedTextColor.WHITE;
        boolean bold = false;

        StringBuilder run = new StringBuilder();
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);

            if (c != '&' || i + 1 >= text.length()) {
                run.append(c);
                continue;
            }

            if (run.length() > 0) {
                out = out.append(Component.text(run.toString(), current)
                        .decoration(TextDecoration.BOLD, bold));
                run.setLength(0);
            }

            char code = Character.toLowerCase(text.charAt(++i));
            if (code == 'l') bold = true;
            else if (code == 'r') {
                bold = false;
                current = NamedTextColor.WHITE;
            } else {
                NamedTextColor found = byCode(code);
                if (found != null) current = found;
            }
        }

        if (run.length() > 0) {
            out = out.append(Component.text(run.toString(), current)
                    .decoration(TextDecoration.BOLD, bold));
        }
        return out;
    }

    private NamedTextColor byCode(char code) {
        return switch (code) {
            case '0' -> NamedTextColor.BLACK;
            case '1' -> NamedTextColor.DARK_BLUE;
            case '2' -> NamedTextColor.DARK_GREEN;
            case '3' -> NamedTextColor.DARK_AQUA;
            case '4' -> NamedTextColor.DARK_RED;
            case '5' -> NamedTextColor.DARK_PURPLE;
            case '6' -> NamedTextColor.GOLD;
            case '7' -> NamedTextColor.GRAY;
            case '8' -> NamedTextColor.DARK_GRAY;
            case '9' -> NamedTextColor.BLUE;
            case 'a' -> NamedTextColor.GREEN;
            case 'b' -> NamedTextColor.AQUA;
            case 'c' -> NamedTextColor.RED;
            case 'd' -> NamedTextColor.LIGHT_PURPLE;
            case 'e' -> NamedTextColor.YELLOW;
            case 'f' -> NamedTextColor.WHITE;
            default -> null;
        };
    }

    /* -------------------------------------------------------------- on disk */

    private void load() {
        if (!file.exists()) return;

        YamlConfiguration yaml = YamlConfiguration.loadConfiguration(file);
        for (String key : yaml.getKeys(false)) {
            String world = yaml.getString(key + ".world", "");
            if (world.isEmpty()) continue;

            standing.add(new Standing(world,
                    yaml.getDouble(key + ".x"),
                    yaml.getDouble(key + ".y"),
                    yaml.getDouble(key + ".z"),
                    yaml.getStringList(key + ".lines"),
                    (float) yaml.getDouble(key + ".scale", 1.0),
                    yaml.getBoolean(key + ".backdrop", false)));
        }
    }

    public void save() {
        YamlConfiguration yaml = new YamlConfiguration();

        for (int i = 0; i < standing.size(); i++) {
            Standing one = standing.get(i);

            String key = "h" + i;
            yaml.set(key + ".world", one.world());
            yaml.set(key + ".x", one.x());
            yaml.set(key + ".y", one.y());
            yaml.set(key + ".z", one.z());
            yaml.set(key + ".scale", one.scale());
            yaml.set(key + ".backdrop", one.backdrop());
            yaml.set(key + ".lines", one.lines());
        }

        try {
            yaml.save(file);
        } catch (Exception e) {
            nexus.getLogger().warning("could not save holograms: " + e);
        }
    }
}
