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
import net.fabricmc.fabric.api.message.v1.ServerMessageEvents;
import net.minecraft.util.ActionResult;
import net.minecraft.util.math.Vec3d;
import net.minecraft.entity.ItemEntity;
import net.minecraft.entity.decoration.ArmorStandEntity;
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
                Arrival.release(serverWorld, server, pos, random);
                state.release();
                /*
                 * He comes out of the box, physically, with a little hop. This
                 * is the first time the player sees the thing itself rather
                 * than a voice, and it matters that it lands on the floor in
                 * front of them and rolls — that is the moment it stops being
                 * an effect and becomes an object they can pick up.
                 */
                Ball.spawn(serverWorld, Vec3d.ofCenter(pos).add(0, 0.6, 0), new Vec3d(0, 0.34, 0));
                for (String line : Arrival.INTRODUCTION) Beats.say(server, line, state.act());
                Voice.speak(serverWorld, server, "hello", state.act(), random);
                state.meet(serverWorld.getTimeOfDay() / 24000L);
                return ActionResult.SUCCESS;
            }

            if (block.contains("bed")) Watcher.sawSleep(state, serverWorld, pos);
            else Watcher.sawStorage(state, serverWorld, pos);

            // Never consumes the interaction; the player still opens the chest.
            return ActionResult.PASS;
        });

        ServerTickEvents.END_SERVER_TICK.register(this::tick);
    }

    private void tick(MinecraftServer server) {
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

            ItemEntity ball = Ball.find(world, player);
            if (ball == null) {
                // Lost — down a ravine into unloaded chunks, or a world that
                // predates him having a body at all.
                ball = Ball.spawn(world, player.getEntityPos().add(0, 0.8, 0), Vec3d.ZERO);
            }
            if (ball == null) continue;

            if (Ball.tryPickUp(world, player, ball)) {
                Companion.despawn(player);
                Ball.forget(id);
                faceDrawnFor.remove(id);
                carrying.add(id);
                continue;
            }

            Ball.roll(ball, player, act);

            if (Ball.isBurning(ball)) {
                // Teeth for as long as he is in there, not just when he speaks.
                angryUntil.put(id, worldTime + 40);
                if (worldTime >= quietAboutFireUntil.getOrDefault(id, 0L)) {
                    Beats.say(player, Ball.burningLine(act, random), act);
                    // Long enough that it is a voice from the fire rather than
                    // a stream of complaints; he is in there until fished out.
                    quietAboutFireUntil.put(id, worldTime + 100);
                }
            }

            ArmorStandEntity stand = Companion.summon(player, act, random);
            if (stand == null) continue;

            Companion.faceAt(stand, Ball.facePlace(ball));

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
        Act act = progression.act();
        Boon.Answer answer = Boon.request(text, act);

        ArmorStandEntity stand = Companion.summon(player, act, random);

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

            Beats.say(player, answer.reason(), act);
            progression.recordBeat(worldTime);
            return;
        }

        deliver(player, answer.stack());
        if (stand != null) Companion.setFace(stand, Face.PLEASED, act);
        Beats.say(player, thanksFor(answer, act), act);
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

    private static String thanksFor(Boon.Answer answer, Act act) {
        int count = answer.stack().getCount();
        String what = answer.stack().getItem().getName().getString();
        return switch (act) {
            case COMPANION -> "There you go — " + count + " " + what + ". Anything else?";
            case UNEASE -> "Here. " + count + " " + what + ".";
            case WATCHING -> count + " " + what + ". You always ask for the same things.";
            case HOLLOW -> "Take it.";
        };
    }

    /** Starts a thought, if it is not already busy and not sulking. */
    private void considerSpeaking(ServerPlayerEntity player, Progression progression, long worldTime) {
        considerSpeaking(player, progression, worldTime, null);
    }

    private void considerSpeaking(ServerPlayerEntity player, Progression progression, long worldTime,
                                  String playerSaid) {
        Long quietUntil = silentUntil.get(player.getUuid());
        // A GO_QUIET beat means exactly that. Answering through it would undo
        // the only beat whose whole effect is absence.
        if (quietUntil != null && worldTime < quietUntil) {
            if (playerSaid == null) return;
        }

        ArmorStandEntity stand = Companion.summon(player, progression.act(), random);
        if (stand != null) Companion.setFace(stand, Face.THINKING, progression.act());

        director.think(player, progression.act(), progression.observations(), playerSaid);
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
                ArmorStandEntity stand = Companion.summon(player, progression.act(), random);
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

        ArmorStandEntity stand = Companion.summon(player, act, random);

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
            if (progression.maybeAdvance(today)) {
                LOG.info("the companion has moved to act {}", progression.act().id);
            }
        }
    }
}
