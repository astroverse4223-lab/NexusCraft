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
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.UUID;

/**
 * Five courses in the sky, against the clock.
 *
 * There used to be one, which meant the whole of parkour was over the first
 * time somebody finished it - after that the only thing left was to run the
 * same sixty jumps faster, and a personal best is a reason to come back once,
 * not a reason to keep playing.
 *
 * What makes these five different courses rather than one course five times is
 * that each changes what the difficulty is made of. The second is simply longer.
 * The third takes away the width of the landings, so an imprecise jump that the
 * second forgave now drops you. The fourth takes away the grip. The fifth takes
 * away the checkpoints, which changes nothing about any individual jump and
 * everything about jump ninety.
 *
 * Courses are stacked sixty blocks apart in the same world rather than given a
 * world each, because a world costs a region file and a load, and five of them
 * would be five times the cost of the thing being avoided.
 *
 * Still one shared set of courses rather than one per player: comparing times
 * only means something if everybody ran the same jumps.
 */
public final class Parkour {

    private final Nexus nexus;

    private World world;

    /**
     * The jumps of each course, worked out once when it is built.
     *
     * Kept per course rather than rebuilt on entry, because the checkpoint
     * logic needs to know where every step is and recomputing it for a hundred
     * jumps every time somebody starts a run is work with a known answer.
     */
    private final Map<Integer, List<Location>> steps = new HashMap<>();

    /** Who is running, on which course, since when, and their last checkpoint. */
    private final Map<UUID, Integer> onCourse = new HashMap<>();
    private final Map<UUID, Long> started = new HashMap<>();
    private final Map<UUID, Integer> reached = new HashMap<>();

    public Parkour(Nexus nexus) {
        this.nexus = nexus;
    }

    /**
     * The layout version.
     *
     * Version 1 was a single sixty jump course. Version 2 stacked five of them
     * sixty blocks apart, which put the fifth above the build limit. Version 3
     * lays them side by side.
     */
    public static final int VERSION = 3;

    public World world() {
        if (world == null) {
            world = nexus.worlds().of(Worlds.Place.PARKOUR);

            /*
             * A world built for an older layout still has that layout in it.
             *
             * Building over the top only replaces the blocks the new courses
             * happen to land on; the rest of the old ones stay exactly where
             * they were, at heights the new courses no longer use.
             */
            if (nexus.settings().builtVersion("parkour") < VERSION) {
                rebuild();
            } else {
                for (int i = 0; i < Course.count(); i++) build(i);
            }
        }
        return world;
    }

    /**
     * Throws the world away and lays the courses out again.
     *
     * Deleting rather than clearing, because the area an old layout might
     * occupy is hundreds of blocks in every direction and clearing it would be
     * tens of millions of block writes on the main thread. The world is
     * generated and holds nothing anybody made, which is the same reason
     * minigame arenas are deleted rather than reset.
     */
    public void rebuild() {
        long began = System.currentTimeMillis();

        if (world == null) world = nexus.worlds().of(Worlds.Place.PARKOUR);

        // Nobody can be standing in a world that is about to be unloaded.
        for (Player player : new ArrayList<>(world.getPlayers())) {
            stop(player);
            nexus.hub().send(player);
        }

        Arena.destroy(world);
        nexus.worlds().forget(Worlds.Place.PARKOUR);

        steps.clear();
        world = nexus.worlds().of(Worlds.Place.PARKOUR);

        /*
         * Anybody still holding the world that was just deleted.
         *
         * The evacuation above only sees players the world already lists, and a
         * player who is mid-teleport into it is not one of them - the teleport
         * has been sent and not yet confirmed. They land in a world whose chunk
         * system has been shut down, and ticking them throws rather than doing
         * anything a player could recover from. A world that has been unloaded
         * is no longer among the server's worlds, which is how they are found.
         */
        for (Player stranded : nexus.getServer().getOnlinePlayers()) {
            if (nexus.getServer().getWorlds().contains(stranded.getWorld())) continue;

            nexus.getLogger().warning("moving " + stranded.getName()
                    + " out of a world that no longer exists");
            stop(stranded);
            nexus.hub().send(stranded);
        }

        for (int i = 0; i < Course.count(); i++) build(i);

        nexus.settings().setBuiltVersion("parkour", VERSION);
        nexus.getLogger().info("built " + Course.count() + " parkour courses in "
                + (System.currentTimeMillis() - began) + "ms");
    }

    /* --------------------------------------------------------------- courses */

    /**
     * Lays out one course.
     *
     * Seeded from the course number, so every course is different from the
     * others and identical to itself on every restart. A course that changed
     * shape when the server rebooted would make every recorded time
     * incomparable, which is most of the point of recording them.
     */
    private void build(int index) {
        Course course = Course.of(index);
        Random shape = new Random(90210L + index * 7919L);

        int floor = Course.GROUND;
        int originX = Course.originX(index);

        List<Location> jumps = new ArrayList<>();
        Location at = new Location(world, originX + 0.5, floor, 0.5);

        // A platform to start from, so the first jump is a jump and not a fall.
        for (int x = -2; x <= 2; x++) {
            for (int z = -2; z <= 2; z++) {
                world.getBlockAt(originX + x, floor - 1, z)
                        .setType(course.block(), false);
            }
        }

        double heading = 0;

        for (int i = 0; i < course.jumps(); i++) {
            boolean checkpoint = course.checkpointEvery() > 0
                    && i > 0 && i % course.checkpointEvery() == 0;

            /*
             * The course wanders rather than running straight.
             *
             * A straight line is easier than it looks and duller than it
             * sounds; turning it a little each jump means you have to look
             * where you are going, which is most of what makes parkour a skill
             * rather than a rhythm. Later courses turn more.
             */
            heading += (shape.nextDouble() - 0.5) * course.wander();

            int rise = shape.nextInt(10) < course.riseChance() ? 1
                    : shape.nextInt(6) == 0 ? -1 : 0;

            /*
             * A rise costs reach, which is a rule of the game rather than a
             * choice: you cannot jump as far upward as along, and a course that
             * ignores that produces jumps nobody can make.
             */
            double gap = rise > 0
                    ? 2 + shape.nextInt(Math.max(1, course.longestGap() - 2))
                    : 3 + shape.nextInt(Math.max(1, course.longestGap() - 2));

            at = reachable(at, heading, gap, rise);

            Material block = blockFor(course, shape, i, checkpoint);

            world.getBlockAt(at.getBlockX(), at.getBlockY() - 1, at.getBlockZ())
                    .setType(block, false);

            jumps.add(at.clone());
        }

        // A landing pad at the end, so finishing does not mean falling.
        Location last = jumps.get(jumps.size() - 1);
        for (int x = -2; x <= 2; x++) {
            for (int z = -2; z <= 2; z++) {
                world.getBlockAt(last.getBlockX() + x, last.getBlockY() - 1,
                        last.getBlockZ() + z).setType(Material.GOLD_BLOCK, false);
            }
        }

        steps.put(index, jumps);
    }

    /**
     * The next step, pulled in until it is a jump somebody can make.
     *
     * The gap is chosen in whole blocks but walked in floating point, and the
     * block that ends up being placed is that position floored - each axis
     * rounding independently. A chosen gap of four can land a block four and a
     * half away, and four and a half is past what a sprinting player clears.
     *
     * So the position is measured in the space that matters - between the block
     * somebody takes off from and the block they land on - and shortened until
     * it fits. Shortening rather than re-rolling because a re-roll can fail
     * repeatedly and a course must always finish generating.
     */
    private Location reachable(Location from, double heading, double gap, int rise) {
        double reach = rise > 0 ? REACH_UP : rise < 0 ? REACH_DOWN : REACH_FLAT;

        for (double tryGap = gap; tryGap >= 1.5; tryGap -= 0.25) {
            Location candidate = from.clone().add(
                    Math.cos(heading) * tryGap, rise, Math.sin(heading) * tryGap);

            double blocks = Math.hypot(
                    candidate.getBlockX() - from.getBlockX(),
                    candidate.getBlockZ() - from.getBlockZ());

            // Not zero, or the course stops moving and stacks on one column.
            if (blocks >= 1 && blocks <= reach) return candidate;
        }

        // Nothing fitted, which should not happen - one block along the heading
        // always does. Kept so the course finishes rather than looping.
        return from.clone().add(Math.signum(Math.cos(heading)), rise, 0);
    }

    /**
     * What a sprinting player can actually clear, block centre to block centre.
     *
     * Four flat is the standard sprint jump. Rising costs about a block of
     * reach; dropping buys a little. These are the numbers the self test
     * measures against too, so a course cannot be generated that the test would
     * then reject.
     */
    private static final double REACH_FLAT = 4.0;
    private static final double REACH_UP = 3.0;
    private static final double REACH_DOWN = 4.5;

    /**
     * What one step is made of.
     *
     * Checkpoints are always a full, unmistakable block - a checkpoint you can
     * slide off is not a checkpoint. Everything else is where a course gets its
     * character: a slab is a landing half as tall, ice is one you keep moving
     * across, and neither changes the length of the jump at all.
     */
    private Material blockFor(Course course, Random shape, int index, boolean checkpoint) {
        if (checkpoint) return Material.SEA_LANTERN;
        if (index == course.jumps() - 1) return Material.GOLD_BLOCK;

        if (course.iceChance() > 0 && shape.nextInt(10) < course.iceChance()) {
            return Material.PACKED_ICE;
        }
        if (course.narrowChance() > 0 && shape.nextInt(10) < course.narrowChance()) {
            return Material.QUARTZ_SLAB;
        }
        return shape.nextInt(4) == 0 ? course.accent() : course.block();
    }

    public Location start(int index) {
        world();
        return new Location(world, Course.originX(index) + 0.5,
                Course.GROUND, 0.5, 0f, 0f);
    }

    /* --------------------------------------------------------------- running */

    /**
     * Which course somebody may attempt.
     *
     * One past the furthest they have finished, so the ladder opens as they
     * climb it. Locking later courses is not about difficulty - anybody can
     * fall off any of them - it is that arriving at "No Net" first would be
     * read as the parkour being broken rather than as the last course.
     */
    public int unlocked(UUID who) {
        Stats.Record record = nexus.stats().of(who);

        int furthest = 0;
        for (int i = 0; i < Course.count(); i++) {
            if (record.parkourBestOn(i) > 0) furthest = i + 1;
        }
        return Math.min(furthest, Course.count() - 1);
    }

    /** Entering from the lobby bot puts you on the next one you have not cleared. */
    public void begin(Player player) {
        begin(player, unlocked(player.getUniqueId()));
    }

    public void begin(Player player, int index) {
        world();

        int course = Math.max(0, Math.min(Course.count() - 1, index));

        if (course > unlocked(player.getUniqueId())) {
            player.sendMessage(Text.bad("Finish " + Course.of(course - 1).name()
                    + " first."));
            list(player);
            return;
        }

        nexus.backpacks().stash(player, nexus.worlds().placeOf(player));

        player.teleport(start(course));
        player.setGameMode(GameMode.ADVENTURE);
        player.getInventory().clear();

        /*
         * A clean run, in the strictest sense.
         *
         * The course is timed and ranked, so arriving with the lobby's Speed II
         * was not only awkward to jump with - it was a better time than
         * somebody who walked in from anywhere else would get.
         */
        Worlds.strip(player);

        // The lobby sidebar belongs to the lobby, and a course has its own
        // things to say in the action bar.
        nexus.hub().forget(player);

        onCourse.put(player.getUniqueId(), course);
        started.put(player.getUniqueId(), System.currentTimeMillis());
        reached.put(player.getUniqueId(), -1);

        Course shape = Course.of(course);
        int best = nexus.stats().of(player.getUniqueId()).parkourBestOn(course);

        player.showTitle(Title.title(
                Component.text(shape.name(), NamedTextColor.GREEN),
                Component.text(best > 0 ? "Your best: " + time(best) : "First run",
                        NamedTextColor.GRAY),
                Title.Times.times(Duration.ofMillis(200), Duration.ofSeconds(2),
                        Duration.ofMillis(300))));

        player.sendMessage(Text.heading(shape.name()));
        player.sendMessage(Text.plain("  " + shape.blurb() + "."));
        player.sendMessage(Text.plain("  " + shape.jumps() + " jumps, "
                + (shape.checkpointEvery() > 0
                        ? "a checkpoint every " + shape.checkpointEvery()
                        : "no checkpoints at all") + "."));
        player.sendMessage(Text.plain("  Par is " + time(shape.par())
                + ".  /parkour to pick another.  /hub to give up."));
    }

    /** The ladder, and where they are on it. */
    public void list(Player player) {
        Stats.Record record = nexus.stats().of(player.getUniqueId());
        int open = unlocked(player.getUniqueId());

        player.sendMessage(Text.heading("Parkour"));

        for (int i = 0; i < Course.count(); i++) {
            Course course = Course.of(i);
            int best = record.parkourBestOn(i);

            boolean locked = i > open;
            NamedTextColor colour = locked ? NamedTextColor.DARK_GRAY
                    : best > 0 ? NamedTextColor.GREEN : NamedTextColor.WHITE;

            player.sendMessage(Component.text("  " + (i + 1) + ". " + course.name(), colour)
                    .append(Component.text("   " + course.blurb(), NamedTextColor.DARK_GRAY))
                    .append(Component.text(locked ? "   locked"
                                    : best > 0 ? "   best " + time(best)
                                    : "   not run yet",
                            locked ? NamedTextColor.DARK_GRAY
                                    : best > 0 ? NamedTextColor.GOLD : NamedTextColor.GRAY)));
        }

        player.sendMessage(Text.field("Cleared",
                record.parkourCleared() + " of " + Course.count()));
        player.sendMessage(Text.plain("  /parkour <number> to run one."));
    }

    public boolean running(UUID who) {
        return started.containsKey(who);
    }

    public void stop(Player player) {
        onCourse.remove(player.getUniqueId());
        started.remove(player.getUniqueId());
        reached.remove(player.getUniqueId());
    }

    /**
     * Called every tick for anybody on a course.
     *
     * Checkpoints are worked out from position rather than pressure plates,
     * because a plate is a block somebody can stand next to and miss, and a
     * missed checkpoint on jump fifty is the sort of thing that makes people
     * stop playing.
     */
    public void tick() {
        if (world == null) return;

        for (Player player : world.getPlayers()) {
            UUID who = player.getUniqueId();
            if (!started.containsKey(who)) continue;

            Integer course = onCourse.get(who);
            if (course == null) continue;

            List<Location> jumps = steps.get(course);
            if (jumps == null || jumps.isEmpty()) continue;

            if (player.getLocation().getY() < Course.GROUND - 30) {
                fell(player, course, jumps);
                continue;
            }

            int at = nearestStep(jumps, player.getLocation());
            if (at < 0) continue;

            if (at == jumps.size() - 1) {
                finished(player, course);
                continue;
            }

            int every = Course.of(course).checkpointEvery();
            if (every <= 0) continue;

            // Only checkpoints count as progress, so somebody cannot skip half
            // the course by falling onto a later block.
            if (at % every != 0 || at == 0) continue;

            int had = reached.getOrDefault(who, -1);
            if (at <= had) continue;

            reached.put(who, at);
            player.playSound(player, Sound.BLOCK_NOTE_BLOCK_PLING, 1f, 1.6f);
            player.sendActionBar(Component.text("Checkpoint " + at + "/" + jumps.size(),
                    NamedTextColor.AQUA));
        }
    }

    private int nearestStep(List<Location> jumps, Location at) {
        for (int i = jumps.size() - 1; i >= 0; i--) {
            Location step = jumps.get(i);
            if (Math.abs(at.getY() - step.getY()) > 1.5) continue;
            if (at.distanceSquared(step) < 2.2) return i;
        }
        return -1;
    }

    private void fell(Player player, int course, List<Location> jumps) {
        int back = reached.getOrDefault(player.getUniqueId(), -1);

        Location to = back < 0 ? start(course) : jumps.get(back).clone();
        to.setYaw(player.getLocation().getYaw());

        player.teleport(to);
        player.setFallDistance(0f);
        player.playSound(player, Sound.ENTITY_ITEM_BREAK, 0.6f, 0.8f);
    }

    private void finished(Player player, int course) {
        Long began = started.remove(player.getUniqueId());
        reached.remove(player.getUniqueId());
        onCourse.remove(player.getUniqueId());
        if (began == null) return;

        int seconds = (int) ((System.currentTimeMillis() - began) / 1000);

        Stats.Record record = nexus.stats().of(player.getUniqueId());
        Course shape = Course.of(course);

        int had = record.parkourBestOn(course);
        boolean best = had == 0 || seconds < had;
        boolean first = had == 0;

        if (best) record.parkourTimes.put(course, seconds);
        if (record.parkourBest == 0 || seconds < record.parkourBest) {
            record.parkourBest = seconds;
        }
        record.parkourRuns++;

        /*
         * The first clear pays properly; running it again pays for beating par.
         *
         * Without that split, the fastest way to make money would be to run the
         * easiest course over and over, which is not what any of this is for.
         */
        double paid = first ? shape.pays()
                : Math.max(0, shape.pays() * 0.25 + (shape.par() - seconds) * 20);

        nexus.stats().pay(player.getUniqueId(), paid);

        player.showTitle(Title.title(
                Component.text(time(seconds),
                        best ? NamedTextColor.GOLD : NamedTextColor.GREEN),
                Component.text(best ? "New best on " + shape.name()
                        : "Best: " + time(had), NamedTextColor.GRAY),
                Title.Times.times(Duration.ofMillis(200), Duration.ofSeconds(3),
                        Duration.ofMillis(500))));
        player.playSound(player, Sound.UI_TOAST_CHALLENGE_COMPLETE, 1f, 1f);

        player.sendMessage(Text.good(shape.name() + " in " + time(seconds)
                + ".  +" + Stats.cash(paid)));

        if (seconds <= shape.par()) {
            player.sendMessage(Text.good("  Under par."));
        }

        if (first) {
            nexus.crates().give(player, Crates.Tier.COMMON, 1);

            if (course + 1 >= Course.count()) {
                player.sendMessage(Text.good("  That was the last one."));
                nexus.crates().give(player, Crates.Tier.LEGENDARY, 1);

                nexus.getServer().broadcast(Component.text(player.getName(),
                                NamedTextColor.WHITE)
                        .append(Component.text(" has finished every parkour course",
                                NamedTextColor.GOLD)));
                nexus.discord().event(player.getName()
                        + " finished every parkour course");
            }
        }

        if (best && !first) {
            nexus.getServer().broadcast(Component.text(player.getName(), NamedTextColor.WHITE)
                    .append(Component.text(" ran " + shape.name() + " in ",
                            NamedTextColor.GRAY))
                    .append(Component.text(time(seconds), NamedTextColor.GOLD)));
        }

        // The last course, or there is nowhere else to go.
        if (course + 1 >= Course.count()) {
            nexus.hub().send(player);
            return;
        }

        next(player, course + 1, course);
    }

    /**
     * Straight on to the next course, after a moment to read the time.
     *
     * Being returned to the lobby after every course made climbing the ladder a
     * walk back to a bot and a menu, five times over. The dropper already
     * chains its shafts; this is the same idea and the same delay.
     *
     * Four seconds rather than immediately, because the number you just set is
     * the point of having run it, and because it has to be possible to stop -
     * anybody who has had enough types /hub in that window.
     */
    private void next(Player player, int course, int from) {
        Course shape = Course.of(course);

        player.sendMessage(Component.empty());
        player.sendMessage(Component.text("  Next: ", NamedTextColor.GRAY)
                .append(Component.text(shape.name(), Text.BRAND))
                .append(Component.text("   " + shape.blurb(), NamedTextColor.DARK_GRAY)));

        player.sendMessage(Component.text("  /hub", NamedTextColor.YELLOW)
                .clickEvent(net.kyori.adventure.text.event.ClickEvent.runCommand("/hub"))
                .append(Component.text(" to stop, or ", NamedTextColor.DARK_GRAY))
                .append(Component.text("/parkour " + (from + 1), NamedTextColor.YELLOW)
                        .clickEvent(net.kyori.adventure.text.event.ClickEvent
                                .runCommand("/parkour " + (from + 1))))
                .append(Component.text(" to run that one again.", NamedTextColor.DARK_GRAY)));

        nexus.getServer().getScheduler().runTaskLater(nexus, () -> {
            /*
             * Checked when it fires, not when it was scheduled.
             *
             * Four seconds is long enough to leave, and dragging somebody back
             * onto a course they have just walked away from is exactly the bug
             * the dropper had.
             */
            if (!player.isOnline()) return;
            if (world == null || !player.getWorld().equals(world)) return;
            if (running(player.getUniqueId())) return;

            begin(player, course);
        }, 80L);
    }

    public static String time(int seconds) {
        return String.format("%d:%02d", seconds / 60, seconds % 60);
    }

    /** For the self test: that every course was actually built. */
    public int builtCourses() {
        return steps.size();
    }

    /** Where a course ends, for the check and for going to look at it. */
    public Location finishOf(int course) {
        List<Location> jumps = steps.get(course);
        return jumps == null || jumps.isEmpty() ? null
                : jumps.get(jumps.size() - 1).clone();
    }

    /**
     * Whether the last step has a landing pad under it.
     *
     * Without one a course does not end - it stops, and the jump after the
     * last one is into nothing. That would read as the course chaining being
     * broken rather than as the course being unfinished, which is why it is
     * worth checking here rather than finding out at the far end of a hundred
     * jumps.
     */
    public boolean landsSafely(int course) {
        Location finish = finishOf(course);
        if (finish == null) return false;

        return world.getBlockAt(finish.getBlockX(), finish.getBlockY() - 1,
                finish.getBlockZ()).getType() == Material.GOLD_BLOCK;
    }

    /**
     * Every jump measured against what a player can physically do.
     *
     * The generator chooses a gap in whole blocks and then walks that far along
     * a heading in floating point; the block it lands on is that position
     * rounded to integers, and rounding can push the landing up to about 1.4
     * blocks further out than the gap that was asked for. A course written with
     * a longest jump of four can therefore contain a jump of five, and nobody
     * can make a jump of five.
     *
     * It is worth measuring rather than reasoning about because the symptom is
     * a player standing in front of a gap they cannot cross, unable to tell
     * whether the course is broken or they are.
     *
     * The limits are a sprinting player's real reach: 4.3 blocks flat, 3.4 with
     * a block of rise, and 4.8 dropping - falling buys distance.
     */
    public String selfTest() {
        world();

        for (int course = 0; course < Course.count(); course++) {
            List<Location> jumps = steps.get(course);

            if (jumps == null || jumps.size() != Course.of(course).jumps()) {
                return Course.of(course).name() + " built "
                        + (jumps == null ? 0 : jumps.size()) + " of "
                        + Course.of(course).jumps() + " jumps";
            }

            for (int i = 1; i < jumps.size(); i++) {
                double flat = blockGap(jumps, i);

                int rise = jumps.get(i).getBlockY() - jumps.get(i - 1).getBlockY();
                double reach = rise > 0 ? REACH_UP : rise < 0 ? REACH_DOWN : REACH_FLAT;

                if (flat > reach) {
                    return String.format(
                            "%s jump %d is %.1f blocks with a rise of %d, and %.1f is the limit",
                            Course.of(course).name(), i, flat, rise, reach);
                }
            }
        }
        return "ok";
    }

    /**
     * The distance between two landing BLOCKS, which is what is jumped.
     *
     * Measured from the block coordinates rather than the positions the
     * generator walked through. Those positions are exactly the gap it chose -
     * measuring them tells you what the generator meant, not what it built, and
     * the difference between the two is the entire failure being looked for.
     */
    private double blockGap(List<Location> jumps, int i) {
        Location from = jumps.get(i - 1);
        Location to = jumps.get(i);

        return Math.hypot(to.getBlockX() - from.getBlockX(),
                to.getBlockZ() - from.getBlockZ());
    }

    /** The longest jump on each course, for the report. */
    public double longestJump(int course) {
        List<Location> jumps = steps.get(course);
        if (jumps == null) return 0;

        double longest = 0;
        for (int i = 1; i < jumps.size(); i++) {
            longest = Math.max(longest, blockGap(jumps, i));
        }
        return longest;
    }

    public int jumpsIn(int course) {
        List<Location> jumps = steps.get(course);
        return jumps == null ? 0 : jumps.size();
    }
}
