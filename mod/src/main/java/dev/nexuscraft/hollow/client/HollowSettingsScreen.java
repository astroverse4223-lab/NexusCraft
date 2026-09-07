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

    /** Set after a save, so there is visible confirmation something happened. */
    private String note = null;

    public HollowSettingsScreen(Screen parent) {
        super(Text.literal("Hollow"));
        this.parent = parent;
    }

    @Override
    protected void init() {
        HollowConfig config = HollowConfig.load();
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
                .<String>builder(value -> Text.literal("Voice: " + value), legalVoice(voice))
                .values("chirp", "narrator", "speech", "both", "off")
                .build(left, y, 200, 20, Text.literal("Voice"), (button, value) -> voice = value));

        y += 34;
        addDrawableChild(ButtonWidget.builder(Text.literal("Save"), button -> save())
                .dimensions(left, y, 98, 20).build());
        addDrawableChild(ButtonWidget.builder(Text.literal("Done"), button -> close())
                .dimensions(left + 102, y, 98, 20).build());
    }

    /** Guards against a config file holding something not in the list. */
    private static String legalVoice(String value) {
        return switch (value == null ? "" : value) {
            case "narrator", "speech", "both", "off" -> value;
            default -> "chirp";
        };
    }

    private void save() {
        try {
            HollowConfig.set("model", model.getText().trim());
            HollowConfig.set("baseUrl", endpoint.getText().trim());
            HollowConfig.set("voice", voice);

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
