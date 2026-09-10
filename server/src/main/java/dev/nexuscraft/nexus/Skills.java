package dev.nexuscraft.nexus;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Material;
import org.bukkit.Sound;
import org.bukkit.block.Block;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.bukkit.potion.PotionEffect;
import org.bukkit.potion.PotionEffectType;

/**
 * Getting better at things by doing them.
 *
 * Jobs pays for the work; this is what the work makes of you. Without it a
 * player is exactly as good on their thirtieth day as their first, and the only
 * thing that grows is a number in a balance - which is a reason to log in for
 * about a week.
 *
 * Three skills, because three is what a person can hold in their head and still
 * feel the difference between them. Every level does something: no level is a
 * congratulation with nothing attached, because a level that only says well
 * done teaches people to stop reading.
 */
public final class Skills {

    public enum Skill {
        MINING("Mining", NamedTextColor.AQUA),
        COMBAT("Combat", NamedTextColor.RED),
        FARMING("Farming", NamedTextColor.GREEN);

        public final String label;
        public final NamedTextColor colour;

        Skill(String label, NamedTextColor colour) {
            this.label = label;
            this.colour = colour;
        }
    }

    public static final int MAX_LEVEL = 50;

    /**
     * The curve.
     *
     * Quadratic, so the first levels arrive quickly enough to show what levels
     * are for, and the last take a season. Level fifty is thirty thousand
     * points, which is a few thousand ores or a lot of skeletons.
     */
    private static final int PER_LEVEL = 12;

    public static int levelOf(int points) {
        return Math.min(MAX_LEVEL, (int) Math.sqrt((double) points / PER_LEVEL));
    }

    public static int pointsFor(int level) {
        return PER_LEVEL * level * level;
    }

    private final Nexus nexus;

    public Skills(Nexus nexus) {
        this.nexus = nexus;
    }

    /* ---------------------------------------------------------------- gains */

    private int pointsOf(Stats.Record record, Skill skill) {
        return switch (skill) {
            case MINING -> record.miningPoints;
            case COMBAT -> record.combatPoints;
            case FARMING -> record.farmingPoints;
        };
    }

    private void setPoints(Stats.Record record, Skill skill, int value) {
        switch (skill) {
            case MINING -> record.miningPoints = value;
            case COMBAT -> record.combatPoints = value;
            case FARMING -> record.farmingPoints = value;
        }
    }

    public int levelOf(Player player, Skill skill) {
        return levelOf(pointsOf(nexus.stats().of(player.getUniqueId()), skill));
    }

    /**
     * Adds progress, and says so if it was enough for a level.
     *
     * Announced with a title rather than a chat line, because a level arrives
     * in the middle of doing something else and a line of chat during mining is
     * a line nobody reads.
     */
    private void award(Player player, Skill skill, int points) {
        if (points <= 0) return;

        Stats.Record record = nexus.stats().of(player.getUniqueId());
        int was = levelOf(pointsOf(record, skill));

        setPoints(record, skill, pointsOf(record, skill) + points);

        int now = levelOf(pointsOf(record, skill));
        if (now <= was) return;

        player.showTitle(net.kyori.adventure.title.Title.title(
                Component.text(skill.label + " " + now, skill.colour),
                Component.text(perkLine(skill, now), NamedTextColor.GRAY),
                net.kyori.adventure.title.Title.Times.times(
                        java.time.Duration.ofMillis(200),
                        java.time.Duration.ofSeconds(2),
                        java.time.Duration.ofMillis(400))));

        player.playSound(player, Sound.ENTITY_PLAYER_LEVELUP, 0.6f, 1.4f);

        if (now == MAX_LEVEL) {
            nexus.getServer().broadcast(Component.text(player.getName(), NamedTextColor.WHITE)
                    .append(Component.text(" has mastered ", NamedTextColor.GRAY))
                    .append(Component.text(skill.label, skill.colour)));
        }
    }

    /* ----------------------------------------------------------------- perks */

    /** The chance of a second drop, as a fraction. */
    public double doubleChance(Player player, Skill skill) {
        int level = levelOf(player, skill);
        return switch (skill) {
            case MINING -> level * 0.005;   // 25% at fifty
            case FARMING -> level * 0.006;  // 30% at fifty
            case COMBAT -> 0;
        };
    }

    /** How much harder somebody hits, as a multiplier. */
    public double damageBonus(Player player) {
        return 1.0 + levelOf(player, Skill.COMBAT) * 0.004; // a fifth more at fifty
    }

    private String perkLine(Skill skill, int level) {
        return switch (skill) {
            case MINING -> level >= 20
                    ? Math.round(level * 0.5) + "% double ore, and Haste"
                    : Math.round(level * 0.5) + "% chance of double ore";
            case FARMING -> Math.round(level * 0.6) + "% chance of double crops";
            case COMBAT -> Math.round(level * 0.4) + "% more damage";
        };
    }

    /**
     * Keeps the mining perk applied.
     *
     * Haste is given as a long effect and renewed, rather than reapplied every
     * tick: a potion effect set every tick flickers the icon and cancels the
     * particles other effects are drawing.
     */
    public void tick() {
        for (Player player : nexus.getServer().getOnlinePlayers()) {
            Worlds.Place place = nexus.worlds().placeOf(player);
            if (place != Worlds.Place.SURVIVAL && place != Worlds.Place.PRISON) continue;

            if (levelOf(player, Skill.MINING) < 20) continue;

            PotionEffect existing = player.getPotionEffect(PotionEffectType.HASTE);
            if (existing != null && existing.getDuration() > 100) continue;

            player.addPotionEffect(new PotionEffect(
                    PotionEffectType.HASTE, 400, 0, true, false, false));
        }
    }

    /* ----------------------------------------------------------------- hooks */

    /**
     * Which skill a block belongs to, and what it is worth.
     *
     * Stone is worth one because it is everywhere; ore is worth more because
     * finding it took something. Crops are farming, everything else is mining -
     * and dirt is worth nothing, or a spade becomes the fastest way to level.
     */
    public void broke(Player player, Block block) {
        Worlds.Place place = nexus.worlds().placeOf(player);
        if (place != Worlds.Place.SURVIVAL && place != Worlds.Place.PRISON
                && place != Worlds.Place.SKYBLOCK && place != Worlds.Place.ONEBLOCK) {
            return;
        }

        Material type = block.getType();

        if (isCrop(type)) {
            award(player, Skill.FARMING, 3);
            rollDouble(player, Skill.FARMING, block);
            return;
        }

        int worth = worthOf(type);
        if (worth == 0) return;

        award(player, Skill.MINING, worth);

        // Only ore doubles. Doubling cobblestone is not a reward, it is a
        // second stack of cobblestone.
        if (worth >= 4) rollDouble(player, Skill.MINING, block);
    }

    public void killed(Player player, org.bukkit.entity.LivingEntity victim) {
        Worlds.Place place = nexus.worlds().placeOf(player);
        if (place == null) return;

        // Only things that fight back, or a chicken farm is a combat career.
        if (victim instanceof org.bukkit.entity.Monster) award(player, Skill.COMBAT, 5);
        else if (victim instanceof org.bukkit.entity.Player) award(player, Skill.COMBAT, 10);
    }

    private static boolean isCrop(Material type) {
        return switch (type) {
            case WHEAT, CARROTS, POTATOES, BEETROOTS, NETHER_WART,
                 MELON, PUMPKIN, SUGAR_CANE, COCOA, SWEET_BERRY_BUSH -> true;
            default -> false;
        };
    }

    private static int worthOf(Material type) {
        String name = type.name();

        if (name.endsWith("_ORE") || name.equals("ANCIENT_DEBRIS")) {
            return switch (type) {
                case DIAMOND_ORE, DEEPSLATE_DIAMOND_ORE, EMERALD_ORE,
                     DEEPSLATE_EMERALD_ORE, ANCIENT_DEBRIS -> 12;
                case GOLD_ORE, DEEPSLATE_GOLD_ORE, REDSTONE_ORE,
                     DEEPSLATE_REDSTONE_ORE, LAPIS_ORE, DEEPSLATE_LAPIS_ORE -> 6;
                default -> 4;
            };
        }

        return switch (type) {
            case STONE, DEEPSLATE, ANDESITE, DIORITE, GRANITE, TUFF, NETHERRACK,
                 COBBLESTONE, COBBLED_DEEPSLATE, BASALT, BLACKSTONE, END_STONE,
                 OBSIDIAN, SANDSTONE -> 1;
            default -> 0;
        };
    }

    /* ------------------------------------------------------------- the sheet */

    public void show(Player player) {
        Stats.Record record = nexus.stats().of(player.getUniqueId());

        player.sendMessage(Text.heading("Your skills"));

        for (Skill skill : Skill.values()) {
            int points = pointsOf(record, skill);
            int level = levelOf(points);

            String progress;
            if (level >= MAX_LEVEL) {
                progress = "mastered";
            } else {
                int into = points - pointsFor(level);
                int needs = pointsFor(level + 1) - pointsFor(level);
                progress = into + " / " + needs + " to " + (level + 1);
            }

            player.sendMessage(Component.text("  " + skill.label + " ", skill.colour)
                    .append(Component.text(level, NamedTextColor.WHITE))
                    .append(Component.text("  " + progress, NamedTextColor.DARK_GRAY)));
            player.sendMessage(Component.text("    " + perkLine(skill, level), NamedTextColor.GRAY));
        }
    }

    /**
     * Rolls the extra drop, if the skill has earned one.
     *
     * Dropped rather than handed over, so it behaves like the rest of what the
     * block gave up - it can be missed, picked up by somebody else, or fall in
     * the lava you were mining over.
     */
    private void rollDouble(Player player, Skill skill, Block block) {
        double chance = doubleChance(player, skill);
        if (chance <= 0 || Math.random() >= chance) return;

        ItemStack tool = player.getInventory().getItemInMainHand();

        for (ItemStack drop : block.getDrops(tool, player)) {
            if (drop == null || drop.getType() == Material.AIR) continue;
            block.getWorld().dropItemNaturally(block.getLocation().add(0.5, 0.5, 0.5), drop);
        }
    }
}
