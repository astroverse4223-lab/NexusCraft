package dev.nexuscraft.ember;

import java.lang.reflect.Method;

/**
 * The two faults from one line of chat, checked without launching Minecraft.
 *
 *   <Ember> I misunderstood. Here, take these.
 *           {"give":[{"item":"iron_ingot","count":30}],"light":null}
 *   Ember hands you 30 iron ingot.
 *
 * Run with:  java -cp build/classes/java/main VoiceSanityTest
 *
 * Reflection rather than a test framework because the mod ships no test
 * dependencies, and these two are pure string functions — the whole point is
 * that they can be checked with nothing but a JVM.
 */
public final class VoiceSanityTest {

    private static int failures;

    public static void main(String[] args) throws Exception {
        Method clean = Voice.class.getDeclaredMethod("cleanLine", String.class);
        Method courtesy = Voice.class.getDeclaredMethod("isCourtesy", String.class);
        clean.setAccessible(true);
        courtesy.setAccessible(true);

        /* ------------------------------------------- nothing braced is spoken */

        // The exact reply that leaked into chat.
        is(clean.invoke(null, "I misunderstood. Here, take these. "
                        + "{\"give\":[{\"item\":\"iron_ingot\",\"count\":30}],\"light\":null}"),
                "I misunderstood. Here, take these.", "prose before an object");

        // The second one that leaked, from the 17:09 session running the old jar.
        is(clean.invoke(null, "Long enough to know when to light the way. {\"light\":true}"),
                "Long enough to know when to light the way.", "prose before a light flag");

        is(clean.invoke(null, "Here you go."), "Here you go.", "a plain line survives");

        is(clean.invoke(null, "```json\n{\"say\":\"hi\"}\n```"), null, "a fenced object says nothing");

        is(clean.invoke(null, "{\"say\":\"Here you go.\",\"give\":[]}"), null,
                "a bare object says nothing");

        is(clean.invoke(null, "  Take   these,\n friend. "), "Take these, friend.",
                "whitespace is tidied");

        /* -------------------------------------- courtesy hands over nothing */

        yes(courtesy.invoke(null, "thank you"), "thank you");
        yes(courtesy.invoke(null, "Thanks!"), "thanks");
        yes(courtesy.invoke(null, "ty"), "ty");
        yes(courtesy.invoke(null, "nice one"), "nice one");
        yes(courtesy.invoke(null, "lol ok"), "lol ok");

        /* -------------------------------- but a real request still counts */

        no(courtesy.invoke(null, "give me 30 iron"), "give me 30 iron");
        no(courtesy.invoke(null, "thanks, can I have some more?"), "thanks + more");
        no(courtesy.invoke(null, "nice, now bring me oak logs"), "nice + bring");
        no(courtesy.invoke(null, "i need 5 torches"), "a numbered request");
        no(courtesy.invoke(null, "what are you doing"), "an ordinary question");

        System.out.println(failures == 0 ? "\nall checks passed" : "\n" + failures + " FAILED");
        if (failures > 0) System.exit(1);
    }

    private static void is(Object actual, String expected, String what) {
        boolean ok = expected == null ? actual == null : expected.equals(actual);
        report(ok, what, String.valueOf(actual));
    }

    private static void yes(Object actual, String what) {
        report(Boolean.TRUE.equals(actual), "courtesy: " + what, String.valueOf(actual));
    }

    private static void no(Object actual, String what) {
        report(Boolean.FALSE.equals(actual), "request: " + what, String.valueOf(actual));
    }

    private static void report(boolean ok, String what, String actual) {
        if (!ok) failures++;
        System.out.printf("%-5s %-34s %s%n", ok ? "ok" : "FAIL", what, ok ? "" : "got " + actual);
    }
}
