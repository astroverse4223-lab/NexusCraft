package dev.nexuscraft.nexus;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextDecoration;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
import org.bukkit.scoreboard.Criteria;
import org.bukkit.scoreboard.DisplaySlot;
import org.bukkit.scoreboard.Objective;
import org.bukkit.scoreboard.Scoreboard;
import org.bukkit.scoreboard.Team;

import java.util.List;

/**
 * The panel down the right of the screen.
 *
 * Every server has one and there is a reason: it is the only place you can put
 * information that a player reads without being asked to. In the hub it is who
 * they are; in a match it is who is still alive and how long is left.
 *
 * Minecraft's scoreboard API was built for numbers, not for text, so writing
 * lines to it is a small fight. Each line is a "team" whose prefix carries the
 * actual content and whose entry is an invisible colour code used only to keep
 * the lines distinct — two identical strings would otherwise collapse into one
 * row. That trick is standard and it is the reason this class exists rather
 * than the API being called directly.
 */
public final class Sidebar {

    /** Sixteen colour codes, so there is a unique invisible key per line. */
    private static final String[] KEYS = {
            "§0", "§1", "§2", "§3", "§4", "§5", "§6", "§7",
            "§8", "§9", "§a", "§b", "§c", "§d", "§e", "§f",
    };

    private final Player player;
    private final Scoreboard board;
    private final Objective objective;

    private int shown;

    public Sidebar(Player player, String title) {
        this.player = player;
        this.board = Bukkit.getScoreboardManager().getNewScoreboard();

        this.objective = board.registerNewObjective("nexus", Criteria.DUMMY,
                Component.text(title, Text.BRAND, TextDecoration.BOLD));
        this.objective.setDisplaySlot(DisplaySlot.SIDEBAR);

        player.setScoreboard(board);
    }

    public void title(String title) {
        objective.displayName(Component.text(title, Text.BRAND, TextDecoration.BOLD));
    }

    /**
     * Replaces the whole panel.
     *
     * Rewriting every line each tick flickers, so lines are only touched when
     * their text has actually changed — the team prefix is updated in place and
     * the client redraws nothing it does not have to.
     */
    public void set(List<Component> lines) {
        int count = Math.min(lines.size(), KEYS.length);

        for (int i = 0; i < count; i++) {
            // Top line has the highest score, so the list reads downward in the
            // order it was written rather than upside down.
            int score = count - i;
            String key = KEYS[i];

            Team row = board.getTeam("row" + i);
            if (row == null) {
                row = board.registerNewTeam("row" + i);
                row.addEntry(key);
            }

            row.prefix(lines.get(i));
            objective.getScore(key).setScore(score);
        }

        // Anything left over from a longer panel is removed, or the old rows
        // hang around underneath the new ones.
        for (int i = count; i < shown; i++) {
            board.resetScores(KEYS[i]);
            Team row = board.getTeam("row" + i);
            if (row != null) row.unregister();
        }

        shown = count;
    }

    /** A blank row, for spacing. Each needs its own key, hence the index. */
    public static Component gap() {
        return Component.empty();
    }

    public static Component line(String label, String value, NamedTextColor colour) {
        return Component.text(label + " ", NamedTextColor.GRAY)
                .append(Component.text(value, colour));
    }

    /** Puts the player back on the server's shared board. */
    public void clear() {
        player.setScoreboard(Bukkit.getScoreboardManager().getMainScoreboard());
    }
}
