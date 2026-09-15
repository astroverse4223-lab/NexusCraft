package dev.nexuscraft.hollow.client;

import dev.nexuscraft.hollow.Hollow;
import dev.nexuscraft.hollow.HollowConfig;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.widget.ButtonWidget;
import net.minecraft.client.gui.widget.CyclingButtonWidget;
import net.minecraft.client.gui.widget.TextFieldWidget;
import net.minecraft.text.Text;
import net.minecraft.util.Formatting;

/**
 * The settings, from inside the game.
 *
 * Everything here could already be done — by editing a properties file with the
 * game closed, or by typing an operator command with the exact key spelled
 * correctly. Neither is a way to try three models against each other, and
 * neither is discoverable at all: the report that started this was simply that
 * there was no way to see the mod or change anything from the pause menu.
 *
 * Deliberately not a ModMenu integration. ModMenu is the usual home for a
 * screen like this and it is an extra mod to install first, which puts a
 * download between the player and their own settings. A button on the pause
 * menu costs nothing and is where somebody would actually look.
 *
 * Presets do the real work. `baseUrl` is the setting that decides whether this
 * talks to a local Ollama or to a hosted model, and it is also the one nobody
 * can be expected to remember — including the detail that Ollama's address
 * needs `/v1` on the end or every request comes back 404.
 */
public class HollowSettingsScreen extends Screen {

    private final Screen parent;

    private TextFieldWidget model;
    private TextFieldWidget endpoint;
    private TextFieldWidget key;

    private String voice;

    /** What burns in his eyes, as chosen in the menu. */
    private String eyeColour = "amber";

    /** Which voice he speaks in. */
    private String speechVoice = "am_michael";

    /**
     * The voices worth offering, best first.
     *
     * Kokoro ships a quality grade for all twenty-eight and they are startling
     * — they run from A down to F+. These are every male voice it grades above
     * a D, in that order, so the top of the list is also the best of them and
     * nobody has to audition twenty-two bad ones to find out.
     */
    private static final java.util.List<String> VOICES = java.util.List.of(
            "am_michael", "am_fenrir", "am_puck", "bm_fable", "bm_george",
            "af_heart", "af_bella", "bf_emma", "af_nicole");

    /** Set after a save, so there is visible confirmation something happened. */
    private String note = null;

    public HollowSettingsScreen(Screen parent) {
        super(Text.literal("Amos"));
        this.parent = parent;
    }

    @Override
    protected void init() {
        HollowConfig config = HollowConfig.load();
        eyeColour = config.eyeColour;
        speechVoice = config.speechVoice;
        voice = config.voice;

        int centre = this.width / 2;
        int left = centre - 100;
        int y = 50;

        model = new TextFieldWidget(this.textRenderer, left, y, 200, 20, Text.literal("model"));
        model.setMaxLength(120);
        model.setText(config.model);
        addDrawableChild(model);

        y += 34;
        endpoint = new TextFieldWidget(this.textRenderer, left, y, 200, 20, Text.literal("endpoint"));
        endpoint.setMaxLength(200);
        endpoint.setText(config.baseUrl);
        addDrawableChild(endpoint);

        y += 34;
        key = new TextFieldWidget(this.textRenderer, left, y, 200, 20, Text.literal("api key"));
        key.setMaxLength(200);
        /*
         * Shown as a row of dots rather than the key itself.
         *
         * People stream this game. A settings screen that prints an API key in
         * twenty-point type is a way to leak one, and the person it happens to
         * will not notice until the bill arrives.
         */
        key.setText(config.apiKey.isEmpty() ? "" : "•".repeat(Math.min(config.apiKey.length(), 24)));
        addDrawableChild(key);

        y += 40;

        // The two configurations almost everybody wants, as one click each.
        addDrawableChild(ButtonWidget.builder(Text.literal("Use local Ollama"), button -> {
            endpoint.setText("http://127.0.0.1:11434/v1");
            model.setText("qwen2.5:7b-instruct");
            key.setText("");
        }).dimensions(left, y, 98, 20).build());

        addDrawableChild(ButtonWidget.builder(Text.literal("Use GLM"), button -> {
            endpoint.setText("https://api.z.ai/api/coding/paas/v4");
            model.setText("glm-5-turbo");
            note = "Paste your GLM key in the box above, then Save.";
        }).dimensions(left + 102, y, 98, 20).build());

        y += 28;
        addDrawableChild(CyclingButtonWidget
                /*
                 * Just the value. The widget prepends its own name — the
                 * "Voice" passed to build() below — so adding another prefix
                 * here rendered the button as "Voice: Voice: speech".
                 */
                .<String>builder(Text::literal, legalVoice(voice))
                .values("chirp", "narrator", "speech", "both", "off")
                /*
                 * "Sound", not "Voice" — this one chooses *how* he is heard
                 * (chirps, the narrator, a real voice, or both) and the button
                 * below chooses *which* voice. Two controls labelled Voice sat
                 * one above the other and there was no way to tell them apart.
                 */
                .build(left, y, 200, 20, Text.literal("Sound"), (button, value) -> {
                    voice = value;
                    applyNow();
                }));

        /*
         * What burns in his eyes. Here rather than as a command, because it is
         * a thing you judge by looking at him — and the pause menu is the one
         * place you can change it, close the menu, and see the answer.
         */
        y += 24;
        addDrawableChild(CyclingButtonWidget
                .<String>builder(Text::literal, eyeColour)
                .values(dev.nexuscraft.hollow.entity.Companion.colours())
                .build(left, y, 200, 20, Text.literal("Eyes"), (button, value) -> {
                    eyeColour = value;
                    applyNow();
                }));

        /*
         * And which voice says it.
         *
         * Beside the eyes on purpose: both are things you can only judge by
         * experiencing them, and both are two clicks from the pause menu rather
         * than a file you have to leave the game to edit.
         */
        y += 24;
        addDrawableChild(CyclingButtonWidget
                .<String>builder(Text::literal, speechVoice)
                .values(VOICES)
                .build(left, y, 200, 20, Text.literal("Voice"), (button, value) -> {
                    speechVoice = value;
                    applyNow();
                }));

        y += 34;
        addDrawableChild(ButtonWidget.builder(Text.literal("Save"), button -> save())
                .dimensions(left, y, 98, 20).build());
        addDrawableChild(ButtonWidget.builder(Text.literal("Done"), button -> close())
                .dimensions(left + 102, y, 98, 20).build());
    }

    /** Guards against a config file holding something not in the list. */
    private static String legalVoice(String value) {
        return switch (value == null ? "" : value) {
            case "chirp", "narrator", "both", "off" -> value;
            default -> "speech";
        };
    }

    /**
     * The three pickers take effect the moment they are clicked.
     *
     * They did not, and there was nothing on screen to say so: you cycled
     * "Sound" from chirp to both, closed the menu, and he carried on not
     * speaking — because the choice was sitting in a field waiting for a Save
     * button that looks like it belongs to the text boxes above it. A whole
     * session was lost to that.
     *
     * The text boxes still need Save, and should: a half-typed endpoint applied
     * on every keystroke would be worse than useless. But a picker with four
     * values on it has nothing to half-type, and the only way to judge any of
     * these three is to close the menu and look, or listen.
     */
    private void applyNow() {
        try {
            HollowConfig.set("voice", voice);
            HollowConfig.set("eyeColour", eyeColour);
            HollowConfig.set("speechVoice", speechVoice);

            HollowConfig fresh = HollowConfig.load();
            HollowClient.applyVoice(fresh);
            NightFall.setEnabled(fresh.darkNights);
            NightFall.setDarkest(fresh.nightDarkness);
            MoodBar.setEnabled(fresh.moodBar);

            note = "Applied.";
        } catch (Exception e) {
            Hollow.LOG.warn("could not apply a setting from the screen", e);
            note = "Could not write config/hollow.properties: " + e.getMessage();
        }
    }

    private void save() {
        try {
            HollowConfig.set("model", model.getText().trim());
            HollowConfig.set("baseUrl", endpoint.getText().trim());
            HollowConfig.set("voice", voice);
            HollowConfig.set("eyeColour", eyeColour);
            HollowConfig.set("speechVoice", speechVoice);

            /*
             * The key is only written when it has been changed.
             *
             * The box shows dots rather than the real key, so saving what is in
             * it unedited would replace a working key with a string of bullets.
             */
            String typed = key.getText().trim();
            if (!typed.isEmpty() && !typed.chars().allMatch(c -> c == '•')) {
                HollowConfig.set("apiKey", typed);
            }

            // Takes effect now, rather than at the next world load.
            Hollow.reloadConfig();

            /*
             * Including the voice, which it did not until now.
             *
             * reloadConfig() is the director's — it refreshes the model and the
             * endpoint. The voice lives on the client and had nothing watching
             * the file, so every change made here was written and then ignored.
             */
            HollowConfig fresh = HollowConfig.load();
            HollowClient.applyVoice(fresh);
            NightFall.setEnabled(fresh.darkNights);
            NightFall.setDarkest(fresh.nightDarkness);
            MoodBar.setEnabled(fresh.moodBar);
            note = "Saved. " + model.getText().trim() + " is live.";
        } catch (Exception e) {
            Hollow.LOG.warn("could not write the config from the settings screen", e);
            note = "Could not write config/hollow.properties: " + e.getMessage();
        }
    }

    @Override
    public void render(DrawContext context, int mouseX, int mouseY, float delta) {
        super.render(context, mouseX, mouseY, delta);

        int centre = this.width / 2;
        context.drawCenteredTextWithShadow(this.textRenderer, this.title, centre, 20, 0xFFFFFF);

        context.drawTextWithShadow(this.textRenderer, Text.literal("Model").formatted(Formatting.GRAY),
                centre - 100, 38, 0xA0A0A0);
        context.drawTextWithShadow(this.textRenderer, Text.literal("Endpoint").formatted(Formatting.GRAY),
                centre - 100, 72, 0xA0A0A0);
        context.drawTextWithShadow(this.textRenderer, Text.literal("API key (blank for local)")
                        .formatted(Formatting.GRAY), centre - 100, 106, 0xA0A0A0);

        if (note != null) {
            context.drawCenteredTextWithShadow(this.textRenderer,
                    Text.literal(note).formatted(Formatting.GRAY), centre, this.height - 30, 0xAAAAAA);
        }
    }

    @Override
    public void close() {
        MinecraftClient.getInstance().setScreen(parent);
    }

    /** Typing in a text box should not walk the player around. */
    @Override
    public boolean shouldPause() {
        return true;
    }
}
