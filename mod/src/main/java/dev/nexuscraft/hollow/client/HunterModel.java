package dev.nexuscraft.hollow.client;

import net.minecraft.client.model.ModelData;
import net.minecraft.client.model.ModelPart;
import net.minecraft.client.model.ModelPartBuilder;
import net.minecraft.client.model.ModelPartData;
import net.minecraft.client.model.ModelTransform;
import net.minecraft.client.model.TexturedModelData;
import net.minecraft.client.render.entity.model.EntityModel;
import net.minecraft.util.math.MathHelper;

/**
 * The same shape, stretched wrong.
 *
 * Every measurement here is Hollow's, altered in one direction only: the head
 * is identical, down to the texture coordinates, and everything below it is
 * longer and narrower than it has any business being. That is what makes it
 * read as him at a glance and as something else a second later — a silhouette
 * you already know, with the proportions of nothing that has ever walked.
 *
 * The arms reach past where the knees would be. The legs hang and never move,
 * because it does not use them: it flies, and a flying thing whose legs still
 * try to walk is comic. Legs that simply hang are not.
 */
public class HunterModel extends EntityModel<HunterRenderState> {

    private final ModelPart head;
    private final ModelPart body;
    private final ModelPart armLeft;
    private final ModelPart armRight;
    private final ModelPart legLeft;
    private final ModelPart legRight;
    private final ModelPart eyeLeft;
    private final ModelPart eyeRight;

    public HunterModel(ModelPart root) {
        super(root);
        this.head = root.getChild("head");
        this.body = root.getChild("body");
        this.armLeft = root.getChild("arm_left");
        this.armRight = root.getChild("arm_right");
        this.legLeft = root.getChild("leg_left");
        this.legRight = root.getChild("leg_right");
        this.eyeLeft = head.getChild("eye_left");
        this.eyeRight = head.getChild("eye_right");
    }

    public static TexturedModelData getTexturedModelData() {
        ModelData data = new ModelData();
        ModelPartData root = data.getRoot();

        // His head exactly, so it is recognised before it is understood.
        ModelPartData head = root.addChild("head",
                ModelPartBuilder.create().uv(0, 0).cuboid(-4.0f, -8.0f, -4.0f, 8, 8, 8),
                ModelTransform.origin(0.0f, -6.0f, 0.0f));

        /*
         * The eyes sit at the same texture coordinates Hollow's do, which is
         * how it wears his light: the glow textures are shared unchanged, so
         * whatever colour you set on him is the colour that comes for you.
         */
        head.addChild("eye_left",
                ModelPartBuilder.create().uv(0, 34).cuboid(-1.0f, -0.5f, -4.3f, 2, 1, 1),
                ModelTransform.origin(-2.0f, -5.0f, 0.0f));

        head.addChild("eye_right",
                ModelPartBuilder.create().uv(8, 34).cuboid(-1.0f, -0.5f, -4.3f, 2, 1, 1),
                ModelTransform.origin(2.0f, -5.0f, 0.0f));

        // Narrower and far longer than a person's.
        root.addChild("body",
                ModelPartBuilder.create().uv(16, 16).cuboid(-3.0f, 0.0f, -1.5f, 6, 18, 3),
                ModelTransform.origin(0.0f, -6.0f, 0.0f));

        // Arms that reach past where the knees would be.
        root.addChild("arm_left",
                ModelPartBuilder.create().uv(40, 16).cuboid(-1.5f, -1.5f, -1.5f, 3, 24, 3),
                ModelTransform.origin(4.0f, -4.0f, 0.0f));

        root.addChild("arm_right",
                ModelPartBuilder.create().uv(40, 16).cuboid(-1.5f, -1.5f, -1.5f, 3, 24, 3),
                ModelTransform.origin(-4.0f, -4.0f, 0.0f));

        // Legs it does not use.
        root.addChild("leg_left",
                ModelPartBuilder.create().uv(0, 16).cuboid(-1.5f, 0.0f, -1.5f, 3, 16, 3),
                ModelTransform.origin(1.6f, 12.0f, 0.0f));

        root.addChild("leg_right",
                ModelPartBuilder.create().uv(0, 16).cuboid(-1.5f, 0.0f, -1.5f, 3, 16, 3),
                ModelTransform.origin(-1.6f, 12.0f, 0.0f));

        return TexturedModelData.of(data, 64, 64);
    }

    @Override
    public void setAngles(HunterRenderState state) {
        float phase = state.phase;

        /*
         * It drifts. It does not move.
         *
         * A slow sway through the whole body and nothing else — no stride, no
         * breath, no reaction to anything. The limbs trail the sway by a beat,
         * the way something hanging does, and that is the tell: it is not
         * carrying itself, it is being carried.
         */
        float sway = MathHelper.sin(phase * 0.045f);

        body.roll = sway * 0.05f;
        head.roll = sway * 0.09f;
        head.pitch = 0.12f + MathHelper.sin(phase * 0.031f) * 0.05f;

        armLeft.pitch = MathHelper.sin(phase * 0.038f) * 0.10f;
        armRight.pitch = MathHelper.sin(phase * 0.038f - 0.7f) * 0.10f;
        armLeft.roll = 0.07f + sway * 0.04f;
        armRight.roll = -0.07f - sway * 0.04f;

        // Hanging, toes down, never stepping.
        legLeft.pitch = 0.18f + MathHelper.sin(phase * 0.029f) * 0.03f;
        legRight.pitch = 0.16f + MathHelper.sin(phase * 0.029f - 0.5f) * 0.03f;
        legLeft.roll = 0.04f;
        legRight.roll = -0.04f;

        // It does not blink. There is nothing behind the eyes to blink with.
        eyeLeft.yScale = 1.0f;
        eyeRight.yScale = 1.0f;
    }
}
