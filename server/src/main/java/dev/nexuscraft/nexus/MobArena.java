package dev.nexuscraft.nexus;

import net.kyori.adventure.bossbar.BossBar;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.title.Title;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.Sound;
import org.bukkit.World;
import org.bukkit.attribute.Attribute;
import org.bukkit.entity.EntityType;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;

import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Something to fight, together.
 *
 * Every other game here is people against each other - bed wars, duels, sumo,
 * sky wars, one in the chamber - or one person against a clock, in parkour and
 * the dropper. Three friends who log in wanting to do something as a group have
 * exactly one option, which is building.
 *
 * Ten waves and a boss, in a pit built for the purpose. Deliberately hard
 * enough to lose: an arena nobody fails is a long way to walk for a reward, and
 * the point of fighting something together is that it might go wrong.
 */
public final class MobArena {

    /** Where the pit sits in the dropper's world, well away from the shafts. */
    private static final int ORIGIN_X = -4096;
    private static final int ORIGIN_Z = 0;
    private static final int FLOOR = 100;
    private static final int RADIUS = 18;
    private static final int WALL = 12;

    /** How many waves before the boss, and how long between them. */
    private static final int WAVES = 10;
    private static final long BREATHER_TICKS = 100L;

    /** One wave: what turns up, and how many of them. */
    private record Wave(EntityType kind, int count, String name) {
    }

    private static Wave waveFor(int number) {
        return switch (number) {
            case 1 -> new Wave(EntityType.ZOMBIE, 5, "Zombies");
            case 2 -> new Wave(EntityType.SKELETON, 5, "Skeletons");
            case 3 -> new Wave(EntityType.SPIDER, 6, "Spiders");
            case 4 -> new Wave(EntityType.ZOMBIE, 9, "More zombies");
            case 5 -> new Wave(EntityType.HUSK, 8, "Husks");
            case 6 -> new Wave(EntityType.STRAY, 8, "Strays");
            case 7 -> new Wave(EntityType.CREEPER, 6, "Creepers");
            case 8 -> new Wave(EntityType.BLAZE, 6, "Blazes");
            case 9 -> new Wave(EntityType.WITCH, 5, "Witches");
            default -> new Wave(EntityType.PIGLIN_BRUTE, 6, "Brutes");
        };
    }

    private final Nexus nexus;

    /** Who is in, which wave they are on, and what is still alive. */
    private final Set<UUID> fighting = new HashSet<>();
    private final Map<UUID, Location> cameFrom = new HashMap<>();
    private final Set<UUID> alive = new HashSet<>();

    private int wave;
    private boolean running;
    private BossBar bar;
    private World world;

    public MobArena(Nexus nexus) {
        this.nexus = nexus;
    }

    /* ---------------------------------------------------------------- the pit */

    private World world() {
        if (world == null) world = nexus.worlds().of(Worlds.Place.DROPPER);
        return world;
    }

    /**
     * Digs the pit, once.
     *
     * In the dropper's world because it is already a void that nothing else
     * uses, four thousand blocks from the shafts - far enough that neither can
     * ever see the other.
     */
    private void build() {
        World here = world();
        if (here.getBlockAt(ORIGIN_X, FLOOR, ORIGIN_Z).getType() != Material.AIR) return;

        for (int x = -RADIUS - 1; x <= RADIUS + 1; x++) {
            for (int z = -RADIUS - 1; z <= RADIUS + 1; z++) {
                boolean edge = Math.abs(x) > RADIUS || Math.abs(z) > RADIUS;

                here.getBlockAt(ORIGIN_X + x, FLOOR, ORIGIN_Z + z)
                        .setType(edge ? Material.POLISHED_BLACKSTONE : Material.POLISHED_ANDESITE, false);

                if (!edge) continue;

                // A wall high enough that nothing climbs out and nothing falls in.
                for (int y = 1; y <= WALL; y++) {
                    here.getBlockAt(ORIGIN_X + x, FLOOR + y, ORIGIN_Z + z)
                            .setType(Material.POLISHED_BLACKSTONE, false);
                }
            }
        }

        // Something to see by, at the corners.
        for (int dx : new int[] { -RADIUS + 1, RADIUS - 1 }) {
            for (int dz : new int[] { -RADIUS + 1, RADIUS - 1 }) {
                here.getBlockAt(ORIGIN_X + dx, FLOOR + 5, ORIGIN_Z + dz)
                        .setType(Material.SEA_LANTERN, false);
            }
        }

        nexus.getLogger().info("built the mob arena");
    }

    private Location middle() {
        return new Location(world(), ORIGIN_X + 0.5, FLOOR + 1, ORIGIN_Z + 0.5);
    }

    /* --------------------------------------------------------------- joining */

    public boolean running() {
        return running;
    }

    /**
     * Takes everyone in the party, or just the one who asked.
     *
     * A party because this is the co-operative one and walking in alone is a
     * choice rather than the only option.
     */
    public void begin(Player leader) {
        if (running) {
            player(leader, "A fight is already going. Wait for it to finish.");
            return;
        }

        build();

        /*
         * The whole party, or just whoever asked.
         *
         * membersOnline gives the party including the caller when they are in
         * one, and nothing when they are not - so a lone player is a party of
         * one rather than a special case.
         */
        List<Player> going = new ArrayList<>(nexus.parties().membersOnline(leader.getUniqueId()));
        if (!going.contains(leader)) going.add(leader);

        for (Player player : going) {
            cameFrom.put(player.getUniqueId(), player.getLocation());
            nexus.backpacks().stash(player, nexus.worlds().placeOf(player));

            player.teleport(middle());
            Worlds.strip(player);
            player.setGameMode(GameMode.SURVIVAL);
            player.getInventory().clear();
            kit(player);

            fighting.add(player.getUniqueId());
        }

        running = true;
        wave = 0;

        bar = BossBar.bossBar(Component.text("Get ready"), 1f,
                BossBar.Color.RED, BossBar.Overlay.NOTCHED_10);
        for (Player player : going) player.showBossBar(bar);

        nexus.getServer().getScheduler().runTaskLater(nexus, this::nextWave, 60L);
    }

    /** What everyone fights with. The arena provides it; nothing comes in. */
    private void kit(Player player) {
        player.getInventory().addItem(new ItemStack(Material.IRON_SWORD));
        player.getInventory().addItem(new ItemStack(Material.BOW));
        player.getInventory().addItem(new ItemStack(Material.ARROW, 64));
        player.getInventory().addItem(new ItemStack(Material.COOKED_BEEF, 16));
        player.getInventory().setHelmet(new ItemStack(Material.IRON_HELMET));
        player.getInventory().setChestplate(new ItemStack(Material.IRON_CHESTPLATE));
        player.getInventory().setLeggings(new ItemStack(Material.IRON_LEGGINGS));
        player.getInventory().setBoots(new ItemStack(Material.IRON_BOOTS));
    }

    /* ----------------------------------------------------------------- waves */

    private void nextWave() {
        if (!running) return;

        wave++;

        if (wave > WAVES) {
            boss();
            return;
        }

        Wave coming = waveFor(wave);
        alive.clear();

        for (int i = 0; i < coming.count(); i++) {
            spawn(coming.kind(), 1.0 + wave * 0.06);
        }

        announce(coming.name(), "Wave " + wave + " of " + WAVES);
        updateBar();
    }

    /**
     * One of them, a little tougher than the last lot.
     *
     * Scaled by health rather than by number alone, so a late wave is a fight
     * rather than a crowd - twenty zombies is a queue, six hard ones is a
     * problem.
     */
    private void spawn(EntityType kind, double toughness) {
        double angle = Math.random() * Math.PI * 2;
        double away = RADIUS - 3;

        Location at = new Location(world(),
                ORIGIN_X + Math.cos(angle) * away,
                FLOOR + 1,
                ORIGIN_Z + Math.sin(angle) * away);

        if (!(world().spawnEntity(at, kind) instanceof LivingEntity mob)) return;

        var health = mob.getAttribute(Attribute.MAX_HEALTH);
        if (health != null) {
            health.setBaseValue(health.getBaseValue() * toughness);
            mob.setHealth(health.getValue());
        }

        mob.setRemoveWhenFarAway(false);
        alive.add(mob.getUniqueId());
    }

    private void boss() {
        alive.clear();

        Location at = middle().add(0, 0, RADIUS - 4);
        if (!(world().spawnEntity(at, EntityType.RAVAGER) instanceof LivingEntity beast)) return;

        var health = beast.getAttribute(Attribute.MAX_HEALTH);
        if (health != null) {
            health.setBaseValue(300);
            beast.setHealth(300);
        }

        beast.customName(Component.text("The Warden of the Pit", NamedTextColor.DARK_RED));
        beast.setCustomNameVisible(true);
        beast.setRemoveWhenFarAway(false);
        alive.add(beast.getUniqueId());

        announce("The Warden of the Pit", "Last one");
        updateBar();
    }

    /* ---------------------------------------------------------------- events */

    /** Something in the arena died. Returns true if it was one of ours. */
    public boolean killed(UUID entity) {
        if (!running || !alive.remove(entity)) return false;

        updateBar();

        if (!alive.isEmpty()) return true;

        if (wave > WAVES) {
            won();
        } else {
            nexus.getServer().getScheduler().runTaskLater(nexus, this::nextWave, BREATHER_TICKS);
        }
        return true;
    }

    /** Somebody died, or left. When the last one goes, so does the fight. */
    public void out(Player player) {
        if (!fighting.remove(player.getUniqueId())) return;

        player.hideBossBar(bar);
        send(player);

        if (fighting.isEmpty()) end(false);
    }

    public boolean inside(UUID who) {
        return fighting.contains(who);
    }

    /* ---------------------------------------------------------------- ending */

    private void won() {
        for (UUID who : new HashSet<>(fighting)) {
            Player player = nexus.getServer().getPlayer(who);
            if (player == null) continue;

            nexus.stats().pay(who, 15_000);
            nexus.crates().give(player, Crates.Tier.RARE, 2);

            player.showTitle(Title.title(
                    Component.text("The pit is quiet", NamedTextColor.GOLD),
                    Component.text("$15,000 and two rare keys", NamedTextColor.GRAY),
                    Title.Times.times(Duration.ofMillis(300), Duration.ofSeconds(3),
                            Duration.ofMillis(500))));
        }

        nexus.getServer().broadcast(Component.text("The Warden of the Pit has fallen.",
                NamedTextColor.GOLD));

        end(true);
    }

    private void end(boolean victory) {
        running = false;

        for (UUID who : new HashSet<>(fighting)) {
            Player player = nexus.getServer().getPlayer(who);
            if (player != null) {
                player.hideBossBar(bar);
                if (!victory) player.sendMessage(Text.says("The pit wins this time."));
                send(player);
            }
        }

        fighting.clear();

        // Anything still standing goes with it.
        for (UUID id : alive) {
            var entity = nexus.getServer().getEntity(id);
            if (entity != null) entity.remove();
        }
        alive.clear();
        wave = 0;
    }

    /** Back where they came from, with what they were carrying. */
    private void send(Player player) {
        player.getInventory().clear();
        player.getInventory().setArmorContents(null);

        Location back = cameFrom.remove(player.getUniqueId());
        if (back != null && back.getWorld() != null) {
            player.teleport(back);
            nexus.backpacks().restore(player, nexus.worlds().placeOf(player));
        } else {
            nexus.hub().send(player);
        }
    }

    private void announce(String what, String under) {
        for (UUID who : fighting) {
            Player player = nexus.getServer().getPlayer(who);
            if (player == null) continue;

            player.showTitle(Title.title(
                    Component.text(what, NamedTextColor.RED),
                    Component.text(under, NamedTextColor.GRAY),
                    Title.Times.times(Duration.ofMillis(200), Duration.ofSeconds(2),
                            Duration.ofMillis(400))));
            player.playSound(player, Sound.ENTITY_WITHER_SPAWN, 0.4f, 1.6f);
        }
    }

    private void updateBar() {
        if (bar == null) return;

        Wave coming = wave > WAVES ? null : waveFor(wave);
        String label = coming == null ? "The Warden of the Pit"
                : "Wave " + wave + " of " + WAVES + " - " + coming.name();

        bar.name(Component.text(label + "   " + alive.size() + " left"));

        int total = coming == null ? 1 : coming.count();
        bar.progress(Math.max(0f, Math.min(1f, alive.size() / (float) total)));
    }

    private void player(Player player, String message) {
        player.sendMessage(Text.bad(message));
    }
}
