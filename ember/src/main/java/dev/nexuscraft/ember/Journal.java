package dev.nexuscraft.ember;

import net.fabricmc.loader.api.FabricLoader;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

/**
 * What Ember remembers about you between sessions.
 *
 * Its memory used to be the last eight messages, held in a field, gone the
 * moment the game closed — so every evening it met you for the first time and
 * had to be told again what you were building. A companion that cannot
 * remember yesterday is a chatbot standing next to you.
 *
 * Notes are short and few on purpose. This is not a transcript: it is the
 * handful of things a person would actually carry from one day to the next, and
 * keeping it small is what stops the prompt filling with the weather.
 */
public final class Journal {

    /** More than this and the oldest ordinary notes are dropped. */
    private static final int LIMIT = 40;

    /** Notes longer than this are the model rambling, not remembering. */
    private static final int NOTE_LENGTH = 180;

    public record Note(long day, String text, boolean pinned) {}

    private static final Map<UUID, List<Note>> REMEMBERED = new LinkedHashMap<>();
    private static boolean loaded;

    private Journal() {
    }

    private static Path file() {
        return FabricLoader.getInstance().getConfigDir().resolve("ember-memory.json");
    }

    /* ------------------------------------------------------------ writing */

    /**
     * Remembers something.
     *
     * `pinned` marks the facts that should outlive everything else — who
     * someone is, where they live — so a busy week of small notes cannot push
     * out the things that actually matter.
     */
    public static synchronized void remember(UUID who, long day, String text, boolean pinned) {
        if (text == null) return;

        String cleaned = text.replaceAll("\\s+", " ").trim();
        if (cleaned.length() < 4) return;
        if (cleaned.length() > NOTE_LENGTH) cleaned = cleaned.substring(0, NOTE_LENGTH).trim();

        load();
        List<Note> notes = REMEMBERED.computeIfAbsent(who, id -> new ArrayList<>());

        // The same observation twice in a day is one observation.
        String key = cleaned.toLowerCase(Locale.ROOT);
        for (Note existing : notes) {
            if (existing.day() == day && existing.text().toLowerCase(Locale.ROOT).equals(key)) return;
        }

        notes.add(new Note(day, cleaned, pinned));
        prune(notes);
        save();
    }

    public static void remember(UUID who, long day, String text) {
        remember(who, day, text, false);
    }

    /** Drops the oldest unpinned notes once there are too many. */
    private static void prune(List<Note> notes) {
        while (notes.size() > LIMIT) {
            int oldest = -1;
            for (int i = 0; i < notes.size(); i++) {
                if (notes.get(i).pinned()) continue;
                oldest = i;
                break;
            }
            // Everything is pinned, which is its own kind of full.
            if (oldest < 0) return;
            notes.remove(oldest);
        }
    }

    /* ------------------------------------------------------------ reading */

    /**
     * What it knows, written for the model to read.
     *
     * Newest last, because that is the order a person recalls things in and the
     * order the model weighs most heavily.
     */
    public static synchronized String recall(UUID who, long today) {
        load();
        List<Note> notes = REMEMBERED.get(who);
        if (notes == null || notes.isEmpty()) return null;

        StringBuilder out = new StringBuilder("What you remember:\n");
        for (Note note : notes) {
            long ago = today - note.day();
            String when = ago <= 0 ? "today"
                    : ago == 1 ? "yesterday"
                    : ago + " days ago";
            out.append("- (").append(when).append(") ").append(note.text()).append('\n');
        }
        return out.toString().trim();
    }

    public static synchronized boolean knows(UUID who) {
        load();
        List<Note> notes = REMEMBERED.get(who);
        return notes != null && !notes.isEmpty();
    }

    public static synchronized void forget(UUID who) {
        load();
        REMEMBERED.remove(who);
        save();
    }

    /* ---------------------------------------------------------- the file */

    private static void load() {
        if (loaded) return;
        loaded = true;

        Path path = file();
        if (!Files.exists(path)) return;

        try {
            String body = Files.readString(path, StandardCharsets.UTF_8);
            parse(body);
            Ember.LOG.info("remembered {} people", REMEMBERED.size());
        } catch (Exception e) {
            Ember.LOG.warn("could not read the journal, starting fresh: {}", e.getMessage());
        }
    }

    private static void save() {
        try {
            Files.createDirectories(file().getParent());
            Files.writeString(file(), write(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            Ember.LOG.warn("could not write the journal: {}", e.getMessage());
        }
    }

    /**
     * The journal as JSON, written by hand.
     *
     * The mod ships no JSON library and this is one object of one array; a
     * dependency for it would be larger than the thing it serialises.
     */
    private static String write() {
        StringBuilder out = new StringBuilder("{\n");
        boolean firstPerson = true;

        for (Map.Entry<UUID, List<Note>> person : REMEMBERED.entrySet()) {
            if (!firstPerson) out.append(",\n");
            firstPerson = false;

            out.append("  \"").append(person.getKey()).append("\": [\n");
            boolean firstNote = true;
            for (Note note : person.getValue()) {
                if (!firstNote) out.append(",\n");
                firstNote = false;
                out.append("    {\"day\":").append(note.day())
                   .append(",\"pinned\":").append(note.pinned())
                   .append(",\"text\":").append(quote(note.text())).append('}');
            }
            out.append("\n  ]");
        }

        return out.append("\n}\n").toString();
    }

    private static void parse(String body) {
        // Deliberately forgiving: a journal that will not parse should cost the
        // notes, never the session.
        java.util.regex.Matcher person = java.util.regex.Pattern
                .compile("\"([0-9a-fA-F-]{36})\"\\s*:\\s*\\[(.*?)\\]", java.util.regex.Pattern.DOTALL)
                .matcher(body);

        while (person.find()) {
            UUID who;
            try {
                who = UUID.fromString(person.group(1));
            } catch (IllegalArgumentException e) {
                continue;
            }

            List<Note> notes = new ArrayList<>();
            java.util.regex.Matcher entry = java.util.regex.Pattern
                    .compile("\\{([^}]*)}")
                    .matcher(person.group(2));

            while (entry.find()) {
                String chunk = entry.group(1);
                String text = dev.nexuscraft.ember.ai.Json.stringField("{" + chunk + "}", "text");
                if (text == null || text.isBlank()) continue;
                int day = dev.nexuscraft.ember.ai.Json.intField("{" + chunk + "}", "day", 0);
                boolean pinned = Boolean.TRUE.equals(
                        dev.nexuscraft.ember.ai.Json.booleanField("{" + chunk + "}", "pinned"));
                notes.add(new Note(day, text, pinned));
            }

            if (!notes.isEmpty()) REMEMBERED.put(who, notes);
        }
    }

    private static String quote(String raw) {
        StringBuilder out = new StringBuilder("\"");
        for (int i = 0; i < raw.length(); i++) {
            char c = raw.charAt(i);
            switch (c) {
                case '"' -> out.append("\\\"");
                case '\\' -> out.append("\\\\");
                case '\n' -> out.append("\\n");
                default -> {
                    if (c < 0x20) out.append(' ');
                    else out.append(c);
                }
            }
        }
        return out.append('"').toString();
    }
}
