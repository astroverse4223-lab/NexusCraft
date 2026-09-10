package dev.nexuscraft.nexus;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.title.Title;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.Sound;
import org.bukkit.World;
import org.bukkit.entity.Player;

import java.time.Duration;
import java.util.HashMap;
import java.util.Map;
import java.util.Random;
import java.util.UUID;

/**
 * Fall a long way without hitting anything.
 *
 * The other game one person can play on their own, and the perfect counterpart
 * to parkour: that one is slow and precise, this one is over in twenty seconds
 * and is mostly nerve. Between them there is something to do alone whichever
 * mood somebody is in, which on a server with two players matters more than
 * another team game nobody can start.
 *
 * Six shafts, and a pool of water at the bottom of each. The water is the entire
 * safety mechanism - landing in it is survival and missing it is not, which is a
 * rule you can see rather than one you have to be told.
 *
 * The shafts differ in the shape of what is in them rather than in how much,
 * which is the difference between six levels and one level six times. Random
 * scatter cannot be learned; a ring has a gap you can aim for, a corridor has a
 * slot, and a spiral's gap moves in a direction you can read. Getting better at
 * a shaft means finding the line through it.
 */
public final class Dropper {

    /** Where each shaft starts and ends. */
    private static final int TOP = 250;
    private static final int BOTTOM = 60;

    /** How wide a shaft is. Wide enough to move, narrow enough to be scary. */
    private static final int WIDE = 11;

    /**
     * The platform you start on, three blocks under the top of the shaft.
     *
     * Nine blocks of clear air below it before the first obstacles at TOP-12,
     * so there is time to see what is coming after stepping in.
     */
    private static final int DECK = TOP - 3;

    /**
     * How deep the water is.
     *
     * More than the 3.9 blocks a player covers in one tick at terminal
     * velocity, which is the whole requirement: anything shallower can be
     * stepped over between two ticks and stops being a pool at all.
     */
    private static final int POOL = 6;

    /** Shafts sit this far apart, so one cannot be fallen into from another. */
    private static final int APART = 64;

    /** How many shafts. Read from the shapes, so adding one is one entry. */
    private static final int STAGES = Shaft.count();

    private final Nexus nexus;
    private final Random shape = new Random(31337L);

    private World world;

    /** Who is falling, in which shaft, and when they jumped. */
    private final Map<UUID, Integer> falling = new HashMap<>();
    private final Map<UUID, Long> began = new HashMap<>();

    public Dropper(Nexus nexus) {
        this.nexus = nexus;
    }

    /**
     * The layout version.
     *
     * Raised whenever the shafts change shape, which is what makes an existing
     * world get rebuilt rather than kept. Version 1 was three shafts of random
     * scatter with a one block pool and no deck to stand on.
     */
    public static final int VERSION = 3;

    public World world() {
        if (world == null) {
            world = nexus.worlds().of(Worlds.Place.DROPPER);

            /*
             * Rebuilt when the design has moved on, not only when it is empty.
             *
             * The old test was whether the bottom of the first shaft was still
             * air - which asks whether this world has ever been made, and stops
             * being true the first time anybody plays. Everything changed after
             * that point then applied only to servers that had never had a
             * dropper at all.
             */
            if (nexus.settings().builtVersion("dropper") < VERSION) rebuild();
        }
        return world;
    }

    /** Clears the shafts out and lays them again. */
    public void rebuild() {
        long began = System.currentTimeMillis();

        clear();
        build();

        nexus.settings().setBuiltVersion("dropper", VERSION);
        nexus.getLogger().info("built " + STAGES + " dropper shafts in "
                + (System.currentTimeMillis() - began) + "ms");
    }

    /**
     * Empties the space the shafts occupy before rebuilding it.
     *
     * Without this a new layout is laid over the old one - the old walls and
     * obstacles are only overwritten where the new ones happen to fall, and
     * everything else stays exactly where it was.
     */
    private void clear() {
        int half = WIDE / 2 + 1;

        for (int stage = 0; stage < STAGES; stage++) {
            int cx = stage * APART;

            for (int x = -half; x <= half; x++) {
                for (int z = -half; z <= half; z++) {
                    for (int y = BOTTOM - 2; y <= TOP + 1; y++) {
                        world.getBlockAt(cx + x, y, z)
                                .setType(Material.AIR, false);
                    }
                }
            }
        }
    }

    /* --------------------------------------------------------------- shafts */

    private void build() {
        for (int stage = 0; stage < STAGES; stage++) {
            shaft(stage);
            deck(stage);
        }
    }

    /**
     * One shaft: walls, obstacles, and water at the bottom.
     *
     * The obstacles thin out as they go down rather than getting denser. A
     * shaft that gets harder as you fall is one where the last second decides
     * everything and nothing you did before it mattered; getting easier means
     * the difficult part is at the top, where you still have time to react.
     */
    private void shaft(int stage) {
        int cx = stage * APART;
        int half = WIDE / 2;

        for (int y = BOTTOM; y <= TOP; y++) {
            for (int x = -half - 1; x <= half + 1; x++) {
                for (int z = -half - 1; z <= half + 1; z++) {
                    boolean wall = Math.abs(x) > half || Math.abs(z) > half;
                    if (!wall) continue;

                    world.getBlockAt(cx + x, y, z).setType(
                            y % 16 == 0 ? Material.SEA_LANTERN : Material.BLACK_CONCRETE, false);
                }
            }
        }

        /*
         * The pool, deep enough to be hit rather than passed through.
         *
         * One block of water is not a pool at these speeds. A falling player
         * covers about 3.9 blocks in a tick, so a single layer can sit entirely
         * between two ticks - never registering as water, and the fall ends on
         * the concrete underneath from a hundred and eighty blocks up. Six
         * layers is more than one tick's travel, so it cannot be skipped.
         */
        for (int x = -half; x <= half; x++) {
            for (int z = -half; z <= half; z++) {
                world.getBlockAt(cx + x, BOTTOM - 1, z)
                        .setType(Material.BLUE_CONCRETE, false);

                for (int y = BOTTOM; y < BOTTOM + POOL; y++) {
                    world.getBlockAt(cx + x, y, z).setType(Material.WATER, false);
                }
            }
        }

        /*
         * Obstacles, in whatever shape this shaft is made of.
         *
         * Thinning as they descend, in every pattern: a shaft that gets harder
         * as you fall is one where the last second decides everything, and by
         * then you are travelling too fast to do anything about it.
         */
        Shaft shaft = Shaft.of(stage);
        int layer = 0;

        /*
         * A gap that is always there, and always reachable from the one above.
         *
         * Every pattern leaves holes, but nothing made the holes line up: the
         * scatter in the first shaft is random per block, so two layers running
         * could have their only openings at opposite corners. Falling, you can
         * steer about a block sideways in the time between layers - so a shaft
         * that is technically passable can be impossible in practice, which is
         * exactly what the first stage felt like.
         *
         * This walks a safe column down the shaft, moving at most one block per
         * layer, and clears it after the obstacles are placed. Finding it is
         * still the game; the difference is that there is something to find.
         */
        int safeX = 0;
        int safeZ = 0;

        for (int y = TOP - 12; y > BOTTOM + POOL + 8; y -= shaft.spacing(), layer++) {
            double fade = (double) (y - BOTTOM) / (TOP - BOTTOM);
            double density = shaft.density() * fade;

            fill(cx, y, half, layer, shaft, density);

            /*
             * One axis at a time, and only sometimes.
             *
             * Drifting both at once moves the way through a diagonal block and
             * a half, and a player near terminal velocity can steer perhaps a
             * third of a block between layers - so the gap would pull away
             * from anybody actually falling through it. Moving one axis, on
             * two layers out of three, keeps it within reach the whole way
             * down while still making it wander.
             */
            if (layer % 3 != 2) {
                if (layer % 2 == 0) {
                    safeX = Math.max(-half + 1, Math.min(half - 1, safeX + shape.nextInt(3) - 1));
                } else {
                    safeZ = Math.max(-half + 1, Math.min(half - 1, safeZ + shape.nextInt(3) - 1));
                }
            }

            for (int dx = -1; dx <= 1; dx++) {
                for (int dz = -1; dz <= 1; dz++) {
                    world.getBlockAt(cx + safeX + dx, y, safeZ + dz)
                            .setType(Material.AIR, false);
                }
            }
        }
    }

    /**
     * One layer of obstacles, arranged the way this shaft arranges them.
     *
     * Every pattern leaves a way through - that is the whole design. A layer
     * with no gap is not a hard layer, it is a floor, and the player has no way
     * of telling the difference until they hit it.
     */
    private void fill(int cx, int y, int half, int layer, Shaft shaft, double density) {
        Material colour = shaft.palette();

        switch (shaft.pattern()) {
            case SCATTER -> {
                for (int x = -half; x <= half; x++) {
                    for (int z = -half; z <= half; z++) {
                        if (shape.nextDouble() > density) continue;
                        world.getBlockAt(cx + x, y, z).setType(colour, false);
                    }
                }
            }

            case RINGS -> {
                // A ring at a radius that changes each layer, with one gap in
                // it. The gap is what you aim for, and it is visible from a
                // long way up, which is why this is the first pattern.
                int radius = 2 + (layer % (half - 1));
                int gapAt = shape.nextInt(4);

                for (int x = -half; x <= half; x++) {
                    for (int z = -half; z <= half; z++) {
                        int distance = Math.max(Math.abs(x), Math.abs(z));
                        if (distance != radius) continue;

                        // The gap: one whole side of the ring left open.
                        int side = x == -radius ? 0 : x == radius ? 1
                                : z == -radius ? 2 : 3;
                        if (side == gapAt) continue;

                        world.getBlockAt(cx + x, y, z).setType(colour, false);
                    }
                }
            }

            case CORRIDORS -> {
                // A solid wall with a single slot through it, turned ninety
                // degrees every other layer so you cannot hold one line.
                boolean acrossX = layer % 2 == 0;
                int slot = shape.nextInt(WIDE - 4) - (half - 2);

                for (int x = -half; x <= half; x++) {
                    for (int z = -half; z <= half; z++) {
                        int along = acrossX ? z : x;
                        if (Math.abs(along - slot) <= 1) continue;

                        world.getBlockAt(cx + x, y, z).setType(colour, false);
                    }
                }
            }

            case CHECKER -> {
                // Alternating squares, offset each layer, so the safe cell is
                // never in the same place twice running.
                int offset = layer % 2;

                for (int x = -half; x <= half; x++) {
                    for (int z = -half; z <= half; z++) {
                        if (((x + z + offset) & 1) == 0) continue;
                        if (shape.nextDouble() > density + 0.25) continue;

                        world.getBlockAt(cx + x, y, z).setType(colour, false);
                    }
                }
            }

            case PILLARS -> {
                /*
                 * Columns rather than plates.
                 *
                 * Built four blocks tall so they are something you fall past
                 * rather than through, which changes what the shaft asks: not
                 * "where is the hole" but "which way am I drifting".
                 */
                for (int x = -half; x <= half; x += 3) {
                    for (int z = -half; z <= half; z += 3) {
                        if (shape.nextDouble() > density + 0.3) continue;

                        for (int tall = 0; tall < 4; tall++) {
                            world.getBlockAt(cx + x, y - tall, z).setType(colour, false);
                        }
                    }
                }
            }

            case SPIRAL -> {
                // A gap that walks around the shaft as you descend. The only
                // pattern where the right answer at one layer is the wrong one
                // at the next.
                double angle = layer * 0.9;
                int gapX = (int) Math.round(Math.cos(angle) * (half - 2));
                int gapZ = (int) Math.round(Math.sin(angle) * (half - 2));

                for (int x = -half; x <= half; x++) {
                    for (int z = -half; z <= half; z++) {
                        if (Math.abs(x - gapX) <= 1 && Math.abs(z - gapZ) <= 1) continue;
                        if (shape.nextDouble() > density + 0.2) continue;

                        world.getBlockAt(cx + x, y, z).setType(colour, false);
                    }
                }
            }
        }
    }

    /**
     * The platform at the top of a shaft, and the hole through it.
     *
     * Built after the obstacles so nothing can be scattered on top of it. The
     * hole is three by three - wide enough to walk into without lining
     * yourself up, narrow enough that stepping off the edge of the deck is a
     * decision rather than an accident.
     */
    private void deck(int stage) {
        int cx = stage * APART;
        int half = WIDE / 2;

        for (int x = -half; x <= half; x++) {
            for (int z = -half; z <= half; z++) {
                boolean hole = Math.abs(x) <= 1 && Math.abs(z) <= 1;

                world.getBlockAt(cx + x, DECK, z).setType(
                        hole ? Material.AIR
                                : Math.abs(x) <= 2 && Math.abs(z) <= 2
                                        ? Shaft.of(stage).palette()
                                        : Material.POLISHED_DEEPSLATE,
                        false);
            }
        }

        // Something to see by. The wall lanterns are every sixteen blocks and
        // the nearest is well below the deck.
        world.getBlockAt(cx - half, DECK + 3, 0).setType(Material.SEA_LANTERN, false);
        world.getBlockAt(cx + half, DECK + 3, 0).setType(Material.SEA_LANTERN, false);
        world.getBlockAt(cx, DECK + 3, -half).setType(Material.SEA_LANTERN, false);
        world.getBlockAt(cx, DECK + 3, half).setType(Material.SEA_LANTERN, false);
    }

    /**
     * Where somebody stands before they drop.
     *
     * On the deck and off to one side, facing the hole - not over it. Being
     * put directly above the hole is what the old version did, except without
     * the deck, which is why every attempt began already falling.
     */
    private Location topOf(int stage) {
        // Yaw 90 is west, which is back towards the middle from here.
        return new Location(world(), stage * APART + 3.5, DECK + 1, 0.5, 90f, 0f);
    }

    /* --------------------------------------------------------------- falling */

    public void begin(Player player, int stage) {
        world();

        int clamped = Math.max(0, Math.min(STAGES - 1, stage));

        nexus.backpacks().stash(player, nexus.worlds().placeOf(player));

        player.teleport(topOf(clamped));
        player.setGameMode(GameMode.ADVENTURE);
        player.getInventory().clear();
        Worlds.strip(player);
        nexus.hub().forget(player);

        falling.put(player.getUniqueId(), clamped);
        began.put(player.getUniqueId(), System.currentTimeMillis());

        player.showTitle(Title.title(
                Component.text("STAGE " + (clamped + 1), NamedTextColor.AQUA),
                Component.text("Hit the water", NamedTextColor.GRAY),
                Title.Times.times(Duration.ofMillis(200), Duration.ofSeconds(2), Duration.ofMillis(300))));
        player.playSound(player, Sound.ENTITY_ENDER_DRAGON_FLAP, 0.7f, 1.4f);
    }

    public boolean running(UUID who) {
        return falling.containsKey(who);
    }

    public void stop(Player player) {
        falling.remove(player.getUniqueId());
        began.remove(player.getUniqueId());
    }

    /**
     * Watches for the two ways a drop ends.
     *
     * Landing in the water is a win and hitting anything else is not. Checked
     * by looking at what is under them rather than by damage, because at
     * terminal velocity the damage event and the death arrive together and
     * there is nothing left to congratulate.
     */
    public void tick() {
        if (world == null) return;

        for (Player player : world.getPlayers()) {
            UUID who = player.getUniqueId();
            Integer stage = falling.get(who);
            if (stage == null) continue;

            Location at = player.getLocation();

            /*
             * Still on the deck, so the fall has not started.
             *
             * The clock is pushed forward for as long as they are up here,
             * which means standing and looking down the shaft costs nothing -
             * the time recorded is the fall, not the deliberating.
             */
            if (at.getY() > DECK) {
                began.put(who, System.currentTimeMillis());
                continue;
            }

            if (at.getBlock().getType() == Material.WATER) {
                landed(player, stage);
                continue;
            }

            /*
             * Resting on something solid below the top: they hit an obstacle.
             *
             * Read from the block under their feet rather than from
             * isOnGround(), which is a flag the client sends and which a
             * stuttering connection reports wrongly in mid-air - bouncing
             * somebody back to the deck for hitting nothing at all.
             *
             * The water check above has already returned by this point, so
             * floating in the pool is never read as landing on its floor.
             */
            if (at.getY() < TOP - 6 && standingOnSomething(at)) splat(player, stage);
        }
    }

    /**
     * Whether anything solid is holding them up.
     *
     * A player is six tenths of a block wide, and Minecraft will happily let
     * them stand on a corner with the middle of them over thin air. Looking
     * only under the centre - which is what `getLocation` gives you - therefore
     * missed exactly the case people hit most: clipping the edge of an
     * obstacle, sliding down its side, and never being caught by it.
     *
     * So all four corners of the player are checked as well as the middle.
     */
    private boolean standingOnSomething(Location at) {
        double reach = 0.31;

        for (double dx = -reach; dx <= reach; dx += reach) {
            for (double dz = -reach; dz <= reach; dz += reach) {
                Material under = at.clone().add(dx, -0.2, dz).getBlock().getType();
                if (under.isSolid()) return true;
            }
        }
        return false;
    }

    private void landed(Player player, int stage) {
        Long from = began.remove(player.getUniqueId());
        falling.remove(player.getUniqueId());

        int seconds = from == null ? 0 : (int) ((System.currentTimeMillis() - from) / 1000);

        Stats.Record record = nexus.stats().of(player.getUniqueId());

        boolean first = (record.dropperCleared & (1 << stage)) == 0;
        record.dropperCleared |= (1 << stage);

        int had = record.dropperBestOn(stage);
        boolean best = had == 0 || (seconds > 0 && seconds < had);
        if (best && seconds > 0) record.dropperTimes.put(stage, seconds);

        Shaft shaft = Shaft.of(stage);

        /*
         * The first clear pays; falling it again pays a quarter.
         *
         * Without that split the quickest money on the server would be falling
         * down the easiest shaft on a loop, which takes twenty seconds and
         * would out-earn every job on the server.
         */
        double paid = first ? shaft.pays() : shaft.pays() * 0.25;
        nexus.stats().pay(player.getUniqueId(), paid);

        player.showTitle(Title.title(
                Component.text("SURVIVED", NamedTextColor.GREEN),
                Component.text(shaft.name() + "   " + seconds + "s   +"
                        + Stats.cash(paid), NamedTextColor.GRAY),
                Title.Times.times(Duration.ofMillis(200), Duration.ofSeconds(2),
                        Duration.ofMillis(400))));
        player.playSound(player, Sound.ENTITY_PLAYER_LEVELUP, 1f, 1.4f);

        if (best && !first) {
            player.sendMessage(Text.good("Fastest yet down " + shaft.name()
                    + ": " + seconds + "s."));
        }

        boolean allDone = record.dropperCleared == (1 << STAGES) - 1;

        if (stage + 1 < STAGES) {
            player.sendMessage(Text.good(shaft.name() + " done.  Next: "
                    + Shaft.of(stage + 1).name() + "."));
            /*
             * Checked when it fires, not when it is scheduled.
             *
             * Two seconds is long enough to type /hub or to disconnect, and
             * without this the reward for doing either is being dragged back to
             * the top of a shaft.
             */
            nexus.getServer().getScheduler().runTaskLater(nexus, () -> {
                if (!player.isOnline()) return;
                if (!player.getWorld().equals(world())) return;
                begin(player, stage + 1);
            }, 40L);
            return;
        }

        if (allDone) {
            player.sendMessage(Text.good("Every shaft. Have a key."));
            nexus.crates().give(player, Crates.Tier.LEGENDARY, 1);

            nexus.getServer().broadcast(Component.text(player.getName(),
                            NamedTextColor.WHITE)
                    .append(Component.text(" has cleared every dropper shaft",
                            NamedTextColor.GOLD)));
        }

        nexus.hub().send(player);
    }

    /** The shafts, and how somebody is doing on them. */
    public void list(Player player) {
        Stats.Record record = nexus.stats().of(player.getUniqueId());

        player.sendMessage(Text.heading("Dropper"));

        for (int i = 0; i < STAGES; i++) {
            Shaft shaft = Shaft.of(i);
            boolean done = (record.dropperCleared & (1 << i)) != 0;
            int best = record.dropperBestOn(i);

            player.sendMessage(Component.text("  " + (i + 1) + ". " + shaft.name(),
                            done ? NamedTextColor.GREEN : NamedTextColor.WHITE)
                    .append(Component.text("   " + shaft.pattern().name().toLowerCase(),
                            NamedTextColor.DARK_GRAY))
                    .append(Component.text(best > 0 ? "   best " + best + "s"
                                    : done ? "   cleared" : "",
                            NamedTextColor.GOLD)));
        }

        player.sendMessage(Text.field("Cleared",
                record.dropperLevels() + " of " + STAGES));
        player.sendMessage(Text.plain("  /dropper <number> to fall down one."));
    }

    public static int shafts() {
        return STAGES;
    }

    private void splat(Player player, int stage) {
        falling.remove(player.getUniqueId());
        began.remove(player.getUniqueId());

        player.showTitle(Title.title(
                Component.text("SPLAT", NamedTextColor.RED),
                Component.text("Try again", NamedTextColor.GRAY),
                Title.Times.times(Duration.ofMillis(150), Duration.ofSeconds(1), Duration.ofMillis(300))));
        player.playSound(player, Sound.ENTITY_GENERIC_BIG_FALL, 1f, 0.8f);

        // Straight back to the top of the same stage, because the whole appeal
        // is that a failure costs twenty seconds and nothing else - but only if
        // they are still here to go back to it.
        nexus.getServer().getScheduler().runTaskLater(nexus, () -> {
            if (!player.isOnline()) return;
            if (!player.getWorld().equals(world())) return;
            begin(player, stage);
        }, 30L);
    }

    public static int stages() {
        return STAGES;
    }
}
