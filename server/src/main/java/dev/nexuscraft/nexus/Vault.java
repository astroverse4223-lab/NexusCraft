package dev.nexuscraft.nexus;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.Sound;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.entity.Player;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;

import java.io.File;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Where things wait when there is nowhere to put them.
 *
 * This exists because of a bug that was quietly costing people their rewards.
 * Keys, prizes and crate winnings were pushed straight into the inventory, and
 * when that was full the overflow was dropped on the floor — where it despawns
 * in five minutes, or falls into lava, or is simply not noticed. A legendary
 * key lost that way is indistinguishable from never having been given one.
 *
 * So nothing is ever dropped now. Anything that will not fit comes here and
 * stays until it is collected, which also gives people a reason to walk back to
 * spawn and stand next to each other.
 */
public final class Vault {

    /** Six rows. Past that somebody has stopped collecting and it is on them. */
    private static final int SIZE = 54;

    public static final Component TITLE =
            Component.text("Vault", NamedTextColor.DARK_GRAY);

    private final Nexus nexus;
    private final File file;

    private final Map<UUID, List<ItemStack>> held = new HashMap<>();

    public Vault(Nexus nexus) {
        this.nexus = nexus;
        this.file = new File(nexus.getDataFolder(), "vault.yml");
        load();
    }

    /* --------------------------------------------------------------- giving */

    /**
     * Gives somebody an item, using the vault only if it has to.
     *
     * The order matters and is the whole point: hand it over if there is room,
     * because a reward you have to go and collect is a worse reward. The vault
     * is the safety net, not the delivery mechanism.
     */
    public void give(Player player, ItemStack item) {
        for (ItemStack spare : player.getInventory().addItem(item).values()) {
            store(player.getUniqueId(), spare);

            player.sendMessage(Text.says("Your inventory is full. ")
                    .append(Component.text("It is in the vault.", NamedTextColor.YELLOW)));
        }
    }

    /** Straight to the vault, for somebody who is not online. */
    public void store(UUID who, ItemStack item) {
        held.computeIfAbsent(who, id -> new ArrayList<>()).add(item.clone());
        save();
    }

    public int waiting(UUID who) {
        List<ItemStack> theirs = held.get(who);
        return theirs == null ? 0 : theirs.size();
    }

    /** Told on join, so nobody forgets something is there. */
    public void remind(Player player) {
        int waiting = waiting(player.getUniqueId());
        if (waiting == 0) return;

        player.sendMessage(Component.text("  " + waiting + " thing"
                        + (waiting == 1 ? "" : "s") + " waiting in the vault.  ",
                        NamedTextColor.GRAY)
                .append(Component.text("/vault", Text.BRAND)));
    }

    /* -------------------------------------------------------------- taking */

    public void open(Player player) {
        Inventory menu = Bukkit.createInventory(null, SIZE, TITLE);

        List<ItemStack> theirs = held.get(player.getUniqueId());
        if (theirs != null) {
            for (int i = 0; i < Math.min(theirs.size(), SIZE); i++) {
                menu.setItem(i, theirs.get(i));
            }
        }

        player.openInventory(menu);
    }

    /**
     * Puts back whatever is left when the window closes.
     *
     * The window is the list, rather than a copy of it — anything the player
     * took is simply gone from the inventory, and what remains is what they
     * left. Tracking individual clicks would be more code and one race away
     * from duplicating a nether star.
     */
    public void settle(Player player, Inventory menu) {
        List<ItemStack> left = new ArrayList<>();

        for (ItemStack stack : menu.getContents()) {
            if (stack != null && stack.getType() != Material.AIR) left.add(stack);
        }

        if (left.isEmpty()) held.remove(player.getUniqueId());
        else held.put(player.getUniqueId(), left);

        save();

        if (left.isEmpty()) {
            player.sendMessage(Text.good("Vault emptied."));
            player.playSound(player, Sound.BLOCK_CHEST_CLOSE, 0.8f, 1.2f);
        }
    }

    /* -------------------------------------------------------------- on disk */

    @SuppressWarnings("unchecked")
    private void load() {
        if (!file.exists()) return;

        YamlConfiguration yaml = YamlConfiguration.loadConfiguration(file);
        for (String key : yaml.getKeys(false)) {
            UUID who;
            try {
                who = UUID.fromString(key);
            } catch (IllegalArgumentException notAnId) {
                continue;
            }

            List<ItemStack> theirs = new ArrayList<>();
            for (Object entry : yaml.getList(key, List.of())) {
                if (entry instanceof ItemStack stack) theirs.add(stack);
            }
            if (!theirs.isEmpty()) held.put(who, theirs);
        }
    }

    public void save() {
        YamlConfiguration yaml = new YamlConfiguration();
        for (Map.Entry<UUID, List<ItemStack>> entry : held.entrySet()) {
            yaml.set(entry.getKey().toString(), entry.getValue());
        }

        try {
            yaml.save(file);
        } catch (Exception e) {
            nexus.getLogger().warning("could not save the vault: " + e);
        }
    }
}
