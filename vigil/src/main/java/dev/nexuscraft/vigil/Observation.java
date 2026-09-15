package dev.nexuscraft.vigil;

import net.minecraft.entity.Entity;
import net.minecraft.entity.effect.StatusEffects;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.server.network.ServerPlayerEntity;
import net.minecraft.util.hit.HitResult;
import net.minecraft.util.math.Box;
import net.minecraft.util.math.Vec3d;
import net.minecraft.world.RaycastContext;
import net.minecraft.world.World;

import java.util.List;

/**
 * Whether anybody is looking at it.
 *
 * This is the whole mod. Everything else — the poses, the approach, the thing
 * finally reaching you — hangs off one question asked twenty times a second:
 * is this entity inside somebody's view right now.
 *
 * "Inside render distance" is the easy answer and it is the wrong one, because
 * it means the thing can never move while you are in the same cave as it. What
 * matters is where the player's head is actually pointed, which the server
 * already knows: it receives yaw and pitch with every movement packet. So the
 * test is done properly — a cone in two axes, then a raycast for anything in
 * the way — and the result is that you can lose sight of it by turning your
 * head, which is the only interesting thing you can do to it.
 *
 * The bias throughout is toward the player. Every judgement call here is made
 * the generous way: several sample points rather than one, a wider cone than
 * the real one, and any doubt resolved as "seen". A thing that creeps up on you
 * because the maths was stingy is not frightening, it is broken.
 */
public final class Observation {

    /**
     * Half the field of view, horizontally and vertically, in degrees.
     *
     * Minecraft's default 70 is vertical, and at 16:9 that works out to about
     * 51 degrees either side horizontally and 35 vertically. These are wider on
     * purpose: players run all sorts of FOV settings, and the failure that
     * matters is the one where it moved while you would swear you were looking
     * at it.
     */
    private static final double HALF_HORIZONTAL = 58.0;
    private static final double HALF_VERTICAL = 45.0;

    /** Past this it is a speck in the fog and does not count as watched. */
    private static final double MAX_SIGHT = 64.0;

    private Observation() {
    }

    /**
     * Whether any player in the world can see this entity.
     *
     * Any single one is enough, which is what makes two people meaningful: one
     * of you can hold it still while the other keeps working, and it only moves
     * in the moment you both happen to look away.
     */
    public static boolean seenByAnyone(World world, Entity target) {
        List<? extends PlayerEntity> players = world.getPlayers();
        for (PlayerEntity player : players) {
            if (canSee(player, target)) return true;
        }
        return false;
    }

    /** The player who is watching it, or null when nobody is. */
    public static ServerPlayerEntity watcher(World world, Entity target) {
        for (PlayerEntity player : world.getPlayers()) {
            if (player instanceof ServerPlayerEntity server && canSee(server, target)) return server;
        }
        return null;
    }

    /**
     * Whether this one player can see it.
     *
     * Eyes shut counts as not looking — asleep, blind, or in the menus we
     * cannot know about. Sleeping is the one that matters: climbing into bed
     * while it is standing in the doorway should not pin it there all night.
     */
    public static boolean canSee(PlayerEntity player, Entity target) {
        if (player.isSleeping()) return false;
        if (player.isSpectator() && !VigilConfig.get().spectatorsWatch) return false;
        if (player.hasStatusEffect(StatusEffects.BLINDNESS)) return false;
        if (player.getEntityWorld() != target.getEntityWorld()) return false;

        Vec3d eye = player.getEyePos();
        if (eye.squaredDistanceTo(target.getEntityPos()) > MAX_SIGHT * MAX_SIGHT) return false;

        for (Vec3d point : samples(target.getBoundingBox())) {
            if (!inView(eye, player.getYaw(), player.getPitch(), point)) continue;
            if (blocked(player.getEntityWorld(), eye, point, player)) continue;
            return true;
        }
        return false;
    }

    /**
     * Points on the entity worth testing.
     *
     * One point at the centre fails badly in both directions: a figure whose
     * head is over a wall reads as hidden, and one visible only by a fingertip
     * reads as watched. Seven points — the middle, the crown, the feet and the
     * four upright edges — is enough that anything genuinely poking out of
     * cover counts, without turning this into a real occlusion query.
     */
    private static Vec3d[] samples(Box box) {
        double midY = (box.minY + box.maxY) / 2.0;
        double midX = (box.minX + box.maxX) / 2.0;
        double midZ = (box.minZ + box.maxZ) / 2.0;

        // Just inside the box, so an edge sample is not swallowed by the wall
        // the entity is standing against.
        double inset = 0.05;

        return new Vec3d[]{
                new Vec3d(midX, midY, midZ),
                new Vec3d(midX, box.maxY - inset, midZ),
                new Vec3d(midX, box.minY + inset, midZ),
                new Vec3d(box.minX + inset, midY, box.minZ + inset),
                new Vec3d(box.maxX - inset, midY, box.minZ + inset),
                new Vec3d(box.minX + inset, midY, box.maxZ - inset),
                new Vec3d(box.maxX - inset, midY, box.maxZ - inset)
        };
    }

    /** The same question, for callers that already have vectors. */
    public static boolean inView(Vec3d eye, float yaw, float pitch, Vec3d point) {
        return inView(eye.x, eye.y, eye.z, yaw, pitch, point.x, point.y, point.z);
    }

    /**
     * Whether a point falls inside the view cone.
     *
     * Yaw and pitch are compared separately rather than as one angle from the
     * centre of the screen, because a screen is a rectangle and a single cone
     * would either clip the corners or reach well past the edges.
     *
     * Deliberately takes nine numbers instead of two vectors. This is the one
     * function in the mod that decides everything, it is pure arithmetic, and
     * written in terms of Vec3d it could only be tested by a JVM holding most
     * of Minecraft — Vec3d carries a codec, which drags in DataFixerUpper,
     * which drags in fastutil, and MathHelper wants joml and Guava before it
     * will hand over four lines of angle wrapping. None of that has anything to
     * do with the question being asked. In doubles it needs nothing at all.
     */
    public static boolean inView(double eyeX, double eyeY, double eyeZ,
                                 float yaw, float pitch,
                                 double x, double y, double z) {
        double dx = x - eyeX;
        double dy = y - eyeY;
        double dz = z - eyeZ;

        double flat = Math.sqrt(dx * dx + dz * dz);
        // Standing inside it. Nobody is going to argue they cannot see that.
        if (flat < 1.0e-4 && Math.abs(dy) < 1.0e-4) return true;

        double towardYaw = Math.toDegrees(Math.atan2(dz, dx)) - 90.0;
        double towardPitch = -Math.toDegrees(Math.atan2(dy, flat));

        return Math.abs(wrap(towardYaw - yaw)) <= HALF_HORIZONTAL
                && Math.abs(wrap(towardPitch - pitch)) <= HALF_VERTICAL;
    }

    /** Degrees folded into -180..180, so 350 and -10 are ten degrees apart. */
    private static double wrap(double degrees) {
        double wrapped = degrees % 360.0;
        if (wrapped >= 180.0) wrapped -= 360.0;
        if (wrapped < -180.0) wrapped += 360.0;
        return wrapped;
    }

    /** Whether the world stands between the eye and the point. */
    private static boolean blocked(World world, Vec3d eye, Vec3d point, PlayerEntity player) {
        RaycastContext context = new RaycastContext(
                eye, point,
                RaycastContext.ShapeType.VISUAL,
                RaycastContext.FluidHandling.NONE,
                player);

        return world.raycast(context).getType() != HitResult.Type.MISS;
    }
}
