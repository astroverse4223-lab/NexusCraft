package dev.nexuscraft.ember.client;

import dev.nexuscraft.ember.Ember;
import dev.nexuscraft.ember.EmberEntity;
import net.minecraft.client.render.entity.EntityRendererFactory;
import net.minecraft.client.render.entity.MobEntityRenderer;
import net.minecraft.util.Identifier;
import net.minecraft.util.math.MathHelper;

/**
 * Draws an Ember.
 *
 * The only interesting thing here is the easing: the mood's openness is a step
 * function, and stepping the shutters straight to it made the model snap
 * between poses like a switch. Easing toward the target instead gives a flare
 * that throws open and a sulk that closes slowly, which is most of the
 * character.
 */
public class EmberRenderer extends MobEntityRenderer<EmberEntity, EmberRenderState, EmberModel> {

    private static final Identifier TEXTURE = Ember.id("textures/entity/ember.png");

    public EmberRenderer(EntityRendererFactory.Context context) {
        super(context, new EmberModel(context.getPart(EmberClient.EMBER_LAYER)), 0.3f);
    }

    @Override
    public EmberRenderState createRenderState() {
        return new EmberRenderState();
    }

    @Override
    public void updateRenderState(EmberEntity entity, EmberRenderState state, float tickDelta) {
        super.updateRenderState(entity, state, tickDelta);

        state.mood = entity.getMood();
        state.grown = entity.getStage().ordinal() / 3.0f;
        state.phase = entity.getPhase() + tickDelta * 0.1f;

        float target = state.mood.openness();
        // Opening is quick and closing is slow, which is how a shutter behaves
        // and also how the mood reads: alarm arrives, sulking settles.
        float rate = target > state.openness ? 0.35f : 0.06f;
        state.openness = MathHelper.lerp(rate, state.openness, target);
    }

    @Override
    public Identifier getTexture(EmberRenderState state) {
        return TEXTURE;
    }
}
