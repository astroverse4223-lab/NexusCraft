package dev.nexuscraft.hollow;

import com.mojang.brigadier.arguments.StringArgumentType;
import dev.nexuscraft.hollow.director.Act;
import dev.nexuscraft.hollow.director.Beat;
import dev.nexuscraft.hollow.director.Beats;
import dev.nexuscraft.hollow.director.Progression;
import net.fabricmc.fabric.api.command.v2.CommandRegistrationCallback;
import net.minecraft.server.command.CommandManager;
import net.minecraft.server.command.ServerCommandSource;
import net.minecraft.server.network.ServerPlayerEntity;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.text.Text;
import net.minecraft.util.Formatting;

import java.util.random.RandomGenerator;

/**
 * `/hollow`, for operators.
 *
 * Two reasons this exists, and the second is the important one.
 *
 * The arc is paced across a fortnight of play, which is right for playing and
 * impossible for testing: every beat past the first act is unreachable without
 * two weeks or a rebuilt jar with the thresholds collapsed. A horror mod whose
 * horror cannot be observed is a horror mod that ships on faith.
 *
 * And it is worth having for its own sake. Someone who installs this wants to
 * know what they are in for before committing a world to it, and being able to
 * look at the last act and go back is better than a video of someone else's.
 * Setting an act forward is not cheating — the state is per-world, and a world
 * you skipped ahead in is one you chose to skip ahead in.
 */
public final class HollowCommand {

    private HollowCommand() {}

    private static final RandomGenerator RANDOM = RandomGenerator.getDefault();

    public static void register() {
        CommandRegistrationCallback.EVENT.register((dispatcher, registry, environment) ->
            dispatcher.register(CommandManager.literal("hollow")
                /*
                 * Operators only. 1.21.11 replaced `hasPermissionLevel(int)`
                 * with a permission predicate, so the level-2 check is now
                 * asking the source's own permissions whether the gamemaster
                 * check passes. GAMEMASTERS is the old level 2.
                 */
                .requires(source -> CommandManager.GAMEMASTERS_CHECK.allows(source.getPermissions()))

                .then(HollowSettingsCommand.build())

                .then(CommandManager.literal("status")
                    .executes(context -> {
                        ServerWorld world = context.getSource().getWorld();
                        Progression state = Progression.get(world);
                        long today = world.getTimeOfDay() / 24000L;

                        context.getSource().sendFeedback(() -> Text.literal(
                                "act " + state.act().id
                                        + " | beats " + state.beatsThisAct()
                                        + " | known " + state.daysKnown(today) + " day(s)"
                                        + " | remembers " + state.observations().size()
                                        + " | hunt in " + (state.huntScheduled()
                                                ? state.daysUntilHunt(today) + " day(s)"
                                                : "not scheduled")
                        ).formatted(Formatting.GRAY), false);

                        // Shown here because this is the operator's debug view.
                        // The player is never told what it has noticed — being
                        // told is the beat, and a list would spend all of them.
                        for (String note : state.observations()) {
                            context.getSource().sendFeedback(
                                    () -> Text.literal("  knows: " + note).formatted(Formatting.DARK_GRAY), false);
                        }
                        return 1;
                    }))

                .then(CommandManager.literal("act")
                    .then(CommandManager.argument("which", StringArgumentType.word())
                        .executes(context -> {
                            String wanted = StringArgumentType.getString(context, "which");
                            ServerWorld world = context.getSource().getWorld();
                            Progression state = Progression.get(world);

                            /*
                             * Advanced by stepping, not by assignment, so the
                             * one rule the arc has — it never goes backwards —
                             * is not quietly bypassed by its own debug command.
                             * Going back means a new world, as it does in play.
                             */
                            Act target = Act.fromId(wanted);
                            if (target.ordinal() < state.act().ordinal()) {
                                context.getSource().sendError(Text.literal(
                                        "It does not go back. Currently " + state.act().id + "."));
                                return 0;
                            }

                            state.forceAct(target);
                            context.getSource().sendFeedback(
                                    () -> Text.literal("now in act " + target.id).formatted(Formatting.GRAY), true);
                            return 1;
                        })))

                .then(CommandManager.literal("beat")
                    .then(CommandManager.argument("which", StringArgumentType.word())
                        .executes(context -> {
                            ServerPlayerEntity player = context.getSource().getPlayer();
                            if (player == null) {
                                context.getSource().sendError(Text.literal("run this as a player"));
                                return 0;
                            }

                            Beat beat = Beat.fromName(StringArgumentType.getString(context, "which"));
                            Act act = Progression.get(context.getSource().getWorld()).act();

                            boolean happened = Beats.perform(beat, player, act, RANDOM);
                            context.getSource().sendFeedback(() -> Text.literal(
                                    beat.name() + (happened ? " happened" : " had nothing to work with")
                            ).formatted(Formatting.GRAY), false);
                            return happened ? 1 : 0;
                        })))
            )
        );
    }
}
