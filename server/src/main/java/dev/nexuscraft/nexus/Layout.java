package dev.nexuscraft.nexus;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Location;
import org.bukkit.World;
import org.bukkit.entity.Player;

import java.util.ArrayList;
import java.util.List;

/**
 * Arranges every bot and sign in the lobby, wherever the lobby happens to be.
 *
 * Written because the alternative was worse in both directions. Hard-coded
 * coordinates only work for the build they were measured against — the last set
 * put somebody inside a pillar — and placing nineteen NPCs by hand is twenty
 * minutes of walking and typing that has to be redone every time the lobby
 * changes.
 *
 * So the positions are computed from where the operator is standing, in three
 * arcs, and every one of them is checked against the actual terrain before
 * anything is put there. A spot inside a wall is skipped and tried again a
 * little further out rather than used, which is the whole reason this can be
 * run on a build nobody has measured.
 */
public final class Layout {

    /** How far out each group of bots stands from the middle. */
    private static final double WORLDS_RADIUS = 13;
    private static final double SHOPS_RADIUS = 11;
    private static final double CRATES_RADIUS = 9;

    /** How wide a fan each group spreads over, in degrees. */
    private static final double WORLDS_SPREAD = 150;
    private static final double SHOPS_SPREAD = 130;
    private static final double CRATES_SPREAD = 50;

    /** Where each group sits relative to the way the operator is facing. */
    private static final double WORLDS_AT = 0;
    private static final double SHOPS_AT = 180;
    private static final double CRATES_AT = 270;

    /** Floating text sits this far above a bot's feet. */
    private static final double SIGN_HEIGHT = 3.4;

    private final Nexus nexus;

    public Layout(Nexus nexus) {
        this.nexus = nexus;
    }

    /**
     * Lays the whole lobby out around one point.
     *
     * Returns what it managed, because on a cramped build some of it will not
     * fit and saying so is more use than a silent partial job.
     */
    public String arrange(Player operator) {
        Location anchor = operator.getLocation();
        World world = anchor.getWorld();

        if (!nexus.hub().isHub(operator)) {
            return "Stand in the lobby first.";
        }

        // Everything is placed relative to the way they are looking, so the
        // operator decides the orientation just by standing the right way.
        double facing = anchor.getYaw();

        int placed = 0;
        int skipped = 0;

        List<String> worlds = new ArrayList<>();
        for (Hub.Destination destination : Hub.DESTINATIONS) worlds.add(destination.id());

        List<String> shops = new ArrayList<>();
        List<String> crates = new ArrayList<>();
        for (Hub.Service service : Hub.SERVICES) {
            (service.id().startsWith("crate_") ? crates : shops).add(service.id());
        }

        for (Placement placement : List.of(
                new Placement(worlds, WORLDS_AT, WORLDS_RADIUS, WORLDS_SPREAD),
                new Placement(shops, SHOPS_AT, SHOPS_RADIUS, SHOPS_SPREAD),
                new Placement(crates, CRATES_AT, CRATES_RADIUS, CRATES_SPREAD))) {

            for (int i = 0; i < placement.ids().size(); i++) {
                Location spot = spotFor(world, anchor, facing, placement, i);

                if (spot == null) {
                    skipped++;
                    continue;
                }

                nexus.settings().setNpc(placement.ids().get(i), spot);
                placed++;
            }
        }

        nexus.hub().placeNpcs();
        signs(world, anchor, facing);

        return placed + " placed"
                + (skipped > 0 ? ", " + skipped + " had nowhere to stand" : "")
                + ". Move any of them with /nexus setnpc <id>.";
    }

    private record Placement(List<String> ids, double at, double radius, double spread) {
    }

    /**
     * Works out one bot's spot, and checks something can stand in it.
     *
     * Tried at the intended distance first and then further out in one block
     * steps. On an open plaza the first try is always the answer; against a
     * wall it walks outward until it finds floor, which is what stops a fan of
     * bots from half disappearing into the scenery.
     */
    private Location spotFor(World world, Location anchor, double facing,
                             Placement placement, int index) {

        int count = placement.ids().size();
        double step = count == 1 ? 0 : placement.spread() / (count - 1);
        double angle = facing + placement.at() - placement.spread() / 2 + step * index;

        for (double out = placement.radius(); out <= placement.radius() + 8; out += 1) {
            double radians = Math.toRadians(angle);
            double x = anchor.getX() - Math.sin(radians) * out;
            double z = anchor.getZ() + Math.cos(radians) * out;

            Location standing = groundNear(world, x, z, anchor.getBlockY());
            if (standing == null) continue;

            // Turned to look back at the middle, so a fan of bots faces whoever
            // walks into it rather than all pointing the same way.
            standing.setYaw((float) (angle + 180));
            standing.setPitch(0);
            return standing;
        }

        return null;
    }

    /**
     * Finds the floor near a given height, or nothing.
     *
     * Searched outward from the anchor's own level rather than from the sky,
     * because a lobby has roofs and towers over it and the highest block at
     * some x,z is regularly a battlement forty blocks up.
     */
    private Location groundNear(World world, double x, double z, int around) {
        for (int offset = 0; offset <= 6; offset++) {
            for (int direction : offset == 0 ? new int[]{0} : new int[]{-offset, offset}) {
                int y = around + direction;

                Location at = new Location(world, Math.floor(x) + 0.5, y, Math.floor(z) + 0.5);

                boolean feet = at.getBlock().isPassable();
                boolean head = at.clone().add(0, 1, 0).getBlock().isPassable();
                boolean floor = !at.clone().add(0, -1, 0).getBlock().isPassable();

                if (feet && head && floor) return at;
            }
        }
        return null;
    }

    /**
     * A heading over each group.
     *
     * The bots say what they individually do; these say what a whole side of
     * the plaza is for, which is the thing you read from across the room.
     */
    private void signs(World world, Location anchor, double facing) {
        header(world, anchor, facing, WORLDS_AT, WORLDS_RADIUS - 3,
                List.of("&b&lWORLDS", "&7pick where to play"));

        header(world, anchor, facing, SHOPS_AT, SHOPS_RADIUS - 3,
                List.of("&6&lMARKET", "&7buy, sell, and get paid"));

        header(world, anchor, facing, CRATES_AT, CRATES_RADIUS - 3,
                List.of("&e&lCRATES", "&7right click with a key"));

        // And the board, which is the one people actually stop to read.
        header(world, anchor, facing, 90, CRATES_RADIUS - 2,
                List.of("&6&lTOP PLAYERS", Holograms.LEADERBOARD));
    }

    private void header(World world, Location anchor, double facing,
                        double at, double out, List<String> lines) {

        double radians = Math.toRadians(facing + at);
        double x = anchor.getX() - Math.sin(radians) * out;
        double z = anchor.getZ() + Math.cos(radians) * out;

        Location ground = groundNear(world, x, z, anchor.getBlockY());
        Location above = (ground == null
                ? new Location(world, Math.floor(x) + 0.5, anchor.getY(), Math.floor(z) + 0.5)
                : ground).add(0, SIGN_HEIGHT, 0);

        nexus.holograms().add(above, lines);
    }

    /** Says what was done, in a form somebody can act on. */
    public void report(Player operator, String outcome) {
        operator.sendMessage(Text.heading("Lobby"));
        operator.sendMessage(Text.plain("  " + outcome));
        operator.sendMessage(Component.text("  Worlds in front, market behind, crates to the left.",
                NamedTextColor.DARK_GRAY));
        operator.sendMessage(Component.text("  Run it again facing a different way to turn it all round.",
                NamedTextColor.DARK_GRAY));
    }
}
