package dev.nexuscraft.hollow.entity;

import dev.nexuscraft.hollow.director.Act;
import dev.nexuscraft.hollow.director.Face;
import net.minecraft.entity.EntityType;
import net.minecraft.entity.decoration.ArmorStandEntity;
import net.minecraft.server.network.ServerPlayerEntity;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.util.math.Vec3d;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.random.RandomGenerator;

/**
 * The face on the ball.
 *
 * An invisible armour stand wearing the face as its name, which is a far better
 * trade than it sounds. A custom entity would need a model, a texture, a
 * renderer and a client install, and would then render as a flat quad that has
 * to be manually turned toward the player every tick. A name tag is already
 * billboarded, already legible at distance, already rendered by an unmodified
 * client, and changing the face is one string.
 *
 * It has no position of its own. {@link Ball} is the body — the thing with
 * gravity that rolls and can be picked up — and this hovers exactly above it.
 * Keeping the two apart is what lets the body go into a pocket, into lava, or
 * over a cliff without any of that being the face's problem.
 */
public final class Companion {

    /** One companion per player, remembered so it is not respawned each tick. */
    private static final Map<UUID, UUID> BY_PLAYER = new HashMap<>();

    /**
     * Marks our armour stands, so one can be found again after a restart.
     *
     * A command tag survives saving and reloading and is invisible to the
     * player, which is exactly what is wanted: the face is the custom name and
     * that changes constantly, so it cannot be used to recognise one.
     */
    private static final String TAG = "hollow_companion";

    /**
     * How far above an armour stand its name tag is drawn.
     *
     * Measured, not derived. The face has to land on the ball, and the entity
     * carrying the face is two blocks below where the face appears — which is
     * why every earlier attempt at positioning this put it somewhere nobody was
     * looking.
     */
    private static final double NAME_TAG_OFFSET = 2.2;

    private Companion() {}

    /**
     * The companion for a player, spawning one if it has gone.
     *
     * Returns null only if the world refused the spawn, which the caller should
     * treat as "not today" rather than as an error — a failed spawn during
     * chunk load is normal and retrying next tick costs nothing.
     */
    public static ArmorStandEntity summon(ServerPlayerEntity player, Act act, RandomGenerator random) {
        // 1.21.11 renamed these; getServerWorld() is gone and getPos() is
        // getEntityPos(). The player is always in a ServerWorld here.
        ServerWorld world = (ServerWorld) player.getEntityWorld();
        UUID existing = BY_PLAYER.get(player.getUuid());

        if (existing != null && world.getEntity(existing) instanceof ArmorStandEntity alive && alive.isAlive()) {
            return alive;
        }

        /*
         * Adopt one that is already out there before making another.
         *
         * The map above is memory only, while the companion is a real entity
         * saved with the world. So every restart forgot its companion and
         * spawned a second one standing next to the first — three of them after
         * three restarts, which is what testing this actually turned up. The
         * tag is what makes them findable again; a name would not, because the
         * name is the face and it changes.
         */
        ArmorStandEntity adopted = null;
        for (ArmorStandEntity candidate : world.getEntitiesByClass(ArmorStandEntity.class,
                player.getBoundingBox().expand(48), entity -> entity.getCommandTags().contains(TAG))) {
            if (adopted == null && candidate.isAlive()) {
                adopted = candidate;
            } else {
                // Any beyond the first are leftovers from an earlier run.
                candidate.discard();
            }
        }
        if (adopted != null) {
            BY_PLAYER.put(player.getUuid(), adopted.getUuid());
            return adopted;
        }

        ArmorStandEntity stand = EntityType.ARMOR_STAND.create(world, net.minecraft.entity.SpawnReason.COMMAND);
        if (stand == null) return null;

        stand.addCommandTag(TAG);
        stand.setInvisible(true);
        stand.setNoGravity(true);
        stand.setInvulnerable(true);
        stand.setSilent(true);
        /*
         * Nothing should ever collide with it or hit it. A player who can punch
         * the companion has been told it is an armour stand, and the illusion
         * does not survive that.
         */
        stand.noClip = true;
        stand.setCustomNameVisible(true);
        stand.setCustomName(Face.render(Face.resting(act, random), act));

        Vec3d at = player.getEntityPos();
        stand.refreshPositionAndAngles(at.x, at.y, at.z, player.getYaw(), 0f);

        if (!world.spawnEntity(stand)) return null;
        BY_PLAYER.put(player.getUuid(), stand.getUuid());
        return stand;
    }

    /**
     * Takes the face away, for while he is being carried.
     *
     * A face hanging in the air next to a player who has him in their pocket is
     * the illusion breaking in the most obvious way available, so while he is
     * carried there is simply nothing there.
     */
    public static void despawn(ServerPlayerEntity player) {
        ServerWorld world = (ServerWorld) player.getEntityWorld();
        UUID existing = BY_PLAYER.remove(player.getUuid());
        if (existing != null && world.getEntity(existing) instanceof ArmorStandEntity stand) {
            stand.discard();
        }
        // Any that were saved from an earlier run and never adopted.
        for (ArmorStandEntity stray : world.getEntitiesByClass(ArmorStandEntity.class,
                player.getBoundingBox().expand(48), entity -> entity.getCommandTags().contains(TAG))) {
            stray.discard();
        }
    }

    /** Changes the face without disturbing anything else. */
    public static void setFace(ArmorStandEntity stand, String face, Act act) {
        stand.setCustomName(Face.render(face, act));
    }

    /**
     * Puts the face where the ball is.
     *
     * Set outright rather than eased. Easing was there to stop the face
     * snapping around a player who had turned on the spot, and it is now
     * actively wrong: the ball is a real object doing real physics, and a face
     * that lags a fraction behind it reads as a rendering fault rather than as
     * anything alive.
     */
    public static void faceAt(ArmorStandEntity stand, Vec3d faceTarget) {
        stand.refreshPositionAndAngles(
                faceTarget.x, faceTarget.y - NAME_TAG_OFFSET, faceTarget.z, stand.getYaw(), 0f);
    }

    public static void forget(UUID player) {
        BY_PLAYER.remove(player);
    }
}
