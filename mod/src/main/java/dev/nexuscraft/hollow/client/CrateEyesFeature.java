package dev.nexuscraft.hollow.client;

import dev.nexuscraft.hollow.Hollow;
import net.minecraft.client.render.RenderLayer;
import net.minecraft.client.render.RenderLayers;
import net.minecraft.client.render.entity.feature.EyesFeatureRenderer;
import net.minecraft.client.render.entity.feature.FeatureRendererContext;

/**
 * The eyes in the gap.
 *
 * Drawn at full brightness, like Hollow's own, so they are the same two lights
 * you will be looking at for the rest of the mod — and so they work in the dark,
 * which is where a box that moves on its own is worth finding.
 *
 * The model decides whether they exist at all; this only decides that they are
 * lit. Below stage one they are switched off and this draws nothing.
 */
public class CrateEyesFeature extends EyesFeatureRenderer<CrateRenderState, CrateModel> {

    private static final RenderLayer GLOW = RenderLayers.eyes(Hollow.id("textures/entity/crate_glow.png"));

    public CrateEyesFeature(FeatureRendererContext<CrateRenderState, CrateModel> context) {
        super(context);
    }

    @Override
    public RenderLayer getEyesTexture() {
        return GLOW;
    }
}
