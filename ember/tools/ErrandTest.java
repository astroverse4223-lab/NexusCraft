package dev.nexuscraft.ember;

/**
 * What Ember makes of the things people say when they want leading somewhere.
 *
 * Read from the player's words rather than judged by the model, so it has to be
 * right about both halves: the sentences that are errands, and the ones that
 * merely mention home and are just talk.
 */
public final class ErrandTest {

    private static int failures;

    public static void main(String[] args) {
        is("take me home", Errand.GO_HOME);
        is("lead me home please", Errand.GO_HOME);
        is("can you take me back to base", Errand.GO_HOME);
        is("which way is home", Errand.GO_HOME);

        is("where did i die", Errand.GO_TO_DEATH);
        is("take me to my stuff", Errand.GO_TO_DEATH);
        is("lead me to where i died", Errand.GO_TO_DEATH);
        is("where is my grave", Errand.GO_TO_DEATH);

        is("this is home", Errand.SET_HOME);
        is("remember this place", Errand.SET_HOME);
        is("set home here", Errand.SET_HOME);

        // Calling it back from a throw, which was missing entirely.
        is("come back", Errand.COME_BACK);
        is("ember come here", Errand.COME_BACK);
        is("get back here", Errand.COME_BACK);

        is("stop leading me", Errand.STOP);
        is("never mind, stop going home", Errand.STOP);

        // Talk about home is not an instruction to go there.
        is("i built my home out of stone", null);
        is("do you like it here", null);
        // Talk about going back somewhere is not an order to go anywhere.
        is("i want to go back to mining", null);
        is("lets head back down", null);
        is("give me 30 gold", null);
        is("thank you", null);
        is("im scared", null);
        is("whats it like being a lantern", null);

        System.out.println(failures == 0 ? "\nall checks passed" : "\n" + failures + " FAILED");
        if (failures > 0) System.exit(1);
    }

    private static void is(String said, Errand expected) {
        Errand got = Errand.parse(said);
        boolean ok = got == expected;
        if (!ok) failures++;
        System.out.printf("%-5s %-38s %s%n", ok ? "ok" : "FAIL", said,
                got == null ? "not an errand" : got.name());
    }
}
