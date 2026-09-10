package dev.nexuscraft.nexus.bedwars;

import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.block.BlockFace;
import org.bukkit.block.data.type.Bed;

import java.util.ArrayList;
import java.util.List;

/**
 * The map, built out of arithmetic.
 *
 * A BedWars map is normally a build somebody spent a weekend on, shipped as a
 * schematic and pasted in. That is better looking than this and it costs a
 * dependency, a file that has to travel with the plugin, and a whole class of
 * failure where the map is missing or was made for a different version.
 *
 * Generated instead, the map is always present, always the right version, and
 * perfectly symmetric — which matters more in BedWars than in almost any other
 * game, because an asymmetry is an unfair advantage that nobody can see.
 *
 * The layout is the standard one and the distances are the ones that make it
 * work: far enough apart that a rush is a commitment, close enough that the
 * game does not become a bridging simulator.
 */
public final class Field {

    /** Ground level. High enough to fall a long way, low enough to build up. */
    public static final int FLOOR = 70;

    /** How far a base sits from the middle. */
    private static final int BASE_OUT = 48;

    /** Where the diamonds are: between the bases, off the direct lines. */
    private static final int DIAMOND_OUT = 26;

    private static final int BASE_RADIUS = 6;
    private static final int MIDDLE_RADIUS = 5;

    /** North, east, south, west — the order teams are assigned in. */
    private static final int[][] DIRECTIONS = {{0, -1}, {1, 0}, {0, 1}, {-1, 0}};

    private final World world;

    public Field(World world) {
        this.world = world;
    }

    /* -------------------------------------------------------------- layout */

    public Location baseSpawn(int team) {
        int[] direction = DIRECTIONS[team];
        // Standing a little inside the island, looking at the middle.
        double x = direction[0] * (BASE_OUT - 2) + 0.5;
        double z = direction[1] * (BASE_OUT - 2) + 0.5;

        Location at = new Location(world, x, FLOOR + 1, z);
        at.setDirection(new org.bukkit.util.Vector(-direction[0], 0, -direction[1]));
        return at;
    }

    /** The foot of the bed — the block a player has to reach to break it. */
    public Location bed(int team) {
        int[] direction = DIRECTIONS[team];
        return new Location(world,
                direction[0] * (BASE_OUT + 3), FLOOR + 1, direction[1] * (BASE_OUT + 3));
    }

    /** Where a team's iron and gold fall. */
    public Location baseGenerator(int team) {
        int[] direction = DIRECTIONS[team];
        return new Location(world,
                direction[0] * BASE_OUT + 0.5, FLOOR + 1, direction[1] * BASE_OUT + 0.5);
    }

    public Location shop(int team) {
        return offsetInBase(team, 3, 0);
    }

    public Location upgrades(int team) {
        return offsetInBase(team, -3, 0);
    }

    private Location offsetInBase(int team, int across, int along) {
        int[] direction = DIRECTIONS[team];
        // Across the island is perpendicular to the direction it faces.
        double x = direction[0] * (BASE_OUT + along) - direction[1] * across + 0.5;
        double z = direction[1] * (BASE_OUT + along) + direction[0] * across + 0.5;

        Location at = new Location(world, x, FLOOR + 1, z);
        at.setDirection(new org.bukkit.util.Vector(-direction[0], 0, -direction[1]));
        return at;
    }

    public List<Location> diamondGenerators() {
        List<Location> found = new ArrayList<>();
        for (int[] corner : new int[][]{{1, 1}, {1, -1}, {-1, 1}, {-1, -1}}) {
            found.add(new Location(world,
                    corner[0] * DIAMOND_OUT + 0.5, FLOOR + 1, corner[1] * DIAMOND_OUT + 0.5));
        }
        return found;
    }

    public List<Location> emeraldGenerators() {
        return List.of(new Location(world, 0.5, FLOOR + 1, 0.5));
    }

    /* --------------------------------------------------------------- build */

    public void build(int teams, Material[] wool) {
        middle();
        for (Location at : diamondGenerators()) island(at, 4, Material.QUARTZ_BLOCK, Material.QUARTZ_BLOCK);
        for (int team = 0; team < teams; team++) base(team, wool[team]);
    }

    private void middle() {
        island(new Location(world, 0.5, FLOOR + 1, 0.5), MIDDLE_RADIUS,
                Material.CHISELED_QUARTZ_BLOCK, Material.QUARTZ_BLOCK);
    }

    /**
     * One team's island: floor, bed, and a wall behind the bed.
     *
     * The wall matters. Without something solid behind it a bed can be broken
     * from underneath or from the far side, which turns every defence into
     * guesswork about where the attack is coming from.
     */
    private void base(int team, Material wool) {
        int[] direction = DIRECTIONS[team];
        Location centre = new Location(world,
                direction[0] * BASE_OUT + 0.5, FLOOR + 1, direction[1] * BASE_OUT + 0.5);

        island(centre, BASE_RADIUS, wool, Material.SMOOTH_SANDSTONE);

        Location bed = bed(team);
        // The island is centred on the generator, so the bed needs its own
        // ground - it sits three blocks further out than the platform edge.
        for (int across = -2; across <= 2; across++) {
            for (int along = 0; along <= 3; along++) {
                int x = (int) (direction[0] * (BASE_OUT + along) - direction[1] * across);
                int z = (int) (direction[1] * (BASE_OUT + along) + direction[0] * across);
                world.getBlockAt(x, FLOOR, z).setType(Material.SMOOTH_SANDSTONE);
            }
        }

        placeBed(bed, faceOf(-direction[0], -direction[1]), team);

        // The wall, one block behind the bed's head.
        for (int across = -2; across <= 2; across++) {
            for (int up = 1; up <= 3; up++) {
                int x = (int) (direction[0] * (BASE_OUT + 4) - direction[1] * across);
                int z = (int) (direction[1] * (BASE_OUT + 4) + direction[0] * across);
                world.getBlockAt(x, FLOOR + up, z).setType(wool);
            }
        }
    }

    /**
     * Beds are two blocks and both halves have to agree.
     *
     * Setting one and letting the server work the other out does not happen —
     * a bed whose head and foot disagree about which way it faces is dropped by
     * the client as an invalid block, and the bed silently is not there.
     */
    private void placeBed(Location foot, BlockFace facing, int team) {
        Block footBlock = foot.getBlock();
        Block headBlock = footBlock.getRelative(facing);

        Material material = BED_COLOURS[team % BED_COLOURS.length];
        footBlock.setType(material, false);
        headBlock.setType(material, false);

        Bed footData = (Bed) footBlock.getBlockData();
        footData.setPart(Bed.Part.FOOT);
        footData.setFacing(facing);
        footBlock.setBlockData(footData, false);

        Bed headData = (Bed) headBlock.getBlockData();
        headData.setPart(Bed.Part.HEAD);
        headData.setFacing(facing);
        headBlock.setBlockData(headData, false);
    }

    private static final Material[] BED_COLOURS = {
            Material.RED_BED, Material.BLUE_BED, Material.GREEN_BED, Material.YELLOW_BED,
    };

    private static BlockFace faceOf(int x, int z) {
        if (x > 0) return BlockFace.EAST;
        if (x < 0) return BlockFace.WEST;
        return z > 0 ? BlockFace.SOUTH : BlockFace.NORTH;
    }

    /** A round platform with an edge, which reads better than a square. */
    private void island(Location centre, int radius, Material edge, Material floor) {
        int cx = centre.getBlockX();
        int cz = centre.getBlockZ();

        for (int x = -radius; x <= radius; x++) {
            for (int z = -radius; z <= radius; z++) {
                if (x * x + z * z > radius * radius) continue;

                boolean rim = (x * x + z * z) > (radius - 1) * (radius - 1);
                world.getBlockAt(cx + x, FLOOR, cz + z).setType(rim ? edge : floor, false);
            }
        }
    }
}
