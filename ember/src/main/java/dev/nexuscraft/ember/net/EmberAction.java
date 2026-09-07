package dev.nexuscraft.ember.net;

import dev.nexuscraft.ember.Ember;
import net.minecraft.network.RegistryByteBuf;
import net.minecraft.network.codec.PacketCodec;
import net.minecraft.network.codec.PacketCodecs;
import net.minecraft.network.packet.CustomPayload;

/**
 * Something the player wants done to their Ember.
 *
 * Everything used to go through right-clicking the entity, which meant Ember
 * had to be a target the crosshair could find — and a thing the crosshair can
 * find is a thing that steals the click you meant for a block. It was moved
 * behind the player, in front, beside and above trying to dodge that, and every
 * position was wrong somewhere: fighting, mining, placing, looking up.
 *
 * So it is no longer clickable at all. The client finds it with its own
 * raycast, which does not care whether the game considers it hittable, and asks
 * the server to do the thing. The server still decides whether it may.
 */
public record EmberAction(int entityId, int action) implements CustomPayload {

    /** Take hold of it, or let it go if already held. */
    public static final int GRAB = 0;

    /** Throw it wherever the player is looking. */
    public static final int THROW = 1;

    /** Open what it is carrying. */
    public static final int SATCHEL = 2;

    public static final CustomPayload.Id<EmberAction> ID =
            new CustomPayload.Id<>(Ember.id("action"));

    public static final PacketCodec<RegistryByteBuf, EmberAction> CODEC = PacketCodec.tuple(
            PacketCodecs.VAR_INT, EmberAction::entityId,
            PacketCodecs.VAR_INT, EmberAction::action,
            EmberAction::new);

    @Override
    public CustomPayload.Id<? extends CustomPayload> getId() {
        return ID;
    }
}
