package dev.nexuscraft.nexus;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Ready-made holograms, because a blank prompt is not a feature.
 *
 * Somebody handed a command that draws any text they like will write "SHOP" in
 * white and move on, and the lobby ends up looking like a spreadsheet. These
 * are the same command with the design already done — a heading, a colour that
 * means something, and a line underneath saying what to do.
 *
 * Each one carries its own size. A welcome sign wants to be enormous and a
 * label over a doorway does not, and the whole reason for moving holograms onto
 * display entities was to make that difference possible.
 */
public final class Presets {

    /** A preset: the lines, how big, and whether it sits on a dark panel. */
    public record Preset(String name, List<String> lines, float scale, boolean backdrop) {
    }

    private static final Map<String, Preset> ALL = new LinkedHashMap<>();

    private static void add(String id, float scale, boolean backdrop, String... lines) {
        // First one wins, so the hand-written wording above survives the
        // generated pass that runs after it.
        ALL.putIfAbsent(id, new Preset(id, List.of(lines), scale, backdrop));
    }

    static {
        add("welcome", 2.6f, false,
                "&b&lNEXUS",
                "&7welcome to the server",
                "",
                "&fRight click a bot to play");

        add("bigwelcome", 4.0f, false,
                "&b&lNEXUS");

        add("worlds", 2.0f, false,
                "&b&lWORLDS",
                "&7survival · prison · skyblock · one block");

        add("market", 2.0f, false,
                "&6&lMARKET",
                "&7buy, sell, enchant and get paid");

        add("crates", 2.0f, false,
                "&e&lCRATES",
                "&7right click with a key");

        add("leaderboard", 1.4f, true,
                "&6&lTOP PLAYERS",
                Holograms.LEADERBOARD);

        add("online", 1.6f, false,
                Holograms.ONLINE);

        add("rules", 1.3f, true,
                "&c&lRULES",
                "&71. Do not grief anybody's build",
                "&72. Do not cheat or use hacked clients",
                "&73. Keep chat friendly",
                "&74. Have a good time");

        add("newhere", 1.5f, true,
                "&a&lNEW HERE?",
                "&7Take a job with &f/jobs",
                "&7Claim your daily with &f/daily",
                "&7Three tasks a day with &f/quests");

        add("money", 1.5f, true,
                "&6&lMAKING MONEY",
                "&7Mine in prison, sell with &f/sell",
                "&7Take a job with &f/jobs",
                "&7Check the trader with &f/deals");

        add("shop", 1.8f, false,
                "&a&lSHOP",
                "&7six aisles, everything from dirt to a beacon");

        add("sell", 1.8f, false,
                "&e&lSELL",
                "&7drop things in, close the window");

        add("vault", 1.8f, false,
                "&d&lVAULT",
                "&7anything waiting for you is in here");

        add("wardrobe", 1.8f, false,
                "&5&lWARDROBE",
                "&7trails and hats");

        add("enchanter", 1.8f, false,
                "&b&lENCHANTER",
                "&7pay to improve what you are holding");

        add("jobs", 1.8f, false,
                "&2&lJOB BOARD",
                "&7get paid for what you already do");

        add("skins", 1.8f, false,
                "&d&lSKIN SHOP",
                "&7change how you look here");

        add("discord", 1.6f, true,
                "&9&lDISCORD",
                "&7discord.gg/yourserver");

        add("vote", 1.6f, true,
                "&e&lVOTE",
                "&7vote for us and get a key");

        /*
         * The games, which had no presets at all.
         *
         * Twenty presets and not one of them named a thing anybody plays, so
         * signing a minigame meant typing every line by hand and remembering
         * the colour codes. Each of these is what a sign at the door of that
         * game should say: what it is, and the one command to start.
         */

        add("digsite", 2.6f, false,
                "&6&lTHE DIG SITE",
                "&7dig, sell, upgrade, dig deeper");

        add("dighow", 1.3f, true,
                "&6&lHOW TO DIG",
                "&f1. &7Dig the ground - your pack fills up",
                "&f2. &7Sell to the buyer at the camp",
                "&f3. &7Buy a bigger pack and a better shovel",
                "&f4. &7The deeper you go, the better it pays",
                "",
                "&e/dig &7for everything, &e/dig camp &7to climb out");

        add("digdetector", 1.3f, true,
                "&b&lMETAL DETECTOR",
                "&7There is treasure buried out there",
                "&7Buy a detector and follow the meter",
                "",
                "&7The ground resets on a timer -",
                "&7and the treasure moves with it");

        add("prison", 2.6f, false,
                "&8&lTHE PRISON",
                "&7mine, rank up, mine somewhere better");

        add("prisonhow", 1.3f, true,
                "&8&lHOW TO PRISON",
                "&f1. &7&e/mine &7to your cell block",
                "&f2. &7Mine, then &e/sell &7what you got",
                "&f3. &7&e/rankup &7when you can afford it",
                "&f4. &7Better ranks get better mines");

        add("dropper", 2.6f, false,
                "&d&lTHE DROPPER",
                "&7fall a long way and do not hit anything");

        add("parkour", 2.6f, false,
                "&a&lPARKOUR",
                "&7jump it faster than everybody else");

        add("skyblock", 2.6f, false,
                "&b&lSKYBLOCK",
                "&7one island, no ground, work it out");

        add("oneblock", 2.6f, false,
                "&e&lONE BLOCK",
                "&7break the same block forever");

        add("survival", 2.6f, false,
                "&2&lSURVIVAL",
                "&7the real game, with everybody else in it");

        add("minigames", 2.0f, false,
                "&c&lMINIGAMES",
                "&7bedwars · skywars · spleef · sumo",
                "&7murder mystery · hide and seek · duels",
                "",
                "&f&e/play &7to pick one");

        add("bedwars", 2.6f, false,
                "&c&lBEDWARS",
                "&7break their bed, keep yours");

        add("arena", 2.6f, false,
                "&4&lMOB ARENA",
                "&7waves of things that want you dead");

        add("games", 1.4f, true,
                "&b&lWHAT IS HERE",
                "&e/play    &7minigames",
                "&e/mine    &7prison",
                "&e/dig     &7the dig site",
                "&e/warp    &7everywhere else",
                "",
                "&7Right click a bot to be taken there");

        /*
         * The rest of the arrows.
         *
         * There was one, pointing down. A sign that can only point down is a
         * sign you cannot use at the top of a staircase, at a fork, or beside
         * a door - which is most of the places anybody wants one.
         */
        add("arrowup", 1.4f, false,
                "&f\u25b2",
                "&7up here");

        add("arrowleft", 1.4f, false,
                "&f\u25c0",
                "&7that way");

        add("arrowright", 1.4f, false,
                "&f\u25b6",
                "&7that way");

        /* ------------------------------------------------- things with no sign */

        add("boss", 2.6f, false,
                "&4&lTHE WARDEN",
                "&7rises here every hour",
                "",
                "&f&e/boss &7for the countdown");

        add("bosshow", 1.3f, true,
                "&4&lTHE WARDEN OF THE DEEP",
                "&7It has more health than one person can chew through.",
                "&7Bring people.",
                "",
                "&f\u2022 &7Waves arrive as it weakens",
                "&f\u2022 &7At a quarter left it stops being slow",
                "&f\u2022 &7Everyone who hurts it is paid a share",
                "",
                "&7Not just whoever lands the last hit.");

        add("season", 2.0f, false,
                "&6&lTHE SEASON",
                "&7six weeks, then everybody starts again",
                "",
                "&f&e/prestige &7for how long is left");

        add("feed", 1.4f, true,
                "&b&lWHAT IS HAPPENING",
                "&e/feed &7for the last few things",
                "&7somebody did that were worth seeing");

        add("guilds", 2.0f, false,
                "&5&lGUILDS",
                "&7bring people, hold ground",
                "",
                "&f&e/guild &7to start one");

        add("territories", 2.0f, false,
                "&5&lTERRITORY",
                "&7guilds hold it, guilds lose it");

        add("quests", 2.0f, false,
                "&a&lQUESTS",
                "&7a new set every day",
                "",
                "&f&e/quests");

        add("daily", 1.6f, false,
                "&e&lDAILY REWARD",
                "&7come back tomorrow for more",
                "&f&e/daily");

        add("pets", 2.0f, false,
                "&d&lPETS",
                "&7something that follows you around",
                "&f&e/pets");

        add("auction", 2.0f, false,
                "&6&lAUCTION HOUSE",
                "&7sell to everybody, not just whoever is on",
                "&f&e/ah");

        add("bounties", 2.0f, false,
                "&c&lBOUNTIES",
                "&7put money on somebody's head",
                "&f&e/bounty <player>");

        add("claims", 1.3f, true,
                "&2&lCLAIM YOUR LAND",
                "&f1. &7&e/claim &7for the wand",
                "&f2. &7Click two opposite corners",
                "&f3. &7&e/claim &7again to take it",
                "",
                "&7Nobody can build on it but you",
                "&7and whoever you &e/trust&7.");

        add("homes", 1.6f, false,
                "&b&lHOMES",
                "&e/sethome &7where you are",
                "&e/home &7to come back");

        add("warps", 1.6f, false,
                "&b&lPLAYER WARPS",
                "&e/pwarps &7to see where people have opened up");

        /* -------------------------------------------------- how you play them */

        add("skyblockhow", 1.3f, true,
                "&b&lHOW TO SKYBLOCK",
                "&f1. &7&e/is &7for your island",
                "&f2. &7Do not fall off",
                "&f3. &7Make a tree farm before anything else",
                "&f4. &7&e/is upgrades &7when you can afford them",
                "",
                "&7The chest has enough to start and no more.");

        add("oneblockhow", 1.3f, true,
                "&e&lHOW TO ONE BLOCK",
                "&f1. &7Break the block",
                "&f2. &7Break it again",
                "&f3. &7It changes as you go deeper",
                "",
                "&7Build out before you build up.");

        add("survivalhow", 1.3f, true,
                "&2&lSURVIVAL",
                "&7The ordinary game, with everybody else in it.",
                "",
                "&f\u2022 &7&e/claim &7so nobody touches your build",
                "&f\u2022 &7&e/sethome &7so you can get back",
                "&f\u2022 &7&e/boss &7when the Warden rises",
                "&f\u2022 &7&e/ah &7to sell what you do not need");

        /* ------------------------------------------------------------ utility */

        add("spawn", 2.6f, false,
                "&b&lSPAWN",
                "&7everything starts here");

        add("staffonly", 1.4f, true,
                "&c&lSTAFF ONLY",
                "&7nothing past here is yours");

        add("pvp", 1.6f, true,
                "&c&lPVP",
                "&7people can hurt you here",
                "&7and they will");

        add("safe", 1.6f, true,
                "&a&lSAFE",
                "&7nobody can hurt you here");

        add("comingsoon", 1.6f, true,
                "&8&lCOMING SOON",
                "&7there is nothing here yet");

        add("shopfree", 1.3f, true,
                "&6&lSTALL FOR RENT",
                "&7put your shop here",
                "",
                "&e/pwarp set &7so people can find it");

        add("arrow", 1.4f, false,
                "&f▼",
                "&7this way");

        // Last, so everything above keeps its own wording and this only fills
        // in the bots nobody wrote a sign for.
        fillFromHub();
    }

    private Presets() {
    }

    /**
     * One for every bot the hub can place, made from what the hub already says.
     *
     * There were thirty-four presets and fifteen of the thirty bots had none -
     * creative among them - because each was written out by hand and the list
     * drifted the moment a game was added. These are built from the same
     * Destination and Service definitions the bots themselves come from, so a
     * game added tomorrow has a matching sign the same day.
     *
     * Only fills gaps. A hand-written preset above keeps its own wording.
     */
    private static void fillFromHub() {
        for (Hub.Destination destination : Hub.DESTINATIONS) {
            add(destination.id(), 2.4f, false,
                    "&b&l" + destination.name().toUpperCase(java.util.Locale.ROOT),
                    "&7" + destination.blurb());
        }

        for (Hub.Service service : Hub.SERVICES) {
            add(service.id(), 2.0f, false,
                    "&6&l" + service.name().toUpperCase(java.util.Locale.ROOT),
                    "&7" + service.blurb());
        }
    }

    /**
     * The two signs that list things, rebuilt from what is really registered.
     *
     * Both were typed out by hand and both were wrong: the minigames board
     * named seven of the thirteen games, and the worlds board missed creative
     * and the dig site entirely. A sign that lists things cannot be written
     * down once - it has to be built from the same place the things come from,
     * or it is a lie the day after somebody adds one.
     *
     * Called after the games register themselves, and overwrites rather than
     * fills a gap, because the hand-written versions are what it is replacing.
     */
    public static void refresh(Nexus nexus) {
        List<String> games = new java.util.ArrayList<>();
        for (Game game : nexus.games().all()) games.add(game.name().toLowerCase(Locale.ROOT));

        if (!games.isEmpty()) {
            List<String> lines = new java.util.ArrayList<>();
            lines.add("&c&lMINIGAMES");

            // Three to a line: long enough to be worth a line, short enough to
            // read from across a courtyard.
            for (int at = 0; at < games.size(); at += 3) {
                lines.add("&7" + String.join(" \u00b7 ",
                        games.subList(at, Math.min(at + 3, games.size()))));
            }

            lines.add("");
            lines.add("&f&e/play &7to pick one");

            ALL.put("minigames", new Preset("minigames", List.copyOf(lines), 2.0f, false));
        }

        List<String> worlds = new java.util.ArrayList<>();
        // Every world the hub can send somebody to, in the order they are
        // declared - which is roughly the order they matter in.
        for (Worlds.Place place : Worlds.Place.values()) {
            worlds.add(place.label.toLowerCase(Locale.ROOT));
        }

        if (!worlds.isEmpty()) {
            List<String> lines = new java.util.ArrayList<>();
            lines.add("&b&lWORLDS");

            for (int at = 0; at < worlds.size(); at += 3) {
                lines.add("&7" + String.join(" \u00b7 ",
                        worlds.subList(at, Math.min(at + 3, worlds.size()))));
            }

            ALL.put("worlds", new Preset("worlds", List.copyOf(lines), 2.0f, false));
        }
    }

    public static Preset get(String id) {
        return ALL.get(id.toLowerCase(java.util.Locale.ROOT));
    }

    public static List<String> names() {
        return List.copyOf(ALL.keySet());
    }
}
