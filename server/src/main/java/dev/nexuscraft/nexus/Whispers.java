package dev.nexuscraft.nexus;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.entity.Player;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Replying without retyping the name.
 *
 * Vanilla has /msg and /tell and delivers them perfectly well, so none of that
 * is rewritten here. What vanilla has never had is /r, and its absence is felt
 * every single time: a conversation held in private messages means typing the
 * other person's name in full on every line, and names on a Minecraft server
 * are rarely short or easy to spell.
 *
 * The pairs are learned from the commands as they go past, which the moderation
 * interception is already reading in order to make mutes apply to private
 * messages. Nothing extra is intercepted for this.
 */
public final class Whispers {

    private final Nexus nexus;

    /** Who each player should reply to. */
    private final Map<UUID, UUID> replyTo = new HashMap<>();

    public Whispers(Nexus nexus) {
        this.nexus = nexus;
    }

    /**
     * Notes a private message going past.
     *
     * Both directions are recorded from the one command: the sender should now
     * reply to the target, and the target should now reply to the sender. Only
     * the sender's side is observable, so recording only that would leave /r
     * working for whoever spoke first and silently not for the other person.
     */
    public void noted(Player from, String targetName) {
        Player target = nexus.getServer().getPlayerExact(targetName);
        if (target == null || target.equals(from)) return;

        replyTo.put(from.getUniqueId(), target.getUniqueId());
        replyTo.put(target.getUniqueId(), from.getUniqueId());
    }

    public void reply(Player player, String message) {
        UUID who = replyTo.get(player.getUniqueId());

        if (who == null) {
            player.sendMessage(Text.says("Nobody to reply to."));
            return;
        }

        Player target = nexus.getServer().getPlayer(who);
        if (target == null) {
            player.sendMessage(Text.bad("They have gone offline."));
            replyTo.remove(player.getUniqueId());
            return;
        }

        if (message.isBlank()) {
            player.sendMessage(Text.bad("/r <message>"));
            return;
        }

        /*
         * Handed back to vanilla rather than delivered here.
         *
         * Vanilla's /msg already formats it the way people recognise, shows it
         * to staff who are spying, and respects the client's own chat settings.
         * Re-implementing all of that to save one command dispatch would be a
         * worse copy of something that already works.
         */
        player.performCommand("msg " + target.getName() + " " + message);
    }

    /** Who somebody would reply to, for the hint under /r with no message. */
    public void show(Player player) {
        UUID who = replyTo.get(player.getUniqueId());
        Player target = who == null ? null : nexus.getServer().getPlayer(who);

        player.sendMessage(target == null
                ? Text.says("Nobody to reply to.")
                : Component.text("  Replying to ", NamedTextColor.GRAY)
                        .append(Component.text(target.getName(), Text.BRAND)));
    }

    public void forget(Player player) {
        replyTo.remove(player.getUniqueId());
        replyTo.values().removeIf(id -> id.equals(player.getUniqueId()));
    }
}
