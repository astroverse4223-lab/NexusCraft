package dev.nexuscraft.vigil.client;

import dev.nexuscraft.vigil.Vigil;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.rendering.v1.EntityModelLayerRegistry;
import net.fabricmc.fabric.api.client.rendering.v1.EntityRendererRegistry;
import net.minecraft.client.render.entity.model.EntityModelLayer;

public class VigilClient implements ClientModInitializer {

    public static final EntityModelLayer FOLLOWER_LAYER =
            new EntityModelLayer(Vigil.id("follower"), "main");

    @Override
    public void onInitializeClient() {
        EntityModelLayerRegistry.registerModelLayer(FOLLOWER_LAYER, FollowerModel::getTexturedModelData);
        EntityRendererRegistry.register(Vigil.FOLLOWER, FollowerRenderer::new);
    }
}
