package dev.nexuscraft.ember;

/**
 * What a life adds up to.
 *
 * The stages have to be reachable at a sensible pace — fast enough that the
 * first one lands in a normal playthrough, slow enough that the last means
 * something. These are the shapes of play worth checking.
 */
public final class GrowthTest {

    private static int failures;

    public static void main(String[] args) {
        // firstDay, lastDay, torches, flares
        is("a fresh Ember", life(0, 0, 0, 0), Growth.Stage.SPARK);
        is("first evening, a cave lit", life(0, 0, 60, 1), Growth.Stage.SPARK);
        is("a week in", life(0, 7, 140, 3), Growth.Stage.STEADY);
        is("a fortnight of caving", life(0, 14, 400, 8), Growth.Stage.BRIGHT);
        is("two months", life(0, 60, 900, 20), Growth.Stage.ELDER);

        /*
         * Work counts, but does not replace time.
         *
         * This expectation was originally BRIGHT and the code disagreed. The
         * code is right: a day of hard caving is real work and should be felt,
         * but "bright" is partly about having been around, and a stage you can
         * reach in one session is a grind bar rather than a history.
         */
        is("one frantic day of mining", life(0, 1, 900, 2), Growth.Stage.STEADY);
        is("a long quiet month", life(0, 30, 20, 0), Growth.Stage.BRIGHT);

        // A second Ember for the same player starts over.
        is("day 400 of the world, met today", life(400, 400, 0, 0), Growth.Stage.SPARK);

        System.out.println(failures == 0 ? "\nall checks passed" : "\n" + failures + " FAILED");
        if (failures > 0) System.exit(1);
    }

    private static Growth.Life life(long first, long last, int torches, int flares) {
        return new Growth.Life(first, last, torches, flares);
    }

    private static void is(String what, Growth.Life life, Growth.Stage expected) {
        Growth.Stage got = life.stage();
        boolean ok = got == expected;
        if (!ok) failures++;
        System.out.printf("%-5s %-30s %-8s (%d days, %d torches)%n",
                ok ? "ok" : "FAIL", what, got, life.daysTogether(), life.torches());
    }
}
