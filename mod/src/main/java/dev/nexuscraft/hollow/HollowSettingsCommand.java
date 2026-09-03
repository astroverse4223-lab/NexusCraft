package dev.nexuscraft.hollow;

import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.builder.LiteralArgumentBuilder;
import net.minecraft.server.command.CommandManager;
import net.minecraft.server.command.ServerCommandSource;
import net.minecraft.text.Text;
import net.minecraft.util.Formatting;

/**
 * Changing which model the companion uses, from inside the game.
 *
 * There is no settings screen because on Fabric there is no settings screen to
 * hang one on — the "Mods" button in the pause menu is a Forge feature, and on
 * Fabric it comes from Mod Menu, a separate mod. Depending on it would mean the
 * settings are unreachable for anyone who has not installed a second mod, which
 * is a worse answer than a command.
 *
 * `/hollow models` is the part that earns this. Model names have to be exact —
 * `qwen2.5:7b-instruct`, not `qwen 2.5` — and getting one wrong produces a
 * request that fails with no clue as to why. Reading the list off the server the
 * mod is actually pointed at removes the guessing.
 *
 * Changes are written to the config file and take effect on the next world
 * load. Swapping a model on a live director would mean tearing down a worker
 * mid-request, and "restart the world" is a smaller cost than that bug.
 */
public final class HollowSettingsCommand {

    private HollowSettingsCommand() {}

    private static void tell(ServerCommandSource source, String message, Formatting colour) {
        source.sendFeedback(() -> Text.literal(message).formatted(colour), false);
    }

    /**
     * Asks the configured endpoint what it serves.
     *
     * Deliberately its own thread with a short timeout: this runs from a command
     * on the server thread, and a hung endpoint must not take the world with it.
     */
    private static void listModels(ServerCommandSource source) {
        HollowConfig config = HollowConfig.load();
        tell(source, "asking " + config.baseUrl + " what it has…", Formatting.GRAY);

        Thread thread = new Thread(() -> {
            try {
                String body = dev.nexuscraft.hollow.ai.LlmClient.listModels(
                        config.baseUrl, config.apiKey, 10);
                source.getServer().execute(() -> tell(source, body, Formatting.WHITE));
            } catch (Exception e) {
                source.getServer().execute(() ->
                        tell(source, "could not reach it: " + e.getMessage(), Formatting.RED));
            }
        }, "hollow-models");
        thread.setDaemon(true);
        thread.start();
    }

    /** One `key <value>` setter, so the four below are not four copies. */
    private static LiteralArgumentBuilder<ServerCommandSource> setter(
            String label, String key, String hint) {
        return CommandManager.literal(label)
                .then(CommandManager.argument("value", StringArgumentType.greedyString())
                        .executes(context -> {
                            String value = StringArgumentType.getString(context, "value").trim();
                            try {
                                HollowConfig.set(key, value);
                                Hollow.reloadConfig();
                            } catch (Exception e) {
                                context.getSource().sendError(
                                        Text.literal("could not write the config: " + e.getMessage()));
                                return 0;
                            }
                            tell(context.getSource(),
                                    key + " = " + value + "  (live now)",
                                    Formatting.GRAY);
                            if (hint != null) tell(context.getSource(), hint, Formatting.DARK_GRAY);
                            return 1;
                        }));
    }

    public static LiteralArgumentBuilder<ServerCommandSource> build() {
        return CommandManager.literal("settings")
                .then(CommandManager.literal("show").executes(context -> {
                    HollowConfig config = HollowConfig.load();
                    tell(context.getSource(), "endpoint  " + config.baseUrl, Formatting.WHITE);
                    tell(context.getSource(), "model     " + config.model, Formatting.WHITE);
                    // Never the key itself, only whether there is one.
                    tell(context.getSource(),
                            "key       " + (config.apiKey.isEmpty() ? "(none — local model)" : "(set)"),
                            Formatting.WHITE);
                    tell(context.getSource(), "timeout   " + config.timeoutSeconds + "s", Formatting.WHITE);
                    tell(context.getSource(), "speaks    every " + config.thinkEverySeconds + "s",
                            Formatting.WHITE);
                    return 1;
                }))

                .then(CommandManager.literal("models").executes(context -> {
                    listModels(context.getSource());
                    return 1;
                }))

                .then(setter("model", "model",
                        "must match exactly — run /hollow settings models to see the list"))

                .then(setter("endpoint", "baseUrl",
                        "for Ollama this must end in /v1, or every request comes back 404"))

                .then(setter("key", "apiKey",
                        "leave empty for a local model; a hosted one needs its key"))

                .then(setter("voice", "voice",
                        "chirp | narrator | speech | both | off. Restart the game to change how it speaks."))

                .then(setter("speechengine", "speechUrl",
                        "e.g. http://127.0.0.1:8880/v1 for local Kokoro, https://api.openai.com/v1 for OpenAI"))

                .then(setter("speechvoice", "speechVoice",
                        "e.g. af_sky for Kokoro, onyx for OpenAI"))

                .then(setter("speechmodel", "speechModel",
                        "e.g. kokoro, or gpt-4o-mini-tts"))

                .then(setter("speechkey", "speechKey",
                        "only needed for a hosted engine; leave empty for a local one"))

                .then(setter("interval", "thinkEverySeconds",
                        "seconds between it considering saying something"))

                /*
                 * A one-liner for the hosted case, because it is three settings
                 * that have to agree and getting one wrong looks like a bad key.
                 * The endpoint here is the one that actually worked against a
                 * GLM coding plan; the generic bigmodel path bills separately.
                 */
                .then(CommandManager.literal("useglm")
                        .then(CommandManager.argument("apikey", StringArgumentType.greedyString())
                                .executes(context -> {
                                    String key = StringArgumentType.getString(context, "apikey").trim();
                                    try {
                                        HollowConfig.set("baseUrl", "https://api.z.ai/api/coding/paas/v4");
                                        HollowConfig.set("model", "glm-5-turbo");
                                        HollowConfig.set("apiKey", key);
                                        Hollow.reloadConfig();
                                    } catch (Exception e) {
                                        context.getSource().sendError(
                                                Text.literal("could not write the config: " + e.getMessage()));
                                        return 0;
                                    }
                                    tell(context.getSource(),
                                            "pointed at GLM (glm-5-turbo). Live now - no need to rejoin.",
                                            Formatting.GRAY);
                                    tell(context.getSource(),
                                            "if it errors, your plan may use a different endpoint — "
                                                    + "/hollow settings endpoint <url> to change it",
                                            Formatting.DARK_GRAY);
                                    return 1;
                                })))

                .then(CommandManager.literal("uselocal")
                        .executes(context -> {
                            try {
                                HollowConfig.set("baseUrl", "http://127.0.0.1:11434/v1");
                                HollowConfig.set("apiKey", "");
                                Hollow.reloadConfig();
                            } catch (Exception e) {
                                context.getSource().sendError(
                                        Text.literal("could not write the config: " + e.getMessage()));
                                return 0;
                            }
                            tell(context.getSource(),
                                    "pointed back at local Ollama. Live now - no need to rejoin.",
                                    Formatting.GRAY);
                            return 1;
                        }));
    }
}
