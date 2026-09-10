package dev.nexuscraft.nexus;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextDecoration;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.Sound;
import org.bukkit.block.Block;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.bukkit.persistence.PersistentDataType;

import java.util.List;

/**
 * Point at where a bot should stand, and click.
 *
 * Placing things by standing in the right spot and typing a command is
 * genuinely awkward: you have to get your feet exactly right, face the correct
 * way, remember the id, and you cannot see the result until you have already
 * committed. Nineteen of those in a row is a bad evening, and it is the part of
 * setting this server up that people give up during.
 *
 * A wand fixes all of it at once. You hold it, you look at a block from
 * anywhere, you click, and the bot appears standing on that block facing you.
 * Shift-click cycles which bot the wand is holding, so the whole lobby is laid
 * out without touching the keyboard.
 */
public final class Placer {

    private static final String TOOL = "nexus_placer";

    private final Nexus nexus;
    private final NamespacedKey marker;

    public Placer(Nexus nexus) {
        this.nexus = nexus;
        this.marker = new NamespacedKey(nexus, TOOL);
    }

    /* ----------------------------------------------------------------- wand */

    public ItemStack wandFor(String id) {
        ItemStack wand = new ItemStack(Material.BLAZE_ROD);

        wand.editMeta(meta -> {
            meta.displayName(Component.text("Placing: ", NamedTextColor.GRAY)
                    .append(Component.text(id, NamedTextColor.AQUA, TextDecoration.BOLD))
                    .decoration(TextDecoration.ITALIC, false));

            meta.lore(List.of(
                    Text.item("Right click a block to put it there", NamedTextColor.YELLOW),
                    Text.item("Shift + right click for the next one", NamedTextColor.GRAY),
                    Text.item("Shift + left click for the one before", NamedTextColor.GRAY),
                    Component.empty(),
                    Text.item("Drop it when you are done", NamedTextColor.DARK_GRAY)));

            meta.getPersistentDataContainer().set(marker, PersistentDataType.STRING, id);
        });

        return wand;
    }

    /** Which bot this wand is holding, or null if it is not one. */
    public String heldBy(ItemStack item) {
        if (item == null || item.getType() != Material.BLAZE_ROD) return null;
        if (!item.hasItemMeta()) return null;

        return item.getItemMeta().getPersistentDataContainer()
                .get(marker, PersistentDataType.STRING);
    }

    public void give(Player player, String id) {
        player.getInventory().addItem(wandFor(id));

        player.sendMessage(Text.heading("Placement Wand"));
        player.sendMessage(Text.plain("  Right click a block to stand " + id + " on it."));
        player.sendMessage(Text.plain("  Sneak + right click for the next bot, left click for the one before."));
        player.sendMessage(Text.plain("  Or /nexus wand <name> to jump straight to one."));
        player.sendMessage(Text.plain("  " + String.join(", ", Hub.npcIds())));
    }

    /* ---------------------------------------------------------------- using */

    /**
     * Puts the held bot on top of the block they clicked.
     *
     * On top of, rather than at, because you point at the floor you want it to
     * stand on — pointing at the air above a floor is a much harder thing to do
     * accurately, and the floor is the thing you can see.
     */
    public void placeAt(Player player, String id, Block clicked) {
        Location standing = clicked.getLocation().add(0.5, 1, 0.5);

        if (!standing.getBlock().isPassable()
                || !standing.clone().add(0, 1, 0).getBlock().isPassable()) {
            player.sendMessage(Text.bad("Nothing can stand there — something is in the way."));
            player.playSound(player, Sound.ENTITY_VILLAGER_NO, 1f, 1f);
            return;
        }

        // Turned to face whoever placed it, which is almost always the way it
        // should be looking: you stand where the players will come from.
        Location facing = player.getLocation();
        double dx = facing.getX() - standing.getX();
        double dz = facing.getZ() - standing.getZ();
        standing.setYaw((float) Math.toDegrees(Math.atan2(-dx, dz)));
        standing.setPitch(0f);

        /*
         * Added, not moved.
         *
         * Placing a second of something used to overwrite the first, which
         * from the outside looks exactly like the wand failing — you click,
         * nothing new appears, and the one you already had has quietly jumped
         * across the plaza. /nexus clearnpc is the way back.
         */
        nexus.settings().addNpc(id, standing);
        nexus.hub().placeNpcs();

        int now = nexus.settings().npcsAt(id, standing.getWorld()).size();
        player.sendMessage(Text.good(id + " placed."
                + (now > 1 ? "  (" + now + " of them now)" : "")));
        player.playSound(player, Sound.BLOCK_NOTE_BLOCK_PLING, 1f, 1.6f);
    }

    /**
     * Moves the wand along the list, forwards or back.
     *
     * Both ways because there are thirty of them: overshooting the one you
     * wanted used to mean twenty-nine more clicks to come back round to it,
     * which is how somebody concludes the one they want is not in the list.
     */
    public void cycle(Player player, String current, int step) {
        List<String> ids = Hub.npcIds();

        int at = ids.indexOf(current);

        // Java's % keeps the sign of the left operand, so stepping back from
        // the first entry lands on -1 and throws rather than wrapping.
        int to = ((at + step) % ids.size() + ids.size()) % ids.size();
        String next = ids.get(to);

        player.getInventory().setItemInMainHand(wandFor(next));
        // Where in the list, so thirty bots is a place rather than a blur.
        player.sendActionBar(Component.text("Placing: ", NamedTextColor.GRAY)
                .append(Component.text(next, NamedTextColor.AQUA))
                .append(Component.text("   " + (to + 1) + " of " + ids.size(),
                        NamedTextColor.DARK_GRAY)));
        player.playSound(player, Sound.UI_BUTTON_CLICK, 0.6f, 1.4f);
    }
}
