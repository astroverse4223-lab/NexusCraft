package dev.nexuscraft.nexus;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextDecoration;
import net.kyori.adventure.title.Title;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.Particle;
import org.bukkit.Sound;
import org.bukkit.World;
import org.bukkit.block.Chest;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;

/**
 * Things that happen without anybody pressing anything.
 *
 * Everything else on this server is a reaction: you click a bot, you open a
 * shop, you join a queue. That makes it a very good menu and not somewhere that
 * feels inhabited — you can log in, and until you do something, nothing does.
 *
 * An event is the opposite. You log in and something is already happening, or
 * something starts while you are in the middle of mining and you have to decide
 * whether to go. That decision is the whole feature. Everything below is built
 * around making people stop what they are doing.
 *
 * Announced loudly and given a location, deliberately. An event nobody notices
 * is a worse version of no event, because the work went in anyway.
 */
public final class Events {

    /** How often one fires, in seconds. */
    private static final int EVERY = 22 * 60;

    /** And a little either side, so nobody can set a watch by it. */
    private static final int JITTER = 8 * 60;

    /** How long an airdrop sits before it gives up and vanishes. */
    private static final int AIRDROP_LASTS = 6 * 60;

    /** Double money runs for this long. */
    private static final int HAPPY_HOUR = 20 * 60;

    private final Nexus nexus;
    private final Random random = new Random();

    private int countdown = 4 * 60;

    /** Where the current airdrop is, and how long it has left. */
    private Location airdrop;
    private int airdropLeft;

    private int happyHourLeft;

    public Events(Nexus nexus) {
        this.nexus = nexus;
    }

    /* ---------------------------------------------------------------- clock */

    public void tick() {
        if (happyHourLeft > 0 && --happyHourLeft == 0) {
            nexus.stats().setMultiplier(1.0);
            announce(Component.text("Happy hour is over.", NamedTextColor.GRAY));
        }

        if (airdropLeft > 0) tickAirdrop();

        if (--countdown > 0) return;
        countdown = EVERY + random.nextInt(JITTER * 2) - JITTER;

        // Nothing fires into an empty server. An airdrop nobody saw land is
        // just a chest in a field.
        if (nexus.getServer().getOnlinePlayers().isEmpty()) return;

        fireSomething();
    }

    private void fireSomething() {
        List<Runnable> possible = new ArrayList<>();

        possible.add(this::happyHour);
        possible.add(this::meteorShower);
        if (playersIn(Worlds.Place.SURVIVAL) > 0) possible.add(this::dropCrate);
        if (playersIn(Worlds.Place.SURVIVAL) > 0) possible.add(this::horde);

        possible.get(random.nextInt(possible.size())).run();
    }

    private int playersIn(Worlds.Place place) {
        World world = nexus.getServer().getWorld(place.world);
        return world == null ? 0 : world.getPlayers().size();
    }

    /* ------------------------------------------------------------ happy hour */

    private void happyHour() {
        happyHourLeft = HAPPY_HOUR;
        nexus.stats().setMultiplier(2.0);

        big("HAPPY HOUR", "Everything pays double for twenty minutes");
        announce(Component.text("Double money for the next twenty minutes.", NamedTextColor.GOLD));
    }

    /* --------------------------------------------------------------- airdrop */

    /**
     * A chest lands somewhere in survival, and everybody is told where.
     *
     * Told where, on purpose. A hidden one is a treasure hunt that nobody
     * finds; a marked one is a race, and a race is a reason for two players to
     * meet, which is the rarest and most valuable thing that can happen on a
     * small server.
     */
    private void dropCrate() {
        World world = nexus.getServer().getWorld(Worlds.Place.SURVIVAL.world);
        if (world == null || world.getPlayers().isEmpty()) return;

        Player near = world.getPlayers().get(random.nextInt(world.getPlayers().size()));
        Location around = near.getLocation();

        // Far enough to be a walk, near enough that it is worth starting.
        double angle = random.nextDouble() * Math.PI * 2;
        double away = 60 + random.nextInt(90);

        int x = around.getBlockX() + (int) (Math.cos(angle) * away);
        int z = around.getBlockZ() + (int) (Math.sin(angle) * away);
        int y = world.getHighestBlockYAt(x, z) + 1;

        airdrop = new Location(world, x, y, z);
        airdropLeft = AIRDROP_LASTS;

        world.getBlockAt(x, y, z).setType(Material.CHEST);
        if (world.getBlockAt(x, y, z).getState() instanceof Chest chest) {
            fill(chest);
        }

        big("AIRDROP", "Something landed in Survival");
        announce(Component.text("An airdrop landed at ", NamedTextColor.GOLD)
                .append(Component.text(x + ", " + y + ", " + z, NamedTextColor.WHITE, TextDecoration.BOLD))
                .append(Component.text("  —  six minutes", NamedTextColor.GRAY)));
    }

    private void fill(Chest chest) {
        Material[] good = {
                Material.DIAMOND, Material.EMERALD, Material.GOLD_INGOT, Material.IRON_INGOT,
                Material.NETHERITE_SCRAP, Material.ENCHANTED_GOLDEN_APPLE, Material.OBSIDIAN,
                Material.EXPERIENCE_BOTTLE, Material.GOLDEN_APPLE, Material.TNT,
        };

        for (int i = 0; i < 5 + random.nextInt(4); i++) {
            Material what = good[random.nextInt(good.length)];
            int many = what == Material.ENCHANTED_GOLDEN_APPLE ? 1 : 2 + random.nextInt(10);

            chest.getBlockInventory().setItem(random.nextInt(27), new ItemStack(what, many));
        }
        chest.getBlockInventory().addItem(nexus.crates().key(Crates.Tier.RARE, 1));
    }

    /**
     * The beam, and the clock.
     *
     * A column of particles is the only way to find a chest in a forest, and
     * running it every second is what makes the thing feel urgent rather than
     * like a coordinate somebody mentioned once.
     */
    private void tickAirdrop() {
        airdropLeft--;

        if (airdrop == null) {
            airdropLeft = 0;
            return;
        }

        World world = airdrop.getWorld();
        if (world != null) {
            for (int up = 0; up < 40; up += 2) {
                world.spawnParticle(Particle.END_ROD,
                        airdrop.clone().add(0.5, up, 0.5), 2, 0.1, 0.2, 0.1, 0);
            }
        }

        if (airdropLeft == 60) {
            announce(Component.text("The airdrop goes in one minute.", NamedTextColor.YELLOW));
        }

        if (airdropLeft <= 0) {
            if (world != null && airdrop.getBlock().getType() == Material.CHEST) {
                airdrop.getBlock().setType(Material.AIR);
                announce(Component.text("The airdrop is gone.", NamedTextColor.GRAY));
            }
            airdrop = null;
        }
    }

    /* --------------------------------------------------------------- meteors */

    /**
     * Ore rains into the prison mines.
     *
     * Prison is the world people spend the longest in doing the least, so it is
     * the one that most needs something to interrupt it. Dropped as items
     * rather than placed as blocks, because placing them would let somebody
     * wall a mine off and farm the good stuff on their own.
     */
    private void meteorShower() {
        World world = nexus.getServer().getWorld(Worlds.Place.PRISON.world);
        if (world == null) return;

        big("METEOR SHOWER", "Ore is falling in the mines");
        announce(Component.text("A meteor shower over the prison mines.", NamedTextColor.GOLD));

        Material[] falling = {
                Material.DIAMOND, Material.EMERALD, Material.GOLD_INGOT,
                Material.IRON_INGOT, Material.COAL, Material.LAPIS_LAZULI,
        };

        for (Player player : world.getPlayers()) {
            Location above = player.getLocation().add(0, 12, 0);

            for (int i = 0; i < 24; i++) {
                Location at = above.clone().add(
                        random.nextInt(17) - 8, random.nextInt(5), random.nextInt(17) - 8);

                world.dropItem(at, new ItemStack(
                        falling[random.nextInt(falling.length)], 1 + random.nextInt(3)));
                world.spawnParticle(Particle.FLAME, at, 6, 0.2, 0.2, 0.2, 0.01);
            }

            player.playSound(player, Sound.ENTITY_FIREWORK_ROCKET_LARGE_BLAST, 1f, 0.8f);
        }
    }

    /* ----------------------------------------------------------------- horde */

    /**
     * A wave of mobs on somebody in survival, with a reward for surviving.
     *
     * Aimed at one player rather than the whole world so it lands as an event
     * rather than as a difficulty change, and announced beforehand so nobody
     * loses their inventory to something they had no chance to react to.
     */
    private void horde() {
        World world = nexus.getServer().getWorld(Worlds.Place.SURVIVAL.world);
        if (world == null || world.getPlayers().isEmpty()) return;

        Player target = world.getPlayers().get(random.nextInt(world.getPlayers().size()));

        big("THEY FOUND YOU", "Survive two minutes");
        announce(Component.text(target.getName(), NamedTextColor.RED)
                .append(Component.text(" has something coming for them.", NamedTextColor.GRAY)));

        nexus.getServer().getScheduler().runTaskLater(nexus, () -> {
            if (!target.isOnline()) return;

            org.bukkit.entity.EntityType[] kinds = {
                    org.bukkit.entity.EntityType.ZOMBIE,
                    org.bukkit.entity.EntityType.SKELETON,
                    org.bukkit.entity.EntityType.SPIDER,
            };

            for (int i = 0; i < 10; i++) {
                Location at = target.getLocation().add(
                        random.nextInt(15) - 7, 0, random.nextInt(15) - 7);
                at.setY(world.getHighestBlockYAt(at) + 1);

                world.spawnEntity(at, kinds[random.nextInt(kinds.length)]);
            }

            target.playSound(target, Sound.ENTITY_ENDER_DRAGON_GROWL, 1f, 0.6f);
        }, 100L);

        // Paid for being the one it happened to, whether they fight or run.
        nexus.getServer().getScheduler().runTaskLater(nexus, () -> {
            if (!target.isOnline()) return;
            nexus.stats().pay(target.getUniqueId(), 2_500);
            target.sendMessage(Text.good("You made it. +" + Stats.cash(2_500)));
            nexus.crates().give(target, Crates.Tier.COMMON, 1);
        }, 100L + 2400L);
    }

    /* ---------------------------------------------------------------- saying */

    private void announce(Component message) {
        nexus.getServer().broadcast(Component.text("» ", Text.BRAND).append(message));

        nexus.discord().event(net.kyori.adventure.text.serializer.plain
                .PlainTextComponentSerializer.plainText().serialize(message));
    }

    private void big(String headline, String under) {
        for (Player player : nexus.getServer().getOnlinePlayers()) {
            player.showTitle(Title.title(
                    Component.text(headline, NamedTextColor.GOLD, TextDecoration.BOLD),
                    Component.text(under, NamedTextColor.GRAY),
                    Title.Times.times(Duration.ofMillis(300), Duration.ofSeconds(3),
                            Duration.ofMillis(600))));
            player.playSound(player, Sound.ENTITY_ENDER_DRAGON_AMBIENT, 0.5f, 1.4f);
        }
    }

    /** For an operator who wants one now rather than in twenty minutes. */
    public boolean force(String which) {
        switch (which.toLowerCase()) {
            case "airdrop" -> dropCrate();
            case "happyhour" -> happyHour();
            case "meteors" -> meteorShower();
            case "horde" -> horde();
            default -> {
                return false;
            }
        }
        return true;
    }

    public boolean happyHourOn() {
        return happyHourLeft > 0;
    }

    public int nextIn() {
        return countdown;
    }
}
