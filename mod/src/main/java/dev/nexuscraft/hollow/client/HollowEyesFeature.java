package dev.nexuscraft.hollow.client;

import dev.nexuscraft.hollow.Hollow;
import net.minecraft.client.render.RenderLayer;
import net.minecraft.client.render.RenderLayers;
import net.minecraft.client.render.entity.feature.EyesFeatureRenderer;
import net.minecraft.client.render.entity.feature.FeatureRendererContext;

/**
 * The light in the mask.
 *
 * Draws the whole model a second time with a texture that is transparent
 * everywhere except the eyes and the mouth, at full brightness. That is the
 * trick vanilla uses for enderman and spider eyes, and it is the only reason
 * this works at the bottom of an unlit cave: normal geometry takes the light
 * level of the block it stands in, so a black figure in the dark is nothing at
 * all. These two shapes ignore it.
 *
 * Which is the whole point of the design. He is a silhouette you cannot see and
 * a face you cannot miss, and in a dark corridor the first thing you get is two
 * eyes at head height with nothing around them.
 *
 * The mouth follows the same geometry the base model just posed, so it is lit
 * exactly as wide as it is open — and it is open in time with the audio he is
 * speaking. Nothing extra is needed here to make the light move with the words.
 */
public class HollowEyesFeature extends EyesFeatureRenderer<MaskRenderState, MaskModel> {

    /**
     * One layer per painted colour, built once.
     *
     * getEyesTexture() is called every frame and has no idea which entity it is
     * drawing, so the colour has to be picked in render() and stashed. Building
     * a RenderLayer per frame instead would allocate one for every mask, every
     * tick, forever.
     */
    private static final int COLOURS = 8;

    private static final RenderLayer[] GLOW = new RenderLayer[COLOURS];

    static {
        for (int i = 0; i < COLOURS; i++) {
            GLOW[i] = RenderLayers.eyes(Hollow.id("textures/entity/hollow_glow_" + i + ".png"));
        }
    }

    private RenderLayer chosen = GLOW[0];

    public HollowEyesFeature(FeatureRendererContext<MaskRenderState, MaskModel> context) {
        super(context);
    }

    @Override
    public void render(net.minecraft.client.util.math.MatrixStack matrices,
                       net.minecraft.client.render.command.OrderedRenderCommandQueue queue,
                       int light, MaskRenderState state, float yaw, float pitch) {
        chosen = GLOW[Math.floorMod(state.eyeColour, COLOURS)];
        super.render(matrices, queue, light, state, yaw, pitch);
    }

    @Override
    public RenderLayer getEyesTexture() {
        return chosen;
    }
}
