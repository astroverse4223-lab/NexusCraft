package dev.nexuscraft.nexus;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.entity.Player;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Playing with the people you came with.
 *
 * The whole feature is one promise: if you are in a party, you end up in the
 * same match. Everything else — the invites, the list, the leader — exists only
 * to make that promise keepable. A network without it is a network you play
 * alone next to your friends.
 *
 * Deliberately small. No chat channel, no warping, no settings. Those are
 * things a party can grow, not things it needs to be useful on the first night.
 */
public final class Parties {

    private static final class Party {
        UUID leader;
        final Set<UUID> members = new LinkedHashSet<>();
    }

    /** Every player who is in a party, pointing at the party they are in. */
    private final Map<UUID, Party> byMember = new HashMap<>();

    /** Outstanding invites: who was invited, and by which leader. */
    private final Map<UUID, UUID> invites = new HashMap<>();

    private final Nexus nexus;

    public Parties(Nexus nexus) {
        this.nexus = nexus;
    }

    /**
     * Everybody in this player's party who is online, including them.
     *
     * A player with no party is a party of one, which means the queue never has
     * to ask whether somebody is in a party — it just gets a list either way.
     */
    public List<Player> membersOnline(UUID who) {
        List<Player> found = new ArrayList<>();
        Party party = byMember.get(who);

        if (party == null) {
            Player alone = nexus.getServer().getPlayer(who);
            if (alone != null) found.add(alone);
            return found;
        }

        for (UUID id : party.members) {
            Player player = nexus.getServer().getPlayer(id);
            if (player != null) found.add(player);
        }
        return found;
    }

    public boolean inParty(UUID who) {
        return byMember.containsKey(who);
    }

    public boolean isLeader(UUID who) {
        Party party = byMember.get(who);
        return party != null && party.leader.equals(who);
    }

    /* -------------------------------------------------------------- invites */

    public void invite(Player leader, Player target) {
        if (leader.equals(target)) {
            leader.sendMessage(Text.bad("You cannot invite yourself."));
            return;
        }

        Party party = byMember.get(leader.getUniqueId());
        if (party != null && !party.leader.equals(leader.getUniqueId())) {
            leader.sendMessage(Text.bad("Only the party leader can invite."));
            return;
        }

        if (party == null) {
            party = new Party();
            party.leader = leader.getUniqueId();
            party.members.add(leader.getUniqueId());
            byMember.put(leader.getUniqueId(), party);
        }

        invites.put(target.getUniqueId(), leader.getUniqueId());

        leader.sendMessage(Text.says("Invited " + target.getName() + "."));
        target.sendMessage(Text.says(leader.getName() + " invited you to their party."));
        target.sendMessage(Component.text("  /party accept", Text.BRAND)
                .append(Component.text(" to join them.", NamedTextColor.GRAY)));
    }

    public void accept(Player player) {
        UUID leaderId = invites.remove(player.getUniqueId());
        if (leaderId == null) {
            player.sendMessage(Text.bad("You have no pending invite."));
            return;
        }

        Party party = byMember.get(leaderId);
        if (party == null) {
            player.sendMessage(Text.bad("That party no longer exists."));
            return;
        }

        // Leaving the old one first, or somebody ends up in two and the queue
        // has to decide which set of friends they meant.
        leave(player, true);

        party.members.add(player.getUniqueId());
        byMember.put(player.getUniqueId(), party);

        tell(party, Text.says(player.getName() + " joined the party."));
    }

    public void leave(Player player, boolean silent) {
        Party party = byMember.remove(player.getUniqueId());
        if (party == null) return;

        party.members.remove(player.getUniqueId());
        if (!silent) player.sendMessage(Text.says("You left the party."));

        if (party.members.isEmpty()) return;

        /*
         * The leader leaving hands the party on rather than dissolving it.
         *
         * Dissolving is the obvious behaviour and it is wrong: one person's
         * connection dropping should not scatter four people who were about to
         * queue together.
         */
        if (party.leader.equals(player.getUniqueId())) {
            party.leader = party.members.iterator().next();
            tell(party, Text.says(nameOf(party.leader) + " is now the party leader."));
        }

        tell(party, Text.says(player.getName() + " left the party."));
    }

    public void kick(Player leader, Player target) {
        if (!isLeader(leader.getUniqueId())) {
            leader.sendMessage(Text.bad("Only the party leader can remove people."));
            return;
        }

        Party party = byMember.get(leader.getUniqueId());
        if (party == null || !party.members.contains(target.getUniqueId())) {
            leader.sendMessage(Text.bad("They are not in your party."));
            return;
        }

        leave(target, true);
        target.sendMessage(Text.bad("You were removed from the party."));
        tell(party, Text.says(target.getName() + " was removed."));
    }

    public void list(Player player) {
        Party party = byMember.get(player.getUniqueId());
        if (party == null) {
            player.sendMessage(Text.says("You are not in a party."));
            return;
        }

        player.sendMessage(Text.heading("Party"));
        for (UUID id : party.members) {
            String name = nameOf(id);
            player.sendMessage(Text.field(
                    party.leader.equals(id) ? "Leader" : "Member", name));
        }
    }

    private void tell(Party party, Component message) {
        for (UUID id : party.members) {
            Player player = nexus.getServer().getPlayer(id);
            if (player != null) player.sendMessage(message);
        }
    }

    private String nameOf(UUID id) {
        Player player = nexus.getServer().getPlayer(id);
        if (player != null) return player.getName();

        String known = nexus.getServer().getOfflinePlayer(id).getName();
        return known == null ? "someone" : known;
    }
}
