package dev.nexuscraft.nexus;

import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.PlayerInventory;

import java.io.File;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * One inventory per world, per player.
 *
 * This exists because of a hole big enough to end the server: creative mode
 * hands out infinite diamonds, and without this, walking from Creative to
 * Survival brought them with you. Anybody could empty the economy in about
 * thirty seconds, and would.
 *
 * Clearing the inventory on the way out would close the hole and would also be
 * a terrible thing to do to somebody who has been building in survival all
 * evening and fancies a look at the creative world. So instead each world keeps
 * its own: what you were carrying in survival is waiting for you when you go
 * back, and what you filled your pockets with in creative stays in creative.
 *
 * That is how every network handles it, and the reason is the same everywhere —
 * it is the only version of this that is both safe and not infuriating.
 */
public final class Backpacks {

    /** Everything worth restoring about a player in one world. */
    private static final class Stored {
        ItemStack[] contents = new ItemStack[0];
        ItemStack[] armour = new ItemStack[0];
        ItemStack offHand;
        int level;
        float experience;
    }

    private final Nexus nexus;
    private final File file;

    private final Map<UUID, Map<Worlds.Place, Stored>> packs = new HashMap<>();

    public Backpacks(Nexus nexus) {
        this.nexus = nexus;
        this.file = new File(nexus.getDataFolder(), "backpacks.yml");
        load();
    }

    /**
     * Puts away what somebody is carrying in the world they are leaving.
     *
     * The hub and the minigames are deliberately not stored. Both hand out
     * their own kit and clear it again, so saving what somebody was holding in
     * a Bed Wars match would restore a wooden sword into their survival
     * inventory a week later.
     */
    public void stash(Player player, Worlds.Place leaving) {
        if (leaving == null) return;

        PlayerInventory inventory = player.getInventory();

        Stored stored = new Stored();
        stored.contents = inventory.getStorageContents().clone();
        stored.armour = inventory.getArmorContents().clone();
        stored.offHand = inventory.getItemInOffHand().clone();
        stored.level = player.getLevel();
        stored.experience = player.getExp();

        packs.computeIfAbsent(player.getUniqueId(), id -> new EnumMap<>(Worlds.Place.class))
                .put(leaving, stored);
    }

    /**
     * Throws away what somebody had stored in one world.
     *
     * For starting an island again: their skyblock chest is theirs, but a
     * fresh start that hands back the inventory they had a minute ago is not a
     * fresh start.
     */
    public void clear(UUID who, Worlds.Place place) {
        Map<Worlds.Place, Stored> theirs = packs.get(who);
        if (theirs != null) theirs.remove(place);
    }

    /** Gives back whatever they left in the world they are arriving in. */
    public void restore(Player player, Worlds.Place arriving) {
        PlayerInventory inventory = player.getInventory();

        inventory.clear();
        inventory.setArmorContents(null);
        inventory.setItemInOffHand(null);
        player.setLevel(0);
        player.setExp(0f);

        Map<Worlds.Place, Stored> theirs = packs.get(player.getUniqueId());
        Stored stored = theirs == null ? null : theirs.get(arriving);
        if (stored == null) return;

        inventory.setStorageContents(fit(stored.contents, inventory.getStorageContents().length));
        inventory.setArmorContents(fit(stored.armour, inventory.getArmorContents().length));
        if (stored.offHand != null) inventory.setItemInOffHand(stored.offHand);

        player.setLevel(stored.level);
        player.setExp(stored.experience);
        player.updateInventory();
    }

    /**
     * Pads or trims a saved array to the size the inventory wants.
     *
     * Saved data outlives the version it was written by, and setStorageContents
     * throws on the wrong length rather than ignoring the extra. A player whose
     * inventory cannot be restored would be stuck at the loading screen, which
     * is a much worse bug than a lost hotbar slot.
     */
    private ItemStack[] fit(ItemStack[] saved, int size) {
        ItemStack[] out = new ItemStack[size];
        if (saved != null) System.arraycopy(saved, 0, out, 0, Math.min(saved.length, size));
        return out;
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

            for (Worlds.Place place : Worlds.Place.values()) {
                String path = key + "." + place.name();
                if (!yaml.isSet(path)) continue;

                Stored stored = new Stored();
                stored.contents = toArray(yaml.getList(path + ".contents"));
                stored.armour = toArray(yaml.getList(path + ".armour"));
                stored.offHand = yaml.getItemStack(path + ".offHand");
                stored.level = yaml.getInt(path + ".level");
                stored.experience = (float) yaml.getDouble(path + ".experience");

                packs.computeIfAbsent(who, id -> new EnumMap<>(Worlds.Place.class))
                        .put(place, stored);
            }
        }
    }

    private ItemStack[] toArray(List<?> list) {
        if (list == null) return new ItemStack[0];

        ItemStack[] out = new ItemStack[list.size()];
        for (int i = 0; i < list.size(); i++) {
            out[i] = list.get(i) instanceof ItemStack stack ? stack : null;
        }
        return out;
    }

    public void save() {
        YamlConfiguration yaml = new YamlConfiguration();

        for (Map.Entry<UUID, Map<Worlds.Place, Stored>> entry : packs.entrySet()) {
            for (Map.Entry<Worlds.Place, Stored> held : entry.getValue().entrySet()) {
                String path = entry.getKey() + "." + held.getKey().name();
                Stored stored = held.getValue();

                yaml.set(path + ".contents", java.util.Arrays.asList(stored.contents));
                yaml.set(path + ".armour", java.util.Arrays.asList(stored.armour));
                yaml.set(path + ".offHand", stored.offHand);
                yaml.set(path + ".level", stored.level);
                yaml.set(path + ".experience", stored.experience);
            }
        }

        try {
            yaml.save(file);
        } catch (Exception e) {
            nexus.getLogger().warning("could not save backpacks: " + e);
        }
    }
}
