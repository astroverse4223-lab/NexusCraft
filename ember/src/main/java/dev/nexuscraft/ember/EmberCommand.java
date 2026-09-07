package dev.nexuscraft.ember;

import com.mojang.brigadier.CommandDispatcher;
import net.fabricmc.fabric.api.command.v2.CommandRegistrationCallback;
import net.minecraft.item.ItemStack;
import net.minecraft.server.command.ServerCommandSource;
import net.minecraft.server.network.ServerPlayerEntity;
import net.minecraft.text.Text;

import net.minecraft.server.command.CommandManager;

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
                }));
    }
}
