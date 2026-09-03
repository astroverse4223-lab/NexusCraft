package dev.nexuscraft.hollow.director;

import net.minecraft.item.Item;
import net.minecraft.item.ItemStack;
import net.minecraft.item.Items;
import net.minecraft.registry.Registries;
import net.minecraft.util.Identifier;

import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * What it will hand over, and what it won't.
 *
 * A companion that gives you anything you ask for is a creative-mode menu with
 * a face, and it ruins the game inside an hour. A companion that refuses is a
 * character — the refusal is where the personality lives, and "I'll get you
 * wood, but you can find your own diamonds" tells you more about something than
 * any amount of dialogue.
 *
 * The refusal also has somewhere to go. In the first act it is cheerful and a
 * bit smug. By the last act it is the same refusal with the cheer removed, and
 * the player understands that it always could, and simply chose not to.
 */
public final class Boon {

    private Boon() {}

    /**
     * Things it is happy to conjure, and how many.
     *
     * Mundane things in useful amounts, and metal in small ones. The line is
     * between saving an errand and skipping a chapter: a stack of cobblestone
     * is the first, a stack of iron would be the second, eight ingots is not.
     */
    private static final Map<String, Integer> GIVES = Map.ofEntries(
            Map.entry("oak_log", 32),
            Map.entry("cobblestone", 64),
            Map.entry("dirt", 64),
            Map.entry("sand", 32),
            Map.entry("gravel", 32),
            Map.entry("torch", 32),
            Map.entry("stick", 32),
            Map.entry("bread", 16),
            Map.entry("coal", 16),
            Map.entry("string", 16),
            Map.entry("wheat", 16),
            Map.entry("glass", 32),
            Map.entry("white_wool", 16),
            Map.entry("stone", 64),
            Map.entry("oak_planks", 64),
            /*
             * Metal, in small amounts.
             *
             * Left out at first on the theory that a stack of iron skips a
             * chapter of progression. Eight is not a stack — it is a bucket and
             * a pickaxe, which is a favour rather than a shortcut, and being
             * told "no" to something this ordinary made the companion feel
             * broken rather than principled.
             */
            Map.entry("iron_ingot", 8),
            Map.entry("gold_ingot", 8),
            Map.entry("copper_ingot", 16),
            Map.entry("leather", 8),
            Map.entry("flint", 8),
            Map.entry("feather", 8),
            Map.entry("bone", 16),
            Map.entry("clay_ball", 16),
            Map.entry("iron_nugget", 32)
    );

    /**
     * Things it will not, whatever you say to it.
     *
     * Kept as a list of names rather than a rarity check on purpose: a rule
     * like "nothing above iron" is invisible to the player, while a flat refusal
     * on the same four things every time reads as a decision it is making.
     */
    private static final List<String> REFUSES = List.of(
            "diamond", "diamond_block", "netherite_ingot", "netherite_scrap", "netherite_block",
            "ancient_debris", "emerald", "emerald_block", "elytra", "totem_of_undying",
            "enchanted_golden_apple", "nether_star", "beacon", "dragon_egg"
    );

    /**
     * Words that carry no request, dropped before matching.
     *
     * Without these, "can I have some stone" matches on "some" or "have" long
     * before it reaches "stone", and which item you get depends on the order of
     * a hash map.
     */
    /*
     * Set.of throws on a duplicate entry, and the throw happens when the class
     * first initialises — which is the first time a player asks for anything,
     * mid-tick, taking the server down with it. It compiled and loaded fine.
     * Written out as a stream so a repeated word is dropped rather than fatal.
     */
    private static final java.util.Set<String> FILLER = java.util.Arrays.stream(
            ("can i have some a an the me give get need want please could you "
                    + "gimme for my more of any got would will do").split(" ")
    ).collect(java.util.stream.Collectors.toUnmodifiableSet());

    /**
     * What people ask for, mapped to what the game calls it.
     *
     * This list is the difference between a companion that works and one that
     * says "I can't make that one" to every reasonable request. Nobody types
     * "oak_log" — they type "wood".
     */
    private static final Map<String, String> SYNONYMS = Map.ofEntries(
            Map.entry("wood", "oak_log"),
            Map.entry("logs", "oak_log"),
            Map.entry("log", "oak_log"),
            Map.entry("tree", "oak_log"),
            Map.entry("timber", "oak_log"),
            Map.entry("planks", "oak_planks"),
            Map.entry("plank", "oak_planks"),
            Map.entry("cobble", "cobblestone"),
            Map.entry("rock", "cobblestone"),
            Map.entry("rocks", "cobblestone"),
            Map.entry("stones", "stone"),
            Map.entry("food", "bread"),
            Map.entry("bread", "bread"),
            Map.entry("torches", "torch"),
            Map.entry("light", "torch"),
            Map.entry("lights", "torch"),
            Map.entry("wool", "white_wool"),
            Map.entry("sticks", "stick"),
            Map.entry("dirt", "dirt"),
            Map.entry("sand", "sand"),
            Map.entry("coal", "coal"),
            Map.entry("glass", "glass"),
            Map.entry("string", "string"),
            Map.entry("wheat", "wheat"),
            Map.entry("gravel", "gravel"),
            Map.entry("iron", "iron_ingot"),
            Map.entry("ingots", "iron_ingot"),
            Map.entry("gold", "gold_ingot"),
            Map.entry("copper", "copper_ingot"),
            Map.entry("bones", "bone"),
            Map.entry("feathers", "feather"),
            Map.entry("clay", "clay_ball")
    );

    /**
     * The most it will hand over at once, however much you ask for.
     *
     * Not a judgement about game balance — if someone wants four stacks of iron
     * from a talking ball, that is between them and their world. It is a guard
     * against "give me 99999999 cobblestone", which is not a request so much as
     * a way to find out what happens, and what happens is the server spends the
     * next minute spawning item entities.
     */
    private static final int MAX_GIVE = 256;

    /**
     * How many they asked for, or 0 if they did not say.
     *
     * The default amounts in {@link #GIVES} were being treated as the answer
     * rather than as a fallback, so asking for thirty-two iron got you eight and
     * no explanation — which reads as the companion being broken rather than
     * frugal. A number in the sentence is an explicit request and wins.
     */
    private static int amountFrom(String[] words) {
        for (int i = 0; i < words.length; i++) {
            String word = words[i];

            // "a stack", "2 stacks", "half a stack".
            if (word.equals("stack") || word.equals("stacks")) {
                if (i >= 2 && words[i - 2].equals("half")) return 32;
                if (i >= 1 && words[i - 1].equals("half")) return 32;
                int multiplier = i >= 1 ? digits(words[i - 1]) : 0;
                return Math.min(MAX_GIVE, 64 * Math.max(1, multiplier));
            }

            int number = digits(word);
            if (number > 0) return Math.min(MAX_GIVE, number);
        }
        return 0;
    }

    /** A word that is entirely digits, as a number. 0 for anything else. */
    private static int digits(String word) {
        if (word.isEmpty() || word.length() > 9) return 0;
        for (int i = 0; i < word.length(); i++) {
            if (!Character.isDigit(word.charAt(i))) return 0;
        }
        return Integer.parseInt(word);
    }

    public record Answer(boolean granted, ItemStack stack, String reason) {}

    /** Whether this is something it has decided never to produce. */
    public static boolean refuses(String itemName) {
        String cleaned = normalise(itemName);
        return REFUSES.stream().anyMatch(cleaned::contains);
    }

    /**
     * Resolves a request to an item, or to a refusal.
     *
     * Only ever gives what is on the list above. Looking the request up in the
     * item registry instead would technically work and would also let a
     * well-phrased sentence produce a command block, so the allow-list is the
     * whole mechanism rather than a first pass at one.
     */
    public static Answer request(String rawRequest, Act act) {
        String cleaned = normalise(rawRequest);

        if (refuses(cleaned)) {
            return new Answer(false, ItemStack.EMPTY, refusal(cleaned, act));
        }

        /*
         * Matched word by word against what people actually say.
         *
         * Comparing the whole sentence against item ids does not work, and
         * fails in a way that reads as the companion being useless: "can I have
         * some wood" normalises to `can_i_have_some_wood`, which contains
         * neither `oak_log` nor anything else, so it answers "I can't make that
         * one" to the single most common request there is. Nobody asks for an
         * oak_log.
         */
        String[] words = cleaned.split("_");
        int asked = amountFrom(words);

        Optional<Map.Entry<String, Integer>> match = Optional.empty();
        for (String word : words) {
            if (word.isBlank() || FILLER.contains(word)) continue;

            String wanted = SYNONYMS.getOrDefault(word, word);
            match = GIVES.entrySet().stream()
                    .filter(entry -> entry.getKey().equals(wanted)
                            || entry.getKey().contains(wanted)
                            || wanted.contains(entry.getKey()))
                    .findFirst();
            if (match.isPresent()) break;
        }

        if (match.isEmpty()) {
            return new Answer(false, ItemStack.EMPTY,
                    act.atLeast(Act.WATCHING)
                            ? "I don't have that. I have other things."
                            : "I can't make that one, sorry.");
        }

        Item item = Registries.ITEM.get(Identifier.ofVanilla(match.get().getKey()));
        if (item == Items.AIR) {
            return new Answer(false, ItemStack.EMPTY, "That isn't a thing here.");
        }

        int count = asked > 0 ? asked : match.get().getValue();
        return new Answer(true, new ItemStack(item, count), null);
    }

    /**
     * The same refusal, told four different ways.
     *
     * It never changes its mind across the acts — only its reason for saying no,
     * which drifts from a joke to something that sounds like a threat while the
     * answer stays exactly the same.
     */
    private static String refusal(String what, Act act) {
        return switch (act) {
            case COMPANION -> "Ha! No. Find those yourself — you'll enjoy it more.";
            case UNEASE -> "No. Not those. Ask me for something else.";
            case WATCHING -> "I could. I've thought about it. No.";
            case HOLLOW -> "You'll dig for them. I want to watch you dig.";
        };
    }

    private static String normalise(String raw) {
        if (raw == null) return "";
        return raw.toLowerCase().trim()
                .replace("minecraft:", "")
                .replaceAll("[^a-z0-9_ ]", "")
                .replace(' ', '_');
    }
}
