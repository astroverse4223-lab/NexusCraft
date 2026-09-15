package dev.nexuscraft.hollow.client;

import net.minecraft.client.render.entity.state.LivingEntityRenderState;

/** What the renderer is allowed to know about the crate. */
public class CrateRenderState extends LivingEntityRenderState {

    /** 0 shut, 3 in pieces. */
    public int stage;

    /** Ticks left of the recoil from being hit; 0 most of the time. */
    public int struck;

    /** Advances with the entity, so the shiver is continuous. */
    public float phase;
}
