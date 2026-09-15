package dev.nexuscraft.vigil.client;

import dev.nexuscraft.vigil.Pose;
import net.minecraft.client.render.entity.state.LivingEntityRenderState;

/**
 * What the renderer is allowed to know about it.
 *
 * One field, which is unusual and correct: it has no walk cycle, no swing, no
 * breath and no idle. Everything a normal render state carries exists to
 * animate something, and this animates nothing at all.
 */
public class FollowerRenderState extends LivingEntityRenderState {

    /** The tableau it is holding. Chosen on the server, never interpolated. */
    public Pose stance = Pose.WAITING;
}
