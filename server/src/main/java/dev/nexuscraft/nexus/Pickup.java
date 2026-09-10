package dev.nexuscraft.nexus;

import org.bukkit.block.Block;
import org.bukkit.entity.Player;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.inventory.InventoryHolder;
import org.bukkit.inventory.ItemStack;

/**
 * Mined blocks go into your hands, not onto the floor.
 *
 * In the island worlds the floor is usually lava or a very long drop. Building
 * a cobblestone generator means digging a channel and then standing next to
 * lava chipping cobble off it, and every block you break lands in the lava you
 * just made. The vanilla behaviour is fine on the ground and actively hostile
 * in the sky.
 *
 * Only applied where it is the difference between playing and not. Prison and
 * survival keep the ordinary behaviour, because there the floor is a floor and
 * picking things up is part of the rhythm.
 */
public final class Pickup {

    private Pickup() {
    }

    /**
     * Hands a break's drops to the player.
     *
     * Containers are deliberately left alone. A chest's contents are not part
     * of getDrops, so suppressing the natural drop on one would delete
     * everything inside it — the opposite of what this is for, and a much worse
     * bug than the one it fixes.
     */
    public static void straightToPlayer(Player player, BlockBreakEvent event) {
        Block block = event.getBlock();
        if (block.getState() instanceof InventoryHolder) return;

        event.setDropItems(false);

        ItemStack tool = player.getInventory().getItemInMainHand();
        for (ItemStack drop : block.getDrops(tool, player)) {
            for (ItemStack spare : player.getInventory().addItem(drop).values()) {
                // A full inventory drops at their feet, where there is ground,
                // rather than in the hole they are standing over.
                player.getWorld().dropItem(player.getLocation().add(0, 0.2, 0), spare);
            }
        }

        // The experience would go the same way as the blocks, so it comes too.
        int experience = event.getExpToDrop();
        if (experience > 0) {
            event.setExpToDrop(0);
            player.giveExp(experience);
        }
    }
}
