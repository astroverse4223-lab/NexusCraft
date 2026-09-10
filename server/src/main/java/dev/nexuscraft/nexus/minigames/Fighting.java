package dev.nexuscraft.nexus.minigames;

import dev.nexuscraft.nexus.Arena;
import dev.nexuscraft.nexus.Match;
import dev.nexuscraft.nexus.Nexus;
import dev.nexuscraft.nexus.Sidebar;
import dev.nexuscraft.nexus.Text;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.title.Title;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.Sound;
import org.bukkit.World;
import org.bukkit.entity.Player;

import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Games where the other players are the enemy.
 *
 * The counterpart to {@link Falling}. Duels, Skywars and One in the Chamber are
 * one game with three arenas and three kits: everybody spawns, everybody fights,
 * and the shape of the map is the only thing that differs. Sumo joins them by
 * turning the damage off and letting the drop do the work.
 *
 * The awkward parts are all shared, which is the reason this exists rather than
 * three copies. Kill credit has to survive the killer logging out. A player
 * knocked into the void has to be counted as killed by whoever hit them last,
 * and only for a while, or every accidental fall an hour later is somebody's
 * kill. Two players killing each other in the same tick has to resolve to
 * something. And a match must end exactly once.
 *
 * Nobody actually dies. Damage that would be fatal is cancelled and turned into
 * an elimination instead, so there is no death screen, no dropped inventory to
 * clean up, and no respawn to intercept - all three of which are where minigame
 * plugins usually leak state into the next match.
 */
public abstract class Fighting extends Match {

    /** Arena floor height, well above the void. */
    protected static final int FLOOR = 100;

    /** Below this you are gone, whatever put you there. */
    protected static final int GONE = 55;

    /** How long a hit still counts as the cause of somebody's fall. */
    private static final int CREDIT_SECONDS = 10;

    protected World world;

    protected final Set<UUID> alive = new LinkedHashSet<>();

    protected final Map<UUID, Integer> livesLeft = new HashMap<>();
    protected final Map<UUID, Integer> kills = new HashMap<>();

    /** Who hit whom last, and when, for crediting a fall. */
    private final Map<UUID, UUID> lastHitBy = new HashMap<>();
    private final Map<UUID, Integer> lastHitAt = new HashMap<>();

    private final Map<UUID, Sidebar> boards = new HashMap<>();

    /** Seconds of grace before anybody can be hurt. */
    protected int startingIn = 5;

    private int endingIn = -1;

    protected Fighting(Nexus nexus) {
        super(nexus);
    }

    /* ------------------------------------------------------ what a game says */

    /** Builds the map. Called once, on a fresh empty world. */
    protected abstract void buildArena();

    /** Where each player starts, in order. At least as many as maxPlayers. */
    protected abstract List<Location> spawns();

    /** What they are holding. */
    protected abstract void equip(Player player);

    protected abstract String sidebarTitle();

    /** How many times somebody may die before they are out. */
    protected int lives() {
        return 1;
    }

    /** Whether being hit hurts at all, or only pushes. */
    protected boolean damaging() {
        return true;
    }

    /** Anything the game does every second once it is running. */
    protected void play() {
    }

    /** Anything extra when somebody scores, before the respawn. */
    protected void scored(Player killer, Player victim) {
    }

    /** Ends early when a game has its own condition, such as a kill target. */
    protected boolean decided() {
        return false;
    }

    /* ---------------------------------------------------------------- start */

    @Override
    public void start(Set<UUID> joining) {
        players.addAll(joining);

        world = Arena.create(game().id());
        buildArena();

        List<Location> where = spawns();
        int index = 0;

        for (UUID id : joining) {
            Player player = nexus.getServer().getPlayer(id);
            if (player == null) continue;

            alive.add(id);
            livesLeft.put(id, lives());
            kills.put(id, 0);

            put(player, where.get(index++ % where.size()));
        }

        announce(Text.says(lives() > 1
                ? "You have " + lives() + " lives. Make them count."
                : "One life. Last one standing wins."));
    }

    private void put(Player player, Location at) {
        player.teleport(at);
        player.setGameMode(GameMode.SURVIVAL);
        player.setHealth(20.0);
        player.setFoodLevel(20);
        player.setSaturation(20f);
        player.getInventory().clear();

        // Sumo and Duels are tuned for a normal walk speed, so the lobby's
        // Speed II does not come into the ring.
        dev.nexuscraft.nexus.Worlds.strip(player);

        equip(player);

        player.showTitle(Title.title(
                Component.text(game().name(), Text.BRAND),
                Component.text(game().blurb(), NamedTextColor.GRAY),
                Title.Times.times(Duration.ofMillis(300), Duration.ofSeconds(2),
                        Duration.ofMillis(500))));
    }

    /* --------------------------------------------------------------- combat */

    /** Whether anybody may be hurt yet. Read by the damage listener. */
    public boolean fighting() {
        return startingIn <= 0 && !isOver();
    }

    public boolean hurts() {
        return damaging();
    }

    public boolean isAlive(UUID who) {
        return alive.contains(who);
    }

    public String worldName() {
        return world == null ? "" : world.getName();
    }

    /**
     * Records who is responsible for somebody's next few seconds.
     *
     * Kept with a timestamp rather than cleared on landing, because the hit
     * that matters in these games is usually the one that sent somebody over
     * an edge - the damage and the elimination are seconds and a long fall
     * apart, and clearing it on contact would credit nobody.
     */
    public void hitBy(Player hurt, Player attacker) {
        lastHitBy.put(hurt.getUniqueId(), attacker.getUniqueId());
        lastHitAt.put(hurt.getUniqueId(), elapsed);
    }

    /**
     * Somebody has been taken out, by a player or by the map.
     *
     * The single door in. Fatal damage, the void, and quitting all come through
     * here so that lives, kill credit, scoring and the end of the match are
     * decided in one place rather than three that have to agree.
     */
    public void eliminated(Player player, Player by) {
        UUID id = player.getUniqueId();
        if (!alive.contains(id)) return;

        Player killer = by != null ? by : recentAttackerOf(id);
        if (killer != null && killer.getUniqueId().equals(id)) killer = null;

        lastHitBy.remove(id);
        lastHitAt.remove(id);

        if (killer != null) {
            kills.merge(killer.getUniqueId(), 1, Integer::sum);
            nexus.stats().killed(killer.getUniqueId());
            killer.playSound(killer, Sound.ENTITY_EXPERIENCE_ORB_PICKUP, 0.8f, 1.6f);
            scored(killer, player);
        }
        nexus.stats().died(id);

        int left = livesLeft.merge(id, -1, Integer::sum);

        // "Fell" rather than "was finished off" when there is nobody to name
        // and they are under the map, which is how most of these actually end.
        boolean fell = player.getLocation().getY() <= GONE;

        announce(Component.text(player.getName(), NamedTextColor.GRAY)
                .append(Component.text(killer == null ? (fell ? " fell" : " died")
                        : " was killed by ", NamedTextColor.DARK_GRAY))
                .append(killer == null ? Component.empty()
                        : Component.text(killer.getName(), NamedTextColor.WHITE))
                .append(Component.text(left > 0 ? "  " + left + " lives left" : "",
                        NamedTextColor.DARK_GRAY)));

        if (left > 0) {
            respawn(player);
            return;
        }

        alive.remove(id);
        watch(player);

        announce(Component.text(player.getName(), NamedTextColor.RED)
                .append(Component.text(" is out", NamedTextColor.DARK_GRAY))
                .append(Component.text("  " + alive.size() + " left", Text.BRAND)));
    }

    /**
     * Back in, after a moment somewhere safe.
     *
     * Put in the air above their spawn rather than on it, because respawning
     * into the middle of the fight that just killed you is how a game with
     * lives turns into one person being killed five times in ten seconds.
     */
    private void respawn(Player player) {
        List<Location> where = spawns();
        Location at = where.get(Math.abs(player.getUniqueId().hashCode()) % where.size());

        player.setGameMode(GameMode.SPECTATOR);
        player.teleport(at.clone().add(0, 6, 0));
        player.sendMessage(Text.says("Back in three."));

        nexus.getServer().getScheduler().runTaskLater(nexus, () -> {
            if (isOver() || !player.isOnline() || !alive.contains(player.getUniqueId())) return;
            put(player, at);
        }, 60L);
    }

    private void watch(Player player) {
        player.setGameMode(GameMode.SPECTATOR);
        player.getInventory().clear();
        player.teleport(new Location(world, 0.5, FLOOR + 14, 0.5));
        player.sendMessage(Text.bad("You are out. Watch the rest."));

        for (UUID id : players) {
            Player anybody = nexus.getServer().getPlayer(id);
            if (anybody != null) {
                anybody.playSound(anybody, Sound.ENTITY_GENERIC_EXPLODE, 0.4f, 1.5f);
            }
        }
    }

    private Player recentAttackerOf(UUID who) {
        Integer when = lastHitAt.get(who);
        if (when == null || elapsed - when > CREDIT_SECONDS) return null;

        UUID attacker = lastHitBy.get(who);
        return attacker == null ? null : nexus.getServer().getPlayer(attacker);
    }

    /* ----------------------------------------------------------------- tick */

    @Override
    public void tick() {
        elapsed++;

        if (startingIn > 0) {
            startingIn--;
            if (startingIn == 0) announce(Text.says("Fight."));
            else announce(Text.plain("  " + startingIn + "..."));
        } else {
            play();
        }

        checkForFallers();
        sidebars();

        if (endingIn < 0 && (alive.size() <= 1 || decided())) declareWinner();

        if (endingIn > 0) {
            endingIn--;
            if (endingIn == 0) finish();
        }
    }

    /**
     * Anybody under the map is out, credited to whoever last hit them.
     *
     * Checked here rather than by waiting for the void to do the damage, which
     * takes several seconds and leaves the game visibly behind what everybody
     * watching has already seen happen.
     */
    private void checkForFallers() {
        for (UUID id : new ArrayList<>(alive)) {
            Player player = nexus.getServer().getPlayer(id);

            if (player == null) {
                alive.remove(id);
                continue;
            }
            if (player.getGameMode() == GameMode.SPECTATOR) continue;
            if (player.getLocation().getY() > GONE) continue;

            eliminated(player, null);
        }
    }

    protected int killsOf(UUID who) {
        return kills.getOrDefault(who, 0);
    }

    /** Whoever has the most kills, for games decided on score. */
    protected UUID leader() {
        UUID best = null;
        int most = -1;

        for (UUID id : players) {
            int score = killsOf(id);
            if (score > most) {
                most = score;
                best = id;
            }
        }
        return best;
    }

    private void declareWinner() {
        UUID winner = alive.size() == 1 ? alive.iterator().next()
                : alive.isEmpty() ? null : leader();

        for (UUID id : players) {
            Player player = nexus.getServer().getPlayer(id);
            if (player == null) continue;

            boolean won = id.equals(winner);
            if (won) nexus.stats().wonMatch(id, 70);
            else nexus.stats().lostMatch(id, 12);

            // Kills pay as well as the win, so somebody who fought all match
            // and lost the last exchange still has something to show for it.
            double money = (won ? 450 : 70) + killsOf(id) * 45.0;
            nexus.stats().pay(id, money);

            player.showTitle(Title.title(
                    won ? Component.text("WINNER", NamedTextColor.GOLD)
                            : Component.text("OUT", NamedTextColor.RED),
                    Component.text("+$" + Math.round(money)
                            + "   " + killsOf(id) + " kills", NamedTextColor.GREEN),
                    Title.Times.times(Duration.ofMillis(300), Duration.ofSeconds(3),
                            Duration.ofMillis(500))));
        }

        if (winner != null) {
            Player player = nexus.getServer().getPlayer(winner);
            if (player != null) {
                announce(Component.text(player.getName(), NamedTextColor.GOLD)
                        .append(Component.text(" wins with " + killsOf(winner)
                                + " kills", NamedTextColor.GRAY)));
            }
        }

        endingIn = 5;
    }

    private void sidebars() {
        for (UUID id : players) {
            Player player = nexus.getServer().getPlayer(id);
            if (player == null) continue;

            Sidebar board = boards.computeIfAbsent(id, key -> new Sidebar(player, sidebarTitle()));

            List<Component> lines = new ArrayList<>();
            lines.add(Component.text(Text.clock(elapsed), NamedTextColor.GRAY));
            lines.add(Sidebar.gap());
            lines.add(Sidebar.line("Alive", String.valueOf(alive.size()), NamedTextColor.GREEN));
            lines.add(Sidebar.line("Kills", String.valueOf(killsOf(id)), NamedTextColor.WHITE));

            if (lives() > 1) {
                lines.add(Sidebar.line("Lives",
                        String.valueOf(Math.max(0, livesLeft.getOrDefault(id, 0))),
                        NamedTextColor.RED));
            }

            if (startingIn > 0) {
                lines.add(Sidebar.gap());
                lines.add(Sidebar.line("Starting", startingIn + "s", NamedTextColor.YELLOW));
            }

            board.set(lines);
        }
    }

    /* -------------------------------------------------------------- leaving */

    @Override
    public void remove(Player player) {
        UUID id = player.getUniqueId();

        players.remove(id);
        alive.remove(id);
        lastHitBy.remove(id);
        lastHitAt.remove(id);

        Sidebar board = boards.remove(id);
        if (board != null) board.clear();

        if (player.isOnline()) nexus.hub().send(player);
        if (!isOver() && alive.size() <= 1) declareWinner();
    }

    @Override
    protected void teardown() {
        for (UUID id : new ArrayList<>(players)) {
            Player player = nexus.getServer().getPlayer(id);
            if (player == null) continue;

            Sidebar board = boards.remove(id);
            if (board != null) board.clear();

            player.getInventory().clear();
            nexus.hub().send(player);
        }
        players.clear();

        Arena.destroy(world);
    }

    /* --------------------------------------------------------------- shapes */

    protected void disc(int y, org.bukkit.Material material, int radius) {
        for (int x = -radius; x <= radius; x++) {
            for (int z = -radius; z <= radius; z++) {
                if (x * x + z * z > radius * radius) continue;
                world.getBlockAt(x, y, z).setType(material, false);
            }
        }
    }

    protected void box(int x1, int y1, int z1, int x2, int y2, int z2,
                       org.bukkit.Material material) {
        for (int x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) {
            for (int y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) {
                for (int z = Math.min(z1, z2); z <= Math.max(z1, z2); z++) {
                    world.getBlockAt(x, y, z).setType(material, false);
                }
            }
        }
    }

    /** Evenly spaced points on a circle, facing the middle. */
    protected List<Location> ring(int count, double radius, int y) {
        List<Location> out = new ArrayList<>();

        for (int i = 0; i < count; i++) {
            double angle = 2 * Math.PI * i / count;
            double x = Math.cos(angle) * radius;
            double z = Math.sin(angle) * radius;

            Location at = new Location(world, x + 0.5, y, z + 0.5);
            at.setDirection(new org.bukkit.util.Vector(-x, 0, -z));
            out.add(at);
        }
        return out;
    }
}
