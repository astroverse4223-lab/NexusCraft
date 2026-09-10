package dev.nexuscraft.nexus;

import org.bukkit.Difficulty;
import org.bukkit.GameMode;
import org.bukkit.GameRule;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.WorldCreator;
import org.bukkit.WorldType;
import org.bukkit.entity.Player;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * The places you can go, and what each one is for.
 *
 * A network is more than a lobby with games attached — it is a set of worlds
 * that are each somewhere different, and the difference has to be real. Survival
 * is a normal world where the point is that nothing is given to you. Prison is
 * a closed world where the point is the ladder. Creative is a flat sheet where
 * the point is that none of it counts.
 *
 * They are separate worlds rather than separate servers because that is what a
 * person hosting this actually has: one machine, one port, one thing to start.
 * A proxy in front of four servers is how Hypixel does it and it is the wrong
 * shape for a server your friends join.
 */
public final class Worlds {

    /** One destination: how it is built, and how a player arrives in it. */
    public enum Place {
        SURVIVAL("nexus_survival", "Survival", GameMode.SURVIVAL),
        PRISON("nexus_prison", "Prison", GameMode.SURVIVAL),
        CREATIVE("nexus_creative", "Creative", GameMode.CREATIVE),
        ONEBLOCK("nexus_oneblock", "One Block", GameMode.SURVIVAL),
        SKYBLOCK("nexus_skyblock", "Skyblock", GameMode.SURVIVAL),
        PARKOUR("nexus_parkour", "Parkour", GameMode.ADVENTURE),
        DROPPER("nexus_dropper", "Dropper", GameMode.ADVENTURE),
        DIGSITE("nexus_digsite", "Dig Site", GameMode.SURVIVAL);

        public final String world;
        public final String label;
        public final GameMode mode;

        Place(String world, String label, GameMode mode) {
            this.world = world;
            this.label = label;
            this.mode = mode;
        }
    }

    private final Nexus nexus;
    private final Map<Place, World> loaded = new LinkedHashMap<>();

    public Worlds(Nexus nexus) {
        this.nexus = nexus;
    }

    /* --------------------------------------------------------------- build */

    /**
     * Worlds are made when first asked for, not at startup.
     *
     * Generating a survival world is the single slowest thing this plugin does,
     * and doing it during boot means a server that looks hung for a minute on
     * first run. Made on the first visit, the cost lands on one person who has
     * just chosen to go there and is expecting a loading screen anyway.
     */
    /**
     * Drops a world from the cache so the next `of` makes it again.
     *
     * Only for a world that has just been unloaded and deleted. Without it the
     * cache hands back a World object for something that is no longer there.
     */
    public void forget(Place place) {
        loaded.remove(place);
    }

    public World of(Place place) {
        World existing = loaded.get(place);
        if (existing != null) return existing;

        World world = switch (place) {
            case SURVIVAL -> survival();
            case PRISON -> flat(place);
            case CREATIVE -> flat(place);
            case ONEBLOCK -> flat(place);
            case SKYBLOCK -> flat(place);
            case PARKOUR, DROPPER -> flat(place);
            case DIGSITE -> flat(place);
        };

        loaded.put(place, world);
        return world;
    }

    private World survival() {
        World world = new WorldCreator(Place.SURVIVAL.world)
                .environment(World.Environment.NORMAL)
                .type(WorldType.NORMAL)
                .createWorld();

        if (world == null) throw new IllegalStateException("could not create the survival world");

        world.setDifficulty(Difficulty.NORMAL);
        world.setGameRule(GameRule.ANNOUNCE_ADVANCEMENTS, true);
        world.setGameRule(GameRule.KEEP_INVENTORY, false);
        world.setSpawnFlags(true, true);
        return world;
    }

    /**
     * A void world with one big platform in it.
     *
     * Used for prison and creative, which both want a blank sheet rather than
     * terrain — prison builds its own everything, and a creative world with
     * mountains in it is a creative world people have to flatten first.
     */
    private World flat(Place place) {
        World world = new WorldCreator(place.world)
                .generator(new Arena.Nothing())
                .generateStructures(false)
                .createWorld();

        if (world == null) throw new IllegalStateException("could not create " + place.world);

        /*
         * Skyblock is the exception, and has to be.
         *
         * A void world with nothing spawning suits prison, creative, parkour and
         * the dropper: mobs there are a nuisance and a hazard nobody asked for.
         * In skyblock it removes the game. With spawning off and the sun nailed
         * to midday there is no way to get an animal, no way to get a mob drop,
         * and no reason to build anything dark - which is most of what people
         * build on an island.
         *
         * So it gets night, weather and spawning, and everything else keeps the
         * quiet sky it was given.
         */
        boolean alive = place == Place.SKYBLOCK;

        world.setDifficulty(alive ? Difficulty.NORMAL : Difficulty.PEACEFUL);
        world.setGameRule(GameRule.DO_DAYLIGHT_CYCLE, alive);
        world.setGameRule(GameRule.DO_WEATHER_CYCLE, alive);
        world.setGameRule(GameRule.DO_MOB_SPAWNING, alive);
        world.setGameRule(GameRule.ANNOUNCE_ADVANCEMENTS, false);
        world.setGameRule(GameRule.KEEP_INVENTORY, true);

        /*
         * And the same for every other world with its weather switched off.
         *
         * Turning the cycle off does not clear what is already happening, so
         * any of these saved mid-storm would have come back raining and stayed
         * that way - in prison, in creative, and on a parkour course.
         */
        if (!alive) {
            world.setTime(6000);
            world.setStorm(false);
            world.setThundering(false);
            world.setClearWeatherDuration(1_000_000);
        }

        /*
         * Creative's ground belongs to Plots now.
         *
         * It used to be one quartz sheet laid here, which is the wrong shape
         * for a world divided into plots and would have shown through wherever
         * the grid did not line up with it. Plots lays what it needs, clears
         * what is left of the old sheet, and sets the spawn.
         */
        if (place != Place.CREATIVE) world.setSpawnLocation(0, 66, 0);
        return world;
    }

    /* ------------------------------------------------------------ arriving */

    public Location spawnOf(Place place) {
        World world = of(place);

        return switch (place) {
            case SURVIVAL -> {
                Location at = world.getSpawnLocation();
                // Put them on the surface rather than inside whatever the world
                // generator decided spawn was, which is regularly a hillside.
                yield new Location(world, at.getX(), world.getHighestBlockYAt(at) + 1.0, at.getZ());
            }
            // On the road just outside plot 0,0 rather than in it, so
            // arriving is not standing in somebody's build.
            case CREATIVE -> new Location(world, -3.5, Plots.GROUND + 1, -3.5);
            case PRISON -> nexus.prison().spawn();
            case ONEBLOCK -> nexus.oneBlock().islandOf(null);
            case SKYBLOCK -> nexus.skyBlock().islandOf(null);
            case PARKOUR -> nexus.parkour().start(0);
            case DROPPER -> new Location(world, 0.5, 250, 0.5);
            case DIGSITE -> nexus.digSite().spawn();
        };
    }

    /**
     * Sends somebody somewhere, in the state that place expects.
     *
     * Every world has different rules about what you may do and what you are
     * carrying, and getting that wrong is how somebody arrives in survival in
     * creative mode holding a stack of bedrock. So arriving is one method and
     * it always sets everything.
     */
    /**
     * Takes off whatever the last place put on them.
     *
     * Every transition clears the inventory and sets the gamemode, and until
     * now not one of them cleared potion effects - so the lobby's Speed II,
     * which is applied with an infinite duration, followed people into
     * survival, into both timed courses and into every minigame. It was most
     * obvious in parkour, where the jumps are spaced for a normal walk.
     *
     * Shared rather than repeated, so the next transition somebody adds gets it
     * by calling one method instead of by remembering a loop.
     */
    public static void strip(Player player) {
        for (org.bukkit.potion.PotionEffect effect
                : new java.util.ArrayList<>(player.getActivePotionEffects())) {
            player.removePotionEffect(effect.getType());
        }

        // Walk and fly speed are not effects and do not expire, so a plugin
        // that ever sets them has to put them back itself.
        player.setWalkSpeed(0.2f);
        player.setFlySpeed(0.1f);

        player.setFireTicks(0);
        player.setFallDistance(0f);
    }

    public void send(Player player, Place place) {
        Match match = nexus.games().matchOf(player.getUniqueId());
        if (match != null) match.remove(player);
        nexus.games().leave(player, true);

        /*
         * What you were carrying stays in the world you were carrying it in.
         *
         * Not politeness - this is the only thing standing between the economy
         * and somebody filling their pockets in creative and walking to
         * survival. Stashed before the gamemode changes, because setGameMode
         * can move items around under you.
         */
        nexus.backpacks().stash(player, placeOf(player));

        // The bar belongs to One Block, so it does not follow you out of it.
        nexus.oneBlock().hideBar(player);
        nexus.skyBlock().hideBar(player);

        /*
         * The island has to exist before somebody is sent to stand on it.
         *
         * Otherwise the first visit teleports them to a set of coordinates in
         * an empty void world, and they are falling before the island is made.
         */
        if (place == Place.ONEBLOCK) nexus.oneBlock().prepare(player.getUniqueId());
        if (place == Place.SKYBLOCK) nexus.skyBlock().prepare(player.getUniqueId());

        // The island worlds put you on your own island, not a shared spawn.
        player.teleport(switch (place) {
            case ONEBLOCK -> nexus.oneBlock().islandOf(player.getUniqueId()).add(0, 1, 0);
            case SKYBLOCK -> nexus.skyBlock().islandOf(player.getUniqueId()).add(0, 1, 0);
            default -> spawnOf(place);
        });
        strip(player);

        player.setGameMode(place.mode);
        player.setFlying(place.mode == GameMode.CREATIVE);
        player.setAllowFlight(place.mode == GameMode.CREATIVE);
        player.setFallDistance(0f);

        nexus.backpacks().restore(player, place);

        nexus.hub().forget(player);
        player.sendMessage(Text.says("Welcome to " + place.label + "."));

        if (place == Place.PRISON) nexus.prison().arrive(player);
        if (place == Place.ONEBLOCK) nexus.oneBlock().arrive(player);
        if (place == Place.SKYBLOCK) nexus.skyBlock().arrive(player);
    }

    public Place placeOf(Player player) {
        String name = player.getWorld().getName();
        for (Place place : Place.values()) {
            if (place.world.equals(name)) return place;
        }

        /*
         * The nether and the end are survival wearing a different sky.
         *
         * They have to answer as survival or a portal becomes an inventory
         * swap: everything carried in gets stashed under survival on the way
         * out, and the arriving world hands back nothing because it is not a
         * place. Walking into a portal would empty your pockets.
         */
        if (name.equals(Dimensions.NETHER) || name.equals(Dimensions.END)) {
            return Place.SURVIVAL;
        }

        /*
         * And the island nethers, for exactly the same reason.
         *
         * Without this a portal on an island is an inventory swap: everything
         * carried through is stashed under the island world on the way out and
         * the arriving world hands nothing back, because it is not a place.
         */
        Place island = IslandNether.placeOf(name);
        if (island != null) return island;

        return null;
    }


}
