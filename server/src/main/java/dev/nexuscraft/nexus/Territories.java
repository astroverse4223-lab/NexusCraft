package dev.nexuscraft.nexus;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.Sound;
import org.bukkit.World;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.entity.Player;

import java.io.File;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Ground worth fighting over, so a guild is more than a shared wallet.
 *
 * A guild that only has a name and a bank is a chat channel. What makes one
 * worth joining is having something to defend, so there are a handful of places
 * in survival that pay whoever is holding them - and the only way to take one
 * is to stand on it while nobody from another guild does.
 *
 * There are deliberately few of them. Territory that everybody can have is not
 * territory, and a map with fifty capture points is one where no two guilds
 * ever meet.
 */
public final class Territories {

    /** How far apart the points are. Far enough that holding two is a stretch. */
    private static final int SPACING = 1536;

    /** How many, in a square centred on spawn. Nine, so there is a middle one. */
    private static final int ACROSS = 3;

    /** How close you have to be to be standing on it. */
    private static final int RADIUS = 12;

    /** Seconds of unopposed standing to take one. */
    private static final int CAPTURE_SECONDS = 45;

    /** What each one pays its holder, and how often. */
    private static final double INCOME = 750;
    private static final int INCOME_MINUTES = 10;

    private final Nexus nexus;
    private final File file;

    /** Point key ("1,-1") to the guild holding it. */
    private final Map<String, String> held = new HashMap<>();

    /** How far through a capture each point is, and by whom. */
    private final Map<String, String> takingBy = new HashMap<>();
    private final Map<String, Integer> progress = new HashMap<>();

    /** Counts up to the payout, in ticks of this class's timer. */
    private int untilPayout = INCOME_MINUTES * 60;

    public Territories(Nexus nexus) {
        this.nexus = nexus;
        this.file = new File(nexus.getDataFolder(), "territories.yml");
        load();
    }

    /* ------------------------------------------------------------ geometry */

    private static String keyOf(int gx, int gz) {
        return gx + "," + gz;
    }

    /** Every point, as grid coordinates. */
    private List<int[]> points() {
        List<int[]> out = new ArrayList<>();
        int reach = ACROSS / 2;

        for (int gx = -reach; gx <= reach; gx++) {
            for (int gz = -reach; gz <= reach; gz++) out.add(new int[]{gx, gz});
        }
        return out;
    }

    private Location centreOf(int gx, int gz) {
        World survival = nexus.worlds().of(Worlds.Place.SURVIVAL);
        int x = gx * SPACING;
        int z = gz * SPACING;

        return new Location(survival, x, survival.getHighestBlockYAt(x, z) + 1, z);
    }

    /* --------------------------------------------------------------- ticking */

    /**
     * Called once a second.
     *
     * Everything about a capture point is decided from who is standing on it
     * right now, which means there is no state to get out of step with the
     * world - somebody who logs out mid-capture simply stops counting.
     */
    public void tick() {
        World survival = nexus.worlds().of(Worlds.Place.SURVIVAL);
        if (survival.getPlayers().isEmpty()) return;

        for (int[] point : points()) {
            String key = keyOf(point[0], point[1]);
            Location middle = centreOf(point[0], point[1]);

            Set<String> guildsHere = new HashSet<>();

            for (Player player : survival.getPlayers()) {
                if (player.getLocation().distanceSquared(middle) > RADIUS * RADIUS) continue;

                String guild = nexus.guilds().nameOf(player.getUniqueId());
                if (guild == null) continue;

                guildsHere.add(guild);
            }

            /*
             * Contested, empty, or already theirs: nothing moves.
             *
             * Two guilds standing on the same point freezes it rather than
             * letting the larger one win by numbers, so a smaller guild can
             * hold ground by turning up rather than by winning a fight.
             */
            if (guildsHere.size() != 1) {
                progress.remove(key);
                takingBy.remove(key);
                continue;
            }

            String taking = guildsHere.iterator().next();

            if (taking.equals(held.get(key))) {
                progress.remove(key);
                takingBy.remove(key);
                continue;
            }

            if (!taking.equals(takingBy.get(key))) {
                takingBy.put(key, taking);
                progress.put(key, 0);
            }

            int now = progress.merge(key, 1, Integer::sum);

            if (now % 15 == 0 && now < CAPTURE_SECONDS) {
                say(middle, Text.says(taking + " is taking a territory. "
                        + (CAPTURE_SECONDS - now) + "s."));
            }

            if (now < CAPTURE_SECONDS) continue;

            held.put(key, taking);
            progress.remove(key);
            takingBy.remove(key);
            save();

            nexus.getServer().broadcast(Component.text(taking, NamedTextColor.GREEN)
                    .append(Component.text(" has taken a territory at "
                            + middle.getBlockX() + ", " + middle.getBlockZ(),
                            NamedTextColor.GRAY)));

            for (Player player : survival.getPlayers()) {
                if (player.getLocation().distanceSquared(middle) > RADIUS * RADIUS * 4) continue;
                player.playSound(player, Sound.ENTITY_PLAYER_LEVELUP, 0.9f, 0.8f);
            }
        }

        if (--untilPayout > 0) return;

        untilPayout = INCOME_MINUTES * 60;
        payout();
    }

    /** Everyone holding something gets paid, into the guild bank. */
    private void payout() {
        Map<String, Integer> owed = new HashMap<>();
        for (String guild : held.values()) owed.merge(guild, 1, Integer::sum);

        for (Map.Entry<String, Integer> entry : owed.entrySet()) {
            double amount = INCOME * entry.getValue();

            if (!nexus.guilds().depositTo(entry.getKey(), amount)) continue;

            nexus.guilds().tell(entry.getKey(), Text.good(Stats.cash(amount)
                    + " from " + entry.getValue()
                    + (entry.getValue() == 1 ? " territory." : " territories.")));
        }
    }

    private void say(Location middle, Component message) {
        for (Player player : middle.getWorld().getPlayers()) {
            if (player.getLocation().distanceSquared(middle) > RADIUS * RADIUS * 4) continue;
            player.sendMessage(message);
        }
    }

    /* ------------------------------------------------------------- command */

    public void list(Player player) {
        player.sendMessage(Text.heading("Territories"));
        player.sendMessage(Text.plain("  " + Stats.cash(INCOME) + " each, every "
                + INCOME_MINUTES + " minutes, into your guild bank."));
        player.sendMessage(Component.empty());

        boolean survival = nexus.worlds().placeOf(player) == Worlds.Place.SURVIVAL;

        for (int[] point : points()) {
            String key = keyOf(point[0], point[1]);
            String owner = held.get(key);

            int x = point[0] * SPACING;
            int z = point[1] * SPACING;

            Component line = Component.text("  " + x + ", " + z, NamedTextColor.AQUA)
                    .append(Component.text("   " + (owner == null ? "unclaimed" : owner),
                            owner == null ? NamedTextColor.DARK_GRAY : NamedTextColor.GREEN));

            if (survival) {
                int away = (int) Math.hypot(player.getLocation().getX() - x,
                        player.getLocation().getZ() - z);

                line = line.append(Component.text("   " + away + " away",
                        NamedTextColor.DARK_GRAY));
            }

            player.sendMessage(line);
        }

        player.sendMessage(Component.empty());
        player.sendMessage(Text.plain("  Stand on one for " + CAPTURE_SECONDS
                + "s with no other guild there."));
    }

    /** For the guild leaderboard: how many each holds. */
    public int heldBy(String guild) {
        int count = 0;
        for (String owner : held.values()) {
            if (owner.equals(guild)) count++;
        }
        return count;
    }

    /** A guild that no longer exists holds nothing. */
    public void forget(String guild) {
        held.values().removeIf(owner -> owner.equals(guild));
        save();
    }

    /* -------------------------------------------------------------- on disk */

    private void load() {
        if (!file.exists()) return;

        YamlConfiguration yaml = YamlConfiguration.loadConfiguration(file);
        var section = yaml.getConfigurationSection("held");
        if (section == null) return;

        for (String key : section.getKeys(false)) {
            held.put(key.replace(' ', ','), yaml.getString("held." + key));
        }
    }

    public void save() {
        YamlConfiguration yaml = new YamlConfiguration();

        for (Map.Entry<String, String> entry : held.entrySet()) {
            // A comma is a path separator in YAML, so it is stored as a space.
            yaml.set("held." + entry.getKey().replace(',', ' '), entry.getValue());
        }

        try {
            yaml.save(file);
        } catch (Exception e) {
            nexus.getLogger().warning("could not save territories: " + e);
        }
    }
}
