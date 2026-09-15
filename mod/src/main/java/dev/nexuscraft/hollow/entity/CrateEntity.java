package dev.nexuscraft.hollow.entity;

import dev.nexuscraft.hollow.Hollow;
import net.minecraft.entity.EntityType;
import net.minecraft.entity.attribute.DefaultAttributeContainer;
import net.minecraft.entity.attribute.EntityAttributes;
import net.minecraft.entity.damage.DamageSource;
import net.minecraft.entity.data.DataTracker;
import net.minecraft.entity.data.TrackedData;
import net.minecraft.entity.data.TrackedDataHandlerRegistry;
import net.minecraft.entity.mob.PathAwareEntity;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.particle.ParticleTypes;
import net.minecraft.server.network.ServerPlayerEntity;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.sound.SoundCategory;
import net.minecraft.sound.SoundEvents;
import net.minecraft.storage.ReadView;
import net.minecraft.storage.WriteView;
import net.minecraft.util.math.Vec3d;
import net.minecraft.world.World;

/**
 * The box he arrives in.
 *
 * It was a vanilla chest. That worked and it was the weakest thing in the mod:
 * a chest is furniture the player has opened ten thousand times, and it cannot
 * do the one thing this moment needs, which is *move*. A container that plays a
 * knocking sound is a container playing a sound. A crate that jumps is
 * something alive in a box.
 *
 * So it is an entity, and it behaves like a thing with something inside it. It
 * shifts. It thumps. When you hit it the lid lifts a little further and the
 * boards start to give, and somewhere around the second hit you can see a pair
 * of eyes looking out through the gap — which is the beat the whole thing was
 * built for. You meet him before you free him.
 *
 * Breaking it is deliberately four hits rather than one. The first tells you
 * the box can be hurt, the second shows you the eyes, the third is the one
 * where you decide, and the fourth is yours.
 */
public class CrateEntity extends PathAwareEntity {

    /** 0 shut, 3 in pieces. Sent to the client, which draws the difference. */
    private static final TrackedData<Byte> STAGE =
            DataTracker.registerData(CrateEntity.class, TrackedDataHandlerRegistry.BYTE);

    /** Hits to open it. */
    public static final int STAGES = 4;

    /** Ticks between shifts while it sits there. Roughly three seconds. */
    private static final int RESTLESS = 60;

    /** Set on the tick it is struck, and counted down, so it recoils. */
    private int struck;

    private int settled;

    /** Which muffled line comes next. */
    private int called;

    public CrateEntity(EntityType<? extends PathAwareEntity> type, World world) {
        super(type, world);
        this.setPersistent();
        this.setSilent(true);
        this.experiencePoints = 0;
    }

    public static DefaultAttributeContainer.Builder createCrateAttributes() {
        return PathAwareEntity.createMobAttributes()
                .add(EntityAttributes.MAX_HEALTH, 20.0)
                .add(EntityAttributes.MOVEMENT_SPEED, 0.0)
                .add(EntityAttributes.KNOCKBACK_RESISTANCE, 1.0);
    }

    @Override
    protected void initDataTracker(DataTracker.Builder builder) {
        super.initDataTracker(builder);
        builder.add(STAGE, (byte) 0);
    }

    /** None. It is a box. */
    @Override
    protected void initGoals() {
    }

    public int stage() {
        return this.dataTracker.get(STAGE);
    }

    /** Ticks since it was last hit, for the recoil. Client-side use. */
    public int struckAgo() {
        return struck;
    }

    @Override
    public void tick() {
        super.tick();
        if (struck > 0) struck--;

        if (!(this.getEntityWorld() instanceof ServerWorld world)) return;

        /*
         * It will not stay still.
         *
         * A small hop, on the floor, every few seconds — with a thump that is
         * the sound of a heavy thing landing rather than of a chest being
         * knocked on. This is most of the effect: the player sees a crate move
         * on its own before anything has said a word to them.
         */
        if (++settled >= RESTLESS) {
            settled = 0;
            if (this.isOnGround()) {
                this.setVelocity(
                        (this.random.nextDouble() - 0.5) * 0.06,
                        0.22 + this.random.nextDouble() * 0.08,
                        (this.random.nextDouble() - 0.5) * 0.06);
                this.velocityDirty = true;

                world.playSound(null, this.getX(), this.getY(), this.getZ(),
                        SoundEvents.BLOCK_WOOD_HIT, SoundCategory.BLOCKS,
                        0.7f, 0.6f + this.random.nextFloat() * 0.2f);

                callOut(world);
            }
        }
    }

    /**
     * It says something, from inside, to whoever is close enough to hear.
     *
     * Said by the crate rather than by the director's schedule, which is where
     * this lived before and why it almost never happened: the director calls
     * out on its own slow cadence, so a player who walked over and broke the
     * box open within a minute of finding it got a silent crate and no idea
     * anything was in there.
     *
     * Tied to the same beat as the thump, so the box knocks and speaks together
     * rather than as two unrelated effects.
     */
    private void callOut(ServerWorld world) {
        PlayerEntity nearest = world.getClosestPlayer(this, 16.0);
        if (!(nearest instanceof ServerPlayerEntity player)) return;

        var lines = dev.nexuscraft.hollow.director.Arrival.MUFFLED;
        if (lines.isEmpty()) return;

        // Walks the list, then holds on the last one — which is the most
        // desperate, and the right note to leave hanging.
        String line = lines.get(Math.min(called, lines.size() - 1));
        called++;

        player.sendMessage(net.minecraft.text.Text.literal(line)
                .formatted(net.minecraft.util.Formatting.GRAY,
                           net.minecraft.util.Formatting.ITALIC), false);

        world.playSound(null, this.getX(), this.getY(), this.getZ(),
                SoundEvents.BLOCK_WOODEN_DOOR_CLOSE, SoundCategory.BLOCKS, 0.5f, 0.5f);
    }

    /**
     * A hit opens it a little further, rather than hurting it.
     *
     * Health is ignored entirely. A crate with a health bar would be a mob, and
     * the player would treat it like one — the point is that this is an object
     * being forced, and the resistance is a count of blows rather than a number
     * going down.
     */
    @Override
    public boolean damage(ServerWorld world, DamageSource source, float amount) {
        if (!(source.getAttacker() instanceof PlayerEntity player)) return false;

        struck = 6;
        int next = stage() + 1;

        world.playSound(null, this.getX(), this.getY(), this.getZ(),
                SoundEvents.BLOCK_WOOD_BREAK, SoundCategory.BLOCKS, 0.9f, 0.8f);
        world.spawnParticles(ParticleTypes.CRIT, this.getX(), this.getY() + 0.5, this.getZ(),
                8, 0.3, 0.2, 0.3, 0.05);

        if (next >= STAGES) {
            if (player instanceof ServerPlayerEntity opener) burst(world, opener);
            return true;
        }

        this.dataTracker.set(STAGE, (byte) next);

        // It reacts. Being hit is the only conversation it can have from in there.
        this.setVelocity(this.getVelocity().add(0.0, 0.18, 0.0));
        this.velocityDirty = true;
        return true;
    }

    /**
     * The lid comes off and he is out.
     *
     * Everything the old chest did on being right-clicked, plus the wreckage —
     * the boards have to go somewhere, and a box that simply vanishes reads as
     * a block being mined rather than as something breaking open.
     */
    private void burst(ServerWorld world, ServerPlayerEntity opener) {
        Vec3d at = this.getEntityPos();

        world.spawnParticles(ParticleTypes.END_ROD, at.x, at.y + 0.6, at.z,
                40, 0.3, 0.3, 0.3, 0.05);
        world.playSound(null, at.x, at.y, at.z,
                SoundEvents.ENTITY_ITEM_FRAME_BREAK, SoundCategory.BLOCKS, 1.1f, 0.7f);
        world.playSound(null, at.x, at.y, at.z,
                SoundEvents.ENTITY_ALLAY_ITEM_GIVEN, SoundCategory.NEUTRAL, 0.8f, 1.5f);

        Hollow.openTheBox(world, opener, this.getBlockPos());
        this.discard();
    }

    /* --------------------------------------------------------------- rules */

    /** It can be hit — that is the whole interaction — but never shoved. */
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
        view.putInt("Stage", stage());
    }

    @Override
    protected void readCustomData(ReadView view) {
        super.readCustomData(view);
        this.dataTracker.set(STAGE, (byte) Math.min(STAGES - 1, Math.max(0, view.getInt("Stage", 0))));
    }
}
