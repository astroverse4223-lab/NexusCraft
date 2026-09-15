package dev.nexuscraft.vigil;

import net.minecraft.entity.Entity;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.util.hit.HitResult;
import net.minecraft.util.math.BlockPos;
import net.minecraft.util.math.Box;
import net.minecraft.util.math.Vec3d;
import net.minecraft.world.RaycastContext;

/**
 * Where it is standing the next time you look.
 *
 * It never walks. It cannot be seen to walk — the only moments it is allowed to
 * move are the moments nobody can see it — so an animation would be work done
 * for an empty room. What actually reaches the player is the *cut*: it was
 * there, and now it is here, and the distance between those two facts is the
 * whole effect.
 *
 * Which makes this the most important file in the mod after the looking. A bad
 * landing spot ruins the moment in a way a bad walk cycle never could: inside a
 * wall and it is invisible, behind you and the reveal is wasted, too far off
 * the line and it looks like it is wandering rather than coming for you.
 *
 * So every candidate is scored on one thing above the rest — whether it can see
 * you from there. It wants to be standing where you will find it.
 */
public final class Approach {

    /** How near it will place itself before it stops closing and acts. */
    public static final double CONTACT = 1.7;

    /** Angles either side of straight-on, so it does not advance up a line. */
    private static final double[] FANS = {0.0, 22.0, -22.0, 47.0, -47.0, 75.0, -75.0};

    /** Fractions of a full stride, so a blocked step becomes a short one. */
    private static final double[] LENGTHS = {1.0, 0.65, 1.35, 0.35};

    /** Floors to try either side of the straight-line height, in order. */
    private static final int[] HEIGHTS = {0, 1, -1, 2, -2, 3, -3, -4, -5};

    private Approach() {
    }

    /**
     * The next place to stand, or null when there is nowhere to go.
     *
     * Nowhere to go happens — you are in a sealed room, or it is out over water
     * — and the right answer then is to stay put rather than to shove it
     * somewhere silly. It has all night.
     */
    public static Vec3d next(ServerWorld world, Entity self, PlayerEntity target, double stride) {
        Vec3d from = self.getEntityPos();
        Vec3d to = target.getEntityPos();

        double dx = to.x - from.x;
        double dz = to.z - from.z;
        double flat = Math.sqrt(dx * dx + dz * dz);
        if (flat < 1.0e-4) return null;

        double heading = Math.atan2(dz, dx);
        Vec3d eyes = target.getEyePos();

        Vec3d fallback = null;

        for (double length : LENGTHS) {
            for (double fan : FANS) {
                double angle = heading + Math.toRadians(fan);
                double reach = Math.min(stride * length, Math.max(0.0, flat - CONTACT * 0.8));
                if (reach < 0.3) continue;

                double x = from.x + Math.cos(angle) * reach;
                double z = from.z + Math.sin(angle) * reach;

                Vec3d landing = floorNear(world, self, x, from.y, z);
                if (landing == null) continue;

                // Never further away than it already was; it is closing, not milling.
                if (landing.squaredDistanceTo(to) > from.squaredDistanceTo(to)) continue;

                // The one that matters: can it see you from there.
                if (clear(world, landing.add(0.0, self.getHeight() * 0.85, 0.0), eyes, self)) {
                    return landing;
                }
                if (fallback == null) fallback = landing;
            }
        }

        /*
         * Nothing with a view of you, so take the first thing that was merely
         * standable. Out of sight round a corner is still progress, and the
         * step after this one will probably have the view.
         */
        return fallback;
    }

    /**
     * A place to stand at this column, at whatever height there is a floor.
     *
     * Searched outward from the height it is already at rather than downward
     * from the sky, because following someone down a staircase and following
     * them up a hill are the same problem and neither is served by dropping it
     * onto the roof.
     */
    private static Vec3d floorNear(ServerWorld world, Entity self, double x, double y, double z) {
        for (int step : HEIGHTS) {
            double at = Math.floor(y) + step;

            BlockPos below = BlockPos.ofFloored(x, at - 0.5, z);
            if (!world.getBlockState(below).isSolidBlock(world, below)) continue;

            Box space = self.getType().getDimensions().getBoxAt(x, at, z);
            if (!world.isSpaceEmpty(space)) continue;

            return new Vec3d(x, at, z);
        }
        return null;
    }

    /** Whether there is nothing in the way between two points. */
    public static boolean clear(ServerWorld world, Vec3d from, Vec3d to, Entity ignoring) {
        RaycastContext context = new RaycastContext(
                from, to,
                RaycastContext.ShapeType.VISUAL,
                RaycastContext.FluidHandling.NONE,
                ignoring);

        return world.raycast(context).getType() == HitResult.Type.MISS;
    }
}
