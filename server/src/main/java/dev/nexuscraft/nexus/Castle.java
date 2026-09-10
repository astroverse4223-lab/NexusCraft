package dev.nexuscraft.nexus;

import org.bukkit.Axis;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.block.BlockFace;
import org.bukkit.block.data.BlockData;
import org.bukkit.block.data.Orientable;
import org.bukkit.block.data.type.Slab;
import org.bukkit.block.data.type.Stairs;

/**
 * The spawn castle.
 *
 * The first version was, accurately, "a simple castle, all the same block, and
 * repetitive". Two things were wrong with it and they are the two things that
 * make any large Minecraft build look flat.
 *
 * The first is material. It rolled between three shades of stone brick, which
 * at any distance averages back into one grey. Fixed by {@link Palette}: the
 * stone changes with *height* — a dark plinth, lighter walls, a band at each
 * floor line, a darker parapet — so the eye reads horizontal courses as
 * construction instead of pattern.
 *
 * The second is that nothing broke the surfaces up or occupied the space.
 * Sixty blocks of unbroken wall is a wall however it is textured, so there are
 * now buttresses, string courses, timber hoardings and arrow loops on it; and a
 * courtyard you can cross in four seconds with nothing in it is a car park, so
 * there is a market, a well, a smithy and a garden in it, and the keep has an
 * inside.
 */
public final class Castle {

    /**
     * Bumped whenever this file changes the build.
     *
     * The server compares it against what it last put down and replaces
     * anything older, so an upgrade shows the new lobby without anybody having
     * to delete a world folder.
     */
    public static final int VERSION = 3;

    /** Courtyard level. Everything is measured from here. */
    public static final int GROUND = 64;

    /** Half-width of the curtain wall. The castle is 120 blocks across. */
    private static final int WALL = 56;
    private static final int WALL_TOP = GROUND + 16;
    private static final int WALL_THICK = 4;

    /** Corner towers. */
    private static final int TOWER_R = 9;
    private static final int TOWER_TOP = GROUND + 29;

    /** The keep in the middle. */
    private static final int KEEP = 15;
    private static final int KEEP_TOP = GROUND + 42;

    /** The moat sits outside the wall, with a bridge on the south side. */
    private static final int MOAT_IN = WALL + 6;
    private static final int MOAT_OUT = WALL + 18;

    /** Where the gate is, and how wide the road through it is. */
    private static final int GATE_HALF = 4;

    private final World world;
    private final Palette palette = new Palette(20240907L);

    public Castle(World world) {
        this.world = world;
    }

    /** Where players land: on the bridge, looking up at the gate. */
    public static org.bukkit.Location arrival(World world) {
        return new org.bukkit.Location(world, 0.5, GROUND + 1, MOAT_OUT - 2.5, 180f, 5f);
    }

    /** In the courtyard, in a row facing the gate, in front of the keep. */
    public static org.bukkit.Location greeterSpot(World world, int index, int total) {
        double x = (index - (total - 1) / 2.0) * 9.0;

        org.bukkit.Location at = new org.bukkit.Location(world, x + 0.5, GROUND + 1, KEEP + 9.5);
        at.setYaw(0f);
        at.setPitch(0f);
        return at;
    }

    /** Wipes whatever lobby was here before, so nothing old is left floating. */
    public void clearOldLobby() {
        for (int x = -MOAT_OUT - 10; x <= MOAT_OUT + 10; x++) {
            for (int z = -MOAT_OUT - 10; z <= MOAT_OUT + 10; z++) {
                for (int y = GROUND - 10; y <= KEEP_TOP + 24; y++) {
                    Block block = world.getBlockAt(x, y, z);
                    if (block.getType() != Material.AIR) block.setType(Material.AIR, false);
                }
            }
        }
    }

    /* --------------------------------------------------------------- build */

    public void build() {
        island();
        moat();
        bridge();

        curtainWall();
        for (int sx = -1; sx <= 1; sx += 2) {
            for (int sz = -1; sz <= 1; sz += 2) tower(sx * WALL, sz * WALL, TOWER_R, TOWER_TOP);
        }

        gatehouse();
        keep();
        courtyard();
    }

    /**
     * The ground, which is not one block either.
     *
     * Grass with coarse dirt and moss coming through it, and long grass and
     * flowers on top. A flat green sheet outside the walls undoes the stonework
     * on its own.
     */
    private void island() {
        for (int x = -MOAT_OUT - 8; x <= MOAT_OUT + 8; x++) {
            for (int z = -MOAT_OUT - 8; z <= MOAT_OUT + 8; z++) {
                if (Math.max(Math.abs(x), Math.abs(z)) > MOAT_OUT + 8) continue;

                set(x, GROUND, z, palette.ground());
                set(x, GROUND - 1, z, Material.DIRT);
                for (int y = GROUND - 6; y <= GROUND - 2; y++) set(x, y, z, Material.STONE);
                set(x, GROUND - 7, z, Material.DEEPSLATE);

                // Only outside the walls, where it will actually be seen.
                if (Math.max(Math.abs(x), Math.abs(z)) > MOAT_OUT
                        && world.getBlockAt(x, GROUND, z).getType() == Material.GRASS_BLOCK
                        && palette.sometimes(4)) {
                    set(x, GROUND + 1, z, palette.flower());
                }
            }
        }

        for (int[] spot : new int[][]{{-80, -70}, {74, -78}, {-72, 76}, {80, 68},
                                      {-84, 10}, {84, -14}, {12, -84}, {-20, 84}}) {
            tree(spot[0], spot[1], palette.between(5, 8));
        }
    }

    private void moat() {
        for (int x = -MOAT_OUT; x <= MOAT_OUT; x++) {
            for (int z = -MOAT_OUT; z <= MOAT_OUT; z++) {
                int ring = Math.max(Math.abs(x), Math.abs(z));
                if (ring < MOAT_IN || ring > MOAT_OUT) continue;

                for (int y = GROUND - 5; y <= GROUND; y++) {
                    set(x, y, z, y == GROUND - 5 ? Material.GRAVEL : Material.WATER);
                }

                if (ring == MOAT_IN || ring == MOAT_OUT) {
                    set(x, GROUND, z, palette.plinth());
                    // A kerb, broken up so it is not a perfect line.
                    if (palette.sometimes(3)) set(x, GROUND + 1, z, Material.COBBLESTONE_WALL);
                }
            }
        }
    }

    private void bridge() {
        for (int z = MOAT_IN - 1; z <= MOAT_OUT + 1; z++) {
            for (int x = -GATE_HALF; x <= GATE_HALF; x++) {
                // Timber deck over the last stretch, like a drawbridge.
                boolean deck = z < MOAT_IN + 4;
                set(x, GROUND, z, deck ? palette.planks() : palette.paving());

                if (Math.abs(x) == GATE_HALF) {
                    set(x, GROUND + 1, z, Material.COBBLESTONE_WALL);
                    if ((z & 3) == 0) {
                        set(x, GROUND + 2, z, palette.plinth());
                        set(x, GROUND + 3, z, Material.LANTERN);
                    }
                }
            }

            if ((z & 3) == 0 && z > MOAT_IN && z < MOAT_OUT) {
                for (int y = GROUND - 4; y < GROUND; y++) {
                    set(-GATE_HALF, y, z, palette.plinth());
                    set(GATE_HALF, y, z, palette.plinth());
                }
            }
        }
    }

    /* ---------------------------------------------------------- the walls */

    /**
     * Which stone belongs at a given height on a wall.
     *
     * This one method is most of the difference between the old castle and this
     * one. Everything vertical asks it rather than picking its own stone, so
     * every wall in the castle shares the same courses and the whole thing
     * looks like one building.
     */
    private Material courseAt(int y, int top) {
        int up = y - GROUND;
        int height = top - GROUND;

        if (up <= 2) return palette.plinth();
        if (up == 3) return palette.band();
        if (up >= height - 2) return palette.upper();
        if (up == height - 3) return palette.band();
        if (up > height * 0.6) return palette.upper();
        return palette.wall();
    }

    private void curtainWall() {
        for (int x = -WALL; x <= WALL; x++) {
            for (int z = -WALL; z <= WALL; z++) {
                int ring = Math.max(Math.abs(x), Math.abs(z));
                if (ring < WALL - WALL_THICK + 1 || ring > WALL) continue;

                for (int y = GROUND - 4; y <= WALL_TOP; y++) {
                    set(x, y, z, y < GROUND ? palette.plinth() : courseAt(y, WALL_TOP));
                }
            }
        }

        buttresses();
        hoardings();
        walkwayAndBattlements();
        arrowLoops();
    }

    /**
     * Piers standing proud of the wall, every twelve blocks.
     *
     * The single cheapest way to stop a long wall reading as a slab: the
     * shadows they cast break the face into bays, so you see a rhythm instead
     * of one surface.
     */
    private void buttresses() {
        for (int along = -WALL + 8; along <= WALL - 8; along += 12) {
            for (int side = -1; side <= 1; side += 2) {
                buttress(along, side * (WALL + 1), true);
                buttress(side * (WALL + 1), along, false);
            }
        }
    }

    private void buttress(int x, int z, boolean alongX) {
        for (int y = GROUND - 4; y <= WALL_TOP - 3; y++) {
            for (int w = -1; w <= 1; w++) {
                int bx = alongX ? x + w : x;
                int bz = alongX ? z : z + w;
                set(bx, y, bz, y < GROUND ? palette.plinth() : courseAt(y, WALL_TOP));
            }
        }

        // A sloped weathering on top, so rain runs off it rather than it just
        // stopping in mid air.
        for (int w = -1; w <= 1; w++) {
            int bx = alongX ? x + w : x;
            int bz = alongX ? z : z + w;
            slab(bx, WALL_TOP - 2, bz, Material.STONE_BRICK_SLAB, false);
        }
    }

    /**
     * Timber galleries hung off the outside of the wall.
     *
     * Real castles bolted wooden hoardings onto the parapet in wartime. They
     * are worth having here for a duller reason: a band of dark timber halfway
     * up sixty blocks of grey does more for the silhouette than any amount of
     * stone detailing.
     */
    private void hoardings() {
        for (int along = -WALL + 14; along <= WALL - 14; along += 24) {
            for (int side = -1; side <= 1; side += 2) {
                hoarding(along, side * WALL, true);
                hoarding(side * WALL, along, false);
            }
        }
    }

    private void hoarding(int x, int z, boolean alongX) {
        int out = (alongX ? z : x) > 0 ? 1 : -1;

        for (int w = -3; w <= 3; w++) {
            int bx = alongX ? x + w : x + out;
            int bz = alongX ? z + out : z + w;

            set(bx, WALL_TOP - 4, bz, palette.planks());
            set(bx, WALL_TOP - 3, bz, Math.abs(w) == 3 ? palette.timber() : Material.AIR);
            set(bx, WALL_TOP - 2, bz, Math.abs(w) == 3 ? palette.timber() : palette.planks());

            // Brackets underneath, so it is held up by something.
            if (Math.abs(w) % 3 == 0) {
                int sx = alongX ? bx : x + out;
                int sz = alongX ? z + out : bz;
                set(sx, WALL_TOP - 5, sz, palette.timber());
            }
        }
    }

    private void walkwayAndBattlements() {
        for (int x = -WALL; x <= WALL; x++) {
            for (int z = -WALL; z <= WALL; z++) {
                int ring = Math.max(Math.abs(x), Math.abs(z));
                if (ring < WALL - WALL_THICK + 1 || ring > WALL) continue;

                boolean outerEdge = ring == WALL;
                boolean innerEdge = ring == WALL - WALL_THICK + 1;

                if (outerEdge || innerEdge) {
                    boolean merlon = (((Math.abs(x) + Math.abs(z)) >> 1) & 1) == 0;
                    if (merlon) {
                        set(x, WALL_TOP + 1, z, palette.parapet());
                        set(x, WALL_TOP + 2, z, palette.parapet());
                        slab(x, WALL_TOP + 3, z, Material.DEEPSLATE_TILE_SLAB, false);
                    } else if (outerEdge) {
                        set(x, WALL_TOP + 1, z, Material.DEEPSLATE_BRICK_WALL);
                    }
                } else {
                    set(x, WALL_TOP, z, palette.paving());

                    if ((Math.abs(x) % 14 == 0 && Math.abs(z) == WALL - 1)
                            || (Math.abs(z) % 14 == 0 && Math.abs(x) == WALL - 1)) {
                        set(x, WALL_TOP + 1, z, Material.LANTERN);
                    }
                }
            }
        }
    }

    /** Slits through the outer face, with a stone surround so they read. */
    private void arrowLoops() {
        for (int along = -WALL + 12; along <= WALL - 12; along += 8) {
            for (int y = GROUND + 8; y <= GROUND + 10; y++) {
                for (int side = -1; side <= 1; side += 2) {
                    set(along, y, side * WALL, Material.AIR);
                    set(side * WALL, y, along, Material.AIR);
                }
            }
            for (int side = -1; side <= 1; side += 2) {
                set(along, GROUND + 11, side * WALL, Material.CHISELED_STONE_BRICKS);
                set(side * WALL, GROUND + 11, along, Material.CHISELED_STONE_BRICKS);
            }
        }
    }

    /* -------------------------------------------------------------- towers */

    private void tower(int cx, int cz, int radius, int top) {
        for (int x = -radius; x <= radius; x++) {
            for (int z = -radius; z <= radius; z++) {
                int distance = x * x + z * z;
                if (distance > radius * radius) continue;

                boolean shell = distance > (radius - 2) * (radius - 2);

                for (int y = GROUND - 4; y <= top; y++) {
                    if (shell) {
                        set(cx + x, y, cz + z, y < GROUND ? palette.plinth() : courseAt(y, top));
                    } else if (y < GROUND || y == GROUND || y == WALL_TOP) {
                        set(cx + x, y, cz + z, y == WALL_TOP ? palette.planks() : palette.paving());
                    } else {
                        set(cx + x, y, cz + z, Material.AIR);
                    }
                }

                if (shell) {
                    boolean merlon = (((Math.abs(x) + Math.abs(z)) >> 1) & 1) == 0;
                    set(cx + x, top + 1, cz + z,
                            merlon ? palette.parapet() : Material.DEEPSLATE_BRICK_WALL);
                    if (merlon) slab(cx + x, top + 2, cz + z, Material.DEEPSLATE_TILE_SLAB, false);
                }
            }
        }

        spire(cx, cz, radius, top + 3);
        towerWindows(cx, cz, radius, top);
    }

    /**
     * A conical roof made of stairs.
     *
     * The old one was flat discs of planks stacked into a wedding cake. Stairs
     * laid facing inward on each ring give an actual slope, which is the
     * difference between a roof and a pile.
     */
    private void spire(int cx, int cz, int radius, int base) {
        for (int step = 0; step <= radius; step++) {
            int r = radius - step;
            int y = base + step;

            for (int x = -r; x <= r; x++) {
                for (int z = -r; z <= r; z++) {
                    int distance = x * x + z * z;
                    if (distance > r * r) continue;

                    if (distance > (r - 1) * (r - 1)) {
                        stairs(cx + x, y, cz + z, roofStair(), towards(x, z), false);
                    } else {
                        set(cx + x, y, cz + z, palette.roof());
                    }
                }
            }
        }

        set(cx, base + radius + 1, cz, Material.DEEPSLATE_BRICK_WALL);
        set(cx, base + radius + 2, cz, Material.LANTERN);
    }

    private void towerWindows(int cx, int cz, int radius, int top) {
        for (int y = GROUND + 6; y < top - 3; y += 6) {
            for (int[] side : new int[][]{{-radius, 0}, {radius, 0}, {0, -radius}, {0, radius}}) {
                int wx = cx + side[0];
                int wz = cz + side[1];

                set(wx, y, wz, Material.STONE_BRICK_WALL);
                set(wx, y + 1, wz, Material.LIGHT_BLUE_STAINED_GLASS_PANE);
                set(wx, y + 2, wz, Material.CHISELED_STONE_BRICKS);
            }
            set(cx, y + 1, cz, Material.SEA_LANTERN);
        }
    }

    /* -------------------------------------------------------------- the gate */

    private void gatehouse() {
        for (int z = WALL - WALL_THICK; z <= WALL; z++) {
            for (int x = -GATE_HALF; x <= GATE_HALF; x++) {
                for (int y = GROUND + 1; y <= GROUND + 7; y++) {
                    int fromEdge = GATE_HALF - Math.abs(x);
                    if (y >= GROUND + 6 && fromEdge < (y - GROUND - 5)) continue;
                    set(x, y, z, Material.AIR);
                }
                set(x, GROUND, z, palette.paving());
            }

            // Ribs across the ceiling of the tunnel, which is otherwise a
            // corridor of flat stone.
            if ((z & 1) == 0) {
                for (int x = -GATE_HALF + 1; x <= GATE_HALF - 1; x++) {
                    set(x, GROUND + 7, z, palette.timber());
                }
            }
        }

        for (int x = -GATE_HALF + 1; x <= GATE_HALF - 1; x++) {
            for (int y = GROUND + 5; y <= GROUND + 7; y++) set(x, y, WALL - 1, Material.IRON_BARS);
        }

        tower(-GATE_HALF - 8, WALL, 7, TOWER_TOP + 3);
        tower(GATE_HALF + 8, WALL, 7, TOWER_TOP + 3);

        // Banners and braziers on the gate face.
        for (int x : new int[]{-GATE_HALF - 1, GATE_HALF + 1}) {
            for (int y = GROUND + 2; y <= GROUND + 6; y++) set(x, y, WALL, Material.BLUE_WOOL);
            set(x, GROUND + 7, WALL, Material.GOLD_BLOCK);

            set(x, GROUND + 1, WALL + 1, Material.COBBLESTONE_WALL);
            set(x, GROUND + 2, WALL + 1, Material.CAMPFIRE);
        }
    }

    /* --------------------------------------------------------------- the keep */

    private void keep() {
        for (int x = -KEEP; x <= KEEP; x++) {
            for (int z = -KEEP; z <= KEEP; z++) {
                int ring = Math.max(Math.abs(x), Math.abs(z));
                if (ring > KEEP) continue;

                boolean shell = ring == KEEP;

                for (int y = GROUND - 4; y <= KEEP_TOP; y++) {
                    if (shell) {
                        set(x, y, z, y < GROUND ? palette.plinth() : courseAt(y, KEEP_TOP));
                    } else if (y == GROUND) {
                        set(x, y, z, palette.paving());
                    } else if (y == GROUND + 14 || y == GROUND + 28) {
                        set(x, y, z, palette.planks());
                    } else if (y < GROUND) {
                        set(x, y, z, palette.plinth());
                    } else {
                        set(x, y, z, Material.AIR);
                    }
                }

                if (shell) {
                    boolean merlon = (((Math.abs(x) + Math.abs(z)) >> 1) & 1) == 0;
                    set(x, KEEP_TOP + 1, z, merlon ? palette.parapet() : Material.DEEPSLATE_BRICK_WALL);
                    if (merlon) slab(x, KEEP_TOP + 2, z, Material.DEEPSLATE_TILE_SLAB, false);
                }
            }
        }

        for (int sx = -1; sx <= 1; sx += 2) {
            for (int sz = -1; sz <= 1; sz += 2) {
                tower(sx * KEEP, sz * KEEP, 4, KEEP_TOP + 6);
            }
        }

        keepWindows();
        keepDoor();
        keepInside();
    }

    private void keepWindows() {
        for (int y : new int[]{GROUND + 6, GROUND + 20, GROUND + 34}) {
            for (int along = -KEEP + 5; along <= KEEP - 5; along += 6) {
                for (int side = -1; side <= 1; side += 2) {
                    for (int height = 0; height < 3; height++) {
                        set(along, y + height, side * KEEP, Material.LIGHT_BLUE_STAINED_GLASS_PANE);
                        set(side * KEEP, y + height, along, Material.LIGHT_BLUE_STAINED_GLASS_PANE);
                    }
                    // A hood over each window, which is what makes it a window
                    // rather than a hole.
                    set(along, y + 3, side * KEEP, Material.CHISELED_STONE_BRICKS);
                    set(side * KEEP, y + 3, along, Material.CHISELED_STONE_BRICKS);
                }
            }
        }
    }

    private void keepDoor() {
        for (int x = -2; x <= 2; x++) {
            for (int y = GROUND + 1; y <= GROUND + 5; y++) {
                if (y == GROUND + 5 && Math.abs(x) == 2) continue;
                set(x, y, KEEP, Material.AIR);
            }
        }
        for (int x = -3; x <= 3; x++) {
            set(x, GROUND + 6, KEEP, Material.CHISELED_STONE_BRICKS);
            set(x, GROUND + 7, KEEP, Math.abs(x) == 3 ? palette.timber() : Material.BLUE_WOOL);
        }
        for (int side = -1; side <= 1; side += 2) {
            set(side * 3, GROUND + 2, KEEP + 1, Material.WALL_TORCH);
        }
    }

    /**
     * The inside of the keep.
     *
     * It was hollow. A forty-block tower with nothing in it is worse than no
     * tower, because people walk in expecting something. Ground floor is a
     * hall: pillars, a carpet runner up to a throne, chandeliers, bookshelves
     * along the back wall.
     */
    private void keepInside() {
        // Pillars holding the first floor up.
        for (int px = -8; px <= 8; px += 16) {
            for (int pz = -8; pz <= 8; pz += 16) {
                for (int y = GROUND + 1; y <= GROUND + 13; y++) {
                    set(px, y, pz, palette.timber());
                }
                stairs(px + 1, GROUND + 13, pz, Material.SPRUCE_STAIRS, BlockFace.WEST, true);
                stairs(px - 1, GROUND + 13, pz, Material.SPRUCE_STAIRS, BlockFace.EAST, true);
            }
        }

        // A carpet runner from the door to the throne.
        for (int z = -KEEP + 2; z <= KEEP - 1; z++) {
            for (int x = -2; x <= 2; x++) {
                set(x, GROUND + 1, z, Math.abs(x) == 2 ? Material.RED_CARPET : Material.BLUE_CARPET);
            }
        }

        // The throne, on a dais at the back.
        for (int x = -4; x <= 4; x++) {
            for (int z = -KEEP + 1; z <= -KEEP + 4; z++) {
                set(x, GROUND + 1, z, Material.POLISHED_ANDESITE);
            }
        }
        stairs(0, GROUND + 2, -KEEP + 2, Material.DARK_OAK_STAIRS, BlockFace.SOUTH, false);
        for (int side = -1; side <= 1; side += 2) {
            set(side * 2, GROUND + 2, -KEEP + 2, Material.GOLD_BLOCK);
            set(side * 2, GROUND + 3, -KEEP + 2, Material.LANTERN);
        }

        // Bookshelves along the back, broken by the odd gap.
        for (int x = -KEEP + 2; x <= KEEP - 2; x++) {
            if (Math.abs(x) < 6) continue;
            for (int y = GROUND + 1; y <= GROUND + 4; y++) {
                set(x, y, -KEEP + 1, palette.sometimes(9) ? Material.AIR : Material.BOOKSHELF);
            }
        }

        // Long tables down each side, because a hall has furniture in it.
        for (int side = -1; side <= 1; side += 2) {
            for (int z = -4; z <= 8; z++) {
                set(side * 7, GROUND + 1, z, palette.planks());
                slab(side * 7, GROUND + 2, z, Material.SPRUCE_SLAB, false);
                if ((z & 1) == 0) {
                    stairs(side * 6, GROUND + 1, z, Material.SPRUCE_STAIRS,
                            side < 0 ? BlockFace.WEST : BlockFace.EAST, false);
                }
            }
        }

        chandeliers();

        // The upper floors get light and a rug, and are otherwise left open —
        // somewhere to stand and look out of the windows.
        for (int y : new int[]{GROUND + 15, GROUND + 29}) {
            for (int x = -6; x <= 6; x++) {
                for (int z = -6; z <= 6; z++) {
                    if (Math.abs(x) == 6 || Math.abs(z) == 6) {
                        set(x, y, z, Material.RED_CARPET);
                    }
                }
            }
            set(0, y + 6, 0, Material.SEA_LANTERN);
        }
    }

    private void chandeliers() {
        for (int cx = -6; cx <= 6; cx += 12) {
            for (int cz = -6; cz <= 6; cz += 12) {
                for (int y = GROUND + 10; y <= GROUND + 12; y++) set(cx, y, cz, Material.IRON_BARS);

                set(cx, GROUND + 9, cz, Material.SEA_LANTERN);
                for (int[] arm : new int[][]{{1, 0}, {-1, 0}, {0, 1}, {0, -1}}) {
                    set(cx + arm[0], GROUND + 9, cz + arm[1], Material.LANTERN);
                }
            }
        }
    }

    /* ------------------------------------------------------------ courtyard */

    private void courtyard() {
        for (int x = -WALL + WALL_THICK; x <= WALL - WALL_THICK; x++) {
            for (int z = -WALL + WALL_THICK; z <= WALL - WALL_THICK; z++) {
                if (Math.max(Math.abs(x), Math.abs(z)) <= KEEP) continue;

                boolean road = Math.abs(x) <= GATE_HALF || Math.abs(z) <= GATE_HALF;
                boolean ring = Math.abs(Math.max(Math.abs(x), Math.abs(z)) - (KEEP + 12)) <= 2;

                if (road || ring) {
                    set(x, GROUND, z, palette.paving());
                } else {
                    set(x, GROUND, z, palette.ground());
                    if (world.getBlockAt(x, GROUND, z).getType() == Material.GRASS_BLOCK
                            && palette.sometimes(6)) {
                        set(x, GROUND + 1, z, palette.flower());
                    }
                }
            }
        }

        market();
        well(-30, -18);
        smithy(30, -20);
        garden(-32, 26);
        lampPosts();
    }

    /** Stalls along the road in from the gate. */
    private void market() {
        int[][] stalls = {{-14, 30}, {14, 30}, {-14, 44}, {14, 44}};
        Material[] canopies = {Material.RED_WOOL, Material.YELLOW_WOOL,
                               Material.LIME_WOOL, Material.LIGHT_BLUE_WOOL};

        for (int i = 0; i < stalls.length; i++) {
            int cx = stalls[i][0];
            int cz = stalls[i][1];
            Material canopy = canopies[i];

            for (int x = -2; x <= 2; x++) {
                for (int z = -1; z <= 1; z++) {
                    set(cx + x, GROUND, cz + z, palette.paving());
                }
            }

            // Counter, posts, and a striped awning over the top.
            for (int x = -2; x <= 2; x++) {
                slab(cx + x, GROUND + 1, cz - 1, Material.SPRUCE_SLAB, false);
            }
            for (int side = -2; side <= 2; side += 4) {
                for (int y = GROUND + 1; y <= GROUND + 3; y++) set(cx + side, y, cz + 1, palette.timber());
            }
            for (int x = -3; x <= 3; x++) {
                set(cx + x, GROUND + 4, cz, (x & 1) == 0 ? canopy : Material.WHITE_WOOL);
                stairs(cx + x, GROUND + 4, cz - 1, Material.SPRUCE_STAIRS, BlockFace.SOUTH, false);
                stairs(cx + x, GROUND + 4, cz + 1, Material.SPRUCE_STAIRS, BlockFace.NORTH, false);
            }

            set(cx - 2, GROUND + 1, cz + 1, Material.BARREL);
            set(cx + 2, GROUND + 1, cz + 1, Material.BARREL);
            set(cx, GROUND + 1, cz + 1, Material.HAY_BLOCK);
            set(cx + 1, GROUND + 2, cz - 1, Material.LANTERN);
        }
    }

    private void well(int cx, int cz) {
        for (int x = -2; x <= 2; x++) {
            for (int z = -2; z <= 2; z++) {
                set(cx + x, GROUND, cz + z, Material.COBBLESTONE);
                if (Math.abs(x) <= 1 && Math.abs(z) <= 1) {
                    set(cx + x, GROUND + 1, cz + z, Material.MOSSY_COBBLESTONE);
                }
            }
        }
        set(cx, GROUND, cz, Material.WATER);
        set(cx, GROUND + 1, cz, Material.WATER);

        for (int side = -1; side <= 1; side += 2) {
            for (int y = GROUND + 2; y <= GROUND + 4; y++) {
                set(cx + side, y, cz + side, palette.timber());
            }
        }
        for (int x = -2; x <= 2; x++) {
            for (int z = -2; z <= 2; z++) {
                set(cx + x, GROUND + 5, cz + z, Material.DARK_OAK_SLAB);
            }
        }
        set(cx, GROUND + 4, cz, Material.IRON_BARS);
        set(cx, GROUND + 3, cz, Material.LANTERN);
    }

    private void smithy(int cx, int cz) {
        for (int x = -4; x <= 4; x++) {
            for (int z = -4; z <= 4; z++) {
                set(cx + x, GROUND, cz + z, Material.COBBLESTONE);

                boolean wall = Math.abs(x) == 4 || Math.abs(z) == 4;
                boolean doorway = z == 4 && Math.abs(x) <= 1;

                if (wall && !doorway) {
                    for (int y = GROUND + 1; y <= GROUND + 4; y++) {
                        set(cx + x, y, cz + z, y >= GROUND + 4 ? palette.timber() : palette.wall());
                    }
                }
            }
        }

        // Roof, sloped both ways.
        for (int step = 0; step <= 4; step++) {
            for (int x = -4 + step; x <= 4 - step; x++) {
                stairs(cx + x, GROUND + 5 + step, cz - 4 + step, Material.DARK_OAK_STAIRS,
                        BlockFace.SOUTH, false);
                stairs(cx + x, GROUND + 5 + step, cz + 4 - step, Material.DARK_OAK_STAIRS,
                        BlockFace.NORTH, false);
            }
        }

        set(cx - 2, GROUND + 1, cz - 2, Material.ANVIL);
        set(cx + 2, GROUND + 1, cz - 2, Material.BLAST_FURNACE);
        set(cx + 2, GROUND + 2, cz - 2, Material.CAMPFIRE);
        set(cx, GROUND + 1, cz - 3, Material.SMITHING_TABLE);
        set(cx - 3, GROUND + 1, cz, Material.GRINDSTONE);
        set(cx + 3, GROUND + 1, cz + 2, Material.CAULDRON);
        set(cx - 3, GROUND + 3, cz + 3, Material.LANTERN);
    }

    private void garden(int cx, int cz) {
        for (int x = -6; x <= 6; x++) {
            for (int z = -6; z <= 6; z++) {
                if (x * x + z * z > 36) continue;

                boolean path = Math.abs(x) <= 1 || Math.abs(z) <= 1;
                set(cx + x, GROUND, cz + z, path ? Material.GRAVEL : Material.GRASS_BLOCK);

                if (!path && palette.sometimes(2)) set(cx + x, GROUND + 1, cz + z, palette.flower());

                // A hedge around the outside.
                if (x * x + z * z > 30 && !path) {
                    set(cx + x, GROUND + 1, cz + z, Material.OAK_LEAVES);
                }
            }
        }

        for (int[] bench : new int[][]{{0, 5}, {0, -5}, {5, 0}, {-5, 0}}) {
            stairs(cx + bench[0], GROUND + 1, cz + bench[1], Material.SPRUCE_STAIRS,
                    bench[1] > 0 ? BlockFace.NORTH : bench[1] < 0 ? BlockFace.SOUTH
                            : bench[0] > 0 ? BlockFace.WEST : BlockFace.EAST, false);
        }

        tree(cx, cz, 6);
    }

    private void lampPosts() {
        for (int angle = 0; angle < 360; angle += 30) {
            double radians = Math.toRadians(angle);
            int x = (int) Math.round(Math.cos(radians) * (KEEP + 16));
            int z = (int) Math.round(Math.sin(radians) * (KEEP + 16));

            if (Math.abs(x) <= GATE_HALF + 1 && z > 0) continue;

            set(x, GROUND, z, palette.paving());
            for (int y = GROUND + 1; y <= GROUND + 3; y++) set(x, y, z, Material.COBBLESTONE_WALL);
            set(x, GROUND + 4, z, Material.LANTERN);
            set(x, GROUND + 5, z, Material.COBBLESTONE_SLAB);
        }
    }

    private void tree(int cx, int cz, int height) {
        for (int y = GROUND + 1; y <= GROUND + height; y++) set(cx, y, cz, Material.OAK_LOG);

        for (int x = -3; x <= 3; x++) {
            for (int z = -3; z <= 3; z++) {
                for (int y = GROUND + height - 2; y <= GROUND + height + 2; y++) {
                    int spread = y >= GROUND + height + 1 ? 2 : 3;
                    if (x * x + z * z > spread * spread) continue;
                    if (x == 0 && z == 0 && y <= GROUND + height) continue;
                    if (palette.sometimes(10)) continue;
                    set(cx + x, y, cz + z, Material.OAK_LEAVES);
                }
            }
        }
    }

    /* ------------------------------------------------------------- helpers */

    /** Which way a roof block should face: back towards the middle. */
    private BlockFace towards(int x, int z) {
        if (Math.abs(x) > Math.abs(z)) return x > 0 ? BlockFace.WEST : BlockFace.EAST;
        return z > 0 ? BlockFace.NORTH : BlockFace.SOUTH;
    }

    private Material roofStair() {
        return palette.sometimes(3) ? Material.POLISHED_DEEPSLATE_STAIRS : Material.DEEPSLATE_TILE_STAIRS;
    }

    private void stairs(int x, int y, int z, Material material, BlockFace facing, boolean upsideDown) {
        Block block = world.getBlockAt(x, y, z);
        block.setType(material, false);

        if (block.getBlockData() instanceof Stairs data) {
            data.setFacing(facing);
            data.setHalf(upsideDown ? org.bukkit.block.data.Bisected.Half.TOP
                    : org.bukkit.block.data.Bisected.Half.BOTTOM);
            block.setBlockData(data, false);
        }
    }

    private void slab(int x, int y, int z, Material material, boolean top) {
        Block block = world.getBlockAt(x, y, z);
        block.setType(material, false);

        if (block.getBlockData() instanceof Slab data) {
            data.setType(top ? Slab.Type.TOP : Slab.Type.BOTTOM);
            block.setBlockData(data, false);
        }
    }

    private void set(int x, int y, int z, Material material) {
        Block block = world.getBlockAt(x, y, z);
        block.setType(material, false);

        BlockData data = block.getBlockData();
        if (data instanceof Orientable orientable) {
            orientable.setAxis(Axis.Y);
            block.setBlockData(data, false);
        } else if (data instanceof Slab slab && slab.getType() == Slab.Type.DOUBLE) {
            slab.setType(Slab.Type.BOTTOM);
            block.setBlockData(data, false);
        }
    }
}
