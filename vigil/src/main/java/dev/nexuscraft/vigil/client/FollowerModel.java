package dev.nexuscraft.vigil.client;

import net.minecraft.client.model.ModelData;
import net.minecraft.client.model.ModelPart;
import net.minecraft.client.model.ModelPartBuilder;
import net.minecraft.client.model.ModelPartData;
import net.minecraft.client.model.ModelTransform;
import net.minecraft.client.model.TexturedModelData;
import net.minecraft.client.render.entity.model.EntityModel;

/**
 * The shape of the thing.
 *
 * Roughly a person, and wrong in three specific ways, because "wrong in three
 * specific ways" is how you make something read as human enough to be
 * frightening rather than just a monster:
 *
 *   - it is too tall and far too narrow, so it does not fit in a normal
 *     corridor and has to be seen through doorways rather than in them;
 *   - its arms are longer than its legs, hanging past the knee, which is the
 *     single detail that makes people's skin crawl at a silhouette;
 *   - it has no face. Not a blank face — no head, in the sense of a skull. A
 *     flat upright plate on a neck, like a mirror turned edge-on.
 *
 * And there is not one animation in this file. There cannot be: it only ever
 * moves where nobody can see it, so every frame anyone will ever witness is a
 * still. That is not a compromise. A thing that breathes is alive and therefore
 * ordinary; a thing that is *utterly* motionless, in a game where the grass
 * sways and every mob bobs, is immediately and obviously not right — and the
 * player feels that long before they work out why.
 */
public class FollowerModel extends EntityModel<FollowerRenderState> {

    private final ModelPart root;
    private final ModelPart torso;
    private final ModelPart head;
    private final ModelPart armLeft;
    private final ModelPart armRight;
    private final ModelPart legLeft;
    private final ModelPart legRight;

    public FollowerModel(ModelPart root) {
        super(root);
        this.root = root;
        this.torso = root.getChild("torso");
        this.head = torso.getChild("head");
        this.armLeft = torso.getChild("arm_left");
        this.armRight = torso.getChild("arm_right");
        this.legLeft = root.getChild("leg_left");
        this.legRight = root.getChild("leg_right");
    }

    public static TexturedModelData getTexturedModelData() {
        ModelData data = new ModelData();
        ModelPartData root = data.getRoot();

        /*
         * Model space runs downward: the feet sit at 24 and the head is up in
         * negative numbers. Everything below is written in those units, where
         * sixteen is one block.
         */

        // Legs: two thin rails, a block long, no feet on the ends.
        root.addChild("leg_left",
                ModelPartBuilder.create().uv(0, 40).cuboid(-1.0f, 0.0f, -1.0f, 2, 16, 2),
                ModelTransform.origin(-2.0f, 8.0f, 0.0f));

        root.addChild("leg_right",
                ModelPartBuilder.create().uv(10, 40).cuboid(-1.0f, 0.0f, -1.0f, 2, 16, 2),
                ModelTransform.origin(2.0f, 8.0f, 0.0f));

        /*
         * Torso in two boxes: narrow at the waist, wider at the shoulders. Two
         * cuboids rather than one is the only way to suggest a taper, and the
         * taper is what stops it reading as a cardboard box on legs.
         */
        ModelPartData torso = root.addChild("torso",
                ModelPartBuilder.create()
                        .uv(20, 40).cuboid(-2.5f, -7.0f, -1.5f, 5, 7, 3)
                        .uv(0, 0).cuboid(-3.5f, -14.0f, -2.0f, 7, 7, 4),
                ModelTransform.origin(0.0f, 8.0f, 0.0f));

        /*
         * A neck, and then a flat plate where a head should be.
         *
         * Two units deep and six across, so head-on it is a face-sized slab and
         * from the side it very nearly vanishes. Turning to find it edge-on is
         * one of the better moments the model gives you for free.
         */
        torso.addChild("head",
                ModelPartBuilder.create()
                        .uv(0, 20).cuboid(-1.0f, -2.0f, -1.0f, 2, 2, 2)
                        .uv(24, 0).cuboid(-3.0f, -9.0f, -1.0f, 6, 7, 2),
                ModelTransform.origin(0.0f, -14.0f, 0.0f));

        // Arms: nineteen units, which reaches past the knee.
        torso.addChild("arm_left",
                ModelPartBuilder.create().uv(40, 20).cuboid(-1.0f, -1.0f, -1.0f, 2, 19, 2),
                ModelTransform.origin(-4.0f, -13.0f, 0.0f));

        torso.addChild("arm_right",
                ModelPartBuilder.create().uv(50, 20).cuboid(-1.0f, -1.0f, -1.0f, 2, 19, 2),
                ModelTransform.origin(4.0f, -13.0f, 0.0f));

        return TexturedModelData.of(data, 64, 64);
    }

    /**
     * Holds one of six poses. Nothing here moves between frames.
     *
     * Every branch sets the same set of parts to fixed numbers, and the state
     * is reset first, so a pose is a complete description rather than a delta —
     * the client can be handed any pose in any order and there is no way to end
     * up in a half-blended posture that nobody designed.
     */
    @Override
    public void setAngles(FollowerRenderState state) {
        rest();

        switch (state.stance) {
            case WAITING -> {
                // Nothing. This is the one that ought to be reassuring.
            }

            /*
             * Not looking at you — listening to you. The head goes over almost
             * to the shoulder, which no living thing does casually.
             */
            case TILTED -> {
                head.roll = 0.62f;
                head.yaw = 0.22f;
                head.pitch = 0.08f;
            }

            /*
             * Bent over at the waist with the head still up and level, so it is
             * looking at you from under its own shoulders. The arms hang.
             */
            case STOOPED -> {
                torso.pitch = 0.80f;
                head.pitch = -1.05f;
                armLeft.pitch = 0.30f;
                armRight.pitch = 0.34f;
                armLeft.roll = -0.08f;
                armRight.roll = 0.08f;
            }

            /*
             * Folded down onto itself and watching from below. The legs are
             * scaled rather than jointed — there is no knee in this model, and
             * inventing one for a single pose is a lot of geometry to carry.
             */
            case CROUCHED -> {
                legLeft.yScale = 0.45f;
                legRight.yScale = 0.45f;
                root.originY = 8.8f;
                torso.pitch = 0.42f;
                head.pitch = -0.72f;
                armLeft.pitch = 0.55f;
                armRight.pitch = 0.58f;
            }

            /* One arm out, level, fingers-first. Only ever seen up close. */
            case REACHING -> {
                armRight.pitch = -1.52f;
                armRight.yaw = -0.14f;
                armLeft.pitch = 0.12f;
                torso.pitch = 0.18f;
                head.roll = 0.16f;
                head.pitch = -0.12f;
            }

            /*
             * Both arms up and spread, filling whatever it is standing in. The
             * head comes down to look at you rather than up, which is the part
             * that makes it read as deliberate.
             */
            case LOOMING -> {
                armLeft.pitch = -2.85f;
                armRight.pitch = -2.85f;
                armLeft.roll = 0.38f;
                armRight.roll = -0.38f;
                torso.pitch = -0.16f;
                head.pitch = 0.30f;
                root.originY = -1.5f;
            }
        }
    }

    /** Back to a plain standing figure, so each pose starts from the same place. */
    private void rest() {
        root.originY = 0.0f;

        for (ModelPart part : new ModelPart[]{torso, head, armLeft, armRight, legLeft, legRight}) {
            part.pitch = 0.0f;
            part.yaw = 0.0f;
            part.roll = 0.0f;
            part.xScale = 1.0f;
            part.yScale = 1.0f;
            part.zScale = 1.0f;
        }
    }
}
