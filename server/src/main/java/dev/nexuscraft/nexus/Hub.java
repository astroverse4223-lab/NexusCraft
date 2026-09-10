package dev.nexuscraft.nexus;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Bukkit;
import org.bukkit.Color;
import org.bukkit.GameMode;
import org.bukkit.GameRule;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.WorldCreator;
import org.bukkit.attribute.Attribute;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.ItemMeta;
import org.bukkit.potion.PotionEffect;
import org.bukkit.potion.PotionEffectType;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Where everybody stands between games.
 *
 * The hub is the server's front door and it does three jobs: it puts you
 * somewhere safe, it tells you who you are, and it gets you into a game in one
 * click. Anything else it does is decoration, and decoration in the hub is how
 * a server ends up with a lag spike on the one world everybody is standing in.
 *
 * It builds its own world rather than using the server's spawn. A hub that
 * paves over whatever world the operator already had is a hub that cannot be
 * installed on an existing server, and "install this on a fresh server or lose
 * your map" is not a plugin anybody keeps.
 */
public final class Hub {

    /** The selector goes in the middle of the bar, where the eye lands. */
    private static final int SELECTOR_SLOT = 4;

    private final Nexus nexus;
    private final Map<UUID, Sidebar> boards = new HashMap<>();

    /**
     * Operators who have switched the lobby protection off for themselves.
     *
     * Held in memory rather than saved, deliberately. Build mode is a thing you
     * turn on to do a job; one that survives a restart is one somebody leaves
     * on for a month and then wonders why the lobby has a dirt tower in it.
     */
    private final java.util.Set<UUID> building = new java.util.HashSet<>();
    private boolean buildersLoaded;

    private World world;

    public Hub(Nexus nexus) {
        this.nexus = nexus;
    }

    /** The hub world, or null if it is not built yet. Never creates it. */
    public World worldIfReady() {
        return world;
    }

    public World world() {
        if (world == null) buildWorld();
        return world;
    }

    public Location spawn() {
        World hub = world();

        /*
         * Where to land, in order of preference.
         *
         * Configured first. Then, for somebody else's build, that world's own
         * spawn — never our castle's arrival point, which is a coordinate in a
         * layout that build does not have. Sending people there put them inside
         * solid stone, unable to move, with no way out but a command they had
         * not been told about.
         */
        Location fallback = nexus.settings().customSpawn()
                ? hub.getSpawnLocation().add(0.5, 0, 0.5)
                : Castle.arrival(hub);

        return standable(nexus.settings().hubSpawn(hub, fallback));
    }

    /** Midday, which is when a lobby looks like it was meant to. */
    private static final long DAY = 6000;

    /**
     * Puts the sky back to noon and clear.
     *
     * The gamerules were already off, which is why this looked done - but a
     * frozen clock only freezes whatever it was showing. A hub world saved
     * during a storm loads still storming, and with DO_WEATHER_CYCLE off it
     * then rains in the lobby forever with nothing to make it stop. The same
     * goes for the time: turning the cycle off at midnight locks in midnight.
     *
     * Called on load and then on a timer, so it is a lock rather than a
     * setting. An operator who runs /time set night in the lobby to look at
     * something gets a few seconds of it and then it is day again, which is
     * the behaviour somebody asking for a time lock is asking for.
     */
    public void holdSky() {
        World hub = worldIfReady();
        if (hub == null) return;

        if (hub.getTime() != DAY) hub.setTime(DAY);

        // Only when it is actually wrong. Setting clear weather every few
        // seconds regardless would send every player a packet for nothing.
        if (hub.hasStorm() || hub.isThundering()) {
            hub.setStorm(false);
            hub.setThundering(false);
        }

        if (hub.getClearWeatherDuration() < 20_000) {
            hub.setClearWeatherDuration(1_000_000);
        }
    }

    /**
     * Nudges a spawn upward until there is room to stand.
     *
     * A last defence rather than the main mechanism: whatever the coordinates
     * say, nobody should ever arrive embedded in a wall. Searches up from the
     * given point for two air blocks over something solid, and gives up
     * gracefully rather than looping — a spawn in open sky is survivable and
     * being stuck inside a block is not.
     */
    private Location standable(Location at) {
        World world = at.getWorld();
        if (world == null) return at;

        int top = Math.min(world.getMaxHeight() - 2, at.getBlockY() + 40);

        for (int y = at.getBlockY(); y <= top; y++) {
            Location trying = new Location(world, at.getX(), y, at.getZ(),
                    at.getYaw(), at.getPitch());

            boolean feet = trying.getBlock().isPassable();
            boolean head = trying.clone().add(0, 1, 0).getBlock().isPassable();
            boolean floor = !trying.clone().add(0, -1, 0).getBlock().isPassable();

            if (feet && head && floor) return trying;
        }

        // Nothing solid anywhere above: put them in the air rather than in
        // the rock, since falling is recoverable and suffocating is not.
        return at.clone().add(0, 2, 0);
    }

    /**
     * The lobby, built and populated.
     *
     * The build is generated (see {@link Spawn}) but nothing depends on that:
     * if a custom spawn is configured, the build is skipped entirely and only
     * the NPCs are placed, at the coordinates given. That is the whole point of
     * the split — somebody who pastes a town in with WorldEdit should not have
     * to fight this plugin to use it.
     */
    private void buildWorld() {
        String name = nexus.settings().hubWorldName();

        /*
         * An existing world is loaded as it is; only a new one is made empty.
         *
         * This matters for a downloaded lobby. Handing WorldCreator a void
         * generator for a world that already has chunks does not corrupt what
         * is there, but every chunk generated afterwards at the edges comes out
         * as void, so walking to the boundary of somebody's build drops you
         * into a hole that was not in their map.
         */
        java.io.File folder = new java.io.File(
                nexus.getServer().getWorldContainer(), name);
        boolean existing = new java.io.File(folder, "level.dat").isFile();

        WorldCreator creator = new WorldCreator(name);
        if (!existing) creator.generator(new Arena.Nothing()).generateStructures(false);

        World hub = creator.createWorld();
        if (hub == null) throw new IllegalStateException("could not load the hub world " + name);

        /*
         * Recorded here, before the gamerules and the build.
         *
         * createWorld loads chunks, and loading a chunk fires an event that
         * this plugin listens for — which asks for the hub world, finds the
         * field still empty, and starts building it a second time. It showed up
         * as the startup line printing twice; on a fresh server it would have
         * been a world generated twice over.
         */
        this.world = hub;

        if (existing) {
            nexus.getLogger().info("using the existing world '" + name + "' as the lobby");
        }

        hub.setGameRule(GameRule.DO_DAYLIGHT_CYCLE, false);
        hub.setGameRule(GameRule.DO_WEATHER_CYCLE, false);
        hub.setGameRule(GameRule.DO_MOB_SPAWNING, false);
        hub.setGameRule(GameRule.ANNOUNCE_ADVANCEMENTS, false);
        hub.setGameRule(GameRule.SHOW_DEATH_MESSAGES, false);

        /*
         * Random ticks off, which matters most for a build somebody bought.
         *
         * Leaves with no log near them decay on random ticks, and a decorative
         * tree in a lobby is usually leaves placed by hand with nothing holding
         * them up. Left on, a purchased build quietly loses its foliage over
         * the first few days and there is no single moment where anything went
         * wrong. Every build shop ships the same instruction with their maps
         * for exactly this reason; doing it here means nobody has to remember.
         *
         * It also stops grass spreading, crops growing and ice melting in the
         * lobby, none of which a lobby wants.
         */
        hub.setGameRule(GameRule.RANDOM_TICK_SPEED, 0);
        holdSky();
        // Only for the world we generate. Setting it on a downloaded lobby
        // overwrites where its builder put the spawn, which is the difference
        // between arriving at the gates and arriving inside a pillar.
        if (name.equals("nexus_hub")) {
            hub.setSpawnLocation(0, Castle.GROUND + 1, Castle.GROUND);
        }

        /*
         * Rebuilt whenever what is standing is older than what we ship.
         *
         * The test used to be "is the middle of the world empty", which is
         * right exactly once. An older lobby is not empty, so every upgrade
         * after the first left the old build in place and the new one was never
         * seen - the symptom being a player standing on last week's platform
         * wondering where the castle is. The fix offered at the time was
         * "delete the world folder", which is not a fix, it is a thing somebody
         * has to know.
         *
         * Only ever touches the world we made. A named world is somebody's own
         * build and is never written to, whatever else is set.
         */
        boolean ours = name.equals("nexus_hub");

        if (!nexus.settings().customSpawn() && ours
                && nexus.settings().builtVersion() < Castle.VERSION) {

            long began = System.currentTimeMillis();

            Castle castle = new Castle(hub);
            castle.clearOldLobby();
            castle.build();

            nexus.settings().setBuiltVersion(Castle.VERSION);
            nexus.getLogger().info("built the spawn castle in "
                    + (System.currentTimeMillis() - began) + "ms");
        }

    }

    /**
     * Where each gate goes, and what colour it is.
     *
     * Order matters — it is the order they are placed around the plaza, and the
     * order the configured NPC positions are read in.
     */
    /**
     * Somewhere you can go.
     *
     * One list, read by both the greeters in the courtyard and the compass
     * menu. Two lists is how a server ends up with a world you can reach from
     * an NPC and not from the menu, and nobody notices for a week.
     */
    public record Destination(String id, String name, String blurb, Material icon) {
    }

    /**
     * Greeters the lobby expects but nobody has placed.
     *
     * Only meaningful for a custom lobby, where an unplaced greeter is skipped
     * rather than guessed at. Named rather than counted, because "four are
     * missing" leaves you comparing two lists by hand.
     */
    public java.util.List<String> unplacedGreeters() {
        java.util.List<String> missing = new java.util.ArrayList<>();

        World hub = worldIfReady();
        if (hub == null || !nexus.settings().customSpawn()) return missing;

        for (Destination destination : DESTINATIONS) {
            if (nexus.settings().npcsAt(destination.id(), hub).isEmpty()) {
                missing.add(destination.id());
            }
        }
        return missing;
    }

    public static final Destination[] DESTINATIONS = {
            new Destination("survival", "Survival", "build something",
                    Material.GRASS_BLOCK),
            new Destination("prison", "Prison", "mine and climb",
                    Material.IRON_PICKAXE),
            new Destination("bedwars", "Bed Wars", "break their beds",
                    Material.RED_BED),
            new Destination("creative", "Creative", "no rules",
                    Material.BRICKS),
            new Destination("oneblock", "One Block", "everything from one block",
                    Material.MOSS_BLOCK),
            new Destination("skyblock", "Skyblock", "an island and a chest",
                    Material.OAK_SAPLING),
            new Destination("spleef", "Spleef", "dig the floor out",
                    Material.DIAMOND_SHOVEL),
            new Destination("tntrun", "TNT Run", "keep moving",
                    Material.TNT),
            new Destination("parkour", "Parkour", "beat your own time",
                    Material.QUARTZ_STAIRS),
            new Destination("dropper", "Dropper", "fall, do not land",
                    Material.WATER_BUCKET),
            new Destination("arena", "Mob Arena", "ten waves and a boss",
                    Material.NETHERITE_AXE),
            new Destination("buildbattle", "Build Battle", "one word, ten minutes",
                    Material.CRAFTING_TABLE),
            new Destination("digsite", "Dig Site", "dig, sell, buy a bigger pack",
                    Material.IRON_SHOVEL),
            new Destination("murder", "Murder Mystery", "one knife, and no idea who",
                    Material.SHEARS),
            new Destination("hideandseek", "Hide and Seek", "thirty seconds, then they look",
                    Material.OAK_LEAVES),
            new Destination("sumo", "Sumo", "push them off",
                    Material.STICK),
            new Destination("duels", "Duels", "same kit, one winner",
                    Material.IRON_SWORD),
            new Destination("skywars", "Skywars", "an island and a long drop",
                    Material.END_STONE),
            new Destination("oitc", "One in the Chamber", "every arrow kills",
                    Material.ARROW),
    };

    /**
     * The people behind counters rather than in doorways.
     *
     * Kept apart from the destinations because they are placed, moved and
     * clicked by different code — and because a lobby wants its shops together
     * and its doorways spread out, which is a decision about where they go
     * rather than about what they are.
     */
    public record Service(String id, String name, String blurb, Material icon) {
    }

    public static final Service[] SERVICES = {
            new Service("shop", "Shopkeeper", "buy things", Material.EMERALD),
            new Service("sell", "Trader", "sell things", Material.GOLD_INGOT),
            new Service("crate_common", "Common Crate", "right click with a key",
                    Material.CHEST),
            new Service("crate_rare", "Rare Crate", "right click with a key",
                    Material.ENDER_CHEST),
            new Service("crate_legendary", "Legendary Crate", "right click with a key",
                    Material.SHULKER_BOX),
            new Service("vault", "Vault Keeper", "collect what is waiting",
                    Material.ENDER_CHEST),
            new Service("enchanter", "Enchanter", "pay to improve your gear",
                    Material.ENCHANTING_TABLE),
            new Service("cosmetics", "Wardrobe", "trails and hats",
                    Material.FIREWORK_ROCKET),
            new Service("jobs", "Job Board", "get paid for what you do",
                    Material.IRON_PICKAXE),
            new Service("trader", "Wandering Trader", "three deals a day",
                    Material.EMERALD_BLOCK),
            new Service("skins", "Skin Shop", "change how you look",
                    Material.PLAYER_HEAD),
    };

    private static final Color[] NPC_COLOURS = {
            Color.fromRGB(0x4CAF50), Color.fromRGB(0x424242),
            Color.fromRGB(0xC62828), Color.fromRGB(0x29B6F6),
    };

    private static final Material[] NPC_HEADS = {
            Material.PLAYER_HEAD, Material.PLAYER_HEAD, Material.PLAYER_HEAD, Material.PLAYER_HEAD,
    };



    /**
     * Stands the greeters in the plaza.
     *
     * Cleared and replaced rather than checked for, because armour stands are
     * not persistent here and a restart would otherwise leave a crowd.
     */
    public void placeNpcs() {
        World hub = world();
        Npc.clear(hub);
        place(null);
    }

    /**
     * Spawns the bots, either everywhere loaded or only inside one chunk.
     *
     * One method for both, because the two must agree about which bot belongs
     * where. Written separately, a chunk reloading would place a bot that the
     * startup pass had already put somewhere else, and the lobby would slowly
     * fill with strays nobody could account for.
     */
    private void place(org.bukkit.Chunk only) {
        World hub = world();

        for (int i = 0; i < DESTINATIONS.length; i++) {
            Destination destination = DESTINATIONS[i];

            /*
             * A portal stands in for the bot where there is one.
             *
             * Both would be two ways into the same world standing next to each
             * other, and somebody would reasonably assume they went to
             * different places.
             */
            if (nexus.portals().has(destination.id())) continue;

            var spots = nexus.settings().npcsAt(destination.id(), hub);

            /*
             * A guessed position is worse than no bot at all.
             *
             * The fallback is a spot in the generated castle's plaza, which is
             * the right answer for the generated lobby and a meaningless one in
             * a build somebody bought - those coordinates are as likely to be
             * inside a wall or under the sea. Unplaced greeters in a custom
             * lobby are left out, and `/nexus check` says which.
             */
            if (spots.isEmpty()) {
                if (nexus.settings().customSpawn()) continue;
                spots = java.util.List.of(defaultNpcSpot(hub, i));
            }

            for (Location at : spots) {
                if (!belongs(at, only)) continue;

                Npc.place(hub, at, destination.name(), destination.blurb(),
                        Npc.TO + destination.id(),
                        NPC_COLOURS[i % NPC_COLOURS.length], NPC_HEADS[i % NPC_HEADS.length],
                        destination.icon());
            }
        }

        for (int i = 0; i < SERVICES.length; i++) {
            Service service = SERVICES[i];

            // Behind the greeters by default, so an unplaced merchant is
            // somewhere findable rather than inside one of them.
            Location fallback = Castle.greeterSpot(hub, i, SERVICES.length).add(0, 0, -6);

            var spots = nexus.settings().npcsAt(service.id(), hub);
            if (spots.isEmpty()) spots = java.util.List.of(fallback);

            for (Location at : spots) {
                if (!belongs(at, only)) continue;

                Npc.place(hub, at, service.name(), service.blurb(),
                        Npc.OPENS + service.id(),
                        Color.fromRGB(0xFFB300), Material.PLAYER_HEAD, service.icon());
            }
        }
    }

    /**
     * Whether this position should be spawned right now.
     *
     * Given a chunk, only if it sits in that chunk. Given none, only if its
     * chunk is already loaded — spawning into an unloaded chunk would load it,
     * which is the force-loading this replaced arriving through the back door.
     */
    private boolean belongs(Location at, org.bukkit.Chunk only) {
        int cx = at.getBlockX() >> 4;
        int cz = at.getBlockZ() >> 4;

        if (only != null) return only.getX() == cx && only.getZ() == cz;
        return at.getWorld() != null && at.getWorld().isChunkLoaded(cx, cz);
    }

    /**
     * Puts back any bots belonging to a chunk that has just loaded.
     *
     * This is what replaced holding chunks open. Force-loading worked and does
     * not scale: a lobby using the whole map rather than one plaza would pin a
     * couple of hundred ticking chunks to keep twenty-one armour stands alive,
     * which is a lot of server to spend on scenery nobody is looking at.
     *
     * Spawning on load costs nothing instead. A bot in an unloaded chunk does
     * not exist, which is fine, because nobody is there to see it - and the
     * moment somebody walks over, the chunk loads and the bot is put back.
     */
    public void placeInChunk(org.bukkit.Chunk chunk) {
        if (!chunk.getWorld().equals(world())) return;

        // Anything of ours already in there goes first, so a chunk that loads
        // twice cannot end up with two of everything.
        for (var entity : chunk.getEntities()) {
            if (entity.getScoreboardTags().contains(Npc.TAG)) entity.remove();
        }

        place(chunk);
    }

    /**
     * How many people are at a destination right now.
     *
     * Two different questions behind one number. A world has players standing
     * in it; a minigame has players queued for it plus players already in a
     * match, and showing only the queue would say "0 waiting" while six people
     * are mid-game — which reads as nobody playing it.
     */
    public int countAt(String id) {
        for (Worlds.Place place : Worlds.Place.values()) {
            if (!place.name().equalsIgnoreCase(id)) continue;

            var world = nexus.getServer().getWorld(place.world);
            return world == null ? 0 : world.getPlayers().size();
        }

        Game game = nexus.games().byId(id);
        if (game != null) {
            int playing = 0;
            for (Match match : nexus.games().running()) {
                if (match.game().id().equals(id)) playing += match.players().size();
            }
            return nexus.games().waitingFor(id) + playing;
        }

        // Parkour and the dropper are worlds without a Place entry of their own.
        if (id.equals("parkour")) {
            var world = nexus.getServer().getWorld(Worlds.Place.PARKOUR.world);
            return world == null ? 0 : world.getPlayers().size();
        }
        if (id.equals("dropper")) {
            var world = nexus.getServer().getWorld(Worlds.Place.DROPPER.world);
            return world == null ? 0 : world.getPlayers().size();
        }

        return -1;
    }

    /**
     * Rewrites what floats over each bot, without respawning them.
     *
     * Respawning would be simpler and would make every nameplate in the lobby
     * blink several times a minute. Editing the name in place is invisible
     * except for the number changing, which is the point.
     */
    public void refreshNpcLabels() {
        World hub = world();

        for (var entity : hub.getEntities()) {
            String id = Npc.destinationOf(entity);
            if (id == null) continue;

            Destination destination = null;
            for (Destination candidate : DESTINATIONS) {
                if (candidate.id().equals(id)) destination = candidate;
            }
            if (destination == null) continue;

            entity.customName(Npc.label(destination.name(), countAt(id)));
        }
    }

    /** Every id that can be given a position, for the command that does it. */
    /**
     * The id behind whatever somebody typed.
     *
     * Fifteen of the thirty bots have an id that is not the name floating over
     * their head: the one labelled Wardrobe is `cosmetics`, Mob Arena is
     * `arena`, One in the Chamber is `oitc`. Anybody standing in front of one
     * and reading it types the wrong thing, and every bot command told them
     * only that nothing was placed - which sounds like the name was right.
     *
     * Spaces and underscores are ignored on both sides, so "mob arena",
     * "MobArena" and "arena" all land in the same place.
     */
    public static String idFor(String typed) {
        if (typed == null) return null;

        String want = flatten(typed);
        if (want.isEmpty()) return null;

        for (Destination destination : DESTINATIONS) {
            if (flatten(destination.id()).equals(want)) return destination.id();
            if (flatten(destination.name()).equals(want)) return destination.id();
        }

        for (Service service : SERVICES) {
            if (flatten(service.id()).equals(want)) return service.id();
            if (flatten(service.name()).equals(want)) return service.id();
        }

        return null;
    }

    private static String flatten(String value) {
        return value.toLowerCase(java.util.Locale.ROOT).replace(" ", "").replace("_", "");
    }

    public static java.util.List<String> npcIds() {
        java.util.List<String> ids = new java.util.ArrayList<>();
        for (Destination destination : DESTINATIONS) ids.add(destination.id());
        for (Service service : SERVICES) ids.add(service.id());
        return ids;
    }

    /**
     * In a row in the courtyard, between the gate and the keep door.
     *
     * Facing the gate rather than the keep, so they are looking at you as you
     * walk in. Four people with their backs turned is a strange welcome.
     */
    private Location defaultNpcSpot(World hub, int index) {
        return Castle.greeterSpot(hub, index, DESTINATIONS.length);
    }

    /* --------------------------------------------------------------- people */

    public boolean isBuilding(java.util.UUID who) {
        loadBuilders();
        return building.contains(who);
    }

    /**
     * Read once, on the first question rather than in the constructor.
     *
     * The hub is built before settings are ready during startup, so asking
     * there would read an empty config and remember nothing.
     */
    private void loadBuilders() {
        if (buildersLoaded) return;

        buildersLoaded = true;
        building.addAll(nexus.settings().builders());
    }

    /** Toggles it, and returns what it now is. */
    public boolean toggleBuilding(Player player) {
        loadBuilders();

        boolean on = !building.remove(player.getUniqueId());
        if (on) building.add(player.getUniqueId());

        nexus.settings().setBuilders(building);

        player.setGameMode(on ? GameMode.CREATIVE : GameMode.ADVENTURE);
        if (!on) {
            player.getInventory().clear();
            player.getInventory().setItem(SELECTOR_SLOT, selectorItem(nexus));
            player.getInventory().setHeldItemSlot(SELECTOR_SLOT);
        }
        return on;
    }

    /** Puts somebody in the hub, in the state the hub expects. */
    /**
     * Puts somebody's things in the vault when there is nowhere else for them.
     *
     * Only reached when the lobby cannot tell which world they came from, which
     * should not happen now that every world is made at startup - but the cost
     * of being wrong about that is somebody's inventory, so it is worth the few
     * lines.
     */
    private void rescue(Player player) {
        int saved = 0;

        for (org.bukkit.inventory.ItemStack stack : player.getInventory().getContents()) {
            if (stack == null || stack.getType().isAir()) continue;
            if (nexus.playerShops() != null && nexus.serverTool(stack)) continue;

            nexus.vault().store(player.getUniqueId(), stack);
            saved++;
        }

        if (saved == 0) return;

        nexus.getLogger().warning("rescued " + saved + " stacks from " + player.getName()
                + ", who arrived from " + player.getWorld().getName());

        player.sendMessage(Text.says("Your things are in the vault."));
        player.sendMessage(Text.plain("  /vault to collect them."));
    }

    public void send(Player player) {
        /*
         * Coming back from a world with your pockets full: put them away first,
         * or /hub is a way to delete your own inventory.
         *
         * And if there is nowhere to put them - the player is in a world that
         * is not one of ours, which happens when the server drops somebody into
         * the default overworld because their own world had not loaded - the
         * items go to the vault rather than into the bin. A player who has to
         * run /vault to get their things back has had a mild inconvenience; one
         * whose inventory was cleared has lost an evening.
         */
        Worlds.Place leaving = nexus.worlds().placeOf(player);

        if (leaving != null) {
            nexus.backpacks().stash(player, leaving);
        } else {
            rescue(player);
        }

        /*
         * Everything the last place was still showing them.
         *
         * A boss bar belongs to the world that put it up and stays on screen
         * until that world takes it down; a parkour run that is never stopped
         * leaves somebody counted as running a course they walked out of, so
         * the next checkpoint they touch is on a run that started ten minutes
         * ago. All of it above the build-mode branch, which returns early.
         */
        nexus.oneBlock().hideBar(player);
        nexus.skyBlock().hideBar(player);
        nexus.digSite().hideBar(player);
        nexus.parkour().stop(player);

        player.teleport(spawn());

        /*
         * Stripped before the build-mode branch, not after.
         *
         * The effect-clearing loop further down is inside the ordinary path, so
         * anybody with build mode on returned before reaching it - and carried
         * whatever the last world gave them into the lobby and back out again.
         * A BedWars team's Haste is applied with an infinite duration, which
         * made that permanent, and an operator is exactly the person most
         * likely to have build mode on.
         */
        Worlds.strip(player);

        // Somebody who is mid-build stays that way; being dropped back into
        // adventure mode every time they use a warp is unusable.
        if (building.contains(player.getUniqueId())) {
            player.setGameMode(GameMode.CREATIVE);

            /*
             * The same tidying the ordinary path does below.
             *
             * Only the gamemode is deliberately different for a builder; being
             * left on fire, starving, or holding the last world's inventory is
             * not a build-mode feature. The inventory has already been stashed
             * to the world they came from, so clearing it here loses nothing.
             */
            player.getInventory().clear();
            player.setFoodLevel(20);
            player.setSaturation(20f);
            player.setFireTicks(0);
            player.setHealth(healthOf(player));
            player.setFallDistance(0f);

            refresh(player);
            return;
        }

        player.setGameMode(GameMode.ADVENTURE);

        player.getInventory().clear();
        player.setLevel(0);
        player.setExp(0f);
        player.setFoodLevel(20);
        player.setSaturation(20f);
        player.setFireTicks(0);
        player.setHealth(healthOf(player));
        player.setFallDistance(0f);

        for (PotionEffect effect : new ArrayList<>(player.getActivePotionEffects())) {
            player.removePotionEffect(effect.getType());
        }

        player.getInventory().setItem(SELECTOR_SLOT, selectorItem(nexus));
        player.getInventory().setHeldItemSlot(SELECTOR_SLOT);

        /*
          * Quick on your feet in the lobby, and only in the lobby.
          *
          * Infinite duration because a lobby speed that wears off after three
          * minutes is worse than none - but that duration is exactly why every
          * other transition has to strip it, which for a long time none of them
          * did. See Worlds.strip.
          */
        player.addPotionEffect(new PotionEffect(
                PotionEffectType.SPEED, Integer.MAX_VALUE, 1, false, false));

        refresh(player);
    }

    private double healthOf(Player player) {
        var attribute = player.getAttribute(Attribute.MAX_HEALTH);
        return attribute == null ? 20.0 : attribute.getValue();
    }

    /** Marks the compass as the server's, rather than as a compass. */
    public static org.bukkit.NamespacedKey selectorKey(Nexus nexus) {
        return new org.bukkit.NamespacedKey(nexus, "hub_selector");
    }

    public static ItemStack selectorItem(Nexus nexus) {
        ItemStack item = new ItemStack(Material.COMPASS);
        item.editMeta(meta -> {
            meta.getPersistentDataContainer().set(selectorKey(nexus),
                    org.bukkit.persistence.PersistentDataType.BYTE, (byte) 1);
            meta.displayName(Text.item("Where to?", NamedTextColor.GREEN));
            meta.lore(List.of(Text.item("Right click", NamedTextColor.GRAY)));
        });
        return item;
    }

    /**
     * Whether this is the hub compass.
     *
     * Marked in its own data rather than recognised by being a compass, which
     * is what let somebody put theirs in the auction house: the shop and the
     * auction had no way to tell the server's tool from an ordinary item, and
     * neither did this. The real one is handed out again on every arrival in
     * the hub, so an older unmarked one is replaced rather than stranded.
     */
    public static boolean isSelector(Nexus nexus, ItemStack item) {
        if (item == null || item.getType() != Material.COMPASS) return false;
        ItemMeta meta = item.getItemMeta();
        return meta != null && meta.getPersistentDataContainer()
                .has(selectorKey(nexus), org.bukkit.persistence.PersistentDataType.BYTE);
    }

    public boolean isHub(Player player) {
        return player.getWorld().equals(world());
    }

    /* ------------------------------------------------------------- sidebar */

    /** Redraws the panel. Cheap enough to call whenever anything changes. */
    public void refresh(Player player) {
        if (!isHub(player)) return;

        Sidebar board = boards.computeIfAbsent(player.getUniqueId(),
                id -> new Sidebar(player, "NEXUS"));

        Stats.Record record = nexus.stats().of(player.getUniqueId());
        Ranks rank = nexus.stats().rankOf(player.getUniqueId());

        List<Component> lines = new ArrayList<>();
        lines.add(Sidebar.gap());
        lines.add(Sidebar.line("Rank", rank == Ranks.PLAYER ? "None" : rank.tag, rank.colour));
        lines.add(Sidebar.line("Money", Stats.cash(record.money), NamedTextColor.GOLD));
        lines.add(Sidebar.line("Coins", String.valueOf(record.coins), NamedTextColor.YELLOW));
        lines.add(Sidebar.gap());
        lines.add(Sidebar.line("Wins", String.valueOf(record.wins), NamedTextColor.GREEN));
        lines.add(Sidebar.line("K/D", String.format("%.2f", record.kd()), NamedTextColor.WHITE));

        String queued = nexus.games().queuedFor(player.getUniqueId());
        if (queued != null) {
            Game game = nexus.games().byId(queued);
            int left = nexus.games().countdownFor(queued);
            lines.add(Sidebar.gap());
            lines.add(Sidebar.line("Queued", game == null ? queued : game.name(), Text.BRAND));
            lines.add(Sidebar.line("Players",
                    nexus.games().waitingFor(queued) + "/" + (game == null ? "?" : game.maxPlayers()),
                    NamedTextColor.WHITE));
            if (left >= 0) {
                lines.add(Sidebar.line("Starting", left + "s", NamedTextColor.YELLOW));
            }
        }

        lines.add(Sidebar.gap());
        lines.add(Component.text(Bukkit.getOnlinePlayers().size() + " online", NamedTextColor.DARK_GRAY));

        board.set(lines);
    }

    public void forget(Player player) {
        Sidebar board = boards.remove(player.getUniqueId());
        if (board != null) board.clear();
    }
}
