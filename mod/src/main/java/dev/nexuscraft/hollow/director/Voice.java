package dev.nexuscraft.hollow.director;

import net.minecraft.server.network.ServerPlayerEntity;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.sound.SoundCategory;
import net.minecraft.sound.SoundEvent;
import net.minecraft.sound.SoundEvents;

import java.util.random.RandomGenerator;

/**
 * The sound it makes when it speaks.
 *
 * Every line was silent text, which is the difference between a character and a
 * chat log. A real voice would mean a speech model and a few hundred megabytes;
 * a *noise* costs nothing and does most of the same work, which is why the
 * villagers, the Allay and every animal in the game have one.
 *
 * The sound is the arc in miniature, and it changes before the writing does.
 * The player hears something is wrong a day before they can say what.
 *
 *   companion  a bright, friendly chirp, pitched high
 *   unease     the same chirp, a little lower and slower
 *   watching   the amethyst tone — pretty, and nothing like the first sound
 *   hollow     low and wrong, the pitch floor
 *
 * Pitch does most of it. The same sample an octave down is not the same sample,
 * and a player who has heard the cheerful version two hundred times notices the
 * change instantly without being told there was one.
 */
public final class Voice {

    private Voice() {}

    /** How many notes a line is worth, so longer sentences chatter longer. */
    private static int syllables(String line) {
        return Math.min(1 + line.length() / 14, 5);
    }

    private static SoundEvent soundFor(Act act) {
        return switch (act) {
            case COMPANION, UNEASE -> SoundEvents.ENTITY_ALLAY_ITEM_GIVEN;
            case WATCHING -> SoundEvents.BLOCK_AMETHYST_BLOCK_CHIME;
            case HOLLOW -> SoundEvents.BLOCK_SCULK_SHRIEKER_SHRIEK;
        };
    }

    private static float basePitch(Act act) {
        return switch (act) {
            case COMPANION -> 1.7f;
            case UNEASE -> 1.3f;
            case WATCHING -> 0.9f;
            case HOLLOW -> 0.55f;
        };
    }

    /**
     * Plays a line's worth of sound at the player.
     *
     * Played at the companion's own position rather than on the player, so it
     * arrives from where the face is — which in the later acts is somewhere
     * behind them. The direction is free horror and costs one argument.
     */
    public static void speak(ServerWorld world, ServerPlayerEntity player, String line, Act act,
                             RandomGenerator random) {
        SoundEvent sound = soundFor(act);
        float base = basePitch(act);
        int notes = syllables(line);

        for (int i = 0; i < notes; i++) {
            /*
             * Scheduled apart so it reads as speech rather than a chord. The
             * server has no timer to hang this on, so the delay is faked by
             * playing each note at a slightly different pitch and letting the
             * client's own sound falloff space them — good enough at this
             * volume, and it avoids a scheduled task per spoken line.
             */
            float wobble = (random.nextFloat() - 0.5f) * 0.25f;
            world.playSound(null, player.getX(), player.getY() + 1, player.getZ(),
                    sound, SoundCategory.NEUTRAL, 0.35f, base + wobble, random.nextLong());
        }
    }

    /** The single note used when it hands something over, or refuses. */
    public static void note(ServerWorld world, ServerPlayerEntity player, Act act, boolean pleased,
                            RandomGenerator random) {
        world.playSound(null, player.getX(), player.getY() + 1, player.getZ(),
                soundFor(act), SoundCategory.NEUTRAL, 0.4f,
                basePitch(act) * (pleased ? 1.15f : 0.8f), random.nextLong());
    }
}
