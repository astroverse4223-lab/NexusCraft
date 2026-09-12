package dev.nexuscraft.nexus;

import net.kyori.adventure.bossbar.BossBar;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.title.Title;
import org.bukkit.Location;
import org.bukkit.Sound;
import org.bukkit.World;
import org.bukkit.attribute.Attribute;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;
import org.bukkit.entity.Ravager;
import org.bukkit.potion.PotionEffect;
import org.bukkit.potion.PotionEffectType;

import java.time.Duration;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * A thing that turns up on a clock and needs everybody.
 *
 * Nothing else on this server asks two people to be in the same place at the
 * same time. Every loop - digging, mining, questing, islands - is one person
 * and a number, and a server made entirely of those feels empty however many
 * people are on it. A boss with more health than anyone can chew through alone,
 * arriving at an hour everybody knows, is the cheapest way to make being online
 * together worth something.
 *
 * Paid out by damage share rather than last hit, because a boss that rewards
 * the killing blow teaches everybody to stand back and wait.
 */
public final class Boss {

    /** How often it comes back, unless the config says otherwise. */
    private static final int DEFAULT_HOURS = 1;

    /** Health before anybody is counted, and what each player adds. */
    private static final double BASE_HEALTH = 400;
    private static final double PER_PLAYER = 220;

    /** Given up on after this long, so a boss nobody fights does not stand forever. */
    private static final long PATIENCE_MS = 15 * 60 * 1000L;

    /** What the whole fight is worth, split by damage done. */
    private static final double PURSE = 40_000;

    /** Said at these many seconds out, once each. */
    private static final long[] WARN_AT = { 1800L, 600L, 60L };

    private final Nexus nexus;

    private LivingEntity alive;
    private BossBar bar;
    private long spawnedAt;

    /** Who hurt it and how much, which is the whole payout. */
    private final Map<UUID, Double> damage = new LinkedHashMap<>();

    /**
     * The waves, at what is left of its health.
     *
     * On the way down rather than on a timer, so a fight that goes badly gets
     * no easier and a fight that goes well is not padded out. Somebody who
     * brought six friends reaches the last wave faster, which is the right way
     * round - it is the reward for the friends.
     */
    private static final int[] WAVE_AT = { 75, 50, 25 };

    /** Which waves have already come, so each arrives once. */
    private final java.util.Set<Integer> waved = new java.util.HashSet<>();

    /** Everything it called up, so none of it is left standing afterwards. */
    private final java.util.List<UUID> minions = new java.util.ArrayList<>();

    /** How far from the boss they appear. Inside the arena wall, well inside. */
    private static final int WAVE_SPREAD = 8;

    private final java.util.Set<Long> warned = new java.util.HashSet<>();

    public Boss(Nexus nexus) {
        this.nexus = nexus;
    }

    /* ----------------------------------------------------------- the clock */

    private int everyHours() {
        return Math.max(1, nexus.getConfig().getInt("bossEveryHours", DEFAULT_HOURS));
    }

    /**
     * When it next arrives.
     *
     * Stored rather than computed from uptime, so restarting the server does
     * not push the fight back and nobody has to guess whether they missed it.
     */
    public long nextAt() {
        long stored = nexus.getConfig().getLong("bossNextAt", 0L);

        if (stored <= 0L) {
            stored = System.currentTimeMillis() + everyHours() * 3600_000L;
            nexus.getConfig().set("bossNextAt", stored);
            nexus.saveConfig();
        }

        return stored;
    }

    private void scheduleNext() {
        nexus.getConfig().set("bossNextAt", System.currentTimeMillis() + everyHours() * 3600_000L);
        nexus.saveConfig();
        warned.clear();
    }

    public long secondsUntil() {
        return Math.max(0L, (nextAt() - System.currentTimeMillis()) / 1000L);
    }

    public boolean fighting() {
        return alive != null && !alive.isDead();
    }

    /** Where it stands. Set with /nexus setboss, or the survival spawn. */
    private Location where() {
        World world = nexus.worlds().of(Worlds.Place.SURVIVAL);
        if (world == null) return null;

        Location chosen = nexus.settings().spotAt("boss", world);
        return chosen != null ? chosen : world.getSpawnLocation();
    }

    /**
     * How far round the boss spot is the arena's, and nobody else's.
     *
     * The blueprint is forty blocks across, so twenty-four covers it with a
     * little outside the seating. Generous on purpose: an arena somebody can
     * mine the back row of is an arena with a hole in it a week later.
     */
    private static final int KEEP = 24;

    /**
     * Whether that block is part of the arena.
     *
     * Server furniture rather than somebody's build, so it is protected by
     * being the arena and not by anybody having claimed it. A claim would have
     * done the job, but it would have been one player's land, spent out of
     * their allowance, and open again the day they released it.
     */
    public boolean guards(Player player, org.bukkit.block.Block block) {
        if (block == null) return false;

        /*
         * Build mode, and nothing else. Operators included.
         *
         * Exempting admins outright meant the one person who wanted to test the
         * protection was the one person it never applied to - and it left the
         * arena a stray click away from a hole in the floor for whoever was
         * carrying a pickaxe with op. The lobby has always worked this way:
         * being allowed to change it is a mode you turn on, not a rank you hold.
         */
        if (nexus.hub().isBuilding(player.getUniqueId())) return false;

        World survival = nexus.worlds().of(Worlds.Place.SURVIVAL);
        if (survival == null || !block.getWorld().equals(survival)) return false;

        Location spot = nexus.settings().spotAt("boss", survival);
        if (spot == null) return false;

        int dx = Math.abs(block.getX() - spot.getBlockX());
        int dz = Math.abs(block.getZ() - spot.getBlockZ());

        // A square rather than a circle: cheaper, and the seating is square
        // enough at the corners that nobody will notice the difference.
        if (dx > KEEP || dz > KEEP) return false;

        // Only around the arena's own height. Somebody mining an ore vein
        // forty blocks underneath it is not touching the arena.
        int dy = block.getY() - spot.getBlockY();
        return dy >= -4 && dy <= 24;
    }

    /**
     * Whether the arena refuses to let something spawn there on its own.
     *
     * A boss arena wants exactly two kinds of mob in it: the boss, and what the
     * boss calls up. Anything else wandering in is noise during a fight and a
     * hazard between them - a creeper that spawns in an unlit arena overnight
     * takes a piece of the floor with it, and the floor is the thing everybody
     * agreed nobody was allowed to break.
     *
     * Which also means the arena can be roofed and dark without that being a
     * mistake, rather than only if somebody remembers to light every corner.
     */
    public boolean refusesSpawn(Location at) {
        if (at == null) return false;

        World survival = nexus.worlds().of(Worlds.Place.SURVIVAL);
        if (survival == null || !at.getWorld().equals(survival)) return false;

        Location spot = nexus.settings().spotAt("boss", survival);
        if (spot == null) return false;

        int dx = Math.abs(at.getBlockX() - spot.getBlockX());
        int dz = Math.abs(at.getBlockZ() - spot.getBlockZ());

        if (dx > KEEP || dz > KEEP) return false;

        int dy = at.getBlockY() - spot.getBlockY();
        return dy >= -4 && dy <= 24;
    }

    /* ------------------------------------------------------------- the tick */

    /** Once a minute: warn, arrive, and give up on a fight nobody came to. */
    public void tick() {
        if (fighting()) {
            if (System.currentTimeMillis() - spawnedAt > PATIENCE_MS) {
                giveUp();
                return;
            }

            /*
             * What it summoned goes when the fight does.
             *
             * Minions outlive the moment they were called for: somebody takes
             * the Warden to half health, leaves, and a pack of vindicators is
             * still standing in the arena an hour later when the next one
             * rises. Nobody within sight of it means nobody is fighting it, and
             * nothing it called up has any reason to still be there.
             */
            if (!minions.isEmpty() && !anybodyNear()) clearMinions();

            showBar();
            return;
        }

        // A dead reference left over from a fight that ended some other way.
        if (alive != null) clear();

        long left = secondsUntil();

        if (left <= 0L) {
            arrive();
            return;
        }

        for (long mark : WARN_AT) {
            if (left > mark || warned.contains(mark)) continue;

            warned.add(mark);
            nexus.feed().say(Feed.Weight.BIG,
                    "The Warden of the Deep arrives in " + Text.roughly((int) left) + ".");
            break;
        }
    }

    /* ---------------------------------------------------------- the arrival */

    private void arrive() {
        /*
         * The clock moves on first, whatever happens next.
         *
         * It used to be reset only when a fight ended, so a rise that did not
         * take - nowhere to stand, a ravager that suffocated the instant it
         * appeared - left the appointment in the past. Every tick after that
         * saw a boss that was due and not alive, and announced another one. A
         * minute apart, forever. Scheduling before the attempt makes one
         * failed rise cost one hour, not the rest of the day.
         */
        scheduleNext();

        Location at = where();

        if (at == null) {
            nexus.getLogger().warning("no survival world for the boss; trying again later");
            return;
        }

        int here = nexus.getServer().getOnlinePlayers().size();
        double health = BASE_HEALTH + PER_PLAYER * Math.max(1, here);

        Ravager boss = at.getWorld().spawn(at, Ravager.class);

        boss.customName(Component.text("Warden of the Deep", NamedTextColor.DARK_RED));
        boss.setCustomNameVisible(true);
        boss.getScoreboardTags().add(BOSS_TAG);
        boss.setRemoveWhenFarAway(false);
        boss.setPersistent(true);

        var maxHealth = boss.getAttribute(Attribute.MAX_HEALTH);
        if (maxHealth != null) maxHealth.setBaseValue(health);
        boss.setHealth(health);

        // Slow and heavy rather than fast and lethal: a boss that outruns
        // everybody is a boss nobody can fight together.
        boss.addPotionEffect(new PotionEffect(PotionEffectType.SLOWNESS, Integer.MAX_VALUE, 1, false, false));
        boss.addPotionEffect(new PotionEffect(PotionEffectType.RESISTANCE, Integer.MAX_VALUE, 1, false, false));

        // Whatever it is made of, the weather is not what finishes it.
        boss.addPotionEffect(new PotionEffect(
                PotionEffectType.FIRE_RESISTANCE, Integer.MAX_VALUE, 0, false, false));

        alive = boss;
        spawnedAt = System.currentTimeMillis();
        damage.clear();
        waved.clear();
        minions.clear();

        bar = BossBar.bossBar(Component.text("Warden of the Deep", NamedTextColor.RED),
                1f, BossBar.Color.RED, BossBar.Overlay.NOTCHED_20);

        nexus.feed().say(Feed.Weight.BIG, "The Warden of the Deep has risen in the survival world.");

        for (Player player : nexus.getServer().getOnlinePlayers()) {
            player.showTitle(Title.title(
                    Component.text("THE WARDEN HAS RISEN", NamedTextColor.DARK_RED),
                    Component.text("Survival world  ·  /warp survival", NamedTextColor.GRAY),
                    Title.Times.times(Duration.ofMillis(400), Duration.ofSeconds(4),
                            Duration.ofMillis(800))));

            player.playSound(player, Sound.ENTITY_WARDEN_EMERGE, 1f, 0.7f);
        }

        showBar();
    }

    /* ------------------------------------------------------------ the fight */

    /** Somebody hit it. Recorded, because the purse is split by this. */
    public void hurt(Player player, double amount) {
        if (!fighting() || amount <= 0) return;

        damage.merge(player.getUniqueId(), amount, Double::sum);
        showBar();

        /*
         * Checked here rather than in the tick.
         *
         * The tick runs once a minute, which is long enough for a group to take
         * it from full to dead without a single wave arriving. Every hit is the
         * only place that reliably sees the health it is reacting to.
         */
        var maxHealth = alive.getAttribute(Attribute.MAX_HEALTH);
        if (maxHealth == null) return;

        int left = (int) Math.round(alive.getHealth() / maxHealth.getBaseValue() * 100);

        for (int mark : WAVE_AT) {
            if (left > mark || waved.contains(mark)) continue;

            waved.add(mark);
            wave(mark);
            break;
        }
    }

    /**
     * What arrives when it drops past a mark.
     *
     * Worse each time, and more of it the more people are there - a wave sized
     * for one person is scenery to eight of them.
     */
    private void wave(int mark) {
        World world = alive.getWorld();
        int here = Math.max(1, world.getPlayers().size());

        int many;
        Class<? extends org.bukkit.entity.Mob> kind;
        String called;

        if (mark >= 75) {
            many = 2 + here;
            kind = org.bukkit.entity.Pillager.class;
            called = "pillagers";
        } else if (mark >= 50) {
            many = 2 + here;
            kind = org.bukkit.entity.Vindicator.class;
            called = "vindicators";
        } else {
            many = 1 + here;
            kind = org.bukkit.entity.Witch.class;
            called = "witches";

            /*
             * And it stops being slow.
             *
             * It has been deliberately sluggish all fight so a group could
             * surround it. At a quarter left that stops being fair on the
             * group and starts being the reason nobody is worried.
             */
            alive.removePotionEffect(PotionEffectType.SLOWNESS);
            alive.addPotionEffect(new PotionEffect(
                    PotionEffectType.SPEED, Integer.MAX_VALUE, 1, false, false));
        }

        for (int i = 0; i < many; i++) {
            double angle = 2 * Math.PI * i / many;

            Location at = alive.getLocation().clone().add(
                    Math.cos(angle) * WAVE_SPREAD, 0, Math.sin(angle) * WAVE_SPREAD);

            // Up to the surface if the ring put one inside the floor.
            at.setY(world.getHighestBlockYAt(at) + 1);

            try {
                org.bukkit.entity.Mob minion = world.spawn(at, kind);
                minion.setRemoveWhenFarAway(false);
                minion.getScoreboardTags().add(MINION_TAG);

                /*
                 * Nothing the sun can do about them.
                 *
                 * The illagers spawned here do not burn in daylight anyway -
                 * only the undead do - but that is a fact about the mobs
                 * chosen today, and a wave that quietly dies at dawn because
                 * somebody swapped a pillager for a husk is a boss fight that
                 * ends itself. Fire resistance costs nothing and holds for any
                 * mob that ever gets used here.
                 */
                minion.addPotionEffect(new PotionEffect(
                        PotionEffectType.FIRE_RESISTANCE, Integer.MAX_VALUE, 0, false, false));

                minions.add(minion.getUniqueId());
            } catch (IllegalArgumentException refused) {
                // Nowhere to stand is one fewer minion, not a broken fight.
                nexus.getLogger().warning("could not place a minion: " + refused.getMessage());
            }
        }

        nexus.feed().say(Feed.Weight.BIG,
                "The Warden called up " + many + " " + called + ".");

        /*
         * A title for the people in the fight, not just a line of chat.
         *
         * A wave arriving is the moment the fight changes, and a grey line in
         * a chat box somebody is not reading during a fight is not how you
         * tell them. The last one says so louder, because the Warden stops
         * being slow at the same moment and that is worth knowing before it
         * reaches you.
         */
        boolean last = mark <= 25;

        for (Player player : world.getPlayers()) {
            player.playSound(player, Sound.ENTITY_EVOKER_PREPARE_SUMMON, 1f, 0.8f);

            player.showTitle(Title.title(
                    Component.text(last ? "IT IS ANGRY" : called.toUpperCase(java.util.Locale.ROOT),
                            NamedTextColor.RED),
                    Component.text(last
                            ? "The Warden is no longer slow"
                            : mark + "% left  -  " + many + " " + called,
                            NamedTextColor.GRAY),
                    Title.Times.times(Duration.ofMillis(250), Duration.ofSeconds(2),
                            Duration.ofMillis(600))));
        }
    }

    /** Whether anybody is close enough to count as fighting it. */
    private boolean anybodyNear() {
        if (alive == null) return false;

        for (Player player : alive.getWorld().getPlayers()) {
            if (player.getLocation().distanceSquared(alive.getLocation()) <= 64 * 64) return true;
        }

        return false;
    }

    /**
     * Anything left over from a fight the server did not see the end of.
     *
     * A crash or a hard stop leaves whatever was summoned standing, and it is
     * persistent and does not despawn on its own - so without this, every
     * unclean shutdown adds another pack of vindicators to the arena forever.
     */
    public void sweep() {
        World survival = nexus.worlds().of(Worlds.Place.SURVIVAL);
        if (survival == null) return;

        int minionsGone = 0;
        int wardensGone = 0;

        for (org.bukkit.entity.Entity entity : survival.getEntities()) {
            var tags = entity.getScoreboardTags();

            if (tags.contains(MINION_TAG)) {
                entity.remove();
                minionsGone++;
                continue;
            }

            /*
             * Any Warden standing here at startup is left over.
             *
             * Nobody is mid-fight through a restart - everyone was
             * disconnected - so there is no fight to preserve, and the clock
             * decides when the next one rises. Leaving them was what put ten of
             * them in the arena.
             */
            if (tags.contains(BOSS_TAG)) {
                entity.remove();
                wardensGone++;
            }
        }

        if (minionsGone > 0) {
            nexus.getLogger().info("cleared " + minionsGone + " leftover boss minions");
        }

        if (wardensGone > 0) {
            nexus.getLogger().info("cleared " + wardensGone + " leftover Warden(s)");
        }
    }

    /**
     * Sends every Warden away, the one being fought included.
     *
     * There was no way to do this at all: the fight ended when somebody won it
     * or when nobody turned up for long enough, and an operator watching a boss
     * he did not want had to go and kill it by hand - which for a ravager with
     * four hundred health and resistance is not a short job.
     *
     * Deliberately not fussy about which is which. An earlier version skipped
     * the live one on the grounds that it was wanted, and the result was a
     * command that could not do the thing its name promised.
     *
     * The clock moves on, so sending one away does not leave an appointment in
     * the past for the next tick to act on.
     */
    public int dismiss() {
        int gone = 0;

        if (alive != null && !alive.isDead()) {
            alive.remove();
            gone++;
        }

        World survival = nexus.worlds().of(Worlds.Place.SURVIVAL);

        if (survival != null) {
            for (org.bukkit.entity.Entity entity : survival.getEntities()) {
                if (!entity.getScoreboardTags().contains(BOSS_TAG)) continue;

                entity.remove();
                gone++;
            }
        }

        clear();
        scheduleNext();

        return gone;
    }

    /**
     * Brings it now, whatever the clock says.
     *
     * For an operator who wants to see the fight rather than wait for it -
     * and the clock is reset afterwards, so starting one by hand does not
     * mean two arriving back to back.
     */
    public boolean startNow(org.bukkit.command.CommandSender asker) {
        if (fighting()) {
            asker.sendMessage(Text.says("The Warden is already up."));
            return false;
        }

        // arrive() moves the clock on by itself, so starting one by hand does
        // not leave two due at once.
        arrive();

        return fighting();
    }

    /** Tagged so they can be cleared away whatever happens to the fight. */
    public static final String MINION_TAG = "nexus_warden_minion";

    /**
     * And the Warden itself, for the same reason.
     *
     * It is spawned persistent and told not to despawn when nobody is near,
     * which is right during a fight and is exactly what makes it outlive a
     * crash. `alive` is a field, so a restart forgets it while the ravager
     * stands there - and the next time the clock came round the plugin saw no
     * boss and raised another. One per restart, standing in a row.
     */
    public static final String BOSS_TAG = "nexus_warden";

    /** Everything it called up, taken away with it. */
    private void clearMinions() {
        for (UUID id : minions) {
            org.bukkit.entity.Entity found = nexus.getServer().getEntity(id);
            if (found != null && !found.isDead()) found.remove();
        }

        minions.clear();
        waved.clear();
    }

    /** Whether that entity is the boss, so the listener knows to care. */
    public boolean is(org.bukkit.entity.Entity entity) {
        return alive != null && entity != null && entity.getUniqueId().equals(alive.getUniqueId());
    }

    private void showBar() {
        if (bar == null || !fighting()) return;

        var maxHealth = alive.getAttribute(Attribute.MAX_HEALTH);
        double max = maxHealth == null ? 1 : maxHealth.getBaseValue();

        int left = (int) Math.round(alive.getHealth() / max * 100);

        /*
         * What is coming, and how far off it is.
         *
         * The waves land on health rather than a clock, so the only way to see
         * one coming was to watch the numbers and do the arithmetic mid-fight.
         * Naming the next mark on the bar turns that into something you can
         * glance at - and the twenty notches below are set so 75, 50 and 25
         * fall exactly on a division rather than somewhere inside one.
         */
        Component next = Component.empty();

        for (int mark : WAVE_AT) {
            if (waved.contains(mark) || left <= mark) continue;

            next = Component.text("   next wave at " + mark + "%",
                    NamedTextColor.YELLOW);
            break;
        }

        bar.progress((float) Math.max(0, Math.min(1, alive.getHealth() / max)));
        bar.name(Component.text("Warden of the Deep  ", NamedTextColor.RED)
                .append(Component.text(left + "%", NamedTextColor.WHITE))
                .append(Component.text("   " + damage.size() + " fighting",
                        NamedTextColor.DARK_GRAY))
                .append(next));

        World world = alive.getWorld();
        for (Player player : world.getPlayers()) player.showBossBar(bar);
    }

    /** It died. Everybody who hurt it gets a share of the purse. */
    public void killed() {
        if (damage.isEmpty()) {
            nexus.feed().say(Feed.Weight.BIG, "The Warden of the Deep fell, with nobody to claim it.");
            clear();
            scheduleNext();
            return;
        }

        double total = damage.values().stream().mapToDouble(Double::doubleValue).sum();

        UUID best = null;
        double most = 0;

        Map<UUID, Double> paid = new HashMap<>(damage);

        for (Map.Entry<UUID, Double> entry : paid.entrySet()) {
            double share = entry.getValue() / total;
            double money = PURSE * share;

            nexus.stats().pay(entry.getKey(), money);

            Player player = nexus.getServer().getPlayer(entry.getKey());
            if (player != null) {
                player.sendMessage(Text.good("The Warden fell. Your share: "
                        + Stats.cash(money) + "."));
                player.sendMessage(Text.plain("  You did " + Math.round(share * 100)
                        + "% of the damage."));
                player.playSound(player, Sound.UI_TOAST_CHALLENGE_COMPLETE, 1f, 1f);
            }

            if (entry.getValue() > most) {
                most = entry.getValue();
                best = entry.getKey();
            }
        }

        String top = best == null ? "somebody"
                : String.valueOf(nexus.getServer().getOfflinePlayer(best).getName());

        /*
         * Something only he drops.
         *
         * The purse is split by damage, which is fair and completely
         * forgettable - money from a boss spends the same as money from a
         * pumpkin farm. A set of armour nobody can craft is the thing people
         * come back for, and it goes to whoever hit hardest rather than being
         * split four ways into nothing.
         */
        String set = nexus.armoury().dropSet("boss");
        Player winner = best == null ? null : nexus.getServer().getPlayer(best);

        if (set != null && winner != null && nexus.armoury().give(winner, set)) {
            nexus.feed().say(Feed.Weight.BIG, top + " took the "
                    + nexus.armoury().get(set).label() + " set from the Warden.");
        }

        nexus.feed().say(Feed.Weight.BIG, "The Warden of the Deep was killed by "
                + paid.size() + (paid.size() == 1 ? " player" : " players")
                + ", led by " + top + ".");

        nexus.stats().save();
        clear();
        scheduleNext();
    }

    private void giveUp() {
        nexus.feed().say(Feed.Weight.NOTE, "The Warden of the Deep sank back into the ground.");

        if (alive != null) alive.remove();
        clear();
        scheduleNext();
    }

    private void clear() {
        clearMinions();

        if (bar != null) {
            for (Player player : nexus.getServer().getOnlinePlayers()) player.hideBossBar(bar);
            bar = null;
        }

        alive = null;
        damage.clear();
    }

    /** Taken away when the plugin stops, so it is not left standing. */
    public void shutdown() {
        if (alive != null && !alive.isDead()) alive.remove();
        clear();
    }

    /**
     * Takes somebody to the arena.
     *
     * Through the world system first, exactly as the warps do: a raw teleport
     * into survival carries whatever the player was holding in the lobby with
     * them, and the world change is what closes that hole.
     */
    public void go(Player player) {
        World survival = nexus.worlds().of(Worlds.Place.SURVIVAL);

        if (survival == null) {
            player.sendMessage(Text.bad("The survival world is not loaded."));
            return;
        }

        Location spot = nexus.settings().spotAt("boss", survival);

        if (spot == null) {
            player.sendMessage(Text.bad("Nobody has said where the arena is yet."));
            player.sendMessage(Text.plain("  An operator sets it with /nexus setboss."));
            return;
        }

        if (nexus.worlds().placeOf(player) != Worlds.Place.SURVIVAL) {
            nexus.worlds().send(player, Worlds.Place.SURVIVAL);
        }

        player.teleport(spot);
        player.playSound(player, Sound.ENTITY_ENDERMAN_TELEPORT, 0.6f, 1.4f);

        if (fighting()) {
            player.sendMessage(Text.good("The Warden is up. Good luck."));
        } else {
            player.sendMessage(Text.says("The arena. Next one in "
                    + Text.roughly((int) secondsUntil()) + "."));
        }
    }

    /* -------------------------------------------------------------- telling */

    public void show(org.bukkit.command.CommandSender asker) {
        asker.sendMessage(Text.heading("The Warden of the Deep"));

        if (fighting()) {
            var maxHealth = alive.getAttribute(Attribute.MAX_HEALTH);
            double max = maxHealth == null ? 1 : maxHealth.getBaseValue();

            asker.sendMessage(Text.field("Right now",
                    "fighting  " + Math.round(alive.getHealth()) + " / " + Math.round(max)));
            asker.sendMessage(Text.field("Fighting it", String.valueOf(damage.size())));
            asker.sendMessage(Text.plain("  /boss go to get there."));
            return;
        }

        asker.sendMessage(Text.field("Next", Text.roughly((int) secondsUntil())));
        asker.sendMessage(Text.field("Purse", Stats.cash(PURSE) + ", split by damage"));
        asker.sendMessage(Component.empty());
        asker.sendMessage(Text.plain("  It has more health than one person can get through."));
        asker.sendMessage(Text.plain("  Everybody who hurts it is paid, not just whoever lands the last hit."));
        asker.sendMessage(Text.plain("  /boss go takes you to the arena."));
    }
}
