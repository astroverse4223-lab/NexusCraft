package dev.nexuscraft.ember;

import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.registry.RegistryKeys;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.util.math.BlockPos;
import net.minecraft.world.LightType;

/**
 * What Ember can actually see, written for a model to read.
 *
 * The first version knew nothing at all, and it showed: asked how long it had
 * been alive it said "since the darkness fell", which is the sort of line
 * something produces when it has no facts and has to reach for atmosphere.
 * Given the hour, the biome, the light it is standing in and what it has been
 * doing, it can say something true instead — and true is what makes a companion
 * feel present rather than scripted.
 */
public final class Surroundings {

    private Surroundings() {
    }

    public static String describe(ServerWorld world, PlayerEntity player, EmberEntity ember) {
        StringBuilder out = new StringBuilder();

        long time = world.getTimeOfDay() % 24000L;
        out.append("It is ").append(partOfDay(time))
           .append(" (day ").append(world.getTimeOfDay() / 24000L).append("). ");

        if (world.isRaining()) out.append(world.isThundering() ? "A storm is overhead. " : "It is raining. ");

        BlockPos at = player.getBlockPos();
        out.append("You are in ")
           .append(world.getBiome(at).getKey().map(k -> k.getValue().getPath().replace('_', ' '))
                   .orElse("somewhere unfamiliar"))
           .append(" at height ").append(at.getY()).append(". ");

        int block = world.getLightLevel(LightType.BLOCK, at);
        int sky = world.getLightLevel(LightType.SKY, at);
        if (block <= 0 && sky <= 7) {
            out.append("It is dark enough here for things to spawn. ");
        } else if (block > 0) {
            out.append("There is torchlight here. ");
        }

        if (world.getRegistryKey() != null) {
            String dimension = world.getRegistryKey().getValue().getPath();
            if (!dimension.equals("overworld")) out.append("You are in the ").append(dimension).append(". ");
        }

        out.append("The player has ").append(Math.round(player.getHealth()))
           .append(" of ").append(Math.round(player.getMaxHealth())).append(" hearts");
        if (player.getHungerManager().getFoodLevel() <= 6) out.append(" and is hungry");
        out.append(". ");

        if (ember != null) {
            out.append("Your shutters are ").append(switch (ember.getMood()) {
                case CONTENT -> "half open and your flame is steady";
                case ALERT -> "thrown wide — something hostile is close";
                case WORRIED -> "drawn in, your flame gone blue, because the player is hurt";
                case SULKING -> "shut, because the player hit you";
            }).append(". ");

            out.append(ember.lightbringer().isEnabled()
                    ? "You are lighting the dark as you go."
                    : "You have been told to stop placing torches.");
        }

        return out.toString().trim();
    }

    private static String partOfDay(long time) {
        if (time < 1000) return "just after dawn";
        if (time < 5000) return "morning";
        if (time < 7000) return "the middle of the day";
        if (time < 11000) return "afternoon";
        if (time < 13000) return "dusk";
        if (time < 16000) return "early night";
        if (time < 22000) return "the dead of night";
        return "the hour before dawn";
    }
}
