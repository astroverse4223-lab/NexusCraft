package dev.nexuscraft.hollow.client;

import dev.nexuscraft.hollow.Hollow;
import net.minecraft.client.render.entity.model.EntityModelLayer;

/** Where the mod's models are looked up from. */
public final class HollowModelLayers {

    public static final EntityModelLayer MASK = new EntityModelLayer(Hollow.id("mask"), "main");

    public static final EntityModelLayer CRATE = new EntityModelLayer(Hollow.id("crate"), "main");

    public static final EntityModelLayer HUNTER = new EntityModelLayer(Hollow.id("hunter"), "main");

    private HollowModelLayers() {
    }
}
