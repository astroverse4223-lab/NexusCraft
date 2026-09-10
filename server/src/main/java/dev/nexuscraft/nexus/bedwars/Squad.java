package dev.nexuscraft.nexus.bedwars;

import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Material;

import java.util.LinkedHashSet;
import java.util.Set;
import java.util.UUID;

/**
 * One team, and everything that is true about it.
 *
 * Called a squad rather than a team because Bukkit already has a Team, that one
 * is a scoreboard concept, and both are used in the same file. Two imports of
 * the same word is how somebody eventually colours the wrong thing.
 */
public final class Squad {

    public final int index;
    public final String name;
    public final NamedTextColor colour;
    public final Material wool;

    public final Set<UUID> members = new LinkedHashSet<>();

    /**
     * Whether the bed is still there.
     *
     * The whole game is this boolean. With it, a death costs you ten seconds;
     * without it, a death is the end, and every decision either side of losing
     * it is a different game.
     */
    public boolean bedAlive = true;

    /** Bought once and kept, so they belong to the team rather than the player. */
    public int sharpness;
    public int protection;
    public int haste;
    public boolean healPool;

    /** Generator upgrades: how much faster the base spits out iron and gold. */
    public int forge;

    public Squad(int index, String name, NamedTextColor colour, Material wool) {
        this.index = index;
        this.name = name;
        this.colour = colour;
        this.wool = wool;
    }

    /** Nobody left alive and no bed to come back to. */
    public boolean eliminated(Set<UUID> stillIn) {
        if (bedAlive) return false;

        for (UUID member : members) {
            if (stillIn.contains(member)) return false;
        }
        return true;
    }

    public static Squad[] four() {
        return new Squad[]{
                new Squad(0, "Red", NamedTextColor.RED, Material.RED_WOOL),
                new Squad(1, "Blue", NamedTextColor.BLUE, Material.BLUE_WOOL),
                new Squad(2, "Green", NamedTextColor.GREEN, Material.GREEN_WOOL),
                new Squad(3, "Yellow", NamedTextColor.YELLOW, Material.YELLOW_WOOL),
        };
    }
}
