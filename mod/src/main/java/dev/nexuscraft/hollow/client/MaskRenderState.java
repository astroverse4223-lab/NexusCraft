package dev.nexuscraft.hollow.client;

import dev.nexuscraft.hollow.entity.Expression;
import net.minecraft.client.render.entity.state.LivingEntityRenderState;

/**
 * What the renderer is allowed to know about the mask.
 *
 * The interesting field is {@link #mouthOpen}. It is not a loop and it is not
 * random: it is the loudness of the audio Hollow is playing *right now*, taken
 * from the samples on their way to the speakers. So the mask opens on vowels,
 * closes between words, and stops the instant the line ends — without anybody
 * writing a single keyframe, and correct for a sentence nobody has ever said
 * before, which is every sentence in this mod.
 *
 * This is only possible because Hollow's speech is client-side. Ember's voice
 * comes out of an entity across Simple Voice Chat and the client never sees the
 * samples; this one is played by the same process that draws the face.
 */
public class MaskRenderState extends LivingEntityRenderState {

    public Expression expression = Expression.CALM;

    /** Advances with the entity, so the float and drift are continuous. */
    public float phase;

    /** 0 shut, 1 wide. Sampled from the audio; see Speech.mouthOpenness(). */
    public float mouthOpen;

    /**
     * How far through a blink it is, 0 to 1.
     *
     * Kept out of the model so the timing is per-entity rather than per-frame,
     * and so the last act can simply stop supplying it.
     */
    public float blink;

    /** The colour burning inside, from the act. 0xRRGGBB. */
    public int glow = 0x55FFFF;

    /** Which painted glow texture his eyes and mouth use. */
    public int eyeColour;
}
