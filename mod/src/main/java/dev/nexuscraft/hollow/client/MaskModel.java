package dev.nexuscraft.hollow.client;

import dev.nexuscraft.hollow.entity.Expression;
import net.minecraft.client.model.ModelData;
import net.minecraft.client.model.ModelPart;
import net.minecraft.client.model.ModelPartBuilder;
import net.minecraft.client.model.ModelPartData;
import net.minecraft.client.model.ModelTransform;
import net.minecraft.client.model.TexturedModelData;
import net.minecraft.client.render.entity.model.EntityModel;
import net.minecraft.util.math.MathHelper;

/**
 * The shape of Hollow.
 *
 * A person-shaped silhouette in flat black, wearing a mask that is the only
 * part of him with any light in it. Everything else — arms, legs, body — is
 * deliberately featureless, so that at any distance he reads as a shadow with a
 * face, and every scrap of attention goes where the expression is.
 *
 * The first attempt at this was a mask alone, floating. It was wrong for a
 * reason worth writing down: a face with no body has no posture, and posture is
 * half of what a character does. It cannot hang back, turn away, or stand too
 * close. A silhouette can do all three without a single new texture.
 *
 * Two things glow, and only two: the eyes and the mouth. They are drawn a
 * second time by {@link HollowEyesFeature} at full brightness, so they hold
 * their colour in a pitch-dark cave — which is where this mod spends most of
 * its time and exactly where a shadow with a lit face earns its keep.
 */
public class MaskModel extends EntityModel<MaskRenderState> {

    private final ModelPart root;
    private final ModelPart head;
    private final ModelPart body;
    private final ModelPart armLeft;
    private final ModelPart armRight;
    private final ModelPart legLeft;
    private final ModelPart legRight;
    private final ModelPart eyeLeft;
    private final ModelPart eyeRight;
    private final ModelPart mouth;

    public MaskModel(ModelPart root) {
        super(root);
        this.root = root;
        this.head = root.getChild("head");
        this.body = root.getChild("body");
        this.armLeft = root.getChild("arm_left");
        this.armRight = root.getChild("arm_right");
        this.legLeft = root.getChild("leg_left");
        this.legRight = root.getChild("leg_right");
        this.eyeLeft = head.getChild("eye_left");
        this.eyeRight = head.getChild("eye_right");
        this.mouth = head.getChild("mouth");
    }

    public static TexturedModelData getTexturedModelData() {
        ModelData data = new ModelData();
        ModelPartData root = data.getRoot();

        /*
         * Ordinary human proportions, on purpose.
         *
         * He is meant to read as a person standing in your base at night, not
         * as a monster. Anything stretched or shrunk announces itself as a
         * creature and gives the game away far too early — the whole first act
         * depends on him being unremarkable.
         */
        ModelPartData head = root.addChild("head",
                ModelPartBuilder.create().uv(0, 0).cuboid(-4.0f, -8.0f, -4.0f, 8, 8, 8),
                ModelTransform.origin(0.0f, 0.0f, 0.0f));

        /*
         * The eyes and mouth stand a fraction proud of the face, and — this is
         * the part that matters — each one is built around its own pivot.
         *
         * Scaling a part stretches it *away from its pivot*. Built the obvious
         * way, with every piece measured from the middle of the head, opening
         * the mouth pushed it up the face and out through the eyes, and
         * widening the eyes marched them up over the brow. Putting each pivot
         * at the centre of its own feature makes a wider eye widen in place and
         * an open mouth open downward, which is what both of them look like on
         * a face.
         *
         * The 0.3 of a pixel of clearance stops them fighting with the mask
         * behind: flush, the two surfaces sit at the same depth and the renderer
         * picks a different winner every frame, which flickers.
         */
        head.addChild("eye_left",
                ModelPartBuilder.create().uv(0, 34).cuboid(-1.0f, -0.5f, -4.3f, 2, 1, 1),
                ModelTransform.origin(-2.0f, -5.0f, 0.0f));

        head.addChild("eye_right",
                ModelPartBuilder.create().uv(8, 34).cuboid(-1.0f, -0.5f, -4.3f, 2, 1, 1),
                ModelTransform.origin(2.0f, -5.0f, 0.0f));

        /*
         * The mouth hangs from its top edge, so it opens downward like a jaw
         * rather than growing in both directions from a centre line.
         */
        head.addChild("mouth",
                ModelPartBuilder.create().uv(16, 34).cuboid(-1.5f, 0.0f, -4.3f, 3, 1, 1),
                ModelTransform.origin(0.0f, -2.5f, 0.0f));

        root.addChild("body",
                ModelPartBuilder.create().uv(16, 16).cuboid(-4.0f, 0.0f, -2.0f, 8, 12, 4),
                ModelTransform.origin(0.0f, 0.0f, 0.0f));

        root.addChild("arm_left",
                ModelPartBuilder.create().uv(32, 48).cuboid(-1.0f, -2.0f, -2.0f, 4, 12, 4),
                ModelTransform.origin(5.0f, 2.0f, 0.0f));

        root.addChild("arm_right",
                ModelPartBuilder.create().uv(40, 16).cuboid(-3.0f, -2.0f, -2.0f, 4, 12, 4),
                ModelTransform.origin(-5.0f, 2.0f, 0.0f));

        root.addChild("leg_left",
                ModelPartBuilder.create().uv(16, 48).cuboid(-2.0f, 0.0f, -2.0f, 4, 12, 4),
                ModelTransform.origin(1.9f, 12.0f, 0.0f));

        root.addChild("leg_right",
                ModelPartBuilder.create().uv(0, 16).cuboid(-2.0f, 0.0f, -2.0f, 4, 12, 4),
                ModelTransform.origin(-1.9f, 12.0f, 0.0f));

        return TexturedModelData.of(data, 64, 64);
    }

    @Override
    public void setAngles(MaskRenderState state) {
        rest();

        float phase = state.phase;

        /*
         * Breathing, and very little of it.
         *
         * Enough that he is not a statue, not so much that he looks alive. The
         * arms are half a beat behind the chest, because two things moving in
         * perfect time read as one mechanism.
         */
        float breath = MathHelper.sin(phase * 0.045f);
        body.originY = breath * 0.25f;
        head.originY = breath * 0.25f;
        armLeft.originY = 2.0f + breath * 0.18f;
        armRight.originY = 2.0f + MathHelper.sin(phase * 0.045f - 0.6f) * 0.18f;

        // Arms hang, with a small amount of drift so they are not welded on.
        armLeft.roll = 0.06f + MathHelper.sin(phase * 0.021f) * 0.02f;
        armRight.roll = -0.06f - MathHelper.sin(phase * 0.019f) * 0.02f;

        /*
         * A walk, when he is actually walking.
         *
         * Legs and arms in opposition, driven by how fast he is moving rather
         * than by a timer, so he stands still when he is standing still. This
         * is the one place ordinary humanity is worth spending geometry on: a
         * figure that slides across the floor is a ghost, and he is not one yet.
         */
        float swing = state.limbSwingAmplitude;
        if (swing > 0.01f) {
            float step = state.limbSwingAnimationProgress;
            legLeft.pitch = MathHelper.cos(step * 0.66f) * 1.2f * swing;
            legRight.pitch = MathHelper.cos(step * 0.66f + (float) Math.PI) * 1.2f * swing;
            armLeft.pitch = MathHelper.cos(step * 0.66f + (float) Math.PI) * 0.9f * swing;
            armRight.pitch = MathHelper.cos(step * 0.66f) * 0.9f * swing;
        }

        /*
         * The eyes. Each expression is a lid height and an angle, mirrored
         * between the two so a scowl points inward the way a face does.
         *
         * Scaled rather than swapped for a different texture: a narrowed eye
         * that is genuinely narrower catches the light differently, and the
         * glow layer follows the same geometry for free.
         */
        float lid;
        float tilt;

        /*
         * Small angles.
         *
         * The first pass used up to half a radian, which on two lit rectangles
         * three pixels wide does not read as an expression — it reads as two
         * paddles that have come loose. At this size the difference between
         * calm and furious is a few degrees, and anything more is a cartoon.
         */
        switch (state.expression) {
            case PLEASED -> { lid = 0.85f; tilt = -0.13f; }
            case THINKING -> { lid = 0.60f; tilt = 0.07f; }
            case UNEASY -> { lid = 0.70f; tilt = 0.10f; }
            case STARING -> { lid = 1.60f; tilt = 0.0f; }
            case ANGRY -> { lid = 0.75f; tilt = 0.26f; }
            case BLANK -> { lid = 0.0f; tilt = 0.0f; }
            default -> { lid = 1.0f; tilt = 0.0f; }
        }

        /*
         * The blink, which the last act does not get.
         *
         * Blinking is the cheapest signal of "alive" there is, and taking it
         * away is noticed long before it is understood. Staring does not blink
         * either — that is the point of staring.
         */
        if (state.expression != Expression.STARING && state.expression != Expression.BLANK) {
            lid *= (1.0f - state.blink);
        }

        eyeLeft.yScale = lid;
        eyeRight.yScale = lid;
        eyeLeft.roll = -tilt;
        eyeRight.roll = tilt;

        /*
         * The mouth, opened by the sound he is actually making.
         *
         * Not a loop and not random: the render state carries the loudness of
         * the audio playing right now, so it opens on vowels and closes between
         * words. Blank has no mouth at all rather than a shut one — by then he
         * has stopped speaking, so it would never open anyway.
         */
        boolean blank = state.expression == Expression.BLANK;
        float open = blank ? 0.0f : state.mouthOpen;

        mouth.yScale = 0.6f + open * 2.6f;

        /*
         * Blank is the absence of a face, not a closed one.
         *
         * Eyes and mouth are switched off entirely, so the head is a smooth
         * black shape with nothing lit on it. Scaling them to zero would leave
         * a seam of geometry that catches the light at the wrong angle.
         */
        mouth.visible = !blank;
        eyeLeft.visible = !blank;
        eyeRight.visible = !blank;
    }

    /** Back to a plain standing figure, so every frame starts from one place. */
    private void rest() {
        for (ModelPart part : new ModelPart[]{head, body, armLeft, armRight,
                legLeft, legRight, eyeLeft, eyeRight, mouth}) {
            part.pitch = 0.0f;
            part.yaw = 0.0f;
            part.roll = 0.0f;
            part.xScale = 1.0f;
            part.yScale = 1.0f;
            part.zScale = 1.0f;
            part.visible = true;
        }
        armLeft.originY = 2.0f;
        armRight.originY = 2.0f;
        head.originY = 0.0f;
        body.originY = 0.0f;
    }
}
