package dev.nexuscraft.nexus;

import org.bukkit.Location;
import org.bukkit.World;

import java.util.Collection;
import java.util.HashSet;
import java.util.Set;

/**
 * Keeps loaded exactly the chunks that have something of ours standing in them.
 *
 * The bots and the floating text are non-persistent entities, which is the
 * right call — it means a restart can never leave a second copy of every
 * greeter standing next to the first. The cost is that Minecraft removes a
 * non-persistent entity the moment its chunk unloads, and an empty server
 * unloads everything.
 *
 * That was handled by force-loading a fixed square of chunks around the middle
 * of the lobby, which worked exactly as long as nobody moved anything: the
 * moment a bot was placed outside that square it disappeared on the next
 * restart and stayed gone until something re-placed it. Which is precisely the
 * symptom — "they come back when I use the wand".
 *
 * So the square is gone. The chunks that are held open are computed from where
 * things actually are, and re-computed every time anything moves. Chunks that
 * no longer hold anything are released, because pinning chunks forever is how a
 * lobby quietly ends up keeping half a world in memory.
 */
public final class Pinned {

    private final Set<Long> held = new HashSet<>();

    /**
     * Holds open the chunks these positions sit in, and releases the rest.
     *
     * Takes the whole set each time rather than adding one at a time, so there
     * is no way for a release to be forgotten — the set that is passed in is
     * the truth, and anything not in it is let go.
     */
    public void keep(World world, Collection<Location> places) {
        Set<Long> wanted = new HashSet<>();

        for (Location at : places) {
            if (at == null || at.getWorld() == null) continue;
            if (!at.getWorld().equals(world)) continue;

            // A one-chunk margin, because an entity on a chunk border is drawn
            // from the chunk next to it as often as its own.
            int cx = at.getBlockX() >> 4;
            int cz = at.getBlockZ() >> 4;

            for (int dx = -1; dx <= 1; dx++) {
                for (int dz = -1; dz <= 1; dz++) {
                    wanted.add(key(cx + dx, cz + dz));
                }
            }
        }

        for (long chunk : wanted) {
            if (held.add(chunk)) {
                world.setChunkForceLoaded(unX(chunk), unZ(chunk), true);
            }
        }

        held.removeIf(chunk -> {
            if (wanted.contains(chunk)) return false;
            world.setChunkForceLoaded(unX(chunk), unZ(chunk), false);
            return true;
        });
    }

    public int count() {
        return held.size();
    }

    private static long key(int x, int z) {
        return ((long) x << 32) | (z & 0xFFFFFFFFL);
    }

    private static int unX(long key) {
        return (int) (key >> 32);
    }

    private static int unZ(long key) {
        return (int) key;
    }
}
