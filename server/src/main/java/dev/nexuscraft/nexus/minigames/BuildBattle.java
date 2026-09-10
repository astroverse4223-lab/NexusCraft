package dev.nexuscraft.nexus.minigames;

import dev.nexuscraft.nexus.Arena;
import dev.nexuscraft.nexus.Game;
import dev.nexuscraft.nexus.Match;
import dev.nexuscraft.nexus.Nexus;
import dev.nexuscraft.nexus.Text;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.event.ClickEvent;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.title.Title;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.Sound;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.entity.Player;

import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.Set;
import java.util.UUID;

/**
 * Build Battle: everybody gets a plot and a word, and ten minutes.
 *
 * The one game on the server that is not about killing anybody, which is most
 * of why it is worth having - a server whose every game is a fight has one
 * audience, and this reaches the people who are here to build. It also uses
 * what is already here: the plot grid taught this how to lay out ground, and
 * the blueprint palettes taught it what a nice floor looks like.
 *
 * Judged by the other players rather than by anything automatic. There is no
 * way to measure whether a build is good, and pretending otherwise - counting
 * blocks placed, say - would decide the game in favour of whoever filled the
 * most space.
 */
public final class BuildBattle implements Game {

    /** How long there is to build, in seconds. */
    static final int BUILD_SECONDS = 300;

    /** And how long everybody looks at each build before voting moves on. */
    static final int LOOK_SECONDS = 20;

    /** The square each player gets. */
    static final int PLOT = 16;

    /** Between one plot and the next, so nobody builds into a neighbour. */
    static final int GAP = 16;

    /** The floor, and how high anything may go above it. */
    static final int FLOOR = 100;
    static final int CEILING = 30;

    @Override
    public String id() {
        return "buildbattle";
    }

    @Override
    public String name() {
        return "Build Battle";
    }

    @Override
    public String blurb() {
        return "One word, ten minutes, and their votes.";
    }

    @Override
    public Material icon() {
        return Material.BRICKS;
    }

    @Override
    public int minPlayers() {
        return 2;
    }

    @Override
    public int maxPlayers() {
        return 8;
    }

    @Override
    public Match newMatch(Nexus nexus) {
        return new BuildBattleMatch(nexus, this);
    }

    /* --------------------------------------------------------------- themes */

    /**
     * What to build.
     *
     * Deliberately concrete nouns rather than moods. "Lighthouse" is something
     * eight people will build eight different versions of; "serenity" is
     * something they will stare at for a minute and then build a house.
     */
    private static final List<String> THEMES = List.of(
            "Lighthouse", "Castle", "Windmill", "Treehouse", "Spaceship",
            "Dragon", "Volcano", "Cathedral", "Pirate Ship", "Bakery",
            "Aquarium", "Watchtower", "Greenhouse", "Waterfall", "Campsite",
            "Bridge", "Igloo", "Farm", "Lighthouse Keeper's Hut", "Airship",
            "Mine Entrance", "Fountain", "Statue", "Beach Hut", "Clock Tower",
            "Mushroom House", "Train", "Harbour", "Observatory", "Graveyard");

    /* ---------------------------------------------------------------- match */

    public static final class BuildBattleMatch extends Match {

        private final BuildBattle game;
        private final Random random = new Random();

        private World world;
        private String theme;

        /** Which plot belongs to whom, in the order they were given out. */
        private final Map<UUID, Integer> plots = new LinkedHashMap<>();

        /** Ratings given to each player, so an average can be taken. */
        private final Map<UUID, List<Integer>> ratings = new HashMap<>();

        /** Who has already rated the build currently being looked at. */
        private final Map<UUID, Boolean> ratedThis = new HashMap<>();

        private Phase phase = Phase.BUILDING;
        private int left = BUILD_SECONDS;

        /** Whose build is being looked at, as an index into the plot order. */
        private int showing;

        private enum Phase { BUILDING, VOTING, DONE }

        BuildBattleMatch(Nexus nexus, BuildBattle game) {
            super(nexus);
            this.game = game;
        }

        @Override
        public Game game() {
            return game;
        }

        /* ------------------------------------------------------------ start */

        @Override
        public void start(Set<UUID> joining) {
            players.addAll(joining);

            world = Arena.create(game.id());
            theme = THEMES.get(random.nextInt(THEMES.size()));

            int index = 0;
            for (UUID id : players) {
                plots.put(id, index);
                ratings.put(id, new ArrayList<>());

                lay(index);
                index++;
            }

            for (UUID id : players) {
                Player player = nexus.getServer().getPlayer(id);
                if (player == null) continue;

                player.teleport(middleOf(plots.get(id)));
                player.setGameMode(GameMode.CREATIVE);
                player.getInventory().clear();

                player.showTitle(Title.title(
                        Component.text(theme, NamedTextColor.GOLD),
                        Component.text("Build it", NamedTextColor.GRAY),
                        Title.Times.times(Duration.ofMillis(300), Duration.ofSeconds(3),
                                Duration.ofMillis(500))));
            }

            announce(Text.heading("Build Battle"));
            announce(Text.says("The theme is " + theme + "."));
            announce(Text.plain("  Five minutes. Anything goes."));
        }

        /** One plot's ground, out along the x axis from the middle. */
        private void lay(int index) {
            int x0 = index * (PLOT + GAP);

            for (int x = x0 - 1; x <= x0 + PLOT; x++) {
                for (int z = -1; z <= PLOT; z++) {
                    boolean rim = x == x0 - 1 || x == x0 + PLOT || z == -1 || z == PLOT;

                    world.getBlockAt(x, FLOOR, z)
                            .setType(rim ? Material.SMOOTH_STONE : Material.GRASS_BLOCK, false);

                    /*
                     * A glass wall around each plot.
                     *
                     * Not to stop people looking - seeing what everybody else
                     * is doing is half the fun - but to stop somebody walking
                     * into a neighbour's build and standing in the middle of
                     * it while they are trying to finish.
                     */
                    if (!rim) continue;
                    for (int y = FLOOR + 1; y <= FLOOR + CEILING; y++) {
                        world.getBlockAt(x, y, z).setType(Material.BARRIER, false);
                    }
                }
            }
        }

        private Location middleOf(int index) {
            int x0 = index * (PLOT + GAP);
            return new Location(world, x0 + PLOT / 2.0, FLOOR + 1, PLOT / 2.0);
        }

        /* ------------------------------------------------------------- tick */

        @Override
        public void tick() {
            if (phase == Phase.DONE) {
                if (--left <= 0) finish();
                return;
            }

            left--;

            if (phase == Phase.BUILDING) {
                if (left == 60 || left == 30 || left == 10) {
                    announce(Text.says(left + " seconds left."));
                }

                if (left <= 0) startVoting();
                return;
            }

            if (left <= 0) nextBuild();
        }

        private void startVoting() {
            phase = Phase.VOTING;
            showing = -1;

            for (UUID id : players) {
                Player player = nexus.getServer().getPlayer(id);
                if (player == null) continue;

                player.setGameMode(GameMode.ADVENTURE);
                player.getInventory().clear();
            }

            announce(Text.heading("Time"));
            announce(Text.plain("  Now go and look at them."));

            nextBuild();
        }

        /**
         * Moves everybody to the next build, or ends it if there are none left.
         *
         * Everybody is taken to each plot in turn rather than left to wander,
         * because a vote where half the people never saw half the builds is
         * decided by who happened to walk which way.
         */
        private void nextBuild() {
            showing++;
            ratedThis.clear();

            List<UUID> order = new ArrayList<>(plots.keySet());

            if (showing >= order.size()) {
                declare();
                return;
            }

            UUID whose = order.get(showing);
            String name = nameOf(whose);

            left = LOOK_SECONDS;

            for (UUID id : players) {
                Player player = nexus.getServer().getPlayer(id);
                if (player == null) continue;

                player.teleport(middleOf(plots.get(whose)).add(0, 6, 0));
                player.playSound(player, Sound.BLOCK_NOTE_BLOCK_CHIME, 0.8f, 1.2f);

                if (id.equals(whose)) {
                    player.sendMessage(Text.says("This one is yours."));
                    continue;
                }

                player.sendMessage(Text.heading(name + "'s " + theme));
                player.sendMessage(stars());
            }
        }

        /** The clickable row of numbers people actually vote with. */
        private Component stars() {
            Component line = Component.text("  Rate it  ", NamedTextColor.GRAY);

            for (int score = 1; score <= 5; score++) {
                line = line.append(Component.text(" [" + score + "]", NamedTextColor.GOLD)
                        .clickEvent(ClickEvent.runCommand("/rate " + score)));
            }
            return line;
        }

        /**
         * Somebody's vote on the build being shown.
         *
         * Refuses a second vote on the same build rather than replacing the
         * first, since the click is one keypress and a player leaning on it
         * would otherwise count five times.
         */
        public void rate(Player player, int score) {
            if (phase != Phase.VOTING) {
                player.sendMessage(Text.bad("There is nothing to rate yet."));
                return;
            }

            List<UUID> order = new ArrayList<>(plots.keySet());
            if (showing < 0 || showing >= order.size()) return;

            UUID whose = order.get(showing);

            if (whose.equals(player.getUniqueId())) {
                player.sendMessage(Text.bad("You cannot rate your own."));
                return;
            }

            if (ratedThis.putIfAbsent(player.getUniqueId(), true) != null) {
                player.sendMessage(Text.bad("You have already rated this one."));
                return;
            }

            ratings.computeIfAbsent(whose, id -> new ArrayList<>())
                    .add(Math.max(1, Math.min(5, score)));

            player.sendMessage(Text.good("Rated " + score + "."));
        }

        /* ------------------------------------------------------------- ends */

        private void declare() {
            phase = Phase.DONE;
            left = 8;

            UUID winner = null;
            double best = -1;

            for (UUID id : players) {
                double average = averageOf(id);
                if (average <= best) continue;

                best = average;
                winner = id;
            }

            announce(Text.heading("Results"));

            for (UUID id : plots.keySet()) {
                announce(Component.text("  " + nameOf(id), NamedTextColor.AQUA)
                        .append(Component.text("   " + String.format("%.1f", averageOf(id))
                                + " out of 5", NamedTextColor.DARK_GRAY)));
            }

            for (UUID id : players) {
                Player player = nexus.getServer().getPlayer(id);
                if (player == null) continue;

                boolean won = id.equals(winner);

                if (won) nexus.stats().wonMatch(id, 60);
                else nexus.stats().lostMatch(id, 10);

                nexus.stats().pay(id, won ? 400 : 100);

                player.showTitle(Title.title(
                        won ? Component.text("WINNER", NamedTextColor.GOLD)
                                : Component.text("Well built", NamedTextColor.GREEN),
                        Component.text(won ? "+$400" : "+$100", NamedTextColor.GREEN),
                        Title.Times.times(Duration.ofMillis(300), Duration.ofSeconds(3),
                                Duration.ofMillis(500))));
            }
        }

        private double averageOf(UUID id) {
            List<Integer> theirs = ratings.get(id);
            if (theirs == null || theirs.isEmpty()) return 0;

            int total = 0;
            for (int score : theirs) total += score;

            return total / (double) theirs.size();
        }

        private String nameOf(UUID id) {
            Player online = nexus.getServer().getPlayer(id);
            if (online != null) return online.getName();

            String name = nexus.getServer().getOfflinePlayer(id).getName();
            return name == null ? "somebody" : name;
        }

        /* ---------------------------------------------------------- the rules */

        /**
         * Whether this edit is refused.
         *
         * Only inside your own plot, and only while there is building to do.
         * Returning true means no, which matches how the other games ask.
         */
        public boolean refuseEdit(Player player, Block block) {
            if (phase != Phase.BUILDING) return true;

            Integer plot = plots.get(player.getUniqueId());
            if (plot == null) return true;

            int x0 = plot * (PLOT + GAP);

            return block.getX() < x0 || block.getX() >= x0 + PLOT
                    || block.getZ() < 0 || block.getZ() >= PLOT
                    || block.getY() <= FLOOR || block.getY() > FLOOR + CEILING;
        }

        public String worldName() {
            return world == null ? null : world.getName();
        }

        @Override
        public void remove(Player player) {
            players.remove(player.getUniqueId());
            plots.remove(player.getUniqueId());
            ratings.remove(player.getUniqueId());

            if (players.size() < 2) finish();
        }

        @Override
        protected void teardown() {
            for (UUID id : players) {
                Player player = nexus.getServer().getPlayer(id);
                if (player == null) continue;

                player.setGameMode(GameMode.ADVENTURE);
                nexus.hub().send(player);
            }

            if (world != null) Arena.destroy(world);
        }
    }
}
