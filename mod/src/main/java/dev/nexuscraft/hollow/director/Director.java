package dev.nexuscraft.hollow.director;

import dev.nexuscraft.hollow.Hollow;
import dev.nexuscraft.hollow.HollowConfig;
import dev.nexuscraft.hollow.ai.LlmClient;
import net.minecraft.server.network.ServerPlayerEntity;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.util.math.BlockPos;

import java.util.List;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Decides whether anything happens, and hands the answer back to the tick.
 *
 * The thread rule here is the whole class. A call to a model takes anywhere
 * from a fraction of a second to the full timeout, and the server tick has
 * 50 milliseconds. Blocking it would freeze the world for every player while a
 * face thinks of something to say, so the request goes to a single worker and
 * the result comes back through a queue that the tick drains. Nothing in this
 * file touches the world off the server thread.
 *
 * One worker, not a pool. Two overlapping thoughts would produce two lines of
 * dialogue arriving together, which reads as a glitch rather than a character.
 */
public final class Director {

    private final HollowConfig config;
    private final LlmClient llm;

    private final ExecutorService worker = Executors.newSingleThreadExecutor(runnable -> {
        Thread thread = new Thread(runnable, "hollow-director");
        // Daemon: a pending request must never keep a closing server alive.
        thread.setDaemon(true);
        return thread;
    });

    /** Results waiting to be applied on the server thread. */
    private final ConcurrentLinkedQueue<Pending> ready = new ConcurrentLinkedQueue<>();

    /** True while a request is in flight, so only one ever is. */
    private final AtomicBoolean thinking = new AtomicBoolean(false);

    private long nextThinkTick = 0;

    public Director(HollowConfig config) {
        this.config = config;
        this.llm = new LlmClient(config.baseUrl, config.model, config.apiKey, config.timeoutSeconds);
        warmUp();
    }

    /**
     * Loads the model before anything needs it.
     *
     * A local model has to be read into the graphics card on first use, and
     * doing that while Minecraft already holds most of the card is slow — slow
     * enough that the first thing the companion tried to say timed out and it
     * went quiet for the session. One throwaway request at startup pays that
     * cost while nobody is waiting.
     *
     * Failures are ignored on purpose. If there is no model running, the mod
     * still works from its written lines, and a warning at load about something
     * the player may not have started yet is just noise.
     */
    private void warmUp() {
        if (config.temperature <= 0) return;
        worker.submit(() -> {
            try {
                llm.chat(List.of(new LlmClient.Message("user", "hello")), 0.1);
                Hollow.LOG.info("the model is loaded and answering");
            } catch (Exception e) {
                Hollow.LOG.info("no model answered at startup ({}); it will try again when needed",
                        e.getMessage());
            }
        });
    }

    /** A finished thought, and who it was about. */
    public record Pending(java.util.UUID player, Prompt.Reply reply, String error) {}

    /**
     * Whether enough time has passed to consider speaking.
     *
     * Pacing is the difference between a presence and a chatbot. Something that
     * speaks every twenty seconds is company; the same lines spread across
     * minutes are something that is with you.
     */
    public boolean due(long worldTime) {
        return worldTime >= nextThinkTick;
    }

    public void scheduleNext(long worldTime) {
        // 20 ticks a second, with a little jitter so it never lands on a rhythm
        // the player can feel coming.
        long base = (long) config.thinkEverySeconds * 20L;
        nextThinkTick = worldTime + base + (long) (Math.random() * base * 0.4);
    }

    /**
     * Starts a thought on the worker. Returns false if one is already running,
     * or if the model is switched off.
     */
    public boolean think(ServerPlayerEntity player, Act act, List<String> observations, String playerSaid) {
        if (config.temperature <= 0) return false;
        if (!thinking.compareAndSet(false, true)) return false;

        java.util.UUID who = player.getUuid();
        // Every read of the world happens here, on the server thread, before the
        // worker starts. The worker must never look at a live world.
        String situation = describe(player, act);
        String name = player.getName().getString();

        worker.submit(() -> {
            try {
                String raw = llm.chat(List.of(
                        new LlmClient.Message("system", Prompt.system(act)),
                        new LlmClient.Message("user", Prompt.situation(situation, observations, playerSaid, name))
                ), config.temperature);
                ready.add(new Pending(who, Prompt.parse(raw), null));
            } catch (LlmClient.LlmException e) {
                ready.add(new Pending(who, null, e.getMessage()));
            } catch (Exception e) {
                ready.add(new Pending(who, null, e.getClass().getSimpleName() + ": " + e.getMessage()));
            } finally {
                thinking.set(false);
            }
        });
        return true;
    }

    /** Anything the worker has finished. Called on the server thread. */
    public Pending poll() {
        return ready.poll();
    }

    public void shutdown() {
        worker.shutdownNow();
    }

    /**
     * The player's situation in one sentence.
     *
     * Written as prose rather than as fields on purpose. A model handed
     * coordinates and an inventory writes like a status readout; handed
     * "underground, hurt, after dark, alone" it writes like something watching.
     */
    private static String describe(ServerPlayerEntity player, Act act) {
        ServerWorld world = (ServerWorld) player.getEntityWorld();
        BlockPos at = player.getBlockPos();

        long timeOfDay = world.getTimeOfDay() % 24000L;
        String when = timeOfDay < 12000 ? "daytime" : "night";

        boolean underground = at.getY() < 55 && !world.isSkyVisible(at);
        int light = world.getLightLevel(at);
        boolean dark = light <= 4;

        float health = player.getHealth();
        String condition = health >= 18 ? "unhurt"
                : health >= 10 ? "hurt"
                : "badly hurt, on " + Math.round(health / 2) + " hearts";

        boolean alone = world.getServer().getPlayerManager().getPlayerList().size() <= 1;

        StringBuilder out = new StringBuilder();
        out.append(when);
        if (underground) out.append(", underground at y=").append(at.getY());
        if (dark && !underground) out.append(", in the dark");
        out.append(", ").append(condition);
        if (alone) out.append(", alone");
        if (act.atLeast(Act.WATCHING) && player.isSneaking()) out.append(", moving carefully");

        return out.toString();
    }

    /** Logged once rather than per failure, so a dead endpoint is not a spam source. */
    private boolean warnedAboutEndpoint = false;

    public void reportProblem(String message) {
        if (warnedAboutEndpoint) return;
        warnedAboutEndpoint = true;
        Hollow.LOG.warn("the companion could not reach a model: {}", message);
        Hollow.LOG.warn("it will keep to its written lines. Check config/hollow.properties.");
    }
}
