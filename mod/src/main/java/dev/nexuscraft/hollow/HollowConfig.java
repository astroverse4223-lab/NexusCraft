package dev.nexuscraft.hollow;

import net.fabricmc.loader.api.FabricLoader;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Properties;

/**
 * Where the model lives and how hard it pushes.
 *
 * A plain properties file, written with comments on first run, because the
 * people who most need to change `baseUrl` are the ones least likely to enjoy
 * hand-editing JSON with no error message when they get a comma wrong.
 *
 * The defaults point at a local Ollama, so a fresh install of this mod works
 * with no key, no account and no cloud on a machine that already has Ollama
 * running — which is the configuration most people should be in. Pointing it at
 * a hosted model is a two-line change and needs no code path of its own,
 * because both speak the same API.
 */
public final class HollowConfig {

    public final String baseUrl;
    public final String model;
    public final String apiKey;
    public final int timeoutSeconds;

    /** Seconds between the director even considering a beat. */
    public final int thinkEverySeconds;

    /** 0 disables the model entirely and leaves the scripted lines. */
    public final double temperature;

    /**
     * How it sounds: `narrator`, `chirp`, `both` or `off`.
     *
     * `narrator` uses the text-to-speech the game already ships for
     * accessibility, which is a real voice and costs nothing to add. It is not
     * the default because switching it on changes a setting that belongs to the
     * player, and doing that uninvited is not on.
     */
    public final String voice;

    /**
     * Where a real speech engine lives, and how it should sound.
     *
     * The same shape as the language-model settings, for the same reason: an
     * offline Kokoro and a hosted OpenAI voice both answer
     * `POST /v1/audio/speech`, so choosing between them is a URL rather than a
     * code path, and anything else implementing that endpoint works too.
     */
    public final String speechUrl;
    public final String speechModel;
    public final String speechVoice;
    public final String speechKey;
    public final double speechVolume;

    private HollowConfig(Properties properties) {
        this.baseUrl = properties.getProperty("baseUrl", "http://127.0.0.1:11434/v1").trim();
        this.model = properties.getProperty("model", "qwen2.5:7b-instruct").trim();
        this.apiKey = properties.getProperty("apiKey", "").trim();
        this.timeoutSeconds = parseInt(properties.getProperty("timeoutSeconds"), 90, 5, 300);
        this.thinkEverySeconds = parseInt(properties.getProperty("thinkEverySeconds"), 90, 15, 3600);
        this.temperature = parseDouble(properties.getProperty("temperature"), 0.9);
        this.voice = properties.getProperty("voice", "chirp").trim().toLowerCase();
        this.speechUrl = properties.getProperty("speechUrl", "http://127.0.0.1:8880/v1").trim();
        this.speechModel = properties.getProperty("speechModel", "kokoro").trim();
        this.speechVoice = properties.getProperty("speechVoice", "af_sky").trim();
        this.speechKey = properties.getProperty("speechKey", "").trim();
        this.speechVolume = parseDouble(properties.getProperty("speechVolume"), 0.9);
    }

    private static int parseInt(String raw, int fallback, int min, int max) {
        try {
            return Math.min(Math.max(Integer.parseInt(raw.trim()), min), max);
        } catch (Exception ignored) {
            // A typo in a config file is not worth refusing to start over.
            return fallback;
        }
    }

    private static double parseDouble(String raw, double fallback) {
        try {
            return Math.min(Math.max(Double.parseDouble(raw.trim()), 0.0), 2.0);
        } catch (Exception ignored) {
            return fallback;
        }
    }

    private static final String TEMPLATE = """
            # Hollow
            #
            # Anything that speaks the OpenAI chat-completions API works here, so
            # there is one setting rather than a choice of backend.
            #
            # Local, free, no account (the default). Ollama serves that API on /v1,
            # and the /v1 matters - without it every request comes back 404:
            #   baseUrl=http://127.0.0.1:11434/v1
            #   model=qwen2.5:7b-instruct
            #   apiKey=
            #
            # A hosted model instead - same shape, plus a key:
            #   baseUrl=https://open.bigmodel.cn/api/paas/v4
            #   model=glm-4-flash
            #   apiKey=your-key-here
            #
            # A smaller local model is usually the better choice here. The
            # companion speaks in short lines and picks from a fixed list of
            # actions, which is not a task that rewards a large model, and a
            # local one costs nothing per night played.
            #
            # What matters far more than size is whether the model will hold a
            # two-line format. Measured on the real prompts:
            #
            #   qwen2.5:7b-instruct     4/4 replies parsed
            #   sweaterdog/andy-4       0/4 replies parsed
            #
            # andy-4 is the obvious pick, being Minecraft-tuned, and it is the
            # wrong one. It is trained for an agent framework with its own
            # command vocabulary, so it answers in that instead - "!stay(5)" -
            # and ignores the format. A model fine-tuned to act in Minecraft is
            # not the same thing as a model that will play a character in it.

            baseUrl=http://127.0.0.1:11434/v1
            model=qwen2.5:7b-instruct
            apiKey=

            # How long to wait for a reply before giving up on it.
            #
            # Ninety, not thirty. A warm model answers in well under a second,
            # but the *first* request has to load it into the graphics card, and
            # doing that while Minecraft is already using the card took longer
            # than thirty seconds on an 8GB machine - so the first thing the
            # companion ever tried to say timed out and it fell silent.
            timeoutSeconds=90

            # Seconds between the director considering whether anything happens.
            # Lower is not scarier. Something that speaks every twenty seconds is
            # company; something that speaks every few minutes is a presence.
            thinkEverySeconds=90

            # 0 turns the model off entirely and leaves only the written lines,
            # which is worth trying if you want to see the arc without a model.
            temperature=0.9

            # How it sounds.
            #
            #   chirp     note-block style sounds that change pitch as it turns
            #   narrator  a real voice, using the text-to-speech the game
            #             already ships for accessibility. Choosing this turns
            #             the game's narrator on, which is a setting that
            #             belongs to you - that is why it is not the default.
            #   speech    a proper synthesised voice from a speech engine, set
            #             up below. This is the good one.
            #   both      chirps and a voice together
            #   off       silent
            voice=chirp

            # The speech engine, used when voice=speech or voice=both.
            #
            # Anything that implements OpenAI's POST /v1/audio/speech works, so
            # offline and hosted are the same setting with a different address.
            #
            # Offline, free, no account (the default). Run Kokoro-FastAPI, which
            # serves that endpoint from a local neural voice:
            #   speechUrl=http://127.0.0.1:8880/v1
            #   speechModel=kokoro
            #   speechVoice=af_sky
            #   speechKey=
            #
            # Hosted instead - same shape, plus a key:
            #   speechUrl=https://api.openai.com/v1
            #   speechModel=gpt-4o-mini-tts
            #   speechVoice=onyx
            #   speechKey=sk-your-key-here
            #
            # Microsoft's Edge voices are deliberately not supported. They are
            # not a public API but a private protocol behind a rolling signed
            # token, so an implementation works until Microsoft rotates it and
            # then goes silent for a reason you cannot debug from in here.
            speechUrl=http://127.0.0.1:8880/v1
            speechModel=kokoro
            speechVoice=af_sky
            speechKey=

            # 0 to 1. Below the game's own sound, so it does not talk over it.
            speechVolume=0.9
            """;

    /** Where the file lives, for saving as well as loading. */
    private static Path path() {
        return FabricLoader.getInstance().getConfigDir().resolve("hollow.properties");
    }

    /**
     * Changes one setting and writes the file back.
     *
     * Rewritten line by line rather than through {@link Properties#store},
     * which discards every comment in the file. Those comments are most of the
     * documentation this mod has — the note about needing `/v1` on an Ollama
     * address has saved more time than the setting itself — and losing them the
     * first time somebody changed a model would be a poor trade.
     */
    public static void set(String key, String value) throws Exception {
        Path file = path();
        java.util.List<String> lines = Files.exists(file)
                ? new java.util.ArrayList<>(Files.readAllLines(file))
                // \R matches any line ending, so the template splits the same
                // way regardless of how it was written.
                : new java.util.ArrayList<>(java.util.List.of(TEMPLATE.split("\\R")));

        boolean replaced = false;
        for (int i = 0; i < lines.size(); i++) {
            String line = lines.get(i);
            if (line.trim().startsWith("#")) continue;
            int equals = line.indexOf('=');
            if (equals <= 0) continue;
            if (!line.substring(0, equals).trim().equals(key)) continue;
            lines.set(i, key + "=" + value);
            replaced = true;
            break;
        }
        if (!replaced) lines.add(key + "=" + value);

        Files.write(file, lines);
    }

    public static HollowConfig load() {
        Path path = path();
        Properties properties = new Properties();

        try {
            if (!Files.exists(path)) {
                Files.createDirectories(path.getParent());
                Files.writeString(path, TEMPLATE);
                Hollow.LOG.info("wrote a starting config to {}", path);
            }
            try (var in = Files.newBufferedReader(path)) {
                properties.load(in);
            }
        } catch (Exception e) {
            // Defaults are a working local setup, so a config that cannot be
            // read is a warning rather than a reason to disable the mod.
            Hollow.LOG.warn("could not read {} ({}); using defaults", path, e.toString());
        }

        return new HollowConfig(properties);
    }
}
