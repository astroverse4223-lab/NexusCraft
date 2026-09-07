package dev.nexuscraft.ember;

/**
 * Who decides that a walk is happening.
 *
 * From a real session:
 *
 *   <player> i need mending
 *   <Ember>  Let's get you fixed up. Follow me.
 *            Ember hands you 1 iron ingot.
 *   <Ember>  We're here. The cavern system awaits exploration.
 *
 * Nobody asked to go to a cave. The model had drifted from repairing a tool to
 * finding ore, filled in "cave", and the walk happened because it said so. So
 * the asking is read from the player's own words now, the same way the item
 * requests are, and these are the sentences that must and must not start one.
 *
 * Run with:  java -cp build/classes/java/main;build/testclasses \
 *                 dev.nexuscraft.ember.LeadingTest
 */
public final class LeadingTest {

    private static int failures;

    public static void main(String[] args) {

        /* ------------------------------------------------ they want to go */

        yes("show me somewhere nice");
        yes("take me to some water");
        yes("where should i build my base");
        yes("is there a cave nearby");
        yes("do you know anywhere with trees");
        yes("find me a good spot");
        yes("lets go explore");
        yes("anywhere safe around here");

        /* -------------------------------------------- they want no such thing */

        no("i need mending");
        no("can you fix my pickaxe");
        no("give me 30 iron");
        no("thank you");
        no("what is it like being a lantern");
        no("im scared");
        no("light up the tunnel");
        no("come back");

        System.out.println(failures == 0 ? "\nall checks passed" : "\n" + failures + " FAILED");
        if (failures > 0) System.exit(1);
    }

    private static void yes(String said) {
        report(Landmarks.wasAsked(said), said, "asks to be taken somewhere");
    }

    private static void no(String said) {
        report(!Landmarks.wasAsked(said), said, "is not a request to go anywhere");
    }

    private static void report(boolean ok, String said, String what) {
        if (!ok) failures++;
        System.out.printf("%-5s %-36s %s%n", ok ? "ok" : "FAIL", said, what);
    }
}
