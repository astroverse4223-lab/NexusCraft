package dev.nexuscraft.vigil;

import net.minecraft.entity.EntityType;
import net.minecraft.entity.attribute.DefaultAttributeContainer;
import net.minecraft.entity.attribute.EntityAttributes;
import net.minecraft.entity.damage.DamageSource;
import net.minecraft.entity.data.DataTracker;
import net.minecraft.entity.data.TrackedData;
import net.minecraft.entity.data.TrackedDataHandlerRegistry;
import net.minecraft.entity.effect.StatusEffectInstance;
import net.minecraft.entity.effect.StatusEffects;
import net.minecraft.entity.mob.PathAwareEntity;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.server.network.ServerPlayerEntity;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.sound.SoundCategory;
import net.minecraft.sound.SoundEvents;
import net.minecraft.storage.ReadView;
import net.minecraft.storage.WriteView;
import net.minecraft.util.math.Vec3d;
import net.minecraft.world.World;

import java.util.Set;
import java.util.UUID;

/**
 * The thing that followed you home.
 *
 * It has one rule and everything else falls out of it: it cannot move while
 * anybody can see it. Not "slows down", not "pretends" — the position is
 * genuinely never changed on a tick where {@link Observation} says a player has
 * eyes on it. That is what makes looking at it a real action rather than a
 * scripted moment, and it is why the mod works in multiplayer without any extra
 * thought: two people watching from two angles is simply two chances for the
 * test to come back true.
 *
 * It does not attack, it does not path, and it cannot be killed. What it does
 * is get closer, and the only thing you can do about it is stop working and
 * look at it — which costs you the thing you were actually doing, which is the
 * price the whole design is built to charge.
 */
public class FollowerEntity extends PathAwareEntity {

    /** Which tableau it is holding. Sent to the client; it has no animation. */
    private static final TrackedData<Byte> POSE =
            DataTracker.registerData(FollowerEntity.class, TrackedDataHandlerRegistry.BYTE);

    /** Who it came for. Null means it takes the nearest and settles on them. */
    private UUID hunting;

    /**
     * Ticks of unbroken watching.
     *
     * Builds by one a tick under a gaze and falls by four without one, so a
     * flicker behind a torch costs you ground rather than the whole staredown.
     * Nine seconds of standing still is already a lot to ask; losing it to a
     * fencepost would be unfair in a way the rest of this is not.
     */
    private int stare;

    /** Ticks since it last moved, against the config's interval. */
    private int since;

    /** So the first sighting of a night makes a sound and later ones do not. */
    private boolean announced;

    /** Somebody typed this one into existence, so the sun does not end it. */
    private boolean commanded;

    public FollowerEntity(EntityType<? extends PathAwareEntity> type, World world) {
        super(type, world);

        /*
         * No AI at all, and no gravity.
         *
         * It never walks, so a navigator would only ever fight the teleporting;
         * and falling is motion, which is the one thing it is not allowed to do
         * where you can see it. Standing in mid-air after the floor is mined
         * out from under it is not a bug here, it is the best thing that can
         * happen.
         */
        this.setAiDisabled(true);
        this.setNoGravity(true);
        this.setPersistent();
        this.setSilent(true);
        this.experiencePoints = 0;
    }

    public static DefaultAttributeContainer.Builder createFollowerAttributes() {
        return PathAwareEntity.createMobAttributes()
                .add(EntityAttributes.MAX_HEALTH, 20.0)
                .add(EntityAttributes.MOVEMENT_SPEED, 0.0)
                .add(EntityAttributes.FOLLOW_RANGE, 64.0);
    }

    @Override
    protected void initDataTracker(DataTracker.Builder builder) {
        super.initDataTracker(builder);
        builder.add(POSE, (byte) Pose.WAITING.ordinal());
    }

    /** Deliberately none. Everything it does, it does in {@link #tick()}. */
    @Override
    protected void initGoals() {
    }

    /* --------------------------------------------------------------- the loop */

    @Override
    public void tick() {
        super.tick();

        // Whatever else happens, it never drifts.
        this.setVelocity(Vec3d.ZERO);
        this.velocityDirty = false;

        if (!(this.getEntityWorld() instanceof ServerWorld world)) return;

        PlayerEntity target = quarry(world);
        if (target == null) {
            this.discard();
            return;
        }

        /*
         * Daylight ends it, but only out in the daylight.
         *
         * Being safe at dawn is what makes the night mean anything. Being safe
         * at dawn *in a cave* would mean the mod politely turns itself off in
         * the one place it belongs, so the sky has to be visible for it to
         * count.
         */
        if (!commanded && world.isDay() && world.isSkyVisible(this.getBlockPos())) {
            withdraw(world, target, false);
            return;
        }

        boolean watched = Observation.seenByAnyone(world, this);

        if (watched) {
            stare++;
            if (stare >= VigilConfig.get().staredownSeconds * 20) {
                withdraw(world, target, true);
            }
            return;
        }

        stare = Math.max(0, stare - 4);

        double gap = this.getEntityPos().distanceTo(target.getEntityPos());
        if (gap <= Approach.CONTACT && target instanceof ServerPlayerEntity reached) {
            reach(world, reached);
            return;
        }

        if (++since < VigilConfig.get().moveInterval) return;
        since = 0;

        step(world, target, gap);
    }

    /**
     * One move, taken while nobody is looking.
     *
     * The pose is chosen here rather than on a timer, so the posture and the
     * position always change together — the point is that a single glance away
     * costs you a completely different picture when you glance back, and a
     * figure that shifted its arms without moving its feet would only look like
     * an animation glitch.
     */
    private void step(ServerWorld world, PlayerEntity target, double gap) {
        Vec3d landing = Approach.next(world, this, target, VigilConfig.get().stride);
        if (landing == null) return;

        double dx = target.getX() - landing.x;
        double dz = target.getZ() - landing.z;
        float facing = (float) (Math.toDegrees(Math.atan2(dz, dx)) - 90.0);

        this.teleport(world, landing.x, landing.y, landing.z, Set.of(), facing, 0.0f, false);
        this.setYaw(facing);
        this.setBodyYaw(facing);
        this.setHeadYaw(facing);

        setStance(Pose.pick(gap, this.getRandom().nextInt(12)));

        /*
         * One sound, the first time it gets near enough to matter.
         *
         * A noise every time it moved would give away the mechanic in a minute
         * — you would learn the rhythm and stop looking. One cave-drone as it
         * arrives inside your world, and then nothing, teaches you only that
         * something is here.
         */
        if (!announced && gap < 28.0) {
            announced = true;
            world.playSound(null, this.getBlockPos(), SoundEvents.AMBIENT_CAVE.value(),
                    SoundCategory.HOSTILE, 0.6f, 0.6f);
        }
    }

    /**
     * It got to you.
     *
     * The first time it ever reaches a given player it does no damage at all,
     * whatever the config says. That one is an introduction: the lights go out,
     * something is close enough to touch, and then it is not there any more.
     * You are meant to survive it and be unable to explain it. What it costs
     * after that is a number in a file.
     */
    private void reach(ServerWorld world, ServerPlayerEntity player) {
        int before = Haunting.contacts(player.getUuid());

        world.playSound(null, player.getBlockPos(), SoundEvents.ENTITY_ENDERMAN_STARE,
                SoundCategory.HOSTILE, 1.0f, 0.5f);

        player.addStatusEffect(new StatusEffectInstance(StatusEffects.BLINDNESS, 60, 0, false, false));
        player.addStatusEffect(new StatusEffectInstance(StatusEffects.DARKNESS, 400, 0, false, false));

        double damage = before == 0 ? 0.0 : VigilConfig.get().contactDamage * Math.min(before, 3);
        if (damage > 0.0) {
            player.damage(world, world.getDamageSources().magic(), (float) damage);
        }

        Haunting.reached(player.getUuid());
        this.discard();
    }

    /**
     * It leaves — beaten, or because the sun came up.
     *
     * Beaten is worth a sound and a stretch of quiet, because the player earned
     * it by standing still in the dark for nine seconds, and the reward for
     * that has to be something they can feel. Dawn is worth nothing; it simply
     * is not there any more.
     */
    private void withdraw(ServerWorld world, PlayerEntity target, boolean beaten) {
        if (beaten) {
            world.playSound(null, this.getBlockPos(), SoundEvents.ENTITY_ENDERMAN_TELEPORT,
                    SoundCategory.HOSTILE, 0.8f, 0.4f);
            Haunting.rest(target.getUuid(), VigilConfig.get().dormantMinutes);
        }
        this.discard();
    }

    /**
     * Who it is after.
     *
     * It keeps the one it was sent for and does not swap: a thing that
     * retargets is a mob, and a thing that has decided about you specifically
     * is the premise. Nobody to follow means nothing to be, so it goes.
     */
    private PlayerEntity quarry(ServerWorld world) {
        if (hunting != null) {
            PlayerEntity chosen = world.getPlayerByUuid(hunting);
            if (chosen == null || chosen.isSpectator() || Haunting.dormant(hunting)) return null;
            return chosen;
        }

        PlayerEntity nearest = world.getClosestPlayer(this, 96.0);
        if (nearest == null) return null;
        hunting = nearest.getUuid();
        return nearest;
    }

    /* ------------------------------------------------------------ the outside */

    public void setQuarry(UUID who) {
        this.hunting = who;
    }

    public void setCommanded(boolean commanded) {
        this.commanded = commanded;
    }

    public UUID quarry() {
        return hunting;
    }

    public Pose stance() {
        return Pose.byId(this.dataTracker.get(POSE));
    }

    public void setStance(Pose pose) {
        this.dataTracker.set(POSE, (byte) pose.ordinal());
    }

    /** Seconds of gaze it is currently holding, for the command to report. */
    public int stareTicks() {
        return stare;
    }

    /* --------------------------------------------------------------- the rules */

    /**
     * Nothing hurts it.
     *
     * A killable one is a one-night mod: the first player to bring a bow ends
     * it forever and the rule it is built on stops mattering. Swinging still
     * connects, so the sword and the arrow both arrive and do nothing, which is
     * a much better answer than passing through it.
     */
    @Override
    public boolean damage(ServerWorld world, DamageSource source, float amount) {
        return false;
    }

    @Override
    public boolean isPushable() {
        return false;
    }

    @Override
    public void pushAwayFrom(net.minecraft.entity.Entity entity) {
    }

    @Override
    public boolean canUsePortals(boolean allowVehicles) {
        return false;
    }

    /** It does not despawn on its own; it leaves when it has a reason to. */
    @Override
    public boolean canImmediatelyDespawn(double distanceSquared) {
        return false;
    }

    @Override
    protected void writeCustomData(WriteView view) {
        super.writeCustomData(view);
        if (hunting != null) view.putString("Hunting", hunting.toString());
        view.putInt("Stare", stare);
        view.putBoolean("Announced", announced);
        view.putBoolean("Commanded", commanded);
        view.putInt("Pose", stance().ordinal());
    }

    @Override
    protected void readCustomData(ReadView view) {
        super.readCustomData(view);

        String who = view.getString("Hunting", "");
        if (!who.isEmpty()) {
            try {
                hunting = UUID.fromString(who);
            } catch (IllegalArgumentException ignored) {
                hunting = null;
            }
        }

        stare = view.getInt("Stare", 0);
        announced = view.getBoolean("Announced", false);
        commanded = view.getBoolean("Commanded", false);
        setStance(Pose.byId((byte) view.getInt("Pose", Pose.WAITING.ordinal())));
    }
}
