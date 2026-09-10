package dev.nexuscraft.nexus;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Material;
import org.bukkit.Sound;
import org.bukkit.entity.Player;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Pixel art, put up as a wall in front of you.
 *
 * Concrete rather than wool or terracotta: it is the only full set of flat,
 * saturated colours in the game, and pixel art built out of anything with a
 * texture reads as noise from the distance you actually look at a mural from.
 *
 * Each piece is written here as a grid of letters. That is deliberately the
 * whole storage format - a sprite is something you should be able to read,
 * check and correct by looking at the source, and a packed array of block ids
 * is something nobody can proofread.
 */
public final class PixelArt {

    /** How much bigger than one block per pixel you may go. */
    private static final int MAX_SCALE = 4;

    /** How far in front of you the wall goes up. */
    private static final int AHEAD = 4;

    /**
     * The colours a sprite may use.
     *
     * A dot is a hole - nothing is placed - so a sprite can have a shape
     * rather than being a rectangle with a background it did not ask for.
     */
    private static Material colourOf(char key) {
        return switch (key) {
            case 'K' -> Material.BLACK_CONCRETE;
            case 'W' -> Material.WHITE_CONCRETE;
            case 'R' -> Material.RED_CONCRETE;
            case 'G' -> Material.GREEN_CONCRETE;
            case 'L' -> Material.LIME_CONCRETE;
            case 'B' -> Material.BLUE_CONCRETE;
            case 'T' -> Material.LIGHT_BLUE_CONCRETE;
            case 'C' -> Material.CYAN_CONCRETE;
            case 'Y' -> Material.YELLOW_CONCRETE;
            case 'O' -> Material.ORANGE_CONCRETE;
            case 'P' -> Material.PURPLE_CONCRETE;
            case 'M' -> Material.MAGENTA_CONCRETE;
            case 'I' -> Material.PINK_CONCRETE;
            case 'N' -> Material.BROWN_CONCRETE;
            case 'S' -> Material.LIGHT_GRAY_CONCRETE;
            case 'D' -> Material.GRAY_CONCRETE;
            default -> null;
        };
    }

    /** The sprites, in the order they are listed. */
    private static final Map<String, String[]> ART = new LinkedHashMap<>();

    static {
        ART.put("creeper", new String[]{
                "LLLLLLLLLLLLLLLL",
                "LGLLGLLLLGLLGLLL",
                "LLKKKKLLKKKKLLLL",
                "LLKKKKLLKKKKLLLL",
                "LLKKKKLLKKKKLLLL",
                "LLKKKKLLKKKKLLLL",
                "LLLLLLLLLLLLLLLL",
                "LLLLLKKKKKKLLLLL",
                "LLLLKKKKKKKKLLLL",
                "LLLLKKKKKKKKLLLL",
                "LLLLKKKKKKKKLLLL",
                "LLLLKKLLLLKKLLLL",
                "LLLLKKLLLLKKLLLL",
                "LLLLKKLLLLKKLLLL",
                "LGLLLLLLLLLLLGLL",
                "LLLLLLLLLLLLLLLL",
        });

        ART.put("heart", new String[]{
                "................",
                "...RRRR..RRRR...",
                "..RRRRRRRRRRRR..",
                ".RRRRRRRRRRRRRR.",
                ".RRRRRRRRRRRRRR.",
                ".RRRRRRRRRRRRRR.",
                ".RRRRRRRRRRRRRR.",
                "..RRRRRRRRRRRR..",
                "..RRRRRRRRRRRR..",
                "...RRRRRRRRRR...",
                "....RRRRRRRR....",
                ".....RRRRRR.....",
                "......RRRR......",
                ".......RR.......",
                "................",
                "................",
        });

        ART.put("invader", new String[]{
                "..L.......L..",
                "...L.....L...",
                "..LLLLLLLLL..",
                ".LL.LLLLL.LL.",
                "LLLLLLLLLLLLL",
                "L.LLLLLLLLL.L",
                "L.L.......L.L",
                "....LL.LL....",
        });

        ART.put("skull", new String[]{
                "................",
                "....WWWWWWWW....",
                "...WWWWWWWWWW...",
                "..WWWWWWWWWWWW..",
                "..WWWWWWWWWWWW..",
                "..WWKKWWWWKKWW..",
                "..WWKKWWWWKKWW..",
                "..WWWWWWWWWWWW..",
                "..WWWWWKKWWWWW..",
                "..WWWWWKKWWWWW..",
                "...WWWWWWWWWW...",
                "....WWWWWWWW....",
                "....WKWKWKWW....",
                "....WWWWWWWW....",
                "................",
                "................",
        });

        ART.put("star", new String[]{
                ".......YY.......",
                ".......YY.......",
                "......YYYY......",
                "......YYYY......",
                "YYYYYYYYYYYYYYYY",
                ".YYYYYYYYYYYYYY.",
                "..YYYYYYYYYYYY..",
                "...YYYYYYYYYY...",
                "....YYYYYYYY....",
                "....YYYYYYYY....",
                "...YYYY..YYYY...",
                "..YYYY....YYYY..",
                ".YYY........YYY.",
                "YYY..........YYY",
                "................",
                "................",
        });

        ART.put("mushroom", new String[]{
                "................",
                "....RRRRRRRR....",
                "..RRWWRRRRWWRR..",
                ".RRWWWWRRWWWWRR.",
                ".RWWWWWWRRWWWWR.",
                "RRRRWWRRRRRRWWRR",
                "RRRRRRRRRRRRRRRR",
                "RWWRRRRRRRRRRWWR",
                ".RRRRRRRRRRRRRR.",
                "....WWWWWWWW....",
                "....WWKWWKWW....",
                "....WWWWWWWW....",
                "....WWWWWWWW....",
                "....WWWWWWWW....",
                ".....WWWWWW.....",
                "................",
        });

        ART.put("ghost", new String[]{
                "................",
                ".....RRRRRR.....",
                "...RRRRRRRRRR...",
                "..RRRRRRRRRRRR..",
                "..RRWWWRRWWWRR..",
                ".RRRWWWRRWWWRRR.",
                ".RRWWKWRRWWKWRR.",
                ".RRWWKWRRWWKWRR.",
                ".RRRWWWRRWWWRRR.",
                ".RRRRRRRRRRRRRR.",
                ".RRRRRRRRRRRRRR.",
                ".RRRRRRRRRRRRRR.",
                ".RRRRRRRRRRRRRR.",
                ".RR.RRR..RRR.RR.",
                ".R...RR..RR...R.",
                "................",
        });

        ART.put("diamond", new String[]{
                "................",
                "................",
                "....TTTTTTTT....",
                "...TTCCCCCCTT...",
                "..TTCCWWWWCCTT..",
                ".TTCCWWCCWWCCTT.",
                "TTCCWWCCCCWWCCTT",
                ".TTCCWWCCWWCCTT.",
                "..TTCCWWWWCCTT..",
                "...TTCCCCCCTT...",
                "....TTCCCCTT....",
                ".....TTCCTT.....",
                "......TTTT......",
                ".......TT.......",
                "................",
                "................",
        });

        ART.put("sword", new String[]{
                "..........TTT...",
                ".........TTCTT..",
                "........TTCCTT..",
                ".......TTCCTT...",
                "......TTCCTT....",
                ".....TTCCTT.....",
                "....TTCCTT......",
                "...TTCCTT.......",
                "..NNTCTT........",
                ".NNNNTT.........",
                "..NNNNNN........",
                ".N...NNNN.......",
                "......NNNN......",
                ".......NN.......",
                "................",
                "................",
        });

        ART.put("smiley", new String[]{
                "....YYYYYYYY....",
                "..YYYYYYYYYYYY..",
                ".YYYYYYYYYYYYYY.",
                "YYYYYYYYYYYYYYYY",
                "YYYKKYYYYYYKKYYY",
                "YYYKKYYYYYYKKYYY",
                "YYYKKYYYYYYKKYYY",
                "YYYYYYYYYYYYYYYY",
                "YYYYYYYYYYYYYYYY",
                "YYKYYYYYYYYYYKYY",
                "YYYKKYYYYYYKKYYY",
                "YYYYKKKKKKKKYYYY",
                "YYYYYKKKKKKYYYYY",
                ".YYYYYYYYYYYYYY.",
                "..YYYYYYYYYYYY..",
                "....YYYYYYYY....",
        });

        ART.put("cat", new String[]{
                "................",
                "..DD........DD..",
                "..DDD......DDD..",
                "..DDDD....DDDD..",
                "..DDDDDDDDDDDD..",
                ".DDDDDDDDDDDDDD.",
                ".DDLLDDDDDDLLDD.",
                ".DDLLDDDDDDLLDD.",
                ".DDDDDDDDDDDDDD.",
                ".DDDDDIIIIDDDDD.",
                ".DDDDDDIIDDDDDD.",
                "WDDDDDDDDDDDDDDW",
                ".WWDDDDDDDDDDWW.",
                "..DDDDDDDDDDDD..",
                "...DDDDDDDDDD...",
                "................",
        });

        ART.put("mario", new String[]{
                "....RRRRRRRR....",
                "...RRRRRRRRRR...",
                "...NNNNNNNNNN...",
                "..NNOOOOOOOONN..",
                "..NOKOOOOOOKON..",
                "..NOKOOOOOOKON..",
                "..NOOOOOOOOOON..",
                "...OOKKKKKKOO...",
                "....OOOOOOOO....",
                "...RRRBBBBRRR...",
                "..RRRRBBBBRRRR..",
                "..OORBBYYBBROO..",
                "..OOOBBBBBBOOO..",
                "....BBBBBBBB....",
                "....NNN..NNN....",
                "...NNNN..NNNN...",
        });

        ART.put("luigi", new String[]{
                "....GGGGGGGG....",
                "...GGGGGGGGGG...",
                "...NNNNNNNNNN...",
                "..NNOOOOOOOONN..",
                "..NOKOOOOOOKON..",
                "..NOKOOOOOOKON..",
                "..NOOOOOOOOOON..",
                "...OOKKKKKKOO...",
                "....OOOOOOOO....",
                "...GGGBBBBGGG...",
                "..GGGGBBBBGGGG..",
                "..OOGBBYYBBGOO..",
                "..OOOBBBBBBOOO..",
                "....BBBBBBBB....",
                "....NNN..NNN....",
                "...NNNN..NNNN...",
        });

        ART.put("pikachu", new String[]{
                "..K..........K..",
                "..KK........KK..",
                "..YKK......KKY..",
                "..YYKK....KKYY..",
                "..YYYKKKKKKYYY..",
                ".YYYYYYYYYYYYYY.",
                ".YYYYYYYYYYYYYY.",
                "YYKKYYYYYYYYKKYY",
                "YYKKYYYYYYYYKKYY",
                "YRRYYYYKKYYYYRRY",
                "YRRYYYKKKKYYYRRY",
                ".YYYYYYKKYYYYYY.",
                ".YYYYYYYYYYYYYY.",
                "..YYYYYYYYYYYY..",
                "...YYYY..YYYY...",
                "................",
        });

        ART.put("pokeball", new String[]{
                "....RRRRRRRR....",
                "..RRRRRRRRRRRR..",
                ".RRRRRRRRRRRRRR.",
                ".RRRRRRRRRRRRRR.",
                "RRRRRRRRRRRRRRRR",
                "RRRRRRRRRRRRRRRR",
                "KKKKKKWWWWKKKKKK",
                "KKKKKWWWWWWKKKKK",
                "KKKKKWWKKWWKKKKK",
                "WWWWWWWKKWWWWWWW",
                "WWWWWWWWWWWWWWWW",
                "WWWWWWWWWWWWWWWW",
                ".WWWWWWWWWWWWWW.",
                ".WWWWWWWWWWWWWW.",
                "..WWWWWWWWWWWW..",
                "....WWWWWWWW....",
        });

        ART.put("kirby", new String[]{
                ".....IIIIII.....",
                "...IIIIIIIIII...",
                "..IIIIIIIIIIII..",
                ".IIIIIIIIIIIIII.",
                ".IIIKIIIIKIIIII.",
                "IIIIKIIIIKIIIIII",
                "IIIIKIIIIKIIIIII",
                "IIIIKIIIIKIIIIII",
                "IIIIIIIIIIIIIIII",
                "IIIRRIIIIIIRRIII",
                "IIIRRIIIIIIRRIII",
                ".IIIIIIIIIIIIII.",
                "..IIIIIIIIIIII..",
                ".RRRIIIIIIIIRRR.",
                "RRRRR......RRRRR",
                "................",
        });

        ART.put("yoshi", new String[]{
                "................",
                ".....LLLLLL.....",
                "...LLLLLLLLLL...",
                "..LLLLLLLLLLLL..",
                "..LLWWWLLWWWLL..",
                "..LLWKWLLWKWLL..",
                "..LLWWWLLWWWLL..",
                "..LLLLLLLLLLLL..",
                "..LLLLLLLLLLLL..",
                "...LLLLLLLLLL...",
                "....WWWWWWWW....",
                "...WWWWWWWWWW...",
                "...WWKWWWWKWW...",
                "...WWWWWWWWWW...",
                "....WWWWWWWW....",
                ".....WWWWWW.....",
        });

        ART.put("megaman", new String[]{
                "......TTTT......",
                "....TTTTTTTT....",
                "...TTTTTTTTTT...",
                "...TTOOOOOOTT...",
                "..TTTOOOOOOTTT..",
                "..TTOKOOOOKOTT..",
                "..TTOKOOOOKOTT..",
                "..TTOOOOOOOOTT..",
                "...TOOOOOOOOT...",
                "....OOOOOOOO....",
                "..TTTTTTTTTTTT..",
                ".TTTTTTTTTTTTTT.",
                ".TTTTTTTTTTTTTT.",
                ".TTTT......TTTT.",
                ".TTT........TTT.",
                "................",
        });

        ART.put("pacman", new String[]{
                ".....YYYYYY.....",
                "...YYYYYYYYYY...",
                "..YYYYYYYYYYYY..",
                ".YYYYYYYYYYYYYY.",
                ".YYYYYYYYYY.....",
                "YYYYYYYYYY......",
                "YYYYYYYYY.......",
                "YYYYYYYY........",
                "YYYYYYYY........",
                "YYYYYYYYY.......",
                "YYYYYYYYYY......",
                ".YYYYYYYYYY.....",
                ".YYYYYYYYYYYYYY.",
                "..YYYYYYYYYYYY..",
                "...YYYYYYYYYY...",
                ".....YYYYYY.....",
        });

        ART.put("crewmate", new String[]{
                ".....RRRRRR.....",
                "...RRRRRRRRRR...",
                "..RRRRRRRRRRR...",
                "..RRTTTTTTTRR...",
                ".RRRTTTTTTTTRR..",
                ".RRRTTTTTTTTRR..",
                ".RRRRTTTTTTRR...",
                ".RRRRRRRRRRRR...",
                "RRRRRRRRRRRRR...",
                "RRRRRRRRRRRRR...",
                "RRRRRRRRRRRRR...",
                "RRRRRRRRRRRRR...",
                "RRRRRRRRRRRRR...",
                ".RRRR...RRRRR...",
                ".RRRR...RRRRR...",
                ".RRRR...RRRR....",
        });

        ART.put("steve", new String[]{
                "NNNNNNNNNNNNNNNN",
                "NNNNNNNNNNNNNNNN",
                "NNNNNNNNNNNNNNNN",
                "NOOOOOOOOOOOOOON",
                "OOOOOOOOOOOOOOOO",
                "OOWWBOOOOOOWWBOO",
                "OOWWBOOOOOOWWBOO",
                "OOOOOOOOOOOOOOOO",
                "OOOOOONNNNOOOOOO",
                "OOOOONNNNNNOOOOO",
                "OOOONOOOOOONOOOO",
                "OOOOOOOOOOOOOOOO",
                "OOOONNNNNNNNOOOO",
                "OOOOONNNNNNOOOOO",
                "OOOOOOOOOOOOOOOO",
                "OOOOOOOOOOOOOOOO",
        });

        ART.put("crown", new String[]{
                "................",
                "................",
                "..Y..........Y..",
                ".YYY........YYY.",
                ".YYY...YY...YYY.",
                ".YYY..YYYY..YYY.",
                ".YYY.YYYYYY.YYY.",
                ".YYYYYYYYYYYYYY.",
                ".YYYYYYYYYYYYYY.",
                ".YYRYYYYYYYYRYY.",
                ".YYYYYYYYYYYYYY.",
                ".YYYYYYYYYYYYYY.",
                "..YYYYYYYYYYYY..",
                "................",
                "................",
                "................",
        });

        ART.put("key", new String[]{
                "................",
                "....YYYY........",
                "...YY..YY.......",
                "..YY....YY......",
                "..YY....YY......",
                "..YY....YY......",
                "...YY..YY.......",
                "....YYYY........",
                ".....YY.........",
                ".....YY.........",
                ".....YYY........",
                ".....YY.........",
                ".....YYY........",
                ".....YY.........",
                "................",
                "................",
        });

        ART.put("tnt", new String[]{
                "................",
                "..........K.....",
                ".........K......",
                "..RRRRRRRRRRRR..",
                "..RRRRRRRRRRRR..",
                "..RRRRRRRRRRRR..",
                "..WWWWWWWWWWWW..",
                "..WWKWWKWWKWWW..",
                "..WWKWWKWWKWWW..",
                "..WWKKKKKKKWWW..",
                "..WWWWWWWWWWWW..",
                "..RRRRRRRRRRRR..",
                "..RRRRRRRRRRRR..",
                "..RRRRRRRRRRRR..",
                "................",
                "................",
        });

        ART.put("apple", new String[]{
                "................",
                ".......NN.......",
                "......NN........",
                "....LLNN........",
                "...LLLLN........",
                "..RRRRRRRRRR....",
                ".RRRRRRRRRRRR...",
                "RRRRRRRRRRRRRR..",
                "RRWRRRRRRRRRRR..",
                "RRWRRRRRRRRRRR..",
                "RRRRRRRRRRRRRR..",
                ".RRRRRRRRRRRR...",
                "..RRRRRRRRRR....",
                "...RRR..RRR.....",
                "................",
                "................",
        });

        ART.put("flame", new String[]{
                "................",
                ".......Y........",
                "......YY........",
                ".....YOY........",
                "....YOOYY.......",
                "...YOOOOY.......",
                "..YOORROY.......",
                "..YORRRROY......",
                "..YORRRRROY.....",
                "..YOORRRROY.....",
                "...YOORROY......",
                "....YOOOY.......",
                ".....YYY........",
                "................",
                "................",
                "................",
        });

        ART.put("note", new String[]{
                "................",
                ".........KKKKK..",
                ".........KKKKKK.",
                ".........KK..KK.",
                ".........KK..KK.",
                ".........KK.....",
                ".........KK.....",
                ".........KK.....",
                ".........KK.....",
                "..KKKK...KK.....",
                ".KKKKKK..KK.....",
                ".KKKKKKKKKK.....",
                ".KKKKKK.........",
                "..KKKK..........",
                "................",
                "................",
        });

        ART.put("cloud", new String[]{
                "................",
                "................",
                "................",
                "......WWWW......",
                "....WWWWWWWW....",
                "...WWWWWWWWWW...",
                "..WWWWWWWWWWWW..",
                ".WWWWWWWWWWWWWW.",
                "WWWWWWWWWWWWWWWW",
                "WWWWWWWWWWWWWWWW",
                ".WWWWWWWWWWWWWW.",
                "................",
                "................",
                "................",
                "................",
                "................",
        });

        ART.put("tree", new String[]{
                "................",
                "......LLLL......",
                ".....LLLLLL.....",
                "....LLLLLLLL....",
                "...LLLLLLLLLL...",
                "..LLLLLLLLLLLL..",
                "...LLLLLLLLLL...",
                "....LLLLLLLL....",
                "..LLLLLLLLLLLL..",
                "...LLLLLLLLLL...",
                "....LLLLLLLL....",
                "......NNNN......",
                "......NNNN......",
                "......NNNN......",
                ".....NNNNNN.....",
                "................",
        });

        ART.put("fish", new String[]{
                "................",
                "................",
                "..........OO....",
                ".....OOOOOOOO...",
                "...OOOOOOOOOOO..",
                "..OOOOOOOOOOOOO.",
                ".OOKOOOOOOOOOOOO",
                "OOOOOOOOOOOOOOOO",
                ".OOKOOOOOOOOOOOO",
                "..OOOOOOOOOOOOO.",
                "...OOOOOOOOOOO..",
                ".....OOOOOOOO...",
                "..........OO....",
                "................",
                "................",
                "................",
        });

        ART.put("controller", new String[]{
                "................",
                "................",
                "................",
                "..DDDDDDDDDDDD..",
                ".DDDDDDDDDDDDDD.",
                "DDDWDDDDDDDRDDDD",
                "DDWWWDDDDDRRRDDD",
                "DDDWDDDDDDDRDDDD",
                "DDDDDDDDDDDDDDDD",
                "DDDDDDDDDDDDDDDD",
                ".DDDD......DDDD.",
                "..DD........DD..",
                "................",
                "................",
                "................",
                "................",
        });

        ART.put("pumpkin", new String[]{
                ".......LL.......",
                "......LLLL......",
                "..OOOOOOOOOOOO..",
                ".OOOOOOOOOOOOOO.",
                "OOOOOOOOOOOOOOOO",
                "OOKKKOOOOKKKOOOO",
                "OOKKKOOOOKKKOOOO",
                "OOOKOOOOOOKOOOOO",
                "OOOOOOOOOOOOOOOO",
                "OOOKKKKKKKKKKOOO",
                "OOKOOKOOKOOKOKOO",
                "OOKKKKKKKKKKKKOO",
                "OOOKKKKKKKKKKOOO",
                "OOOOOOOOOOOOOOOO",
                ".OOOOOOOOOOOOOO.",
                "..OOOOOOOOOOOO..",
        });
    }

    private final Nexus nexus;

    public PixelArt(Nexus nexus) {
        this.nexus = nexus;
    }

    public static List<String> names() {
        List<String> out = new ArrayList<>();

        // The wordmark is not in the map but is a name you can ask for.
        out.add("nexus");
        out.addAll(ART.keySet());

        return out;
    }

    /* ------------------------------------------------------------- placing */

    public void place(Player player, String which, int scale) {
        // The wordmark is drawn rather than stored, so it is answered here.
        if (which.equalsIgnoreCase("nexus")) {
            wordmark(player, scale);
            return;
        }

        String[] rows = ART.get(which.toLowerCase(java.util.Locale.ROOT));

        if (rows == null) {
            player.sendMessage(Text.bad("No pixel art called '" + which + "'."));
            player.sendMessage(Text.plain("  " + String.join(", ", names())));
            return;
        }

        if (scale < 1 || scale > MAX_SCALE) {
            player.sendMessage(Text.bad("Scale is 1 to " + MAX_SCALE + "."));
            return;
        }

        if (!nexus.blueprints().mayPlace(player)) return;

        Toolkit.Change change = nexus.toolkit().change();

        // Ground at 0, so the wall starts where you are standing rather than
        // sinking its bottom row into the floor.
        Facing at = new Facing(player.getWorld(), change, player.getLocation(), 0);

        int high = rows.length;
        int wide = rows[0].length();

        for (int row = 0; row < high; row++) {
            for (int column = 0; column < wide && column < rows[row].length(); column++) {
                Material colour = colourOf(rows[row].charAt(column));
                if (colour == null) continue;

                /*
                 * Rows run downward and the world runs upward, so the first
                 * row of the grid is the top of the wall - otherwise every
                 * sprite here would be built upside down.
                 */
                int u = (high - 1 - row) * scale;
                int r = (column - wide / 2) * scale;

                for (int dy = 0; dy < scale; dy++) {
                    for (int dr = 0; dr < scale; dr++) {
                        at.set(AHEAD, u + dy, r + dr, colour);
                    }
                }
            }
        }

        int changed = change.commit(player);

        player.sendMessage(Text.good(which + " placed. " + changed + " blocks."));
        player.sendMessage(Text.plain("  /undo takes it back."));
        player.playSound(player, Sound.BLOCK_STONE_PLACE, 0.8f, 1.2f);
    }

    /* ---------------------------------------------------------------- text */

    /**
     * Writes something on a wall in front of you.
     *
     * Centred on where you stand rather than starting there, so a long word
     * does not run off to one side of whatever you meant to write it on.
     */
    public void write(Player player, String colourName, String text, int scale) {
        Material colour = colourNamed(colourName);

        if (colour == null) {
            player.sendMessage(Text.bad("No colour called '" + colourName + "'."));
            player.sendMessage(Text.plain("  " + String.join(", ", colourNames())));
            return;
        }

        if (scale < 1 || scale > MAX_SCALE) {
            player.sendMessage(Text.bad("Scale is 1 to " + MAX_SCALE + "."));
            return;
        }

        String written = text.toUpperCase(java.util.Locale.ROOT);

        for (char letter : written.toCharArray()) {
            if (PixelFont.has(letter)) continue;

            player.sendMessage(Text.bad("Cannot write '" + letter + "'."));
            player.sendMessage(Text.plain("  Letters, numbers and . , - + : ! ? '"));
            return;
        }

        if (!nexus.blueprints().mayPlace(player)) return;

        Toolkit.Change change = nexus.toolkit().change();
        Facing at = new Facing(player.getWorld(), change, player.getLocation(), 0);

        int changed = letters(at, written, colour, scale, 0);
        change.commit(player);

        player.sendMessage(Text.good("Written. " + changed + " blocks."));
        player.sendMessage(Text.plain("  /undo takes it back."));
        player.playSound(player, Sound.BLOCK_STONE_PLACE, 0.8f, 1.2f);
    }

    /**
     * Lays the glyphs out, and says how many blocks it took.
     *
     * Shared by the text command and the wordmark, so the two cannot end up
     * spacing their letters differently.
     */
    private int letters(Facing at, String written, Material colour, int scale, int lift) {
        int wide = PixelFont.widthOf(written);
        int placed = 0;

        for (int index = 0; index < written.length(); index++) {
            String[] glyph = PixelFont.glyphOf(written.charAt(index));
            if (glyph == null) continue;

            int leftOf = index * (PixelFont.WIDE + PixelFont.SPACING);

            for (int row = 0; row < PixelFont.HIGH; row++) {
                for (int column = 0; column < PixelFont.WIDE; column++) {
                    if (glyph[row].charAt(column) != '#') continue;

                    // Rows run downward, the world runs upward.
                    int u = (PixelFont.HIGH - 1 - row) * scale + lift;
                    int r = (leftOf + column - wide / 2) * scale;

                    for (int dy = 0; dy < scale; dy++) {
                        for (int dr = 0; dr < scale; dr++) {
                            at.set(AHEAD, u + dy, r + dr, colour);
                            placed++;
                        }
                    }
                }
            }
        }
        return placed;
    }

    /**
     * The server's name, on a panel, as one command.
     *
     * Built from the same font rather than drawn by hand: a hand-drawn
     * wordmark is thirty rows of letters to proofread, and the one I would
     * have got wrong is the one with the server's name in it.
     */
    private void wordmark(Player player, int scale) {
        if (!nexus.blueprints().mayPlace(player)) return;

        Toolkit.Change change = nexus.toolkit().change();
        Facing at = new Facing(player.getWorld(), change, player.getLocation(), 0);

        String written = "NEXUS";

        int wide = PixelFont.widthOf(written) * scale;
        int high = PixelFont.HIGH * scale;

        int padX = 3 * scale;
        int padY = 2 * scale;

        // The panel first, so the letters are written over the top of it.
        for (int u = -padY; u < high + padY; u++) {
            for (int r = -wide / 2 - padX; r < wide / 2 + padX; r++) {
                boolean edge = u < -padY + scale || u >= high + padY - scale
                        || r < -wide / 2 - padX + scale || r >= wide / 2 + padX - scale;

                at.set(AHEAD, u + padY, r, edge
                        ? Material.LIGHT_BLUE_CONCRETE : Material.BLACK_CONCRETE);
            }
        }

        letters(at, written, Material.CYAN_CONCRETE, scale, padY);

        int changed = change.commit(player);

        player.sendMessage(Text.good("NEXUS. " + changed + " blocks."));
        player.sendMessage(Text.plain("  /undo takes it back."));
        player.playSound(player, Sound.ENTITY_PLAYER_LEVELUP, 0.8f, 1.2f);
    }

    /* -------------------------------------------------------------- colours */

    private static final java.util.List<String> COLOUR_NAMES = java.util.List.of(
            "black", "white", "red", "green", "lime", "blue", "lightblue",
            "cyan", "yellow", "orange", "purple", "magenta", "pink", "brown",
            "lightgray", "gray");

    private static Material colourNamed(String name) {
        return switch (name.toLowerCase(java.util.Locale.ROOT)) {
            case "black" -> Material.BLACK_CONCRETE;
            case "white" -> Material.WHITE_CONCRETE;
            case "red" -> Material.RED_CONCRETE;
            case "green" -> Material.GREEN_CONCRETE;
            case "lime" -> Material.LIME_CONCRETE;
            case "blue" -> Material.BLUE_CONCRETE;
            case "lightblue" -> Material.LIGHT_BLUE_CONCRETE;
            case "cyan" -> Material.CYAN_CONCRETE;
            case "yellow" -> Material.YELLOW_CONCRETE;
            case "orange" -> Material.ORANGE_CONCRETE;
            case "purple" -> Material.PURPLE_CONCRETE;
            case "magenta" -> Material.MAGENTA_CONCRETE;
            case "pink" -> Material.PINK_CONCRETE;
            case "brown" -> Material.BROWN_CONCRETE;
            case "lightgray" -> Material.LIGHT_GRAY_CONCRETE;
            case "gray" -> Material.GRAY_CONCRETE;
            default -> null;
        };
    }

    public static java.util.List<String> colourNames() {
        return COLOUR_NAMES;
    }

    public void help(Player player) {
        player.sendMessage(Text.heading("Pixel art"));
        player.sendMessage(Text.plain("  /pixel <name> [scale 1-" + MAX_SCALE + "]"));
        player.sendMessage(Text.plain("  Goes up as a wall in front of you."));
        player.sendMessage(Component.empty());

        player.sendMessage(Component.text("  " + String.join(", ", names()),
                NamedTextColor.AQUA));
        player.sendMessage(Component.empty());

        player.sendMessage(Text.plain("  Built from concrete, which is the only"));
        player.sendMessage(Text.plain("  flat colour set in the game."));
        player.sendMessage(Text.plain("  Works in the lobby with /build, or on your plot."));
        player.sendMessage(Component.empty());

        player.sendMessage(Text.plain("  /pixeltext <colour> <words>   write anything"));
        player.sendMessage(Component.text("  " + String.join(", ", colourNames()),
                NamedTextColor.GOLD));
    }
}
