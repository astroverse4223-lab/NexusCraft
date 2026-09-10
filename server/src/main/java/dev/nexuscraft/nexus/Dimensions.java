package dev.nexuscraft.nexus;

import org.bukkit.Difficulty;
import org.bukkit.GameRule;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.WorldCreator;
import org.bukkit.entity.Player;
import org.bukkit.event.player.PlayerPortalEvent;

/**
 * The other half of survival.
 *
 * The server had a nether and an end, but they belonged to the default
 * overworld - not to nexus_survival - and nothing linked them. A portal built
 * in survival led nowhere, which quietly removed brewing, potions, netherite,
 * elytra, shulker boxes and the dragon from the game. Players topped out at
 * diamond and that was the whole of it.
 *
 * Bukkit only links `<world>_nether` automatically for the world it considers
 * the default one, so a custom overworld has to be joined up by hand: the
 * worlds are made here, and the travel between them is worked out here too.
 */
public final class Dimensions {

    /** Named after the world they belong to, which is also how they are found. */
    public static final String NETHER = "nexus_survival_nether";
    public static final String END = "nexus_survival_the_end";

    /** The nether is eight times smaller, as it is everywhere else. */
    private static final int SCALE = 8;

    private final Nexus nexus;

    private World nether;
    private World end;

    public Dimensions(Nexus nexus) {
        this.nexus = nexus;
    }

    /* ---------------------------------------------------------------- making */

    public World nether() {
        if (nether != null) return nether;

        nether = new WorldCreator(NETHER)
                .environment(World.Environment.NETHER)
                .createWorld();

        if (nether == null) throw new IllegalStateException("could not create " + NETHER);

        nether.setDifficulty(Difficulty.NORMAL);
        nether.setGameRule(GameRule.KEEP_INVENTORY, false);
        nether.setGameRule(GameRule.ANNOUNCE_ADVANCEMENTS, true);
        return nether;
    }

    public World end() {
        if (end != null) return end;

        end = new WorldCreator(END)
                .environment(World.Environment.THE_END)
                .createWorld();

        if (end == null) throw new IllegalStateException("could not create " + END);

        end.setDifficulty(Difficulty.NORMAL);
        end.setGameRule(GameRule.KEEP_INVENTORY, false);
        end.setGameRule(GameRule.ANNOUNCE_ADVANCEMENTS, true);
        return end;
    }

    /** Whether this world is part of survival, whichever dimension it is. */
    public static boolean isSurvival(World world) {
        String name = world.getName();
        return name.equals(Worlds.Place.SURVIVAL.world)
                || name.equals(NETHER)
                || name.equals(END);
    }

    /* -------------------------------------------------------------- travel */

    /**
     * Where a portal in survival actually goes.
     *
     * Handled rather than left to the server, which would send somebody to the
     * default world's nether - a dimension belonging to a world nobody plays
     * in, unprotected and unmanaged, where their base would be alone in the
     * dark forever.
     */
    public void portal(PlayerPortalEvent event) {
        Player player = event.getPlayer();
        World from = player.getWorld();

        if (!isSurvival(from)) return;

        Location at = event.getFrom();

        switch (event.getCause()) {
            case NETHER_PORTAL -> {
                if (from.getName().equals(NETHER)) {
                    // Out, and eight times further from the middle.
                    event.setTo(new Location(nexus.worlds().of(Worlds.Place.SURVIVAL),
                            at.getX() * SCALE, at.getY(), at.getZ() * SCALE));
                } else {
                    event.setTo(new Location(nether(),
                            at.getX() / SCALE, at.getY(), at.getZ() / SCALE));
                }
                event.setCanCreatePortal(true);
                event.setSearchRadius(128);
            }

            case END_PORTAL -> {
                if (from.getName().equals(END)) {
                    event.setTo(nexus.worlds().spawnOf(Worlds.Place.SURVIVAL));
                } else {
                    event.setTo(landing());
                }
                event.setCanCreatePortal(false);
            }

            default -> {
                /* Anything else keeps whatever the server decided. */
            }
        }
    }

    /**
     * The obsidian platform arrivals land on.
     *
     * Built rather than trusted: the game makes one when somebody arrives
     * through the vanilla end portal, and this is not that - somebody arriving
     * into thin air at a hundred blocks up dies before they have looked around.
     */
    private Location landing() {
        World world = end();
        int x = 100;
        int y = 49;
        int z = 0;

        for (int dx = -2; dx <= 2; dx++) {
            for (int dz = -2; dz <= 2; dz++) {
                world.getBlockAt(x + dx, y, z + dz).setType(Material.OBSIDIAN, false);

                // And clear the air above it, in case the island reaches here.
                for (int dy = 1; dy <= 3; dy++) {
                    world.getBlockAt(x + dx, y + dy, z + dz).setType(Material.AIR, false);
                }
            }
        }

        return new Location(world, x + 0.5, y + 1, z + 0.5);
    }

    /**
     * Somebody arriving in the end for the first time, or respawning out of it.
     *
     * The dragon's own exit portal drops players into the default overworld
     * unless it is told otherwise, which would take them off survival entirely.
     */
    public void arrivedInEnd(Player player) {
        if (!player.getWorld().getName().equals(END)) return;
        if (player.getLocation().getY() > 0) return;

        player.teleport(landing());
        player.sendMessage(Text.says("Careful."));
    }

    public void warmUp() {
        nether();
        end();
        nexus.getLogger().info("survival has a nether and an end");
    }

}
