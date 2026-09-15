package dev.nexuscraft.hollow.entity;

import dev.nexuscraft.hollow.director.Act;
import dev.nexuscraft.hollow.Hollow;
import dev.nexuscraft.hollow.director.Face;
import net.minecraft.entity.EntityType;
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
 * This was an invisible armour stand wearing the face as its *name* — "◕‿◕" as
 * a name tag. It was a good trade for a long time: billboarded free, legible at
 * any distance, no model or texture to make, and changing the face was one
 * string. What it cost was that the only character in the mod was punctuation,
 * and a four-act turn from companion to something else was being carried by two
 * circles and an underscore.
 *
 * It is now a real entity with a real mask, so the face is geometry: the eyes
 * are holes that narrow, the mouth opens on the actual audio being spoken, and
 * the last act can take the features away entirely. The director did not have
 * to change — it still chooses a face as a string, and {@link Expression}
 * translates.
 *
 * It has no position of its own. {@link Ball} is the body — the thing with
 * gravity that rolls and can be picked up — and this hovers exactly above it.
 * Keeping the two apart is what lets the body go into a pocket, into lava, or
 * over a cliff without any of that being the face's problem.
 */
public final class Companion {

    /** One companion per player, remembered so it is not respawned each tick. */
    /*
     * The companion itself, not its id.
     *
     * It held ids and looked them up in the world, and that is what put three
     * of him in front of the player: a freshly spawned entity is not in the
     * world's index until the tick after it is spawned, so several calls in one
     * tick each looked, each found nothing, and each spawned another. Advancing
     * an act does exactly that - several beats fire together.
     *
     * A reference is visible the instant it exists. Every use checks it is
     * still alive and still in this world, which is what the lookup was really
     * for.
     */
    private static final Map<UUID, MaskEntity> BY_PLAYER = new HashMap<>();

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
    public static MaskEntity summon(ServerPlayerEntity player, Act act, RandomGenerator random) {
        // 1.21.11 renamed these; getServerWorld() is gone and getPos() is
        // getEntityPos(). The player is always in a ServerWorld here.
        ServerWorld world = (ServerWorld) player.getEntityWorld();

        MaskEntity held = BY_PLAYER.get(player.getUuid());
        if (held != null && held.isAlive() && !held.isRemoved()
                && held.getEntityWorld() == world) {
            return held;
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
        MaskEntity adopted = null;
        for (MaskEntity candidate : world.getEntitiesByClass(MaskEntity.class,
                player.getBoundingBox().expand(48),
                entity -> entity.getCommandTags().contains(TAG))) {
            if (adopted == null && candidate.isAlive()) {
                adopted = candidate;
            } else {
                // Any beyond the first are leftovers from an earlier run.
                candidate.discard();
            }
        }
        if (adopted != null) {
            BY_PLAYER.put(player.getUuid(), adopted);
            return adopted;
        }

        MaskEntity stand = Hollow.MASK.create(world, net.minecraft.entity.SpawnReason.COMMAND);
        if (stand == null) return null;

        stand.addCommandTag(TAG);
        stand.setOwner(player.getUuid());
        stand.setInvulnerable(true);
        stand.setAct(act);
        stand.setExpression(Expression.of(Face.resting(act, random), act));

        Vec3d at = player.getEntityPos();
        stand.refreshPositionAndAngles(at.x, at.y, at.z, player.getYaw(), 0f);

        if (!world.spawnEntity(stand)) return null;
        BY_PLAYER.put(player.getUuid(), stand);
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
        MaskEntity existing = BY_PLAYER.remove(player.getUuid());
        if (existing != null) existing.discard();
        // Any that were saved from an earlier run and never adopted.
        for (MaskEntity stray : world.getEntitiesByClass(MaskEntity.class,
                player.getBoundingBox().expand(48), entity -> entity.getCommandTags().contains(TAG))) {
            stray.discard();
        }
    }

    /**
     * Changes the face without disturbing anything else.
     *
     * Still takes the director's string, so nothing upstream had to learn about
     * the model. The act travels too, because the light inside the mask is the
     * colour the name tag used to be — the same four colours, so anyone who
     * played the old version reads the change without being told.
     */
    public static void setFace(MaskEntity stand, String face, Act act) {
        stand.setAct(act);
        stand.setExpression(Expression.of(face, act));
    }

    /** In the order tools/paint.py writes them; the index is what travels. */
    private static final java.util.List<String> COLOURS = java.util.List.of(
            "amber", "white", "red", "green", "cyan", "violet", "pink", "gold");

    public static int colourIndex(String name) {
        int at = COLOURS.indexOf(name == null ? "" : name.toLowerCase(java.util.Locale.ROOT));
        return at < 0 ? 0 : at;
    }

    public static java.util.List<String> colours() {
        return COLOURS;
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
    /**
     * Says whose he is. Where he goes is his own business.
     *
     * This used to place him, every tick, at a spot worked out from the
     * player's camera — which is why he orbited you and why he could end up
     * standing inside you. He pathfinds now, so the only thing left to tell him
     * is who he is meant to stay near.
     */
    public static void follow(MaskEntity stand, ServerPlayerEntity player) {
        stand.setOwner(player.getUuid());
    }

    /**
     * Keeps his eyes the colour that is currently chosen.
     *
     * Applied every tick rather than only when the face changes, which is where
     * it was and why the setting appeared to do nothing: the director changes
     * his expression every minute or two, so a colour picked in the pause menu
     * sat unapplied until he happened to have a thought. The tracked value only
     * goes over the wire when it actually differs, so re-stating it costs
     * nothing.
     */
    public static void applyColour(MaskEntity stand, String chosen) {
        int index = colourIndex(chosen);
        if (stand.eyeColour() != index) stand.setEyeColour(index);
    }

    public static void faceAt(MaskEntity stand, Vec3d faceTarget) {
        /*
         * No name-tag offset any more.
         *
         * That constant existed because a name tag draws well above the entity
         * carrying it, so the stand had to be sunk to put the text where the
         * face belonged. The mask draws where it is, so the correction is not a
         * smaller number — it is gone, and leaving it would bury the face
         * inside the ball.
         */
        /*
         * Beside the ball, standing on the floor — not on top of it.
         *
         * facePlace() lifts the target half a block, which was right when the
         * thing being placed was a face floating over the body. A figure with
         * feet has to be put down at ground level or he stands in the air with
         * the ball between his ankles.
         */
        stand.refreshPositionAndAngles(
                faceTarget.x + 0.4, faceTarget.y - 0.55, faceTarget.z + 0.4,
                stand.getYaw(), 0f);
    }

    public static void forget(UUID player) {
        BY_PLAYER.remove(player);
    }
}
