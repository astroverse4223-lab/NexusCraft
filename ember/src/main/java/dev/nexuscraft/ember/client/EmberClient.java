package dev.nexuscraft.ember.client;

import dev.nexuscraft.ember.Ember;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.rendering.v1.EntityModelLayerRegistry;
import net.fabricmc.fabric.api.client.rendering.v1.EntityRendererRegistry;
import net.minecraft.client.render.entity.model.EntityModelLayer;

public class EmberClient implements ClientModInitializer {

    public static final EntityModelLayer EMBER_LAYER =
            new EntityModelLayer(Ember.id("ember"), "main");

    @Override
    public void onInitializeClient() {
        EntityModelLayerRegistry.registerModelLayer(EMBER_LAYER, EmberModel::getTexturedModelData);
        EntityRendererRegistry.register(Ember.EMBER, EmberRenderer::new);

        /*
         * Marking the dark, while the lantern is in hand.
         *
         * Client-side only: it reads light levels the client already has and
         * draws particles only that player sees, so it costs the server
         * nothing and works the same on someone else's server.
         */
        EmberKeys.register();

        ClientTickEvents.END_CLIENT_TICK.register(client -> {
            DarkSight.tick();
            EmberKeys.tick(client);
        });
    }
}
