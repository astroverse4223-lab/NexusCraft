package dev.nexuscraft.nexus;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.Sound;
import org.bukkit.entity.EntityType;
import org.bukkit.entity.Player;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Getting paid for what you were doing anyway.
 *
 * The strongest engagement system a server of this kind can have, and the
 * reason is that it costs the player nothing to opt in. Quests ask you to go
 * and do something; a job pays you for mining the ore you were already mining.
 * That difference is why people who ignore every other system will still pick
 * a job in their first ten minutes.
 *
 * Payments are deliberately small. A job is a trickle that makes an evening
 * feel like it added up, not a way to get rich — the moment a job out-earns
 * actually playing, everybody does the most repetitive thing that pays and
 * stops doing anything else.
 *
 * One job at a time, freely switchable. Letting people hold all five means
 * nobody ever chooses, and the choice is the only interesting part.
 */
public final class Jobs {

    /** How much experience each level costs, multiplied by the level. */
    private static final int PER_LEVEL = 120;

    /** Pay rises 8% a level, so level 20 is roughly four times level one. */
    private static final double PER_LEVEL_BONUS = 0.08;

    public enum Job {
        NONE("None", Material.BARRIER, "no job"),
        MINER("Miner", Material.IRON_PICKAXE, "paid for ore and stone"),
        LUMBERJACK("Lumberjack", Material.IRON_AXE, "paid for logs"),
        FARMER("Farmer", Material.IRON_HOE, "paid for crops"),
        FISHER("Fisher", Material.FISHING_ROD, "paid for what you catch"),
        HUNTER("Hunter", Material.IRON_SWORD, "paid for kills");

        public final String label;
        public final Material icon;
        public final String blurb;

        Job(String label, Material icon, String blurb) {
            this.label = label;
            this.icon = icon;
            this.blurb = blurb;
        }
    }

    /**
     * What each job is paid for.
     *
     * Ore is worth more than stone by a lot, because the alternative is that
     * the best mining job is digging a straight line through cobblestone, which
     * is both boring and exactly what somebody will do if it pays.
     */
    private static final Map<Material, Double> MINING = Map.ofEntries(
            Map.entry(Material.STONE, 0.35),
            Map.entry(Material.DEEPSLATE, 0.45),
            Map.entry(Material.COBBLESTONE, 0.15),
            Map.entry(Material.COAL_ORE, 2.5),
            Map.entry(Material.DEEPSLATE_COAL_ORE, 2.8),
            Map.entry(Material.COPPER_ORE, 3.0),
            Map.entry(Material.IRON_ORE, 4.5),
            Map.entry(Material.DEEPSLATE_IRON_ORE, 5.0),
            Map.entry(Material.GOLD_ORE, 7.0),
            Map.entry(Material.DEEPSLATE_GOLD_ORE, 7.5),
            Map.entry(Material.REDSTONE_ORE, 5.0),
            Map.entry(Material.LAPIS_ORE, 6.0),
            Map.entry(Material.DIAMOND_ORE, 22.0),
            Map.entry(Material.DEEPSLATE_DIAMOND_ORE, 24.0),
            Map.entry(Material.EMERALD_ORE, 30.0),
            Map.entry(Material.NETHER_QUARTZ_ORE, 3.5),
            Map.entry(Material.NETHER_GOLD_ORE, 4.0),
            Map.entry(Material.ANCIENT_DEBRIS, 90.0)
    );

    private static final Map<Material, Double> LOGS = Map.of(
            Material.OAK_LOG, 1.6,
            Material.SPRUCE_LOG, 1.6,
            Material.BIRCH_LOG, 1.6,
            Material.JUNGLE_LOG, 1.8,
            Material.ACACIA_LOG, 1.8,
            Material.DARK_OAK_LOG, 2.0,
            Material.MANGROVE_LOG, 2.0,
            Material.CHERRY_LOG, 2.2,
            Material.CRIMSON_STEM, 2.5,
            Material.WARPED_STEM, 2.5
    );

    private static final Map<Material, Double> CROPS = Map.of(
            Material.WHEAT, 1.2,
            Material.CARROTS, 1.2,
            Material.POTATOES, 1.2,
            Material.BEETROOTS, 1.4,
            Material.NETHER_WART, 2.0,
            Material.MELON, 1.0,
            Material.PUMPKIN, 1.4,
            Material.SUGAR_CANE, 0.8,
            Material.COCOA, 1.6,
            Material.SWEET_BERRY_BUSH, 1.0
    );

    private static final Map<EntityType, Double> KILLS = Map.ofEntries(
            Map.entry(EntityType.ZOMBIE, 3.0),
            Map.entry(EntityType.SKELETON, 3.5),
            Map.entry(EntityType.SPIDER, 3.0),
            Map.entry(EntityType.CREEPER, 5.0),
            Map.entry(EntityType.ENDERMAN, 9.0),
            Map.entry(EntityType.WITCH, 10.0),
            Map.entry(EntityType.BLAZE, 8.0),
            Map.entry(EntityType.PIGLIN, 5.0),
            Map.entry(EntityType.HOGLIN, 7.0),
            Map.entry(EntityType.DROWNED, 3.5),
            Map.entry(EntityType.PHANTOM, 8.0),
            Map.entry(EntityType.SHULKER, 20.0),
            Map.entry(EntityType.WITHER_SKELETON, 15.0),
            Map.entry(EntityType.ENDER_DRAGON, 500.0),
            Map.entry(EntityType.WITHER, 400.0)
    );

    public static final Component TITLE =
            Component.text("Jobs", NamedTextColor.DARK_GRAY);

    private final Nexus nexus;

    public Jobs(Nexus nexus) {
        this.nexus = nexus;
    }

    /* ---------------------------------------------------------------- menu */

    public void open(Player player) {
        Stats.Record record = nexus.stats().of(player.getUniqueId());
        Inventory menu = Bukkit.createInventory(null, 27, TITLE);

        Job[] all = Job.values();
        for (int i = 1; i < all.length; i++) {
            Job job = all[i];
            boolean mine = record.job.equals(job.name());

            ItemStack item = new ItemStack(job.icon);
            item.editMeta(meta -> {
                meta.displayName(Text.item(job.label,
                        mine ? NamedTextColor.YELLOW : NamedTextColor.GREEN));

                List<Component> lore = new ArrayList<>();
                lore.add(Text.item(job.blurb, NamedTextColor.GRAY));
                lore.add(Component.empty());

                if (mine) {
                    lore.add(Text.item("Level " + record.jobLevel, NamedTextColor.GOLD));
                    lore.add(Text.item(into(record) + "/" + needed(record.jobLevel)
                            + " to the next", NamedTextColor.DARK_GRAY));
                    lore.add(Text.item("+" + Math.round(bonus(record.jobLevel) * 100 - 100)
                            + "% pay", NamedTextColor.AQUA));
                    lore.add(Component.empty());
                    lore.add(Text.item("Click to quit", NamedTextColor.RED));
                } else {
                    lore.add(Text.item("Click to take this job", NamedTextColor.YELLOW));
                }
                meta.lore(lore);
            });

            menu.setItem(10 + i - 1, item);
        }

        player.openInventory(menu);
    }

    public void clicked(Player player, int slot) {
        int index = slot - 10 + 1;
        Job[] all = Job.values();
        if (index < 1 || index >= all.length) return;

        Stats.Record record = nexus.stats().of(player.getUniqueId());
        Job picked = all[index];

        if (record.job.equals(picked.name())) {
            record.job = "NONE";
            player.sendMessage(Text.says("You quit as a " + picked.label + "."));
        } else {
            /*
             * Changing job keeps the level.
             *
             * Losing it would make switching a punishment, which turns a choice
             * into a trap somebody made in their first ten minutes. Levels are
             * per job so the miner who tries farming for an evening still has
             * their mining level when they go back.
             */
            record.job = picked.name();
            record.jobLevel = record.jobLevels.getOrDefault(picked.name(), 1);
            record.jobExperience = record.jobExperiences.getOrDefault(picked.name(), 0);

            player.sendMessage(Text.good("You are now a " + picked.label
                    + " (level " + record.jobLevel + ")."));
        }

        player.playSound(player, Sound.UI_BUTTON_CLICK, 0.7f, 1.3f);
        open(player);
    }

    /* --------------------------------------------------------------- paying */

    public void mined(Player player, Material material) {
        pay(player, Job.MINER, MINING.getOrDefault(material, 0.0));
        pay(player, Job.LUMBERJACK, LOGS.getOrDefault(material, 0.0));
        pay(player, Job.FARMER, CROPS.getOrDefault(material, 0.0));
    }

    public void caught(Player player) {
        pay(player, Job.FISHER, 6.0);
    }

    public void killed(Player player, EntityType type) {
        pay(player, Job.HUNTER, KILLS.getOrDefault(type, 1.0));
    }

    /**
     * Pays for one action, if that is the job they hold.
     *
     * Silent. A message per block would be unreadable at any mining speed, so
     * the money simply appears and the level-up is the only thing that speaks.
     */
    private void pay(Player player, Job job, double base) {
        if (base <= 0) return;

        Stats.Record record = nexus.stats().of(player.getUniqueId());
        if (!record.job.equals(job.name())) return;

        // A machine breaking blocks is still a machine.
        if (nexus.afk().isAway(player.getUniqueId())) return;

        double paid = base * bonus(record.jobLevel);
        nexus.stats().pay(player.getUniqueId(), paid);
        record.jobEarned += paid;

        record.jobExperience++;
        record.jobExperiences.put(job.name(), record.jobExperience);

        if (record.jobExperience >= needed(record.jobLevel)) {
            record.jobExperience = 0;
            record.jobLevel++;
            record.jobLevels.put(job.name(), record.jobLevel);
            record.jobExperiences.put(job.name(), 0);

            levelUp(player, job, record.jobLevel);
        }
    }

    private void levelUp(Player player, Job job, int level) {
        double reward = level * 150.0;
        nexus.stats().pay(player.getUniqueId(), reward);

        player.sendMessage(Text.says(job.label + " level " + level + ".  ")
                .append(Component.text("+" + Stats.cash(reward), NamedTextColor.GREEN))
                .append(Component.text("   now +" + Math.round(bonus(level) * 100 - 100) + "% pay",
                        NamedTextColor.AQUA)));
        player.playSound(player, Sound.ENTITY_PLAYER_LEVELUP, 0.6f, 1.5f);

        // A key every tenth, so the grind has something on the horizon.
        if (level % 10 == 0) nexus.crates().give(player, Crates.Tier.RARE, 1);
    }

    private static int needed(int level) {
        return PER_LEVEL * level;
    }

    private static int into(Stats.Record record) {
        return record.jobExperience;
    }

    private static double bonus(int level) {
        return 1.0 + (level - 1) * PER_LEVEL_BONUS;
    }

    /** The summary, for somebody who types the command rather than clicking. */
    public void show(Player player) {
        Stats.Record record = nexus.stats().of(player.getUniqueId());

        if (record.job.equals("NONE")) {
            player.sendMessage(Text.says("You have no job. /jobs to pick one."));
            return;
        }

        Job job = Job.valueOf(record.job);

        player.sendMessage(Text.heading(job.label));
        player.sendMessage(Text.field("Level", String.valueOf(record.jobLevel)));
        player.sendMessage(Text.field("Progress",
                record.jobExperience + " / " + needed(record.jobLevel)));
        player.sendMessage(Text.field("Pay bonus",
                "+" + Math.round(bonus(record.jobLevel) * 100 - 100) + "%"));
        player.sendMessage(Text.field("Earned so far", Stats.cash(record.jobEarned)));
    }
}
