package dev.nexuscraft.nexus.minigames;

import dev.nexuscraft.nexus.Game;
import dev.nexuscraft.nexus.Match;
import dev.nexuscraft.nexus.Nexus;
import dev.nexuscraft.nexus.Text;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.block.Block;
import org.bukkit.block.Chest;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;

import java.util.ArrayList;
import java.util.List;
import java.util.Random;

/**
 * Skywars: an island each, a chest, and a very long way down.
 *
 * The one game here where the first thirty seconds are not a fight. Everybody
 * opens a chest, finds out what kind of match they are going to have, and then
 * decides whether to bridge towards the middle or wait for somebody else to.
 * That decision is the game, and it is why it survives being played a hundred
 * times when a pure fighting game does not.
 *
 * Loot is random within tiers rather than fixed. A fixed chest turns the first
 * thirty seconds into a formality, and identical islands turn the middle into
 * the only thing worth having.
 */
public final class SkyWars implements Game {

    @Override
    public String id() {
        return "skywars";
    }

    @Override
    public String name() {
        return "Skywars";
    }

    @Override
    public String blurb() {
        return "An island, a chest, and a long drop.";
    }

    @Override
    public Material icon() {
        return Material.END_STONE;
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
        return new SkyWarsMatch(nexus, this);
    }

    /* ---------------------------------------------------------------- match */

    public static final class SkyWarsMatch extends Fighting {

        /** How far each island sits from the middle. */
        private static final int ORBIT = 34;

        /** Islands, always eight, so the map looks the same however many play. */
        private static final int ISLANDS = 8;

        private final SkyWars game;
        private final Random random = new Random();

        SkyWarsMatch(Nexus nexus, SkyWars game) {
            super(nexus);
            this.game = game;
        }

        @Override
        public Game game() {
            return game;
        }

        @Override
        protected String sidebarTitle() {
            return "SKYWARS";
        }

        @Override
        protected void buildArena() {
            for (Location at : ring(ISLANDS, ORBIT, FLOOR)) {
                island(at.getBlockX(), at.getBlockZ(), false);
            }

            // The middle island, with the better chests, which is the reason
            // anybody leaves their own.
            island(0, 0, true);
        }

        /**
         * One small island: a dome of stone under a cap of grass.
         *
         * Built as a squashed sphere rather than a flat plate because a flat
         * plate has no underside to bridge from, and bridging out from under
         * somebody is half of what makes the game interesting to watch.
         */
        private void island(int cx, int cz, boolean middle) {
            int radius = middle ? 7 : 4;

            for (int x = -radius; x <= radius; x++) {
                for (int z = -radius; z <= radius; z++) {
                    for (int y = -radius; y <= 0; y++) {
                        double distance = (x * x + z * z) / (double) (radius * radius)
                                + (y * y) / (double) (radius * radius);
                        if (distance > 1.0) continue;

                        Material material = y == 0 ? Material.GRASS_BLOCK
                                : y > -2 ? Material.DIRT : Material.STONE;

                        world.getBlockAt(cx + x, FLOOR + y, cz + z)
                                .setType(material, false);
                    }
                }
            }

            if (middle) {
                chest(world.getBlockAt(cx + 2, FLOOR + 1, cz), true);
                chest(world.getBlockAt(cx - 2, FLOOR + 1, cz), true);
                chest(world.getBlockAt(cx, FLOOR + 1, cz + 2), true);
                chest(world.getBlockAt(cx, FLOOR + 1, cz - 2), true);
            } else {
                chest(world.getBlockAt(cx, FLOOR + 1, cz + 2), false);
            }
        }

        /**
         * Fills a chest.
         *
         * Through getBlockInventory rather than the block state, which is the
         * bug that shipped an empty skyblock chest: filling a snapshot throws
         * the items away and reports nothing wrong.
         */
        private void chest(Block block, boolean good) {
            block.setType(Material.CHEST, false);
            if (!(block.getState() instanceof Chest chest)) return;

            List<ItemStack> loot = good ? goodLoot() : ordinaryLoot();
            var inside = chest.getBlockInventory();

            for (ItemStack stack : loot) {
                inside.setItem(random.nextInt(inside.getSize()), stack);
            }
        }

        private List<ItemStack> ordinaryLoot() {
            List<ItemStack> loot = new ArrayList<>();

            loot.add(new ItemStack(pick(Material.STONE_SWORD, Material.IRON_SWORD,
                    Material.WOODEN_AXE)));
            loot.add(new ItemStack(pick(Material.LEATHER_CHESTPLATE,
                    Material.CHAINMAIL_CHESTPLATE, Material.IRON_HELMET)));
            loot.add(new ItemStack(Material.OAK_PLANKS, 16 + random.nextInt(17)));
            loot.add(new ItemStack(Material.COOKED_BEEF, 2 + random.nextInt(3)));

            // Not every chest has one, which is what makes opening it a moment.
            if (random.nextBoolean()) loot.add(new ItemStack(Material.BOW));
            if (random.nextBoolean()) loot.add(new ItemStack(Material.ARROW, 8));
            if (random.nextInt(4) == 0) loot.add(new ItemStack(Material.GOLDEN_APPLE));

            return loot;
        }

        private List<ItemStack> goodLoot() {
            List<ItemStack> loot = new ArrayList<>();

            loot.add(new ItemStack(pick(Material.IRON_SWORD, Material.DIAMOND_SWORD)));
            loot.add(new ItemStack(Material.IRON_CHESTPLATE));
            loot.add(new ItemStack(pick(Material.IRON_LEGGINGS, Material.DIAMOND_BOOTS)));
            loot.add(new ItemStack(Material.GOLDEN_APPLE, 2));
            loot.add(new ItemStack(Material.ENDER_PEARL, 1 + random.nextInt(2)));
            loot.add(new ItemStack(Material.OAK_PLANKS, 32));
            loot.add(new ItemStack(Material.BOW));
            loot.add(new ItemStack(Material.ARROW, 16));

            return loot;
        }

        private Material pick(Material... options) {
            return options[random.nextInt(options.length)];
        }

        @Override
        protected List<Location> spawns() {
            List<Location> out = new ArrayList<>();
            for (Location at : ring(ISLANDS, ORBIT, FLOOR + 1)) out.add(at);
            return out;
        }

        @Override
        protected void equip(Player player) {
            // Nothing. The chest is the kit, and that is the game.
            player.sendMessage(Text.says("Open your chest. The middle has better."));
        }
    }
}
