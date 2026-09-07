package dev.nexuscraft.ember;

import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents;
import net.fabricmc.fabric.api.message.v1.ServerMessageEvents;
import net.fabricmc.fabric.api.itemgroup.v1.ItemGroupEvents;
import net.fabricmc.fabric.api.object.builder.v1.entity.FabricDefaultAttributeRegistry;
import net.minecraft.entity.EntityType;
import net.minecraft.entity.SpawnGroup;
import net.minecraft.item.Item;
import net.minecraft.item.ItemGroups;
import net.minecraft.registry.Registries;
import net.minecraft.registry.Registry;
import net.minecraft.registry.RegistryKey;
import net.minecraft.registry.RegistryKeys;
import net.minecraft.util.Identifier;
import net.minecraft.util.math.Box;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.List;

/**
 * Ember — a lantern keeper that follows you and burns the dark back.
 *
 * Deliberately not part of Hollow. Hollow is a face with no body that grows
 * less friendly the longer you keep it; this is a body with no face that simply
 * helps, and the two would undercut each other sharing a jar.
 */
public class Ember implements ModInitializer {

    public static final String MOD_ID = "ember";

    public static final Logger LOG = LoggerFactory.getLogger("Ember");

    /** Stamped at build time so a running game can be told from a stale one. */
    public static final String BUILD = "0.2.0-1712";

    /** One voice for the server, holding the short conversation history. */
    private static final Voice VOICE = new Voice();

    /** So the entity itself can speak when something happens to it. */
    public static Voice voice() {
        return VOICE;
    }

    public static Identifier id(String path) {
        return Identifier.of(MOD_ID, path);
    }

    public static final RegistryKey<EntityType<?>> EMBER_KEY =
            RegistryKey.of(RegistryKeys.ENTITY_TYPE, id("ember"));

    public static final EntityType<EmberEntity> EMBER = Registry.register(
            Registries.ENTITY_TYPE,
            EMBER_KEY,
            EntityType.Builder.create(EmberEntity::new, SpawnGroup.MISC)
                    .dimensions(0.5f, 0.6f)
                    .makeFireImmune()
                    .build(EMBER_KEY));

    public static final RegistryKey<Item> LANTERN_KEY =
            RegistryKey.of(RegistryKeys.ITEM, id("ember_lantern"));

    public static final Item EMBER_LANTERN = Registry.register(
            Registries.ITEM,
            LANTERN_KEY,
            new EmberLanternItem(new Item.Settings()
                    .registryKey(LANTERN_KEY)
                    .maxCount(1)));

    @Override
    public void onInitialize() {
        /*
         * Says which build this is, in the log and once in chat on join.
         *
         * Minecraft loads mods at startup, so a jar replaced while the game is
         * running has no effect — and leaving a world to the title screen does
         * not reload anything either. That cost a round trip of "it is still
         * broken" against "the fix is installed", with both true at once.
         */
        LOG.info("Ember {} loaded", BUILD);

        FabricDefaultAttributeRegistry.register(EMBER, EmberEntity.createEmberAttributes());

        /*
         * Middle-click travels from the client, and is checked here.
         *
         * The client says which entity; the server decides whether that player
         * owns it and can reach it. A request is not a permission.
         */
        net.fabricmc.fabric.api.networking.v1.PayloadTypeRegistry.playC2S()
                .register(dev.nexuscraft.ember.net.EmberAction.ID,
                          dev.nexuscraft.ember.net.EmberAction.CODEC);

        net.fabricmc.fabric.api.networking.v1.ServerPlayNetworking.registerGlobalReceiver(
                dev.nexuscraft.ember.net.EmberAction.ID,
                (payload, context) -> context.server().execute(() -> {
                    var player = context.player();
                    var entity = player.getEntityWorld().getEntityById(payload.entityId());
                    if (!(entity instanceof EmberEntity ember)) return;

                    switch (payload.action()) {
                        case dev.nexuscraft.ember.net.EmberAction.GRAB -> ember.grabToggle(player);
                        case dev.nexuscraft.ember.net.EmberAction.THROW -> ember.throwFor(player);
                        case dev.nexuscraft.ember.net.EmberAction.SATCHEL -> ember.openSatchel(player);
                        default -> { }
                    }
                }));

        /*
         * In the creative menu beside the other tools.
         *
         * A registered item that belongs to no group exists and is completely
         * unreachable: it will not appear in creative, and the only way to hold
         * one is to already know the recipe. The first build shipped that way,
         * and the mod looked broken because nothing could be found.
         */
        ItemGroupEvents.modifyEntriesEvent(ItemGroups.TOOLS)
                .register(entries -> entries.add(EMBER_LANTERN));

        /*
         * Home is wherever they last slept.
         *
         * The game's own definition, so it needs no explaining and is right by
         * default; saying "this is home" overrides it.
         */
        net.fabricmc.fabric.api.entity.event.v1.EntitySleepEvents.STOP_SLEEPING.register(
                (entity, sleepingPos) -> {
                    if (!(entity instanceof net.minecraft.server.network.ServerPlayerEntity player)) return;
                    long day = player.getEntityWorld().getTimeOfDay() / 24000L;
                    Waypoints.setHome(player.getUuid(),
                            player.getEntityWorld().getRegistryKey().getValue().toString(), sleepingPos, day);
                });

        EmberCommand.register();

        /*
         * Ember answers when its own owner speaks near it.
         *
         * Gated on the owner rather than on everyone: on a server, a lantern
         * that replies to every line of chat is noise, and four of them
         * replying at once is unusable.
         */
        /*
         * Load the model before anyone asks it anything.
         *
         * Without this the first question of a session pays the whole model
         * load and times out, which reads as the mod being broken rather than
         * as Ollama being cold.
         */
        ServerLifecycleEvents.SERVER_STARTED.register(server -> Warmth.warm());
        // And give it straight back when they stop playing.
        ServerLifecycleEvents.SERVER_STOPPING.register(server -> Warmth.release());

        /*
         * Deaths, written by the code rather than the model.
         *
         * Where and how someone died is a fact, and Ember is not always in the
         * conversation when it happens — asking the model to remember it would
         * mean only remembering the ones it was told about.
         */
        net.fabricmc.fabric.api.entity.event.v1.ServerLivingEntityEvents.AFTER_DEATH.register(
                (entity, source) -> {
                    if (!(entity instanceof net.minecraft.server.network.ServerPlayerEntity player)) return;
                    long day = player.getEntityWorld().getTimeOfDay() / 24000L;
                    var at = player.getBlockPos();
                    Journal.remember(player.getUuid(), day,
                            "Died to " + source.getName() + " at " + at.getX() + ", " + at.getY()
                                    + ", " + at.getZ() + ".");

                    // The same fact as coordinates, so Ember can walk them back.
                    Waypoints.setDeath(player.getUuid(),
                            player.getEntityWorld().getRegistryKey().getValue().toString(), at, day);
                });
        net.fabricmc.fabric.api.networking.v1.ServerPlayConnectionEvents.DISCONNECT.register(
                (handler, server) -> {
                    dev.nexuscraft.ember.voice.Ears.forget(handler.getPlayer().getUuid());
                    Notices.forget(handler.getPlayer().getUuid());
                    VOICE.forget(handler.getPlayer().getUuid());
                });
        ServerTickEvents.END_SERVER_TICK.register(server -> {
            Warmth.tick();

            /*
             * Anything worth mentioning unprompted.
             *
             * Checked twice a second rather than every tick — none of it
             * changes faster than that, and the scan for exposed ore is the
             * most expensive thing the mod does.
             */
            if (server.getTicks() % 10 == 0) {
                for (var player : server.getPlayerManager().getPlayerList()) {
                    if (!(player.getEntityWorld() instanceof net.minecraft.server.world.ServerWorld world)) continue;

                    List<EmberEntity> mine = world.getEntitiesByClass(
                            EmberEntity.class,
                            player.getBoundingBox().expand(16.0),
                            candidate -> player.getUuid().equals(candidate.getOwnerId()));
                    if (mine.isEmpty()) continue;

                    String worthSaying = Notices.spot(world, player, mine.get(0));
                    if (worthSaying != null) VOICE.hear(server, player, mine.get(0), worthSaying);
                }
            }

            /*
             * Anything said out loud, once the speaker stops.
             *
             * Ears buffers the microphone and transcribes on its own thread;
             * this is where a finished sentence arrives, on the server thread,
             * and it is treated exactly as though it had been typed.
             */
            dev.nexuscraft.ember.voice.Ears.tick((speaker, heard) -> server.execute(() -> {
                var player = server.getPlayerManager().getPlayer(speaker);
                if (player == null) return;

                List<EmberEntity> mine = player.getEntityWorld().getEntitiesByClass(
                        EmberEntity.class,
                        player.getBoundingBox().expand(24.0),
                        candidate -> speaker.equals(candidate.getOwnerId()));
                if (mine.isEmpty()) return;

                // Shown as well as heard, so there is a record of what it
                // thought you said when it answers the wrong question.
                player.sendMessage(net.minecraft.text.Text.literal("you said: " + heard)
                        .formatted(net.minecraft.util.Formatting.DARK_GRAY), false);

                VOICE.hear(server, player, mine.get(0), heard);
            }));
        });

        ServerMessageEvents.CHAT_MESSAGE.register((message, sender, params) -> {
            String text = message.getContent().getString().trim();
            if (text.isEmpty() || text.startsWith("/")) return;

            List<EmberEntity> nearby = sender.getEntityWorld().getEntitiesByClass(
                    EmberEntity.class,
                    sender.getBoundingBox().expand(24.0),
                    candidate -> sender.getUuid().equals(candidate.getOwnerId()));

            if (nearby.isEmpty()) return;
            VOICE.hear(sender.getEntityWorld().getServer(), sender, nearby.get(0), text);
        });
    }
}
