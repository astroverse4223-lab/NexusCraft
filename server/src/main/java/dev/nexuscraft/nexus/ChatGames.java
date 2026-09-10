package dev.nexuscraft.nexus;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextDecoration;
import org.bukkit.Sound;
import org.bukkit.entity.Player;

import java.util.List;
import java.util.Locale;
import java.util.Random;

/**
 * The server asks something; the first person to answer gets paid.
 *
 * The best thing on this server per line of code, and the reason is player
 * count. Bed Wars needs eight, Spleef needs three, and most evenings there will
 * be one or two people online — for whom the entire minigame half of the server
 * does not exist. A chat game needs one person and a keyboard.
 *
 * It also does something none of the other systems do: it makes the server
 * speak first. Somebody mining alone in prison for an hour gets interrupted by
 * a question, answers it, and has had an interaction. That is worth more than
 * the money.
 *
 * Deliberately not hard. The point is a small pleasant thing every fifteen
 * minutes, not a quiz nobody can win — an unanswerable question is a message
 * that trains people to ignore messages.
 */
public final class ChatGames {

    /** How often a question is asked, in seconds. */
    private static final int EVERY = 14 * 60;

    /** And a spread, so it is not clockwork. */
    private static final int JITTER = 5 * 60;

    /** How long an unanswered one stays open. */
    private static final int OPEN_FOR = 90;

    private static final int PAYS = 1_500;

    /** Things worth knowing about Minecraft, asked plainly. */
    private static final String[][] TRIVIA = {
            {"How many blocks tall is a full stack of scaffolding you can climb?", "7"},
            {"What do you need to make a cake, besides eggs, sugar and wheat?", "milk"},
            {"Which mob drops an ender pearl?", "enderman"},
            {"What block do you need to make a beacon work?", "iron"},
            {"How many diamonds does a full set of armour take?", "24"},
            {"What is the only mob that drops a nether star?", "wither"},
            {"Which tool mines obsidian?", "diamond pickaxe"},
            {"What do you feed a horse to breed it?", "golden carrot"},
            {"How many eyes of ender does a portal frame need at most?", "12"},
            {"What lights a nether portal?", "flint and steel"},
            {"Which fish can be caught with a bucket and put in an aquarium?", "tropical"},
            {"What do villagers throw at each other after a good trade?", "fireworks"},
            {"How many obsidian does a nether portal need at minimum?", "10"},
            {"Which biome do you find ancient debris in?", "nether"},
    };

    /** Words to unscramble. Long enough to be a puzzle, common enough to guess. */
    private static final String[] WORDS = {
            "netherite", "enderman", "redstone", "obsidian", "creeper", "diamond",
            "beacon", "elytra", "shulker", "guardian", "blaze", "piglin",
            "cauldron", "lantern", "conduit", "trident", "villager", "prismarine",
            "glowstone", "amethyst", "deepslate", "campfire", "scaffolding",
    };

    private final Nexus nexus;
    private final Random random = new Random();

    private int countdown = 3 * 60;

    /** The question in play: what the answer is, and how long is left. */
    private String answer;
    private int openFor;

    public ChatGames(Nexus nexus) {
        this.nexus = nexus;
    }

    public void tick() {
        if (answer != null) {
            if (--openFor > 0) return;

            nexus.getServer().broadcast(prefix()
                    .append(Component.text("Nobody got it. It was ", NamedTextColor.GRAY))
                    .append(Component.text(answer, NamedTextColor.WHITE)));
            answer = null;
            return;
        }

        if (--countdown > 0) return;
        countdown = EVERY + random.nextInt(JITTER * 2) - JITTER;

        // No point asking an empty room.
        if (nexus.getServer().getOnlinePlayers().isEmpty()) return;

        ask();
    }

    private void ask() {
        switch (random.nextInt(3)) {
            case 0 -> trivia();
            case 1 -> unscramble();
            default -> maths();
        }
        openFor = OPEN_FOR;
    }

    private void trivia() {
        String[] pick = TRIVIA[random.nextInt(TRIVIA.length)];
        answer = pick[1];
        post("Trivia", pick[0]);
    }

    /**
     * A scrambled word, guaranteed to actually be scrambled.
     *
     * A shuffle that happens to return the original is rare and looks exactly
     * like a bug, so it is retried — this is cheap and the alternative is
     * somebody screenshotting "unscramble: DIAMOND".
     */
    private void unscramble() {
        String word = WORDS[random.nextInt(WORDS.length)];
        answer = word;

        String jumbled = word;
        for (int tries = 0; tries < 8 && jumbled.equals(word); tries++) {
            List<Character> letters = new java.util.ArrayList<>();
            for (char c : word.toCharArray()) letters.add(c);
            java.util.Collections.shuffle(letters, random);

            StringBuilder built = new StringBuilder();
            for (char c : letters) built.append(c);
            jumbled = built.toString();
        }

        post("Unscramble", jumbled.toUpperCase(Locale.ROOT));
    }

    private void maths() {
        int a = 2 + random.nextInt(30);
        int b = 2 + random.nextInt(30);

        if (random.nextBoolean()) {
            answer = String.valueOf(a * b);
            post("Quick maths", a + " x " + b);
        } else {
            answer = String.valueOf(a * a + b);
            post("Quick maths", a + " squared plus " + b);
        }
    }

    private void post(String kind, String question) {
        nexus.getServer().broadcast(Component.empty());
        nexus.getServer().broadcast(prefix()
                .append(Component.text(kind + ":  ", NamedTextColor.GRAY))
                .append(Component.text(question, NamedTextColor.WHITE, TextDecoration.BOLD)));
        nexus.getServer().broadcast(Component.text("   first correct answer in chat wins "
                + Stats.cash(PAYS), NamedTextColor.DARK_GRAY));

        for (Player player : nexus.getServer().getOnlinePlayers()) {
            player.playSound(player, Sound.BLOCK_NOTE_BLOCK_BELL, 0.7f, 1.2f);
        }
    }

    /**
     * Checks a chat message against the open question.
     *
     * Returns true if it was the winning answer, so the caller can decide
     * whether to still show the message — which it does. Hiding it would mean
     * the winning line never appears, and watching somebody type it is half of
     * what makes this fun in a room with two people in it.
     */
    public boolean guess(Player player, String said) {
        if (answer == null) return false;
        if (!said.trim().equalsIgnoreCase(answer)) return false;

        String was = answer;
        answer = null;

        nexus.stats().pay(player.getUniqueId(), PAYS);
        nexus.stats().of(player.getUniqueId()).chatWins++;

        nexus.getServer().broadcast(prefix()
                .append(Component.text(player.getName(), NamedTextColor.WHITE))
                .append(Component.text(" got it — ", NamedTextColor.GRAY))
                .append(Component.text(was, NamedTextColor.AQUA))
                .append(Component.text("   +" + Stats.cash(PAYS), NamedTextColor.GREEN)));

        for (Player everyone : nexus.getServer().getOnlinePlayers()) {
            everyone.playSound(everyone, Sound.ENTITY_EXPERIENCE_ORB_PICKUP, 0.8f, 1.3f);
        }

        // Every tenth is worth a key, so a good guesser has something building.
        if (nexus.stats().of(player.getUniqueId()).chatWins % 10 == 0) {
            nexus.crates().give(player, Crates.Tier.RARE, 1);
        }
        return true;
    }

    private Component prefix() {
        return Component.text("[", NamedTextColor.DARK_GRAY)
                .append(Component.text("Nexus", Text.BRAND))
                .append(Component.text("] ", NamedTextColor.DARK_GRAY));
    }

    /** For an operator who wants one now. */
    public void forceOne() {
        answer = null;
        ask();
    }
}
