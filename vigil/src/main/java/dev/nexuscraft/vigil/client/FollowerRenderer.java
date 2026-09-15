package dev.nexuscraft.vigil.client;

import dev.nexuscraft.vigil.FollowerEntity;
import dev.nexuscraft.vigil.Vigil;
import net.minecraft.client.render.entity.EntityRendererFactory;
import net.minecraft.client.render.entity.MobEntityRenderer;
import net.minecraft.util.Identifier;

/**
 * Draws it, and does nothing else.
 *
 * No easing, no interpolation, no per-frame anything. Ember's renderer eases
 * its shutters because a companion that snaps between moods looks like a
 * switch; this one snaps on purpose, because the snap *is* the effect. The pose
 * is copied straight across and held.
 */
public class FollowerRenderer extends MobEntityRenderer<FollowerEntity, FollowerRenderState, FollowerModel> {

    private static final Identifier TEXTURE = Vigil.id("textures/entity/follower.png");

    public FollowerRenderer(EntityRendererFactory.Context context) {
        /*
         * A shadow, and a small one.
         *
         * Tempting to give it none — a thing that casts no shadow is a classic.
         * But the shadow is what tells you it is standing on the floor of your
         * corridor rather than hovering in the fog behind it, and knowing
         * exactly how far away it is turns out to be much worse.
         */
        super(context, new FollowerModel(context.getPart(VigilClient.FOLLOWER_LAYER)), 0.4f);
    }

    @Override
    public FollowerRenderState createRenderState() {
        return new FollowerRenderState();
    }

    @Override
    public void updateRenderState(FollowerEntity entity, FollowerRenderState state, float tickDelta) {
        super.updateRenderState(entity, state, tickDelta);
        state.stance = entity.stance();
    }

    @Override
    public Identifier getTexture(FollowerRenderState state) {
        return TEXTURE;
    }
}
