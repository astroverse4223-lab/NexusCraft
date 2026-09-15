package dev.nexuscraft.vigil;

import com.mojang.brigadier.CommandDispatcher;
import net.fabricmc.fabric.api.command.v2.CommandRegistrationCallback;
import net.minecraft.server.command.CommandManager;
import net.minecraft.server.command.ServerCommandSource;
import net.minecraft.server.network.ServerPlayerEntity;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.text.Text;
import net.minecraft.util.Formatting;
import net.minecraft.util.math.Box;

import java.util.List;

import static net.minecraft.server.command.CommandManager.argument;
import static net.minecraft.server.command.CommandManager.literal;

/**
 * `/vigil` — for testing it, and for running it on a server.
 *
 * A mod whose whole content arrives on a random night is impossible to work on
 * without a way to make tonight the night. `where` exists for the same reason
 * and is the one that gets used most: when something is wrong it is almost
 * always the looking, and the only way to see the looking is to ask.
 */
public final class VigilCommand {

    private VigilCommand() {
    }

    public static void register() {
        CommandRegistrationCallback.EVENT.register((dispatcher, registry, environment) -> build(dispatcher));
    }

    private static void build(CommandDispatcher<ServerCommandSource> dispatcher) {
        dispatcher.register(literal("vigil")
                .requires(source -> CommandManager.GAMEMASTERS_CHECK.allows(source.getPermissions()))

                .then(literal("send")
                        .executes(context -> send(context.getSource(), context.getSource().getPlayer()))
                        .then(argument("player", net.minecraft.command.argument.EntityArgumentType.player())
                                .executes(context -> send(context.getSource(),
                                        net.minecraft.command.argument.EntityArgumentType
                                                .getPlayer(context, "player")))))

                .then(literal("where").executes(context -> where(context.getSource())))

                .then(literal("banish").executes(context -> banish(context.getSource())))

                .then(literal("forget").executes(context -> {
                    ServerPlayerEntity player = context.getSource().getPlayer();
                    if (player == null) return 0;
                    Haunting.forget(player.getUuid());
                    context.getSource().sendFeedback(() ->
                            Text.literal("It has never met you."), false);
                    return 1;
                }))

                .then(literal("reload").executes(context -> {
                    VigilConfig.reload();
                    context.getSource().sendFeedback(() ->
                            Text.literal("Read vigil.properties again."), false);
                    return 1;
                })));
    }

    private static int send(ServerCommandSource source, ServerPlayerEntity player) {
        if (player == null || !(player.getEntityWorld() instanceof ServerWorld world)) {
            source.sendFeedback(() -> Text.literal("Nobody to follow."), false);
            return 0;
        }

        if (!Vigil.send(world, player, true)) {
            source.sendFeedback(() ->
                    Text.literal("Nowhere out there to put it. Try outdoors."), false);
            return 0;
        }

        source.sendFeedback(() -> Text.literal("Something is on its way.")
                .formatted(Formatting.DARK_GRAY), false);
        return 1;
    }

    /**
     * Where it is, how far, and whether it can see you.
     *
     * The last one is the whole mod, and it is invisible by design — when it is
     * behaving oddly the question is always "did the looking test agree with
     * what I could see", and this is the only way to ask it.
     */
    private static int where(ServerCommandSource source) {
        ServerPlayerEntity player = source.getPlayer();
        if (player == null || !(player.getEntityWorld() instanceof ServerWorld world)) return 0;

        List<FollowerEntity> found = world.getEntitiesByClass(
                FollowerEntity.class, new Box(player.getBlockPos()).expand(256.0), any -> true);

        if (found.isEmpty()) {
            source.sendFeedback(() -> Text.literal("Nothing is following anyone here."), false);
            return 0;
        }

        for (FollowerEntity follower : found) {
            boolean watched = Observation.canSee(player, follower);
            int gap = (int) Math.round(player.distanceTo(follower));

            source.sendFeedback(() -> Text.literal(
                    gap + " blocks away, " + follower.stance().name().toLowerCase()
                            + (watched ? ", and you are looking at it (" + (follower.stareTicks() / 20)
                                    + "s of " + VigilConfig.get().staredownSeconds + ")"
                                    : ", and nobody is looking at it")), false);
        }
        return found.size();
    }

    private static int banish(ServerCommandSource source) {
        ServerPlayerEntity player = source.getPlayer();
        if (player == null || !(player.getEntityWorld() instanceof ServerWorld world)) return 0;

        List<FollowerEntity> found = world.getEntitiesByClass(
                FollowerEntity.class, new Box(player.getBlockPos()).expand(256.0), any -> true);

        for (FollowerEntity follower : found) follower.discard();

        source.sendFeedback(() -> Text.literal("Sent away: " + found.size() + "."), false);
        return found.size();
    }
}
