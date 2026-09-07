package dev.nexuscraft.ember;

/**
 * What the request reader makes of ordinary sentences.
 *
 * The model kept mismatching its words and its list once it was warm enough to
 * have a personality, so the quantity and the item are read from the player's
 * own words instead. These are the sentences that have actually been typed at
 * it, plus the ones that must NOT be read as requests.
 */
public final class RequestTest {

    private static int failures;

    /**
     * The items these sentences could name.
     *
     * A fake vocabulary rather than the real registry, which only exists inside
     * a running game. It holds every id the cases below should resolve to, and
     * nothing else, so a wrong answer fails rather than quietly passing.
     */
    private static final java.util.Set<String> WORLD = java.util.Set.of(
            "gold_ingot", "iron_ingot", "copper_ingot", "netherite_ingot",
            "diamond", "emerald", "oak_log", "oak_planks", "cobblestone",
            "torch", "cooked_beef", "arrow", "string", "coal", "stone", "beef",
            "light", "barrier", "water", "lava");

    public static void main(String[] args) {
        Request.exists = WORLD::contains;

        want("give me 30 gold", "gold_ingot", 30);
        want("give me 30 iron", "iron_ingot", 30);
        want("give me 30 oak logs", "oak_log", 30);
        want("give me 30 diamonds", "diamond", 30);
        want("can you bring me 12 torches", "torch", 12);
        want("i need 5 cooked beef", "cooked_beef", 5);
        want("get me a stack of cobblestone", "cobblestone", 64);
        want("hand me some coal", "coal", 1);
        want("give me copper", "copper_ingot", 1);

        // The sentence that handed over an invisible creative Light block.
        none("yes i need you to light up the way");
        none("can you light up my way");
        none("light it up");
        none("i need you to light the tunnel");

        none("thank you");
        none("thanks!");
        none("so how long have you been alive");
        none("what is it like being a lantern");
        none("im scared");
        none("nice work");

        // "Let's get you fixed up." — and one iron ingot, which nobody mentioned.
        none("i need mending");
        none("can you fix my pickaxe");

        /*
         * ------------------------------------ what the model may fall back to
         *
         * When the reader above finds nothing the model's own list is used, and
         * that is how "i need mending" became an iron ingot. Whatever it offers
         * has to be a word the player used.
         */
        named("torch", "can I have a couple of torches");
        named("cooked_beef", "got any food");
        named("gold_ingot", "any gold to spare");
        named("oak_log", "i could use some wood");
        named("water_bucket", "bring me a bucket of water");

        unnamed("iron_ingot", "i need mending");
        unnamed("diamond", "what is it like being a lantern");
        unnamed("cooked_beef", "im scared");

        // Deliberate: they said "pickaxe", so offering one is an answer to the
        // question they asked, even if it is not the repair they wanted.
        named("iron_pickaxe", "can you fix my pickaxe");

        System.out.println(failures == 0 ? "\nall checks passed" : "\n" + failures + " FAILED");
        if (failures > 0) System.exit(1);
    }

    private static void want(String said, String item, int count) {
        Request.Wanted got = Request.parse(said);
        boolean ok = got != null && got.item().equals(item) && got.count() == count;
        if (!ok) failures++;
        System.out.printf("%-5s %-36s %s%n", ok ? "ok" : "FAIL", said,
                got == null ? "read nothing" : got.count() + " x " + got.item());
    }

    private static void named(String item, String said) {
        boolean ok = Request.namedIn(item, said);
        if (!ok) failures++;
        System.out.printf("%-5s %-36s %s%n", ok ? "ok" : "FAIL", said,
                (ok ? "names " : "MISSED ") + item);
    }

    private static void unnamed(String item, String said) {
        boolean ok = !Request.namedIn(item, said);
        if (!ok) failures++;
        System.out.printf("%-5s %-36s %s%n", ok ? "ok" : "FAIL", said,
                ok ? "does not name " + item : "WRONGLY names " + item);
    }

    private static void none(String said) {
        Request.Wanted got = Request.parse(said);
        boolean ok = got == null;
        if (!ok) failures++;
        System.out.printf("%-5s %-36s %s%n", ok ? "ok" : "FAIL", said,
                got == null ? "not a request" : "WRONGLY read " + got.count() + " x " + got.item());
    }
}
