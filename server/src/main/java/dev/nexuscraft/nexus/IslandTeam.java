package dev.nexuscraft.nexus;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.event.ClickEvent;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Bukkit;
import org.bukkit.OfflinePlayer;
import org.bukkit.Sound;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.entity.Player;

import java.io.File;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Building somebody else's island with them.
 *
 * Skyblock is a game people play together and this one could not be: the
 * ownership check recognised exactly one person, so a friend standing on your
 * island could not place a single block. That is the whole mode running with
 * its best part switched off.
 *
 * Members are given building rights on the island they joined, and keep their
 * own. Deliberately: making your island vanish when you accept an invitation is
 * a decision that cannot be undone by somebody who misread the message.
 */
public final class IslandTeam {

    /** How many people may be on one island, the owner included. */
    private static int allowance(Ranks rank) {
        return switch (rank) {
            case PLAYER -> 3;
            case VIP -> 5;
            case MVP -> 8;
            case ADMIN, OWNER -> 32;
        };
    }

    private final Nexus nexus;
    private final File file;

    /** Island owner to the people allowed to build on it. */
    private final Map<UUID, Set<UUID>> members = new HashMap<>();

    /** Who has been asked, and by whom. Not saved; an invitation is a moment. */
    private final Map<UUID, UUID> invited = new HashMap<>();

    public IslandTeam(Nexus nexus) {
        this.nexus = nexus;
        this.file = new File(nexus.getDataFolder(), "islandteams.yml");
        load();
    }

    /* ---------------------------------------------------------- membership */

    /** Every island this player may build on, other than their own. */
    public Set<UUID> hostsFor(UUID who) {
        Set<UUID> hosts = new HashSet<>();
        for (Map.Entry<UUID, Set<UUID>> entry : members.entrySet()) {
            if (entry.getValue().contains(who)) hosts.add(entry.getKey());
        }
        return hosts;
    }

    public Set<UUID> membersOf(UUID owner) {
        return members.getOrDefault(owner, Set.of());
    }

    public boolean isMember(UUID owner, UUID who) {
        return owner.equals(who) || membersOf(owner).contains(who);
    }

    /* ------------------------------------------------------------- inviting */

    public void invite(Player owner, String name) {
        Player guest = Bukkit.getPlayerExact(name);

        if (guest == null) {
            owner.sendMessage(Text.bad(name + " is not online."));
            return;
        }
        if (guest.equals(owner)) {
            owner.sendMessage(Text.says("You are already on your own island."));
            return;
        }

        Set<UUID> already = members.computeIfAbsent(owner.getUniqueId(), id -> new HashSet<>());

        if (already.contains(guest.getUniqueId())) {
            owner.sendMessage(Text.says(guest.getName() + " is already on your island."));
            return;
        }

        int limit = allowance(nexus.stats().rankOf(owner.getUniqueId()));
        if (already.size() + 1 >= limit) {
            owner.sendMessage(Text.bad("Your island holds " + limit + ", including you."));
            return;
        }

        invited.put(guest.getUniqueId(), owner.getUniqueId());

        owner.sendMessage(Text.good("Asked " + guest.getName() + " to join your island."));

        guest.sendMessage(Text.heading("Island invitation"));
        guest.sendMessage(Component.text("  " + owner.getName(), Text.BRAND)
                .append(Component.text(" wants you on their island.", NamedTextColor.GRAY)));
        guest.sendMessage(Component.text("  Click here to accept", NamedTextColor.GREEN)
                .clickEvent(ClickEvent.runCommand("/is accept")));
        guest.playSound(guest, Sound.BLOCK_NOTE_BLOCK_CHIME, 1f, 1.4f);
    }

    public void accept(Player guest) {
        UUID owner = invited.remove(guest.getUniqueId());

        if (owner == null) {
            guest.sendMessage(Text.says("Nobody has invited you to an island."));
            return;
        }

        members.computeIfAbsent(owner, id -> new HashSet<>()).add(guest.getUniqueId());
        save();

        guest.sendMessage(Text.good("You can now build on " + nameOf(owner) + "'s island."));
        guest.sendMessage(Text.plain("  /is visit " + nameOf(owner) + " to go there."));
        guest.sendMessage(Text.plain("  Your own island is still yours."));

        Player host = Bukkit.getPlayer(owner);
        if (host != null) {
            host.sendMessage(Text.good(guest.getName() + " joined your island."));
            host.playSound(host, Sound.BLOCK_AMETHYST_BLOCK_CHIME, 1f, 1.3f);
        }
    }

    public void kick(Player owner, String name) {
        Set<UUID> theirs = members.get(owner.getUniqueId());

        if (theirs == null || theirs.isEmpty()) {
            owner.sendMessage(Text.says("Nobody else is on your island."));
            return;
        }

        for (UUID member : new HashSet<>(theirs)) {
            if (!name.equalsIgnoreCase(nameOf(member))) continue;

            theirs.remove(member);
            save();

            owner.sendMessage(Text.good(name + " can no longer build on your island."));

            Player gone = Bukkit.getPlayer(member);
            if (gone != null) {
                gone.sendMessage(Text.says(owner.getName() + " removed you from their island."));
            }
            return;
        }

        owner.sendMessage(Text.bad(name + " is not on your island."));
    }

    /** Leaving somebody else's island, which is always allowed. */
    public void leave(Player who, String ownerName) {
        for (UUID owner : hostsFor(who.getUniqueId())) {
            if (ownerName != null && !ownerName.equalsIgnoreCase(nameOf(owner))) continue;

            members.get(owner).remove(who.getUniqueId());
            save();

            who.sendMessage(Text.says("You left " + nameOf(owner) + "'s island."));
            return;
        }

        who.sendMessage(Text.says("You are not on anybody else's island."));
    }

    /* ----------------------------------------------------------------- list */

    public void show(Player player) {
        player.sendMessage(Text.heading("Your island"));

        Set<UUID> theirs = membersOf(player.getUniqueId());
        int limit = allowance(nexus.stats().rankOf(player.getUniqueId()));

        if (theirs.isEmpty()) {
            player.sendMessage(Text.plain("  Nobody else yet. /is invite <player>"));
        } else {
            for (UUID member : theirs) {
                player.sendMessage(Text.field(nameOf(member),
                        Bukkit.getPlayer(member) != null ? "online" : "offline"));
            }
        }
        player.sendMessage(Text.plain("  " + (theirs.size() + 1) + " of " + limit + "."));

        Set<UUID> hosts = hostsFor(player.getUniqueId());
        if (hosts.isEmpty()) return;

        player.sendMessage(Text.heading("You can also build on"));
        for (UUID host : hosts) {
            player.sendMessage(Component.text("  " + nameOf(host), Text.BRAND)
                    .clickEvent(ClickEvent.runCommand("/is visit " + nameOf(host))));
        }
    }

    private String nameOf(UUID who) {
        OfflinePlayer player = Bukkit.getOfflinePlayer(who);
        return player.getName() == null ? "somebody" : player.getName();
    }

    /* -------------------------------------------------------------- on disk */

    private void load() {
        if (!file.exists()) return;

        YamlConfiguration yaml = YamlConfiguration.loadConfiguration(file);
        for (String owner : yaml.getKeys(false)) {
            try {
                Set<UUID> theirs = new HashSet<>();
                for (String member : yaml.getStringList(owner)) theirs.add(UUID.fromString(member));
                if (!theirs.isEmpty()) members.put(UUID.fromString(owner), theirs);
            } catch (Exception broken) {
                nexus.getLogger().warning("skipping an unreadable island team: " + owner);
            }
        }
    }

    public void save() {
        YamlConfiguration yaml = new YamlConfiguration();

        for (Map.Entry<UUID, Set<UUID>> entry : members.entrySet()) {
            if (entry.getValue().isEmpty()) continue;

            List<String> names = new ArrayList<>();
            for (UUID member : entry.getValue()) names.add(member.toString());
            yaml.set(entry.getKey().toString(), names);
        }

        try {
            yaml.save(file);
        } catch (Exception broken) {
            nexus.getLogger().warning("could not save the island teams: " + broken);
        }
    }
}
