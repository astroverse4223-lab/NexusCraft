package dev.nexuscraft.nexus;

import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * What tab suggests.
 *
 * Bukkit completes the *name* of a command because it registered it, and then
 * stops — everything after the first word is a string this plugin parses, and
 * Bukkit has no idea any of it exists. So `/nexus` completed and `/nexus se…`
 * did not, which makes twenty-odd subcommands effectively undiscoverable: you
 * have to already know the word to type it.
 *
 * That matters more here than usual because half the operator commands take an
 * id out of a list of twenty-one. Typing `crate_legendary` from memory, exactly,
 * with no feedback until it fails, is not a thing anybody should be asked to do.
 */
public final class Completions {

    /** Every subcommand of /nexus, grouped roughly as they are used. */
    private static final List<String> NEXUS = List.of(
            "wand", "layout", "setnpc", "clearnpc", "tpnpc", "npcs",
            "build", "setspawn", "check", "testarena",
            "setboss", "boss", "startboss",
            "setportal", "clearportal", "undoportal", "portals", "digspot",
            "hologram", "holopreset", "holosize", "holoraise", "holobackdrop",
            "unhologram", "clearholograms",
            "event", "chatgame",
            "rollback", "lookup", "ignoreclaims", "endseason",
            "backup", "backups", "votekey", "rebuild",
            "setrank", "pay", "givekey", "coins",
            "addskin", "removeskin", "pack", "save", "armour");

    private static final List<String> GUILD = List.of(
            "create", "invite", "accept", "leave", "kick", "promote", "demote",
            "deposit", "withdraw", "sethome", "home", "info", "top", "land", "disband");

    /** Where a build command may point. Left out, it follows your eyes. */
    private static final List<String> DIRECTIONS =
            List.of("up", "down", "north", "south", "east", "west");

    private static final List<String> PLOT = List.of(
            "auto", "claim", "home", "visit", "trust", "untrust",
            "clear", "delete", "info");

    private static final List<String> EVENTS =
            List.of("airdrop", "happyhour", "meteors", "horde");

    private static final List<String> PARTY =
            List.of("invite", "accept", "leave", "list", "kick");

    private static final List<String> WARPS =
            List.of("survival", "prison", "creative", "oneblock", "skyblock",
                    "parkour", "dropper", "hub");

    /** What /is takes. Template is staff only and filtered out below. */
    private static final List<String> ISLAND =
            List.of("invite", "accept", "kick", "leave", "team", "top", "visit",
                    "upgrades", "upgrade");

    private static final List<String> UPGRADES =
            List.of("generator", "size", "growth");

    private static final List<String> PWARP =
            List.of("set", "delete", "mine");

    private static final List<String> TIERS =
            List.of("common", "rare", "legendary");

    private final Nexus nexus;

    public Completions(Nexus nexus) {
        this.nexus = nexus;
    }

    /**
     * Suggestions for one command, given what has been typed so far.
     *
     * Everything is filtered against the last word, which is what makes tab
     * narrow as you type rather than offering the same twenty every time.
     */
    public List<String> forCommand(CommandSender sender, String command, String[] args) {
        String typed = args.length == 0 ? "" : args[args.length - 1];

        List<String> options = switch (command.toLowerCase(Locale.ROOT)) {
            case "guild", "g" -> {
                if (args.length <= 1) yield GUILD;
                yield switch (args[0].toLowerCase(Locale.ROOT)) {
                    case "invite", "kick", "remove", "promote", "demote" -> names();
                    case "info", "who" -> nexus.guilds().names();
                    case "deposit", "pay", "withdraw", "take" ->
                            List.of("100", "1000", "10000");
                    default -> List.of();
                };
            }
            case "dig", "digsite" -> args.length <= 1
                    ? List.of("sell", "camp", "pack", "shovel")
                    : List.of();
            case "plot", "plots", "p" -> {
                if (args.length <= 1) yield PLOT;
                yield switch (args[0].toLowerCase(Locale.ROOT)) {
                    case "visit", "v" -> nexus.plots().owners();
                    case "trust", "add", "untrust", "remove" -> names();
                    default -> List.of();
                };
            }
            case "pixeltext", "ptext" -> args.length <= 1
                    ? PixelArt.colourNames() : List.of();
            case "pixel", "pixelart" -> switch (args.length) {
                case 0, 1 -> PixelArt.names();
                case 2 -> List.of("1", "2", "3", "4");
                default -> List.of();
            };
            case "blueprint", "bp" -> switch (args.length) {
                case 0, 1 -> Blueprints.kinds();
                case 2 -> List.of("frame", "full");
                case 3 -> Blueprints.palettes();
                default -> List.of();
            };
            case "set", "walls", "shell", "overlay", "line" -> blocks(args, 0);
            case "sphere", "cyl", "pyramid" -> args.length <= 1
                    ? blocks(args, 0)
                    : args.length == 2 ? List.of("3", "5", "8", "12") : List.of("hollow");
            case "stack", "move", "expand", "contract" -> args.length <= 1
                    ? List.of("1", "2", "5", "10")
                    : DIRECTIONS;
            case "replace" -> blocks(args, args.length <= 1 ? 0 : 1);
            case "nexus" -> nexusOptions(sender, args);
            case "warp" -> args.length <= 1 ? WARPS : List.of();
            case "party" -> args.length <= 1 ? PARTY
                    : args.length == 2 && needsPlayer(args[0]) ? names() : List.of();
            case "stats" -> args.length <= 1 ? names() : List.of();
            case "sell" -> args.length <= 1 ? List.of("all", "prices") : List.of();
            case "trust", "untrust" -> args.length <= 1 ? names() : List.of();

            // Read from the registry, so a new game completes the day it is
            // added rather than the day somebody remembers this list.
            case "play", "queue" -> args.length <= 1 ? gameIds() : List.of();
            case "bounty" -> args.length <= 1 ? names() : List.of();
            case "tpa", "tpahere" -> args.length <= 1 ? names() : List.of();
            case "parkour", "courses" -> args.length <= 1
                    ? numbers(Course.count()) : List.of();
            case "dropper", "shafts" -> args.length <= 1
                    ? numbers(Dropper.shafts()) : List.of();

            case "mute", "unmute", "tempban", "unban", "warn", "history" ->
                    args.length <= 1 ? names()
                            : args.length == 2 && needsLength(command) ? SPANS
                            : List.of();
            case "boss", "warden" -> args.length <= 1
                    ? List.of("go") : List.of();

            case "kit" -> args.length <= 1 ? Kits.ids() : List.of();
            case "ah", "auction" -> args.length <= 1
                    ? List.of("sell", "mine") : List.of();
            case "guide", "tutorial" -> args.length <= 1 ? List.of("stop") : List.of();
            case "prestige" -> args.length <= 1 ? List.of("confirm") : List.of();
            case "jobs", "job" -> args.length <= 1 ? List.of("info") : List.of();
            case "newisland", "resetisland" -> args.length <= 1 ? List.of("confirm") : List.of();

            // Their own home names, which is the only list here that differs
            // per player — a shared one would suggest homes they cannot go to.
            case "home", "delhome" -> args.length <= 1 && sender instanceof Player player
                    ? nexus.homes().namesFor(player.getUniqueId()) : List.of();

            /*
             * Setting one completes the names too.
             *
             * Not to pick a name, but to see the ones already taken - typing an
             * existing name replaces that home, and doing it by accident is how
             * somebody loses a base.
             */
            case "sethome" -> args.length <= 1 && sender instanceof Player player
                    ? nexus.homes().namesFor(player.getUniqueId()) : List.of();

            case "rate" -> args.length <= 1 ? List.of("1", "2", "3", "4", "5") : List.of();

            // Round numbers, since these are always eyeballed rather than
            // measured, and a list beats typing into a blank.
            case "up" -> args.length <= 1 ? List.of("1", "5", "10", "20", "50") : List.of();
            case "drain" -> args.length <= 1 ? List.of("5", "10", "20", "40") : List.of();

            case "is", "island" -> islandOptions(sender, args);

            /*
             * Their own warps to delete, everybody's to travel to.
             *
             * Offering the whole list for delete would suggest a dozen warps a
             * player has no business removing, and every one of them refuses.
             */
            case "pwarp" -> args.length <= 1
                    ? join(PWARP, nexus.warps().names())
                    : args.length == 2 && args[0].equalsIgnoreCase("delete")
                            && sender instanceof Player who
                            ? nexus.warps().namesFor(who.getUniqueId())
                            : List.of();

            case "challenges", "challenge" -> args.length <= 1 ? List.of("claim")
                    : args.length == 2 && args[0].equalsIgnoreCase("claim")
                            && sender instanceof Player who
                            ? nexus.challenges().claimable(who.getUniqueId())
                            : List.of();

            case "claim" -> args.length <= 1 ? List.of("wand") : List.of();
            default -> List.of();
        };

        return matching(options, typed);
    }

    /**
     * What /is offers, which depends on who is asking and what they typed.
     *
     * The template subcommand only appears for staff: it replaces the island
     * everybody starts with, and suggesting it to a player is inviting them to
     * find out it is not for them.
     */
    private List<String> islandOptions(CommandSender sender, String[] args) {
        if (args.length <= 1) {
            return sender.hasPermission("nexus.admin")
                    ? join(ISLAND, List.of("template"))
                    : ISLAND;
        }

        String sub = args[0].toLowerCase(Locale.ROOT);

        if (args.length == 2) {
            return switch (sub) {
                case "invite", "kick", "visit", "leave" -> names();
                case "upgrade", "upgrades" -> UPGRADES;
                case "template" -> sender.hasPermission("nexus.admin")
                        ? List.of("clear") : List.of();
                default -> List.of();
            };
        }
        return List.of();
    }

    /** Two lists as one, without either being changed. */
    private static List<String> join(List<String> first, List<String> second) {
        List<String> both = new ArrayList<>(first);
        both.addAll(second);
        return both;
    }

    private boolean needsPlayer(String sub) {
        return sub.equalsIgnoreCase("invite") || sub.equalsIgnoreCase("kick");
    }

    /**
     * The operator command, which is the one that actually needed this.
     *
     * Contextual per subcommand: a bot id where a bot id goes, a rank where a
     * rank goes. Offering the same list everywhere would technically be
     * completion and would help nobody.
     */
    /**
     * Block names, filtered by what has been typed.
     *
     * Offered unfiltered the list is eight hundred entries and the client shows
     * the first few alphabetically, which is never the one you want. Filtered
     * it is a real completion from the second character.
     */
    private List<String> blocks(String[] args, int which) {
        if (args.length != which + 1) return List.of();

        String typed = args[which].toLowerCase(Locale.ROOT);

        /*
         * What the word starts, before what merely contains it.
         *
         * This used to take any block whose name contained what was typed and
         * stop at sixty. Material.values() is close enough to alphabetical that
         * "stone" filled all sixty places with blackstone, cobblestone, end
         * stone, glowstone, redstone and sandstone - every slab, stair and wall
         * of each - and gave up before reaching stone_bricks. The block being
         * asked for was hidden behind the blocks that were not.
         */
        List<String> starts = new ArrayList<>();
        List<String> holds = new ArrayList<>();

        for (Material material : Material.values()) {
            if (!material.isBlock() || material.isLegacy()) continue;

            String name = material.name().toLowerCase(Locale.ROOT);

            if (name.startsWith(typed)) starts.add(name);
            else if (!typed.isEmpty() && name.contains(typed)) holds.add(name);
        }

        starts.addAll(holds);

        // Generous, because the client filters the list again as you keep
        // typing - and a cap that hides the answer is the bug being fixed.
        return starts.size() > 256 ? new ArrayList<>(starts.subList(0, 256)) : starts;
    }

    private List<String> nexusOptions(CommandSender sender, String[] args) {
        if (!sender.hasPermission("nexus.admin")) return List.of();
        if (args.length <= 1) return NEXUS;

        String sub = args[0].toLowerCase(Locale.ROOT);

        if (args.length == 2) {
            return switch (sub) {
                case "wand", "place", "setnpc", "clearnpc", "tpnpc",
                     "setportal" -> Hub.npcIds();

                // Only the ones that exist, since clearing anything else is
                // a command that can only ever say "there is no such portal".
                case "clearportal" -> nexus.portals().placed();
                case "digspot" -> List.of("spawn", "buyer", "gear");
                case "event" -> EVENTS;
                case "setrank", "pay", "givekey", "coins", "rollback", "lookup" -> names();
                case "removeskin" -> List.of();
                case "hologram", "holo" -> List.of("leaderboard", "online");
                case "holopreset", "preset" -> Presets.names();

                // Read from the config the launcher writes, so a set completes
                // the moment its pack is built rather than when somebody
                // remembers to add it here.
                case "armour", "armor" -> nexus.armoury().ids();
                case "holosize" -> List.of("0.5", "1", "1.5", "2", "3", "4", "6");
                case "holoraise" -> List.of("-1", "-0.5", "0.5", "1", "2");
                case "rebuild" -> List.of("dropper", "parkour", "prison", "digsite");
                default -> List.of();
            };
        }

        if (args.length == 4) {
            return switch (sub) {
                case "armour", "armor" -> ARMOUR_PIECES;
                default -> List.of();
            };
        }

        if (args.length == 3) {
            return switch (sub) {
                case "setrank" -> ranks();
                case "givekey" -> TIERS;
                case "armour", "armor" -> names();
                case "rollback", "lookup" -> List.of("10", "30", "60", "180", "1440");
                case "clearnpc" -> List.of("last");
                case "endseason" -> List.of("confirm");
                case "rebuild" -> List.of("dropper", "parkour", "prison", "digsite");
                default -> List.of();
            };
        }

        return List.of();
    }

    /** Commands whose second argument is how long. */
    private static boolean needsLength(String command) {
        return command.equalsIgnoreCase("mute") || command.equalsIgnoreCase("tempban");
    }

    /** Named rather than read, because the four are fixed by the game. */
    private static final List<String> ARMOUR_PIECES =
            List.of("helmet", "chestplate", "leggings", "boots");

    private static final List<String> SPANS =
            List.of("30m", "1h", "6h", "12h", "1d", "3d", "7d", "forever");

    /** "1" to "n", for the ladders. */
    private static List<String> numbers(int many) {
        List<String> out = new ArrayList<>();
        for (int i = 1; i <= many; i++) out.add(String.valueOf(i));
        return out;
    }

    private List<String> gameIds() {
        List<String> out = new ArrayList<>();
        for (Game game : nexus.games().all()) out.add(game.id());
        return out;
    }

    private List<String> ranks() {
        List<String> out = new ArrayList<>();
        for (Ranks rank : Ranks.values()) out.add(rank.name());
        return out;
    }

    private List<String> names() {
        List<String> out = new ArrayList<>();
        for (Player player : Bukkit.getOnlinePlayers()) out.add(player.getName());
        return out;
    }

    /**
     * Narrows a list to what starts with what has been typed.
     *
     * Case-insensitively, because nobody types `crate_LEGENDARY` and a
     * completer that only matches exact case reads as one that is broken.
     */
    private List<String> matching(List<String> options, String typed) {
        if (typed.isEmpty()) return new ArrayList<>(options);

        String lower = typed.toLowerCase(Locale.ROOT);
        List<String> out = new ArrayList<>();

        for (String option : options) {
            if (option.toLowerCase(Locale.ROOT).startsWith(lower)) out.add(option);
        }
        return out;
    }
}
