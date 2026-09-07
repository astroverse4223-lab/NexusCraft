package dev.nexuscraft.ember.ai;

/**
 * The two pieces of JSON this mod actually needs.
 *
 * Writing a correct escaper and one narrow reader is a smaller liability than
 * bundling a parser into a mod jar. A mod that shades Gson or Jackson has to
 * relocate it or take whatever version the modpack loaded first, and the
 * failure mode for getting that wrong is a crash in someone else's mod.
 *
 * The reader is not a JSON parser and does not pretend to be. It finds the
 * first `"content"` string in a chat-completions response and unescapes it. It
 * would be wrong for arbitrary JSON; it is right for the one shape both
 * backends return, and it fails to null rather than throwing.
 */
public final class Json {

    private Json() {}

    /** A JSON string literal, quotes included, escaped to the spec. */
    static String string(String raw) {
        if (raw == null) return "\"\"";
        StringBuilder out = new StringBuilder(raw.length() + 16);
        out.append('"');
        for (int i = 0; i < raw.length(); i++) {
            char c = raw.charAt(i);
            switch (c) {
                case '"' -> out.append("\\\"");
                case '\\' -> out.append("\\\\");
                case '\n' -> out.append("\\n");
                case '\r' -> out.append("\\r");
                case '\t' -> out.append("\\t");
                case '\b' -> out.append("\\b");
                case '\f' -> out.append("\\f");
                default -> {
                    // Control characters are the ones that produce invalid JSON;
                    // everything else, including the whole of Unicode, is sent
                    // through as-is because the body is written out as UTF-8.
                    if (c < 0x20) out.append(String.format("\\u%04x", (int) c));
                    else out.append(c);
                }
            }
        }
        return out.append('"').toString();
    }

    /**
     * The assistant's text from a chat-completions response.
     *
     * Scans for the first `"content"` key and reads the string that follows it,
     * honouring escapes so a reply containing a quote is not truncated. Returns
     * null when the shape is not what was expected.
     */
    static String firstMessageContent(String body) {
        if (body == null) return null;
        int key = body.indexOf("\"content\"");
        if (key < 0) return null;

        int i = body.indexOf('"', key + "\"content\"".length());
        // Skip the colon and any whitespace; if the value is not a string
        // (null, an object) there is nothing here to read.
        int colon = body.indexOf(':', key + "\"content\"".length());
        if (colon < 0 || i < 0 || i < colon) return null;

        StringBuilder out = new StringBuilder();
        for (int p = i + 1; p < body.length(); p++) {
            char c = body.charAt(p);
            if (c == '"') return out.toString();
            if (c != '\\') {
                out.append(c);
                continue;
            }
            if (++p >= body.length()) break;
            char escaped = body.charAt(p);
            switch (escaped) {
                case 'n' -> out.append('\n');
                case 'r' -> out.append('\r');
                case 't' -> out.append('\t');
                case 'b' -> out.append('\b');
                case 'f' -> out.append('\f');
                case 'u' -> {
                    if (p + 4 < body.length()) {
                        try {
                            out.append((char) Integer.parseInt(body.substring(p + 1, p + 5), 16));
                            p += 4;
                        } catch (NumberFormatException ignored) {
                            // Malformed escape: keep the literal rather than lose the reply.
                            out.append("\\u");
                        }
                    }
                }
                default -> out.append(escaped);
            }
        }
        return null;
    }

    /** A short, single-line piece of a body, for putting in an error message. */
    static String snippet(String body) {
        if (body == null) return "(empty)";
        String flat = body.replaceAll("\\s+", " ").trim();
        return flat.length() > 180 ? flat.substring(0, 180) + "…" : flat;
    }

    /* ------------------------------------------------------------- Ember */

    /**
     * A string field, read without a JSON library.
     *
     * The mod ships no dependencies beyond Fabric, and one field out of a small
     * object does not justify one. Handles escaped quotes, which model replies
     * contain constantly.
     */
    public static String stringField(String body, String key) {
        String needle = "\"" + key + "\"";
        int at = body.indexOf(needle);
        if (at < 0) return null;

        int colon = body.indexOf(':', at + needle.length());
        if (colon < 0) return null;

        int i = colon + 1;
        while (i < body.length() && Character.isWhitespace(body.charAt(i))) i++;
        if (i >= body.length() || body.charAt(i) != '"') return null;

        StringBuilder out = new StringBuilder();
        for (i++; i < body.length(); i++) {
            char c = body.charAt(i);
            if (c == '\\' && i + 1 < body.length()) {
                char next = body.charAt(++i);
                out.append(switch (next) {
                    case 'n' -> '\n';
                    case 't' -> '\t';
                    case 'r' -> '\r';
                    default -> next;
                });
                continue;
            }
            if (c == '"') break;
            out.append(c);
        }
        return out.toString();
    }

    /** A true/false/null field. Null means "the model did not decide". */
    public static Boolean booleanField(String body, String key) {
        String needle = "\"" + key + "\"";
        int at = body.indexOf(needle);
        if (at < 0) return null;
        int colon = body.indexOf(':', at + needle.length());
        if (colon < 0) return null;

        String rest = body.substring(colon + 1).stripLeading();
        if (rest.startsWith("true")) return Boolean.TRUE;
        if (rest.startsWith("false")) return Boolean.FALSE;
        return null;
    }

    /** One entry of the "give" list. */
    public record Give(String item, int count) {}

    /**
     * The items the model wants handed over.
     *
     * Scans the "give" array for item/count pairs rather than parsing the whole
     * document, so a malformed tail does not lose the good entries in front of
     * it — models truncate, and half a list is better than none.
     */
    public static java.util.List<Give> gives(String body) {
        java.util.List<Give> found = new java.util.ArrayList<>();

        int at = body.indexOf("\"give\"");
        if (at < 0) return found;
        int open = body.indexOf('[', at);
        if (open < 0) return found;
        int close = body.indexOf(']', open);
        if (close < 0) close = body.length();

        String list = body.substring(open, close);
        int cursor = 0;
        while (true) {
            int entry = list.indexOf('{', cursor);
            if (entry < 0) break;
            int end = list.indexOf('}', entry);
            if (end < 0) break;

            String chunk = list.substring(entry, end + 1);
            String item = stringField(chunk, "item");
            int count = intField(chunk, "count", 1);
            if (item != null && !item.isBlank()) found.add(new Give(item, Math.max(1, count)));

            cursor = end + 1;
        }
        return found;
    }

    /** A whole-number field, with a fallback when it is missing or nonsense. */
    public static int intField(String body, String key, int fallback) {
        String needle = "\"" + key + "\"";
        int at = body.indexOf(needle);
        if (at < 0) return fallback;
        int colon = body.indexOf(':', at + needle.length());
        if (colon < 0) return fallback;

        int i = colon + 1;
        while (i < body.length() && Character.isWhitespace(body.charAt(i))) i++;

        int start = i;
        while (i < body.length() && (Character.isDigit(body.charAt(i)) || body.charAt(i) == '-')) i++;
        if (start == i) return fallback;

        try {
            return Integer.parseInt(body.substring(start, i));
        } catch (NumberFormatException e) {
            return fallback;
        }
    }
}
