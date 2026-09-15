package dev.nexuscraft.vigil;

/**
 * The view cone and the poses, checked with nothing but a JVM.
 *
 * Everything in the mod is a consequence of {@code inView}. If it is wrong in
 * the generous direction the thing never moves and there is no mod; if it is
 * wrong in the stingy direction it crosses the room while you are staring
 * straight at it, which is not frightening, it is broken.
 *
 * The yaw convention is the part actually worth testing. Minecraft measures 0
 * as south (+Z) and increases toward west (-X), which is neither of the two
 * conventions you would guess, and a sign error would be invisible in play —
 * it would simply look like the mod was inconsistent about when it moved.
 *
 * Run:  bash tools/run-tests.sh
 */
public final class LookingTest {

    private static int failures;

    public static void main(String[] args) {

        /* ------------------------------------------ facing south, yaw zero */

        seen(0.0f, 0.0f, 0, 0, 10, "straight ahead");
        seen(0.0f, 0.0f, 5, 0, 10, "well inside one edge");
        seen(0.0f, 0.0f, -5, 0, 10, "well inside the other");
        seen(0.0f, 0.0f, 0, 4, 10, "a little above");

        hidden(0.0f, 0.0f, 0, 0, -10, "directly behind");
        hidden(0.0f, 0.0f, 10, 0, 0, "square to one side");
        hidden(0.0f, 0.0f, -10, 0, 0, "square to the other");
        hidden(0.0f, 0.0f, 0, 20, 5, "steeply overhead");
        hidden(0.0f, 0.0f, 0, -20, 5, "steeply underfoot");

        /* ------------------------------- the convention: 90 is west, not east */

        seen(90.0f, 0.0f, -10, 0, 0, "west, while facing west");
        hidden(90.0f, 0.0f, 10, 0, 0, "east, while facing west");
        seen(180.0f, 0.0f, 0, 0, -10, "north, while facing north");
        seen(270.0f, 0.0f, 10, 0, 0, "east, while facing east");

        // And the wrap: 350 degrees and -10 are the same heading.
        seen(350.0f, 0.0f, 0, 0, 10, "south, from a yaw the long way round");
        seen(-370.0f, 0.0f, 0, 0, 10, "south, from a yaw wound past a full turn");

        /* --------------------------------------- looking up and looking down */

        // Pitch is negative looking up, which is the other convention that bites.
        seen(0.0f, -45.0f, 0, 10, 10, "above, while looking up at it");
        hidden(0.0f, -45.0f, 0, -10, 10, "below, while looking up");
        seen(0.0f, 60.0f, 0, -10, 5, "below, while looking down at it");

        /* ---------------------------------------------- the edges of the cone */

        seen(0.0f, 0.0f, 15, 0, 10, "just inside the horizontal limit");
        hidden(0.0f, 0.0f, 30, 0, 10, "just outside the horizontal limit");

        /* --------------------------------------------------------- the poses */

        boolean farIsCalm = true;
        for (int roll = 0; roll < 12; roll++) {
            Pose far = Pose.pick(40.0, roll);
            farIsCalm &= far == Pose.WAITING || far == Pose.TILTED;
        }
        report(farIsCalm, "nothing but standing and tilting at forty blocks");

        boolean nearIsNot = true;
        boolean looms = false;
        for (int roll = 0; roll < 12; roll++) {
            Pose near = Pose.pick(2.0, roll);
            nearIsNot &= near != Pose.WAITING && near != Pose.TILTED;
            looms |= near == Pose.LOOMING;
        }
        report(nearIsNot, "never merely standing once it is on top of you");
        report(looms, "it looms at two blocks");

        // A roll from anywhere must still land on a real pose.
        report(Pose.pick(2.0, -7) != null && Pose.pick(40.0, 9999) != null,
                "any roll at all gives a pose");

        System.out.println(failures == 0 ? "\nall checks passed" : "\n" + failures + " FAILED");
        if (failures > 0) System.exit(1);
    }

    private static void seen(float yaw, float pitch, double x, double y, double z, String what) {
        check(true, yaw, pitch, x, y, z, what);
    }

    private static void hidden(float yaw, float pitch, double x, double y, double z, String what) {
        check(false, yaw, pitch, x, y, z, what);
    }

    private static void check(boolean expected, float yaw, float pitch,
                              double x, double y, double z, String what) {
        boolean got = Observation.inView(0.0, 0.0, 0.0, yaw, pitch, x, y, z);
        report(got == expected, what);
    }

    private static void report(boolean ok, String what) {
        if (!ok) failures++;
        System.out.printf("%-5s %s%n", ok ? "ok" : "FAIL", what);
    }
}
