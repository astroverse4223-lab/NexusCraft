package dev.nexuscraft.ember.client;

import dev.nexuscraft.ember.Mood;
import net.minecraft.client.render.entity.state.LivingEntityRenderState;

/**
 * What the renderer is allowed to know about an Ember.
 *
 * The render state exists so drawing never reaches into a live entity from
 * another thread; everything the model needs is copied here once a frame.
 */
public class EmberRenderState extends LivingEntityRenderState {
    public Mood mood = Mood.CONTENT;

    /** Advances with the entity, so the bob and sway are continuous. */
    public float phase;

    /** How far the shutters stand open, eased toward the mood's target. */
    public float openness = 0.55f;

    /**
     * How grown it is, 0 to 1.
     *
     * Drives the size of the flame, which is one of the few things that reads
     * at distance — unlike the texture detail, which does not.
     */
    public float grown;
}
