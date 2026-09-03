package dev.nexuscraft.hollow.ai;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;

/**
 * Talks to whatever is answering on the configured address.
 *
 * One code path for both backends, because Ollama serves an OpenAI-compatible
 * API on `/v1` and GLM serves the same shape at its own host. The only thing
 * that changes between "free and local" and "hosted and clever" is a URL, a
 * model name, and whether there is a key — so the mod does not model them as
 * two integrations, and nothing here knows which one it is talking to.
 *
 * Deliberately no JSON library. The request is small enough to build by hand,
 * the response needs exactly one string pulled out of it, and a mod that drags
 * in a JSON dependency has to shade it or fight whatever the modpack already
 * loaded. {@link Json} does the escaping and the one extraction.
 *
 * Every call here blocks. Nothing may call it from the server thread — see
 * Director, which runs these on a worker and applies the result back on the
 * next tick.
 */
public final class LlmClient {

    private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .build();

    private final String baseUrl;
    private final String model;
    private final String apiKey;
    private final int timeoutSeconds;

    public LlmClient(String baseUrl, String model, String apiKey, int timeoutSeconds) {
        // Trailing slashes are the single most common way this is written wrong.
        this.baseUrl = baseUrl == null ? "" : baseUrl.replaceAll("/+$", "");
        this.model = model;
        this.apiKey = apiKey == null ? "" : apiKey.trim();
        this.timeoutSeconds = Math.max(5, timeoutSeconds);
    }

    public record Message(String role, String content) {}

    /**
     * What the endpoint says it serves, as a readable line.
     *
     * Its own static method rather than an instance one because it is asked
     * before anything is configured — the point is to find out what to put in
     * the config, so it cannot require a working config first.
     *
     * Both response shapes are handled: OpenAI and GLM answer with `data[].id`,
     * Ollama's native list uses `models[].name`. The /v1 path returns the
     * former, but people paste the native address often enough to be worth it.
     */
    public static String listModels(String baseUrl, String apiKey, int timeoutSeconds) throws Exception {
        String trimmed = baseUrl == null ? "" : baseUrl.replaceAll("/+$", "");
        HttpRequest.Builder request = HttpRequest.newBuilder()
                .uri(URI.create(trimmed + "/models"))
                .timeout(Duration.ofSeconds(Math.max(3, timeoutSeconds)))
                .GET();
        if (apiKey != null && !apiKey.isBlank()) {
            request.header("Authorization", "Bearer " + apiKey.trim());
        }

        HttpResponse<String> response = HttpClient.newHttpClient()
                .send(request.build(), HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() / 100 != 2) {
            return "HTTP " + response.statusCode() + " from " + trimmed + "/models";
        }

        /*
         * `\\s` and not `\s`. Java 15 added `\s` as a string escape meaning a
         * literal space, so the single-backslash form compiles cleanly and
         * quietly produces " *" — zero or more *spaces* — instead of the
         * whitespace class. It happens to match the same JSON either way, which
         * is exactly why it would have survived to bite someone later.
         */
        java.util.List<String> names = new java.util.ArrayList<>();
        java.util.regex.Matcher ids = java.util.regex.Pattern
                .compile("\"(?:id|name)\"\\s*:\\s*\"([^\"]+)\"")
                .matcher(response.body());
        while (ids.find() && names.size() < 40) {
            if (!names.contains(ids.group(1))) names.add(ids.group(1));
        }

        return names.isEmpty()
                ? "it answered, but listed no models"
                : String.join(", ", names);
    }

    /** Thrown for anything that stops a reply arriving. Never fatal to the game. */
    public static class LlmException extends Exception {
        public LlmException(String message) {
            super(message);
        }
    }

    /**
     * One turn. Returns the assistant's reply text.
     *
     * `stream` is left off on purpose: the companion speaks in whole lines in
     * chat, so a token stream would only be reassembled before use.
     */
    public String chat(List<Message> messages, double temperature) throws LlmException {
        StringBuilder body = new StringBuilder();
        body.append('{');
        body.append("\"model\":").append(Json.string(model)).append(',');
        body.append("\"temperature\":").append(temperature).append(',');
        body.append("\"stream\":false,");
        body.append("\"messages\":[");
        for (int i = 0; i < messages.size(); i++) {
            Message message = messages.get(i);
            if (i > 0) body.append(',');
            body.append("{\"role\":").append(Json.string(message.role()))
                .append(",\"content\":").append(Json.string(message.content())).append('}');
        }
        body.append("]}");

        HttpRequest.Builder request = HttpRequest.newBuilder()
                .uri(URI.create(baseUrl + "/chat/completions"))
                .timeout(Duration.ofSeconds(timeoutSeconds))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body.toString()));

        // Ollama ignores the header; GLM requires it. Sending an empty one is
        // worse than sending none, so it is only added when there is a key.
        if (!apiKey.isEmpty()) request.header("Authorization", "Bearer " + apiKey);

        HttpResponse<String> response;
        try {
            response = http.send(request.build(), HttpResponse.BodyHandlers.ofString());
        } catch (java.net.ConnectException e) {
            throw new LlmException("nothing answered at " + baseUrl
                    + " — is Ollama running, or the address wrong?");
        } catch (java.net.http.HttpTimeoutException e) {
            throw new LlmException("the model took longer than " + timeoutSeconds + "s to answer");
        } catch (Exception e) {
            throw new LlmException(e.getClass().getSimpleName() + ": " + e.getMessage());
        }

        if (response.statusCode() == 404) {
            throw new LlmException("404 from " + baseUrl + "/chat/completions — for Ollama the address"
                    + " must end in /v1");
        }
        if (response.statusCode() == 401 || response.statusCode() == 403) {
            throw new LlmException("the endpoint refused the key (" + response.statusCode() + ")");
        }
        if (response.statusCode() / 100 != 2) {
            throw new LlmException("HTTP " + response.statusCode() + ": " + Json.snippet(response.body()));
        }

        String content = Json.firstMessageContent(response.body());
        if (content == null || content.isBlank()) {
            throw new LlmException("the reply had no message content");
        }
        return content.trim();
    }
}
