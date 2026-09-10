package dev.nexuscraft.nexus;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextDecoration;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.entity.Player;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.ItemMeta;
import org.bukkit.inventory.meta.components.EquippableComponent;
import org.bukkit.persistence.PersistentDataType;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Custom armour sets, as things the server can actually hand out.
 *
 * A resource pack cannot add an item, so a set is real armour wearing
 * different pictures: the same protection, durability and enchantability as
 * whatever it is built on, which means nothing here needs balancing against
 * anything. Two components do the work, and both are plain Bukkit API:
 * `item_model` swaps the inventory icon the way the cosmetic hats already do,
 * and `equippable.asset_id` names an equipment asset the pack defines, which
 * is what changes the armour drawn on the body.
 *
 * The sets are read from config rather than written here, and the launcher
 * writes that config when it builds the pack. So the ids the server hands out
 * are the ids the pack was built with, rather than the same list typed twice
 * in two languages and drifting apart the first time one of them changes.
 *
 * A player without the pack is handed ordinary armour and sees ordinary
 * armour, because a model nothing defines falls back to the item itself.
 * Nothing breaks for them, which is why none of this is gated on having it.
 */
public final class Armoury {

    /** The namespace the launcher's builder files pack models under. */
    private static final String PACK = "nexus";

    /** One of the four, and the slot it goes in. */
    public record Piece(String id, String label, EquipmentSlot slot) {}

    public static final List<Piece> PIECES = List.of(
            new Piece("helmet", "Helmet", EquipmentSlot.HEAD),
            new Piece("chestplate", "Chestplate", EquipmentSlot.CHEST),
            new Piece("leggings", "Leggings", EquipmentSlot.LEGS),
            new Piece("boots", "Boots", EquipmentSlot.FEET));

    /**
     * A set as the config describes it.
     *
     * `base` is the item prefix, not the texture name. Gold is the awkward one
     * - its worn layers are filed under "gold" while its items are "golden_*"
     * - so what is stored here is whatever makes `<base>_helmet` a real item.
     */
    public record Set(String id, String label, String base) {}

    private final Nexus nexus;
    private final Map<String, Set> sets = new LinkedHashMap<>();

    /** Marks a piece as ours, so it can be told from ordinary armour. */
    private final NamespacedKey marker;

    public Armoury(Nexus nexus) {
        this.nexus = nexus;
        this.marker = new NamespacedKey(nexus, "armoury_set");
        reload();
    }

    /** Re-reads the sets, after the launcher has written a new pack. */
    public void reload() {
        sets.clear();

        var section = nexus.getConfig().getConfigurationSection("armoury");
        if (section == null) return;

        for (String id : section.getKeys(false)) {
            String base = section.getString(id + ".base", "diamond");

            /*
             * A base that is not a real item would make every piece of the set
             * null later, at four separate call sites. Refused here instead,
             * once, with something in the log to read.
             */
            if (Material.matchMaterial(base + "_helmet") == null) {
                nexus.getLogger().warning("armoury: " + id + " is built on \"" + base
                        + "\", which is not armour this version has - skipping it");
                continue;
            }

            sets.put(id.toLowerCase(Locale.ROOT),
                    new Set(id.toLowerCase(Locale.ROOT), section.getString(id + ".label", id), base));
        }

        if (!sets.isEmpty()) {
            nexus.getLogger().info("armoury: " + sets.size() + " set(s) - " + String.join(", ", sets.keySet()));
        }
    }

    /* ------------------------------------------------------------- reading */

    public List<String> ids() {
        return List.copyOf(sets.keySet());
    }

    public boolean has(String id) {
        return id != null && sets.containsKey(id.toLowerCase(Locale.ROOT));
    }

    public Set get(String id) {
        return id == null ? null : sets.get(id.toLowerCase(Locale.ROOT));
    }

    public static Piece piece(String id) {
        for (Piece piece : PIECES) if (piece.id().equalsIgnoreCase(id)) return piece;
        return null;
    }

    /* ------------------------------------------------------------- making */

    /**
     * One piece of a set, ready to be given.
     *
     * Returns null rather than a broken item when the set is unknown, so a
     * caller wiring this into a crate cannot accidentally award a nameless
     * diamond helmet and never notice.
     */
    public ItemStack make(String setId, Piece piece) {
        Set set = get(setId);
        if (set == null || piece == null) return null;

        Material material = Material.matchMaterial(set.base() + "_" + piece.id());
        if (material == null) return null;

        ItemStack item = new ItemStack(material);
        ItemMeta meta = item.getItemMeta();
        if (meta == null) return null;

        // The inventory icon, exactly as the pack files it.
        meta.setItemModel(new NamespacedKey(PACK, set.id() + "_" + piece.id()));

        /*
         * The armour drawn on the body.
         *
         * getEquippable returns the item's existing component - armour always
         * has one - and only the slot and the asset need changing. Building a
         * fresh one would drop the equip sound and the dispenser behaviour
         * that came with the item.
         */
        EquippableComponent equippable = meta.getEquippable();
        equippable.setSlot(piece.slot());
        equippable.setModel(new NamespacedKey(PACK, set.id()));
        meta.setEquippable(equippable);

        meta.displayName(Component.text(set.label() + " " + piece.label())
                .color(NamedTextColor.AQUA)
                .decoration(TextDecoration.ITALIC, false));

        meta.getPersistentDataContainer().set(marker, PersistentDataType.STRING, set.id());

        item.setItemMeta(meta);
        return item;
    }

    /** Every piece of a set, in the order they are worn. */
    public List<ItemStack> whole(String setId) {
        List<ItemStack> out = new ArrayList<>();
        for (Piece piece : PIECES) {
            ItemStack made = make(setId, piece);
            if (made != null) out.add(made);
        }
        return out;
    }

    /* ------------------------------------------------------------- giving */

    /**
     * Hands somebody a whole set.
     *
     * Anything that will not fit is dropped at their feet rather than lost,
     * which matters here more than usual: a set is four items and a full
     * inventory is the ordinary state of anybody who has been playing.
     */
    public boolean give(Player player, String setId) {
        List<ItemStack> pieces = whole(setId);
        if (pieces.isEmpty()) return false;

        for (ItemStack piece : pieces) {
            for (ItemStack left : player.getInventory().addItem(piece).values()) {
                player.getWorld().dropItemNaturally(player.getLocation(), left);
            }
        }

        Set set = get(setId);
        player.sendMessage(Text.good("You have been given the " + set.label() + " set."));
        return true;
    }

    /**
     * A set worth dropping, or null when the pack defines none.
     *
     * Pinned by config when somebody wants a particular set to be the boss
     * reward, and otherwise whichever is first - so a server that has just
     * built its first pack gets working drops without anybody configuring
     * anything, which is the difference between a feature and a feature
     * somebody has to find.
     */
    public String dropSet(String forWhat) {
        if (sets.isEmpty()) return null;

        String pinned = nexus.getConfig().getString("armouryDrops." + forWhat, "");
        if (has(pinned)) return pinned.toLowerCase(Locale.ROOT);

        return sets.keySet().iterator().next();
    }

    /** Whether this is a piece of custom armour, and which set it came from. */
    public String setOf(ItemStack item) {
        if (item == null || !item.hasItemMeta()) return null;
        return item.getItemMeta().getPersistentDataContainer().get(marker, PersistentDataType.STRING);
    }
}
