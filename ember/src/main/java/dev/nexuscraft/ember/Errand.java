package dev.nexuscraft.ember;

import java.util.Locale;

/**
 * Things you ask Ember to do that are not conversation.
 *
 * Read from your own words rather than decided by the model, for the same
 * reason the item requests are: "take me home" has exactly one meaning, and a
 * model asked to judge it will sometimes decide to talk about home instead of
 * going there. The model still writes what Ember says; this only decides what
 * it does.
 */
public enum Errand {

    /** Lead the way back to where they last slept. */
    GO_HOME,

    /** Lead the way to where they last died. */
    GO_TO_DEATH,

    /** Remember this spot as home, overriding the bed. */
    SET_HOME,

    /** Stop leading and go back to following. */
    STOP,

    /** Come back from wherever it was thrown, now. */
    COME_BACK;

    /** What was asked, or null when it was not one of these. */
    public static Errand parse(String message) {
        if (message == null || message.isBlank()) return null;

        String text = message.toLowerCase(Locale.ROOT).replaceAll("[^a-z ]", " ").trim();
        text = text.replaceAll("\\s+", " ");
        if (text.isEmpty()) return null;

        /*
         * Calling it back, which is what someone says to a thing they threw.
         *
         * Checked before everything else because it is the most urgent, and
         * because it was missing entirely — thrown into a cave and told to come
         * back, Ember simply carried on talking.
         */
        if (contains(text, "come back", "come here", "get back here", "return",
                "come to me", "back here", "heel")) {
            return COME_BACK;
        }

        // Stop first: "stop taking me home" is a stop, not a request to go.
        if (contains(text, "stop", "wait here", "never mind", "forget it", "stay")) {
            if (contains(text, "lead", "home", "guid", "take me", "going")) return STOP;
        }

        if (contains(text, "this is home", "set home", "make this home", "remember this place",
                "this is my base", "home is here")) {
            return SET_HOME;
        }

        /*
         * Bare "back" and "back to" used to count, which made "i want to go back
         * to mining" an order to walk home. The phrase has to name the place,
         * not merely point backwards.
         */
        boolean leadMe = contains(text, "take me", "lead me", "guide me", "show me the way",
                "walk me", "get me", "bring me", "where is", "which way",
                "back to base", "back to my base", "back home");

        if (contains(text, "where did i die", "my stuff", "my things", "my grave",
                "where i died", "my death", "my body")) {
            return GO_TO_DEATH;
        }

        if (leadMe && contains(text, "die", "died", "death", "grave")) return GO_TO_DEATH;
        if (leadMe && contains(text, "home", "base")) return GO_HOME;

        return null;
    }

    private static boolean contains(String text, String... phrases) {
        for (String phrase : phrases) {
            if (text.contains(phrase)) return true;
        }
        return false;
    }
}
