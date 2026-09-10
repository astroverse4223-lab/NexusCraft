package dev.nexuscraft.nexus;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.Sound;
import org.bukkit.entity.Player;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Structures to start from, placed where you are standing.
 *
 * Every one comes two ways. A frame is the bones - foundation, corner posts,
 * roof line, floor pattern - and leaves the walls and all the detail to you; a
 * full one is finished and meant to be redecorated. Both exist because the two
 * are wanted at different moments: a frame when you know what you want and want
 * the tedious part done, a full one when you want a lobby to look like
 * something this evening.
 *
 * Everything is placed relative to which way you are facing, so a house faces
 * you rather than facing north, and every placement records what it replaced so
 * that {@code /undo} takes it back like any other edit.
 */
public final class Blueprints {

    /** The colours a structure is built in. */
    private record Palette(String name, Material primary, Material secondary,
                           Material pillar, Material roof, Material light, Material glass) { }

    private static final List<Palette> PALETTES = List.of(
            new Palette("stone", Material.STONE_BRICKS, Material.POLISHED_ANDESITE,
                    Material.CHISELED_STONE_BRICKS, Material.DEEPSLATE_TILES,
                    Material.LANTERN, Material.GLASS_PANE),

            new Palette("sand", Material.SMOOTH_SANDSTONE, Material.CUT_SANDSTONE,
                    Material.CHISELED_SANDSTONE, Material.TERRACOTTA,
                    Material.LANTERN, Material.GLASS_PANE),

            new Palette("oak", Material.OAK_PLANKS, Material.STRIPPED_OAK_LOG,
                    Material.OAK_LOG, Material.DARK_OAK_PLANKS,
                    Material.LANTERN, Material.GLASS_PANE),

            new Palette("quartz", Material.SMOOTH_QUARTZ, Material.QUARTZ_BLOCK,
                    Material.QUARTZ_PILLAR, Material.QUARTZ_BRICKS,
                    Material.SEA_LANTERN, Material.GLASS_PANE),

            new Palette("dark", Material.DEEPSLATE_BRICKS, Material.POLISHED_DEEPSLATE,
                    Material.BLACKSTONE, Material.DEEPSLATE_TILES,
                    Material.SOUL_LANTERN, Material.TINTED_GLASS));

    /** What there is to place. */
    private static final List<String> KINDS =
            List.of("tower", "house", "gazebo", "fountain", "arch", "plaza", "arena",
                    "stall", "road", "bridge", "spawnring", "stage",
                    "wall", "stairs", "tunnel", "farm", "dock");

    private final Nexus nexus;

    public Blueprints(Nexus nexus) {
        this.nexus = nexus;
    }

    /* ------------------------------------------------------------- placing */

    public boolean place(Player player, String kind, boolean full, String paletteName) {
        if (!KINDS.contains(kind)) {
            player.sendMessage(Text.bad("No blueprint called '" + kind + "'."));
            player.sendMessage(Text.plain("  " + String.join(", ", KINDS)));
            return false;
        }

        Palette palette = paletteOf(paletteName);
        if (palette == null) {
            player.sendMessage(Text.bad("No palette called '" + paletteName + "'."));
            player.sendMessage(Text.plain("  " + paletteNames()));
            return false;
        }

        if (!mayPlace(player)) return false;

        Toolkit.Change change = nexus.toolkit().change();
        // Ground at -1, so a foundation lands on the floor rather than
        // at shin height and buries whoever placed it.
        Facing cursor = new Facing(player.getWorld(), change, player.getLocation(), -1);

        switch (kind) {
            case "tower" -> tower(cursor, palette, full);
            case "house" -> house(cursor, palette, full);
            case "gazebo" -> gazebo(cursor, palette, full);
            case "fountain" -> fountain(cursor, palette, full);
            case "arch" -> arch(cursor, palette, full);
            case "plaza" -> plaza(cursor, palette, full);
            case "arena" -> arena(cursor, palette, full);
            case "stall" -> stall(cursor, palette, full);
            case "road" -> road(cursor, palette, full);
            case "bridge" -> bridge(cursor, palette, full);
            case "spawnring" -> spawnRing(cursor, palette, full);
            case "stage" -> stage(cursor, palette, full);
            case "wall" -> wall(cursor, palette, full);
            case "stairs" -> stairs(cursor, palette, full);
            case "tunnel" -> tunnel(cursor, palette, full);
            case "farm" -> farm(cursor, palette, full);
            case "dock" -> dock(cursor, palette, full);
            default -> {
                return false;
            }
        }

        int changed = change.commit(player);

        player.sendMessage(Text.good(palette.name() + " " + kind
                + (full ? " placed." : " frame placed.") + " " + changed + " blocks."));
        player.sendMessage(Text.plain("  /undo takes it back."));
        player.playSound(player, Sound.BLOCK_STONE_PLACE, 0.8f, 1.0f);

        return true;
    }

    /**
     * Whether somebody may put a building here.
     *
     * Three different answers because there are three different places: the
     * lobby belongs to whoever is in build mode, a creative plot belongs to
     * whoever owns it, and everywhere else is nobody's to redecorate.
     */
    public boolean mayPlace(Player player) {
        if (nexus.hub().isHub(player)) {
            if (nexus.hub().isBuilding(player.getUniqueId())) return true;

            player.sendMessage(Text.bad("The lobby is locked."));
            player.sendMessage(Text.plain("  /build first."));
            return false;
        }

        if (player.getWorld().getName().equals(Worlds.Place.CREATIVE.world)) {
            if (nexus.plots().mayBuild(player, player.getLocation())) return true;

            player.sendMessage(Text.bad("This is not your plot."));
            player.sendMessage(Text.plain("  /plot auto to be given one."));
            return false;
        }

        if (player.hasPermission("nexus.admin")) return true;

        player.sendMessage(Text.bad("Blueprints are for the lobby and your creative plot."));
        return false;
    }

    private static Palette paletteOf(String name) {
        for (Palette palette : PALETTES) {
            if (palette.name().equalsIgnoreCase(name)) return palette;
        }
        return null;
    }

    private static String paletteNames() {
        List<String> out = new ArrayList<>();
        for (Palette palette : PALETTES) out.add(palette.name());
        return String.join(", ", out);
    }

    public static List<String> kinds() {
        return KINDS;
    }

    public static List<String> palettes() {
        List<String> out = new ArrayList<>();
        for (Palette palette : PALETTES) out.add(palette.name());
        return out;
    }

    /* ------------------------------------------------------------- the six */

    /**
     * A ring to fight the world boss in.
     *
     * Round rather than square, because a square arena has four corners and a
     * Ravager backed into one of them is a boss nobody can get around. The wall
     * is four high on the inside, which a Ravager cannot climb, and the seating
     * outside steps up from it so anybody watching can see over.
     *
     * Four ways in, on the axes, one block wide. Wide enough to run through,
     * narrow enough that the fight stays in the ring.
     *
     * Deliberately plain. It is the shape that matters - somewhere bounded with
     * a floor, a wall and a sight line - and the decorating is better done by
     * somebody standing in it than by arithmetic.
     */
    private void arena(Facing at, Palette palette, boolean full) {
        int floor = 14;
        int wall = 4;

        for (int f = -floor - 6; f <= floor + 6; f++) {
            for (int r = -floor - 6; r <= floor + 6; r++) {
                double away = Math.sqrt(f * f + r * r);

                // The four ways in, on the axes.
                boolean gate = (f == 0 || r == 0) && away > floor - 1 && away < floor + 6.2;

                if (away <= floor - 0.5) {
                    // The fighting floor. A ring of a second colour so the
                    // middle reads as the middle from inside it.
                    if (full || away > floor - 1.5) {
                        at.set(f, 0, r, away < 3 ? palette.secondary() : palette.primary());
                    }
                    continue;
                }

                if (away <= floor + 0.6) {
                    if (gate) continue;

                    for (int u = 1; u <= wall; u++) {
                        at.set(f, u, r, u == wall ? palette.pillar() : palette.primary());
                    }
                    continue;
                }

                /*
                 * The seating: three steps out, three steps up.
                 *
                 * Each ring one higher than the last, so a row behind can see
                 * over the row in front and the whole thing reads as a bowl
                 * rather than a wall with a moat.
                 */
                if (!full) continue;

                // The gates carry on through the seating, or the way out of
                // the ring is a doorway into the back of a grandstand.
                if (gate) continue;

                int step = (int) Math.floor(away - floor - 0.6);
                if (step < 0 || step > 4) continue;

                int height = wall + step;
                at.set(f, height, r, step % 2 == 0 ? palette.primary() : palette.secondary());

                /*
                 * Solid to the ground under every step.
                 *
                 * The seating sits outside the wall, so there is nothing
                 * beneath it - filling only down to the wall's height left
                 * five rings of blocks hanging in the air with a gap under
                 * them.
                 */
                for (int u = height - 1; u >= 1; u--) at.set(f, u, r, palette.primary());
            }
        }

        /*
         * Four braziers on the diagonals, outside the wall.
         *
         * On the diagonals rather than the axes because the axes are the gates,
         * and a lantern on a post in a doorway is the thing everybody walks
         * into on the way in.
         */
        int post = (int) Math.round((floor + 2) / Math.sqrt(2));

        for (int[] corner : new int[][]{{post, post}, {-post, post}, {post, -post}, {-post, -post}}) {
            for (int u = 1; u <= wall + 2; u++) at.set(corner[0], u, corner[1], palette.pillar());
            at.set(corner[0], wall + 3, corner[1], palette.light());
        }
    }

    /**
     * One shop stall, built to sit against the next one.
     *
     * Five wide exactly, because that is the number that matters: place one,
     * walk five blocks sideways, place another, and a market street appears
     * without anybody measuring. The counter is open at the front and the
     * chest sits in the back corner where the shopkeeper would stand.
     */
    private void stall(Facing at, Palette palette, boolean full) {
        int half = 2;
        int deep = 3;

        for (int f = 0; f <= deep; f++) {
            for (int r = -half; r <= half; r++) {
                at.set(f, 0, r, (f + r) % 2 == 0 ? palette.primary() : palette.secondary());
            }
        }

        // The two corner posts and the back wall between them.
        for (int u = 1; u <= 3; u++) {
            at.set(0, u, -half, palette.pillar());
            at.set(0, u, half, palette.pillar());
            at.set(deep, u, -half, palette.pillar());
            at.set(deep, u, half, palette.pillar());

            if (full) {
                for (int r = -half + 1; r <= half - 1; r++) at.set(deep, u, r, palette.primary());
            }
        }

        // The counter: waist height across the front, with the middle left
        // open so somebody can actually get behind it.
        for (int r = -half; r <= half; r++) {
            if (r == 0) continue;
            at.set(0, 1, r, palette.secondary());
        }

        // The awning.
        for (int f = -1; f <= deep; f++) {
            for (int r = -half; r <= half; r++) at.set(f, 4, r, palette.roof());
        }

        if (!full) return;

        at.set(deep - 1, 1, half - 1, Material.CHEST);
        at.set(0, 3, 0, palette.light());
        at.set(deep, 2, 0, palette.glass());
    }

    /**
     * Sixteen blocks of road, running the way you face.
     *
     * Tiles: stand at the end of one and place the next. Roads are the single
     * most tedious thing to build by hand and the thing that makes a handful of
     * separate places read as one world rather than a list of warps.
     */
    private void road(Facing at, Palette palette, boolean full) {
        int length = 16;
        int half = 2;

        for (int f = 0; f < length; f++) {
            for (int r = -half; r <= half; r++) {
                if (Math.abs(r) == half) {
                    at.set(f, 0, r, palette.pillar());
                } else if (full || r == 0) {
                    // The centre line in the second colour, which is what stops
                    // a wide path reading as a floor.
                    at.set(f, 0, r, r == 0 ? palette.secondary() : palette.primary());
                }
            }

            // A lamp every eight, alternating sides so the light overlaps.
            if (f % 8 == 4) {
                int side = (f / 8) % 2 == 0 ? half : -half;

                for (int u = 1; u <= 3; u++) at.set(f, u, side, palette.pillar());
                at.set(f, 4, side, palette.light());
            }
        }
    }

    /**
     * Twenty blocks of bridge, with railings and something holding it up.
     *
     * The supports reach eight down and stop, rather than hunting for ground -
     * a blueprint that dug until it found something would take a canyon with it.
     * Eight is enough to read as a bridge over most things.
     */
    private void bridge(Facing at, Palette palette, boolean full) {
        int length = 20;
        int half = 2;

        for (int f = 0; f < length; f++) {
            for (int r = -half; r <= half; r++) {
                at.set(f, 0, r, Math.abs(r) == half ? palette.pillar() : palette.primary());
            }

            // Railings, with a taller post every fifth block.
            boolean post = f % 5 == 0;

            for (int side : new int[]{-half, half}) {
                at.set(f, 1, side, post ? palette.pillar() : palette.glass());
                if (post) at.set(f, 2, side, palette.pillar());
                if (post && full) at.set(f, 3, side, palette.light());
            }

            if (!full) continue;

            // What holds it up, at each end and the middle.
            if (f == 0 || f == length - 1 || f == length / 2) {
                for (int side : new int[]{-half, half}) {
                    for (int u = -1; u >= -8; u--) at.set(f, u, side, palette.pillar());
                }
            }
        }
    }

    /**
     * A ring of pedestals round a middle: the start of a match.
     *
     * Twelve of them, which is more than any of the games take, so the same
     * ring works for a duel and for a full lobby. The middle is where the loot
     * or the countdown goes.
     */
    private void spawnRing(Facing at, Palette palette, boolean full) {
        int radius = 10;
        int spots = 12;

        // The middle, which is what everybody is looking at.
        for (int f = -3; f <= 3; f++) {
            for (int r = -3; r <= 3; r++) {
                if (Math.sqrt(f * f + r * r) > 3.4) continue;
                at.set(f, 0, r, (f + r) % 2 == 0 ? palette.secondary() : palette.primary());
            }
        }

        /*
         * The ring of floor first, then the pedestals on top of it.
         *
         * The other way round, the floor overwrote the base of every pedestal
         * it passed through - which is most of them, since they stand on it.
         */
        if (full) {
            for (int f = -radius - 1; f <= radius + 1; f++) {
                for (int r = -radius - 1; r <= radius + 1; r++) {
                    double away = Math.sqrt(f * f + r * r);
                    if (away < radius - 1.4 || away > radius + 1.4) continue;

                    at.set(f, 0, r, palette.primary());
                }
            }
        }

        for (int i = 0; i < spots; i++) {
            double angle = 2 * Math.PI * i / spots;

            int f = (int) Math.round(Math.cos(angle) * radius);
            int r = (int) Math.round(Math.sin(angle) * radius);

            // Two high, so stepping off is a deliberate act and the countdown
            // has somewhere to hold people.
            at.set(f, 0, r, palette.pillar());
            at.set(f, 1, r, palette.primary());
            at.set(f, 2, r, palette.secondary());

            if (full) at.set(f, 3, r, palette.glass());
        }
    }

    /**
     * Somewhere for something to happen in front of people.
     *
     * The events and chat games already exist and happen entirely in the chat
     * box, which means they happen nowhere. A stage is the cheapest way to give
     * them a place, and a place is what makes people gather rather than read.
     */
    private void stage(Facing at, Palette palette, boolean full) {
        int half = 5;
        int deep = 7;
        int high = 2;

        // The platform, solid to the ground so it is a stage and not a table.
        for (int f = 0; f <= deep; f++) {
            for (int r = -half; r <= half; r++) {
                for (int u = 0; u <= high; u++) {
                    boolean top = u == high;
                    if (!top && !full) continue;

                    at.set(f, u, r, top
                            ? ((f + r) % 2 == 0 ? palette.primary() : palette.secondary())
                            : palette.primary());
                }
            }
        }

        // Steps up the front, in the middle, so there is a way on.
        for (int r = -1; r <= 1; r++) {
            at.set(-1, 0, r, palette.primary());
            at.set(-1, 1, r, palette.secondary());
        }

        // The backdrop, which is what makes anybody on it visible.
        for (int r = -half; r <= half; r++) {
            for (int u = high + 1; u <= high + 5; u++) {
                boolean edge = Math.abs(r) == half;

                if (edge) at.set(deep, u, r, palette.pillar());
                else if (full) at.set(deep, u, r, u == high + 5 ? palette.roof() : palette.primary());
            }
        }

        if (!full) return;

        // Footlights along the front lip, and a lamp each side of the backdrop.
        for (int r = -half + 1; r <= half - 1; r += 2) at.set(0, high + 1, r, palette.light());

        for (int side : new int[]{-half, half}) {
            at.set(deep, high + 6, side, palette.light());
        }
    }

    /**
     * Sixteen blocks of curtain wall, with a walkway on top.
     *
     * Tiles the way the road does. Three thick so the top is somewhere to
     * stand rather than a line to balance along, and the battlements only on
     * the outward side - a wall crenellated on both faces is a fence.
     */
    private void wall(Facing at, Palette palette, boolean full) {
        int length = 16;
        int high = 5;

        for (int f = 0; f < length; f++) {
            boolean post = f % 8 == 0;

            for (int r = -1; r <= 1; r++) {
                if (full || Math.abs(r) == 1 || post) {
                    for (int u = 1; u < high; u++) {
                        at.set(f, u, r, post ? palette.pillar() : palette.primary());
                    }
                }

                // The walkway, which both versions get - it is the point of it.
                at.set(f, high, r, palette.secondary());
            }

            // Battlements on the outward side, every other block.
            if (f % 2 == 0) at.set(f, high + 1, 1, palette.pillar());

            if (post && full) {
                at.set(f, high + 1, -1, palette.pillar());
                at.set(f, high + 2, -1, palette.light());
            }
        }
    }

    /**
     * A staircase that climbs as it goes: seven up over sixteen forward.
     *
     * One up every two along, which is walkable without jumping. Solid beneath
     * each step rather than floating, because a staircase with nothing under it
     * is a set of shelves.
     */
    private void stairs(Facing at, Palette palette, boolean full) {
        int length = 16;
        int half = 2;

        for (int f = 0; f < length; f++) {
            int height = f / 2;

            for (int r = -half; r <= half; r++) {
                boolean edge = Math.abs(r) == half;

                at.set(f, height, r, edge ? palette.pillar() : palette.primary());

                // Filled down to where it started, so it is a ramp of stone
                // and not a flight of floating slabs.
                if (full) {
                    for (int u = height - 1; u >= 0; u--) at.set(f, u, r, palette.primary());
                }
            }

            // A railing that climbs with it.
            if (f % 4 == 0) {
                for (int side : new int[]{-half, half}) {
                    at.set(f, height + 1, side, palette.pillar());
                    if (full) at.set(f, height + 2, side, palette.light());
                }
            }
        }
    }

    /**
     * Twenty-four blocks of tunnel, bored the way you face.
     *
     * The only blueprint here that takes more away than it puts down: it hollows
     * out five by five and then lines what is left. Going through a hill by hand
     * is the most tedious digging there is, and a lined tunnel is the difference
     * between a road that stops at a cliff and one that does not.
     */
    private void tunnel(Facing at, Palette palette, boolean full) {
        int length = 24;
        int half = 2;
        int high = 4;

        for (int f = 0; f < length; f++) {
            for (int r = -half; r <= half; r++) {
                for (int u = 0; u <= high; u++) {
                    boolean side = Math.abs(r) == half;
                    boolean floor = u == 0;
                    boolean roof = u == high;

                    if (side || floor || roof) {
                        // The lining, which is what stops it caving in on the eye.
                        if (full || floor || side) {
                            at.set(f, u, r, floor ? palette.primary() : palette.pillar());
                        }
                    } else {
                        // The hole itself.
                        at.set(f, u, r, Material.AIR);
                    }
                }
            }

            // Lanterns down one side, every six, so it is lit without being lit
            // from everywhere.
            if (f % 6 == 3) at.set(f, high - 1, half - 1, palette.light());
        }
    }

    /**
     * A nine by nine field, tilled, watered and fenced.
     *
     * One channel down the middle, which is all a seven-wide field needs:
     * water reaches four blocks, and the furthest soil here is three. Getting
     * that spacing wrong by hand is how people end up with a field where half
     * the crops never grow and nothing says why.
     */
    private void farm(Facing at, Palette palette, boolean full) {
        int half = 4;

        for (int f = -half; f <= half; f++) {
            for (int r = -half; r <= half; r++) {
                boolean edge = Math.abs(f) == half || Math.abs(r) == half;

                if (edge) {
                    at.set(f, 0, r, palette.primary());
                    // A way in on one side, rather than a sealed box.
                    if (!(f == -half && r == 0)) at.set(f, 1, r, Material.OAK_FENCE);
                    continue;
                }

                if (!full) continue;

                // Water every fourth row, soil either side of it.
                if (Math.floorMod(r + half, 4) == 0) {
                    at.set(f, 0, r, Material.WATER);
                } else {
                    at.set(f, 0, r, Material.FARMLAND);
                }

                at.set(f, -1, r, Material.DIRT);
            }
        }

        if (full) at.set(-half, 2, 0, palette.light());
    }

    /**
     * A pier, sixteen out over the water.
     *
     * Posts every four reaching six down, which is deeper than most water and
     * shallower than a blueprint that would follow a lake to the bottom.
     */
    private void dock(Facing at, Palette palette, boolean full) {
        int length = 16;
        int half = 2;

        for (int f = 0; f < length; f++) {
            for (int r = -half; r <= half; r++) {
                at.set(f, 0, r, Math.abs(r) == half ? palette.pillar() : palette.primary());
            }

            if (f % 4 == 0) {
                for (int side : new int[]{-half, half}) {
                    // Down into the water, and a bollard above the deck.
                    for (int u = -1; u >= -6; u--) at.set(f, u, side, palette.pillar());
                    at.set(f, 1, side, palette.pillar());

                    if (full && f % 8 == 0) at.set(f, 2, side, palette.light());
                }
            }
        }
    }

    /** Nine across, eighteen up, battlements on top. */
    private void tower(Facing at, Palette palette, boolean full) {
        int half = 4;
        int high = 18;

        for (int f = -half; f <= half; f++) {
            for (int r = -half; r <= half; r++) {
                boolean edge = Math.abs(f) == half || Math.abs(r) == half;
                boolean corner = Math.abs(f) == half && Math.abs(r) == half;

                // The floor, which both versions get - it is what you stand on
                // to build the rest.
                at.set(f, 0, r, edge ? palette.pillar() : palette.secondary());

                if (corner) {
                    for (int u = 1; u <= high; u++) at.set(f, u, r, palette.pillar());
                    continue;
                }

                if (!full) continue;

                if (edge) {
                    for (int u = 1; u < high; u++) {
                        // A window every third block on the middle band, so it
                        // is not a chimney.
                        boolean window = u % 6 == 3 && (Math.abs(f) < 3 && Math.abs(r) < 3
                                || Math.abs(f) == half || Math.abs(r) == half);

                        at.set(f, u, r, window ? palette.glass() : palette.primary());
                    }
                }
            }
        }

        // The battlement, on both, because it is the shape that says tower.
        for (int f = -half; f <= half; f++) {
            for (int r = -half; r <= half; r++) {
                if (Math.abs(f) != half && Math.abs(r) != half) continue;

                at.set(f, high, r, palette.primary());
                if ((f + r) % 2 == 0) at.set(f, high + 1, r, palette.pillar());
            }
        }

        if (!full) return;

        // Floors and lights inside, which is what makes it usable rather than
        // a decorated pipe.
        for (int u : new int[]{6, 12}) {
            for (int f = -half + 1; f < half; f++) {
                for (int r = -half + 1; r < half; r++) at.set(f, u, r, palette.secondary());
            }
        }

        at.set(-half + 1, 3, -half + 1, palette.light());
        at.set(half - 1, 9, half - 1, palette.light());
        at.set(-half + 1, 15, half - 1, palette.light());
    }

    /** Eleven by nine, walls five high, a gable roof over it. */
    private void house(Facing at, Palette palette, boolean full) {
        int halfR = 5;
        int deep = 8;
        int wall = 5;

        for (int f = 0; f <= deep; f++) {
            for (int r = -halfR; r <= halfR; r++) {
                boolean edge = f == 0 || f == deep || Math.abs(r) == halfR;
                boolean corner = (f == 0 || f == deep) && Math.abs(r) == halfR;

                at.set(f, 0, r, edge ? palette.pillar() : palette.secondary());

                if (corner) {
                    for (int u = 1; u <= wall; u++) at.set(f, u, r, palette.pillar());
                    continue;
                }

                if (full && edge) {
                    for (int u = 1; u < wall; u++) {
                        boolean door = f == 0 && Math.abs(r) <= 1 && u <= 2;
                        boolean window = u == 2 && Math.abs(r) % 3 == 1 && !door;

                        if (door) at.set(f, u, r, Material.AIR);
                        else at.set(f, u, r, window ? palette.glass() : palette.primary());
                    }
                }
            }
        }

        // The plate the roof sits on, on both versions - it is the line that
        // tells you how tall the walls are meant to be.
        for (int f = 0; f <= deep; f++) {
            for (int r = -halfR; r <= halfR; r++) {
                if (f != 0 && f != deep && Math.abs(r) != halfR) continue;
                at.set(f, wall, r, palette.secondary());
            }
        }

        /*
         * The gable, raised a step for every block in from the eaves.
         *
         * Drawn as two slopes meeting at a ridge. The frame gets only the
         * outline - the two end triangles and the ridge - which is exactly the
         * hard part to judge by eye and the reason a roof frame is worth
         * having at all.
         */
        for (int r = -halfR; r <= halfR; r++) {
            int rise = wall + 1 + (halfR - Math.abs(r));

            for (int f = 0; f <= deep; f++) {
                boolean end = f == 0 || f == deep;

                if (full || end || Math.abs(r) == halfR) {
                    at.set(f, rise, r, palette.roof());
                }

                // Under the slope, filled in on the ends so the gable is solid.
                if (full && end) {
                    for (int u = wall + 1; u < rise; u++) at.set(f, u, r, palette.primary());
                }
            }
        }

        for (int f = 0; f <= deep; f++) at.set(f, wall + 1 + halfR, 0, palette.roof());

        if (!full) return;

        at.set(2, 3, -halfR + 1, palette.light());
        at.set(deep - 2, 3, halfR - 1, palette.light());
    }

    /** Nine by nine, four posts, a roof and nothing else. */
    private void gazebo(Facing at, Palette palette, boolean full) {
        int half = 4;
        int post = 5;

        for (int f = -half; f <= half; f++) {
            for (int r = -half; r <= half; r++) {
                boolean edge = Math.abs(f) == half || Math.abs(r) == half;
                at.set(f, 0, r, edge ? palette.pillar() : palette.secondary());
            }
        }

        for (int f : new int[]{-half, half}) {
            for (int r : new int[]{-half, half}) {
                for (int u = 1; u <= post; u++) at.set(f, u, r, palette.pillar());
            }
        }

        // A pyramid roof, stepped in a ring at a time.
        for (int step = 0; step <= half; step++) {
            int reach = half - step;

            for (int f = -reach; f <= reach; f++) {
                for (int r = -reach; r <= reach; r++) {
                    boolean ring = Math.abs(f) == reach || Math.abs(r) == reach;
                    if (!ring && !full) continue;

                    at.set(f, post + 1 + step, r, palette.roof());
                }
            }
        }

        if (!full) return;

        at.set(-half + 1, post - 1, -half + 1, palette.light());
        at.set(half - 1, post - 1, half - 1, palette.light());
    }

    /** A round basin eleven across, water in it. */
    private void fountain(Facing at, Palette palette, boolean full) {
        int radius = 5;

        for (int f = -radius; f <= radius; f++) {
            for (int r = -radius; r <= radius; r++) {
                int away = f * f + r * r;
                if (away > radius * radius) continue;

                boolean rim = away > (radius - 1) * (radius - 1);

                at.set(f, 0, r, rim ? palette.pillar() : palette.secondary());
                if (rim) at.set(f, 1, r, palette.primary());
                else if (full) at.set(f, 1, r, Material.WATER);
            }
        }

        // The middle, which is the whole point of a fountain.
        for (int u = 1; u <= 3; u++) at.set(0, u, 0, palette.pillar());
        if (full) at.set(0, 4, 0, Material.WATER);

        if (!full) return;

        for (int[] corner : new int[][]{{-4, -4}, {4, 4}, {-4, 4}, {4, -4}}) {
            at.set(corner[0], 1, corner[1], palette.light());
        }
    }

    /** A gateway you walk under. */
    private void arch(Facing at, Palette palette, boolean full) {
        int halfR = 5;
        int high = 9;

        // The two piers.
        for (int r : new int[]{-halfR, halfR}) {
            for (int u = 0; u <= high - 3; u++) {
                for (int f = -1; f <= 1; f++) {
                    boolean edge = Math.abs(f) == 1;
                    if (!full && !edge && u != 0) continue;

                    at.set(f, u, r, edge ? palette.pillar() : palette.primary());
                }
            }
        }

        /*
         * The curve, as a circle cut off at the springing line.
         *
         * Worked out rather than stepped by hand because an arch that is not
         * symmetrical is obvious from across the lobby, and this way the two
         * halves cannot disagree.
         */
        for (int r = -halfR; r <= halfR; r++) {
            int rise = (int) Math.round(Math.sqrt(halfR * halfR - r * r));
            int u = high - 3 + (halfR - rise);

            for (int f = -1; f <= 1; f++) {
                if (!full && Math.abs(f) != 1) continue;
                at.set(f, u, r, palette.primary());
            }
        }

        at.set(0, high + 2, 0, palette.pillar());

        if (!full) return;

        at.set(-1, high - 4, -halfR + 1, palette.light());
        at.set(-1, high - 4, halfR - 1, palette.light());
    }

    /** Fifteen square of patterned floor, lamps at the corners. */
    private void plaza(Facing at, Palette palette, boolean full) {
        int half = 7;

        for (int f = -half; f <= half; f++) {
            for (int r = -half; r <= half; r++) {
                boolean border = Math.abs(f) == half || Math.abs(r) == half;
                boolean cross = f == 0 || r == 0;

                if (border) {
                    at.set(f, 0, r, palette.pillar());
                } else if (cross) {
                    at.set(f, 0, r, palette.primary());
                } else if (full) {
                    at.set(f, 0, r, (f + r) % 2 == 0 ? palette.secondary() : palette.primary());
                }
            }
        }

        // Lamp posts at the corners, on both, because they are what makes a
        // square of floor read as a plaza.
        for (int[] corner : new int[][]{{-half, -half}, {half, half}, {-half, half}, {half, -half}}) {
            for (int u = 1; u <= 3; u++) at.set(corner[0], u, corner[1], palette.pillar());
            at.set(corner[0], 4, corner[1], palette.light());
        }
    }

    /* --------------------------------------------------------------- help */

    public void help(Player player) {
        player.sendMessage(Text.heading("Blueprints"));
        player.sendMessage(Text.plain("  /blueprint <kind> [frame|full] [palette]"));
        player.sendMessage(Text.plain("  Placed in front of you, facing you."));
        player.sendMessage(Component.empty());

        player.sendMessage(Component.text("  " + String.join(", ", KINDS), NamedTextColor.AQUA));
        player.sendMessage(Component.text("  " + paletteNames(), NamedTextColor.GOLD));
        player.sendMessage(Component.empty());

        player.sendMessage(Text.plain("  frame   bones only: floor, posts, roof line"));
        player.sendMessage(Text.plain("  full    finished, for redecorating"));
        player.sendMessage(Text.plain("  /undo takes back the last one."));
        player.sendMessage(Text.plain("  Works in the lobby with /build, or on your plot."));
    }
}
