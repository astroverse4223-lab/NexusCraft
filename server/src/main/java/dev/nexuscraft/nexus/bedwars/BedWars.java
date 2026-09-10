package dev.nexuscraft.nexus.bedwars;

import dev.nexuscraft.nexus.Game;
import dev.nexuscraft.nexus.Match;
import dev.nexuscraft.nexus.Nexus;
import org.bukkit.Material;

/**
 * BedWars, as the shell sees it.
 *
 * Almost nothing, which is the point — everything about how a game is queued,
 * counted down and recorded lives in the shell, so a game itself is a name, a
 * size, and a way to make a match.
 */
public final class BedWars implements Game {

    @Override
    public String id() {
        return "bedwars";
    }

    @Override
    public String name() {
        return "Bed Wars";
    }

    @Override
    public String blurb() {
        return "Break their beds. Defend your own.";
    }

    @Override
    public Material icon() {
        return Material.RED_BED;
    }

    /**
     * Two, so a pair of friends can actually play.
     *
     * The usual minimum is eight and it is the reason most self-hosted networks
     * are empty: a game that needs eight people never starts on a server with
     * five. Four teams still exist, they just do not all get used.
     */
    @Override
    public int minPlayers() {
        return 2;
    }

    @Override
    public int maxPlayers() {
        return 16;
    }

    @Override
    public Match newMatch(Nexus nexus) {
        return new BedWarsMatch(nexus, this);
    }
}
