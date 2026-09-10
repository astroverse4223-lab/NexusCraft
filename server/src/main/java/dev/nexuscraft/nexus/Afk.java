package dev.nexuscraft.nexus;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Location;
import org.bukkit.entity.Player;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Whether somebody is actually here.
 *
 * This exists because the server pays people for time. Three hundred and fifty
 * every twenty minutes for being online, plus jobs paying per block, is an
 * invitation to leave a client running overnight — and an economy that pays out
 * while everybody sleeps is one where money means nothing by the weekend.
 *
 * Movement alone is not the test. A rubber band on a key beats it, and so does
 * a mouse jiggler, and both are the first thing anybody tries. What is checked
 * instead is whether somebody has *done* anything — moved to a different block,
 * turned their head meaningfully, hit something, opened something, typed. Any
 * of those is a person; none of them for five minutes is a chair.
 *
 * Deliberately not a punishment. Going AFK is allowed, it simply stops paying,
 * and the moment they touch anything they are back.
 */
public final class Afk {

    /** Idle this long and the payments stop. */
    private static final int AFK_AFTER = 5 * 60;

    /** What each player was last seen doing, and when. */
    private final Map<UUID, Long> lastActive = new HashMap<>();
    private final Map<UUID, Location> lastAt = new HashMap<>();
    private final Map<UUID, Boolean> away = new HashMap<>();

    private final Nexus nexus;

    public Afk(Nexus nexus) {
        this.nexus = nexus;
    }

    /* --------------------------------------------------------------- noticing */

    /** Something a person did. Anything at all counts. */
    public void active(Player player) {
        UUID who = player.getUniqueId();
        lastActive.put(who, System.currentTimeMillis());

        if (Boolean.TRUE.equals(away.put(who, false))) {
            player.sendMessage(Text.says("Welcome back."));

            nexus.getServer().broadcast(Component.text(player.getName(), NamedTextColor.GRAY)
                    .append(Component.text(" is back", NamedTextColor.DARK_GRAY)));
        }
    }

    public boolean isAway(UUID who) {
        return Boolean.TRUE.equals(away.get(who));
    }

    public void forget(Player player) {
        lastActive.remove(player.getUniqueId());
        lastAt.remove(player.getUniqueId());
        away.remove(player.getUniqueId());
    }

    /**
     * Once a second, deciding who has stopped being here.
     *
     * Position is compared by block rather than by exact coordinate, because a
     * player standing still drifts by fractions and a floating point comparison
     * would call that activity forever.
     */
    public void tick() {
        long now = System.currentTimeMillis();

        for (Player player : nexus.getServer().getOnlinePlayers()) {
            UUID who = player.getUniqueId();
            Location at = player.getLocation();

            Location was = lastAt.get(who);
            lastAt.put(who, at);

            boolean moved = was == null
                    || was.getBlockX() != at.getBlockX()
                    || was.getBlockY() != at.getBlockY()
                    || was.getBlockZ() != at.getBlockZ();

            /*
             * Looking around counts, but only a real turn.
             *
             * Twenty degrees, because a client left running drifts by a degree
             * or two and a stricter test would never mark anybody away — while
             * a looser one would let a slowly rotating jiggler pass forever.
             */
            boolean turned = was != null
                    && (Math.abs(was.getYaw() - at.getYaw()) > 20
                    || Math.abs(was.getPitch() - at.getPitch()) > 20);

            if (moved || turned) {
                active(player);
                continue;
            }

            Long since = lastActive.get(who);
            if (since == null) {
                lastActive.put(who, now);
                continue;
            }

            if (now - since < AFK_AFTER * 1000L) continue;
            if (isAway(who)) continue;

            away.put(who, true);
            player.sendMessage(Text.says("You are marked away. Nothing pays until you move."));

            nexus.getServer().broadcast(Component.text(player.getName(), NamedTextColor.GRAY)
                    .append(Component.text(" is away", NamedTextColor.DARK_GRAY)));
        }
    }

    /**
     * Marking yourself away on purpose, by typing /afk.
     *
     * A toggle rather than a one way switch, because the alternative is that
     * somebody types it, comes straight back, and then has to jump around
     * waiting for the tick to notice them.
     */
    public void markAway(Player player) {
        UUID who = player.getUniqueId();

        if (isAway(who)) {
            active(player);
            return;
        }

        away.put(who, true);

        // Backdated, so the tick does not immediately un-mark them for the
        // fraction of a block they drift while standing still.
        lastActive.put(who, System.currentTimeMillis() - AFK_AFTER * 1000L);

        player.sendMessage(Text.says("Away. Nothing pays until you move."));

        nexus.getServer().broadcast(Component.text(player.getName(), NamedTextColor.GRAY)
                .append(Component.text(" is away", NamedTextColor.DARK_GRAY)));
    }

    /** How long somebody has been idle, for the operator command. */
    public int idleSeconds(UUID who) {
        Long since = lastActive.get(who);
        return since == null ? 0 : (int) ((System.currentTimeMillis() - since) / 1000);
    }
}
