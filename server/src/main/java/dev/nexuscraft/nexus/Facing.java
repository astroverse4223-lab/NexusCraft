package dev.nexuscraft.nexus;

import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.block.Block;

/**
 * A place in the world in the builder's own terms.
 *
 * `f` is forward, away from where they were looking; `r` is to their right; `u`
 * is up. Anything that places a structure relative to a player is written in
 * these, so each one reads as a shape rather than as nine lines of arithmetic -
 * and the one calculation that could be wrong about which way round a thing
 * faces is written once, here, rather than once per feature.
 */
public final class Facing {

    private final World world;
    private final Toolkit.Change change;

    private final int ox;
    private final int oy;
    private final int oz;

    private final int fx;
    private final int fz;

    /**
     * @param ground how far below the player's feet {@code u = 0} sits. A
     *               building wants -1, so its foundation lands on the floor
     *               rather than at shin height; a wall wants 0, so it starts
     *               where you are standing.
     */
    public Facing(World world, Toolkit.Change change, Location at, int ground) {
        this.world = world;
        this.change = change;

        this.ox = at.getBlockX();
        this.oy = at.getBlockY() + ground;
        this.oz = at.getBlockZ();

        int quarter = Math.floorMod(Math.round(at.getYaw() / 90f), 4);

        this.fx = switch (quarter) {
            case 1 -> -1;
            case 3 -> 1;
            default -> 0;
        };
        this.fz = switch (quarter) {
            case 0 -> 1;
            case 2 -> -1;
            default -> 0;
        };
    }

    public Block block(int f, int u, int r) {
        // Right is forward turned a quarter clockwise: facing south, your right
        // hand points west.
        return world.getBlockAt(ox + f * fx - r * fz, oy + u, oz + f * fz + r * fx);
    }

    public void set(int f, int u, int r, Material material) {
        change.set(block(f, u, r), material);
    }
}
