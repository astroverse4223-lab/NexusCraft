package dev.nexuscraft.nexus.minigames;

import dev.nexuscraft.nexus.Game;
import dev.nexuscraft.nexus.Match;
import dev.nexuscraft.nexus.Nexus;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.enchantments.Enchantment;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;

import java.util.List;

/**
 * Sumo: a small platform over nothing, and a stick.
 *
 * The shortest game on the server and the one people play between other games.
 * Nobody can be hurt - every hit is pure knockback - so a round is decided
 * entirely by footwork and the edge, and it is over in under a minute.
 *
 * That is deliberate. A lobby needs something that fills the ninety seconds
 * while a Bed Wars queue is one player short, and a game where losing costs
 * nothing is the only kind anybody will start in that window.
 */
public final class Sumo implements Game {

    @Override
    public String id() {
        return "sumo";
    }

    @Override
    public String name() {
        return "Sumo";
    }

    @Override
    public String blurb() {
        return "Push them off. Nobody gets hurt.";
    }

    @Override
    public Material icon() {
        return Material.STICK;
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
    public int countdownSeconds() {
        return 12;
    }

    @Override
    public Match newMatch(Nexus nexus) {
        return new SumoMatch(nexus, this);
    }

    /* ---------------------------------------------------------------- match */

    public static final class SumoMatch extends Fighting {

        /**
         * Small enough that there is nowhere to hide.
         *
         * Eight players on a radius of seven is crowded, which is the point -
         * a bigger ring turns the game into everybody circling until two of
         * them get bored.
         */
        private static final int RADIUS = 7;

        private final Sumo game;

        SumoMatch(Nexus nexus, Sumo game) {
            super(nexus);
            this.game = game;
        }

        @Override
        public Game game() {
            return game;
        }

        @Override
        protected String sidebarTitle() {
            return "SUMO";
        }

        @Override
        protected boolean damaging() {
            // Every hit still knocks somebody back; none of them take health.
            return false;
        }

        @Override
        protected void buildArena() {
            disc(FLOOR, Material.SMOOTH_QUARTZ, RADIUS);

            // A ring of a different block on the very edge, so the boundary is
            // something you can see while looking at somebody else.
            for (int x = -RADIUS; x <= RADIUS; x++) {
                for (int z = -RADIUS; z <= RADIUS; z++) {
                    int distance = x * x + z * z;
                    if (distance <= RADIUS * RADIUS && distance > (RADIUS - 1) * (RADIUS - 1)) {
                        world.getBlockAt(x, FLOOR, z).setType(Material.RED_CONCRETE, false);
                    }
                }
            }
        }

        @Override
        protected List<Location> spawns() {
            return ring(8, RADIUS - 2.0, FLOOR + 1);
        }

        @Override
        protected void equip(Player player) {
            /*
             * A stick with knockback, which is the entire game.
             *
             * Knockback II rather than I: with I a hit barely moves anybody and
             * rounds go on until somebody mistimes a jump, which is not the
             * game people came for.
             */
            ItemStack stick = new ItemStack(Material.STICK);
            stick.addUnsafeEnchantment(Enchantment.KNOCKBACK, 2);

            player.getInventory().setItem(0, stick);
            player.getInventory().setHeldItemSlot(0);
        }
    }
}
