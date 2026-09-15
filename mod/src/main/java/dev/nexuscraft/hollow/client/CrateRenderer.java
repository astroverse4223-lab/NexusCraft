package dev.nexuscraft.hollow.client;

import dev.nexuscraft.hollow.Hollow;
import dev.nexuscraft.hollow.entity.CrateEntity;
import net.minecraft.client.render.entity.EntityRendererFactory;
import net.minecraft.client.render.entity.MobEntityRenderer;
import net.minecraft.util.Identifier;

/** Draws the crate, and the two lights inside it. */
public class CrateRenderer extends MobEntityRenderer<CrateEntity, CrateRenderState, CrateModel> {

    private static final Identifier TEXTURE = Hollow.id("textures/entity/crate.png");

    public CrateRenderer(EntityRendererFactory.Context context) {
        super(context, new CrateModel(context.getPart(HollowModelLayers.CRATE)), 0.5f);
        this.addFeature(new CrateEyesFeature(this));
    }

    @Override
    public CrateRenderState createRenderState() {
        return new CrateRenderState();
    }

    @Override
    public void updateRenderState(CrateEntity entity, CrateRenderState state, float tickDelta) {
        super.updateRenderState(entity, state, tickDelta);
        state.stage = entity.stage();
        state.struck = entity.struckAgo();
        state.phase = entity.age + tickDelta;
    }

    @Override
    public Identifier getTexture(CrateRenderState state) {
        return TEXTURE;
    }
}
