package dev.nexuscraft.hollow.ai;

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
final class Json {

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
}
