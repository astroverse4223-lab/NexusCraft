package dev.nexuscraft.hollow.client;

import net.minecraft.client.render.entity.state.LivingEntityRenderState;

/**
 * What the renderer is allowed to know about it.
 *
 * Two numbers, and no expression. Hollow has moods because he is a character;
 * this has a sway and a colour, because it is not one.
 */
public class HunterRenderState extends LivingEntityRenderState {

    /** Advances with the entity, so the drift is continuous. */
    public float phase;

    /** The painted glow texture it took from him. */
    public int eyeColour;
}
