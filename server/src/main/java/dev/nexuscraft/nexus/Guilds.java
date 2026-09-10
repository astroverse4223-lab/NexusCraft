package dev.nexuscraft.nexus;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Location;
import org.bukkit.Sound;
import org.bukkit.World;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.entity.Player;

import java.io.File;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

/**
 * Parties that outlive the session.
 *
 * A party is for the next twenty minutes: it exists to get four people into the
 * same match and it is gone when they log off. That leaves nothing for the
 * people who play together every evening - no shared name, nowhere to put money
 * that belongs to the group, and no way to let six people build on one base
 * without trusting each of them to every claim by hand.
 *
 * A guild is the long version. You join one and you are still in it next week.
 */
public final class Guilds {

    /** What starting one costs, to keep the list from filling with jokes. */
    public static final double COST = 5_000;

    /** Longest a name may be, so chat and the leaderboard stay readable. */
    private static final int NAME_MAX = 16;

    /** How long an invitation stands, in seconds. */
    private static final int INVITE_SECONDS = 120;

    /** Rank inside a guild. Ordinal order is authority order. */
    public enum Role {
        MEMBER, OFFICER, OWNER;

        boolean atLeast(Role other) {
            return ordinal() >= other.ordinal();
        }
    }

    private static final class Guild {
        final String id;
        String name;
        UUID owner;
        double bank;
        Location home;

        /** Ordered, so /guild info lists people the same way twice running. */
        final Map<UUID, Role> members = new LinkedHashMap<>();

        Guild(String id, String name, UUID owner) {
            this.id = id;
            this.name = name;
            this.owner = owner;
            members.put(owner, Role.OWNER);
        }

        /**
         * What the guild is worth, for the leaderboard.
         *
         * Bank plus a flat amount per member, so a guild of eight who spend
         * what they earn still places above two people sitting on a pile. Both
         * halves are things a guild does rather than things it has.
         */
        double points() {
            return bank + members.size() * 1_000;
        }
    }

    private final Nexus nexus;
    private final File file;

    private final Map<String, Guild> guilds = new HashMap<>();

    /** Who is in what, so the common question is not a scan. */
    private final Map<UUID, String> memberOf = new HashMap<>();

    /** Player to the guild they were asked to join, and when it lapses. */
    private final Map<UUID, Invite> invites = new HashMap<>();

    private record Invite(String guild, long until) { }

    public Guilds(Nexus nexus) {
        this.nexus = nexus;
        this.file = new File(nexus.getDataFolder(), "guilds.yml");
        load();
    }

    /* -------------------------------------------------------------- asking */

    private Guild of(Player player) {
        String id = memberOf.get(player.getUniqueId());
        return id == null ? null : guilds.get(id);
    }

    /**
     * Whether two people are in the same guild.
     *
     * The question {@link Claims} asks, which is the whole point of guild
     * claims: your land is your guild's land without anybody having to run
     * trust six times every time somebody joins.
     */
    public boolean together(UUID a, UUID b) {
        String one = memberOf.get(a);
        return one != null && one.equals(memberOf.get(b));
    }

    public String nameOf(UUID who) {
        String id = memberOf.get(who);
        if (id == null) return null;

        Guild guild = guilds.get(id);
        return guild == null ? null : guild.name;
    }

    /** For tab completion. */
    public List<String> names() {
        List<String> out = new ArrayList<>();
        for (Guild guild : guilds.values()) out.add(guild.name);
        return out;
    }

    private Guild mine(Player player, Role needs) {
        Guild guild = of(player);

        if (guild == null) {
            player.sendMessage(Text.bad("You are not in a guild."));
            player.sendMessage(Text.plain("  /guild create <name> to start one."));
            return null;
        }

        Role role = guild.members.getOrDefault(player.getUniqueId(), Role.MEMBER);
        if (!role.atLeast(needs)) {
            player.sendMessage(Text.bad("That is for the "
                    + needs.name().toLowerCase(Locale.ROOT) + " and above."));
            return null;
        }
        return guild;
    }

    /* ------------------------------------------------------------ starting */

    public void create(Player player, String name) {
        if (of(player) != null) {
            player.sendMessage(Text.bad("You are already in a guild."));
            player.sendMessage(Text.plain("  /guild leave first."));
            return;
        }

        if (name.length() > NAME_MAX || name.length() < 3) {
            player.sendMessage(Text.bad("A name is 3 to " + NAME_MAX + " characters."));
            return;
        }

        if (!name.matches("[A-Za-z0-9_]+")) {
            player.sendMessage(Text.bad("Letters, numbers and underscores only."));
            return;
        }

        String id = name.toLowerCase(Locale.ROOT);
        if (guilds.containsKey(id)) {
            player.sendMessage(Text.bad("There is already a guild called that."));
            return;
        }

        if (!nexus.stats().charge(player.getUniqueId(), COST)) {
            player.sendMessage(Text.bad("Starting a guild costs " + Stats.cash(COST) + "."));
            player.sendMessage(Text.plain("  You have "
                    + Stats.cash(nexus.stats().moneyOf(player.getUniqueId())) + "."));
            return;
        }

        Guild guild = new Guild(id, name, player.getUniqueId());
        guilds.put(id, guild);
        memberOf.put(player.getUniqueId(), id);
        save();

        player.sendMessage(Text.good(name + " founded."));
        player.sendMessage(Text.plain("  /guild invite <name> to bring people in."));
        player.playSound(player, Sound.ENTITY_PLAYER_LEVELUP, 0.9f, 1.1f);
    }

    public void disband(Player player) {
        Guild guild = mine(player, Role.OWNER);
        if (guild == null) return;

        /*
         * The bank goes back to the owner rather than evaporating.
         *
         * It is the members' money as much as theirs, but there is no fair way
         * to split it and quietly deleting it is the one option that is
         * certainly wrong.
         */
        if (guild.bank > 0) {
            nexus.stats().pay(player.getUniqueId(), guild.bank);
            player.sendMessage(Text.plain("  " + Stats.cash(guild.bank) + " returned to you."));
        }

        for (UUID who : guild.members.keySet()) {
            memberOf.remove(who);

            Player online = nexus.getServer().getPlayer(who);
            if (online != null && !online.equals(player)) {
                online.sendMessage(Text.bad(guild.name + " was disbanded."));
            }
        }

        guilds.remove(guild.id);
        nexus.territories().forget(guild.name);
        save();

        player.sendMessage(Text.good(guild.name + " is no more."));
    }

    /* ------------------------------------------------------------- joining */

    public void invite(Player player, String name) {
        Guild guild = mine(player, Role.OFFICER);
        if (guild == null) return;

        Player them = nexus.getServer().getPlayerExact(name);
        if (them == null) {
            player.sendMessage(Text.bad(name + " is not online."));
            return;
        }

        if (memberOf.containsKey(them.getUniqueId())) {
            player.sendMessage(Text.bad(them.getName() + " is already in a guild."));
            return;
        }

        invites.put(them.getUniqueId(),
                new Invite(guild.id, System.currentTimeMillis() + INVITE_SECONDS * 1000L));

        player.sendMessage(Text.good(them.getName() + " invited."));

        them.sendMessage(Text.heading("Guild"));
        them.sendMessage(Text.plain("  " + player.getName() + " invited you to " + guild.name + "."));
        them.sendMessage(Component.text("  Click here to join", NamedTextColor.GREEN)
                .clickEvent(net.kyori.adventure.text.event.ClickEvent
                        .runCommand("/guild accept")));
        them.playSound(them, Sound.ENTITY_EXPERIENCE_ORB_PICKUP, 0.8f, 1.4f);
    }

    public void accept(Player player) {
        Invite invite = invites.remove(player.getUniqueId());

        if (invite == null || invite.until() < System.currentTimeMillis()) {
            player.sendMessage(Text.bad("No invitation, or it has lapsed."));
            return;
        }

        if (memberOf.containsKey(player.getUniqueId())) {
            player.sendMessage(Text.bad("You are already in a guild."));
            return;
        }

        Guild guild = guilds.get(invite.guild());
        if (guild == null) {
            player.sendMessage(Text.bad("That guild no longer exists."));
            return;
        }

        guild.members.put(player.getUniqueId(), Role.MEMBER);
        memberOf.put(player.getUniqueId(), guild.id);
        save();

        player.sendMessage(Text.good("You joined " + guild.name + "."));
        announce(guild, player.getName() + " joined.", player);
    }

    public void leave(Player player) {
        Guild guild = of(player);

        if (guild == null) {
            player.sendMessage(Text.bad("You are not in a guild."));
            return;
        }

        if (guild.owner.equals(player.getUniqueId())) {
            player.sendMessage(Text.bad("The owner cannot walk out."));
            player.sendMessage(Text.plain("  /guild promote somebody, or /guild disband."));
            return;
        }

        guild.members.remove(player.getUniqueId());
        memberOf.remove(player.getUniqueId());
        save();

        player.sendMessage(Text.says("You left " + guild.name + "."));
        announce(guild, player.getName() + " left.", player);
    }

    public void kick(Player player, String name) {
        Guild guild = mine(player, Role.OFFICER);
        if (guild == null) return;

        UUID them = nexus.getServer().getOfflinePlayer(name).getUniqueId();

        if (!guild.members.containsKey(them)) {
            player.sendMessage(Text.bad(name + " is not in your guild."));
            return;
        }

        if (them.equals(guild.owner)) {
            player.sendMessage(Text.bad("You cannot remove the owner."));
            return;
        }

        // An officer cannot remove another officer; only the owner can.
        Role theirs = guild.members.get(them);
        Role mine = guild.members.get(player.getUniqueId());

        if (theirs.atLeast(Role.OFFICER) && mine != Role.OWNER) {
            player.sendMessage(Text.bad("Only the owner can remove an officer."));
            return;
        }

        guild.members.remove(them);
        memberOf.remove(them);
        save();

        player.sendMessage(Text.good(name + " removed."));
        announce(guild, name + " was removed.", null);

        Player online = nexus.getServer().getPlayer(them);
        if (online != null) online.sendMessage(Text.bad("You were removed from " + guild.name + "."));
    }

    public void promote(Player player, String name, boolean up) {
        Guild guild = mine(player, Role.OWNER);
        if (guild == null) return;

        UUID them = nexus.getServer().getOfflinePlayer(name).getUniqueId();

        if (!guild.members.containsKey(them) || them.equals(guild.owner)) {
            player.sendMessage(Text.bad(name + " is not one of your members."));
            return;
        }

        Role now = up ? Role.OFFICER : Role.MEMBER;
        guild.members.put(them, now);
        save();

        player.sendMessage(Text.good(name + " is now a "
                + now.name().toLowerCase(Locale.ROOT) + "."));
    }

    /* ---------------------------------------------------------------- bank */

    public void deposit(Player player, double amount) {
        Guild guild = of(player);

        if (guild == null) {
            player.sendMessage(Text.bad("You are not in a guild."));
            return;
        }

        if (amount <= 0) {
            player.sendMessage(Text.bad("How much?"));
            return;
        }

        if (!nexus.stats().charge(player.getUniqueId(), amount)) {
            player.sendMessage(Text.bad("You do not have " + Stats.cash(amount) + "."));
            return;
        }

        guild.bank += amount;
        save();

        player.sendMessage(Text.good(Stats.cash(amount) + " into the guild bank."));
        announce(guild, player.getName() + " put in " + Stats.cash(amount) + ".", player);
    }

    /**
     * Withdrawing is for officers, depositing is for anybody.
     *
     * The asymmetry is the point: a guild bank that any member can empty is a
     * guild bank that gets emptied, and it is always the newest member.
     */
    public void withdraw(Player player, double amount) {
        Guild guild = mine(player, Role.OFFICER);
        if (guild == null) return;

        if (amount <= 0) {
            player.sendMessage(Text.bad("How much?"));
            return;
        }

        if (guild.bank < amount) {
            player.sendMessage(Text.bad("The bank has " + Stats.cash(guild.bank) + "."));
            return;
        }

        guild.bank -= amount;
        nexus.stats().pay(player.getUniqueId(), amount);
        save();

        player.sendMessage(Text.good(Stats.cash(amount) + " out of the guild bank."));
        announce(guild, player.getName() + " took out " + Stats.cash(amount) + ".", player);
    }

    /* ---------------------------------------------------------------- home */

    public void setHome(Player player) {
        Guild guild = mine(player, Role.OFFICER);
        if (guild == null) return;

        if (nexus.worlds().placeOf(player) != Worlds.Place.SURVIVAL) {
            player.sendMessage(Text.bad("A guild home is in survival."));
            return;
        }

        guild.home = player.getLocation();
        save();

        player.sendMessage(Text.good("Guild home set."));
        announce(guild, player.getName() + " moved the guild home.", player);
    }

    public void home(Player player) {
        Guild guild = of(player);

        if (guild == null) {
            player.sendMessage(Text.bad("You are not in a guild."));
            return;
        }

        if (guild.home == null) {
            player.sendMessage(Text.bad("No guild home yet."));
            player.sendMessage(Text.plain("  An officer can /guild sethome."));
            return;
        }

        player.teleport(guild.home);
        player.sendMessage(Text.says(guild.name + "."));
    }

    /* --------------------------------------------------------------- chat */

    public void chat(Player player, String message) {
        Guild guild = of(player);

        if (guild == null) {
            player.sendMessage(Text.bad("You are not in a guild."));
            return;
        }

        Component line = Component.text("[" + guild.name + "] ", NamedTextColor.GREEN)
                .append(Component.text(player.getName() + ": ", NamedTextColor.GRAY))
                .append(Component.text(message, NamedTextColor.WHITE));

        for (UUID who : guild.members.keySet()) {
            Player online = nexus.getServer().getPlayer(who);
            if (online != null) online.sendMessage(line);
        }
    }

    /** Everything but one person, who already knows. */
    private void announce(Guild guild, String what, Player except) {
        for (UUID who : guild.members.keySet()) {
            Player online = nexus.getServer().getPlayer(who);

            if (online == null || online.equals(except)) continue;
            online.sendMessage(Text.says("[" + guild.name + "] " + what));
        }
    }

    /* --------------------------------------------------- what territory needs */

    /**
     * Pays into a guild's bank by name, saying whether there was one.
     *
     * By display name because that is what {@link Territories} records - a
     * guild's name is what people call it, and storing an id there would mean
     * the territory map spoke a different language from the broadcast that
     * announced the capture.
     */
    public boolean depositTo(String name, double amount) {
        Guild guild = guilds.get(name.toLowerCase(Locale.ROOT));
        if (guild == null) return false;

        guild.bank += amount;
        save();
        return true;
    }

    /** Says something to one guild, wherever its members are. */
    public void tell(String name, Component message) {
        Guild guild = guilds.get(name.toLowerCase(Locale.ROOT));
        if (guild == null) return;

        for (UUID who : guild.members.keySet()) {
            Player online = nexus.getServer().getPlayer(who);
            if (online != null) online.sendMessage(message);
        }
    }

    /* -------------------------------------------------------------- seeing */

    public void info(Player player, String which) {
        Guild guild = which == null ? of(player) : guilds.get(which.toLowerCase(Locale.ROOT));

        if (guild == null) {
            player.sendMessage(Text.bad(which == null
                    ? "You are not in a guild."
                    : "No guild called '" + which + "'."));
            return;
        }

        player.sendMessage(Text.heading(guild.name));
        player.sendMessage(Text.plain("  Bank: " + Stats.cash(guild.bank)));
        player.sendMessage(Text.plain("  Members: " + guild.members.size()));

        for (Map.Entry<UUID, Role> entry : guild.members.entrySet()) {
            String name = nexus.getServer().getOfflinePlayer(entry.getKey()).getName();
            boolean on = nexus.getServer().getPlayer(entry.getKey()) != null;

            player.sendMessage(Component.text("   " + (name == null ? "?" : name),
                            on ? NamedTextColor.GREEN : NamedTextColor.GRAY)
                    .append(Component.text("  " + entry.getValue().name().toLowerCase(Locale.ROOT),
                            NamedTextColor.DARK_GRAY)));
        }
    }

    public void top(Player player) {
        List<Guild> sorted = new ArrayList<>(guilds.values());
        sorted.sort((a, b) -> Double.compare(b.points(), a.points()));

        player.sendMessage(Text.heading("Guilds"));

        if (sorted.isEmpty()) {
            player.sendMessage(Text.plain("  None yet. /guild create <name>."));
            return;
        }

        int place = 1;
        for (Guild guild : sorted) {
            if (place > 10) break;

            int ground = nexus.territories().heldBy(guild.name);

            player.sendMessage(Component.text("  " + place + ". " + guild.name,
                            NamedTextColor.AQUA)
                    .append(Component.text("   " + guild.members.size() + " members, "
                            + Stats.cash(guild.bank), NamedTextColor.DARK_GRAY))
                    .append(ground == 0 ? Component.empty()
                            : Component.text("   " + ground + " held", NamedTextColor.GREEN)));
            place++;
        }
    }

    public void help(Player player) {
        player.sendMessage(Text.heading("Guilds"));
        player.sendMessage(Text.plain("  /guild create <name>   " + Stats.cash(COST)));
        player.sendMessage(Text.plain("  /guild invite <name>   officers and up"));
        player.sendMessage(Text.plain("  /guild accept          take an invitation"));
        player.sendMessage(Text.plain("  /guild leave           walk out"));
        player.sendMessage(Text.plain("  /guild kick <name>     officers and up"));
        player.sendMessage(Text.plain("  /guild promote <name>  owner only"));
        player.sendMessage(Text.plain("  /guild demote <name>   owner only"));
        player.sendMessage(Text.plain("  /guild deposit <n>     anybody"));
        player.sendMessage(Text.plain("  /guild withdraw <n>    officers and up"));
        player.sendMessage(Text.plain("  /guild sethome         /guild home"));
        player.sendMessage(Text.plain("  /guild info [name]     who is in it"));
        player.sendMessage(Text.plain("  /guild top             the leaderboard"));
        player.sendMessage(Text.plain("  /guild disband         owner only"));
        player.sendMessage(Text.plain("  /gc <message>          guild chat"));
        player.sendMessage(Text.plain("  /guild land            territory, and who holds it"));
        player.sendMessage(Text.plain("  Guild members can build on each other's claims."));
    }

    /* ------------------------------------------------------------- on disk */

    private void load() {
        if (!file.exists()) return;

        YamlConfiguration yaml = YamlConfiguration.loadConfiguration(file);
        var section = yaml.getConfigurationSection("guilds");
        if (section == null) return;

        for (String id : section.getKeys(false)) {
            String at = "guilds." + id;

            String name = yaml.getString(at + ".name");
            String owner = yaml.getString(at + ".owner");
            if (name == null || owner == null) continue;

            Guild guild;
            try {
                guild = new Guild(id, name, UUID.fromString(owner));
            } catch (IllegalArgumentException notAnId) {
                continue;
            }

            guild.bank = yaml.getDouble(at + ".bank");

            String worldName = yaml.getString(at + ".home.world");
            World world = worldName == null ? null : nexus.getServer().getWorld(worldName);

            if (world != null) {
                guild.home = new Location(world,
                        yaml.getDouble(at + ".home.x"),
                        yaml.getDouble(at + ".home.y"),
                        yaml.getDouble(at + ".home.z"),
                        (float) yaml.getDouble(at + ".home.yaw"),
                        (float) yaml.getDouble(at + ".home.pitch"));
            }

            var people = yaml.getConfigurationSection(at + ".members");
            if (people != null) {
                for (String raw : people.getKeys(false)) {
                    try {
                        UUID who = UUID.fromString(raw);
                        Role role = Role.valueOf(yaml.getString(at + ".members." + raw, "MEMBER"));

                        guild.members.put(who, role);
                        memberOf.put(who, id);
                    } catch (IllegalArgumentException bad) {
                        /* Hand-edited; skip that one rather than the guild. */
                    }
                }
            }

            // The owner is a member whatever the file says, or a guild could
            // be loaded with nobody able to run anything.
            guild.members.put(guild.owner, Role.OWNER);
            memberOf.put(guild.owner, id);

            guilds.put(id, guild);
        }
    }

    public void save() {
        YamlConfiguration yaml = new YamlConfiguration();

        for (Guild guild : guilds.values()) {
            String at = "guilds." + guild.id;

            yaml.set(at + ".name", guild.name);
            yaml.set(at + ".owner", guild.owner.toString());
            yaml.set(at + ".bank", guild.bank);

            if (guild.home != null && guild.home.getWorld() != null) {
                yaml.set(at + ".home.world", guild.home.getWorld().getName());
                yaml.set(at + ".home.x", guild.home.getX());
                yaml.set(at + ".home.y", guild.home.getY());
                yaml.set(at + ".home.z", guild.home.getZ());
                yaml.set(at + ".home.yaw", guild.home.getYaw());
                yaml.set(at + ".home.pitch", guild.home.getPitch());
            }

            for (Map.Entry<UUID, Role> entry : guild.members.entrySet()) {
                yaml.set(at + ".members." + entry.getKey(), entry.getValue().name());
            }
        }

        try {
            yaml.save(file);
        } catch (Exception e) {
            nexus.getLogger().warning("could not save guilds: " + e);
        }
    }
}
