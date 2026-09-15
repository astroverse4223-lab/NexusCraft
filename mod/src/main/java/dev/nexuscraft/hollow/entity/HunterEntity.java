package dev.nexuscraft.hollow.entity;

import net.minecraft.entity.EntityType;
import net.minecraft.entity.data.DataTracker;
import net.minecraft.entity.data.TrackedData;
import net.minecraft.entity.data.TrackedDataHandlerRegistry;
import net.minecraft.entity.mob.VexEntity;
import net.minecraft.storage.ReadView;
import net.minecraft.storage.WriteView;
import net.minecraft.world.World;

/**
 * What the mask was hiding.
 *
 * The arc never lets Hollow transform — that is the whole point of it, and the
 * note in {@link Hunter} argues it better than this one can. So this is not
 * him. It is the same silhouette and the same light, stretched into something
 * that was never a person: too tall, too thin, arms past its knees, and legs
 * that hang because it does not use them.
 *
 * The recognition is the horror. You have spent a fortnight with a black figure
 * with two lit eyes, and when this comes through the wall you know exactly what
 * it looks like — and he is standing right there beside you at the same time,
 * with the same lights in his face, doing nothing.
 *
 * A vex underneath, deliberately. It flies and it ignores walls, so the room you
 * decided was safe is not, and nothing had to explain that to you. Everything
 * {@link Hunter} tuned — the health, the halved speed, the fact that it can be
 * killed and comes back — is inherited unchanged; only what you see is new.
 */
public class HunterEntity extends VexEntity {

    /**
     * Which colour burns in it — copied from Hollow when it is released.
     *
     * Not its own choice. It wears his light, so if you have set his eyes to
     * violet then the thing hunting you has violet eyes, because whatever this
     * is came out of the same place he did.
     */
    private static final TrackedData<Byte> EYE_COLOUR =
            DataTracker.registerData(HunterEntity.class, TrackedDataHandlerRegistry.BYTE);

    public HunterEntity(EntityType<? extends VexEntity> type, World world) {
        super(type, world);
    }

    @Override
    protected void initDataTracker(DataTracker.Builder builder) {
        super.initDataTracker(builder);
        builder.add(EYE_COLOUR, (byte) 0);
    }

    public int eyeColour() {
        return Math.floorMod(this.dataTracker.get(EYE_COLOUR), MaskEntity.COLOURS);
    }

    public void setEyeColour(int colour) {
        this.dataTracker.set(EYE_COLOUR, (byte) Math.floorMod(colour, MaskEntity.COLOURS));
    }

    @Override
    protected void writeCustomData(WriteView view) {
        super.writeCustomData(view);
        view.putInt("EyeColour", eyeColour());
    }

    @Override
    protected void readCustomData(ReadView view) {
        super.readCustomData(view);
        setEyeColour(view.getInt("EyeColour", 0));
    }
}
