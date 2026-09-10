package dev.nexuscraft.nexus;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.Particle;
import org.bukkit.Sound;
import org.bukkit.entity.Player;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Trails and hats: things that do nothing, which is the point.
 *
 * Two reasons this is worth more than it looks.
 *
 * The first is economic. Cosmetics are a bottomless money sink — somebody who
 * has bought every enchantment still has nothing to spend on, and a hat costs
 * whatever you say it costs without unbalancing anything, because it does not
 * do anything.
 *
 * The second matters if this server is ever going to take money. Mojang's
 * commercial guidelines are strict about what a server may sell: nothing that
 * confers gameplay advantage, nothing that gates access. Cosmetics are the
 * category that is explicitly fine, which makes this the only part of the whole
 * plugin that could ever be sold for real money rather than in-game currency.
 *
 * So they are built to be sellable: owned permanently, stored per player, and
 * grantable by an operator without touching anything else.
 */
public final class Cosmetics {

    public static final Component TITLE =
            Component.text("Cosmetics", NamedTextColor.DARK_GRAY);

    /** A trail: what it draws behind you, and what it costs. */
    public enum Trail {
        NONE("None", Particle.ASH, Material.BARRIER, 0),
        FLAME("Flame", Particle.FLAME, Material.BLAZE_POWDER, 15_000),
        HEART("Hearts", Particle.HEART, Material.POPPY, 20_000),
        NOTE("Music", Particle.NOTE, Material.NOTE_BLOCK, 20_000),
        CLOUD("Cloud", Particle.CLOUD, Material.WHITE_WOOL, 25_000),
        PORTAL("Portal", Particle.PORTAL, Material.OBSIDIAN, 35_000),
        SOUL("Soul Fire", Particle.SOUL_FIRE_FLAME, Material.SOUL_SAND, 50_000),
        DRAGON("Dragon Breath", Particle.DRAGON_BREATH, Material.DRAGON_BREATH, 90_000),
        TOTEM("Totem", Particle.TOTEM_OF_UNDYING, Material.TOTEM_OF_UNDYING, 150_000);

        public final String label;
        public final Particle particle;
        public final Material icon;
        public final int price;

        Trail(String label, Particle particle, Material icon, int price) {
            this.label = label;
            this.particle = particle;
            this.icon = icon;
            this.price = price;
        }
    }

    /**
     * Hats are blocks worn on the head.
     *
     * Which means they occupy the helmet slot, and that is a real cost: a hat
     * is armour you are not wearing. Worth saying out loud because it is the
     * one cosmetic here that is not purely cosmetic, and somebody will notice.
     */
    public enum Hat {
        NONE("None", Material.BARRIER, 0),
        PUMPKIN("Pumpkin", Material.CARVED_PUMPKIN, 5_000),
        MELON("Melon", Material.MELON, 8_000),
        CAKE("Cake", Material.CAKE, 12_000),
        TNT("TNT", Material.TNT, 20_000),
        DIAMOND("Diamond", Material.DIAMOND_BLOCK, 60_000),
        EMERALD("Emerald", Material.EMERALD_BLOCK, 80_000),
        BEACON("Beacon", Material.BEACON, 200_000),
        DRAGON_EGG("Dragon Egg", Material.DRAGON_EGG, 500_000);

        public final String label;
        public final Material icon;
        public final int price;

        Hat(String label, Material icon, int price) {
            this.label = label;
            this.icon = icon;
            this.price = price;
        }

        /**
         * What the resource pack would call this hat's own model.
         *
         * A hat has always been a real block worn on the head - a diamond
         * block is a diamond block, and everybody wearing one looks like they
         * are balancing masonry. Naming a model here means a pack can replace
         * that with an actual hat, and a player without the pack still sees
         * the block, because an item_model nothing defines falls back to the
         * item itself rather than breaking.
         */
        public String model() {
            return "hat_" + name().toLowerCase(java.util.Locale.ROOT);
        }
    }

    private final Nexus nexus;

    /**
     * What marks an item as a cosmetic rather than a block.
     *
     * Needed because the hats are made of DIAMOND_BLOCK, EMERALD_BLOCK, BEACON
     * and DRAGON_EGG, so "is it a hat" cannot be answered by looking at the
     * material without also answering yes for somebody's actual diamond block.
     */
    private final org.bukkit.NamespacedKey marker;

    /** Ticks, so trails are drawn a few times a second rather than twenty. */
    private int ticks;

    public Cosmetics(Nexus nexus) {
        this.nexus = nexus;
        this.marker = new org.bukkit.NamespacedKey(nexus, "cosmetic_hat");
    }

    /* --------------------------------------------------------------- owning */

    private static String key(String kind, String name) {
        return kind + ":" + name;
    }

    public boolean owns(Player player, String kind, String name) {
        return nexus.stats().of(player.getUniqueId()).cosmetics.contains(key(kind, name));
    }

    public void grant(Player player, String kind, String name) {
        nexus.stats().of(player.getUniqueId()).cosmetics.add(key(kind, name));
    }

    /* ---------------------------------------------------------------- menu */

    public void open(Player player) {
        Inventory menu = Bukkit.createInventory(null, 36, TITLE);

        Stats.Record record = nexus.stats().of(player.getUniqueId());
        double money = record.money;

        for (int i = 0; i < Trail.values().length; i++) {
            Trail trail = Trail.values()[i];
            menu.setItem(i, tag(trail.icon, trail.label, trail.price,
                    trail.price == 0 || owns(player, "trail", trail.name()),
                    record.trail.equals(trail.name()), money, "Trail"));
        }

        for (int i = 0; i < Hat.values().length; i++) {
            Hat hat = Hat.values()[i];
            menu.setItem(18 + i, tag(hat.icon, hat.label, hat.price,
                    hat.price == 0 || owns(player, "hat", hat.name()),
                    record.hat.equals(hat.name()), money, "Hat"));
        }

        player.openInventory(menu);
    }

    private ItemStack tag(Material icon, String label, int price, boolean owned,
                          boolean worn, double money, String kind) {

        ItemStack item = new ItemStack(icon);
        item.editMeta(meta -> {
            meta.displayName(Text.item(label,
                    worn ? NamedTextColor.YELLOW
                            : owned ? NamedTextColor.GREEN
                            : money >= price ? NamedTextColor.WHITE : NamedTextColor.RED));

            List<Component> lore = new ArrayList<>();
            lore.add(Text.item(kind, NamedTextColor.DARK_GRAY));
            lore.add(Component.empty());

            if (worn) lore.add(Text.item("Wearing this. Click to take it off.", NamedTextColor.GRAY));
            else if (owned) lore.add(Text.item("Click to wear", NamedTextColor.YELLOW));
            else {
                lore.add(Text.item(Stats.cash(price), NamedTextColor.GOLD));
                lore.add(Text.item(money >= price ? "Click to buy" : "You cannot afford this",
                        money >= price ? NamedTextColor.YELLOW : NamedTextColor.DARK_GRAY));
            }
            meta.lore(lore);
        });
        return item;
    }

    public void clicked(Player player, int slot) {
        if (slot >= 0 && slot < Trail.values().length) {
            pick(player, "trail", Trail.values()[slot].name(),
                    Trail.values()[slot].label, Trail.values()[slot].price);
            return;
        }

        int hatSlot = slot - 18;
        if (hatSlot >= 0 && hatSlot < Hat.values().length) {
            pick(player, "hat", Hat.values()[hatSlot].name(),
                    Hat.values()[hatSlot].label, Hat.values()[hatSlot].price);
        }
    }

    private void pick(Player player, String kind, String name, String label, int price) {
        Stats.Record record = nexus.stats().of(player.getUniqueId());
        boolean owned = price == 0 || owns(player, kind, name);

        if (!owned) {
            if (!nexus.stats().charge(player.getUniqueId(), price)) {
                player.sendMessage(Text.bad(label + " costs " + Stats.cash(price) + "."));
                player.playSound(player, Sound.ENTITY_VILLAGER_NO, 1f, 1f);
                return;
            }
            grant(player, kind, name);
            player.sendMessage(Text.good("Bought " + label + "."));
        }

        // Clicking what you are already wearing takes it off, which is the only
        // way to get back to nothing without a separate button for it.
        boolean wearing = kind.equals("trail")
                ? record.trail.equals(name) : record.hat.equals(name);
        String now = wearing ? "NONE" : name;

        if (kind.equals("trail")) record.trail = now;
        else record.hat = now;

        if (kind.equals("hat")) applyHat(player);

        player.playSound(player, Sound.UI_BUTTON_CLICK, 0.6f, 1.4f);
        open(player);
    }

    /* --------------------------------------------------------------- wearing */

    /**
     * Puts the hat on, and gives back whatever was in the helmet slot.
     *
     * Losing a diamond helmet to a pumpkin would be a very fast way to make
     * this feature hated.
     */
    public void applyHat(Player player) {
        Stats.Record record = nexus.stats().of(player.getUniqueId());

        /*
         * Any stamped hat loose in the inventory, taken back.
         *
         * This is what closes the duplication: a hat dragged out of the helmet
         * slot used to become an ordinary diamond block, and the next join
         * minted a replacement. It is still stamped, so it can be found and
         * removed - and since it was never a real item, removing it takes
         * nothing away from anybody.
         */
        scrubLooseHats(player);

        ItemStack worn = player.getInventory().getHelmet();
        boolean ourHat = ours(worn);

        if (record.hat.equals("NONE")) {
            if (ourHat) player.getInventory().setHelmet(null);
            return;
        }

        try {
            Hat hat = Hat.valueOf(record.hat);

            /*
             * Something of theirs on their head is given back, not replaced.
             *
             * Recognised by the stamp rather than by material, which is the
             * other half of the fix: a real carved pumpkin is the same material
             * as the pumpkin hat, and the old check deleted it.
             */
            if (worn != null && !ourHat) {
                for (ItemStack spare : player.getInventory().addItem(worn).values()) {
                    nexus.vault().store(player.getUniqueId(), spare);
                }
            }
            player.getInventory().setHelmet(mint(hat));
        } catch (IllegalArgumentException unknown) {
            record.hat = "NONE";
        }
    }

    /** A hat, stamped so it can never be confused with a real block. */
    private ItemStack mint(Hat hat) {
        ItemStack item = new ItemStack(hat.icon);

        item.editMeta(meta -> {
            meta.displayName(Component.text(hat.label, NamedTextColor.AQUA)
                    .decoration(net.kyori.adventure.text.format.TextDecoration.ITALIC,
                            false));
            meta.lore(List.of(Text.item("A hat. It is not worth anything",
                    NamedTextColor.DARK_GRAY)));

            meta.getPersistentDataContainer().set(marker,
                    org.bukkit.persistence.PersistentDataType.BYTE, (byte) 1);
        });

        // Its own look, if a pack has been made for them.
        model(item, hat);
        return item;
    }

    /** Whether this is one of ours, by the stamp rather than by type. */
    /**
     * Whether hats should carry a model at all.
     *
     * Off unless somebody has actually made the textures, because pointing at
     * a model that does not exist is only harmless in vanilla - a badly built
     * pack that defines some and not others shows the missing texture for the
     * rest, which looks far worse than a diamond block.
     */
    private boolean packed() {
        return nexus.getConfig().getBoolean("cosmetics.customModels", false);
    }

    /** The namespace the launcher's pack generator writes under. */
    private static final String PACK_NAMESPACE = "nexus";

    /**
     * Points a hat at its model, when there is a pack to hold one.
     *
     * Applied wherever a hat item is built, so the menu icon and the thing on
     * somebody's head agree - a preview that does not match what you get is
     * worse than no preview.
     */
    private void model(ItemStack item, Hat hat) {
        if (!packed() || hat == Hat.NONE) return;

        item.editMeta(meta -> meta.setItemModel(
                new org.bukkit.NamespacedKey(PACK_NAMESPACE, hat.model())));
    }

    public boolean ours(ItemStack item) {
        if (item == null || !item.hasItemMeta()) return false;

        return item.getItemMeta().getPersistentDataContainer().has(marker,
                org.bukkit.persistence.PersistentDataType.BYTE);
    }

    /** Removes stamped hats from everywhere except the head. */
    private void scrubLooseHats(Player player) {
        ItemStack[] contents = player.getInventory().getStorageContents();
        boolean changed = false;

        for (int i = 0; i < contents.length; i++) {
            if (!ours(contents[i])) continue;
            contents[i] = null;
            changed = true;
        }

        if (changed) player.getInventory().setStorageContents(contents);

        if (ours(player.getInventory().getItemInOffHand())) {
            player.getInventory().setItemInOffHand(null);
        }
    }

    /**
     * Draws everybody's trail.
     *
     * Every fourth tick, and only for players who have actually moved. A trail
     * on somebody standing still is a puddle, and drawing one for every player
     * every tick is the sort of thing that is free with three people on and a
     * problem with forty.
     */
    public void tick() {
        if (++ticks % 4 != 0) return;

        for (Player player : nexus.getServer().getOnlinePlayers()) {
            /*
             * Not in a match, and not while spectating.
             *
             * A trail in a match is a decoration that tells everybody where
             * you are, which in Skywars is not a decoration; a trail following
             * a spectator draws particles nobody can account for, coming from
             * somebody nobody can see. Pets already skip matches for the first
             * of those reasons.
             */
            if (nexus.games().matchOf(player.getUniqueId()) != null) continue;
            if (player.getGameMode() == org.bukkit.GameMode.SPECTATOR) continue;

            Stats.Record record = nexus.stats().of(player.getUniqueId());
            if (record.trail.equals("NONE")) continue;

            if (player.getVelocity().lengthSquared() < 0.005) continue;

            try {
                Trail trail = Trail.valueOf(record.trail);
                player.getWorld().spawnParticle(trail.particle,
                        player.getLocation().add(0, 0.2, 0), 6, 0.2, 0.1, 0.2, 0.01);
            } catch (IllegalArgumentException unknown) {
                record.trail = "NONE";
            }
        }
    }

    /** For the operator command, which takes a friendly name. */
    public static String normalise(String name) {
        return name.toUpperCase(Locale.ROOT).replace(' ', '_');
    }
}
