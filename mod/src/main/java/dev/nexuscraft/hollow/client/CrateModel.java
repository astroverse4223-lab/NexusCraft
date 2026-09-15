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
 * A crate with something in it.
 *
 * Four boards and a lid, and the whole performance is in how far the lid is
 * open. Shut, it is scenery. A finger's width and there is a dark line across
 * the top. Wide, and there are two eyes in it.
 *
 * The lid hinges at the back and lifts at the front, which is the wrong way
 * round for a chest and the right way round for this: it means the opening
 * faces the player, so the gap is aimed at whoever is standing in front of it.
 */
public class CrateModel extends EntityModel<CrateRenderState> {

    private final ModelPart root;
    private final ModelPart box;
    private final ModelPart lid;
    private final ModelPart eyeLeft;
    private final ModelPart eyeRight;

    public CrateModel(ModelPart root) {
        super(root);
        this.root = root;
        this.box = root.getChild("box");
        this.lid = root.getChild("lid");
        this.eyeLeft = root.getChild("eye_left");
        this.eyeRight = root.getChild("eye_right");
    }

    public static TexturedModelData getTexturedModelData() {
        ModelData data = new ModelData();
        ModelPartData root = data.getRoot();

        // The body of the crate, sitting on the floor.
        root.addChild("box",
                ModelPartBuilder.create().uv(0, 0).cuboid(-7.0f, -12.0f, -7.0f, 14, 12, 14),
                ModelTransform.origin(0.0f, 24.0f, 0.0f));

        /*
         * The lid, hinged along the back edge.
         *
         * Its pivot is at the back so raising it opens a wedge at the front,
         * widest where the player is standing. A centre pivot would lift it
         * like a tray and show nothing.
         */
        root.addChild("lid",
                ModelPartBuilder.create().uv(0, 26).cuboid(-7.5f, -2.0f, -14.5f, 15, 2, 15),
                ModelTransform.origin(0.0f, 12.0f, 7.0f));

        /*
         * Two eyes, inside, near the top and looking out of the gap.
         *
         * Placed rather than animated. They do not move; they are simply there
         * once the lid is open enough to see them, which is more unpleasant
         * than anything that could be done with them.
         */
        root.addChild("eye_left",
                ModelPartBuilder.create().uv(0, 44).cuboid(-3.5f, -2.0f, -6.5f, 2, 2, 1),
                ModelTransform.origin(0.0f, 14.0f, 0.0f));

        root.addChild("eye_right",
                ModelPartBuilder.create().uv(8, 44).cuboid(1.5f, -2.0f, -6.5f, 2, 2, 1),
                ModelTransform.origin(0.0f, 14.0f, 0.0f));

        return TexturedModelData.of(data, 64, 48);
    }

    @Override
    public void setAngles(CrateRenderState state) {
        box.pitch = 0.0f;
        box.roll = 0.0f;
        box.originY = 24.0f;

        /*
         * How far it stands open, by stage.
         *
         * Nothing at all, then a crack, then wide enough to see into, then
         * hanging off — the last one is only ever glimpsed, because the hit
         * that reaches it is also the hit that breaks the crate.
         */
        float open = switch (state.stage) {
            case 1 -> 0.22f;
            case 2 -> 0.55f;
            case 3 -> 0.95f;
            default -> 0.0f;
        };

        /*
         * And it is never quite still, harder the further open it gets.
         *
         * A shut crate only shivers. An open one is being pushed at from
         * inside, and the lid should be visibly losing the argument.
         */
        float agitation = 0.02f + open * 0.14f;
        float shiver = MathHelper.sin(state.phase * 0.4f) * agitation;

        lid.pitch = -(open + shiver);

        /*
         * A recoil when it has just been struck.
         *
         * Six ticks of the whole crate rocking back, so a hit lands rather than
         * simply incrementing a number. Without it the stages change silently
         * and the box appears to open itself.
         */
        if (state.struck > 0) {
            float kick = state.struck / 6.0f;
            box.pitch = -kick * 0.18f;
            box.roll = MathHelper.sin(state.phase * 1.4f) * kick * 0.12f;
            lid.pitch -= kick * 0.25f;
        }

        // The eyes are only there once there is a gap to see them through.
        boolean visible = state.stage >= 1;
        eyeLeft.visible = visible;
        eyeRight.visible = visible;
    }
}
