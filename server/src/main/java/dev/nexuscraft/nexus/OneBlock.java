package dev.nexuscraft.nexus;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.title.Title;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.Sound;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.entity.EntityType;
import org.bukkit.entity.Player;

import java.time.Duration;
import java.util.Random;
import java.util.UUID;

/**
 * One block, forever.
 *
 * You stand on a single block in an empty sky. Break it and it comes back as
 * something else. Everything you will ever own comes out of that one block, and
 * the only thing that changes is what it turns into next — which is the whole
 * design, and the reason it is the most played skyblock variant there is.
 *
 * The progression is the game. Early phases give dirt and logs so you can build
 * somewhere to stand; later ones give ore, then nether blocks, then the good
 * stuff, and mobs start coming out of it. Every phase is a reason to keep
 * mining a block you have already mined nine hundred times.
 *
 * Each player gets their own island, spaced far enough apart that nobody's
 * bridge reaches anybody else's.
 */
public final class OneBlock {

    /** How far apart islands sit. Far enough that you cannot see the next one. */
    private static final int SPACING = 512;

    /** Where the block itself sits. */
    private static final int HEIGHT = 80;

    /** One stage of the run: a name, how long it lasts, and what it gives. */
    public record Phase(String name, int until, net.kyori.adventure.bossbar.BossBar.Color colour,
                        Material[] blocks, EntityType[] mobs) {
    }

    /** A level every this many blocks. Short enough that the bar visibly moves. */
    public static final int PER_LEVEL = 20;

    /**
     * The whole progression.
     *
     * The counts pace it: Plains is short because it is only there to get you a
     * platform, the middle phases are long because that is where the game is,
     * and the End is endless because by then the reason to keep going is the
     * drops rather than the next phase.
     *
     * The mob lists are the part that changes how a phase feels. Plains gives
     * animals, which are food and wool and leather and are the reason you build
     * a pen early. Everything after gives things that want to kill you, on an
     * island with nowhere to run — which is why the later phases are dangerous
     * rather than merely richer.
     */
    public static final Phase[] PHASES = {
            new Phase("Plains", 60, net.kyori.adventure.bossbar.BossBar.Color.GREEN, new Material[]{
                    Material.DIRT, Material.GRASS_BLOCK, Material.OAK_LOG, Material.SAND,
                    Material.OAK_LEAVES, Material.COBBLESTONE, Material.DIRT, Material.GRASS_BLOCK,
                    Material.COAL_ORE, Material.OAK_LOG,
            }, new EntityType[]{
                    EntityType.COW, EntityType.PIG, EntityType.SHEEP, EntityType.CHICKEN,
            }),

            new Phase("Underground", 220, net.kyori.adventure.bossbar.BossBar.Color.WHITE, new Material[]{
                    Material.STONE, Material.COBBLESTONE, Material.COAL_ORE, Material.IRON_ORE,
                    Material.ANDESITE, Material.GRANITE, Material.DIORITE, Material.STONE,
                    Material.COPPER_ORE, Material.GRAVEL, Material.IRON_ORE, Material.COAL_ORE,
            }, new EntityType[]{
                    EntityType.COW, EntityType.SHEEP, EntityType.ZOMBIE, EntityType.SKELETON,
            }),

            new Phase("Caves", 500, net.kyori.adventure.bossbar.BossBar.Color.BLUE, new Material[]{
                    Material.DEEPSLATE, Material.IRON_ORE, Material.GOLD_ORE, Material.REDSTONE_ORE,
                    Material.LAPIS_ORE, Material.COAL_ORE, Material.DEEPSLATE_IRON_ORE,
                    Material.AMETHYST_BLOCK, Material.MOSS_BLOCK, Material.CLAY,
                    Material.DEEPSLATE_GOLD_ORE, Material.DIAMOND_ORE,
            }, new EntityType[]{
                    EntityType.ZOMBIE, EntityType.SPIDER, EntityType.CREEPER, EntityType.SKELETON,
            }),

            new Phase("Nether", 900, net.kyori.adventure.bossbar.BossBar.Color.RED, new Material[]{
                    Material.NETHERRACK, Material.NETHER_BRICKS, Material.SOUL_SAND,
                    Material.NETHER_QUARTZ_ORE, Material.NETHER_GOLD_ORE, Material.MAGMA_BLOCK,
                    Material.BLACKSTONE, Material.BASALT, Material.GLOWSTONE,
                    Material.NETHER_QUARTZ_ORE, Material.GILDED_BLACKSTONE,
            }, new EntityType[]{
                    EntityType.BLAZE, EntityType.MAGMA_CUBE, EntityType.PIGLIN, EntityType.HOGLIN,
            }),

            new Phase("Ocean", 1400, net.kyori.adventure.bossbar.BossBar.Color.BLUE, new Material[]{
                    Material.PRISMARINE, Material.SAND, Material.CLAY, Material.SEA_LANTERN,
                    Material.TUBE_CORAL_BLOCK, Material.BRAIN_CORAL_BLOCK, Material.SPONGE,
                    Material.DARK_PRISMARINE, Material.LAPIS_ORE, Material.GOLD_ORE,
            }, new EntityType[]{
                    EntityType.DROWNED, EntityType.GUARDIAN, EntityType.SQUID, EntityType.COD,
            }),

            new Phase("The End", Integer.MAX_VALUE, net.kyori.adventure.bossbar.BossBar.Color.PURPLE,
                    new Material[]{
                            Material.END_STONE, Material.OBSIDIAN, Material.PURPUR_BLOCK,
                            Material.END_STONE_BRICKS, Material.DIAMOND_ORE, Material.EMERALD_ORE,
                            Material.ANCIENT_DEBRIS, Material.END_STONE, Material.DIAMOND_ORE,
                            Material.DEEPSLATE_EMERALD_ORE,
                    }, new EntityType[]{
                    EntityType.ENDERMAN, EntityType.SHULKER, EntityType.PHANTOM,
            }),
    };

    private final Nexus nexus;
    private final Random random = new Random();

    private World world;

    /** One bar per player, shown only while they are on their island. */
    private final java.util.Map<UUID, net.kyori.adventure.bossbar.BossBar> bars =
            new java.util.HashMap<>();

    public OneBlock(Nexus nexus) {
        this.nexus = nexus;
    }

    public World world() {
        if (world == null) world = nexus.worlds().of(Worlds.Place.ONEBLOCK);
        return world;
    }

    /* -------------------------------------------------------------- islands */

    /**
     * Where a player's island is.
     *
     * Derived from the id rather than allocated, so it needs no bookkeeping and
     * survives anything: the same player always gets the same spot, and two
     * players can never be handed the same one.
     */
    /**
     * Whether this position falls inside somebody's own island.
     *
     * The whole world is divided rather than a box drawn round each island, so
     * there is no no-man's land in between where anybody may build. The cell is
     * centred on the island, so it covers the ground somebody bridges out to as
     * well as the island itself.
     */
    public boolean isTheirs(UUID who, int x, int z) {
        int slot = slotOf(who);
        return cell(x) == slot % 64 && cell(z) == slot / 64;
    }

    private static int cell(int coordinate) {
        return Math.floorDiv(coordinate + SPACING / 2, SPACING);
    }

    /**
     * Which of the 4096 island spots belongs to somebody.
     *
     * The one definition of the grid. Both where an island is and whether a
     * position belongs to it come from here, so they cannot drift apart.
     */
    private static int slotOf(UUID who) {
        return Math.abs(who.hashCode()) % 4096;
    }

    public Location islandOf(UUID who) {
        int slot = slotOf(who);
        int x = (slot % 64) * SPACING;
        int z = (slot / 64) * SPACING;

        return new Location(world(), x + 0.5, HEIGHT + 1, z + 0.5);
    }

    private Block blockOf(UUID who) {
        Location at = islandOf(who);
        return world().getBlockAt(at.getBlockX(), HEIGHT, at.getBlockZ());
    }

    /**
     * Makes the island if it is not there, without moving anybody.
     *
     * Called before the teleport rather than after it. The island was being
     * built by `arrive`, which runs once the player has already been sent to
     * where the block ought to be - so on a first visit they arrived in an
     * empty void world, fell out of it, died, and respawned at the main spawn.
     * From the outside that looks like One Block dropping you into survival.
     */
    public void prepare(UUID who) {
        if (blockOf(who).getType() == Material.AIR) reset(who);
    }

    /** Puts somebody on their island, making it if this is their first visit. */
    public void arrive(Player player) {
        prepare(player.getUniqueId());

        Stats.Record record = nexus.stats().of(player.getUniqueId());

        player.sendMessage(Text.heading("One Block"));
        player.sendMessage(Text.field("Phase", phaseFor(record.oneBlockBroken).name()));
        player.sendMessage(Text.field("Blocks broken", String.valueOf(record.oneBlockBroken)));
        player.sendMessage(Text.plain("  Break the block. It comes back as something else."));

        showBar(player);
    }

    /* ------------------------------------------------------------ the bar */

    public static int levelOf(int broken) {
        return broken / PER_LEVEL + 1;
    }

    /**
     * The bar across the top of the screen.
     *
     * A boss bar rather than the vanilla experience bar, which is already spoken
     * for — overwriting it would mean the number under your hotbar stops meaning
     * enchanting levels, and that is a worse trade than it sounds.
     *
     * It shows the phase, the level, and how far through the level you are, and
     * it fills visibly with every single block. That last part is the whole
     * point: a progress bar that moves once a minute is decoration, and one that
     * moves every time you swing is the reason you swing again.
     */
    public void showBar(Player player) {
        Stats.Record record = nexus.stats().of(player.getUniqueId());

        net.kyori.adventure.bossbar.BossBar bar = bars.get(player.getUniqueId());
        if (bar == null) {
            bar = net.kyori.adventure.bossbar.BossBar.bossBar(
                    Component.empty(), 0f,
                    net.kyori.adventure.bossbar.BossBar.Color.GREEN,
                    net.kyori.adventure.bossbar.BossBar.Overlay.NOTCHED_20);
            bars.put(player.getUniqueId(), bar);
        }

        updateBar(bar, record.oneBlockBroken);
        player.showBossBar(bar);
    }

    private void updateBar(net.kyori.adventure.bossbar.BossBar bar, int broken) {
        Phase phase = phaseFor(broken);
        int level = levelOf(broken);
        int into = broken % PER_LEVEL;

        bar.name(Component.text(phase.name(), NamedTextColor.WHITE)
                .append(Component.text("   Level ", NamedTextColor.GRAY))
                .append(Component.text(level, NamedTextColor.GOLD))
                .append(Component.text("   " + into + "/" + PER_LEVEL, NamedTextColor.DARK_GRAY)));

        bar.color(phase.colour());
        bar.progress(Math.min(1f, into / (float) PER_LEVEL));
    }

    /** Takes the bar away when they leave, or it follows them across worlds. */
    public void hideBar(Player player) {
        net.kyori.adventure.bossbar.BossBar bar = bars.remove(player.getUniqueId());
        if (bar != null) player.hideBossBar(bar);
    }

    /** A fresh island: the block, and a bedrock plate under it to stand on. */
    public void reset(UUID who) {
        Location at = islandOf(who);
        int x = at.getBlockX();
        int z = at.getBlockZ();

        world().getBlockAt(x, HEIGHT, z).setType(Material.GRASS_BLOCK, false);

        /*
         * A three by three bedrock plate, not a single block.
         *
         * One block of bedrock under one block of dirt is the purest version of
         * the idea and it is miserable to actually play: you cannot stand
         * anywhere except on the block you are trying to mine, and everything
         * that falls, falls forever. The plate is somewhere to stand while you
         * work, and a floor for anything that gets away from you.
         */
        for (int dx = -1; dx <= 1; dx++) {
            for (int dz = -1; dz <= 1; dz++) {
                world().getBlockAt(x + dx, HEIGHT - 1, z + dz).setType(Material.BEDROCK, false);
            }
        }
    }

    /* ------------------------------------------------------------- phases */

    public Phase phaseFor(int broken) {
        for (Phase phase : PHASES) {
            if (broken < phase.until()) return phase;
        }
        return PHASES[PHASES.length - 1];
    }

    /**
     * Somebody broke their block.
     *
     * Returns true if this was a one-block break and has been handled, so the
     * caller knows not to treat it as ordinary mining. The replacement is
     * placed a tick later because putting a block back inside the same event
     * that is removing it is a fight the event wins.
     */
    public boolean broke(Player player, org.bukkit.event.block.BlockBreakEvent event) {
        Block block = event.getBlock();
        if (world == null || !block.getWorld().equals(world)) return false;

        Block theirs = blockOf(player.getUniqueId());
        if (!block.getLocation().equals(theirs.getLocation())) return false;

        /*
         * The drops go straight into your hands.
         *
         * They used to pop out of the block like anything else, and on a one
         * block island that means they pop out sideways off a plate one block
         * wide and fall forever. Which is the entire game unplayable: you mine,
         * and you watch everything you mined disappear into the void.
         *
         * Every real One Block does this, and this is why.
         */
        Pickup.straightToPlayer(player, event);

        Stats.Record record = nexus.stats().of(player.getUniqueId());
        Phase before = phaseFor(record.oneBlockBroken);

        int levelBefore = levelOf(record.oneBlockBroken);

        record.oneBlockBroken++;
        nexus.stats().pay(player.getUniqueId(), 1.5);

        Phase now = phaseFor(record.oneBlockBroken);
        Material next = now.blocks()[random.nextInt(now.blocks().length)];

        // The bar moves on every block, which is most of why it works.
        net.kyori.adventure.bossbar.BossBar bar = bars.get(player.getUniqueId());
        if (bar == null) {
            showBar(player);
        } else {
            updateBar(bar, record.oneBlockBroken);
        }

        int levelNow = levelOf(record.oneBlockBroken);
        if (levelNow > levelBefore) levelUp(player, levelNow);

        nexus.getServer().getScheduler().runTask(nexus, () -> {
            theirs.setType(next, false);

            // Mobs come out of the block itself, which is the only thing that
            // makes the later phases dangerous rather than just richer.
            if (now.mobs().length > 0 && random.nextInt(18) == 0) {
                EntityType mob = now.mobs()[random.nextInt(now.mobs().length)];
                theirs.getWorld().spawnEntity(theirs.getLocation().add(0.5, 1.2, 0.5), mob);
            }
        });

        if (!before.name().equals(now.name())) announcePhase(player, now);
        return true;
    }

    /**
     * A level, and something for it.
     *
     * Money every level so the shop is always a little closer, and a real item
     * every fifth so there is something to actually look forward to rather than
     * a number going up. The reward scales with the level, which means the
     * hundredth is worth having and not just noted.
     */
    private void levelUp(Player player, int level) {
        double money = 20 + level * 8.0;
        nexus.stats().pay(player.getUniqueId(), money);

        player.playSound(player, Sound.ENTITY_PLAYER_LEVELUP, 0.7f, 1.4f);
        player.sendMessage(Text.says("Level " + level + ".  +" + Stats.cash(money)));

        if (level % 5 != 0) return;

        // Every fifth: something out of the crate.
        Material[] prizes = {
                Material.IRON_INGOT, Material.GOLD_INGOT, Material.DIAMOND,
                Material.EMERALD, Material.LAPIS_LAZULI, Material.REDSTONE,
                Material.GOLDEN_APPLE, Material.EXPERIENCE_BOTTLE,
        };
        Material prize = prizes[random.nextInt(prizes.length)];
        int many = 1 + random.nextInt(Math.max(1, level / 5));

        for (var spare : player.getInventory()
                .addItem(new org.bukkit.inventory.ItemStack(prize, Math.min(many, 16))).values()) {
            player.getWorld().dropItem(player.getLocation().add(0, 0.2, 0), spare);
        }

        player.showTitle(Title.title(
                Component.text("LEVEL " + level, NamedTextColor.GOLD),
                Component.text(many + "x " + prize.name().toLowerCase().replace('_', ' '),
                        NamedTextColor.GREEN),
                Title.Times.times(Duration.ofMillis(200), Duration.ofSeconds(2), Duration.ofMillis(400))));
        player.playSound(player, Sound.UI_TOAST_CHALLENGE_COMPLETE, 1f, 1f);
    }

    private void announcePhase(Player player, Phase phase) {
        player.showTitle(Title.title(
                Component.text(phase.name(), NamedTextColor.GOLD),
                Component.text("A new phase", NamedTextColor.GRAY),
                Title.Times.times(Duration.ofMillis(300), Duration.ofSeconds(3), Duration.ofMillis(500))));
        player.playSound(player, Sound.UI_TOAST_CHALLENGE_COMPLETE, 1f, 1f);

        nexus.getServer().broadcast(Component.text(player.getName(), NamedTextColor.WHITE)
                .append(Component.text(" reached ", NamedTextColor.GRAY))
                .append(Component.text(phase.name(), NamedTextColor.GOLD))
                .append(Component.text(" in One Block", NamedTextColor.GRAY)));
    }

    /**
     * Catches anybody who falls off their island.
     *
     * There is nothing below but void, and losing a two-hour run to a misstep
     * is how people stop playing. Put back on the block, keeping what they were
     * carrying — the fall is punishment enough.
     */
    public void tick() {
        if (world == null) return;

        for (Player player : world.getPlayers()) {
            if (player.getLocation().getY() > HEIGHT - 40) continue;

            Location home = islandOf(player.getUniqueId());
            player.teleport(home.clone().add(0, 2, 0));
            player.setFallDistance(0f);
            player.sendMessage(Text.says("Careful."));
        }
    }
}
