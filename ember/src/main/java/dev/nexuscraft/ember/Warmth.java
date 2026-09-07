package dev.nexuscraft.ember;

import dev.nexuscraft.ember.ai.LlmClient;

import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Keeps the model loaded, so the first question is not the slow one.
 *
 * Ollama drops a model out of memory after a few idle minutes, and loading a
 * 7B model back in takes most of a minute — longer than any timeout worth
 * having. Ask it something cold and the honest answer is that it timed out,
 * which is exactly how this looked on the first try.
 *
 * Hollow never had the problem because its director thinks on a timer, so
 * something had always spoken to the model recently. Ember has no reason to
 * think on its own, so it warms the model deliberately instead: once when the
 * world opens, then every few minutes, with the smallest request that counts
 * as use.
 */
public final class Warmth {

    /** Under Ollama's five-minute idle unload, with room to spare. */
    private static final long INTERVAL_MS = 4 * 60 * 1000L;

    private static final ExecutorService WARMING =
            Executors.newSingleThreadExecutor(runnable -> {
                Thread thread = new Thread(runnable, "ember-warmth");
                thread.setDaemon(true);
                return thread;
            });

    /** One at a time; a queue of warm-ups would be worse than none. */
    private static final AtomicBoolean running = new AtomicBoolean(false);

    private static long lastWarmed;

    private Warmth() {
    }

    /** Called every server tick. Cheap until the interval has passed. */
    public static void tick() {
        long now = System.currentTimeMillis();
        if (now - lastWarmed < INTERVAL_MS) return;
        lastWarmed = now;
        warm();
    }

    /**
     * Hands the model back when the world closes.
     *
     * Keeping it resident is what makes replies quick, and it costs about four
     * and a half gigabytes of video memory — which the launcher noticed and
     * warned about, because that is memory Minecraft wanted. Holding it while
     * playing is a fair trade; holding it after you have stopped is not.
     *
     * Ollama's own endpoint takes a keep_alive of zero to mean "unload now".
     * Anything that is not Ollama ignores this, which is why it is sent quietly
     * and its answer is not read.
     */
    public static void release() {
        EmberConfig config = EmberConfig.get();
        String base = config.baseUrl.trim();
        if (!base.endsWith("/v1")) return;

        String root = base.substring(0, base.length() - 3);

        WARMING.submit(() -> {
            try {
                String body = "{\"model\":\"" + config.model + "\",\"keep_alive\":0}";
                java.net.http.HttpClient.newHttpClient().send(
                        java.net.http.HttpRequest.newBuilder()
                                .uri(java.net.URI.create(root + "/api/generate"))
                                .timeout(java.time.Duration.ofSeconds(10))
                                .header("Content-Type", "application/json")
                                .POST(java.net.http.HttpRequest.BodyPublishers.ofString(body))
                                .build(),
                        java.net.http.HttpResponse.BodyHandlers.discarding());
                Ember.LOG.info("released {} — the graphics card gets its memory back", config.model);
            } catch (Exception e) {
                // Not Ollama, or already gone. Either way there is nothing to do.
                Ember.LOG.debug("could not release {}: {}", config.model, e.getMessage());
            } finally {
                lastWarmed = 0;
            }
        });
    }

    /** Warms now, whatever the interval says. */
    public static void warm() {
        EmberConfig config = EmberConfig.get();
        if (!config.chat) return;
        if (!running.compareAndSet(false, true)) return;

        lastWarmed = System.currentTimeMillis();

        WARMING.submit(() -> {
            try {
                /*
                 * The request is deliberately tiny and its answer is thrown
                 * away. The point is only that the model ends up resident.
                 */
                LlmClient client = new LlmClient(config.baseUrl, config.model, config.apiKey,
                        Math.max(config.timeoutSeconds, 120));
                client.chat(List.of(new LlmClient.Message("user", "hi")), 0.0);
                Ember.LOG.info("model {} is warm", config.model);
            } catch (Exception e) {
                // Not worth telling the player about. It will be tried again,
                // and a real question reports its own failure.
                Ember.LOG.debug("could not warm {}: {}", config.model, e.getMessage());
            } finally {
                running.set(false);
            }
        });
    }
}
