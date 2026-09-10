package dev.nexuscraft.nexus;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextDecoration;
import org.bukkit.Material;
import org.bukkit.Sound;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.enchantments.Enchantment;
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
 * A box of things, now and then.
 *
 * The first ten minutes on a survival server are the ones that decide whether
 * somebody stays, and by default they are: punch a tree, make a crafting table,
 * punch more trees. A starter kit skips that and drops them straight into the
 * part they came for.
 *
 * After that they are a reason to come back tomorrow, and the reason ranks are
 * worth having. What a rank buys here is a shorter wait and slightly better
 * contents rather than anything that cannot be got by playing, which keeps it on
 * the right side of what a server is allowed to sell for real money.
 */
public final class Kits {

    public static final Component TITLE = Component.text("Kits");

    /**
     * One kit: what is in it, who may take it, and how often.
     *
     * `cost` is what it takes to buy, and zero means the rank alone is the
     * price. A bought kit still keeps its cooldown: money stops it being free
     * and the clock stops somebody with a fortune emptying the shop in an
     * afternoon.
     */
    private record Kit(String id, String name, Material icon,
                       Ranks needs, int hours, double cost, List<ItemStack> contents) {

        boolean bought() {
            return cost > 0;
        }
    }

    private static ItemStack one(Material material) {
        return new ItemStack(material);
    }

    private static ItemStack many(Material material, int amount) {
        return new ItemStack(material, amount);
    }

    /**
     * An item with the enchantments already on it.
     *
     * Given enchanted rather than as books, because the appeal of a kit you
     * paid for is opening it and being ready - handing somebody four books and
     * an anvil bill is a chore with a price tag.
     */
    private static ItemStack enchanted(Material material, Object... pairs) {
        ItemStack item = new ItemStack(material);

        for (int i = 0; i + 1 < pairs.length; i += 2) {
            item.addUnsafeEnchantment((Enchantment) pairs[i], (Integer) pairs[i + 1]);
        }
        return item;
    }

    /**
     * The kits, easiest first.
     *
     * Starter is once ever rather than on a cooldown, because it exists to get
     * somebody started and a player taking their eleventh starter kit is
     * farming, not starting.
     */
    private static final List<Kit> KITS = List.of(
            new Kit("starter", "Starter", Material.OAK_LOG, Ranks.PLAYER, -1, 0, List.of(
                    one(Material.STONE_SWORD), one(Material.STONE_PICKAXE),
                    one(Material.STONE_AXE), one(Material.STONE_SHOVEL),
                    many(Material.OAK_LOG, 32), many(Material.TORCH, 32),
                    many(Material.COOKED_BEEF, 16), one(Material.CRAFTING_TABLE),
                    one(Material.LEATHER_CHESTPLATE), one(Material.LEATHER_BOOTS))),

            new Kit("daily", "Daily", Material.BREAD, Ranks.PLAYER, 24, 0, List.of(
                    many(Material.COOKED_BEEF, 24), many(Material.TORCH, 32),
                    many(Material.IRON_INGOT, 6), many(Material.OAK_PLANKS, 32),
                    one(Material.IRON_PICKAXE))),

            new Kit("miner", "Miner", Material.IRON_PICKAXE, Ranks.PLAYER, 12, 0, List.of(
                    one(Material.IRON_PICKAXE), one(Material.IRON_SHOVEL),
                    many(Material.TORCH, 64), many(Material.LADDER, 32),
                    many(Material.COOKED_BEEF, 12))),

            new Kit("builder", "Builder", Material.BRICKS, Ranks.PLAYER, 12, 0, List.of(
                    many(Material.STONE_BRICKS, 64), many(Material.OAK_PLANKS, 64),
                    many(Material.GLASS, 32), many(Material.WHITE_CONCRETE, 32),
                    one(Material.IRON_AXE), many(Material.SCAFFOLDING, 32))),

            new Kit("vip", "VIP", Material.GOLD_INGOT, Ranks.VIP, 12, 0, List.of(
                    one(Material.IRON_SWORD), one(Material.DIAMOND_PICKAXE),
                    one(Material.IRON_CHESTPLATE), one(Material.IRON_LEGGINGS),
                    many(Material.GOLDEN_APPLE, 2), many(Material.COOKED_BEEF, 32),
                    many(Material.DIAMOND, 3))),

            new Kit("mvp", "MVP", Material.DIAMOND, Ranks.MVP, 8, 0, List.of(
                    one(Material.DIAMOND_SWORD), one(Material.DIAMOND_PICKAXE),
                    one(Material.DIAMOND_CHESTPLATE), one(Material.DIAMOND_LEGGINGS),
                    one(Material.DIAMOND_BOOTS), one(Material.DIAMOND_HELMET),
                    many(Material.GOLDEN_APPLE, 5), many(Material.ENDER_PEARL, 4),
                    many(Material.DIAMOND, 8))),

            /*
             * The bought ones.
             *
             * Priced against the island upgrades, which run from two and a half
             * thousand up to a hundred and sixty - so a kit is something you
             * save a session for rather than something you buy without
             * noticing. Each is for a job rather than being strictly better
             * than the last: the angler is no use in the nether and the nether
             * kit catches no fish. That way the money keeps having somewhere to
             * go once somebody owns the expensive one.
             */
            new Kit("forager", "Forager", Material.SHEARS, Ranks.PLAYER, 6, 2_500, List.of(
                    one(Material.SHEARS), one(Material.FISHING_ROD),
                    many(Material.BONE_MEAL, 32), many(Material.OAK_SAPLING, 8),
                    many(Material.WHEAT_SEEDS, 16), many(Material.COOKED_BEEF, 16),
                    one(Material.WATER_BUCKET))),

            new Kit("farmer", "Farmer", Material.WHEAT, Ranks.PLAYER, 12, 6_000, List.of(
                    enchanted(Material.IRON_HOE,
                            Enchantment.EFFICIENCY, 3, Enchantment.UNBREAKING, 3),
                    many(Material.WHEAT_SEEDS, 32), many(Material.CARROT, 16),
                    many(Material.POTATO, 16), many(Material.BEETROOT_SEEDS, 16),
                    many(Material.BONE_MEAL, 64), one(Material.WATER_BUCKET),
                    many(Material.COMPOSTER, 2))),

            new Kit("prospector", "Prospector", Material.GOLDEN_PICKAXE,
                    Ranks.PLAYER, 12, 9_000, List.of(
                    enchanted(Material.DIAMOND_PICKAXE,
                            Enchantment.EFFICIENCY, 4, Enchantment.UNBREAKING, 3,
                            Enchantment.FORTUNE, 2),
                    many(Material.TORCH, 64), many(Material.LADDER, 64),
                    many(Material.COOKED_BEEF, 24), one(Material.IRON_SHOVEL))),

            new Kit("angler", "Angler", Material.FISHING_ROD,
                    Ranks.PLAYER, 12, 12_000, List.of(
                    enchanted(Material.FISHING_ROD,
                            Enchantment.LUCK_OF_THE_SEA, 3, Enchantment.LURE, 3,
                            Enchantment.UNBREAKING, 3),
                    one(Material.OAK_BOAT), many(Material.COOKED_SALMON, 24),
                    enchanted(Material.LEATHER_BOOTS, Enchantment.DEPTH_STRIDER, 2))),

            new Kit("nether", "Nether", Material.FLINT_AND_STEEL,
                    Ranks.PLAYER, 24, 25_000, List.of(
                    many(Material.OBSIDIAN, 14), one(Material.FLINT_AND_STEEL),
                    enchanted(Material.GOLDEN_BOOTS,
                            Enchantment.FIRE_PROTECTION, 3, Enchantment.UNBREAKING, 3),
                    many(Material.GOLDEN_APPLE, 3), many(Material.COOKED_PORKCHOP, 32),
                    many(Material.COBBLESTONE, 64))),

            new Kit("knight", "Knight", Material.DIAMOND_CHESTPLATE,
                    Ranks.PLAYER, 24, 45_000, List.of(
                    enchanted(Material.DIAMOND_SWORD,
                            Enchantment.SHARPNESS, 4, Enchantment.UNBREAKING, 3),
                    enchanted(Material.DIAMOND_HELMET, Enchantment.PROTECTION, 3),
                    enchanted(Material.DIAMOND_CHESTPLATE, Enchantment.PROTECTION, 3),
                    enchanted(Material.DIAMOND_LEGGINGS, Enchantment.PROTECTION, 3),
                    enchanted(Material.DIAMOND_BOOTS,
                            Enchantment.PROTECTION, 3, Enchantment.FEATHER_FALLING, 3),
                    many(Material.GOLDEN_APPLE, 6))),

            new Kit("ender", "Ender", Material.ENDER_CHEST,
                    Ranks.PLAYER, 48, 80_000, List.of(
                    one(Material.ENDER_CHEST), many(Material.ENDER_PEARL, 16),
                    many(Material.ENDER_EYE, 12), many(Material.OBSIDIAN, 20),
                    many(Material.GOLDEN_APPLE, 4),
                    enchanted(Material.DIAMOND_PICKAXE,
                            Enchantment.EFFICIENCY, 5, Enchantment.UNBREAKING, 3))));

    private final Nexus nexus;
    private final File file;

    /** When each player last took each kit, in epoch seconds. */
    private final Map<UUID, Map<String, Integer>> taken = new HashMap<>();

    public Kits(Nexus nexus) {
        this.nexus = nexus;
        this.file = new File(nexus.getDataFolder(), "kits.yml");
        load();
    }

    private static Kit byId(String id) {
        for (Kit kit : KITS) if (kit.id().equals(id)) return kit;
        return null;
    }

    /* --------------------------------------------------------------- taking */

    public void open(Player player) {
        Inventory page = nexus.getServer().createInventory(null, 27, TITLE);
        Ranks rank = nexus.stats().rankOf(player.getUniqueId());

        int slot = 0;
        for (Kit kit : KITS) {
            boolean allowed = rank.ordinal() >= kit.needs().ordinal();
            int wait = secondsLeft(player.getUniqueId(), kit);
            boolean afford = !kit.bought()
                    || nexus.stats().moneyOf(player.getUniqueId()) >= kit.cost();

            ItemStack icon = new ItemStack(allowed ? kit.icon() : Material.GRAY_DYE);
            icon.editMeta(meta -> {
                meta.displayName(Component.text(kit.name(),
                                allowed ? NamedTextColor.GREEN : NamedTextColor.GRAY)
                        .decoration(TextDecoration.ITALIC, false));

                List<Component> lore = new ArrayList<>();
                for (ItemStack stack : kit.contents()) {
                    lore.add(Text.item(stack.getAmount() + "x "
                                    + stack.getType().name().toLowerCase().replace('_', ' '),
                            NamedTextColor.DARK_GRAY));
                }
                lore.add(Component.empty());

                if (kit.bought()) {
                    lore.add(Text.item(Stats.cash(kit.cost()),
                            afford ? NamedTextColor.GOLD : NamedTextColor.RED));
                }

                if (!allowed) {
                    lore.add(Text.item("Needs " + kit.needs().name(), NamedTextColor.RED));
                } else if (kit.bought() && !afford) {
                    lore.add(Text.item("You cannot afford it yet", NamedTextColor.RED));
                } else if (wait > 0) {
                    lore.add(Text.item("Ready in " + Text.roughly(wait), NamedTextColor.YELLOW));
                } else if (kit.hours() < 0) {
                    lore.add(Text.item("Once only. Click to take it", NamedTextColor.GREEN));
                } else {
                    lore.add(Text.item("Every " + kit.hours() + " hours",
                            NamedTextColor.DARK_GRAY));
                    lore.add(Text.item(kit.bought() ? "Click to buy it" : "Click to take it",
                            NamedTextColor.GREEN));
                }

                meta.lore(lore);
            });

            page.setItem(slot++, icon);
        }

        player.openInventory(page);
    }

    public void clicked(Player player, int slot) {
        if (slot < 0 || slot >= KITS.size()) return;
        give(player, KITS.get(slot));
    }

    public void give(Player player, String id) {
        Kit kit = byId(id);

        if (kit == null) {
            player.sendMessage(Text.bad("No kit called '" + id + "'."));
            player.sendMessage(Text.plain("  /kits to see them."));
            return;
        }
        give(player, kit);
    }

    private void give(Player player, Kit kit) {
        UUID who = player.getUniqueId();

        if (nexus.stats().rankOf(who).ordinal() < kit.needs().ordinal()) {
            player.sendMessage(Text.bad("That kit is for " + kit.needs().name() + "."));
            return;
        }

        int wait = secondsLeft(who, kit);
        if (wait > 0) {
            player.sendMessage(kit.hours() < 0
                    ? Text.bad("You have already had the starter kit.")
                    : Text.bad("That kit is ready again in " + Text.clock(wait) + "."));
            return;
        }

        /*
         * A bought kit is survival's, and only survival's.
         *
         * Not to keep it exclusive but because every world stashes your
         * inventory separately: a knight kit opened in the hub goes into the
         * hub's stash the moment you leave, and the money is gone with it. The
         * free kits are small enough that losing one is a shrug. This one is
         * eighty thousand.
         */
        if (kit.bought() && nexus.worlds().placeOf(player) != Worlds.Place.SURVIVAL) {
            player.sendMessage(Text.bad("Bought kits are for survival."));
            player.sendMessage(Text.plain("  Otherwise it stays behind when you leave."));
            return;
        }

        /*
         * Charged last, after everything that could still turn them away, and
         * before a single item is handed over - so there is no path through
         * here that takes the money without giving the kit, or the other way
         * about.
         */
        if (kit.bought() && !nexus.stats().charge(who, kit.cost())) {
            player.sendMessage(Text.bad(kit.name() + " costs " + Stats.cash(kit.cost())
                    + " and you have " + Stats.cash(nexus.stats().moneyOf(who)) + "."));
            return;
        }

        /*
         * Anything that will not fit goes to the vault rather than on the floor.
         *
         * Dropping the overflow is what most servers do and it is how people
         * lose a diamond chestplate to a hopper they did not know was there.
         * The vault already exists for exactly this.
         */
        int spilled = 0;
        for (ItemStack stack : kit.contents()) {
            var leftover = player.getInventory().addItem(stack.clone());

            for (ItemStack extra : leftover.values()) {
                nexus.vault().store(who, extra);
                spilled++;
            }
        }

        taken.computeIfAbsent(who, id -> new HashMap<>())
                .put(kit.id(), (int) (System.currentTimeMillis() / 1000));
        save();

        player.sendMessage(Text.good(kit.name() + " kit."
                + (kit.bought() ? " " + Stats.cash(kit.cost()) + "." : "")));
        player.playSound(player, Sound.ENTITY_ITEM_PICKUP, 0.9f, 1.2f);

        if (spilled > 0) {
            player.sendMessage(Text.plain("  " + spilled
                    + " would not fit. /vault to collect them."));
        }
    }

    /** How long until somebody may take this again. Zero means now. */
    private int secondsLeft(UUID who, Kit kit) {
        Map<String, Integer> theirs = taken.get(who);
        if (theirs == null) return 0;

        Integer when = theirs.get(kit.id());
        if (when == null) return 0;

        // A negative cooldown means once ever, so once taken it is never ready.
        if (kit.hours() < 0) return Integer.MAX_VALUE;

        int ready = when + kit.hours() * 3600;
        int now = (int) (System.currentTimeMillis() / 1000);

        return Math.max(0, ready - now);
    }

    public void list(Player player) {
        Ranks rank = nexus.stats().rankOf(player.getUniqueId());
        player.sendMessage(Text.heading("Kits"));

        for (Kit kit : KITS) {
            boolean allowed = rank.ordinal() >= kit.needs().ordinal();
            int wait = secondsLeft(player.getUniqueId(), kit);

            String state = !allowed ? "needs " + kit.needs().name()
                    : wait == Integer.MAX_VALUE ? "already taken"
                    : wait > 0 ? "in " + Text.roughly(wait)
                    : kit.bought() ? Stats.cash(kit.cost())
                    : "ready";

            player.sendMessage(Component.text("  /kit " + kit.id(),
                            allowed && wait == 0 ? NamedTextColor.GREEN : NamedTextColor.GRAY)
                    .append(Component.text("   " + state, NamedTextColor.DARK_GRAY)));
        }
    }

    public static List<String> ids() {
        List<String> out = new ArrayList<>();
        for (Kit kit : KITS) out.add(kit.id());
        return out;
    }

    /* -------------------------------------------------------------- on disk */

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

            var section = yaml.getConfigurationSection(key);
            if (section == null) continue;

            Map<String, Integer> theirs = new HashMap<>();
            for (String id : section.getKeys(false)) {
                theirs.put(id, yaml.getInt(key + "." + id));
            }
            taken.put(who, theirs);
        }
    }

    public void save() {
        YamlConfiguration yaml = new YamlConfiguration();

        for (Map.Entry<UUID, Map<String, Integer>> person : taken.entrySet()) {
            for (Map.Entry<String, Integer> entry : person.getValue().entrySet()) {
                yaml.set(person.getKey() + "." + entry.getKey(), entry.getValue());
            }
        }

        try {
            yaml.save(file);
        } catch (Exception e) {
            nexus.getLogger().warning("could not save kits: " + e);
        }
    }
}
