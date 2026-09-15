package dev.nexuscraft.ember;

import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.StringArgumentType;
import dev.nexuscraft.ember.voice.Voices;
import net.fabricmc.fabric.api.command.v2.CommandRegistrationCallback;
import net.minecraft.command.CommandSource;
import net.minecraft.item.ItemStack;
import net.minecraft.server.command.ServerCommandSource;
import net.minecraft.server.network.ServerPlayerEntity;
import net.minecraft.text.Text;
import net.minecraft.util.Formatting;

import net.minecraft.server.command.CommandManager;

import static net.minecraft.server.command.CommandManager.argument;
import static net.minecraft.server.command.CommandManager.literal;

/**
 * `/ember` — hands you the lantern.
 *
 * A convenience for testing and for handing one out on a server you run.
 * The survival route is the recipe, which the recipe book unlocks as soon as
 * you are carrying glowstone dust or an amethyst shard.
 */
public final class EmberCommand {

    private EmberCommand() {
    }

    public static void register() {
        CommandRegistrationCallback.EVENT.register((dispatcher, registry, environment) -> build(dispatcher));
    }

    private static void build(CommandDispatcher<ServerCommandSource> dispatcher) {
        /*
         * Operators only.
         *
         * 1.21.11 replaced `hasPermissionLevel(int)` with a predicate, so the
         * check goes through CommandManager's own gamemaster gate.
         *
         * This shipped ungated, which on a shared server let
         * anybody type it and be handed one for free — and in a survival world
         * it quietly made the recipe pointless. It is a testing convenience, so
         * it is gated like one; survival players craft the thing.
         */
        dispatcher.register(literal("ember")
                .requires(source -> CommandManager.GAMEMASTERS_CHECK.allows(source.getPermissions()))
                .executes(context -> {
                    ServerPlayerEntity player = context.getSource().getPlayer();
                    if (player == null) {
                        context.getSource().sendFeedback(() ->
                                Text.literal("Only a player can be given a lantern."), false);
                        return 0;
                    }

                    ItemStack stack = new ItemStack(Ember.EMBER_LANTERN);
                    if (!player.getInventory().insertStack(stack)) {
                        player.dropItem(stack, false);
                    }

                    context.getSource().sendFeedback(() ->
                            Text.literal("Ember's Lantern. Right-click to call it, again to send it away, "
                                    + "sneak and right-click to stop it lighting things."), false);
                    return 1;
                })

                /*
                 * `/ember voice` — which voice it speaks in.
                 *
                 * This lived in ember.properties, which meant alt-tabbing out
                 * of the game, finding a file, editing it and reloading, to
                 * answer a question you can only answer by ear: does this one
                 * sound right coming out of a lantern. So the change happens in
                 * game and it says a line straight afterwards in the new voice,
                 * because hearing it is the entire point.
                 */
                .then(literal("voice")
                        .executes(context -> current(context.getSource()))
                        .then(literal("list").executes(context -> list(context.getSource())))
                        .then(argument("voice", StringArgumentType.word())
                                .suggests((context, builder) ->
                                        CommandSource.suggestMatching(Voices.KNOWN.keySet(), builder))
                                .executes(context -> choose(context.getSource(),
                                        StringArgumentType.getString(context, "voice"))))));
    }

    /** What it is set to now. */
    private static int current(ServerCommandSource source) {
        String voice = EmberConfig.get().speechVoice;
        Voices.Voice known = Voices.find(voice);

        source.sendFeedback(() -> Text.literal("Ember speaks as ")
                .append(Text.literal(voice).formatted(Formatting.GOLD))
                .append(Text.literal(known == null
                        ? " — not one of the ones I know, which is fine."
                        : " (" + known.grade() + ") — " + known.sounds() + ".")), false);

        source.sendFeedback(() -> Text.literal("/ember voice list to hear what else there is.")
                .formatted(Formatting.DARK_GRAY), false);
        return 1;
    }

    /**
     * Every voice, grouped, each one clickable.
     *
     * Clickable because the alternative is reading thirty ids out of chat and
     * typing one back, and the difference between "af_aoede" and "af_alloy" is
     * not something anybody should have to transcribe.
     */
    private static int list(ServerCommandSource source) {
        String set = EmberConfig.get().speechVoice;
        String heading = "";

        for (Voices.Voice entry : Voices.all()) {
            String voice = entry.id();
            String origin = Voices.origin(voice);

            if (!origin.equals(heading)) {
                heading = origin;
                String shown = heading;
                source.sendFeedback(() -> Text.literal(shown).formatted(Formatting.DARK_GRAY), false);
            }

            boolean chosen = voice.equals(set);
            source.sendFeedback(() -> Text.literal("  ")
                    .append(Text.literal(chosen ? "● " : "○ ").formatted(Formatting.DARK_GRAY))
                    .append(Text.literal(voice)
                            .formatted(chosen ? Formatting.GOLD : Formatting.YELLOW)
                            .styled(style -> style
                                    .withClickEvent(new net.minecraft.text.ClickEvent.RunCommand(
                                            "/ember voice " + voice))
                                    .withHoverEvent(new net.minecraft.text.HoverEvent.ShowText(
                                            Text.literal("Try " + voice)))))
                    .append(Text.literal(" " + entry.grade()).formatted(gradeColour(entry.grade())))
                    .append(Text.literal(" — " + entry.sounds()).formatted(Formatting.GRAY)), false);
        }

        source.sendFeedback(() -> Text.literal(
                "Grades are Kokoro's own. Click one to hear it.").formatted(Formatting.DARK_GRAY), false);
        return Voices.all().size();
    }

    /** A grade should be readable at a glance, not counted letter by letter. */
    private static Formatting gradeColour(String grade) {
        return switch (grade.charAt(0)) {
            case 'A' -> Formatting.GREEN;
            case 'B' -> Formatting.YELLOW;
            case 'C' -> Formatting.GOLD;
            default -> Formatting.RED;
        };
    }

    /**
     * Sets the voice, then uses it.
     *
     * Any name is accepted, known or not: the list here is what Kokoro ships
     * with, and somebody pointing the mod at a different engine has voices we
     * have never heard of. Refusing those would be the mod claiming to know
     * more about another program than that program does.
     */
    private static int choose(ServerCommandSource source, String voice) {
        String cleaned = voice.toLowerCase(java.util.Locale.ROOT).trim();
        if (cleaned.isEmpty()) return 0;

        EmberConfig.set("speechVoice", cleaned);

        Voices.Voice known = Voices.find(cleaned);
        source.sendFeedback(() -> Text.literal("Ember now speaks as ")
                .append(Text.literal(cleaned).formatted(Formatting.GOLD))
                .append(Text.literal(known == null
                        ? " — I do not know that one, so this only works if your speech engine does."
                        : " (" + known.grade() + ") — " + known.sounds() + ".")), false);

        /*
         * And says something, so the choice can be judged by ear.
         *
         * Needs a lantern in the world to speak from — the voice comes out of
         * the entity's position, not the player's head — so when there is none
         * nearby it says so rather than appearing to do nothing.
         */
        ServerPlayerEntity player = source.getPlayer();
        if (player == null) return 1;

        java.util.List<EmberEntity> nearby = player.getEntityWorld().getEntitiesByClass(
                EmberEntity.class,
                player.getBoundingBox().expand(24.0),
                candidate -> player.getUuid().equals(candidate.getOwnerId()));

        if (nearby.isEmpty()) {
            source.sendFeedback(() -> Text.literal("Call your lantern and it will speak in it.")
                    .formatted(Formatting.DARK_GRAY), false);
            return 1;
        }

        dev.nexuscraft.ember.voice.Speech.say(nearby.get(0), sample(cleaned));
        return 1;
    }

    /** Something to say that is worth hearing twice while comparing voices. */
    private static String sample(String voice) {
        return "This is " + voice.replace('_', ' ') + ". It is dark down here, and I am the light.";
    }
}
