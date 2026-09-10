package dev.nexuscraft.nexus;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextDecoration;
import net.kyori.adventure.title.Title;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.Particle;
import org.bukkit.Sound;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.bukkit.persistence.PersistentDataType;

import java.time.Duration;
import java.util.List;
import java.util.Random;

/**
 * Keys, crates, and the thing everybody actually logs in for.
 *
 * A crate is a slot machine you are given tokens for, and it works on people
 * far better than the items inside it have any right to. The reason is the
 * moment before the reveal: a chest that opens instantly is a transaction, and
 * one that takes three seconds and makes a noise is an event. Everything below
 * about timing and sound is there for that and nothing else.
 *
 * Three tiers so a key is worth reading the name of. Common ones fall out of
 * playing at all; rare ones come from daily streaks and quests; legendary ones
 * are rare enough that somebody getting one should be worth announcing.
 */
public final class Crates {

    /** What tells a key from an ordinary tripwire hook. */
    private static final String KEY_TAG = "nexus_key";

    public enum Tier {
        COMMON("Common Key", NamedTextColor.GREEN, Material.TRIPWIRE_HOOK),
        RARE("Rare Key", NamedTextColor.AQUA, Material.TRIPWIRE_HOOK),
        LEGENDARY("Legendary Key", NamedTextColor.GOLD, Material.TRIPWIRE_HOOK);

        public final String label;
        public final NamedTextColor colour;
        public final Material item;

        Tier(String label, NamedTextColor colour, Material item) {
            this.label = label;
            this.colour = colour;
            this.item = item;
        }
    }

    /** One possible prize: what, how many, and how likely relative to the rest. */
    private record Prize(Material what, int least, int most, int weight, boolean announce) {
    }

    /**
     * The loot tables.
     *
     * Weighted rather than percentage-based so adding a prize does not mean
     * rebalancing every other number. The junk at the top of each list is not
     * padding — a crate where everything is good has no good outcomes, because
     * nothing in it is better than anything else.
     */
    private static final List<Prize> COMMON = List.of(
            new Prize(Material.IRON_INGOT, 4, 12, 30, false),
            new Prize(Material.GOLD_INGOT, 3, 8, 22, false),
            new Prize(Material.COAL, 8, 24, 25, false),
            new Prize(Material.EXPERIENCE_BOTTLE, 4, 10, 18, false),
            new Prize(Material.COOKED_BEEF, 8, 16, 20, false),
            new Prize(Material.DIAMOND, 1, 3, 10, false),
            new Prize(Material.EMERALD, 1, 3, 8, false),
            new Prize(Material.GOLDEN_APPLE, 1, 2, 5, false)
    );

    private static final List<Prize> RARE = List.of(
            new Prize(Material.DIAMOND, 3, 9, 28, false),
            new Prize(Material.EMERALD, 4, 10, 24, false),
            new Prize(Material.GOLDEN_APPLE, 2, 5, 18, false),
            new Prize(Material.EXPERIENCE_BOTTLE, 16, 32, 16, false),
            new Prize(Material.OBSIDIAN, 8, 16, 14, false),
            new Prize(Material.DIAMOND_PICKAXE, 1, 1, 8, false),
            new Prize(Material.DIAMOND_CHESTPLATE, 1, 1, 6, false),
            new Prize(Material.NETHERITE_SCRAP, 1, 2, 4, true),
            new Prize(Material.ENCHANTED_GOLDEN_APPLE, 1, 1, 3, true)
    );

    private static final List<Prize> LEGENDARY = List.of(
            new Prize(Material.DIAMOND_BLOCK, 2, 6, 24, false),
            new Prize(Material.EMERALD_BLOCK, 2, 5, 20, false),
            new Prize(Material.NETHERITE_INGOT, 1, 2, 16, true),
            new Prize(Material.ENCHANTED_GOLDEN_APPLE, 2, 4, 14, true),
            new Prize(Material.SHULKER_BOX, 1, 1, 10, true),
            new Prize(Material.TOTEM_OF_UNDYING, 1, 1, 8, true),
            new Prize(Material.ELYTRA, 1, 1, 4, true),
            new Prize(Material.BEACON, 1, 1, 3, true),
            new Prize(Material.NETHER_STAR, 1, 1, 1, true)
    );

    private final Nexus nexus;
    private final Random random = new Random();
    private final NamespacedKey marker;

    public Crates(Nexus nexus) {
        this.nexus = nexus;
        this.marker = new NamespacedKey(nexus, KEY_TAG);
    }

    /* ---------------------------------------------------------------- keys */

    public ItemStack key(Tier tier, int many) {
        ItemStack key = new ItemStack(tier.item, many);

        key.editMeta(meta -> {
            meta.displayName(Component.text(tier.label, tier.colour, TextDecoration.BOLD)
                    .decoration(TextDecoration.ITALIC, false));
            meta.lore(List.of(
                    Text.item("Right click the " + tier.label.split(" ")[0].toLowerCase()
                            + " crate in spawn", NamedTextColor.GRAY),
                    Component.empty(),
                    Text.item("Nexus", NamedTextColor.DARK_GRAY)));
            meta.addEnchant(org.bukkit.enchantments.Enchantment.UNBREAKING, 1, true);
            meta.addItemFlags(org.bukkit.inventory.ItemFlag.HIDE_ENCHANTS);

            // Stamped rather than identified by its name, so renaming one in an
            // anvil does not turn a common key into a legendary one.
            meta.getPersistentDataContainer().set(marker, PersistentDataType.STRING, tier.name());
        });

        return key;
    }

    /** Which tier this item is a key for, or null. */
    public Tier tierOf(ItemStack item) {
        if (item == null || item.getType() != Material.TRIPWIRE_HOOK) return null;
        if (!item.hasItemMeta()) return null;

        String stamped = item.getItemMeta().getPersistentDataContainer()
                .get(marker, PersistentDataType.STRING);
        if (stamped == null) return null;

        try {
            return Tier.valueOf(stamped);
        } catch (IllegalArgumentException unknown) {
            return null;
        }
    }

    public void give(Player player, Tier tier, int many) {
        // Through the vault, so a full inventory never costs somebody a key.
        nexus.vault().give(player, key(tier, many));

        player.sendMessage(Text.says("You got " + many + "x ")
                .append(Component.text(tier.label, tier.colour)));
        player.playSound(player, Sound.ENTITY_ITEM_PICKUP, 1f, 1.6f);
    }

    /* ------------------------------------------------------------- opening */

    /**
     * Uses one key of that tier, if they have one.
     *
     * The key is taken before the prize is decided. Doing it the other way
     * round means an inventory that is full at the wrong moment can eat the
     * prize and keep the key, or worse, give the prize and keep the key.
     */
    public boolean open(Player player, Tier tier) {
        if (!takeKey(player, tier)) {
            player.sendMessage(Text.bad("You have no " + tier.label + "."));
            player.playSound(player, Sound.ENTITY_VILLAGER_NO, 1f, 1f);
            return false;
        }

        Prize won = roll(switch (tier) {
            case COMMON -> COMMON;
            case RARE -> RARE;
            case LEGENDARY -> LEGENDARY;
        });

        int many = won.least() + random.nextInt(won.most() - won.least() + 1);
        ItemStack prize = new ItemStack(won.what(), many);

        nexus.vault().give(player, prize);

        reveal(player, tier, won, many);

        /*
         * Legendary keys, sometimes, carry a set as well as the prize.
         *
         * Added alongside the roll rather than inside it so the reveal keeps
         * working exactly as it did - the prize table is a table of materials
         * and a set of armour is not a material. One in eight by default, and
         * nothing at all when the pack defines no sets.
         */
        if (tier == Tier.LEGENDARY) {
            double chance = nexus.getConfig().getDouble("armouryDrops.legendaryChance", 0.125);
            String set = nexus.armoury().dropSet("crate");

            if (set != null && chance > 0 && random.nextDouble() < chance
                    && nexus.armoury().give(player, set)) {
                nexus.feed().say(Feed.Weight.BIG, player.getName() + " pulled the "
                        + nexus.armoury().get(set).label() + " set out of a legendary crate.");
            }
        }

        return true;
    }

    private boolean takeKey(Player player, Tier tier) {
        ItemStack[] contents = player.getInventory().getContents();

        for (int i = 0; i < contents.length; i++) {
            if (tierOf(contents[i]) != tier) continue;

            ItemStack stack = contents[i];
            stack.setAmount(stack.getAmount() - 1);
            if (stack.getAmount() <= 0) player.getInventory().setItem(i, null);

            player.updateInventory();
            return true;
        }
        return false;
    }

    private Prize roll(List<Prize> table) {
        int total = table.stream().mapToInt(Prize::weight).sum();
        int pick = random.nextInt(total);

        for (Prize prize : table) {
            pick -= prize.weight();
            if (pick < 0) return prize;
        }
        return table.get(0);
    }

    /**
     * The bit that makes it feel like anything.
     *
     * Particles, a sound that rises, and the prize as a title rather than a
     * chat line. The same item handed over silently is worth exactly as much
     * and lands like nothing at all.
     */
    private void reveal(Player player, Tier tier, Prize won, int many) {
        String name = won.what().name().toLowerCase().replace('_', ' ');

        player.getWorld().spawnParticle(Particle.TOTEM_OF_UNDYING,
                player.getLocation().add(0, 1.2, 0), 60, 0.6, 0.8, 0.6, 0.2);
        player.playSound(player, Sound.BLOCK_ENDER_CHEST_OPEN, 1f, 1.2f);
        player.playSound(player, tier == Tier.LEGENDARY
                ? Sound.UI_TOAST_CHALLENGE_COMPLETE : Sound.ENTITY_PLAYER_LEVELUP, 1f, 1.3f);

        player.showTitle(Title.title(
                Component.text(tier.label, tier.colour, TextDecoration.BOLD),
                Component.text(many + "x " + name, NamedTextColor.WHITE),
                Title.Times.times(Duration.ofMillis(200), Duration.ofSeconds(2), Duration.ofMillis(600))));

        player.sendMessage(Text.says("").append(Component.text(many + "x " + name, tier.colour)));

        // Only the things worth interrupting everybody for.
        if (won.announce()) {
            nexus.getServer().broadcast(Component.text(player.getName(), NamedTextColor.WHITE)
                    .append(Component.text(" pulled ", NamedTextColor.GRAY))
                    .append(Component.text(many + "x " + name, tier.colour))
                    .append(Component.text(" from a " + tier.label, NamedTextColor.GRAY)));
        }
    }
}
