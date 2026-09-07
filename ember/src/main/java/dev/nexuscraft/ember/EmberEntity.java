package dev.nexuscraft.ember;

import net.minecraft.entity.EntityType;
import net.minecraft.entity.LivingEntity;
import net.minecraft.entity.attribute.DefaultAttributeContainer;
import net.minecraft.entity.attribute.EntityAttributes;
import net.minecraft.entity.damage.DamageSource;
import net.minecraft.entity.data.DataTracker;
import net.minecraft.entity.data.TrackedData;
import net.minecraft.entity.data.TrackedDataHandlerRegistry;
import net.minecraft.entity.mob.Monster;
import net.minecraft.entity.mob.PathAwareEntity;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.particle.ParticleTypes;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.sound.SoundCategory;
import net.minecraft.sound.SoundEvents;
import net.minecraft.storage.ReadView;
import net.minecraft.storage.WriteView;
import net.minecraft.util.math.Box;
import net.minecraft.util.math.MathHelper;
import net.minecraft.util.math.Vec3d;
import net.minecraft.world.World;

import java.util.List;
import java.util.UUID;

/**
 * A lantern that decided to follow someone.
 *
 * It hovers at about knee height, never lands, and spends itself burning back
 * the dark the player is walking into. Movement is steered directly rather than
 * pathfound: a thing with no legs has no business asking the navigator how to
 * walk somewhere, and steering cannot get wedged in a doorway the way a ground
 * path can.
 */
public class EmberEntity extends PathAwareEntity {

    private static final TrackedData<Byte> MOOD =
            DataTracker.registerData(EmberEntity.class, TrackedDataHandlerRegistry.BYTE);

    /** Tracked so the client can pose it in the hand rather than mid-air. */
    private static final TrackedData<Byte> CARRY =
            DataTracker.registerData(EmberEntity.class, TrackedDataHandlerRegistry.BYTE);

    /**
     * How grown it is, sent to the client.
     *
     * The client cannot read the growth file — it is the server's — and the
     * flame is drawn client-side, so the stage has to travel with the entity
     * like the mood does.
     */
    private static final TrackedData<Byte> STAGE =
            DataTracker.registerData(EmberEntity.class, TrackedDataHandlerRegistry.BYTE);

    /**
     * Where it sits relative to the player.
     *
     * Forward and out to the left, at head height. The first version tucked it
     * behind the shoulder so it would not block the view, which succeeded
     * completely: it was never in the view at all, and a companion you cannot
     * see is just a noise in the dark. Ahead and off to one side keeps it in
     * peripheral vision without sitting on the crosshair.
     */
    /*
     * Above the eyeline, slightly ahead and a little to one side.
     *
     * This took three wrong answers. Behind the shoulder it was never in view
     * at all. A metre in front put it squarely on the crosshair, so mining a
     * block swung at the lantern instead. Out to the side hid it again and
     * meant whipping the camera round to click it.
     *
     * Up solves all three, because the crosshair almost never goes there: you
     * look level or down to mine and forward to fight, and a lantern hanging
     * above your eyeline is visible the whole time without ever being in front
     * of what you are aiming at. It is also where you would actually hold a
     * lamp to see by.
     *
     * The eyes sit at 1.62, so 2.15 puts it about half a block above them —
     * roughly twenty-five degrees up at this distance, which is comfortably
     * clear of the crosshair and a small glance away from being clicked.
     */
    private static final double HOVER_HEIGHT = 2.15;
    private static final double HOVER_AHEAD = 0.85;
    private static final double HOVER_SIDE = 0.65;

    /** How far it slides aside when it is sitting on the crosshair. */
    private static final double DODGE = 1.1;

    /** Beyond this it stops trying to fly and simply appears. */
    private static final double TELEPORT_DISTANCE = 22.0;

    /** A hostile this close to the player is worth flaring at. */
    private static final double FLARE_RANGE = 4.0;

    /** Cooldown between flares, in ticks — twelve seconds. */
    private static final int FLARE_COOLDOWN = 240;

    private UUID ownerId;
    private PlayerEntity cachedOwner;

    private final Lightbringer lightbringer = new Lightbringer();

    private int flareCooldown;
    private int sulkTicks;

    /** Drives the bob and the hand sway; advanced client-side too. */
    private float phase;

    /** Ticks left sitting where it was thrown before it comes back. */
    private int plantedFor;

    /** So it only complains about the lava once per dunking. */
    private boolean complainedAboutLava;

    /** How long it has been in the air, to give up on a throw that goes wrong. */
    private int airborne;

    /** Where it is leading, and null when it is not leading anywhere. */
    private net.minecraft.util.math.BlockPos leadingTo;

    /** Ticks since it last said how far there was left to go. */
    private int sinceProgress;

    /** Counts down to the look around after being thrown somewhere. */
    private int surveyIn;

    /** Where it is drifting to while it explores the space it landed in. */
    private Vec3d roamingTo;

    /** The kinds of thing it last described here, so it does not repeat itself. */
    private String saidAbout;

    /** How many more times it may speak about this throw. */
    private int reportsLeft;

    /**
     * What it is carrying for its owner.
     *
     * Sized to the stage it has reached, and resized when it grows — the extra
     * slots are the one reward for growing that can be used rather than only
     * looked at. Never shrunk: an Ember cannot un-grow, and a smaller satchel
     * would have to drop what was in it.
     */
    private net.minecraft.inventory.SimpleInventory satchel =
            new net.minecraft.inventory.SimpleInventory(0);

    public EmberEntity(EntityType<? extends PathAwareEntity> type, World world) {
        super(type, world);
        this.setNoGravity(true);
        this.setPersistent();

        /*
         * It drifts through blocks rather than into them.
         *
         * Steering toward a point beside the player puts that point inside a
         * tree trunk several times a minute in any forest. Solid, it wedged
         * itself in the wood and suffocated — a companion that dies to an oak
         * is not a companion. Passing through is the lesser strangeness, and
         * it is what the vanilla vex does for the same reason.
         */
        this.noClip = true;
    }

    /**
     * The world cannot kill it.
     *
     * Suffocation, falling, fire, drowning, cactus: every one of them was
     * reachable by a thing that hovers where it is told to and cannot choose to
     * step around anything. Being hit by its owner is handled separately — that
     * does not hurt it either, it just stops helping for a while.
     */
    @Override
    public boolean isInvulnerableTo(ServerWorld world, DamageSource source) {
        return true;
    }

    public static DefaultAttributeContainer.Builder createEmberAttributes() {
        return PathAwareEntity.createMobAttributes()
                .add(EntityAttributes.MAX_HEALTH, 12.0)
                .add(EntityAttributes.MOVEMENT_SPEED, 0.4)
                .add(EntityAttributes.FOLLOW_RANGE, 32.0);
    }

    @Override
    protected void initDataTracker(DataTracker.Builder builder) {
        super.initDataTracker(builder);
        builder.add(MOOD, Mood.CONTENT.id());
        builder.add(CARRY, Carry.FOLLOWING.id());
        builder.add(STAGE, Growth.Stage.SPARK.id());
    }

    /* ------------------------------------------------------------- owner */

    public void setOwner(PlayerEntity player) {
        this.ownerId = player.getUuid();
        this.cachedOwner = player;
    }

    public UUID getOwnerId() {
        return ownerId;
    }

    private PlayerEntity owner() {
        if (cachedOwner != null && !cachedOwner.isRemoved()) return cachedOwner;
        if (ownerId == null) return null;
        cachedOwner = this.getEntityWorld().getPlayerByUuid(ownerId);
        return cachedOwner;
    }

    /* -------------------------------------------------------------- mood */

    public Mood getMood() {
        return Mood.byId(this.dataTracker.get(MOOD));
    }

    private void setMood(Mood mood) {
        if (getMood() != mood) this.dataTracker.set(MOOD, mood.id());
    }

    public float getPhase() {
        return phase;
    }

    public Carry getCarry() {
        return Carry.byId(this.dataTracker.get(CARRY));
    }

    public Growth.Stage getStage() {
        return Growth.Stage.byId(this.dataTracker.get(STAGE));
    }

    private void setStage(Growth.Stage stage) {
        if (getStage() != stage) this.dataTracker.set(STAGE, stage.id());
    }

    private void setCarry(Carry state) {
        if (getCarry() != state) this.dataTracker.set(CARRY, state.id());
    }

    /* -------------------------------------------------------------- tick */

    @Override
    public void tick() {
        super.tick();
        phase += 0.1f;

        if (this.getEntityWorld().isClient()) {
            emitFlame();
            return;
        }

        PlayerEntity owner = owner();
        if (owner == null || owner.isRemoved()) {
            // Nobody to keep. Fade rather than linger as scenery — but never
            // take anything with it.
            if (this.age > 200) {
                spillSatchel();
                this.discard();
            }
            return;
        }

        if (flareCooldown > 0) flareCooldown--;
        if (sulkTicks > 0) sulkTicks--;

        /*
         * Once a second: note the day, and pick up any change of stage.
         *
         * Cheap enough to do often and not worth doing every tick — nothing
         * here changes faster than a Minecraft day.
         */
        if (this.age % 20 == 0 && ownerId != null) {
            Growth.seen(ownerId, this.getEntityWorld().getTimeOfDay() / 24000L);
            Growth.Stage now = Growth.stageOf(ownerId);
            if (now != getStage()) {
                Growth.Stage was = getStage();
                setStage(now);
                if (this.age > 100) announceGrowth(owner, was, now);
            }
        }

        mindTheLava(owner);

        Carry state = getCarry();
        if (state == Carry.CARRIED) {
            beCarried(owner);
        } else if (state.follows()) {
            // Leading takes precedence over trailing at the shoulder.
            if (leadingTo != null) lead(owner);
            else follow(owner);
        } else {
            flight(owner);
        }

        decideMood(owner);
        help(owner);
    }

    /**
     * Steers toward a point beside the player rather than pathing to them.
     *
     * The target sits behind the shoulder they are facing away from, so it
     * lights what is ahead without floating through the middle of the view.
     */
    private void follow(PlayerEntity owner) {
        Vec3d facing = Vec3d.fromPolar(0.0f, owner.getYaw()).normalize();
        Vec3d left = new Vec3d(-facing.z, 0.0, facing.x).normalize();

        /*
         * Beside the shoulder rather than out in front.
         *
         * It used to hover a metre ahead, which put it on the crosshair — so
         * left-clicking a block hit the lantern instead and the block never
         * broke. Level with the player and further out keeps it in view without
         * standing in front of the thing being looked at.
         */
        double side = HOVER_SIDE + (onTheCrosshair(owner) ? DODGE : 0.0);

        Vec3d want = owner.getEntityPos()
                .add(facing.multiply(HOVER_AHEAD))
                .add(left.multiply(side))
                .add(0.0, HOVER_HEIGHT, 0.0);

        double distance = this.getEntityPos().distanceTo(want);

        if (distance > TELEPORT_DISTANCE) {
            this.refreshPositionAndAngles(want.x, want.y, want.z, this.getYaw(), this.getPitch());
            this.setVelocity(Vec3d.ZERO);
            return;
        }

        /*
         * It steadies when you look straight at it.
         *
         * Grabbing a thing that hovers, bobs and follows meant chasing it with
         * the crosshair. Noticing that it is being looked at and holding still
         * is both easier to use and better in character than making it slower
         * all the time — it is paying attention to you.
         */
        if (beingReachedFor(owner)) {
            this.setVelocity(this.getVelocity().multiply(0.35));
            this.move(net.minecraft.entity.MovementType.SELF, this.getVelocity());
            this.lookAtEntity(owner, 30.0f, 30.0f);
            this.bodyYaw = this.getYaw();
            return;
        }

        if (distance > 0.35) {
            Vec3d push = want.subtract(this.getEntityPos()).normalize().multiply(Math.min(0.09 * distance, 0.42));
            this.setVelocity(this.getVelocity().multiply(0.72).add(push));
        } else {
            this.setVelocity(this.getVelocity().multiply(0.6));
        }

        // A slow bob, so it never looks parked in mid-air.
        this.setVelocity(this.getVelocity().add(0.0, MathHelper.sin(phase * 0.6f) * 0.004, 0.0));

        // With noClip on, this is a straight translation; nothing to collide with.
        this.move(net.minecraft.entity.MovementType.SELF, this.getVelocity());

        // Turned toward whoever it is following, so the lit face is the one
        // you see rather than the back of the shutters.
        this.lookAtEntity(owner, 30.0f, 30.0f);
        this.bodyYaw = this.getYaw();
    }



    /** Sends it wherever the player is looking. */
    private void throwFrom(PlayerEntity player) {
        setCarry(Carry.THROWN);
        airborne = 0;
        leadingTo = null;

        /*
         * Thrown from the player's hand, wherever it was standing.
         *
         * Now that a throw does not need it caught first, it can be sitting
         * twenty blocks away when the gesture happens — and an arc that starts
         * over there goes somewhere nobody aimed at.
         */
        Vec3d from = player.getEyePos().add(player.getRotationVec(1.0f).normalize().multiply(0.6));
        this.refreshPositionAndAngles(from.x, from.y - 0.2, from.z, player.getYaw(), 0.0f);

        Vec3d aim = player.getRotationVec(1.0f).normalize().multiply(1.15);
        this.setVelocity(aim.x, aim.y + 0.18, aim.z);

        playSound(SoundEvents.ENTITY_ENDER_PEARL_THROW, 0.7f, 1.5f);
    }

    /**
     * In the air, then sitting where it landed, then coming home.
     *
     * The arc is its own rather than the physics engine's: it has no gravity by
     * design, and turning that on and off around a throw is more moving parts
     * than falling slowly on purpose.
     */
    private void flight(PlayerEntity owner) {
        Carry state = getCarry();

        if (state == Carry.THROWN) {
            airborne++;

            /*
             * Solid while it is in the air, and only then.
             *
             * It drifts through blocks the rest of the time so it cannot wedge
             * itself in a tree, but a thrown lantern that ignores the floor
             * falls to the bottom of the world. Collision is turned on for the
             * throw and off again the moment it lands.
             */
            this.noClip = false;

            this.setVelocity(this.getVelocity().multiply(0.97).add(0.0, -0.032, 0.0));
            this.move(net.minecraft.entity.MovementType.SELF, this.getVelocity());

            boolean landed = this.isOnGround()
                    || this.horizontalCollision
                    || this.verticalCollision
                    || this.getVelocity().lengthSquared() < 0.004;

            if (landed || airborne > 120) {
                setCarry(Carry.PLANTED);
                // Long enough to explore a room properly.
                plantedFor = 1200;
                surveyIn = 60;
                reportsLeft = 2;
                saidAbout = null;
                this.setVelocity(Vec3d.ZERO);
                // Back to drifting, so it does not settle inside whatever it
                // happened to bounce off.
                this.noClip = true;
                playSound(SoundEvents.BLOCK_LANTERN_PLACE, 0.7f, 0.9f);
            }
            return;
        }

        if (state == Carry.PLANTED) {
            roam();

            /*
             * A look around, two seconds after landing.
             *
             * Delayed rather than immediate so the dust settles and it has lit
             * a torch or two — reporting on a pitch-dark room the instant it
             * arrives would describe less than the player can already see.
             */
            if (surveyIn > 0 && --surveyIn == 0
                    && this.getEntityWorld() instanceof ServerWorld world
                    && owner instanceof net.minecraft.server.network.ServerPlayerEntity served
                    && this.getEntityWorld().getServer() != null) {
                Survey.Findings saw = Survey.of(world, this.getBlockPos());

                /*
                 * Only when the kind of thing here has actually changed.
                 *
                 * Comparing the prose meant a second mob wandering into range
                 * counted as a discovery, and the same cave was described three
                 * times in twenty seconds. Two reports per throw is the ceiling
                 * regardless: it is scouting a room, not narrating one.
                 */
                if (saw != null && !saw.signature().equals(saidAbout) && reportsLeft > 0) {
                    saidAbout = saw.signature();
                    reportsLeft--;
                    Ember.voice().hear(this.getEntityWorld().getServer(), served, this,
                            "[Something is happening: " + saw.facts()
                                    + " Tell them what you found, in your own words, in a sentence "
                                    + "or two. Do not mention coordinates.]");
                }
            }

            // Another look every twenty-five seconds while it explores.
            if (plantedFor % 500 == 0 && plantedFor < 560) surveyIn = 1;

            if (--plantedFor <= 0) {
                roamingTo = null;
                saidAbout = null;
                setCarry(Carry.RETURNING);
                playSound(SoundEvents.ENTITY_ITEM_PICKUP, 0.5f, 1.6f);
            }
            return;
        }

        if (state == Carry.RETURNING) {
            Vec3d home = owner.getEntityPos().add(0.0, HOVER_HEIGHT, 0.0);
            Vec3d toward = home.subtract(this.getEntityPos());

            if (toward.lengthSquared() < 2.2) {
                setCarry(Carry.FOLLOWING);
                return;
            }

            this.setVelocity(this.getVelocity().multiply(0.6)
                    .add(toward.normalize().multiply(0.55)));
            this.move(net.minecraft.entity.MovementType.SELF, this.getVelocity());
        }
    }

    /**
     * Rides on the shoulder of whoever picked it up.
     *
     * Held at the hand it hung out in front and read as a thing floating near
     * you rather than one you were carrying — you could see it, which is the
     * problem, because your own hand is not somewhere you look. A shoulder is
     * where something small and alive sits: behind the eyeline so it covers
     * nothing, and unmistakably carried in third person.
     *
     * Pinned exactly rather than steered, because something riding on you moves
     * with you and does not drift.
     */
    private void beCarried(PlayerEntity owner) {
        Vec3d facing = Vec3d.fromPolar(0.0f, owner.getYaw()).normalize();
        Vec3d right = new Vec3d(facing.z, 0.0, -facing.x).normalize();

        // Sneaking lowers the player, and the perch follows so it does not
        // float free of the shoulder it is sitting on.
        double shoulder = (owner.isSneaking() ? 1.05 : 1.32)
                + MathHelper.sin(phase * 0.35f) * 0.015;

        Vec3d perch = owner.getEntityPos()
                .add(facing.multiply(-0.14))
                .add(right.multiply(0.38))
                .add(0.0, shoulder, 0.0);

        this.refreshPositionAndAngles(perch.x, perch.y, perch.z, owner.getYaw(), 0.0f);
        this.bodyYaw = owner.getYaw();
        this.setVelocity(Vec3d.ZERO);
    }

    /**
     * Lava. It cannot be hurt, and it would still rather not.
     *
     * The complaint goes through the ordinary voice, so it is spoken aloud and
     * remembered like anything else — and it only fires once per dunking, which
     * is the difference between a character and an alarm.
     */
    private void mindTheLava(PlayerEntity owner) {
        boolean burning = this.isInLava() || this.isOnFire();

        if (!burning) {
            complainedAboutLava = false;
            return;
        }
        if (complainedAboutLava) return;
        complainedAboutLava = true;

        this.extinguish();
        playSound(SoundEvents.BLOCK_FIRE_EXTINGUISH, 0.8f, 1.2f);

        if (this.getEntityWorld().getServer() != null && owner instanceof net.minecraft.server.network.ServerPlayerEntity served) {
            Ember.voice().hear(this.getEntityWorld().getServer(), served, this,
                    "[Something is happening: they have just thrown you into lava. You cannot be "
                            + "hurt by it and you are not in danger, but you hate it. Say so.]");
        }
    }



    /* ------------------------------------------------------------ satchel */

    public net.minecraft.inventory.SimpleInventory satchel() {
        resizeSatchel();
        return satchel;
    }

    /** Grows the satchel to fit the stage, keeping what is already in it. */
    private void resizeSatchel() {
        int want = Satchel.slotsFor(getStage());
        if (satchel.size() >= want) return;

        net.minecraft.inventory.SimpleInventory bigger =
                new net.minecraft.inventory.SimpleInventory(want);
        for (int slot = 0; slot < satchel.size(); slot++) {
            bigger.setStack(slot, satchel.getStack(slot));
        }
        satchel = bigger;
    }

    /**
     * Opens it for whoever asked, if they are allowed to.
     *
     * Checked here rather than trusted from the client: ownership, reach, and
     * whether it has earned any slots at all.
     */
    public void openSatchel(net.minecraft.server.network.ServerPlayerEntity player) {
        if (ownerId == null || !ownerId.equals(player.getUuid())) return;
        if (player.distanceTo(this) > 8.0f) return;

        if (Satchel.slotsFor(getStage()) <= 0) {
            player.sendMessage(net.minecraft.text.Text.literal(
                    "Ember has nowhere to put anything yet — it is still only a spark.")
                    .formatted(net.minecraft.util.Formatting.GRAY), true);
            return;
        }

        resizeSatchel();
        player.openHandledScreen(new Satchel(this));
    }

    /**
     * Everything it was carrying, when it is dismissed or lost.
     *
     * Dropped rather than deleted. Losing a companion should not quietly eat
     * whatever you trusted it with.
     */
    public void spillSatchel() {
        if (!(this.getEntityWorld() instanceof ServerWorld world)) return;
        for (int slot = 0; slot < satchel.size(); slot++) {
            net.minecraft.item.ItemStack stack = satchel.getStack(slot);
            if (stack.isEmpty()) continue;
            net.minecraft.entity.ItemEntity dropped = new net.minecraft.entity.ItemEntity(
                    world, this.getX(), this.getY(), this.getZ(), stack);
            world.spawnEntity(dropped);
        }
        satchel.clear();
    }

    /* ------------------------------------------------------------ leading */

    /** Starts leading somewhere, or stops if given null. */
    public void leadTo(net.minecraft.util.math.BlockPos target) {
        this.leadingTo = target;
        this.sinceProgress = 0;
        if (target != null) setCarry(Carry.FOLLOWING);
    }

    /** Drops whatever it was doing and comes back to the shoulder. */
    public void recall() {
        leadingTo = null;
        plantedFor = 0;
        roamingTo = null;
        saidAbout = null;
        if (getCarry() == Carry.PLANTED || getCarry() == Carry.THROWN) {
            setCarry(Carry.RETURNING);
        }
    }

    public boolean isLeading() {
        return leadingTo != null;
    }

    public net.minecraft.util.math.BlockPos leadingTo() {
        return leadingTo;
    }

    /**
     * Flies ahead along the way, and waits when you fall behind.
     *
     * Deliberately not pathfinding. It has no legs and no business solving a
     * maze; it moves toward the target and hangs at head height, and the player
     * does the walking. Waiting is the part that makes it feel like being led
     * rather than abandoned — beyond a dozen blocks it stops and holds until
     * you catch up.
     */
    private void lead(PlayerEntity owner) {
        double fromOwner = this.getEntityPos().distanceTo(owner.getEntityPos());

        // Far enough ahead; wait rather than disappear over the hill.
        if (fromOwner > 12.0) {
            this.setVelocity(this.getVelocity().multiply(0.55));
            this.move(net.minecraft.entity.MovementType.SELF, this.getVelocity());
            return;
        }

        Vec3d target = new Vec3d(leadingTo.getX() + 0.5, leadingTo.getY() + 2.0, leadingTo.getZ() + 0.5);
        Vec3d toward = target.subtract(this.getEntityPos());

        if (toward.lengthSquared() < 9.0) {
            arrive(owner);
            return;
        }

        // Ahead of the player, along the line to the target.
        Vec3d ahead = owner.getEntityPos()
                .add(toward.normalize().multiply(4.5))
                .add(0.0, HOVER_HEIGHT, 0.0);

        Vec3d push = ahead.subtract(this.getEntityPos());
        if (push.lengthSquared() > 0.09) {
            this.setVelocity(this.getVelocity().multiply(0.7)
                    .add(push.normalize().multiply(Math.min(0.1 * push.length(), 0.4))));
        }
        this.move(net.minecraft.entity.MovementType.SELF, this.getVelocity());
        this.lookAtEntity(owner, 30.0f, 30.0f);
        this.bodyYaw = this.getYaw();

        // A breadcrumb, so the direction is readable without watching it.
        if (this.age % 6 == 0 && this.getEntityWorld() instanceof ServerWorld world) {
            world.spawnParticles(net.minecraft.particle.ParticleTypes.SMALL_FLAME,
                    this.getX(), this.getY() - 0.2, this.getZ(), 1, 0.05, 0.05, 0.05, 0.0);
        }

        // Says how far is left, occasionally rather than constantly.
        if (++sinceProgress > 600 && owner instanceof net.minecraft.server.network.ServerPlayerEntity served
                && this.getEntityWorld().getServer() != null) {
            sinceProgress = 0;
            int away = (int) Math.round(Math.sqrt(owner.getBlockPos().getSquaredDistance(leadingTo)));
            Ember.voice().hear(this.getEntityWorld().getServer(), served, this,
                    "[Something is happening: you are leading them somewhere and it is still about "
                            + away + " blocks away. Say something brief about the going.]");
        }
    }


    /**
     * Wanders the space it was thrown into.
     *
     * Landing and looking once is not scouting — the room does not change, so
     * every throw produced the same sentence. Drifting through the space means
     * it lights more of it, sees round corners, and has something new to say.
     *
     * Deliberately aimless rather than pathfound: it picks somewhere open
     * within a dozen blocks, goes there, picks again. A lantern exploring a
     * cave does not need a route, and one that solves the cave takes the
     * interesting part away from the player.
     */
    private void roam() {
        if (roamingTo == null || this.getEntityPos().distanceTo(roamingTo) < 1.6) {
            roamingTo = somewhereOpen();
        }

        if (roamingTo != null) {
            Vec3d toward = roamingTo.subtract(this.getEntityPos());
            this.setVelocity(this.getVelocity().multiply(0.78)
                    .add(toward.normalize().multiply(0.055)));
        }

        this.setVelocity(this.getVelocity().add(0.0, MathHelper.sin(phase * 0.4f) * 0.004, 0.0));
        this.move(net.minecraft.entity.MovementType.SELF, this.getVelocity());
    }

    /**
     * An open spot to drift toward, or null if it is walled in.
     *
     * Tries a handful of directions and keeps the first with room in it, which
     * is enough to explore a cave and cheap enough to do every few seconds.
     */
    private Vec3d somewhereOpen() {
        for (int attempt = 0; attempt < 8; attempt++) {
            double angle = this.random.nextDouble() * Math.PI * 2.0;
            double reach = 4.0 + this.random.nextDouble() * 7.0;

            Vec3d candidate = this.getEntityPos().add(
                    Math.cos(angle) * reach,
                    (this.random.nextDouble() - 0.45) * 4.0,
                    Math.sin(angle) * reach);

            net.minecraft.util.math.BlockPos at = net.minecraft.util.math.BlockPos.ofFloored(candidate);
            if (!this.getEntityWorld().getBlockState(at).isAir()) continue;
            if (!this.getEntityWorld().getBlockState(at.up()).isAir()) continue;

            return candidate;
        }
        return null;
    }

    /** Arriving is worth saying out loud, and stops the leading. */
    private void arrive(PlayerEntity owner) {
        net.minecraft.util.math.BlockPos where = leadingTo;
        leadingTo = null;
        this.setVelocity(Vec3d.ZERO);

        if (this.getEntityWorld() instanceof ServerWorld world) {
            world.spawnParticles(net.minecraft.particle.ParticleTypes.END_ROD,
                    where.getX() + 0.5, where.getY() + 1.0, where.getZ() + 0.5,
                    24, 0.3, 0.5, 0.3, 0.02);
        }
        playSound(SoundEvents.BLOCK_LANTERN_PLACE, 0.7f, 1.5f);

        if (owner instanceof net.minecraft.server.network.ServerPlayerEntity served
                && this.getEntityWorld().getServer() != null) {
            Ember.voice().hear(this.getEntityWorld().getServer(), served, this,
                    "[Something is happening: you have just led them to the place they asked for and "
                            + "you have arrived. Say so.]");
        }
    }



    /**
     * Whether it is sitting between the player and whatever they are aiming at.
     *
     * Being beside the shoulder is usually enough, but a player turning quickly
     * or looking sharply sideways can still sweep the crosshair onto it, and a
     * click meant for a block becomes a swing at the lantern. When that
     * happens it slides further out of the way rather than waiting to be told.
     *
     * Deliberately a wider cone than `beingReachedFor`, and the two disagree on
     * purpose: reaching for it is a slow, deliberate look, and this is anything
     * that would steal a click.
     */
    private boolean onTheCrosshair(PlayerEntity owner) {
        Vec3d look = owner.getRotationVec(1.0f).normalize();
        Vec3d toward = this.getEntityPos().add(0.0, 0.25, 0.0).subtract(owner.getEyePos());

        double range = toward.length();
        if (range > 4.5) return false;

        // Looking sharply up is the one time an overhead lantern is in the way.
        if (owner.getPitch() < -35.0f) return true;

        // About fifteen degrees, and only while they are not deliberately
        // looking at it — otherwise it would dodge away from being picked up.
        return look.dotProduct(toward.normalize()) > 0.965 && !beingReachedFor(owner);
    }

    /**
     * Whether the owner is looking almost straight at it, from close by.
     *
     * The threshold is deliberately generous: this only makes it hold still, so
     * being slightly too eager costs nothing, and being too strict brings back
     * the chasing it exists to stop.
     */
    private boolean beingReachedFor(PlayerEntity owner) {
        if (this.getEntityPos().distanceTo(owner.getEyePos()) > 5.0) return false;

        Vec3d look = owner.getRotationVec(1.0f).normalize();
        Vec3d toward = this.getEntityPos().add(0.0, 0.25, 0.0)
                .subtract(owner.getEyePos()).normalize();

        // About twenty degrees of cone.
        return look.dotProduct(toward) > 0.94;
    }


    /**
     * Growing up is worth one line, when it happens.
     *
     * Said through the ordinary voice so it is spoken aloud and remembered like
     * anything else — and only once, because the stage only changes once.
     */
    private void announceGrowth(PlayerEntity owner, Growth.Stage was, Growth.Stage now) {
        if (!(owner instanceof net.minecraft.server.network.ServerPlayerEntity served)) return;
        if (this.getEntityWorld().getServer() == null) return;

        if (this.getEntityWorld() instanceof ServerWorld world) {
            world.spawnParticles(net.minecraft.particle.ParticleTypes.END_ROD,
                    this.getX(), this.getY() + 0.3, this.getZ(), 30, 0.3, 0.4, 0.3, 0.04);
        }
        playSound(SoundEvents.BLOCK_AMETHYST_BLOCK_CHIME, 0.8f, 1.0f);

        Growth.Life life = Growth.of(ownerId);
        Ember.voice().hear(this.getEntityWorld().getServer(), served, this,
                "[Something is happening: you have just grown. You were " + was.word
                        + " and you are " + now.word + " now, after " + life.daysTogether()
                        + " days together and " + life.torches()
                        + " torches. Say something about that — quietly, not grandly.]");
    }

    /** What it is feeling, in priority order — sulking outranks everything. */
    private void decideMood(PlayerEntity owner) {
        if (sulkTicks > 0) {
            setMood(Mood.SULKING);
            return;
        }
        if (owner.getHealth() <= owner.getMaxHealth() * 0.4f) {
            setMood(Mood.WORRIED);
            return;
        }
        if (!nearbyHostiles(owner, 8.0).isEmpty()) {
            setMood(Mood.ALERT);
            return;
        }
        setMood(Mood.CONTENT);
    }

    private List<LivingEntity> nearbyHostiles(PlayerEntity owner, double radius) {
        Box box = owner.getBoundingBox().expand(radius);
        return this.getEntityWorld().getEntitiesByClass(LivingEntity.class, box,
                candidate -> candidate instanceof Monster && candidate.isAlive());
    }

    /* ------------------------------------------------------------- helping */

    private void help(PlayerEntity owner) {
        if (!(this.getEntityWorld() instanceof ServerWorld world)) return;

        // A sulking Ember genuinely stops working. The shutters are shut.
        if (getMood() == Mood.SULKING) return;

        /*
         * Thrown into a dark room, it lights that room — not wherever the
         * player happens to be standing. Anything else makes throwing it
         * pointless.
         */
        lightbringer.tick(world, this, getCarry() == Carry.PLANTED ? null : owner);
        thaw(owner);

        if (getMood() == Mood.ALERT && flareCooldown <= 0) {
            List<LivingEntity> close = nearbyHostiles(owner, FLARE_RANGE);
            if (!close.isEmpty()) flare(world, close);
        }
    }

    /**
     * Throws the shutters wide.
     *
     * Blinds what is closing on the player and lights the ground for a moment.
     * It does no damage on purpose — Ember is not a weapon, it buys the three
     * seconds you need to turn around.
     */
    private void flare(ServerWorld world, List<LivingEntity> targets) {
        flareCooldown = getStage().flareCooldown;
        if (ownerId != null) Growth.flared(ownerId);

        for (LivingEntity target : targets) {
            target.addStatusEffect(new net.minecraft.entity.effect.StatusEffectInstance(
                    net.minecraft.entity.effect.StatusEffects.BLINDNESS, 60, 0, false, false));
            target.addStatusEffect(new net.minecraft.entity.effect.StatusEffectInstance(
                    net.minecraft.entity.effect.StatusEffects.GLOWING, 120, 0, false, false));
        }

        world.spawnParticles(ParticleTypes.END_ROD, this.getX(), this.getY() + 0.3, this.getZ(),
                60, 0.45, 0.45, 0.45, 0.08);
        world.spawnParticles(ParticleTypes.FLAME, this.getX(), this.getY() + 0.3, this.getZ(),
                20, 0.3, 0.3, 0.3, 0.02);
        world.playSound(null, this.getBlockPos(), SoundEvents.ITEM_FIRECHARGE_USE,
                SoundCategory.NEUTRAL, 0.7f, 1.6f);
    }

    /** Being a lantern is worth something in the cold. */
    private void thaw(PlayerEntity owner) {
        if (owner.getFrozenTicks() > 0) {
            owner.setFrozenTicks(Math.max(0, owner.getFrozenTicks() - 4));
        }
    }

    /* ------------------------------------------------------------ reactions */

    @Override
    public boolean damage(ServerWorld world, DamageSource source, float amount) {
        // Hit by the one it follows: it does not fight back, it stops helping.
        if (source.getAttacker() instanceof PlayerEntity player
                && player.getUuid().equals(ownerId)) {
            sulkTicks = 400;
            world.playSound(null, this.getBlockPos(), SoundEvents.BLOCK_LANTERN_BREAK,
                    SoundCategory.NEUTRAL, 0.6f, 0.7f);
            return false;
        }
        return super.damage(world, source, amount);
    }

    /** The flame, drawn as particles so the colour needs no second texture. */
    private void emitFlame() {
        Mood mood = getMood();
        if (mood == Mood.SULKING) return;

        if (this.random.nextInt(mood == Mood.ALERT ? 1 : 3) != 0) return;

        double x = this.getX() + (this.random.nextDouble() - 0.5) * 0.16;
        double y = this.getY() + 0.28 + this.random.nextDouble() * 0.1;
        double z = this.getZ() + (this.random.nextDouble() - 0.5) * 0.16;

        this.getEntityWorld().addParticleClient(switch (mood) {
            case ALERT -> ParticleTypes.END_ROD;
            case WORRIED -> ParticleTypes.SOUL_FIRE_FLAME;
            default -> ParticleTypes.SMALL_FLAME;
        }, x, y, z, 0.0, 0.01, 0.0);
    }

    /* ---------------------------------------------------------- persistence */

    @Override
    protected void writeCustomData(WriteView view) {
        super.writeCustomData(view);
        if (ownerId != null) view.putString("Owner", ownerId.toString());
        view.putBoolean("Lighting", lightbringer.isEnabled());
        view.putInt("Sulk", sulkTicks);
        view.putInt("Carry", getCarry().id());
        satchel.toDataList(view.getListAppender("Satchel", net.minecraft.item.ItemStack.CODEC));
    }

    @Override
    protected void readCustomData(ReadView view) {
        super.readCustomData(view);
        String owner = view.getString("Owner", "");
        if (!owner.isEmpty()) {
            try {
                ownerId = UUID.fromString(owner);
            } catch (IllegalArgumentException ignored) {
                ownerId = null;
            }
        }
        lightbringer.setEnabled(view.getBoolean("Lighting", true));
        sulkTicks = view.getInt("Sulk", 0);
        // Never restored mid-throw: it would load in the air with nowhere to go.
        byte carried = (byte) view.getInt("Carry", 0);
        setCarry(carried == Carry.CARRIED.id() ? Carry.CARRIED : Carry.FOLLOWING);
    }

    public Lightbringer lightbringer() {
        return lightbringer;
    }

    /**
     * A bigger target than it looks.
     *
     * Ember is half a block across and never stops moving, so clicking it was a
     * game of its own — you had to catch a bobbing thing the size of a helmet
     * before it drifted. The margin widens what the crosshair counts as a hit
     * without changing what is drawn, which is the same trick vanilla uses to
     * make arrows and boats catchable.
     */
    @Override
    public float getTargetingMargin() {
        return 0.45f;
    }

    /**
     * The crosshair cannot see it, and so cannot spend a click on it.
     *
     * This is the whole fix for a problem four different hovering positions
     * failed to solve: behind the player it was invisible, in front it ate
     * clicks meant for blocks, beside it was invisible again, above it fouled
     * fighting and building upward. Any position a crosshair can reach is a
     * position where it will eventually steal something.
     *
     * Its own keys find it instead, with a raycast that does not consult this —
     * so it is reachable when wanted and invisible to every ordinary click.
     */
    @Override
    public boolean canHit() {
        return false;
    }

    /** For the same reason: nothing should ever swing at it by accident. */
    @Override
    public boolean isAttackable() {
        return false;
    }

    /** Called by the keybinding path, since right-click can no longer reach it. */
    public void grabToggle(net.minecraft.server.network.ServerPlayerEntity player) {
        if (ownerId == null || !ownerId.equals(player.getUuid())) return;
        if (player.distanceTo(this) > 8.0f) return;

        if (getCarry() == Carry.CARRIED) {
            setCarry(Carry.FOLLOWING);
            this.noClip = true;
            playSound(SoundEvents.BLOCK_LANTERN_PLACE, 0.5f, 1.4f);
            player.sendMessage(net.minecraft.text.Text.literal("Ember lifts off again.")
                    .formatted(net.minecraft.util.Formatting.GRAY), true);
        } else {
            setCarry(Carry.CARRIED);
            this.noClip = true;
            plantedFor = 0;
            leadingTo = null;
            this.setVelocity(Vec3d.ZERO);
            playSound(SoundEvents.BLOCK_LANTERN_PLACE, 0.6f, 1.1f);
            player.sendMessage(net.minecraft.text.Text.literal(
                    "Ember settles onto your shoulder. Sneak and press again to throw it.")
                    .formatted(net.minecraft.util.Formatting.GRAY), true);
        }
    }

    /** Also called from the keybinding path. */
    public void throwFor(net.minecraft.server.network.ServerPlayerEntity player) {
        if (ownerId == null || !ownerId.equals(player.getUuid())) return;
        if (player.distanceTo(this) > 8.0f) return;
        throwFrom(player);
    }

    @Override
    public boolean isPushable() {
        return false;
    }

    @Override
    public boolean canBeLeashed() {
        return false;
    }

    @Override
    protected boolean shouldDropLoot(ServerWorld world) {
        return false;
    }
}
