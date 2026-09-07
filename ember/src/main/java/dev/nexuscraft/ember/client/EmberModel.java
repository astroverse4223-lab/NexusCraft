package dev.nexuscraft.ember.client;

import net.minecraft.client.model.Dilation;
import net.minecraft.client.model.ModelData;
import net.minecraft.client.model.ModelPart;
import net.minecraft.client.model.ModelPartBuilder;
import net.minecraft.client.model.ModelPartData;
import net.minecraft.client.model.ModelTransform;
import net.minecraft.client.model.TexturedModelData;
import net.minecraft.client.render.entity.model.EntityModel;
import net.minecraft.util.math.MathHelper;

/**
 * The shape of a lantern that decided to follow someone.
 *
 * A squat body with two hinged shutters, a cage of struts over the top, and two
 * cube hands that float free of it — there are no arms, because a thing with no
 * face needs its hands to do the talking and arms would only damp them.
 *
 * Every moving part is driven by two numbers: the phase, which never stops, and
 * the openness, which the mood decides. Between them the model idles, breathes,
 * flinches and shuts, without a single keyframe.
 */
public class EmberModel extends EntityModel<EmberRenderState> {

    private final ModelPart root;
    private final ModelPart body;
    private final ModelPart shutterLeft;
    private final ModelPart shutterRight;
    private final ModelPart handLeft;
    private final ModelPart handRight;
    private final ModelPart core;

    public EmberModel(ModelPart root) {
        super(root);
        this.root = root;
        this.body = root.getChild("body");
        this.shutterLeft = body.getChild("shutter_left");
        this.shutterRight = body.getChild("shutter_right");
        this.core = body.getChild("core");
        this.handLeft = root.getChild("hand_left");
        this.handRight = root.getChild("hand_right");
    }

    public static TexturedModelData getTexturedModelData() {
        ModelData data = new ModelData();
        ModelPartData root = data.getRoot();

        /*
         * The body hangs from 24 rather than standing on 0: entity models are
         * built downward from the origin, and an Ember never touches the floor.
         */
        ModelPartData body = root.addChild("body",
                ModelPartBuilder.create()
                        // Lantern box.
                        .uv(0, 0).cuboid(-3.0f, -6.0f, -3.0f, 6, 6, 6)
                        // Cap above it, slightly proud.
                        .uv(0, 12).cuboid(-3.5f, -7.5f, -3.5f, 7, 2, 7)
                        // Foot ring below.
                        .uv(0, 21).cuboid(-2.5f, 0.0f, -2.5f, 5, 1, 5),
                ModelTransform.origin(0.0f, 20.0f, 0.0f));

        // The flame's housing, small and set inside the box.
        body.addChild("core",
                ModelPartBuilder.create()
                        .uv(28, 0).cuboid(-1.5f, -4.5f, -1.5f, 3, 3, 3, new Dilation(0.0f)),
                ModelTransform.NONE);

        /*
         * Shutters hinge on the back edge so they open outward like a book,
         * which reads at distance far better than sliding panels.
         */
        shutter(body, "shutter_left", -3.0f, -1.0f, 40, 0);
        shutter(body, "shutter_right", 3.0f, 0.0f, 40, 12);

        // Hands: free-floating cubes, no arms between them and the body.
        root.addChild("hand_left",
                ModelPartBuilder.create().uv(28, 8).cuboid(-1.0f, -1.0f, -1.0f, 2, 2, 2),
                ModelTransform.origin(-5.0f, 17.0f, 0.0f));

        root.addChild("hand_right",
                ModelPartBuilder.create().uv(28, 12).cuboid(-1.0f, -1.0f, -1.0f, 2, 2, 2),
                ModelTransform.origin(5.0f, 17.0f, 0.0f));

        return TexturedModelData.of(data, 64, 32);
    }

    /**
     * One shutter, hinged at the body's edge.
     *
     * Given real thickness rather than drawn as a plane: a zero-width cuboid
     * disappears entirely when seen edge-on, which is precisely the angle you
     * see it from when it swings open.
     */
    private static void shutter(ModelPartData body, String name, float hinge, float inset, int u, int v) {
        body.addChild(name,
                ModelPartBuilder.create().uv(u, v).cuboid(inset, -6.0f, -3.0f, 1, 6, 6),
                ModelTransform.origin(hinge, 0.0f, 0.0f));
    }

    @Override
    public void setAngles(EmberRenderState state) {
        super.setAngles(state);

        float phase = state.phase;

        // A slow breath through the whole body, never quite still.
        float bob = MathHelper.sin(phase * 0.35f) * 0.6f;
        body.originY = 20.0f + bob;
        body.roll = MathHelper.sin(phase * 0.21f) * 0.05f;

        /*
         * Shutters. Open is 100 degrees out; shut is flush. The mood picks the
         * target and the state has already eased toward it, so a flare snaps
         * and a sulk closes slowly.
         */
        float angle = state.openness * 1.75f;
        shutterLeft.yaw = -angle;
        shutterRight.yaw = angle;

        /*
         * The core pulses faster the wider the shutters stand, and sits larger
         * the older it is — a grown Ember has a visibly bigger flame, which is
         * the part of growing that can be seen from across a cave.
         */
        float pulse = (1.0f + state.grown * 0.45f)
                + MathHelper.sin(phase * (0.4f + state.openness * 0.9f)) * 0.08f;
        core.xScale = pulse;
        core.yScale = pulse;
        core.zScale = pulse;

        /*
         * Hands drift on their own, a beat behind the body and out of phase
         * with each other — two cubes moving in lockstep read as machinery,
         * two cubes slightly disagreeing read as alive.
         */
        handLeft.originY = 17.0f + bob + MathHelper.sin(phase * 0.5f) * 0.9f;
        handRight.originY = 17.0f + bob + MathHelper.sin(phase * 0.5f + 2.1f) * 0.9f;

        float spread = 5.0f + state.openness * 1.6f;
        handLeft.originX = -spread + MathHelper.cos(phase * 0.31f) * 0.4f;
        handRight.originX = spread - MathHelper.cos(phase * 0.27f) * 0.4f;

        handLeft.pitch = MathHelper.sin(phase * 0.44f) * 0.35f;
        handRight.pitch = MathHelper.sin(phase * 0.39f + 1.2f) * 0.35f;
        handLeft.yaw = phase * 0.06f;
        handRight.yaw = -phase * 0.05f;
    }
}
