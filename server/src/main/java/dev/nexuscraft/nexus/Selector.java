package dev.nexuscraft.nexus;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.entity.Player;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.ItemMeta;

import java.util.ArrayList;
import java.util.List;

/**
 * The compass menu: everywhere you can go.
 *
 * It used to list only the minigames, which was a defensible split — worlds on
 * the greeters, games on the compass — and a bad one in practice. There is one
 * minigame, so a menu called "Play a Game" opened onto a single icon and read
 * as broken. Worse, it taught you that the compass is not where things are,
 * which is the opposite of what a compass is for.
 *
 * So it lists the same four destinations the greeters offer. The greeters are
 * for people walking around the castle; this is for people who already know
 * where they want to be. Neither is a second place to maintain: both are built
 * from {@link Hub#DESTINATIONS}.
 */
public final class Selector {

    /** Recognised on click by its title, so no state has to be tracked. */
    public static final Component TITLE =
            Component.text("Where to?", NamedTextColor.DARK_GRAY);

    private Selector() {
    }

    public static void open(Nexus nexus, Player player) {
        Hub.Destination[] destinations = Hub.DESTINATIONS;

        // A row per nine, so the menu grows on its own if more are added.
        int rows = Math.max(1, (destinations.length + 8) / 9);
        Inventory menu = Bukkit.createInventory(null, rows * 9, TITLE);

        for (int i = 0; i < destinations.length; i++) {
            menu.setItem(i, icon(nexus, destinations[i], player));
        }

        player.openInventory(menu);
    }

    /**
     * One destination, with whatever is worth knowing about it right now.
     *
     * A minigame shows its queue, because "3/16 waiting" is an invitation and a
     * silent icon is not. A world shows how many people are already in it, for
     * the same reason — the hardest problem a small server has is looking empty.
     */
    private static ItemStack icon(Nexus nexus, Hub.Destination destination, Player player) {
        Game game = nexus.games().byId(destination.id());
        boolean queued = destination.id().equals(nexus.games().queuedFor(player.getUniqueId()));

        ItemStack item = new ItemStack(destination.icon());
        item.editMeta(meta -> {
            // What this icon actually means, so a click does not have to be
            // guessed at from the material it happens to be made of.
            meta.getPersistentDataContainer().set(key(nexus),
                    org.bukkit.persistence.PersistentDataType.STRING, destination.id());

            meta.displayName(Text.item(destination.name(),
                    queued ? NamedTextColor.YELLOW : NamedTextColor.GREEN));

            List<Component> lore = new ArrayList<>();
            lore.add(Text.item(destination.blurb(), NamedTextColor.GRAY));
            lore.add(Component.empty());

            if (game != null) {
                int waiting = nexus.games().waitingFor(game.id());
                lore.add(Text.item(waiting + "/" + game.maxPlayers() + " waiting",
                        waiting > 0 ? NamedTextColor.AQUA : NamedTextColor.DARK_GRAY));
                lore.add(Text.item("Needs " + game.minPlayers() + " to start",
                        NamedTextColor.DARK_GRAY));
            } else {
                int there = playersIn(nexus, destination.id());
                lore.add(Text.item(there == 0 ? "Nobody there right now"
                                : there + (there == 1 ? " player there" : " players there"),
                        there > 0 ? NamedTextColor.AQUA : NamedTextColor.DARK_GRAY));
            }

            lore.add(Component.empty());
            lore.add(Text.item(queued ? "Click to leave the queue" : "Click to go",
                    queued ? NamedTextColor.RED : NamedTextColor.YELLOW));

            meta.lore(lore);
        });

        return item;
    }

    private static int playersIn(Nexus nexus, String id) {
        for (Worlds.Place place : Worlds.Place.values()) {
            if (!place.name().equalsIgnoreCase(id)) continue;

            var world = Bukkit.getWorld(place.world);
            return world == null ? 0 : world.getPlayers().size();
        }
        return 0;
    }

    /** The destination an icon stands for, written into the item itself. */
    public static org.bukkit.NamespacedKey key(Nexus nexus) {
        return new org.bukkit.NamespacedKey(nexus, "destination");
    }

    /**
     * Turns a click into a journey.
     *
     * Matched on an id written into the item, not on its material. Material was
     * ambiguous and quietly wrong: Survival and One Block are both a grass
     * block, Survival is listed first, and so every click on One Block went to
     * Survival instead. It also meant any grass block a player happened to
     * click in their own inventory sent them somewhere.
     */
    public static boolean clicked(Nexus nexus, Player player, ItemStack clickedItem) {
        if (clickedItem == null) return false;

        ItemMeta meta = clickedItem.getItemMeta();
        if (meta == null) return false;

        String id = meta.getPersistentDataContainer()
                .get(key(nexus), org.bukkit.persistence.PersistentDataType.STRING);
        if (id == null) return false;

        for (Hub.Destination destination : Hub.DESTINATIONS) {
            if (!destination.id().equals(id)) continue;

            // A second click on a queue you are already in leaves it, which is
            // the only way out of one without a command.
            if (destination.id().equals(nexus.games().queuedFor(player.getUniqueId()))) {
                nexus.games().leave(player, false);
            } else {
                nexus.travel(player, destination.id());
            }

            player.closeInventory();
            return true;
        }
        return false;
    }
}
