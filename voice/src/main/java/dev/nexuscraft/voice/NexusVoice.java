package dev.nexuscraft.voice;

import net.fabricmc.api.ModInitializer;
import net.fabricmc.loader.api.FabricLoader;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * A voice, for whichever of our mods wants one.
 *
 * On its own this does nothing at all — no entity, no command, no sound. It
 * exists so that Ember and Hollow can each speak without either of them
 * carrying its own 52MB copy of ONNX Runtime, which would not merely be 104MB
 * of download but two native runtimes loading the same shared libraries into
 * one JVM. That is the kind of clash that produces an UnsatisfiedLinkError
 * halfway through a sentence and no useful explanation.
 *
 * One copy, one model file on disk, one place to fix a mispronunciation.
 *
 * The public surface is deliberately tiny: ask {@link KokoroVoice#speak} for
 * samples and do what you like with them. Nothing here knows about entities,
 * chat, or Simple Voice Chat, because the two mods that use it disagree about
 * all three — Ember speaks from a lantern across a voice chat, Hollow plays
 * through the client's own speakers.
 */
public class NexusVoice implements ModInitializer {

    public static final String MOD_ID = "nexusvoice";

    public static final Logger LOG = LoggerFactory.getLogger("NexusVoice");

    @Override
    public void onInitialize() {
        /*
         * Where the model files live: config/nexusvoice, beside everything
         * else a player might reasonably delete.
         *
         * Not inside either mod's own folder, because they share it. The first
         * of them to want a voice pays the 82MB download and the second finds
         * it already there.
         */
        Models.keepIn(FabricLoader.getInstance().getConfigDir().resolve(MOD_ID));

        LOG.info("voice ready — models in {}", Models.directory());
    }
}
