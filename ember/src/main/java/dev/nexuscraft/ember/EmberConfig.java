package dev.nexuscraft.ember;

import net.fabricmc.loader.api.FabricLoader;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Properties;

/**
 * config/ember.properties.
 *
 * Written on first run so there is something to edit rather than a file you
 * have to know the keys of. The defaults point at a local Ollama, because that
 * is what is already running on the machine this ships with.
 */
public final class EmberConfig {

    private static EmberConfig current;

    public final String baseUrl;
    public final String model;
    public final String apiKey;
    public final int timeoutSeconds;
    public final double temperature;
    /** False turns the talking off entirely and leaves the lantern behaviour. */
    public final boolean chat;
    /** How many items Ember will hand over in one go. */
    public final int giveLimit;

    /** False leaves it talking in chat without saying anything aloud. */
    public final boolean speak;
    public final String speechUrl;
    public final String speechModel;
    public final String speechVoice;
    public final String speechKey;
    /** Blocks its voice carries, handed straight to Simple Voice Chat. */
    public final float speechDistance;

    /** False stops it listening to the microphone; chat still works. */
    public final boolean listen;
    public final String sttUrl;
    public final String sttModel;
    public final String sttKey;
    /** Empty lets the service detect the language, which it does well. */
    public final String sttLanguage;

    private EmberConfig(Properties p) {
        this.baseUrl = p.getProperty("baseUrl", "http://127.0.0.1:11434/v1").trim();
        this.model = p.getProperty("model", "qwen2.5:7b-instruct").trim();
        this.apiKey = p.getProperty("apiKey", "").trim();
        this.timeoutSeconds = parseInt(p.getProperty("timeoutSeconds"), 120, 5, 600);
        this.temperature = parseDouble(p.getProperty("temperature"), 0.6);
        this.chat = !"false".equalsIgnoreCase(p.getProperty("chat", "true").trim());
        this.giveLimit = parseInt(p.getProperty("giveLimit"), 64, 1, 640);

        this.speak = !"false".equalsIgnoreCase(p.getProperty("speak", "true").trim());
        this.speechUrl = p.getProperty("speechUrl", "http://127.0.0.1:8880/v1").trim();
        this.speechModel = p.getProperty("speechModel", "kokoro").trim();
        this.speechVoice = p.getProperty("speechVoice", "af_sky").trim();
        this.speechKey = p.getProperty("speechKey", "").trim();
        this.speechDistance = (float) parseDouble(p.getProperty("speechDistance"), 24.0);

        this.listen = !"false".equalsIgnoreCase(p.getProperty("listen", "true").trim());
        this.sttUrl = p.getProperty("sttUrl", "http://127.0.0.1:8880/v1").trim();
        this.sttModel = p.getProperty("sttModel", "whisper-1").trim();
        this.sttKey = p.getProperty("sttKey", "").trim();
        this.sttLanguage = p.getProperty("sttLanguage", "").trim();
    }

    public static synchronized EmberConfig get() {
        if (current == null) current = load();
        return current;
    }

    /** Forgets what was read, so an edited file takes effect without a restart. */
    public static synchronized void reload() {
        current = null;
    }

    private static Path file() {
        return FabricLoader.getInstance().getConfigDir().resolve("ember.properties");
    }

    private static EmberConfig load() {
        Properties properties = new Properties();
        Path path = file();

        if (Files.exists(path)) {
            try (InputStream in = Files.newInputStream(path)) {
                properties.load(in);
            } catch (IOException e) {
                Ember.LOG.warn("could not read ember.properties, using defaults: {}", e.getMessage());
            }
        } else {
            write(path);
        }

        return new EmberConfig(properties);
    }

    private static void write(Path path) {
        try {
            Files.createDirectories(path.getParent());
            try (OutputStream out = Files.newOutputStream(path)) {
                out.write(TEMPLATE.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            }
            Ember.LOG.info("wrote a default {}", path);
        } catch (IOException e) {
            Ember.LOG.warn("could not write ember.properties: {}", e.getMessage());
        }
    }

    private static final String TEMPLATE = """
            # Ember — the lantern keeper.
            #
            # Anything speaking the OpenAI chat-completions API works here. The
            # default is the Ollama most people already have running locally.
            # For Ollama the address must end in /v1.

            baseUrl=http://127.0.0.1:11434/v1
            model=qwen2.5:7b-instruct
            apiKey=

            # The first question of a session is the slow one: Ollama has to
            # load the model into memory before it can answer, which on a 7B
            # model takes most of a minute. Later answers are seconds.
            timeoutSeconds=120

            # Kept low on purpose. Ember has to write a line and fill a list of
            # items at the same time, and a high temperature makes it say it is
            # handing something over while leaving the list empty. The warmth
            # comes from the character, not from the sampling.
            temperature=0.6

            # false leaves the lantern working and stops it talking.
            chat=true

            # The most it will hand over at once, however nicely you ask.
            giveLimit=64

            # --- speaking aloud -------------------------------------------------
            #
            # Needs the Simple Voice Chat mod installed, and a speech engine
            # answering the OpenAI /v1/audio/speech endpoint — Kokoro-FastAPI is
            # the usual local one. Without either, Ember still talks in chat.
            #
            # The voice comes from the lantern itself, so it fades with distance
            # and everyone nearby hears it.

            speak=true
            speechUrl=http://127.0.0.1:8880/v1
            speechModel=kokoro
            speechVoice=af_sky
            speechKey=

            # Blocks its voice carries.
            speechDistance=24

            # --- listening ------------------------------------------------------
            #
            # Talk to Ember with your microphone instead of typing. Needs Simple
            # Voice Chat, and a speech-to-text service answering the OpenAI
            # /v1/audio/transcriptions endpoint.
            #
            # Your voice is sent to whatever address is below and nowhere else.

            listen=true
            sttUrl=http://127.0.0.1:8880/v1
            sttModel=whisper-1
            sttKey=

            # Leave empty to let it work the language out for itself.
            sttLanguage=
            """;

    private static int parseInt(String raw, int fallback, int min, int max) {
        if (raw == null) return fallback;
        try {
            return Math.max(min, Math.min(max, Integer.parseInt(raw.trim())));
        } catch (NumberFormatException e) {
            return fallback;
        }
    }

    private static double parseDouble(String raw, double fallback) {
        if (raw == null) return fallback;
        try {
            return Double.parseDouble(raw.trim());
        } catch (NumberFormatException e) {
            return fallback;
        }
    }
}
