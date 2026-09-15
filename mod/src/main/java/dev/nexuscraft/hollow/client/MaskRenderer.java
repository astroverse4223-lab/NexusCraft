package dev.nexuscraft.hollow.client;

import dev.nexuscraft.hollow.Hollow;
import dev.nexuscraft.hollow.entity.Expression;
import dev.nexuscraft.hollow.entity.MaskEntity;
import net.minecraft.client.render.entity.EntityRendererFactory;
import net.minecraft.client.render.entity.MobEntityRenderer;
import net.minecraft.util.Identifier;
import net.minecraft.util.math.MathHelper;

/**
 * Draws the mask.
 *
 * Two things happen here that the model cannot do for itself, because both need
 * to know what time it is rather than what shape things are.
 *
 * The blink, which has to be occasional and irregular. A blink on a timer reads
 * as a machine; a blink at a random interval reads as a creature, and it is one
 * of the cheapest tricks available.
 *
 * The mouth, which is sampled from the audio currently playing. That number is
 * only meaningful for a few milliseconds, so it is read once per frame and put
 * into the render state rather than reached for from inside the model.
 */
public class MaskRenderer extends MobEntityRenderer<MaskEntity, MaskRenderState, MaskModel> {

    private static final Identifier TEXTURE = Hollow.id("textures/entity/hollow.png");

    public MaskRenderer(EntityRendererFactory.Context context) {
        // No shadow. It is a face in the air, and a shadow under it would say
        // it has a body somewhere.
        super(context, new MaskModel(context.getPart(HollowModelLayers.MASK)), 0.4f);

        /*
         * The lit eyes and mouth, drawn over the top at full brightness.
         *
         * Without this he is a black figure that vanishes completely in an
         * unlit cave — which is where the mod spends most of its time.
         */
        this.addFeature(new HollowEyesFeature(this));
    }

    @Override
    public MaskRenderState createRenderState() {
        return new MaskRenderState();
    }

    @Override
    public void updateRenderState(MaskEntity entity, MaskRenderState state, float tickDelta) {
        super.updateRenderState(entity, state, tickDelta);

        /*
         * His stride, measured rather than inherited.
         *
         * super.updateRenderState fills these from the entity's own limb
         * tracking, which is zero for him — he is placed rather than moved, so
         * the physics engine believes he is standing still and his legs never
         * swing however far he walks.
         */
        state.limbSwingAmplitude = entity.walkAmount();
        state.limbSwingAnimationProgress = entity.walkPhase();

        state.expression = entity.expression();
        state.eyeColour = entity.eyeColour();
        state.phase = entity.phase() + tickDelta;
        state.glow = Expression.glowFor(entity.act());

        /*
         * The mouth follows whatever it is saying out loud.
         *
         * Zero when it is not speaking, which is most of the time, and which is
         * also what the last act gets permanently — it stops talking, so it
         * stops moving its mouth, without either of those being coded as a
         * special case.
         */
        state.mouthOpen = Speech.mouthOpenness();

        /*
         * A blink roughly every four seconds, from a wave rather than a timer.
         *
         * Squaring a slow sine and taking only its peak gives a shut eye that
         * is brief and an open one that is long, which is the right proportion;
         * an even wave looks like something struggling to stay awake.
         */
        float slow = MathHelper.sin(state.phase * 0.012f);
        float peak = slow * slow * slow * slow;
        state.blink = peak > 0.86f ? (peak - 0.86f) / 0.14f : 0.0f;
    }

    @Override
    public Identifier getTexture(MaskRenderState state) {
        return TEXTURE;
    }
}
