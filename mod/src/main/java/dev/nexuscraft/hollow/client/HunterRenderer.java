package dev.nexuscraft.hollow.client;

import dev.nexuscraft.hollow.Hollow;
import dev.nexuscraft.hollow.entity.HunterEntity;
import net.minecraft.client.render.RenderLayer;
import net.minecraft.client.render.RenderLayers;
import net.minecraft.client.render.entity.EntityRendererFactory;
import net.minecraft.client.render.entity.MobEntityRenderer;
import net.minecraft.client.render.entity.feature.EyesFeatureRenderer;
import net.minecraft.client.render.entity.feature.FeatureRendererContext;
import net.minecraft.util.Identifier;

/** Draws the thing that comes for you, and the light it took with it. */
public class HunterRenderer extends MobEntityRenderer<HunterEntity, HunterRenderState, HunterModel> {

    private static final Identifier TEXTURE = Hollow.id("textures/entity/hollow.png");

    public HunterRenderer(EntityRendererFactory.Context context) {
        /*
         * No shadow.
         *
         * Hollow has one because it says he is standing on your floor. This
         * does not touch the floor and should not claim to — and a thing with
         * no shadow gliding through a lit room is worth the one line it costs.
         */
        super(context, new HunterModel(context.getPart(HollowModelLayers.HUNTER)), 0.0f);
        this.addFeature(new Glow(this));
    }

    @Override
    public HunterRenderState createRenderState() {
        return new HunterRenderState();
    }

    @Override
    public void updateRenderState(HunterEntity entity, HunterRenderState state, float tickDelta) {
        super.updateRenderState(entity, state, tickDelta);
        state.phase = entity.age + tickDelta;
        state.eyeColour = entity.eyeColour();
    }

    @Override
    public Identifier getTexture(HunterRenderState state) {
        return TEXTURE;
    }

    /**
     * The eyes, at full brightness, from Hollow's own palette.
     *
     * Literally his textures — not a copy, the same files. Whatever colour is
     * burning in his face is burning in this one, which is the entire point of
     * the design and costs nothing to arrange because the eyes are at the same
     * texture coordinates on both models.
     */
    private static final class Glow extends EyesFeatureRenderer<HunterRenderState, HunterModel> {

        private static final int COLOURS = 8;
        private static final RenderLayer[] LAYERS = new RenderLayer[COLOURS];

        static {
            for (int i = 0; i < COLOURS; i++) {
                LAYERS[i] = RenderLayers.eyes(Hollow.id("textures/entity/hollow_glow_" + i + ".png"));
            }
        }

        private RenderLayer chosen = LAYERS[0];

        Glow(FeatureRendererContext<HunterRenderState, HunterModel> context) {
            super(context);
        }

        @Override
        public void render(net.minecraft.client.util.math.MatrixStack matrices,
                           net.minecraft.client.render.command.OrderedRenderCommandQueue queue,
                           int light, HunterRenderState state, float yaw, float pitch) {
            chosen = LAYERS[Math.floorMod(state.eyeColour, COLOURS)];
            super.render(matrices, queue, light, state, yaw, pitch);
        }

        @Override
        public RenderLayer getEyesTexture() {
            return chosen;
        }
    }
}
