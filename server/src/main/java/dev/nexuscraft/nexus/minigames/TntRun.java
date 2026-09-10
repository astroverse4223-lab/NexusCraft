package dev.nexuscraft.nexus.minigames;

import dev.nexuscraft.nexus.Game;
import dev.nexuscraft.nexus.Match;
import dev.nexuscraft.nexus.Nexus;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.block.Block;
import org.bukkit.entity.Player;

import java.util.HashMap;
import java.util.Map;

/**
 * TNT Run: the floor goes wherever you have been.
 *
 * No tools, no combat, nothing to learn — you run, and the block you were
 * standing on a moment ago is gone. It is the easiest game here to walk into
 * and the hardest to stop playing, which is exactly what a lobby needs beside
 * something as long as Bed Wars.
 *
 * Three decks deep. One is over in twenty seconds; three gives you a chance to
 * drop deliberately, which is the only real tactic the game has.
 */
public final class TntRun implements Game {

    @Override
    public String id() {
        return "tntrun";
    }

    @Override
    public String name() {
        return "TNT Run";
    }

    @Override
    public String blurb() {
        return "Keep moving. The floor will not.";
    }

    @Override
    public Material icon() {
        return Material.TNT;
    }

    @Override
    public int minPlayers() {
        return 2;
    }

    @Override
    public int maxPlayers() {
        return 16;
    }

    @Override
    public Match newMatch(Nexus nexus) {
        return new TntRunMatch(nexus, this);
    }

    /* ---------------------------------------------------------------- match */

    public static final class TntRunMatch extends Falling {

        /** The three decks, top first. */
        private static final int[] DECKS = {FLOOR, FLOOR - 6, FLOOR - 12};

        /**
         * How long a block survives being stood on, in ticks.
         *
         * Short enough that standing still is fatal, long enough that a normal
         * running stride never drops you through the block you are pushing off.
         */
        private static final int CRUMBLE = 6;

        private final TntRun game;

        /** Blocks that are going, and when. */
        private final Map<Block, Integer> crumbling = new HashMap<>();

        TntRunMatch(Nexus nexus, TntRun game) {
            super(nexus);
            this.game = game;
        }

        @Override
        public Game game() {
            return game;
        }

        @Override
        protected String sidebarTitle() {
            return "TNT RUN";
        }

        @Override
        protected void buildFloor() {
            for (int deck : DECKS) {
                disc(deck, Material.RED_SAND, RADIUS);
                // A layer of TNT under each deck, which is decoration and is
                // also the whole reason anybody understands the game on sight.
                disc(deck - 1, Material.TNT, RADIUS);
            }
        }

        @Override
        protected void equip(Player player) {
            // Nothing. That is the game.
        }

        /**
         * Called from the move listener, which is the only thing fast enough.
         *
         * The match ticks once a second and a player crosses three blocks in
         * that time, so a tick-based version deletes the floor in stripes
         * behind people rather than under them.
         */
        public void stoodOn(Player player) {
            if (startingIn > 0 || !isAlive(player.getUniqueId())) return;

            Location at = player.getLocation();
            for (int dx = -1; dx <= 1; dx++) {
                for (int dz = -1; dz <= 1; dz++) {
                    Block below = at.clone().add(dx * 0.35, -0.2, dz * 0.35).getBlock();
                    if (below.getType() != Material.RED_SAND) continue;

                    crumbling.putIfAbsent(below, CRUMBLE);
                }
            }
        }

        /**
         * Ticked at twenty a second by the plugin's fast timer.
         *
         * Separate from {@link #tick()} which is once a second and is for
         * scoreboards. Two rates because the two jobs genuinely want different
         * ones, and running the sidebar twenty times a second would be waste.
         */
        public void crumble() {
            crumbling.entrySet().removeIf(entry -> {
                int left = entry.getValue() - 1;
                if (left > 0) {
                    entry.setValue(left);
                    return false;
                }

                Block block = entry.getKey();
                if (block.getType() == Material.RED_SAND) {
                    block.setType(Material.AIR, false);
                    block.getWorld().playSound(block.getLocation(),
                            org.bukkit.Sound.BLOCK_SAND_BREAK, 0.6f, 1.2f);
                }
                return true;
            });
        }
    }
}
