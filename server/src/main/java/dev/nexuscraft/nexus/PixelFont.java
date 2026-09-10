package dev.nexuscraft.nexus;

import java.util.HashMap;
import java.util.Map;

/**
 * A blocky alphabet, five across and seven up.
 *
 * Here so that writing something on the side of a building is a command rather
 * than a request. A dozen hand-drawn sprites covers a dozen ideas; a font
 * covers every word anybody will ever want, including the ones this server has
 * not been named yet.
 *
 * Uppercase only, deliberately. Lowercase needs descenders, which means either
 * nine rows for every glyph or a `g` that sits on the line looking wrong, and
 * neither is worth it for text that is going to be read from forty blocks away.
 */
public final class PixelFont {

    /** Every glyph is this size, which is what lets the renderer stay simple. */
    public static final int WIDE = 5;
    public static final int HIGH = 7;

    /** Blank columns between one letter and the next. */
    public static final int SPACING = 1;

    private static final Map<Character, String[]> GLYPHS = new HashMap<>();

    private static void put(char letter, String... rows) {
        GLYPHS.put(letter, rows);
    }

    static {
        put('A', ".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#");
        put('B', "####.", "#...#", "#...#", "####.", "#...#", "#...#", "####.");
        put('C', ".###.", "#...#", "#....", "#....", "#....", "#...#", ".###.");
        put('D', "####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####.");
        put('E', "#####", "#....", "#....", "####.", "#....", "#....", "#####");
        put('F', "#####", "#....", "#....", "####.", "#....", "#....", "#....");
        put('G', ".###.", "#...#", "#....", "#.###", "#...#", "#...#", ".###.");
        put('H', "#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#");
        put('I', "#####", "..#..", "..#..", "..#..", "..#..", "..#..", "#####");
        put('J', "..###", "...#.", "...#.", "...#.", "...#.", "#..#.", ".##..");
        put('K', "#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#");
        put('L', "#....", "#....", "#....", "#....", "#....", "#....", "#####");
        put('M', "#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#");
        put('N', "#...#", "##..#", "#.#.#", "#.#.#", "#..##", "#...#", "#...#");
        put('O', ".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###.");
        put('P', "####.", "#...#", "#...#", "####.", "#....", "#....", "#....");
        put('Q', ".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#");
        put('R', "####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#");
        put('S', ".####", "#....", "#....", ".###.", "....#", "....#", "####.");
        put('T', "#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#..");
        put('U', "#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###.");
        put('V', "#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#..");
        put('W', "#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#");
        put('X', "#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#");
        put('Y', "#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#..");
        put('Z', "#####", "....#", "...#.", "..#..", ".#...", "#....", "#####");

        put('0', ".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###.");
        put('1', "..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###.");
        put('2', ".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####");
        put('3', "#####", "...#.", "..#..", "...#.", "....#", "#...#", ".###.");
        put('4', "...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#.");
        put('5', "#####", "#....", "####.", "....#", "....#", "#...#", ".###.");
        put('6', "..##.", ".#...", "#....", "####.", "#...#", "#...#", ".###.");
        put('7', "#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#...");
        put('8', ".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###.");
        put('9', ".###.", "#...#", "#...#", ".####", "....#", "...#.", ".##..");

        put(' ', ".....", ".....", ".....", ".....", ".....", ".....", ".....");
        put('!', "..#..", "..#..", "..#..", "..#..", "..#..", ".....", "..#..");
        put('?', ".###.", "#...#", "....#", "...#.", "..#..", ".....", "..#..");
        put('.', ".....", ".....", ".....", ".....", ".....", ".....", "..#..");
        put(',', ".....", ".....", ".....", ".....", ".....", "..#..", ".#...");
        put('-', ".....", ".....", ".....", "#####", ".....", ".....", ".....");
        put('+', ".....", "..#..", "..#..", "#####", "..#..", "..#..", ".....");
        put('\'', "..#..", "..#..", ".....", ".....", ".....", ".....", ".....");
        put(':', ".....", "..#..", ".....", ".....", ".....", "..#..", ".....");
    }

    private PixelFont() {
    }

    /**
     * The glyph for a character, or null if there is none.
     *
     * Anything unknown returns null rather than a box or a blank, so the caller
     * can decide - and the command can tell somebody which character it could
     * not write instead of quietly dropping it.
     */
    public static String[] glyphOf(char letter) {
        return GLYPHS.get(Character.toUpperCase(letter));
    }

    public static boolean has(char letter) {
        return GLYPHS.containsKey(Character.toUpperCase(letter));
    }

    /** How wide a word will be, in blocks, at one block per pixel. */
    public static int widthOf(String text) {
        if (text.isEmpty()) return 0;
        return text.length() * (WIDE + SPACING) - SPACING;
    }
}
