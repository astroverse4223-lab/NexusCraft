package dev.nexuscraft.hollow.entity;

import dev.nexuscraft.hollow.director.Act;
import net.minecraft.entity.EntityType;
import net.minecraft.entity.SpawnReason;
import net.minecraft.entity.attribute.EntityAttributes;
import net.minecraft.entity.mob.VexEntity;
import net.minecraft.server.network.ServerPlayerEntity;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.text.Text;
import net.minecraft.util.Formatting;
import net.minecraft.util.math.Vec3d;

import java.util.List;
import java.util.random.RandomGenerator;

/**
 * The thing that comes for you.
 *
 * Deliberately not the companion. The first version of this turned the face
 * into the monster, and losing it costs more than it gives: the companion is
 * the only character in the mod, and transforming it ends the relationship at
 * exactly the moment the relationship is worth the most.
 *
 * So the face stays. It keeps floating beside your shoulder while this hunts
 * you, and it does not help. Everything the last act does — hanging back,
 * answering less, the smile that stopped being a smile — reads differently once
 * something else is in the room and the companion is simply watching. That is
 * the horror the arc was building: not that it became a monster, but that it
 * stopped being on your side and never had to change shape to do it.
 *
 * A vex underneath, because a vex flies and a vex ignores walls, so the place
 * you decided was safe is not and nothing had to explain that to you. It used
 * to be a *plain* vex — a small blue imp — on the grounds that a custom mob
 * would need a client install. That reasoning died the day this mod started
 * shipping one, and it left the best idea in the arc wearing nothing.
 *
 * So the behaviour is still a vex and the appearance is {@link HunterEntity}:
 * his silhouette, his light, stretched into something that never walked.
 *
 * It can be killed. That matters — a hunter you cannot fight is a cutscene, and
 * a player who dies to something unbeatable stops playing rather than gets
 * frightened. It also comes back, which matters more.
 */
public final class Hunter {

    private Hunter() {}

    /** Marks ours, so it can be found again and never duplicated. */
    private static final String TAG = "hollow_hunter";

    /**
     * Tougher than a vex, but not by much.
     *
     * A vex has 14 health and hits hard. Doubling the health makes it a fight
     * rather than a swat, while leaving its damage alone keeps it survivable
     * for someone in iron. The intent is a bad night, not a lost world.
     */
    private static final double HEALTH = 30.0;

    /**
     * Slower than a vex flies by default.
     *
     * A stock vex crossed fifteen blocks in four seconds in testing, which is
     * an ambush — you are hit before you have understood that something is
     * there. Halved, it arrives as a shape that gets closer, which is the
     * difference between being startled and being hunted. It still catches
     * anyone who stands still.
     */
    private static final double SPEED = 0.35;

    /** Whether something of ours is already after this player. */
    public static HunterEntity current(ServerWorld world, ServerPlayerEntity player) {
        List<HunterEntity> found = world.getEntitiesByClass(HunterEntity.class,
                player.getBoundingBox().expand(96),
                entity -> entity.getCommandTags().contains(TAG) && entity.isAlive());
        return found.isEmpty() ? null : found.get(0);
    }

    /**
     * Sends it after them.
     *
     * Spawned behind and above, at a distance — far enough that the first thing
     * you get is the sound of it, not the thing itself.
     */
    public static HunterEntity release(ServerPlayerEntity player, RandomGenerator random) {
        ServerWorld world = (ServerWorld) player.getEntityWorld();

        // Never two at once. Being hunted by a crowd is a different, worse game.
        HunterEntity existing = current(world, player);
        if (existing != null) return existing;

        HunterEntity hunter = dev.nexuscraft.hollow.Hollow.HUNTER.create(world, SpawnReason.EVENT);
        if (hunter == null) return null;

        hunter.addCommandTag(TAG);

        /*
         * It takes his light with it.
         *
         * Read off the companion standing next to the player rather than from
         * the config, so if they changed his eyes an hour ago the thing that
         * comes through the wall has the colour they chose — which is the whole
         * reason to have the colour be a choice.
         */
        var beside = world.getEntitiesByClass(MaskEntity.class,
                player.getBoundingBox().expand(48.0), any -> true);
        hunter.setEyeColour(beside.isEmpty() ? 0 : beside.get(0).eyeColour());
        hunter.setCustomName(Text.literal("╳_╳").formatted(Formatting.DARK_RED));
        hunter.setCustomNameVisible(true);

        // Persistent, or it despawns while the player is running away from it,
        // which reads as the game having flinched.
        hunter.setPersistent();

        var health = hunter.getAttributeInstance(EntityAttributes.MAX_HEALTH);
        if (health != null) health.setBaseValue(HEALTH);
        hunter.setHealth((float) HEALTH);

        var speed = hunter.getAttributeInstance(EntityAttributes.FLYING_SPEED);
        if (speed != null) speed.setBaseValue(SPEED);
        var movement = hunter.getAttributeInstance(EntityAttributes.MOVEMENT_SPEED);
        if (movement != null) movement.setBaseValue(SPEED);

        double angle = Math.toRadians(player.getYaw() + 180 + (random.nextDouble() - 0.5) * 120);
        double distance = 14 + random.nextInt(8);
        Vec3d at = new Vec3d(
                player.getX() + Math.sin(angle) * distance,
                player.getY() + 3 + random.nextInt(3),
                player.getZ() - Math.cos(angle) * distance
        );
        hunter.refreshPositionAndAngles(at.x, at.y, at.z, player.getYaw(), 0f);

        if (!world.spawnEntity(hunter)) return null;

        hunter.setTarget(player);
        return hunter;
    }

    /** Calls it off — used when the act is not the last one any more. */
    public static void recall(ServerWorld world, ServerPlayerEntity player) {
        HunterEntity hunter = current(world, player);
        if (hunter != null) hunter.discard();
    }

    /**
     * Whether the hunt may begin at all.
     *
     * Only in the last act, and only at night. Night is not decoration: it is
     * the one time the player is already indoors, already listening, and
     * already has somewhere they think is safe.
     */
    public static boolean conditionsMet(ServerWorld world, Act act) {
        if (act != Act.HOLLOW) return false;
        long time = world.getTimeOfDay() % 24000L;
        return time >= 13000 && time <= 23000;
    }
}
