package dev.nexuscraft.nexus.minigames;

import dev.nexuscraft.nexus.Game;
import dev.nexuscraft.nexus.Match;
import dev.nexuscraft.nexus.Nexus;
import dev.nexuscraft.nexus.Text;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Material;
import org.bukkit.block.Block;
import org.bukkit.enchantments.Enchantment;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;

/**
 * Spleef: dig the floor out from under everybody else.
 *
 * The oldest Minecraft minigame there is and still one of the best, because the
 * rules fit in one sentence and the skill ceiling is nothing to do with combat.
 * Two floors rather than one — the lower deck buys a few seconds of survival
 * after somebody drops you, which is the difference between a game and a
 * coin toss.
 */
public final class Spleef implements Game {

    @Override
    public String id() {
        return "spleef";
    }

    @Override
    public String name() {
        return "Spleef";
    }

    @Override
    public String blurb() {
        return "Dig the floor out from under them.";
    }

    @Override
    public Material icon() {
        return Material.DIAMOND_SHOVEL;
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
        return new SpleefMatch(nexus, this);
    }

    /* ---------------------------------------------------------------- match */

    public static final class SpleefMatch extends Falling {

        private final Spleef game;

        SpleefMatch(Nexus nexus, Spleef game) {
            super(nexus);
            this.game = game;
        }

        @Override
        public Game game() {
            return game;
        }

        @Override
        protected String sidebarTitle() {
            return "SPLEEF";
        }

        @Override
        protected void buildFloor() {
            disc(FLOOR, Material.SNOW_BLOCK, RADIUS);
            disc(FLOOR - 8, Material.SNOW_BLOCK, RADIUS - 4);

            // A rim you cannot dig, so nobody can stand on the edge and be
            // safe by virtue of there being nothing under them to remove.
            for (int x = -RADIUS - 1; x <= RADIUS + 1; x++) {
                for (int z = -RADIUS - 1; z <= RADIUS + 1; z++) {
                    int distance = x * x + z * z;
                    if (distance <= RADIUS * RADIUS || distance > (RADIUS + 1) * (RADIUS + 1)) continue;
                    world.getBlockAt(x, FLOOR, z).setType(Material.BARRIER, false);
                }
            }
        }

        @Override
        protected void equip(Player player) {
            ItemStack shovel = new ItemStack(Material.DIAMOND_SHOVEL);
            shovel.addUnsafeEnchantment(Enchantment.EFFICIENCY, 5);
            shovel.editMeta(meta -> {
                meta.displayName(Text.item("Spleef Shovel", NamedTextColor.AQUA));
                meta.setUnbreakable(true);
            });
            player.getInventory().addItem(shovel);
        }

        /**
         * Snow, and only snow, and only once the countdown is over.
         *
         * Returning true means the break is refused. Digging during the
         * countdown would let somebody carve a moat around a neighbour before
         * the game has begun.
         */
        public boolean refuseBreak(Block block) {
            if (startingIn > 0) return true;
            return block.getType() != Material.SNOW_BLOCK;
        }
    }
}
