package dev.nexuscraft.hollow.entity;

import dev.nexuscraft.hollow.director.Act;
import net.minecraft.entity.EntityType;
import net.minecraft.entity.attribute.DefaultAttributeContainer;
import net.minecraft.entity.attribute.EntityAttributes;
import net.minecraft.entity.damage.DamageSource;
import net.minecraft.entity.data.DataTracker;
import net.minecraft.entity.data.TrackedData;
import net.minecraft.entity.data.TrackedDataHandlerRegistry;
import net.minecraft.entity.mob.PathAwareEntity;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.storage.ReadView;
import net.minecraft.storage.WriteView;
import net.minecraft.util.math.MathHelper;
import net.minecraft.util.math.Vec3d;
import net.minecraft.world.World;

/**
 * Hollow, with a body at last.
 *
 * It was a name tag. An invisible armour stand whose custom name was "◕‿◕",
 * which was a genuinely clever trade — billboarded for free, legible at any
 * distance, no model, no texture, no renderer, works on an unmodified client —
 * and which had exactly one problem: the character was punctuation. Everything
 * the director does, the whole four-act turn from companion to something else,
 * was being carried by two circles and an underscore.
 *
 * So: a mask. Not a head — a mask, and an empty one, which is where the mod
 * got its name and what nothing in it has ever shown. The face is a shell. Turn
 * it and you see straight into the back of it, and there is nothing in there
 * but the light. That is the whole design; everything below serves it.
 *
 * It never lands and it cannot be hit. The body that can be picked up, dropped,
 * thrown and lost down a ravine is still {@link Ball} — keeping those apart is
 * what lets the ball go into lava without the face being anybody's problem.
 */
public class MaskEntity extends PathAwareEntity {

    private static final TrackedData<Byte> EXPRESSION =
            DataTracker.registerData(MaskEntity.class, TrackedDataHandlerRegistry.BYTE);

    private static final TrackedData<Byte> ACT =
            DataTracker.registerData(MaskEntity.class, TrackedDataHandlerRegistry.BYTE);

    /**
     * Which colour burns in the eyes and mouth.
     *
     * An index rather than a packed colour, because the light is a texture and
     * not a tint — the glow layer is drawn at full brightness, and full
     * brightness multiplied by a colour is just that colour, so the two-tone
     * hot centre would be flattened out. Eight painted textures keep the
     * gradient and cost nothing to switch between.
     */
    private static final TrackedData<Byte> EYE_COLOUR =
            DataTracker.registerData(MaskEntity.class, TrackedDataHandlerRegistry.BYTE);

    /** How many colours are painted. Must match tools/paint.py. */
    public static final int COLOURS = 8;

    /**
     * How he feels about you, 0 to 100.
     *
     * Sent to the client because that is where it has to be drawn, and put on
     * the entity rather than in a packet of its own because the entity is
     * already being synchronised and is the thing the feeling belongs to.
     */
    private static final TrackedData<Byte> MOOD =
            DataTracker.registerData(MaskEntity.class, TrackedDataHandlerRegistry.BYTE);

    /**
     * Where he stands relative to the player.
     *
     * Slightly behind and to one side — a pace off your shoulder, which is
     * where a person walks with someone. Directly in front puts him in your
     * crosshair, and directly behind means you never see him at all.
     */


    /** Beyond this it stops drifting and simply appears. */
    private static final double TELEPORT_DISTANCE = 18.0;

    /** Drives the float and the drift; advanced on both sides. */
    private float phase;

    /**
     * How much he is walking, and how far through the stride he is.
     *
     * Worked out from how far he actually moved, rather than read off the
     * entity's own limb tracking — that is driven by the physics engine, and he
     * has none. He is placed each tick, so as far as vanilla is concerned he
     * never moves at all and his legs would never swing.
     */
    private float walkPhase;
    private float walkAmount;

    public MaskEntity(EntityType<? extends PathAwareEntity> type, World world) {
        super(type, world);
        /*
         * He walks. Properly, like anything else in the world.
         *
         * Two earlier versions of this got it wrong in opposite directions.
         * The first gave him gravity and collision but no navigator, so terrain
         * fought the placement and he wedged on the first fence. The second
         * took the physics away and slid him about with arithmetic, which never
         * got stuck and never looked like a person either — it looked like a
         * cursor.
         *
         * The answer was the work I skipped: give him a navigator and let him
         * pathfind. He steps up blocks, walks round walls, and gets stuck
         * occasionally, which is what everything else in Minecraft does.
         */
        this.setNoGravity(false);
        this.setPersistent();
        this.setSilent(true);
        this.experiencePoints = 0;
    }

    public static DefaultAttributeContainer.Builder createMaskAttributes() {
        return PathAwareEntity.createMobAttributes()
                .add(EntityAttributes.MAX_HEALTH, 8.0)
                /*
                 * A shade under a player's walk.
                 *
                 * It was zero, left over from when he was placed rather than
                 * moved — a navigator with no speed plots a path and then
                 * stands on it. Slightly slower than you is deliberate: he
                 * falls behind on a sprint, which is when he blinks.
                 */
                .add(EntityAttributes.MOVEMENT_SPEED, 0.26)
                .add(EntityAttributes.FOLLOW_RANGE, 32.0)
                /*
                 * A touch shorter than the player.
                 *
                 * Level with you he reads as a second player; slightly under it
                 * he reads as a companion. It is a small difference and it is
                 * most of whether he feels like he belongs to you.
                 */
                .add(EntityAttributes.SCALE, 0.88);
    }

    @Override
    protected void initDataTracker(DataTracker.Builder builder) {
        super.initDataTracker(builder);
        builder.add(EXPRESSION, (byte) Expression.CALM.ordinal());
        builder.add(ACT, (byte) Act.COMPANION.ordinal());
        builder.add(EYE_COLOUR, (byte) 0);
        builder.add(MOOD, (byte) 100);
    }

    /**
     * How he decides where to be.
     *
     * Ordinary mob goals, in the ordinary way, because "acts like a normal
     * player" is a pathfinding problem and not an animation one. Keeping near
     * you outranks wandering, wandering outranks standing still, and looking at
     * you runs alongside all of it — so he holds your gaze while he is stopped
     * and breaks it to watch where he is going, which is what people do.
     */
    @Override
    protected void initGoals() {
        this.goalSelector.add(0, new net.minecraft.entity.ai.goal.SwimGoal(this));
        this.goalSelector.add(1, new KeepNearGoal());
        this.goalSelector.add(2, new net.minecraft.entity.ai.goal.WanderAroundFarGoal(this, 0.7));
        this.goalSelector.add(3, new net.minecraft.entity.ai.goal.LookAtEntityGoal(
                this, net.minecraft.entity.player.PlayerEntity.class, 16.0f));
        this.goalSelector.add(4, new net.minecraft.entity.ai.goal.LookAroundGoal(this));
    }

    /**
     * Walks back toward the person he belongs to when he has drifted too far.
     *
     * The distance is the arc. As a companion he stays close enough to talk to;
     * by the last act he is content to be most of a chunk away, which is the
     * point at which "following you" has quietly become "in the same area as
     * you" without anything having been announced.
     */
    private final class KeepNearGoal extends net.minecraft.entity.ai.goal.Goal {

        private net.minecraft.entity.player.PlayerEntity following;

        KeepNearGoal() {
            this.setControls(java.util.EnumSet.of(Control.MOVE));
        }

        @Override
        public boolean canStart() {
            net.minecraft.entity.player.PlayerEntity player = owner();
            if (player == null) return false;
            if (MaskEntity.this.squaredDistanceTo(player) < keepWithin() * keepWithin()) return false;

            this.following = player;
            return true;
        }

        @Override
        public boolean shouldContinue() {
            return this.following != null
                    && !MaskEntity.this.getNavigation().isIdle()
                    && MaskEntity.this.squaredDistanceTo(this.following) > 9.0;
        }

        @Override
        public void start() {
            MaskEntity.this.getNavigation().startMovingTo(this.following, 1.0);
        }

        @Override
        public void stop() {
            this.following = null;
            MaskEntity.this.getNavigation().stop();
        }

        @Override
        public void tick() {
            if (this.following == null) return;
            MaskEntity.this.getLookControl().lookAt(this.following, 30.0f, 30.0f);

            if (MaskEntity.this.getNavigation().isIdle()) {
                MaskEntity.this.getNavigation().startMovingTo(this.following, 1.0);
            }
        }
    }

    /** How far he will drift before coming back, by act. */
    private double keepWithin() {
        return switch (act()) {
            case COMPANION -> 6.0;
            case UNEASE -> 9.0;
            case WATCHING -> 14.0;
            case HOLLOW -> 20.0;
        };
    }

    /** The player he belongs to, if they are here. */
    private net.minecraft.entity.player.PlayerEntity owner() {
        if (ownerId == null) return this.getEntityWorld().getClosestPlayer(this, 48.0);
        return this.getEntityWorld().getPlayerByUuid(ownerId);
    }

    public void setOwner(java.util.UUID who) {
        this.ownerId = who;
    }

    private java.util.UUID ownerId;

    /** Where he was last tick, for working out the stride. */
    private Vec3d wasAt;



    @Override
    public void tick() {
        super.tick();
        phase += 1.0f;

        /*
         * And now and then he is simply somewhere else.
         *
         * Left in even though he walks properly now, because it is the whole
         * difference between a companion and the thing this becomes. He paths
         * around the world like anything else, and once in a while he does not
         * — and the fact that he normally *does* is what makes the exception
         * land.
         */
        if (this.getEntityWorld() instanceof ServerWorld) {
            net.minecraft.entity.player.PlayerEntity near = owner();
            if (near != null && this.squaredDistanceTo(near) < 64.0 * 64.0) {
                blinkedNear(near);
            }
        }

        Vec3d now = this.getEntityPos();
        if (wasAt != null) {
            double dx = now.x - wasAt.x;
            double dz = now.z - wasAt.z;
            double moved = Math.sqrt(dx * dx + dz * dz);

            // Eased both ways, so he does not start and stop like a switch.
            float want = (float) Math.min(1.0, moved * 9.0);
            walkAmount += (want - walkAmount) * 0.35f;
            walkPhase += (float) moved * 9.0f;
        }
        wasAt = now;
    }

    public float walkAmount() {
        return walkAmount;
    }

    public float walkPhase() {
        return walkPhase;
    }

    /**
     * Walks him to a spot beside the player, standing on whatever is there.
     *
     * Eased rather than snapped, so he crosses the room instead of appearing in
     * it — at this speed he reads as walking, which is the whole reason he has
     * legs. Past a certain distance easing stops being walking and starts being
     * a very slow chase, so beyond that he simply arrives.
     */
    /**
     * Sometimes he does not walk. He is simply somewhere else.
     *
     * The single most unsettling thing a companion can do, and it costs almost
     * nothing: no animation, no sound, no warning. You look away, you look
     * back, and he is behind you — and because he walks normally the rest of
     * the time, the one that was a cut stands out.
     *
     * Weighted toward the space behind the player on purpose. Appearing in
     * front is a magic trick and reads as a spawn; appearing behind reads as
     * having been there for a while.
     *
     * How often is the arc. In the first act it is rare enough to be doubted,
     * which is exactly the note that act is written in — the player should
     * wonder whether they simply were not paying attention. By the last it is
     * most of how he moves.
     */
    private boolean blinkedNear(net.minecraft.entity.player.PlayerEntity player) {
        int oddsPerTick = switch (act()) {
            case COMPANION -> 3600;
            case UNEASE -> 1400;
            case WATCHING -> 600;
            case HOLLOW -> 260;
        };

        if (this.random.nextInt(oddsPerTick) != 0) return false;

        Vec3d look = player.getRotationVec(1.0f);
        Vec3d flat = new Vec3d(look.x, 0.0, look.z);
        if (flat.lengthSquared() < 1.0e-4) return false;
        flat = flat.normalize();

        // Behind, mostly: a quarter turn either side of straight back.
        double swing = (this.random.nextDouble() - 0.5) * Math.PI * 0.9;
        double cos = Math.cos(swing);
        double sin = Math.sin(swing);
        Vec3d away = new Vec3d(
                -flat.x * cos - flat.z * sin, 0.0,
                -flat.z * cos + flat.x * sin);

        double distance = 3.5 + this.random.nextDouble() * 4.5;
        Vec3d spot = player.getEntityPos().add(away.multiply(distance));

        this.refreshPositionAndAngles(spot.x, floorUnder(spot), spot.z, this.getYaw(), 0.0f);

        /*
         * The stride is zeroed as well as the position.
         *
         * Without it he arrives mid-step and keeps walking on the spot for a
         * moment, which turns a cut into a glitch — the legs give away that
         * something moved him rather than that he moved.
         */
        walkAmount = 0.0f;
        wasAt = this.getEntityPos();

        // Whatever he was walking toward, he is not walking toward it now.
        this.getNavigation().stop();

        faceToward(player.getEyePos());
        return true;
    }

    /**
     * The top of whatever he is standing over.
     *
     * Searched from a little above him downward, so he steps up onto a block
     * as readily as he steps off one. Without the upward slack he sinks into
     * every staircase he walks up, because the search starts inside the step.
     */
    private double floorUnder(Vec3d at) {
        net.minecraft.util.math.BlockPos.Mutable probe =
                new net.minecraft.util.math.BlockPos.Mutable(
                        net.minecraft.util.math.MathHelper.floor(at.x),
                        net.minecraft.util.math.MathHelper.floor(at.y + 1.5),
                        net.minecraft.util.math.MathHelper.floor(at.z));

        for (int drop = 0; drop < 8; drop++) {
            if (!this.getEntityWorld().getBlockState(probe).isAir()) {
                return probe.getY() + 1.0;
            }
            probe.move(0, -1, 0);
        }

        // Nothing under him at all — over a ravine, say. Hold his height.
        return at.y;
    }

    /**
     * Turns to face a point, on the level.
     *
     * Yaw only. Pitching the whole entity toward a player standing on a hill
     * tips the figure over backwards, because there is nothing here that
     * separates a head from a body — he leans as one piece, like a felled tree.
     */
    public void faceToward(Vec3d point) {
        Vec3d toward = point.subtract(this.getEntityPos());
        float yaw = (float) (MathHelper.atan2(toward.z, toward.x) * 57.2957795) - 90.0f;

        this.setYaw(yaw);
        this.setBodyYaw(yaw);
        this.setHeadYaw(yaw);
        this.setPitch(0.0f);

        /*
         * And the previous frame's rotation too.
         *
         * Rendering interpolates between last tick and this one. Setting only
         * the current value leaves him permanently halfway through a turn he
         * never finishes, which reads as a figure that is always facing very
         * slightly the wrong way — which is exactly what it looked like.
         */
        this.lastYaw = yaw;
        this.lastBodyYaw = yaw;
        this.lastHeadYaw = yaw;
    }

    /* ------------------------------------------------------------- the face */

    public Expression expression() {
        return Expression.byId(this.dataTracker.get(EXPRESSION));
    }

    public void setExpression(Expression expression) {
        this.dataTracker.set(EXPRESSION, (byte) expression.ordinal());
    }

    public Act act() {
        Act[] all = Act.values();
        byte id = this.dataTracker.get(ACT);
        return id >= 0 && id < all.length ? all[id] : Act.COMPANION;
    }

    public void setAct(Act act) {
        this.dataTracker.set(ACT, (byte) act.ordinal());
    }

    public int eyeColour() {
        return Math.floorMod(this.dataTracker.get(EYE_COLOUR), COLOURS);
    }

    public void setEyeColour(int colour) {
        this.dataTracker.set(EYE_COLOUR, (byte) Math.floorMod(colour, COLOURS));
    }

    public int mood() {
        return Math.max(0, Math.min(100, this.dataTracker.get(MOOD)));
    }

    public void setMood(int mood) {
        int clamped = Math.max(0, Math.min(100, mood));
        if (mood() != clamped) this.dataTracker.set(MOOD, (byte) clamped);
    }

    public float phase() {
        return phase;
    }

    /**
     * Right-click him and he goes in your pocket.
     *
     * This used to be done to a separate item entity rolling about on the
     * floor — the ball, which was his whole body before he had one. Once he had
     * a body the ball was a second Hollow following you around, and there is no
     * reading of that which is not confusing: the player sees a person and a
     * spinning yellow disc and has to be told which one is the character.
     *
     * So the figure is the thing now. The ball survives as what he looks like
     * in an inventory slot, which is the one place a person cannot go.
     */
    @Override
    public net.minecraft.util.ActionResult interactMob(
            net.minecraft.entity.player.PlayerEntity player, net.minecraft.util.Hand hand) {

        if (!(this.getEntityWorld() instanceof ServerWorld)) return net.minecraft.util.ActionResult.SUCCESS;

        net.minecraft.item.ItemStack stack = Ball.stack();
        if (!player.getInventory().insertStack(stack)) {
            player.dropItem(stack, false);
        }

        this.getEntityWorld().playSound(null, this.getX(), this.getY(), this.getZ(),
                net.minecraft.sound.SoundEvents.ENTITY_ITEM_PICKUP,
                net.minecraft.sound.SoundCategory.PLAYERS, 0.5f, 1.4f);

        this.discard();
        return net.minecraft.util.ActionResult.SUCCESS;
    }

    /* ------------------------------------------------------------- the rules */

    /**
     * Nothing touches it.
     *
     * The ball is the part of Hollow you are allowed to have a relationship
     * with — hold it, drop it, lose it. The face is not an object, and letting
     * somebody punch it out of the air would answer a question the last act is
     * built on leaving open.
     */
    @Override
    public boolean damage(ServerWorld world, DamageSource source, float amount) {
        /*
         * He still takes no damage — but he notices.
         *
         * Swinging at him used to return false and nothing else, so the most
         * direct thing a player can do to him was the one thing he could not
         * react to at all. He cannot be hurt; that is not the same as not
         * minding.
         */
        if (source.getAttacker() instanceof net.minecraft.entity.player.PlayerEntity who) {
            dev.nexuscraft.hollow.Hollow.tookOffence(who.getUuid(), world.getTimeOfDay());

            world.playSound(null, this.getX(), this.getY(), this.getZ(),
                    net.minecraft.sound.SoundEvents.BLOCK_AMETHYST_BLOCK_HIT,
                    net.minecraft.sound.SoundCategory.NEUTRAL, 0.7f, 0.5f);
        }
        return false;
    }

    /**
     * Clickable, so he can be picked up — but never hittable.
     *
     * canHit covers both in vanilla, so the two are separated here: attacks are
     * refused in damage() above, and this stays true so a right-click reaches
     * him at all. Without it he cannot be interacted with and the only way to
     * carry him is a command.
     */
    @Override
    public boolean canHit() {
        return true;
    }

    @Override
    public boolean isAttackable() {
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
    public boolean canImmediatelyDespawn(double distanceSquared) {
        return false;
    }

    @Override
    protected void writeCustomData(WriteView view) {
        super.writeCustomData(view);
        view.putInt("Expression", expression().ordinal());
        view.putInt("Act", act().ordinal());
        view.putInt("EyeColour", eyeColour());
    }

    @Override
    protected void readCustomData(ReadView view) {
        super.readCustomData(view);
        setExpression(Expression.byId((byte) view.getInt("Expression", Expression.CALM.ordinal())));

        Act[] all = Act.values();
        int act = view.getInt("Act", 0);
        setAct(act >= 0 && act < all.length ? all[act] : Act.COMPANION);
        setEyeColour(view.getInt("EyeColour", 0));
    }
}
