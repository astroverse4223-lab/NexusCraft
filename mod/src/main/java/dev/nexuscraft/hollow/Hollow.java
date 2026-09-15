package dev.nexuscraft.hollow;

import dev.nexuscraft.hollow.director.Act;
import dev.nexuscraft.hollow.director.Beat;
import dev.nexuscraft.hollow.director.Beats;
import dev.nexuscraft.hollow.director.Boon;
import dev.nexuscraft.hollow.director.Director;
import dev.nexuscraft.hollow.director.Face;
import dev.nexuscraft.hollow.director.Progression;
import dev.nexuscraft.hollow.director.Prompt;
import dev.nexuscraft.hollow.director.Warning;
import dev.nexuscraft.hollow.director.Watcher;
import dev.nexuscraft.hollow.director.Arrival;
import dev.nexuscraft.hollow.director.Voice;
import dev.nexuscraft.hollow.entity.Ball;
import dev.nexuscraft.hollow.entity.Companion;
import dev.nexuscraft.hollow.entity.Hunter;
import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents;
import net.fabricmc.fabric.api.event.player.UseBlockCallback;
import net.fabricmc.fabric.api.event.player.UseItemCallback;
import net.fabricmc.fabric.api.message.v1.ServerMessageEvents;
import net.minecraft.util.ActionResult;
import net.minecraft.util.math.Vec3d;
import net.minecraft.entity.ItemEntity;
import net.minecraft.item.ItemStack;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.network.ServerPlayerEntity;
import net.minecraft.server.world.ServerWorld;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.random.RandomGenerator;

/**
 * A companion that helps you, until it doesn't.
 *
 * Everything that can live on the server does. The horror is meant to arrive
 * before the monster does — a sound from a direction you are not facing, a
 * torch that goes out, a line of chat that knows something it should not — and
 * every one of those is something a server can do to an unmodified client. It
 * also means the whole arc can be tested headlessly: start a server, join with
 * a scripted client, watch what it does. A horror mod nobody can test is a
 * horror mod that ships broken.
 *
 * This is `main`, not `DedicatedServerModInitializer`. That distinction is easy
 * to get wrong and expensive: a dedicated-server entrypoint never fires for a
 * single-player world, because the integrated server is not a dedicated one —
 * the mod would sit silent in exactly the place most people play.
 *
 * The menu is the exception. Splash text and the title screen are drawn before
 * a server exists at all, so the parts of this that reach them live in
 * `client`, and do nothing when there is no client.
 */
public class Hollow implements ModInitializer {

    public static final String MOD_ID = "hollow";

    /**
     * He comes out.
     *
     * Pulled out of the right-click handler so the crate can call it too. Both
     * routes have to do the same eleven things in the same order — release the
     * state, drop the ball, say the introduction — and two copies of that drift
     * apart the first time one of them is edited.
     */
    public static void openTheBox(ServerWorld world, ServerPlayerEntity player,
                                  net.minecraft.util.math.BlockPos pos) {
        Progression state = Progression.get(world.getServer().getOverworld());
        if (state.released()) return;

        var random = java.util.random.RandomGenerator.getDefault();
        Arrival.release(world, player, pos, random);
        state.release();

        for (String line : Arrival.INTRODUCTION) Beats.say(player, line, state.act());

        /*
         * And the lamp, straight away.
         *
         * The first act has to be worth having or the last one is worth
         * nothing, and a gift in the first minute does more for that than any
         * amount of friendly dialogue — particularly this gift, on a night that
         * is now genuinely black. Every time the player reaches for it after
         * this, he gave it to them.
         */
        net.minecraft.item.ItemStack lamp = new net.minecraft.item.ItemStack(FLASHLIGHT);
        if (!player.getInventory().insertStack(lamp)) player.dropItem(lamp, false);
        for (String line : Arrival.GIFT) Beats.say(player, line, state.act());

        world.playSound(null, pos, net.minecraft.sound.SoundEvents.ENTITY_ITEM_PICKUP,
                net.minecraft.sound.SoundCategory.PLAYERS, 0.6f, 1.3f);

        Voice.speak(world, player, "hello", state.act(), random);
        state.meet(world.getTimeOfDay() / 24000L);

        /*
         * And then he shuts up for a minute.
         *
         * He has just said four things in one tick and handed over a lamp. The
         * director's own beats do not know that, so one would land on top of
         * the introduction — the player's first thirty seconds with him were a
         * wall of text, and the spoken version was still catching up long
         * after. A beat's worth of quiet costs nothing and lets the moment be
         * the moment.
         */
        if (instance != null) {
            instance.silentUntil.put(player.getUuid(), world.getTimeOfDay() + 1200);
        }
    }

    public static final net.minecraft.registry.RegistryKey<net.minecraft.entity.EntityType<?>> HUNTER_KEY =
            net.minecraft.registry.RegistryKey.of(net.minecraft.registry.RegistryKeys.ENTITY_TYPE, id0("hunter"));

    /**
     * Taller than he is, and thinner. It flies, so the hitbox is its own.
     */
    public static final net.minecraft.entity.EntityType<dev.nexuscraft.hollow.entity.HunterEntity> HUNTER =
            net.minecraft.registry.Registry.register(
                    net.minecraft.registry.Registries.ENTITY_TYPE,
                    HUNTER_KEY,
                    net.minecraft.entity.EntityType.Builder.<dev.nexuscraft.hollow.entity.HunterEntity>create(
                                    dev.nexuscraft.hollow.entity.HunterEntity::new,
                                    net.minecraft.entity.SpawnGroup.MONSTER)
                            .dimensions(0.6f, 2.6f)
                            .makeFireImmune()
                            .build(HUNTER_KEY));

    public static final net.minecraft.registry.RegistryKey<net.minecraft.item.Item> FIGURE_KEY =
            net.minecraft.registry.RegistryKey.of(net.minecraft.registry.RegistryKeys.ITEM, id0("hollow_figure"));

    /**
     * Him, in an inventory slot: a small carved figure.
     *
     * This was a magma cream. Not a magma cream with a custom texture — an
     * actual vanilla magma cream, which is why the mod's own hollow_ball.png
     * had never once been drawn and could not be: a vanilla item takes its
     * model from vanilla, so what you carried was a flat orange ball with no
     * relationship to the black figure you had been walking around with.
     */
    public static final net.minecraft.item.Item FIGURE =
            net.minecraft.registry.Registry.register(
                    net.minecraft.registry.Registries.ITEM,
                    FIGURE_KEY,
                    new net.minecraft.item.Item(new net.minecraft.item.Item.Settings()
                            .registryKey(FIGURE_KEY)
                            .maxCount(1)));

    public static final net.minecraft.registry.RegistryKey<net.minecraft.item.Item> FLASHLIGHT_KEY =
            net.minecraft.registry.RegistryKey.of(net.minecraft.registry.RegistryKeys.ITEM, id0("flashlight"));

    /**
     * A lamp you point, with a battery that runs down.
     *
     * Durability is the battery: full is a fresh cell, and it is spent by being
     * lit rather than by being used on anything. Unbreakable would make the
     * dark nights merely inconvenient; running out in one is the whole game.
     */
    public static final net.minecraft.item.Item FLASHLIGHT =
            net.minecraft.registry.Registry.register(
                    net.minecraft.registry.Registries.ITEM,
                    FLASHLIGHT_KEY,
                    new dev.nexuscraft.hollow.item.FlashlightItem(
                            new net.minecraft.item.Item.Settings()
                                    .registryKey(FLASHLIGHT_KEY)
                                    .maxCount(1)
                                    .maxDamage(dev.nexuscraft.hollow.item.FlashlightItem.BATTERY)));

    private static net.minecraft.util.Identifier id0(String path) {
        return net.minecraft.util.Identifier.of(MOD_ID, path);
    }

    public static net.minecraft.util.Identifier id(String path) {
        return net.minecraft.util.Identifier.of(MOD_ID, path);
    }

    public static final net.minecraft.registry.RegistryKey<net.minecraft.entity.EntityType<?>> MASK_KEY =
            net.minecraft.registry.RegistryKey.of(net.minecraft.registry.RegistryKeys.ENTITY_TYPE, id("mask"));

    /**
     * The face, at last as a thing in the world rather than as a name tag.
     *
     * Person-sized, because he is now a person-shaped thing standing on the
     * floor rather than a face hanging in the air. The same box a player
     * occupies, so he fits through his own doorways.
     */
    public static final net.minecraft.entity.EntityType<dev.nexuscraft.hollow.entity.MaskEntity> MASK =
            net.minecraft.registry.Registry.register(
                    net.minecraft.registry.Registries.ENTITY_TYPE,
                    MASK_KEY,
                    net.minecraft.entity.EntityType.Builder.create(
                                    dev.nexuscraft.hollow.entity.MaskEntity::new,
                                    net.minecraft.entity.SpawnGroup.MISC)
                            .dimensions(0.6f, 1.8f)
                            .makeFireImmune()
                            .build(MASK_KEY));

    public static final net.minecraft.registry.RegistryKey<net.minecraft.entity.EntityType<?>> CRATE_KEY =
            net.minecraft.registry.RegistryKey.of(net.minecraft.registry.RegistryKeys.ENTITY_TYPE, id("crate"));

    /** The box he arrives in. Slightly under a block, so it reads as a crate. */
    public static final net.minecraft.entity.EntityType<dev.nexuscraft.hollow.entity.CrateEntity> CRATE =
            net.minecraft.registry.Registry.register(
                    net.minecraft.registry.Registries.ENTITY_TYPE,
                    CRATE_KEY,
                    net.minecraft.entity.EntityType.Builder.create(
                                    dev.nexuscraft.hollow.entity.CrateEntity::new,
                                    net.minecraft.entity.SpawnGroup.MISC)
                            .dimensions(0.9f, 0.8f)
                            .build(CRATE_KEY));
    public static final Logger LOG = LoggerFactory.getLogger(MOD_ID);

    private HollowConfig config;
    private Director director;

    /**
     * The running mod, so a settings command can reach the live director.
     *
     * Changing the model used to mean editing a file and rejoining the world,
     * which is a poor way to try three models against each other and a worse
     * one to discover you typed the key wrong. A static handle is the plainest
     * thing that works here: there is exactly one of these per game.
     */
    private static Hollow instance;

    /** Re-reads the config and swaps in a director that uses it. */
    public static void reloadConfig() {
        if (instance == null) return;
        instance.config = HollowConfig.load();

        Director previous = instance.director;
        instance.director = new Director(instance.config);
        // Shut down after the replacement is live, so a thought that is
        // mid-flight cannot land on a director nobody is polling any more.
        if (previous != null) previous.shutdown();

        LOG.info("reloaded: model {} at {}", instance.config.model, instance.config.baseUrl);
    }

    /** Things players have said, waiting for the next thought. */
    private final ConcurrentLinkedQueue<Said> heard = new ConcurrentLinkedQueue<>();

    private record Said(UUID player, String text) {}

    /** How long each companion stays quiet after a GO_QUIET beat. */
    private final Map<UUID, Long> silentUntil = new HashMap<>();

    /**
     * The act each companion's face was last drawn for.
     *
     * The face is otherwise only redrawn when the companion does something, so
     * after an act changed it carried on wearing the previous one until the
     * next time it spoke — minutes of a warm aqua smile on something that had
     * already stopped being warm. The face is the entire performance here, and
     * it cannot lag behind the thing it exists to signal.
     */
    private final Map<UUID, Act> faceDrawnFor = new HashMap<>();

    /** Who currently has him in a pocket, so the change is only acted on once. */
    private final java.util.Set<UUID> carrying = new java.util.HashSet<>();

    /** Stops the burning lines becoming one continuous scream. */
    private final Map<UUID, Long> quietAboutFireUntil = new HashMap<>();

    /** Until when he is showing teeth, because of something you did to him. */
    private final Map<UUID, Long> angryUntil = new HashMap<>();

    /**
     * Hitting him counts, and counts double.
     *
     * Called from the entity, which has no way to reach the director. A swing
     * is a much plainer statement than anything typed, and it is treated as
     * one: two strikes, and a flare that lasts twice as long.
     */
    /**
     * The running server, when there is one.
     *
     * Kept from the tick rather than from a lifecycle event, because the tick
     * is the only place that is guaranteed to have run before anything wants
     * it, and it is handed one every time.
     */
    private net.minecraft.server.MinecraftServer running;

    private static net.minecraft.server.MinecraftServer server() {
        return instance == null ? null : instance.running;
    }

    public static void tookOffence(UUID who, long worldTime) {
        if (instance == null) return;
        int flare = dev.nexuscraft.hollow.director.Temper.slight(who, worldTime, 2);
        instance.angryUntil.put(who, worldTime + flare);
    }

    /** The face currently being held against the resting pool, if any. */
    private final Map<UUID, String> forcedFace = new HashMap<>();

    /** Until when a second refusal counts as asking again rather than asking. */
    private final Map<UUID, Long> refusedAgainBy = new HashMap<>();

    private final RandomGenerator random = RandomGenerator.getDefault();

    @Override
    public void onInitialize() {
        instance = this;
        config = HollowConfig.load();
        director = new Director(config);
        LOG.info("Hollow is listening. Model: {} at {}", config.model, config.baseUrl);

        net.fabricmc.fabric.api.object.builder.v1.entity.FabricDefaultAttributeRegistry.register(
                MASK, dev.nexuscraft.hollow.entity.MaskEntity.createMaskAttributes());
        net.fabricmc.fabric.api.object.builder.v1.entity.FabricDefaultAttributeRegistry.register(
                CRATE, dev.nexuscraft.hollow.entity.CrateEntity.createCrateAttributes());
        net.fabricmc.fabric.api.object.builder.v1.entity.FabricDefaultAttributeRegistry.register(
                HUNTER, net.minecraft.entity.mob.VexEntity.createVexAttributes());

        /*
         * In the creative menu beside the other tools.
         *
         * A registered item in no group exists and is completely unreachable —
         * it cannot be found in creative and the only way to hold one is to
         * already know the recipe. Ember shipped that way once and looked
         * broken, because nothing could be found.
         */
        net.fabricmc.fabric.api.itemgroup.v1.ItemGroupEvents
                .modifyEntriesEvent(net.minecraft.item.ItemGroups.TOOLS)
                .register(entries -> {
                    entries.add(FLASHLIGHT);
                    entries.add(FIGURE);
                });

        net.fabricmc.fabric.api.networking.v1.ServerPlayConnectionEvents.DISCONNECT.register(
                (handler, srv) -> dev.nexuscraft.hollow.item.Beam.forget(handler.getPlayer()));

        /*
         * Where transcription happens, if it happens.
         *
         * Handed to the shared library rather than read by it, so the library
         * stays a thing that listens rather than a thing that knows about this
         * mod's config file.
         */
        dev.nexuscraft.voice.Ears.configure(new dev.nexuscraft.voice.Ears.Listening(
                config.listen, config.sttLocal, config.sttUrl,
                config.sttModel, config.sttKey, config.sttLanguage));

        /*
         * And it says so in chat when it cannot be reached, once.
         *
         * Sent to everybody, because on a single-player world that is the
         * person who needs to know and on a server the operator does.
         */
        dev.nexuscraft.voice.Ears.onTrouble(what -> {
            var running = server();
            if (running == null) return;
            running.execute(() -> running.getPlayerManager().broadcast(
                    net.minecraft.text.Text.literal(what)
                            .formatted(net.minecraft.util.Formatting.DARK_GRAY), false));
        });

        HollowCommand.register();
        ServerLifecycleEvents.SERVER_STOPPING.register(server -> director.shutdown());

        /*
         * Chat is how you talk to it. Captured here and answered on a later
         * tick rather than inline: this fires on the server thread, and calling
         * a model from it would freeze the world for everyone until the model
         * answered.
         */
        ServerMessageEvents.CHAT_MESSAGE.register((message, sender, params) -> {
            String text = message.getSignedContent();
            if (text != null && !text.isBlank()) {
                heard.add(new Said(sender.getUuid(), text.trim()));
            }
        });

        /*
         * Watching what the player does, so it has something true to repeat
         * back later. Right-clicking a bed or a chest is the moment worth
         * catching — it is when the player shows it where they sleep and where
         * they keep what they own, without ever being asked.
         */
        UseBlockCallback.EVENT.register((player, world, hand, hit) -> {
            // The instanceof is the whole check: only the server has these.
            if (!(world instanceof ServerWorld) || !(player instanceof ServerPlayerEntity server)) {
                return ActionResult.PASS;
            }
            ServerWorld serverWorld = (ServerWorld) world;
            Progression state = Progression.get(serverWorld.getServer().getOverworld());
            var pos = hit.getBlockPos();
            var block = world.getBlockState(pos).getBlock().getName().getString().toLowerCase();

            /*
             * The box takes priority over everything, and consumes the click —
             * otherwise the player gets a chest interface for the thing that
             * has just introduced itself.
             */
            if (!state.released() && Arrival.isTheBox(pos, state.boxPos())) {
                openTheBox(serverWorld, server, pos);
                return ActionResult.SUCCESS;
            }

            /*
             * Picking him up, when the click landed on the floor behind him.
             *
             * This is the normal case, not an edge one. He is a small thing
             * lying on the ground, so the crosshair aimed at him is also aimed
             * at the block underneath — and the game reports that as a block
             * interaction. Handling only the "used an item in the air" event
             * meant right-click worked when pointing at the sky and never on a
             * ball resting on the floor, which is every actual attempt.
             */
            ItemEntity underCursor = Ball.lookedAt(serverWorld, server, 4.5);
            if (underCursor != null
                    && underCursor.getEntityPos().squaredDistanceTo(server.getEyePos())
                        < hit.getPos().squaredDistanceTo(server.getEyePos()) + 1.0
                    && Ball.pickUp(serverWorld, server, underCursor)) {
                return ActionResult.SUCCESS;
            }

            if (block.contains("bed")) Watcher.sawSleep(state, serverWorld, pos);
            else Watcher.sawStorage(state, serverWorld, pos);

            // Never consumes the interaction; the player still opens the chest.
            return ActionResult.PASS;
        });

        /*
         * Right-clicking him picks him up.
         *
         * Registered against the "used an item" event rather than the "used an
         * entity" one, which never fires here: the game does not consider a
         * dropped item something you can point at, so an entity interaction on
         * the ball is not an event that exists. This fires on any right-click
         * that did not hit a block, and the aiming is done in `lookedAt`.
         */
        UseItemCallback.EVENT.register((player, world, hand) -> {
            if (!(world instanceof ServerWorld serverWorld)
                    || !(player instanceof ServerPlayerEntity server)) {
                return ActionResult.PASS;
            }
            // Main hand only, or one click is handled twice.
            if (hand != net.minecraft.util.Hand.MAIN_HAND) return ActionResult.PASS;

            ItemEntity ball = Ball.lookedAt(serverWorld, server, 4.5);
            if (ball == null) return ActionResult.PASS;
            if (!Ball.pickUp(serverWorld, server, ball)) return ActionResult.PASS;

            // Consumed, so the item in hand is not also used on him.
            return ActionResult.SUCCESS;
        });

        ServerTickEvents.END_SERVER_TICK.register(this::tick);

        /*
         * Anything said out loud, once the speaker stops.
         *
         * Treated exactly as though it had been typed — it goes into the same
         * queue chat does, so every rule about when he answers and what he will
         * refuse applies without being written twice.
         */
        ServerTickEvents.END_SERVER_TICK.register(server ->
                dev.nexuscraft.voice.Ears.tick((speaker, said) -> server.execute(() -> {
                    ServerPlayerEntity who = server.getPlayerManager().getPlayer(speaker);
                    if (who == null) return;

                    // Shown as well as heard, so there is a record of what it
                    // thought you said when it answers the wrong question.
                    who.sendMessage(net.minecraft.text.Text.literal("you said: " + said)
                            .formatted(net.minecraft.util.Formatting.DARK_GRAY), false);

                    heard.add(new Said(speaker, said));
                })));

        // The beam, moved to wherever each player with a lit lamp is looking.
        ServerTickEvents.END_SERVER_TICK.register(dev.nexuscraft.hollow.item.Beam::tick);
    }

    private void tick(MinecraftServer server) {
        this.running = server;
        var players = server.getPlayerManager().getPlayerList();
        if (players.isEmpty()) return;

        ServerWorld overworld = server.getOverworld();
        Progression progression = Progression.get(overworld);
        long worldTime = overworld.getTime();
        long today = overworld.getTimeOfDay() / 24000L;

        /*
         * Nothing happens until it has been let out.
         *
         * Before that there is no companion, no director and no beats — only a
         * box calling from somewhere nearby. Everything below is gated on this,
         * because a face that is already following you while a voice asks to be
         * released from a box makes no sense at all.
         */
        if (!progression.released()) {
            runArrival(server, progression, overworld, worldTime);
            return;
        }

        // Keep every companion beside its player, every tick. This is the only
        // part that must run continuously; everything else is occasional.
        for (ServerPlayerEntity player : players) {
            ServerWorld world = (ServerWorld) player.getEntityWorld();
            UUID id = player.getUuid();
            Act act = progression.act();

            // Refuses to be shut in anything, and says so once per attempt.
            if (Ball.escapeContainer(player)) {
                Beats.say(player, Ball.containerLine(act, random), act);
                angryUntil.put(id, worldTime + 100);
            }

            /*
             * In a pocket: no body, no face, nothing in the world at all.
             *
             * Done on the change rather than every tick — despawning the face
             * searches for strays, which is not something to do twenty times a
             * second for a player who is simply walking around with him.
             */
            if (Ball.carriedSlot(player) >= 0) {
                if (carrying.add(id)) {
                    Companion.despawn(player);
                    Ball.forget(id);
                    faceDrawnFor.remove(id);
                }
                continue;
            }
            carrying.remove(id);

            /*
             * Any ball still rolling about is tidied away.
             *
             * He used to *be* the ball, so old worlds have one lying wherever
             * it was last dropped — and now that he has legs it is a second
             * Hollow following the player around. Removed on sight rather than
             * migrated, because there is nothing in it worth keeping: it held
             * no state the figure does not.
             */
            ItemEntity ball = Ball.find(world, player);
            if (ball != null) {
                Ball.forget(id);
                ball.discard();
            }

            /*
             * He can no longer be dropped in lava, so there is nothing here.
             *
             * The burning lines went with the ball. They were good — a voice
             * complaining at you from inside a fire — and they belonged to a
             * body that could be thrown, which this one cannot be. Worth
             * bringing back if he ever gets a way to be lost again; not worth
             * faking in the meantime.
             */

            dev.nexuscraft.hollow.entity.MaskEntity stand = Companion.summon(player, act, random);
            if (stand == null) continue;

            Companion.follow(stand, player);
            Companion.applyColour(stand, config.eyeColour);

            // The one place that works out how he feels; the refusal to fetch
            // anything reads the same number, so the bar and the behaviour
            // cannot drift apart again.
            stand.setMood(dev.nexuscraft.hollow.director.Temper.mood(act, id, worldTime));

            /*
             * While something is hunting, the face goes blank and stays blank.
             *
             * This is the whole point of the last act. The companion does not
             * become the monster and does not fight it — it hangs there at the
             * edge of your vision with no expression while you are chased, and
             * goes back to smiling afterwards as though nothing happened. A
             * face that reacted would be a face that was on your side.
             */
            boolean hunted = Hunter.current(overworld, player) != null;
            boolean cross = worldTime < angryUntil.getOrDefault(id, 0L);

            /*
             * One face wins, and it is decided here rather than by whoever set
             * one last. Three things can want the face at once — the hunt, a
             * temper, and the resting pool — and letting each write it directly
             * meant the last one to run won, which is how the blank face ended
             * up flickering back to a smile mid-hunt.
             */
            String forced = hunted ? Face.BLANK
                    : cross ? (act.atLeast(Act.WATCHING) ? Face.ANGRY : Face.GRINNING)
                    : null;

            if (forced != null) {
                if (!forced.equals(forcedFace.get(id))) {
                    Companion.setFace(stand, forced, act);
                    forcedFace.put(id, forced);
                }
            } else if (forcedFace.remove(id) != null || faceDrawnFor.get(id) != act) {
                Companion.setFace(stand, Face.resting(act, random), act);
                faceDrawnFor.put(id, act);
            }
        }

        runTheCountdown(server, progression, overworld, today, random);
        /*
         * The occasional checks, once every ten seconds rather than every tick.
         * Reading light levels and health twenty times a second to notice that
         * somebody is still underground is a lot of work for a fact that changes
         * on the scale of minutes.
         */
        if (worldTime % 200 == 0) {
            for (ServerPlayerEntity player : players) {
                if (Watcher.overworld(player.getEntityWorld())) {
                    Watcher.periodic(progression, overworld, player);
                }
            }
        }

        applyFinishedThoughts(server, progression);
        answerAnythingSaid(server, progression, today, worldTime);

        /*
         * Nothing is said while the hunt is on. The silence is the performance:
         * the one time you would most want it to say something is the one time
         * it has nothing to say.
         */
        if (players.stream().anyMatch(p -> Hunter.current(overworld, p) != null)) return;

        if (director.due(worldTime)) {
            director.scheduleNext(worldTime);
            considerSpeaking(players.get(random.nextInt(players.size())), progression, worldTime);
        }
    }

    /**
     * Before it is out: place the box, and let it call.
     *
     * The calls are spaced a long way apart — roughly a minute — because the
     * point is that the player goes and finds it, not that they are nagged
     * until they do. Five lines, then it stops asking and simply waits, which
     * is more unsettling than a sixth would have been.
     */
    private void runArrival(MinecraftServer server, Progression progression, ServerWorld world,
                            long worldTime) {
        var players = server.getPlayerManager().getPlayerList();
        if (players.isEmpty()) return;
        ServerPlayerEntity player = players.get(0);

        if (!progression.boxPlaced()) {
            var box = Arrival.placeNear(world, player, random);
            progression.rememberBox(box);
            LOG.info("the box is at {}", box.toShortString());
            return;
        }

        // Once every 1200 ticks — a minute — and only five times.
        if (worldTime % 1200 != 0) return;
        if (progression.callCount() >= 5) return;

        var box = progression.boxPos();
        if (box == null) return;

        // Only when they are close enough to hear it; a voice from a box two
        // hundred blocks away is a notification, not a haunting.
        if (player.getBlockPos().getSquaredDistance(box) > 40 * 40) return;

        Arrival.callOut(world, player, box, progression.callCount(), random);
        progression.calledOut();
    }

    /**
     * The three days before it arrives, and the night it does.
     *
     * The whole last act is this. The companion schedules the arrival, counts
     * down to it out loud while sounding as though it is protecting you, goes
     * blank when the thing turns up, and is warm again the moment it is over —
     * with nothing acknowledged either way.
     */
    private void runTheCountdown(MinecraftServer server, Progression progression, ServerWorld world,
                                 long today, RandomGenerator random) {
        if (progression.act() != Act.HOLLOW) return;
        progression.scheduleHunt(today);

        for (ServerPlayerEntity player : server.getPlayerManager().getPlayerList()) {
            boolean beingHunted = Hunter.current(world, player) != null;

            /*
             * Survived it. Triggered by the thing being gone rather than by the
             * date passing, so killing it ends the night then and there instead
             * of at the next sunrise.
             */
            if (!beingHunted && progression.huntReleased()) {
                Beats.say(player, Warning.afterwards(), progression.act());
                progression.huntFinished(today);
                continue;
            }

            if (beingHunted) continue;

            int daysLeft = progression.daysUntilHunt(today);

            // The night named three days ago, and only once for that date.
            if (daysLeft <= 0 && !progression.huntReleased()
                    && Hunter.conditionsMet(world, progression.act())) {
                if (Beats.perform(Beat.HUNT, player, progression.act(), random)) {
                    progression.markHuntReleased();
                    LOG.info("the hunt has begun for {}", player.getName().getString());
                }
                continue;
            }

            String line = progression.shouldWarn(today) ? Warning.forDay(daysLeft) : null;
            if (line != null) Beats.say(player, line, progression.act());
        }
    }

    /**
     * Anything the player said, answered.
     *
     * Direct requests for materials are handled here rather than by the model.
     * Asking a model to decide what to hand over would mean trusting it with
     * the contents of someone's inventory, and it would be inconsistent about
     * diamonds — which is the one thing the companion has to be consistent
     * about for the refusal to read as character.
     */
    private void answerAnythingSaid(MinecraftServer server, Progression progression, long today, long worldTime) {
        Said said = heard.poll();
        if (said == null) return;

        ServerPlayerEntity player = server.getPlayerManager().getPlayer(said.player());
        if (player == null) return;

        /*
         * It does not answer while something is hunting you.
         *
         * The message is taken off the queue and dropped rather than held, so
         * it does not all come out at once afterwards. Calling to it and
         * getting nothing back is the point of the whole act: the blank face
         * says it has stopped reacting, and a reply would contradict that in
         * the one moment the player is most certainly listening.
         */
        if (Hunter.current((ServerWorld) player.getEntityWorld(), player) != null) return;

        progression.meet(today);

        /*
         * Being spoken to like that lands before anything else does.
         *
         * Set here rather than left to the model, because whether he is
         * offended has to be a fact the face, the refusal and the words all
         * agree on — three components each forming their own opinion is how you
         * get a smile saying something cold.
         */
        if (dev.nexuscraft.hollow.director.Temper.isUnkind(said.text())) {
            int flare = dev.nexuscraft.hollow.director.Temper.slight(
                    said.player(), worldTime, 1);
            angryUntil.put(said.player(), worldTime + flare);
        }

        String lower = said.text().toLowerCase();
        boolean asking = lower.contains("give me") || lower.contains("can i have")
                || lower.contains("i need") || lower.contains("get me") || lower.startsWith("gimme");

        if (asking) {
            handleRequest(player, said.text(), progression, worldTime);
            return;
        }

        // Anything else is conversation, which the model handles.
        considerSpeaking(player, progression, worldTime, said.text());
    }

    private void handleRequest(ServerPlayerEntity player, String text, Progression progression, long worldTime) {
        /*
         * He does favours for people who are decent to him, while he still
         * cares to.
         *
         * Two ways to lose it. Three strikes stops him fetching anything, which
         * is a far sharper answer than a cross face: the face passes in ten
         * seconds and this lasts until he has let the rest of it go. And the
         * mood itself, which the act drags down whatever you do - by the last
         * one his ceiling is eight, so he is past favours no matter how
         * pleasant you have been.
         *
         * That second half was missing, and it showed: the bar said "done with
         * you" while he cheerfully handed over whatever was asked for.
         */
        int feeling = dev.nexuscraft.hollow.director.Temper.mood(
                progression.act(), player.getUuid(), worldTime);

        if (dev.nexuscraft.hollow.director.Temper.refusing(player.getUuid(), worldTime)
                || feeling < dev.nexuscraft.hollow.director.Temper.COLD) {

            // Stated as a fact, so he refuses in his own words rather than in
            // one of two strings written months ago.
            considerSpeaking(player, progression, worldTime, text,
                    dev.nexuscraft.hollow.director.Temper.refusing(player.getUuid(), worldTime)
                            ? "They have asked you to fetch them something. You are not going"
                              + " to, because they have been unpleasant to you."
                            : "They have asked you to fetch them something. You are not going"
                              + " to. You have stopped doing things for them.");

            angryUntil.put(player.getUuid(), worldTime + dev.nexuscraft.hollow.director.Temper.FLARE);
            return;
        }

        Act act = progression.act();
        Boon.Answer answer = Boon.request(text, act);

        /*
         * It only looked like a request.
         *
         * The router here is five keywords, so "I need to find a village" and
         * "I need somewhere to sleep" both arrive as requests for items. They
         * used to be answered "I can't make that one, sorry", which is how a
         * companion who is otherwise talking to you suddenly sounds like a
         * vending machine. If nothing was actually being asked for, it is
         * conversation and goes to the model like anything else.
         */
        if (!answer.granted() && !answer.understood()) {
            considerSpeaking(player, progression, worldTime, text);
            return;
        }

        dev.nexuscraft.hollow.entity.MaskEntity stand = Companion.summon(player, act, random);

        if (!answer.granted()) {
            /*
             * Asking again is what makes him show teeth.
             *
             * The first no is a joke and looks like one. Keep asking inside a
             * couple of minutes and the same refusal arrives with a different
             * face, which says more about what is under there than any wording
             * of the refusal could.
             */
            boolean askedAgain = worldTime < refusedAgainBy.getOrDefault(player.getUuid(), 0L);
            refusedAgainBy.put(player.getUuid(), worldTime + 2400);

            if (askedAgain) angryUntil.put(player.getUuid(), worldTime + 100);
            else if (stand != null) Companion.setFace(stand, Face.REFUSING, act);

            considerSpeaking(player, progression, worldTime, text,
                    "They have asked you for something you will not give them"
                            + (answer.reason() == null ? "." : ": " + answer.reason())
                            + (askedAgain ? " They have already asked once tonight." : ""));
            progression.recordBeat(worldTime);
            return;
        }

        /*
         * The item goes now; the words follow when he has found them.
         *
         * Deliberately in that order. Thinking takes a few seconds and a
         * mechanic that waits on a language model feels broken, so what he
         * gives you is instant and what he says about it arrives the way
         * anything else he says does.
         */
        deliver(player, answer.stack());
        if (stand != null) Companion.setFace(stand, Face.PLEASED, act);

        considerSpeaking(player, progression, worldTime, text,
                "You have just handed them " + answer.stack().getCount() + " "
                        + answer.stack().getItem().getName().getString()
                        + ", because they asked you for it.");
        progression.recordBeat(worldTime);
    }

    /**
     * Hands something over, out loud, in the world.
     *
     * Thrown from where he is rather than inserted into the inventory. Items
     * appearing silently in your bag is what a creative menu does; something
     * lobbing them at your feet from across the room is a character doing you a
     * favour, and it is also the only version where the player can see which of
     * the two things in the room actually gave it to them.
     *
     * Split into stack-sized lots because the request is now whatever number
     * they asked for, and a single ItemStack of 200 iron is not a thing the
     * game can represent — it silently becomes 64 in some code paths and is
     * dropped entirely in others.
     */
    private void deliver(ServerPlayerEntity player, ItemStack requested) {
        ServerWorld world = (ServerWorld) player.getEntityWorld();
        ItemEntity ball = Ball.find(world, player);

        // From him if he is out; from the player's own hands if he is in their
        // pocket, because there is nowhere else for it to come from.
        Vec3d from = ball != null ? ball.getEntityPos().add(0, 0.3, 0)
                : player.getEntityPos().add(0, 1.2, 0);

        Vec3d toPlayer = player.getEntityPos().add(0, 0.4, 0).subtract(from);
        // A gentle underarm lob, not a throw at their face.
        Vec3d velocity = (toPlayer.lengthSquared() < 0.01 ? Vec3d.ZERO : toPlayer.normalize())
                .multiply(0.18).add(0, 0.16, 0);

        int remaining = requested.getCount();
        int perStack = Math.max(1, requested.getMaxCount());

        while (remaining > 0) {
            ItemStack lot = requested.copy();
            lot.setCount(Math.min(remaining, perStack));
            remaining -= lot.getCount();

            ItemEntity dropped = new ItemEntity(world, from.x, from.y, from.z, lot);
            dropped.setVelocity(velocity);
            // So it can be walked over immediately; this is a gift, not litter.
            dropped.setPickupDelay(10);
            world.spawnEntity(dropped);
        }
    }

    /** Starts a thought, if it is not already busy and not sulking. */
    private void considerSpeaking(ServerPlayerEntity player, Progression progression, long worldTime) {
        considerSpeaking(player, progression, worldTime, null);
    }

    private void considerSpeaking(ServerPlayerEntity player, Progression progression, long worldTime,
                                  String playerSaid) {
        considerSpeaking(player, progression, worldTime, playerSaid, null);
    }

    /**
     * The same, plus something that has just happened.
     *
     * `justHappened` is stated as a fact and nothing more, exactly like every
     * other thing he knows - "you have just handed them nine iron ingots", not
     * "thank them warmly". The prompt's whole style is to say what is true and
     * let him find the words, and that is the difference between a companion
     * and a switch statement full of quotes.
     */
    private void considerSpeaking(ServerPlayerEntity player, Progression progression, long worldTime,
                                  String playerSaid, String justHappened) {
        Long quietUntil = silentUntil.get(player.getUuid());
        // A GO_QUIET beat means exactly that. Answering through it would undo
        // the only beat whose whole effect is absence.
        if (quietUntil != null && worldTime < quietUntil) {
            if (playerSaid == null) return;
        }

        dev.nexuscraft.hollow.entity.MaskEntity stand = Companion.summon(player, progression.act(), random);
        if (stand != null) Companion.setFace(stand, Face.THINKING, progression.act());

        /*
         * How he is feeling travels with what he knows.
         *
         * Appended to the observations rather than bolted onto the prompt,
         * because the prompt's whole style is to state what is true and let him
         * decide how to say it. "Be angry" produces shouting; "they have been
         * unpleasant to you four times tonight" produces something colder.
         */
        java.util.List<String> knows = new java.util.ArrayList<>(progression.observations());
        String feeling = dev.nexuscraft.hollow.director.Temper.note(
                player.getUuid(), player.getEntityWorld().getTimeOfDay());
        if (feeling != null) knows.add(feeling);

        director.think(player, progression.act(), knows, playerSaid, justHappened);
    }

    /** Applies anything the worker finished, on the server thread. */
    private void applyFinishedThoughts(MinecraftServer server, Progression progression) {
        Director.Pending pending;
        while ((pending = director.poll()) != null) {
            ServerPlayerEntity player = server.getPlayerManager().getPlayer(pending.player());
            if (player == null) continue;

            if (pending.error() != null) {
                director.reportProblem(pending.error());
                // Back to a resting face; the player should never see it stuck
                // thinking because an endpoint was unreachable.
                dev.nexuscraft.hollow.entity.MaskEntity stand = Companion.summon(player, progression.act(), random);
                if (stand != null) {
                    Companion.setFace(stand, Face.resting(progression.act(), random), progression.act());
                }
                continue;
            }

            apply(player, pending.reply(), progression);
        }
    }

    private void apply(ServerPlayerEntity player, Prompt.Reply reply, Progression progression) {
        Act act = progression.act();
        ServerWorld world = (ServerWorld) player.getEntityWorld();
        long worldTime = world.getTime();

        dev.nexuscraft.hollow.entity.MaskEntity stand = Companion.summon(player, act, random);

        if (reply.say() != null && !reply.say().isBlank()) {
            Beats.say(player, reply.say(), act);
            Voice.speak(world, player, reply.say(), act, random);
        }

        Beat beat = reply.beat();
        // Gated again here, not only in the prompt. The prompt is a request;
        // this is the rule.
        if (!beat.allowedIn(act)) beat = Beat.NONE;

        boolean happened = beat != Beat.NONE && Beats.perform(beat, player, act, random);

        if (beat == Beat.GO_QUIET) {
            // Two to five minutes of nothing at all.
            silentUntil.put(player.getUuid(), worldTime + 2400 + random.nextInt(3600));
        }

        if (stand != null) {
            String face = switch (beat) {
                case STALK, GLIMPSE, DARKNESS, SPEAK_AS_HOLLOW -> Face.STARING;
                default -> Face.resting(act, random);
            };
            Companion.setFace(stand, face, act);
        }

        if (reply.say() != null || happened) {
            progression.recordBeat(worldTime);
            long today = world.getTimeOfDay() / 24000L;
            /*
             * Cruelty brings the turn forward.
             *
             * Two strikes is worth a day he no longer feels he owes you, capped
             * so a determined player can shorten the arc but not skip it — the
             * first act still has to happen, or the last one means nothing.
             */
            int hastened = Math.min(6, dev.nexuscraft.hollow.director.Temper.strikes(
                    player.getUuid(), worldTime) / 2);

            if (progression.maybeAdvance(today, hastened)) {
                LOG.info("the companion has moved to act {}", progression.act().id);
            }
        }
    }
}
