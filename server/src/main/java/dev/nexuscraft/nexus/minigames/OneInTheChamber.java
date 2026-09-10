package dev.nexuscraft.nexus.minigames;

import dev.nexuscraft.nexus.Game;
import dev.nexuscraft.nexus.Match;
import dev.nexuscraft.nexus.Nexus;
import dev.nexuscraft.nexus.Text;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.Sound;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;

import java.util.List;
import java.util.UUID;

/**
 * One in the Chamber: one arrow, one hit, one life at a time.
 *
 * Every arrow kills and you only ever have one, so the whole game is deciding
 * whether this shot is the shot. Miss, and you are holding a sword against
 * somebody who is not. Hit, and you get the arrow back.
 *
 * It is the fairest game on the server by some distance - there is no gear, no
 * health bar to whittle down, and no advantage to having played it before
 * beyond aim - which makes it the right thing to point a new player at.
 */
public final class OneInTheChamber implements Game {

    /** Kills needed to end it early, before anybody runs out of lives. */
    static final int TARGET = 15;

    @Override
    public String id() {
        return "oitc";
    }

    @Override
    public String name() {
        return "One in the Chamber";
    }

    @Override
    public String blurb() {
        return "Every arrow kills. You get one.";
    }

    @Override
    public Material icon() {
        return Material.ARROW;
    }

    @Override
    public int minPlayers() {
        return 2;
    }

    @Override
    public int maxPlayers() {
        return 12;
    }

    @Override
    public Match newMatch(Nexus nexus) {
        return new ChamberMatch(nexus, this);
    }

    /* ---------------------------------------------------------------- match */

    public static final class ChamberMatch extends Fighting {

        private static final int RADIUS = 24;

        private final OneInTheChamber game;

        ChamberMatch(Nexus nexus, OneInTheChamber game) {
            super(nexus);
            this.game = game;
        }

        @Override
        public Game game() {
            return game;
        }

        @Override
        protected String sidebarTitle() {
            return "ONE IN THE CHAMBER";
        }

        @Override
        protected int lives() {
            return 5;
        }

        @Override
        protected void buildArena() {
            disc(FLOOR, Material.POLISHED_ANDESITE, RADIUS);

            /*
             * Cover, at three heights.
             *
             * A flat disc makes the bow win every exchange from across the map,
             * which turns a game about one decision into a game about who saw
             * whom first. The pillars give the sword somewhere to close from.
             */
            for (int i = 0; i < 10; i++) {
                double angle = 2 * Math.PI * i / 10;
                int x = (int) (Math.cos(angle) * (RADIUS - 8));
                int z = (int) (Math.sin(angle) * (RADIUS - 8));
                int height = 3 + (i % 3);

                box(x, FLOOR + 1, z, x + 1, FLOOR + height, z + 1,
                        Material.POLISHED_DIORITE);
            }

            // A raised middle, which is where people fight over.
            disc(FLOOR + 1, Material.POLISHED_BLACKSTONE, 4);
            disc(FLOOR + 2, Material.POLISHED_BLACKSTONE, 2);
        }

        @Override
        protected List<Location> spawns() {
            return ring(12, RADIUS - 3.0, FLOOR + 1);
        }

        @Override
        protected void equip(Player player) {
            var kit = player.getInventory();

            /*
             * A wooden sword that kills in one hit.
             *
             * Done with Sharpness rather than by special-casing the damage,
             * because the enchantment applies to exactly the thing that should
             * kill and nothing else - a fall, a stray arrow from a miss, or a
             * shove off the edge all still behave normally.
             */
            ItemStack sword = new ItemStack(Material.WOODEN_SWORD);
            sword.addUnsafeEnchantment(org.bukkit.enchantments.Enchantment.SHARPNESS, 12);

            kit.setItem(0, sword);
            kit.setItem(1, new ItemStack(Material.BOW));
            kit.setItem(8, new ItemStack(Material.ARROW, 1));

            // No armour at all. Armour would make the one-hit rule a lie.
            kit.setHeldItemSlot(0);
        }

        /**
         * A kill buys the arrow back.
         *
         * The rule the whole game turns on. Given as one arrow rather than
         * topping up to one, so a player who somehow has two after a strange
         * exchange keeps them - taking things away from somebody who just won
         * a fight reads as a bug even when it is a rule.
         */
        @Override
        protected void scored(Player killer, Player victim) {
            killer.getInventory().addItem(new ItemStack(Material.ARROW, 1));
            killer.playSound(killer, Sound.ENTITY_ARROW_HIT_PLAYER, 1f, 1.2f);

            int total = killsOf(killer.getUniqueId());
            killer.sendMessage(Text.good("Arrow back.  " + total + " of " + TARGET));

            if (total == TARGET - 3) {
                announce(Component.text(killer.getName(), NamedTextColor.GOLD)
                        .append(Component.text(" needs three more", NamedTextColor.GRAY)));
            }
        }

        @Override
        protected boolean decided() {
            UUID best = leader();
            return best != null && killsOf(best) >= TARGET;
        }
    }
}
