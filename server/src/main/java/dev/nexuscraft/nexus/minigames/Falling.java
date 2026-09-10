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
 * Games where the floor is the enemy.
 *
 * Spleef and TNT Run are the same game with a different verb: everybody stands
 * on a disc over a long drop, the disc goes away, and the last person not
 * falling wins. Everything they share lives here — the arena, the ring of
 * spawns, noticing somebody has fallen, working out when it is over — and a
 * game is then the floor it builds and what removes it.
 *
 * Worth having as a base rather than two copies because the fiddly parts are
 * all in the shared half. Elimination has to fire once and only once, the last
 * two players falling in the same tick has to resolve to something, and a game
 * that ends while somebody is mid-air has to not strand them. Getting that
 * right twice is how the second one ends up subtly different from the first.
 */
public abstract class Falling extends Match {

    /** The floor sits high, so falling off is a long and obvious trip down. */
    protected static final int FLOOR = 100;

    /** Below this you are out. Well clear of the floor, so no false positives. */
    protected static final int GONE = 70;

    protected static final int RADIUS = 20;

    protected World world;

    /** Still standing. */
    protected final Set<UUID> alive = new LinkedHashSet<>();

    private final Map<UUID, Sidebar> boards = new HashMap<>();

    /** Seconds of grace before the floor starts going, so nobody dies loading. */
    protected int startingIn = 5;

    private int endingIn = -1;

    protected Falling(Nexus nexus) {
        super(nexus);
    }

    /** Builds the floor. Called once, on a fresh empty world. */
    protected abstract void buildFloor();

    /** The colour and wording on the sidebar. */
    protected abstract String sidebarTitle();

    /** Anything the game does every second once it is running. */
    protected void play() {
    }

    /** Kit handed out on spawn. */
    protected abstract void equip(Player player);

    /* --------------------------------------------------------------- start */

    @Override
    public void start(Set<UUID> joining) {
        players.addAll(joining);

        world = Arena.create(game().id());
        buildFloor();

        int index = 0;
        for (UUID id : joining) {
            Player player = nexus.getServer().getPlayer(id);
            if (player == null) continue;

            alive.add(id);
            place(player, index++, joining.size());
        }

        announce(Text.says("Last one standing wins."));
    }

    /** Spread evenly around the rim, facing the middle. */
    private void place(Player player, int index, int total) {
        double angle = 2 * Math.PI * index / Math.max(1, total);
        double x = Math.cos(angle) * (RADIUS - 3);
        double z = Math.sin(angle) * (RADIUS - 3);

        Location at = new Location(world, x + 0.5, FLOOR + 1, z + 0.5);
        at.setDirection(new org.bukkit.util.Vector(-x, 0, -z));

        // The stash happens once in Games.begin, for every match type at
        // once - stashing again here would save the emptied inventory over it.
        player.teleport(at);
        player.setGameMode(GameMode.SURVIVAL);
        player.setHealth(20.0);
        player.setFoodLevel(20);
        player.setSaturation(20f);
        player.getInventory().clear();

        // Everybody starts a round the same. Arriving from the lobby with
        // Speed II is not a level floor, it is a head start.
        dev.nexuscraft.nexus.Worlds.strip(player);

        equip(player);

        player.showTitle(Title.title(
                Component.text(game().name(), Text.BRAND),
                Component.text("Do not fall", NamedTextColor.GRAY),
                Title.Times.times(Duration.ofMillis(300), Duration.ofSeconds(2), Duration.ofMillis(500))));
    }

    /* ---------------------------------------------------------------- tick */

    @Override
    public void tick() {
        elapsed++;

        if (startingIn > 0) {
            startingIn--;
            if (startingIn == 0) announce(Text.says("Go."));
            else announce(Text.plain("  " + startingIn + "..."));
        } else {
            play();
        }

        checkForFallers();
        sidebars();

        if (endingIn > 0) {
            endingIn--;
            if (endingIn == 0) finish();
        }
    }

    /**
     * Anybody below the floor is out.
     *
     * Checked here rather than on a damage event because there is nothing to
     * damage them — the world has no bottom, and waiting for the void to do it
     * means a player spends four seconds falling before the game notices.
     */
    private void checkForFallers() {
        for (UUID id : new ArrayList<>(alive)) {
            Player player = nexus.getServer().getPlayer(id);

            if (player == null) {
                alive.remove(id);
                continue;
            }
            if (player.getLocation().getY() > GONE) continue;

            alive.remove(id);
            out(player);
        }

        if (endingIn < 0 && alive.size() <= 1) declareWinner();
    }

    private void out(Player player) {
        player.setGameMode(GameMode.SPECTATOR);
        player.teleport(new Location(world, 0.5, FLOOR + 12, 0.5));
        player.sendMessage(Text.bad("You fell. Watch the rest."));

        announce(Component.text(player.getName(), NamedTextColor.GRAY)
                .append(Component.text(" fell", NamedTextColor.DARK_GRAY))
                .append(Component.text("  " + alive.size() + " left", Text.BRAND)));

        for (UUID id : players) {
            Player watching = nexus.getServer().getPlayer(id);
            if (watching != null) watching.playSound(watching, Sound.ENTITY_GENERIC_EXPLODE, 0.4f, 1.6f);
        }
    }

    private void declareWinner() {
        UUID winner = alive.isEmpty() ? null : alive.iterator().next();

        for (UUID id : players) {
            Player player = nexus.getServer().getPlayer(id);
            if (player == null) continue;

            boolean won = id.equals(winner);
            if (won) nexus.stats().wonMatch(id, 60);
            else nexus.stats().lostMatch(id, 10);

            // Money as well as coins: a minigame should feed the economy or
            // nobody with a shop to save for will ever play one.
            nexus.stats().pay(id, won ? 400 : 60);

            player.showTitle(Title.title(
                    won ? Component.text("WINNER", NamedTextColor.GOLD)
                            : Component.text("OUT", NamedTextColor.RED),
                    Component.text(won ? "+$400" : "+$60", NamedTextColor.GREEN),
                    Title.Times.times(Duration.ofMillis(300), Duration.ofSeconds(3), Duration.ofMillis(500))));
        }

        if (winner != null) {
            Player player = nexus.getServer().getPlayer(winner);
            if (player != null) {
                announce(Component.text(player.getName(), NamedTextColor.GOLD)
                        .append(Component.text(" wins", NamedTextColor.GRAY)));
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
            lines.add(Sidebar.line("You",
                    alive.contains(id) ? "standing" : "out",
                    alive.contains(id) ? NamedTextColor.WHITE : NamedTextColor.RED));

            if (startingIn > 0) {
                lines.add(Sidebar.gap());
                lines.add(Sidebar.line("Starting", startingIn + "s", NamedTextColor.YELLOW));
            }

            board.set(lines);
        }
    }

    /* ------------------------------------------------------------- leaving */

    public boolean isAlive(UUID who) {
        return alive.contains(who);
    }

    public String worldName() {
        return world == null ? "" : world.getName();
    }

    @Override
    public void remove(Player player) {
        UUID id = player.getUniqueId();

        players.remove(id);
        alive.remove(id);

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

            nexus.hub().send(player);
        }
        players.clear();

        Arena.destroy(world);
    }

    /* -------------------------------------------------------------- shared */

    /** A filled disc of one material, which is every floor these games use. */
    protected void disc(int y, org.bukkit.Material material, int radius) {
        for (int x = -radius; x <= radius; x++) {
            for (int z = -radius; z <= radius; z++) {
                if (x * x + z * z > radius * radius) continue;
                world.getBlockAt(x, y, z).setType(material, false);
            }
        }
    }
}
