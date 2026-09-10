package dev.nexuscraft.nexus.minigames;

import dev.nexuscraft.nexus.Game;
import dev.nexuscraft.nexus.Match;
import dev.nexuscraft.nexus.Nexus;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;

import java.util.List;

/**
 * Duels: two people, the same kit, no excuses.
 *
 * Every other game here has something to blame - the floor went, somebody
 * third-partied, the chest had nothing in it. This one has none of that, which
 * is why every server that has it finds people playing it more than anything
 * else once they know each other.
 *
 * Both players get exactly the same things, deliberately. A duel where one
 * person found better gear is not a duel.
 */
public final class Duels implements Game {

    @Override
    public String id() {
        return "duels";
    }

    @Override
    public String name() {
        return "Duels";
    }

    @Override
    public String blurb() {
        return "Same kit, one life, one winner.";
    }

    @Override
    public Material icon() {
        return Material.IRON_SWORD;
    }

    @Override
    public int minPlayers() {
        return 2;
    }

    @Override
    public int maxPlayers() {
        return 2;
    }

    @Override
    public int countdownSeconds() {
        return 10;
    }

    @Override
    public Match newMatch(Nexus nexus) {
        return new DuelMatch(nexus, this);
    }

    /* ---------------------------------------------------------------- match */

    public static final class DuelMatch extends Fighting {

        private static final int HALF = 16;
        private static final int WALL = 8;

        private final Duels game;

        DuelMatch(Nexus nexus, Duels game) {
            super(nexus);
            this.game = game;
        }

        @Override
        public Game game() {
            return game;
        }

        @Override
        protected String sidebarTitle() {
            return "DUELS";
        }

        @Override
        protected void buildArena() {
            box(-HALF, FLOOR, -HALF, HALF, FLOOR, HALF, Material.SMOOTH_STONE);

            /*
             * Walls high enough that knockback cannot end it.
             *
             * Without them a duel is decided by whoever lands the first hit
             * near an edge, which is Sumo - and Sumo is already on the server.
             * The walls make it about the fight.
             */
            for (int i = -HALF; i <= HALF; i++) {
                for (int y = FLOOR + 1; y <= FLOOR + WALL; y++) {
                    world.getBlockAt(i, y, -HALF).setType(Material.SMOOTH_STONE, false);
                    world.getBlockAt(i, y, HALF).setType(Material.SMOOTH_STONE, false);
                    world.getBlockAt(-HALF, y, i).setType(Material.SMOOTH_STONE, false);
                    world.getBlockAt(HALF, y, i).setType(Material.SMOOTH_STONE, false);
                }
            }

            // Two pillars to break line of sight, so a bow is not an automatic
            // win against somebody who brought a sword.
            box(-5, FLOOR + 1, -5, -4, FLOOR + 4, -4, Material.MOSSY_COBBLESTONE);
            box(4, FLOOR + 1, 4, 5, FLOOR + 4, 5, Material.MOSSY_COBBLESTONE);
        }

        @Override
        protected List<Location> spawns() {
            Location west = new Location(world, -HALF + 3.5, FLOOR + 1, 0.5);
            west.setDirection(new org.bukkit.util.Vector(1, 0, 0));

            Location east = new Location(world, HALF - 2.5, FLOOR + 1, 0.5);
            east.setDirection(new org.bukkit.util.Vector(-1, 0, 0));

            return List.of(west, east);
        }

        @Override
        protected void equip(Player player) {
            var kit = player.getInventory();

            kit.setItem(0, new ItemStack(Material.IRON_SWORD));
            kit.setItem(1, new ItemStack(Material.BOW));
            kit.setItem(2, new ItemStack(Material.GOLDEN_APPLE, 2));
            kit.setItem(8, new ItemStack(Material.ARROW, 12));

            kit.setHelmet(new ItemStack(Material.IRON_HELMET));
            kit.setChestplate(new ItemStack(Material.IRON_CHESTPLATE));
            kit.setLeggings(new ItemStack(Material.IRON_LEGGINGS));
            kit.setBoots(new ItemStack(Material.IRON_BOOTS));

            kit.setHeldItemSlot(0);
        }
    }
}
