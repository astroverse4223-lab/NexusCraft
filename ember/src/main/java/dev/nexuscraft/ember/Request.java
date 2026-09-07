package dev.nexuscraft.ember;

import net.minecraft.item.Item;
import net.minecraft.item.Items;
import net.minecraft.registry.Registries;
import net.minecraft.util.Identifier;

import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Reads "give me 30 gold" without asking a model to.
 *
 * The model has to write a line and keep a structured list in step with it, and
 * at any temperature warm enough to have a personality it stops managing both:
 * asked for thirty gold it said it had none and quietly attached two ingots.
 *
 * The request itself is not ambiguous, though. A number and a noun is something
 * ordinary code can read perfectly every time, so it does — and the model is
 * left to do the part it is actually good at, which is talking. When this finds
 * a request it replaces the model's list entirely; when it finds nothing it
 * steps aside and the model's own list is used.
 */
public final class Request {

    public record Wanted(String item, int count) {}

    private Request() {
    }

    /** Words people use for things, mapped to what they actually mean. */
    private static final Map<String, String> ALIASES = new LinkedHashMap<>();

    static {
        ALIASES.put("gold", "gold_ingot");
        ALIASES.put("iron", "iron_ingot");
        ALIASES.put("copper", "copper_ingot");
        ALIASES.put("netherite", "netherite_ingot");
        ALIASES.put("diamonds", "diamond");
        ALIASES.put("emeralds", "emerald");
        ALIASES.put("logs", "oak_log");
        ALIASES.put("log", "oak_log");
        ALIASES.put("wood", "oak_log");
        ALIASES.put("planks", "oak_planks");
        ALIASES.put("stone", "cobblestone");
        ALIASES.put("torches", "torch");
        ALIASES.put("food", "cooked_beef");
        ALIASES.put("steak", "cooked_beef");
        ALIASES.put("arrows", "arrow");
        ALIASES.put("string", "string");
        ALIASES.put("coal", "coal");
    }

    /**
     * Items that exist but should never be handed over for saying their name.
     *
     * Mostly the creative and technical blocks — asking Ember to "light up the
     * way" produced an invisible Light block, because minecraft:light is a real
     * item and "light" is a real word. None of these belong in a survival
     * inventory by accident.
     */
    private static final java.util.Set<String> NEVER = java.util.Set.of(
            "light", "barrier", "structure_block", "structure_void", "jigsaw",
            "command_block", "chain_command_block", "repeating_command_block",
            "debug_stick", "bedrock", "end_portal_frame", "spawner", "air");

    /** Numbers people write as words, up to the ones worth typing out. */
    private static final Map<String, Integer> NUMBER_WORDS = new LinkedHashMap<>();

    static {
        String[] names = {"one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
                "ten", "eleven", "twelve"};
        for (int i = 0; i < names.length; i++) NUMBER_WORDS.put(names[i], i + 1);
        NUMBER_WORDS.put("a", 1);
        NUMBER_WORDS.put("an", 1);
        NUMBER_WORDS.put("twenty", 20);
        NUMBER_WORDS.put("thirty", 30);
        NUMBER_WORDS.put("sixty four", 64);
        NUMBER_WORDS.put("a stack", 64);
        NUMBER_WORDS.put("stack", 64);
    }

    private static final Pattern ASKING = Pattern.compile(
            "\\b(give|bring|hand|fetch|get|pass|need|want)\\b", Pattern.CASE_INSENSITIVE);

    private static final Pattern QUANTIFIED = Pattern.compile(
            "(\\d{1,4})\\s+(?:me\\s+)?([a-z_ ]{2,40})", Pattern.CASE_INSENSITIVE);

    /**
     * What the player asked for, or null when they were not asking for a thing.
     *
     * Deliberately conservative: without a verb of asking and something that
     * resolves to a real item, it returns null and leaves the decision to the
     * model rather than guessing.
     */
    public static Wanted parse(String message) {
        if (message == null || message.isBlank()) return null;

        String text = message.toLowerCase(Locale.ROOT).trim();
        if (!ASKING.matcher(text).find()) return null;

        Matcher quantified = QUANTIFIED.matcher(text);
        if (quantified.find()) {
            int count = clamp(Integer.parseInt(quantified.group(1)));
            String item = resolve(quantified.group(2));
            if (item != null) return new Wanted(item, count);
        }

        /*
         * No digits: try a written number, then a bare noun meaning one of it.
         *
         * Longest phrase first, or "a stack of cobblestone" matches the "a" and
         * hands over a single block.
         */
        for (Map.Entry<String, Integer> word : NUMBER_WORDS.entrySet().stream()
                .sorted((left, right) -> right.getKey().length() - left.getKey().length())
                .toList()) {
            int at = text.indexOf(word.getKey() + " ");
            if (at < 0) continue;
            String item = resolve(text.substring(at + word.getKey().length()));
            if (item != null) return new Wanted(item, clamp(word.getValue()));
        }

        /*
         * A bare noun, but only just after the verb.
         *
         * This used to search the whole sentence, so any item name anywhere in
         * it counted — "i need you to light up the way" found "light" eight
         * words later and handed one over. What someone is asking for follows
         * the asking, so only that window is read.
         */
        String after = afterTheVerb(text);
        String item = after == null ? null : resolve(after);
        return item == null ? null : new Wanted(item, 1);
    }

    /** Filler between the verb and the thing, skipped rather than parsed. */
    private static final java.util.Set<String> FILLER = java.util.Set.of(
            "me", "us", "some", "a", "an", "the", "please", "you", "to", "for",
            "can", "could", "would", "will", "my", "our", "your", "of");

    /**
     * The few words after the verb of asking, which is where the thing lives.
     *
     * Stops at the first word that is being used as a verb rather than a noun:
     * "light up", "light the" and "light it" are all someone describing an
     * action, and none of them is a request for a block.
     */
    private static String afterTheVerb(String text) {
        Matcher verb = ASKING.matcher(text);
        if (!verb.find()) return null;

        String[] words = text.substring(verb.end()).trim().split("\\s+");
        StringBuilder window = new StringBuilder();
        int taken = 0;

        for (int i = 0; i < words.length && taken < 4; i++) {
            String word = words[i].replaceAll("[^a-z_]", "");
            if (word.isEmpty()) continue;

            if (FILLER.contains(word)) continue;

            // Used as a verb, not named as a thing.
            if (i + 1 < words.length) {
                String next = words[i + 1].replaceAll("[^a-z_]", "");
                if (next.equals("up") || next.equals("it") || next.equals("the")
                        || next.equals("this") || next.equals("that") || next.equals("us")) {
                    continue;
                }
            }

            if (window.length() > 0) window.append(' ');
            window.append(word);
            taken++;
        }

        return window.length() == 0 ? null : window.toString();
    }

    private static int clamp(int count) {
        return Math.max(1, Math.min(count, 640));
    }

    /**
     * Whether the player's own words name this item at all.
     *
     * The reader above is exact but narrow, and when it finds nothing the
     * model's list is used instead — which is where "i need mending" became one
     * iron ingot. Nothing in that sentence is an item, so the model reached for
     * something adjacent and handed it over.
     *
     * This is the check that stops it: whatever the model wants to give, some
     * word of it has to appear in what the player actually said. "a couple of
     * torches" still reaches torch and "got any food" still reaches cooked beef
     * through the alias table, because the player said those words. Nobody said
     * iron.
     */
    public static boolean namedIn(String item, String message) {
        if (item == null || item.isBlank() || message == null) return false;

        String text = message.toLowerCase(Locale.ROOT).replaceAll("[^a-z ]", " ");
        String id = item.toLowerCase(Locale.ROOT).replace("minecraft:", "");

        // "iron_ingot" is named by "iron" or by "ingot"; either will do.
        for (String part : id.split("_")) {
            if (part.length() >= 3 && text.contains(part)) return true;
        }

        // And by the everyday word for it: "food" is cooked beef, "gold" is an ingot.
        for (Map.Entry<String, String> alias : ALIASES.entrySet()) {
            if (alias.getValue().equals(id) && text.contains(alias.getKey())) return true;
        }

        return false;
    }

    /**
     * The first real item named in a phrase.
     *
     * Tries the alias table, then the phrase itself, then the obvious suffixes,
     * so "gold" reaches gold_ingot and "oak log" reaches oak_log without either
     * being listed by hand.
     */
    static String resolve(String phrase) {
        String cleaned = phrase.toLowerCase(Locale.ROOT)
                .replace("minecraft:", " ")
                .replaceAll("[^a-z_ ]", " ")
                .trim();
        if (cleaned.isEmpty()) return null;

        String[] words = cleaned.split("\\s+");

        // Longest run of words first, so "oak log" beats "log".
        for (int length = Math.min(3, words.length); length >= 1; length--) {
            for (int start = 0; start + length <= words.length; start++) {
                StringBuilder phraseBuilder = new StringBuilder();
                for (int i = start; i < start + length; i++) {
                    if (i > start) phraseBuilder.append('_');
                    phraseBuilder.append(words[i]);
                }
                String candidate = phraseBuilder.toString();

                String alias = ALIASES.get(candidate);
                if (alias != null && exists(alias)) return alias;

                String singular = candidate.endsWith("s") && candidate.length() > 3
                        ? candidate.substring(0, candidate.length() - 1)
                        : candidate;

                for (String attempt : new String[]{candidate, singular,
                        singular + "_ingot", singular + "_block", "oak_" + singular}) {
                    if (exists(attempt)) return attempt;
                }

                String aliasSingular = ALIASES.get(singular);
                if (aliasSingular != null && exists(aliasSingular)) return aliasSingular;
            }
        }
        return null;
    }

    /**
     * Whether an item id names a real item.
     *
     * Held as a field rather than called directly so the parser can be checked
     * without a running game: the item registry is only populated once
     * Minecraft has booted, and the interesting logic here — aliases, plurals,
     * longest-phrase-first — has nothing to do with the registry.
     */
    static java.util.function.Predicate<String> exists = Request::registryHas;

    private static boolean exists(String id) {
        return !NEVER.contains(id) && exists.test(id);
    }

    private static boolean registryHas(String id) {
        Identifier identifier = Identifier.tryParse("minecraft:" + id);
        if (identifier == null) return false;
        Item item = Registries.ITEM.get(identifier);
        return item != null && item != Items.AIR;
    }
}
