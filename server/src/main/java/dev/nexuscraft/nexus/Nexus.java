package dev.nexuscraft.nexus;

import dev.nexuscraft.nexus.bedwars.BedWars;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Bukkit;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.scoreboard.Scoreboard;
import org.bukkit.scoreboard.Team;

import java.util.Comparator;
import java.util.Map;
import java.util.UUID;

/**
 * The server.
 *
 * A minigame network is three things: somewhere to stand, a way to get into a
 * game, and a reason to play the next one. Those are the hub, the queue, and
 * the stats — and BedWars is one game plugged into them rather than the point
 * of the whole plugin. Adding Duels later is a class, not a rewrite.
 *
 * Everything is wired here and nowhere else, so the order things start in is
 * something you can read rather than infer.
 */
public final class Nexus extends JavaPlugin {

    private Stats stats;
    private Hub hub;
    private Games games;
    private Parties parties;
    private Settings settings;
    private Worlds worlds;
    private Prison prison;
    private Backpacks backpacks;
    private OneBlock oneBlock;
    private int elapsedTicks;
    private SkyBlock skyBlock;
    private Packs packs;
    private Holograms holograms;
    private Feed feed;
    private Boss boss;
    private Crates crates;
    private Rewards rewards;
    private Quests quests;
    private Vault vault;
    private Cosmetics cosmetics;
    private Armoury armoury;
    private Jobs jobs;
    private Trader trader;
    private Skins skins;
    private Layout layout;
    private Parkour parkour;
    private Dropper dropper;
    private Placer placer;
    private Events events;
    private ChatGames chatGames;
    private Completions completions;
    private Afk afk;
    private Homes homes;
    private DiscordFeed discord;
    private Claims claims;
    private Wipe wipe;
    private PlayerShops playerShops;
    private Skills skills;
    private Warps warps;
    private IslandTemplate islandTemplate;
    private IslandTeam islandTeam;
    private Dimensions dimensions;
    private MobArena mobArena;
    private Portals portals;
    private Toolkit toolkit;
    private Plots plots;
    private Guilds guilds;
    private Dungeons dungeons;
    private Blueprints blueprints;
    private DigSite digSite;
    private IslandNether islandNether;
    private Territories territories;
    private PixelArt pixelArt;
    private IslandUpgrades islandUpgrades;
    private Challenges challenges;
    private BlockLog blockLog;
    private Achievements achievements;
    private Pets pets;
    private Bounties bounties;
    private Kits kits;
    private Auction auction;
    private Guide guide;
    private Seasons seasons;
    private Punishments punishments;
    private ChatGuard chatGuard;
    private Backups backups;
    private Teleports teleports;
    private Whispers whispers;
    private Voting voting;

    @Override
    public void onEnable() {
        getDataFolder().mkdirs();

        settings = new Settings(this);
        stats = new Stats(getDataFolder());
        parties = new Parties(this);
        hub = new Hub(this);
        games = new Games(this);
        worlds = new Worlds(this);
        prison = new Prison(this);
        backpacks = new Backpacks(this);
        oneBlock = new OneBlock(this);
        skyBlock = new SkyBlock(this);
        packs = new Packs(this);
        holograms = new Holograms(this);
        feed = new Feed(this);
        boss = new Boss(this);
        crates = new Crates(this);
        rewards = new Rewards(this);
        vault = new Vault(this);
        quests = new Quests(this);
        cosmetics = new Cosmetics(this);
        armoury = new Armoury(this);
        jobs = new Jobs(this);
        trader = new Trader(this);
        skins = new Skins(this);
        layout = new Layout(this);
        parkour = new Parkour(this);
        dropper = new Dropper(this);
        placer = new Placer(this);
        events = new Events(this);
        chatGames = new ChatGames(this);
        completions = new Completions(this);
        afk = new Afk(this);
        homes = new Homes(this);
        discord = new DiscordFeed(this);
        claims = new Claims(this);
        wipe = new Wipe(this);
        playerShops = new PlayerShops(this);
        skills = new Skills(this);
        warps = new Warps(this);
        islandTemplate = new IslandTemplate(this);
        islandTeam = new IslandTeam(this);
        dimensions = new Dimensions(this);
        mobArena = new MobArena(this);
        portals = new Portals(this);
        toolkit = new Toolkit(this);
        plots = new Plots(this);
        guilds = new Guilds(this);
        dungeons = new Dungeons(this);
        blueprints = new Blueprints(this);
        digSite = new DigSite(this);
        islandNether = new IslandNether(this);
        territories = new Territories(this);
        pixelArt = new PixelArt(this);
        islandUpgrades = new IslandUpgrades(this);
        challenges = new Challenges(this);
        blockLog = new BlockLog(this);
        achievements = new Achievements(this);
        pets = new Pets(this);
        bounties = new Bounties(this);
        kits = new Kits(this);
        auction = new Auction(this);
        guide = new Guide(this);
        seasons = new Seasons(this);
        punishments = new Punishments(this);
        chatGuard = new ChatGuard(this);
        backups = new Backups(this);
        teleports = new Teleports(this);
        whispers = new Whispers(this);
        voting = new Voting(this);

        games.register(new BedWars());
        games.register(new dev.nexuscraft.nexus.minigames.Spleef());
        games.register(new dev.nexuscraft.nexus.minigames.TntRun());
        games.register(new dev.nexuscraft.nexus.minigames.Sumo());
        games.register(new dev.nexuscraft.nexus.minigames.Duels());
        games.register(new dev.nexuscraft.nexus.minigames.SkyWars());
        games.register(new dev.nexuscraft.nexus.minigames.OneInTheChamber());
        games.register(new dev.nexuscraft.nexus.minigames.BuildBattle());
        games.register(new dev.nexuscraft.nexus.minigames.MurderMystery());
        games.register(new dev.nexuscraft.nexus.minigames.HideAndSeek());

        getServer().getPluginManager().registerEvents(new Listeners(this), this);

        // The world is built now rather than when the first player arrives, so
        // that the cost lands on startup instead of on somebody's join.
        hub.world();

        /*
         * The generated worlds are laid out now, for the same reason as the hub
         * and one more besides.
         *
         * A version bump makes `world()` delete the world and build it again,
         * which took six seconds and used to happen the first time somebody ran
         * /parkour. A player teleporting in during that window is not yet in
         * world.getPlayers(), so the evacuation missed them, the world was
         * unloaded under them, and the next tick threw "Chunk system has shut
         * down" and dropped them with "Internal server error".
         *
         * Doing it here means the only time a world is destroyed is when nobody
         * is on the server at all.
         */
        parkour.world();
        dropper.world();

        /*
         * And every world somebody can log out in.
         *
         * These were made on demand, which is fine until a player logs back
         * into one that has not been made yet: their saved world does not
         * exist, so the server puts them in the default overworld instead -
         * which is not one of these places, so the lobby could not work out
         * what they were carrying and cleared it. That is an inventory
         * destroyed by a world being a second late.
         */
        for (Worlds.Place place : Worlds.Place.values()) {
            if (place == Worlds.Place.PARKOUR || place == Worlds.Place.DROPPER) continue;
            worlds.of(place);
        }

        // Survival's other two dimensions, for the same reason.
        dimensions.warmUp();

        // And the islands', so a portal lit on one never finds them missing.
        islandNether.warmUp();

        // Nothing to build - only a word if one has been broken since.
        portals.check();

        // And creative's grid, which also clears the old quartz sheet.
        plots.warmUp();

        // The dig site's camp, so its two greeters are there from the start.
        digSite.warmUp();

        hub.placeNpcs();
        holograms.rebuild();

        /*
         * Anything left over from last time.
         *
         * A pet is deliberately never persistent, but "never" depends on a
         * clean shutdown - a crash writes the chunk with the entity still in
         * it, and it comes back with nobody to follow. Sweeping at startup
         * means the worst case is one stray for the length of one session
         * rather than one more every time the server falls over.
         */
        voting.start();

        int strays = pets.sweep();
        if (strays > 0) getLogger().info("removed " + strays + " stray pets");

        /*
         * One tick a second drives everything with a clock on it.
         *
         * Queues, countdowns, generators and sidebars all run from here rather
         * than each scheduling their own task. One timer is one place to look
         * when something is running at the wrong speed, and it guarantees the
         * sidebar and the thing it is describing were read in the same instant.
         */
        getServer().getScheduler().runTaskTimer(this, () -> {
            games.tick();
            prison.tick();
            rewards.tick();
            oneBlock.tick();
            trader.tick();
            events.tick();
            chatGames.tick();
            afk.tick();
            blockLog.tick();
            achievements.tick();
            auction.tick();
            guide.tick();
            teleports.tick();

            /*
             * Backups count in minutes, so they are ticked from the one second
             * clock rather than given a timer of their own - one timer is one
             * place to look when something runs at the wrong speed.
             */
            if (elapsedTicks % 60 == 0) backups.tick();
            skyBlock.tick();
            skyBlock.tickScan();

            // Leaderboards and player counts go stale otherwise. Every five
            // seconds is far more often than either actually changes.
            if (elapsedTicks++ % 5 == 0) {
                holograms.rebuild();
                hub.refreshNpcLabels();
            }
            for (Player player : getServer().getOnlinePlayers()) {
                if (hub.isHub(player)) hub.refresh(player);
            }
        }, 20L, 20L);

        /*
         * A second timer, twenty times a second, for the one thing that needs it.
         *
         * TNT Run deletes the block under a running player, and at one tick a
         * second somebody crosses three blocks between checks - the floor
         * vanishes in stripes behind them instead of under them. Everything
         * else stays on the slow timer, because running a scoreboard twenty
         * times a second is pure waste.
         */
        getServer().getScheduler().runTaskTimer(this, () -> {
            for (Match match : games.running()) {
                if (match instanceof dev.nexuscraft.nexus.minigames.TntRun.TntRunMatch tnt) {
                    tnt.crumble();
                }
            }

            // Pets move on the fast timer too. Once a second is a pet that
            // teleports in visible jumps rather than one that follows.
            pets.tick();

            // Particle trails, which throttle themselves internally.
            cosmetics.tick();

            // Claim borders, drawn only for whoever is holding the wand.
            claims.tick();

            // The mining perk, renewed rather than reapplied every tick.
            skills.tick();

            /*
             * Parkour and the dropper have to be watched every tick.
             *
             * A falling player covers thirty blocks a second, so a once-a-second
             * check misses the water entirely and reports a splat into the pool
             * they landed safely in. Parkour is the same problem more slowly:
             * you cross a checkpoint block in well under a second, and a missed
             * checkpoint on jump fifty is how somebody stops playing.
             */
            parkour.tick();
            dropper.tick();
        }, 1L, 1L);

        // The dig site's two greeters, put back if a chunk unload took them.
        getServer().getScheduler().runTaskTimer(this, () -> digSite.tick(), 400L, 100L);

        /*
         * The dig site's countdown, once a second.
         *
         * Its own timer rather than a faster `tick`, which only checks the two
         * greeters are still standing and has no business running twenty times
         * as often for that.
         */
        // After the games have registered, so the signs that list them are
        // built from the real set rather than a list written out by hand.
        Presets.refresh(this);

        /*
         * The season clock, once a minute.
         *
         * Slow on purpose: it is counting down weeks, and the only thing it
         * does most of the time is compare two numbers.
         */
        getServer().getScheduler().runTaskTimer(this, () -> seasons.tick(), 1200L, 1200L);

        // The boss keeps the same slow clock: it is counting down hours.
        getServer().getScheduler().runTaskTimer(this, () -> boss.tick(), 1200L, 1200L);

        // Anything a crash left standing in the arena, before the first one rises.
        boss.sweep();

        digSite.startClock();
        getServer().getScheduler().runTaskTimer(this, () -> digSite.resetTick(), 100L, 20L);

        /*
         * The detector, twice a second.
         *
         * Faster than the countdown because a meter that updates once a second
         * reads as broken while somebody is walking - the whole point of it is
         * that it responds to moving.
         */
        getServer().getScheduler().runTaskTimer(this, () -> digSite.detectorTick(), 100L, 10L);

        // Capture points, decided entirely from who is standing on them.
        getServer().getScheduler().runTaskTimer(this, () -> territories.tick(), 300L, 20L);

        // The lobby's sky, held at noon and clear against anything that
        // moves it. Cheap: two comparisons unless something is actually wrong.
        getServer().getScheduler().runTaskTimer(this, () -> hub.holdSky(), 100L, 100L);

        /*
         * Dungeons, built and woken as people wander near them.
         *
         * Every three seconds rather than on movement: a move handler runs
         * several times a second for every player on the server, and nothing
         * here needs to know that quickly.
         */
        getServer().getScheduler().runTaskTimer(this, () -> dungeons.tick(), 200L, 60L);

        // Stats are held in memory; this is the only thing that makes them
        // survive a crash rather than a clean shutdown.
        getServer().getScheduler().runTaskTimer(this, () -> {
            stats.save();
            backpacks.save();
            vault.save();
        }, 6000L, 6000L);

        getLogger().info("Nexus ready — " + games.all().size() + " game(s)");
    }

    @Override
    public void onDisable() {
        if (boss != null) boss.shutdown();
        if (games != null) games.stopEverything();
        if (stats != null) stats.save();
        if (backpacks != null) backpacks.save();
        if (vault != null) vault.save();
        if (homes != null) homes.save();
        if (claims != null) claims.save();
        if (playerShops != null) playerShops.save();
        if (warps != null) warps.save();
        if (islandTeam != null) islandTeam.save();
        if (kits != null) kits.save();
        if (auction != null) auction.save();
        if (punishments != null) punishments.save();

        /*
         * After every save above and not before, so the snapshot holds what
         * the session actually ended with rather than what it started with.
         */
        if (backups != null) backups.takeDataSnapshot();
        if (voting != null) voting.stop();
        if (blockLog != null) blockLog.flushNow();
    }

    public Stats stats() {
        return stats;
    }

    public Hub hub() {
        return hub;
    }

    public Games games() {
        return games;
    }

    public Parties parties() {
        return parties;
    }

    public Settings settings() {
        return settings;
    }

    public Worlds worlds() {
        return worlds;
    }

    public Prison prison() {
        return prison;
    }

    public Backpacks backpacks() {
        return backpacks;
    }

    public OneBlock oneBlock() {
        return oneBlock;
    }

    public SkyBlock skyBlock() {
        return skyBlock;
    }

    public Packs packs() {
        return packs;
    }

    public Holograms holograms() {
        return holograms;
    }

    public Feed feed() {
        return feed;
    }

    public Boss boss() {
        return boss;
    }

    public Crates crates() {
        return crates;
    }

    public Rewards rewards() {
        return rewards;
    }

    public Quests quests() {
        return quests;
    }

    public Vault vault() {
        return vault;
    }

    public Cosmetics cosmetics() {
        return cosmetics;
    }

    /**
     * The circuits the launcher has written, for tab completion.
     *
     * Read off disk each time rather than cached: they arrive while the server
     * is running, and a list that needs a restart to notice a new one would be
     * a list nobody trusts.
     */
    public java.util.List<String> circuitNames() {
        java.io.File dir = new java.io.File(getDataFolder(), "circuits");
        String[] found = dir.list((where, name) -> name.endsWith(".txt"));

        if (found == null) return java.util.List.of();

        java.util.List<String> names = new java.util.ArrayList<>();
        for (String name : found) names.add(name.substring(0, name.length() - 4));

        return names;
    }

    public Armoury armoury() {
        return armoury;
    }

    public Jobs jobs() {
        return jobs;
    }

    public Trader trader() {
        return trader;
    }

    public Skins skins() {
        return skins;
    }

    /**
     * Whether this item belongs to the server rather than to the player.
     *
     * The hub compass, the claim wand and a cosmetic hat are all handed out
     * freely and replaced on demand, so they are worth nothing - but nothing
     * stopped one being sold, and somebody put their compass in the auction
     * house. Asked in one place because the answer has to be the same for the
     * shop, the auction and the bin.
     */
    public boolean serverTool(org.bukkit.inventory.ItemStack item) {
        if (item == null) return false;
        return Hub.isSelector(this, item) || claims.isWand(item) || cosmetics.ours(item)
                || toolkit.isWand(item);
    }

    public Parkour parkour() {
        return parkour;
    }

    public Dropper dropper() {
        return dropper;
    }

    public Placer placer() {
        return placer;
    }

    public Events events() {
        return events;
    }

    public ChatGames chatGames() {
        return chatGames;
    }

    public Afk afk() {
        return afk;
    }

    public Homes homes() {
        return homes;
    }

    public DiscordFeed discord() {
        return discord;
    }

    public IslandUpgrades islandUpgrades() {
        return islandUpgrades;
    }

    public Challenges challenges() {
        return challenges;
    }

    public PixelArt pixelArt() {
        return pixelArt;
    }

    public Territories territories() {
        return territories;
    }

    public IslandNether islandNether() {
        return islandNether;
    }

    public DigSite digSite() {
        return digSite;
    }

    public Blueprints blueprints() {
        return blueprints;
    }

    public Dungeons dungeons() {
        return dungeons;
    }

    public Guilds guilds() {
        return guilds;
    }

    public Plots plots() {
        return plots;
    }

    public Toolkit toolkit() {
        return toolkit;
    }

    public Portals portals() {
        return portals;
    }

    public MobArena mobArena() {
        return mobArena;
    }

    public Dimensions dimensions() {
        return dimensions;
    }

    public IslandTeam islandTeam() {
        return islandTeam;
    }

    public IslandTemplate islandTemplate() {
        return islandTemplate;
    }

    public Warps warps() {
        return warps;
    }

    public Skills skills() {
        return skills;
    }

    public PlayerShops playerShops() {
        return playerShops;
    }

    public Wipe wipe() {
        return wipe;
    }

    public Claims claims() {
        return claims;
    }

    public BlockLog blockLog() {
        return blockLog;
    }

    public Achievements achievements() {
        return achievements;
    }

    public Pets pets() {
        return pets;
    }

    public Bounties bounties() {
        return bounties;
    }

    public Kits kits() {
        return kits;
    }

    public Auction auction() {
        return auction;
    }

    public Guide guide() {
        return guide;
    }

    public Seasons seasons() {
        return seasons;
    }

    public Punishments punishments() {
        return punishments;
    }

    public ChatGuard chatGuard() {
        return chatGuard;
    }

    public Backups backups() {
        return backups;
    }

    public Teleports teleports() {
        return teleports;
    }

    public Whispers whispers() {
        return whispers;
    }

    public Voting voting() {
        return voting;
    }

    /**
     * Sends somebody wherever an NPC points.
     *
     * The minigames are the odd one out: everywhere else is a place you go, but
     * Bed Wars is a queue you join, so its greeter puts you in one rather than
     * teleporting you into an empty arena.
     */
    public void travel(Player player, String destination) {
        switch (destination) {
            case "survival" -> worlds.send(player, Worlds.Place.SURVIVAL);
            case "prison" -> worlds.send(player, Worlds.Place.PRISON);
            case "creative" -> worlds.send(player, Worlds.Place.CREATIVE);
            case "oneblock" -> worlds.send(player, Worlds.Place.ONEBLOCK);
            case "skyblock" -> worlds.send(player, Worlds.Place.SKYBLOCK);
            case "parkour" -> parkour.begin(player);
            case "dropper" -> dropper.begin(player, 0);
            case "arena" -> mobArena.begin(player);

            case "digsite" -> {
                worlds.send(player, Worlds.Place.DIGSITE);
                digSite.arrive(player);
            }
            default -> {
                /*
                 * Anything that is a registered game is a queue to join.
                 *
                 * Asked of the registry rather than listed here, because the
                 * list here was already wrong: four games had been added and
                 * every one of them told players the gate went nowhere.
                 */
                Game game = games.byId(destination);

                if (game != null) games.join(player, game);
                else player.sendMessage(Text.bad("That gate goes nowhere yet."));
            }
        }
    }

    /**
     * Sorts the tab list by rank.
     *
     * Bukkit orders the player list by scoreboard team name and offers no other
     * hook, so the rank has to be encoded into a team name that happens to sort
     * the way we want. It looks like a hack because it is one; there is no
     * other way to do it.
     */
    public void nameplates() {
        Scoreboard board = getServer().getScoreboardManager().getMainScoreboard();

        for (Player player : getServer().getOnlinePlayers()) {
            Ranks rank = stats.rankOf(player.getUniqueId());
            String name = rank.sortKey(player.getName());

            Team team = board.getTeam(name);
            if (team == null) team = board.registerNewTeam(name);

            if (!rank.tag.isEmpty()) {
                team.prefix(Component.text("[" + rank.tag + "] ", rank.colour));
            }
            team.color(rank.colour);
            team.addEntry(player.getName());
        }
    }

    /* ------------------------------------------------------------ commands */

    /**
     * What tab offers.
     *
     * Bukkit completes a command name and nothing after it, because everything
     * after it is a string this plugin parses and Bukkit cannot see. Without
     * this, twenty-odd subcommands and twenty-one bot ids are only reachable by
     * remembering them exactly.
     */
    @Override
    public java.util.List<String> onTabComplete(CommandSender sender, Command command,
                                                String alias, String[] args) {
        return completions.forCommand(sender, command.getName(), args);
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        switch (command.getName().toLowerCase()) {
            case "hub" -> {
                if (!(sender instanceof Player player)) return true;

                Match match = games.matchOf(player.getUniqueId());
                if (match != null) match.remove(player);
                else {
                    games.leave(player, false);
                    hub.send(player);
                }
                return true;
            }

            /*
             * Its own command as well as /nexus build.
             *
             * It was only ever a subcommand of an operator menu fifteen entries
             * long, which is a poor home for the one thing you reach for every
             * time you want to change the lobby.
             */
            case "build" -> {
                if (!(sender instanceof Player player)) return true;
                if (!sender.hasPermission("nexus.admin")) {
                    sender.sendMessage(Text.bad("Not for you."));
                    return true;
                }
                buildMode(player);
                return true;
            }

            /*
             * The building tools.
             *
             * Gathered in one branch because they share a gate and a shape:
             * every one of them is an operator standing somewhere with two
             * corners picked, and writing that check thirteen times would be
             * thirteen chances to leave one of them open.
             */
            case "wand", "pos1", "pos2", "sel", "set", "replace", "walls",
                 "shell", "hollow", "copy", "paste", "undo", "buildhelp",
                 "redo", "stack", "move", "expand", "contract", "count",
                 "sphere", "cyl", "pyramid", "line", "overlay", "drain", "up" -> {
                if (!(sender instanceof Player player)) return true;
                if (!sender.hasPermission("nexus.admin")) {
                    sender.sendMessage(Text.bad("Not for you."));
                    return true;
                }
                return building(player, command.getName().toLowerCase(), args);
            }

            /*
             * Voting in Build Battle.
             *
             * A command rather than an item or a menu because the vote has to
             * arrive from a click on a line of chat, and a clickable line can
             * only run a command. It does nothing anywhere else.
             */
            case "rate" -> {
                if (!(sender instanceof Player player)) return true;

                Match playing = games.matchOf(player.getUniqueId());
                if (!(playing instanceof dev.nexuscraft.nexus.minigames
                        .BuildBattle.BuildBattleMatch battle)) {
                    player.sendMessage(Text.bad("Nothing to rate."));
                    return true;
                }

                int score;
                try {
                    score = Integer.parseInt(args.length > 0 ? args[0] : "");
                } catch (NumberFormatException notANumber) {
                    player.sendMessage(Text.bad("/rate 1 to 5"));
                    return true;
                }

                battle.rate(player, score);
                return true;
            }

            case "pixeltext", "ptext" -> {
                if (!(sender instanceof Player player)) return true;

                if (args.length < 2) {
                    player.sendMessage(Text.bad("/pixeltext <colour> <words>"));
                    player.sendMessage(Text.plain("  "
                            + String.join(", ", PixelArt.colourNames())));
                    return true;
                }

                /*
                 * A scale can follow the colour, or not.
                 *
                 * Read by looking rather than by a flag, because "cyan 3 NEXUS"
                 * and "cyan NEXUS" are both things somebody will type and
                 * neither should be an error.
                 */
                int scale = 1;
                int from = 1;

                try {
                    scale = Integer.parseInt(args[1]);
                    from = 2;
                } catch (NumberFormatException notAScale) {
                    /* No scale given; the words start here. */
                }

                if (from >= args.length) {
                    player.sendMessage(Text.bad("Nothing to write."));
                    return true;
                }

                String words = String.join(" ",
                        java.util.Arrays.copyOfRange(args, from, args.length));

                pixelArt.write(player, args[0], words, scale);
                return true;
            }

            case "pixel", "pixelart" -> {
                if (!(sender instanceof Player player)) return true;

                if (args.length == 0 || args[0].equalsIgnoreCase("list")
                        || args[0].equalsIgnoreCase("help")) {
                    pixelArt.help(player);
                    return true;
                }

                int scale = 1;
                if (args.length > 1) {
                    try {
                        scale = Integer.parseInt(args[1]);
                    } catch (NumberFormatException notANumber) {
                        player.sendMessage(Text.bad("'" + args[1] + "' is not a scale."));
                        return true;
                    }
                }

                pixelArt.place(player, args[0], scale);
                return true;
            }

            case "blueprint", "bp" -> {
                if (!(sender instanceof Player player)) return true;

                if (args.length == 0 || args[0].equalsIgnoreCase("list")
                        || args[0].equalsIgnoreCase("help")) {
                    blueprints.help(player);
                    return true;
                }

                /*
                 * Frame unless told otherwise.
                 *
                 * The default is the one that leaves the build yours - a full
                 * one dropped by accident is a lot of somebody else's blocks
                 * to take back out, and /undo only reaches five deep.
                 */
                boolean full = args.length > 1 && args[1].equalsIgnoreCase("full");
                String palette = args.length > 2 ? args[2] : "stone";

                blueprints.place(player, args[0].toLowerCase(), full, palette);
                return true;
            }

            case "dig" -> {
                if (!(sender instanceof Player player)) return true;

                if (args.length == 0) {
                    if (worlds.placeOf(player) == Worlds.Place.DIGSITE) digSite.help(player);
                    else travel(player, "digsite");
                    return true;
                }

                switch (args[0].toLowerCase()) {
                    case "sell" -> digSite.sell(player);
                    case "detector", "det" -> digSite.buyDetector(player);
                    case "museum" -> digSite.openMuseum(player);
                    case "prestige" -> digSite.prestige(player);
                    case "give", "donate" -> {
                        if (args.length < 2) {
                            digSite.openMuseum(player);
                        } else {
                            // Everything after the verb, so "Ancient Relic"
                            // works without anybody quoting it.
                            digSite.donate(player, String.join(" ",
                                    java.util.Arrays.copyOfRange(args, 1, args.length)));
                        }
                    }
                    case "camp", "up", "out" -> digSite.toCamp(player);
                    case "pack" -> digSite.buyPack(player);
                    case "shovel" -> digSite.buyShovel(player);
                    default -> digSite.help(player);
                }
                return true;
            }

            case "dungeon", "dungeons" -> {
                if (sender instanceof Player player) dungeons.where(player);
                return true;
            }

            case "gc" -> {
                if (!(sender instanceof Player player)) return true;

                if (args.length == 0) {
                    player.sendMessage(Text.bad("/gc <message>"));
                    return true;
                }
                guilds.chat(player, String.join(" ", args));
                return true;
            }

            case "guild", "g" -> {
                if (!(sender instanceof Player player)) return true;

                if (args.length == 0) {
                    guilds.help(player);
                    return true;
                }

                switch (args[0].toLowerCase()) {
                    case "create", "found" -> {
                        if (args.length < 2) {
                            player.sendMessage(Text.bad("/guild create <name>"));
                            return true;
                        }
                        guilds.create(player, args[1]);
                    }

                    case "invite" -> {
                        if (args.length < 2) {
                            player.sendMessage(Text.bad("/guild invite <name>"));
                            return true;
                        }
                        guilds.invite(player, args[1]);
                    }

                    case "accept", "join" -> guilds.accept(player);
                    case "leave" -> guilds.leave(player);
                    case "disband" -> guilds.disband(player);
                    case "top" -> guilds.top(player);
                    case "sethome" -> guilds.setHome(player);
                    case "home" -> guilds.home(player);

                    case "kick", "remove" -> {
                        if (args.length < 2) {
                            player.sendMessage(Text.bad("/guild kick <name>"));
                            return true;
                        }
                        guilds.kick(player, args[1]);
                    }

                    case "promote" -> {
                        if (args.length < 2) {
                            player.sendMessage(Text.bad("/guild promote <name>"));
                            return true;
                        }
                        guilds.promote(player, args[1], true);
                    }

                    case "demote" -> {
                        if (args.length < 2) {
                            player.sendMessage(Text.bad("/guild demote <name>"));
                            return true;
                        }
                        guilds.promote(player, args[1], false);
                    }

                    case "deposit", "pay" -> {
                        Double amount = money(player, args);
                        if (amount != null) guilds.deposit(player, amount);
                    }

                    case "withdraw", "take" -> {
                        Double amount = money(player, args);
                        if (amount != null) guilds.withdraw(player, amount);
                    }

                    case "land", "territory", "territories" -> territories.list(player);
                    case "info", "who" -> guilds.info(player, args.length > 1 ? args[1] : null);

                    default -> guilds.help(player);
                }
                return true;
            }

            case "plot", "plots", "p" -> {
                if (!(sender instanceof Player player)) return true;

                if (args.length == 0) {
                    plots.help(player);
                    return true;
                }

                switch (args[0].toLowerCase()) {
                    case "auto" -> plots.auto(player);
                    case "claim" -> plots.claim(player);
                    case "home", "h" -> plots.home(player);
                    case "info", "i" -> plots.info(player);
                    case "clear" -> plots.clear(player);
                    case "delete", "unclaim" -> plots.delete(player);

                    case "visit", "v" -> {
                        if (args.length < 2) {
                            player.sendMessage(Text.bad("/plot visit <name>"));
                            return true;
                        }
                        plots.visit(player, args[1]);
                    }

                    case "trust", "add" -> {
                        if (args.length < 2) {
                            player.sendMessage(Text.bad("/plot trust <name>"));
                            return true;
                        }
                        plots.trust(player, args[1]);
                    }

                    case "untrust", "remove" -> {
                        if (args.length < 2) {
                            player.sendMessage(Text.bad("/plot untrust <name>"));
                            return true;
                        }
                        plots.untrust(player, args[1]);
                    }

                    default -> plots.help(player);
                }
                return true;
            }

            case "party" -> {
                if (!(sender instanceof Player player)) return true;
                return party(player, args);
            }

            case "stats" -> {
                if (!(sender instanceof Player player)) return true;
                Player who = args.length > 0 ? Bukkit.getPlayerExact(args[0]) : player;

                if (who == null) {
                    player.sendMessage(Text.bad("That player is not online."));
                    return true;
                }
                showStats(player, who);
                return true;
            }

            case "shop" -> {
                if (sender instanceof Player player) Shops.open(this, player);
                return true;
            }

            case "pwarp" -> {
                if (!(sender instanceof Player player)) return true;

                if (args.length == 0) {
                    warps.list(player);
                    return true;
                }

                switch (args[0].toLowerCase()) {
                    case "set" -> {
                        if (args.length < 2) {
                            player.sendMessage(Text.bad("/pwarp set <name> [what is here]"));
                            return true;
                        }
                        String note = args.length > 2
                                ? String.join(" ", java.util.Arrays.copyOfRange(args, 2, args.length))
                                : "";
                        warps.set(player, args[1], note);
                    }
                    case "delete", "remove" -> {
                        if (args.length < 2) {
                            player.sendMessage(Text.bad("/pwarp delete <name>"));
                            return true;
                        }
                        warps.delete(player, args[1]);
                    }
                    case "mine", "list" -> warps.mine(player);
                    default -> warps.go(player, args[0]);
                }
                return true;
            }

            case "pwarps" -> {
                if (sender instanceof Player player) warps.list(player);
                return true;
            }

            case "arena" -> {
                if (sender instanceof Player player) mobArena.begin(player);
                return true;
            }

            case "challenges", "challenge" -> {
                if (!(sender instanceof Player player)) return true;

                if (args.length > 1 && args[0].equalsIgnoreCase("claim")) {
                    challenges.claim(player, args[1]);
                } else {
                    challenges.show(player);
                }
                return true;
            }

            case "skills" -> {
                if (sender instanceof Player player) skills.show(player);
                return true;
            }

            case "shops" -> {
                if (sender instanceof Player player) playerShops.mine(player);
                return true;
            }

            case "sell" -> {
                if (!(sender instanceof Player player)) return true;
                if (args.length > 0 && args[0].equalsIgnoreCase("prices")) Shops.showPrices(player);
                else Shops.sellAll(this, player);
                return true;
            }

            case "boss", "warden" -> {
                if (args.length > 0 && sender instanceof Player player
                        && switch (args[0].toLowerCase()) {
                            case "go", "warp", "tp", "arena" -> true;
                            default -> false;
                        }) {
                    boss.go(player);
                    return true;
                }

                boss.show(sender);
                return true;
            }

            case "feed", "lately", "news" -> {
                if (sender instanceof Player player) feed.show(player);
                return true;
            }

            case "skin", "skins" -> {
                if (sender instanceof Player player) skins.open(player);
                return true;
            }

            case "jobs", "job" -> {
                if (!(sender instanceof Player player)) return true;
                if (args.length > 0 && args[0].equalsIgnoreCase("info")) jobs.show(player);
                else jobs.open(player);
                return true;
            }

            case "deals" -> {
                if (sender instanceof Player player) trader.show(player);
                return true;
            }

            case "dropper", "shafts" -> {
                if (!(sender instanceof Player player)) return true;

                if (args.length == 0) {
                    dropper.list(player);
                    return true;
                }

                int shaft = tryInt(args[0], 0) - 1;
                if (shaft < 0 || shaft >= Dropper.shafts()) {
                    sender.sendMessage(Text.bad("There are "
                            + Dropper.shafts() + " shafts."));
                    dropper.list(player);
                    return true;
                }

                dropper.begin(player, shaft);
                return true;
            }

            case "parkour", "courses" -> {
                if (!(sender instanceof Player player)) return true;

                if (args.length == 0) {
                    parkour.list(player);
                    return true;
                }

                int course = tryInt(args[0], 0) - 1;
                if (course < 0 || course >= Course.count()) {
                    sender.sendMessage(Text.bad("There are "
                            + Course.count() + " courses."));
                    parkour.list(player);
                    return true;
                }

                parkour.begin(player, course);
                return true;
            }

            case "vote" -> {
                voting.show(sender);
                return true;
            }

            case "tpa" -> {
                if (!(sender instanceof Player player)) return true;
                if (args.length == 0) {
                    sender.sendMessage(Text.bad("/tpa <player>"));
                    return true;
                }
                teleports.request(player, args[0], false);
                return true;
            }

            case "tpahere" -> {
                if (!(sender instanceof Player player)) return true;
                if (args.length == 0) {
                    sender.sendMessage(Text.bad("/tpahere <player>"));
                    return true;
                }
                teleports.request(player, args[0], true);
                return true;
            }

            case "tpaccept" -> {
                if (sender instanceof Player player) teleports.accept(player);
                return true;
            }

            case "tpdeny" -> {
                if (sender instanceof Player player) teleports.deny(player);
                return true;
            }

            case "back" -> {
                if (sender instanceof Player player) teleports.goBack(player);
                return true;
            }

            case "rtp", "wild" -> {
                if (sender instanceof Player player) teleports.random(player);
                return true;
            }

            case "r", "reply" -> {
                if (!(sender instanceof Player player)) return true;

                if (args.length == 0) {
                    whispers.show(player);
                    return true;
                }
                whispers.reply(player, String.join(" ", args));
                return true;
            }

            case "mute" -> {
                if (!sender.hasPermission("nexus.admin")) return true;
                if (args.length < 2) {
                    sender.sendMessage(Text.bad("/mute <player> <30m|2h|7d|forever> [reason]"));
                    return true;
                }
                punishments.mute(sender, args[0], args[1], reasonFrom(args, 2));
                return true;
            }

            case "unmute" -> {
                if (!sender.hasPermission("nexus.admin")) return true;
                if (args.length == 0) {
                    sender.sendMessage(Text.bad("/unmute <player>"));
                    return true;
                }
                punishments.unmute(sender, args[0]);
                return true;
            }

            case "tempban" -> {
                if (!sender.hasPermission("nexus.admin")) return true;
                if (args.length < 2) {
                    sender.sendMessage(Text.bad("/tempban <player> <30m|2h|7d|forever> [reason]"));
                    return true;
                }
                punishments.ban(sender, args[0], args[1], reasonFrom(args, 2));
                return true;
            }

            case "unban" -> {
                if (!sender.hasPermission("nexus.admin")) return true;
                if (args.length == 0) {
                    sender.sendMessage(Text.bad("/unban <player>"));
                    return true;
                }
                punishments.unban(sender, args[0]);
                return true;
            }

            case "warn" -> {
                if (!sender.hasPermission("nexus.admin")) return true;
                if (args.length < 2) {
                    sender.sendMessage(Text.bad("/warn <player> <reason>"));
                    return true;
                }
                punishments.warn(sender, args[0], reasonFrom(args, 1));
                return true;
            }

            case "history" -> {
                if (!sender.hasPermission("nexus.admin")) return true;
                if (args.length == 0) {
                    sender.sendMessage(Text.bad("/history <player>"));
                    return true;
                }
                punishments.history(sender, args[0]);
                return true;
            }

            case "menu" -> {
                if (sender instanceof Player player) Menu.open(this, player);
                return true;
            }

            case "guide", "tutorial" -> {
                if (!(sender instanceof Player player)) return true;

                if (args.length > 0 && args[0].equalsIgnoreCase("stop")) guide.stop(player);
                else guide.begin(player);
                return true;
            }

            case "kit" -> {
                if (!(sender instanceof Player player)) return true;

                if (args.length == 0) kits.open(player);
                else kits.give(player, args[0].toLowerCase());
                return true;
            }

            case "kits" -> {
                if (sender instanceof Player player) kits.list(player);
                return true;
            }

            case "ah", "auction" -> {
                if (!(sender instanceof Player player)) return true;

                if (args.length == 0) {
                    auction.open(player);
                    return true;
                }

                switch (args[0].toLowerCase()) {
                    case "sell" -> auction.sell(player,
                            args.length > 1 ? tryDouble(args[1], 0) : 0);
                    case "mine" -> auction.mine(player);
                    default -> auction.open(player);
                }
                return true;
            }

            case "prestige" -> {
                if (!(sender instanceof Player player)) return true;

                if (args.length > 0 && args[0].equalsIgnoreCase("confirm")) {
                    seasons.prestige(player);
                } else {
                    seasons.show(player);
                }
                return true;
            }

            case "season" -> {
                seasons.standings(sender);
                return true;
            }

            case "achievements", "achievement", "ach" -> {
                if (sender instanceof Player player) achievements.open(player);
                return true;
            }

            case "pets", "pet" -> {
                if (sender instanceof Player player) pets.open(player);
                return true;
            }

            case "bounty" -> {
                if (!(sender instanceof Player player)) return true;

                if (args.length == 0) {
                    bounties.list(player);
                    return true;
                }
                if (args.length < 2) {
                    sender.sendMessage(Text.bad("/bounty <player> <amount>"));
                    return true;
                }

                bounties.place(player, args[0], tryDouble(args[1], 0));
                return true;
            }

            case "bounties", "wanted" -> {
                if (sender instanceof Player player) bounties.list(player);
                return true;
            }

            case "play" -> {
                if (!(sender instanceof Player player)) return true;

                if (args.length == 0) {
                    sender.sendMessage(Text.heading("Games"));
                    for (Game game : games.all()) {
                        sender.sendMessage(Text.field(game.id(),
                                game.name() + "  -  " + game.blurb()));
                    }
                    sender.sendMessage(Text.plain("  /play <game>"));
                    return true;
                }

                Game picked = games.byId(args[0].toLowerCase());
                if (picked == null) {
                    sender.sendMessage(Text.bad("No game called '" + args[0] + "'."));
                    return true;
                }

                games.join(player, picked);
                return true;
            }

            case "claim" -> {
                if (!(sender instanceof Player player)) return true;

                /*
                 * With no argument this means two different things depending on
                 * whether a box has been marked out, and doing the wrong one is
                 * cheap to undo either way: a marked box claims the box, and
                 * otherwise it claims the chunk underfoot as it always did.
                 */
                if (args.length > 0 && args[0].equalsIgnoreCase("wand")) {
                    claims.giveWand(player);
                } else if (claims.hasSelection(player.getUniqueId())) {
                    claims.claimSelection(player);
                } else {
                    claims.claim(player);
                }
                return true;
            }

            case "unclaim" -> {
                if (sender instanceof Player player) claims.unclaim(player);
                return true;
            }

            case "claiminfo" -> {
                if (sender instanceof Player player) claims.info(player);
                return true;
            }

            case "claims" -> {
                if (sender instanceof Player player) claims.list(player);
                return true;
            }

            case "trust" -> {
                if (!(sender instanceof Player player)) return true;
                if (args.length == 0) {
                    sender.sendMessage(Text.bad("/trust <player>"));
                    return true;
                }
                claims.trust(player, args[0]);
                return true;
            }

            case "untrust" -> {
                if (!(sender instanceof Player player)) return true;
                if (args.length == 0) {
                    sender.sendMessage(Text.bad("/untrust <player>"));
                    return true;
                }
                claims.untrust(player, args[0]);
                return true;
            }

            case "inspect" -> {
                if (sender instanceof Player player) blockLog.toggleInspect(player);
                return true;
            }

            case "sethome" -> {
                if (sender instanceof Player player) {
                    homes.set(player, args.length > 0 ? args[0] : "home");
                }
                return true;
            }

            case "home" -> {
                if (sender instanceof Player player) {
                    homes.go(player, args.length > 0 ? args[0] : "home");
                }
                return true;
            }

            case "delhome" -> {
                if (!(sender instanceof Player player)) return true;
                if (args.length == 0) {
                    sender.sendMessage(Text.bad("/delhome <name>"));
                    return true;
                }
                homes.remove(player, args[0]);
                return true;
            }

            case "homes" -> {
                if (sender instanceof Player player) homes.list(player);
                return true;
            }

            case "afk" -> {
                if (!(sender instanceof Player player)) return true;

                // Typing it marks you away immediately rather than waiting the
                // five minutes, which is what somebody stepping out wants.
                afk.markAway(player);
                return true;
            }

            case "vault" -> {
                if (sender instanceof Player player) vault.open(player);
                return true;
            }

            case "cosmetics" -> {
                if (sender instanceof Player player) cosmetics.open(player);
                return true;
            }

            case "daily" -> {
                if (sender instanceof Player player) rewards.claim(player);
                return true;
            }

            case "quests" -> {
                if (sender instanceof Player player) quests.show(player);
                return true;
            }

            case "keys" -> {
                if (!(sender instanceof Player player)) return true;

                player.sendMessage(Text.heading("Keys"));
                for (Crates.Tier tier : Crates.Tier.values()) {
                    int held = 0;
                    for (var stack : player.getInventory().getContents()) {
                        if (crates.tierOf(stack) == tier) held += stack.getAmount();
                    }
                    player.sendMessage(Text.field(tier.label, String.valueOf(held)));
                }
                player.sendMessage(Text.plain("  Right click the matching crate in spawn."));
                return true;
            }

            case "balance" -> {
                if (!(sender instanceof Player player)) return true;
                player.sendMessage(Text.says("You have "
                        + Stats.cash(stats.moneyOf(player.getUniqueId())) + "."));
                return true;
            }

            case "newisland" -> {
                /*
                 * Start the island again.
                 *
                 * Needed the moment an island is ever generated wrongly: they
                 * are only built on first visit, so a bad one is permanent
                 * without this. Confirmed with a word rather than a prompt,
                 * because a mistyped reset should not cost somebody a week.
                 *
                 * Called /newisland because /restart is a Bukkit built-in that
                 * stops the server. Naming this one /restart shut the whole
                 * thing down the first time somebody used it - a plugin command
                 * does not override a server command, it just loses.
                 */
                if (!(sender instanceof Player player)) return true;

                if (args.length == 0 || !args[0].equalsIgnoreCase("confirm")) {
                    player.sendMessage(Text.bad("This deletes your island and everything on it."));
                    player.sendMessage(Text.plain("  Your build, your chests, what you are carrying,"));
                    player.sendMessage(Text.plain("  and your island level all go back to nothing."));
                    player.sendMessage(Text.plain("  /newisland confirm  if you mean it"));
                    return true;
                }

                Worlds.Place place = worlds.placeOf(player);
                if (place != Worlds.Place.SKYBLOCK && place != Worlds.Place.ONEBLOCK) {
                    player.sendMessage(Text.bad("Only in Skyblock or One Block."));
                    player.sendMessage(Text.plain("  Stand on the island you want to start again."));
                    return true;
                }

                if (wipe.busy(player.getUniqueId())) {
                    player.sendMessage(Text.bad("Your island is already being cleared."));
                    return true;
                }

                boolean sky = place == Worlds.Place.SKYBLOCK;
                java.util.UUID who = player.getUniqueId();

                org.bukkit.Location centre = sky
                        ? skyBlock.islandOf(who)
                        : oneBlock.islandOf(who);

                /*
                 * Out of the way while it happens.
                 *
                 * The ground they are standing on is about to stop existing,
                 * and the void catch would only keep dropping them back into
                 * the middle of a plot that is still being emptied.
                 */
                hub.send(player);

                Stats.Record record = stats.of(who);

                wipe.plot(player, centre, () -> {
                    // Everything the island earned goes with the island.
                    /*
                     * The progress goes; the island is left to `send`.
                     *
                     * Arriving in an island world already builds one if there
                     * is not one there, and after a wipe there is not - so
                     * building it here as well was one island too many, and the
                     * starting chest got filled twice.
                     */
                    if (sky) {
                        record.islandPoints = 0;
                        record.islandLevel = 0;
                    } else {
                        record.oneBlockBroken = 0;
                    }

                    // What they were carrying was made on the old island.
                    backpacks().clear(who, sky ? Worlds.Place.SKYBLOCK : Worlds.Place.ONEBLOCK);

                    if (!player.isOnline()) return;

                    player.getInventory().clear();
                    player.setLevel(0);
                    player.setExp(0f);

                    worlds.send(player, sky ? Worlds.Place.SKYBLOCK : Worlds.Place.ONEBLOCK);

                    player.sendMessage(Text.good("Fresh island."));
                    player.sendMessage(Text.plain("  Everything is gone and your progress is back to zero."));
                });

                return true;
            }

            case "is" -> {
                if (!(sender instanceof Player player)) return true;

                /*
                 * Saving what is around you as the island everyone starts with.
                 *
                 * Built by hand and copied, rather than described in code -
                 * arithmetic is a poor way to design a build, and the person who
                 * knows what the island should look like is not the one writing
                 * the loops.
                 */
                if (args.length > 0 && args[0].equalsIgnoreCase("template")) {
                    if (!player.hasPermission("nexus.admin")) {
                        player.sendMessage(Text.bad("That one is for staff."));
                        return true;
                    }

                    if (args.length > 1 && args[1].equalsIgnoreCase("clear")) {
                        islandTemplate.forget(player);
                    } else {
                        islandTemplate.capture(player);
                    }
                    return true;
                }

                if (args.length > 0) {
                    switch (args[0].toLowerCase()) {
                        case "invite" -> {
                            if (args.length < 2) player.sendMessage(Text.bad("/is invite <player>"));
                            else islandTeam.invite(player, args[1]);
                            return true;
                        }
                        case "accept" -> {
                            islandTeam.accept(player);
                            return true;
                        }
                        case "kick" -> {
                            if (args.length < 2) player.sendMessage(Text.bad("/is kick <player>"));
                            else islandTeam.kick(player, args[1]);
                            return true;
                        }
                        case "leave" -> {
                            islandTeam.leave(player, args.length > 1 ? args[1] : null);
                            return true;
                        }
                        case "team", "members" -> {
                            islandTeam.show(player);
                            return true;
                        }
                        case "top" -> {
                            skyBlock.top(player);
                            return true;
                        }
                        case "upgrades", "upgrade" -> {
                            if (args.length > 1) islandUpgrades.buy(player, args[1]);
                            else islandUpgrades.show(player);
                            return true;
                        }
                        case "visit" -> {
                            if (args.length < 2) player.sendMessage(Text.bad("/is visit <player>"));
                            else skyBlock.visit(player, args[1]);
                            return true;
                        }
                        default -> {
                            /* Anything else falls through to going home. */
                        }
                    }
                }

                Worlds.Place place = worlds.placeOf(player);
                if (place == Worlds.Place.SKYBLOCK) {
                    player.teleport(skyBlock.islandOf(player.getUniqueId()).add(0, 1, 0));
                } else if (place == Worlds.Place.ONEBLOCK) {
                    player.teleport(oneBlock.islandOf(player.getUniqueId()).add(0, 1, 0));
                } else {
                    worlds.send(player, Worlds.Place.SKYBLOCK);
                }
                return true;
            }

            case "mine" -> {
                if (!(sender instanceof Player player)) return true;
                if (worlds.placeOf(player) != Worlds.Place.PRISON) {
                    worlds.send(player, Worlds.Place.PRISON);
                }
                prison.goToMine(player);
                return true;
            }

            case "rankup" -> {
                if (sender instanceof Player player) prison.rankUp(player);
                return true;
            }

            case "warp" -> {
                if (!(sender instanceof Player player)) return true;
                if (args.length == 0) {
                    player.sendMessage(Text.plain("  /warp survival|prison|creative|hub"));
                    return true;
                }
                if (args[0].equalsIgnoreCase("hub")) {
                    Match inGame = games.matchOf(player.getUniqueId());
                    if (inGame != null) inGame.remove(player);
                    else hub.send(player);
                } else {
                    travel(player, args[0].toLowerCase());
                }
                return true;
            }

            case "leaderboard" -> {
                showLeaderboard(sender);
                return true;
            }

            case "nexus" -> {
                return admin(sender, args);
            }

            default -> {
                return false;
            }
        }
    }

    /**
     * The rest of the arguments, joined, as a reason.
     *
     * Falls back to something rather than an empty string, because a
     * punishment with no reason attached is the one nobody can defend later.
     */
    private static String reasonFrom(String[] args, int from) {
        if (args.length <= from) return "No reason given";

        StringBuilder out = new StringBuilder();
        for (int i = from; i < args.length; i++) {
            if (out.length() > 0) out.append(' ');
            out.append(args[i]);
        }
        return out.toString();
    }

    private static int tryInt(String text, int fallback) {
        try {
            return Integer.parseInt(text);
        } catch (NumberFormatException notANumber) {
            return fallback;
        }
    }

    /** A number, or the fallback, so a typo does not need its own message. */
    private static double tryDouble(String text, double fallback) {
        try {
            return Double.parseDouble(text);
        } catch (NumberFormatException notANumber) {
            return fallback;
        }
    }

    private boolean party(Player player, String[] args) {
        if (args.length == 0) {
            player.sendMessage(Text.plain("  /party invite|accept|leave|list|kick <player>"));
            return true;
        }

        switch (args[0].toLowerCase()) {
            case "invite" -> {
                if (args.length < 2) {
                    player.sendMessage(Text.bad("Who? /party invite <player>"));
                    return true;
                }
                Player target = Bukkit.getPlayerExact(args[1]);
                if (target == null) player.sendMessage(Text.bad("They are not online."));
                else parties.invite(player, target);
            }
            case "accept" -> parties.accept(player);
            case "leave" -> parties.leave(player, false);
            case "list" -> parties.list(player);
            case "kick" -> {
                if (args.length < 2) {
                    player.sendMessage(Text.bad("Who? /party kick <player>"));
                    return true;
                }
                Player target = Bukkit.getPlayerExact(args[1]);
                if (target == null) player.sendMessage(Text.bad("They are not online."));
                else parties.kick(player, target);
            }
            default -> player.sendMessage(Text.plain("  /party invite|accept|leave|list|kick <player>"));
        }
        return true;
    }

    private void showStats(Player asking, Player about) {
        Stats.Record record = stats.of(about.getUniqueId());

        asking.sendMessage(Text.heading(about.getName()));
        asking.sendMessage(Text.field("Rank", stats.rankOf(about.getUniqueId()).name()));
        asking.sendMessage(Text.field("Coins", String.valueOf(record.coins)));
        asking.sendMessage(Text.field("Wins", record.wins + " of " + record.gamesPlayed));
        asking.sendMessage(Text.field("Kills", record.kills + " (K/D " + String.format("%.2f", record.kd()) + ")"));
        asking.sendMessage(Text.field("Beds broken", String.valueOf(record.bedsBroken)));
        asking.sendMessage(Text.field("Best streak", String.valueOf(record.bestStreak)));
    }

    private void showLeaderboard(CommandSender sender) {
        sender.sendMessage(Text.heading("Top Players"));

        var top = stats.top(Comparator.comparingInt(record -> record.wins), 10);
        if (top.isEmpty()) {
            sender.sendMessage(Text.plain("  Nobody has won anything yet."));
            return;
        }

        int place = 1;
        for (Map.Entry<UUID, Stats.Record> entry : top) {
            String name = Bukkit.getOfflinePlayer(entry.getKey()).getName();
            sender.sendMessage(Component.text("  " + place++ + ". ", NamedTextColor.DARK_GRAY)
                    .append(Component.text(name == null ? "someone" : name, NamedTextColor.WHITE))
                    .append(Component.text("  " + entry.getValue().wins + " wins", Text.BRAND)));
        }
    }

    /**
     * Build mode on or off, and what that means, said plainly.
     *
     * Spelled out rather than left to a one-line confirmation because the mode
     * changes four separate things - gamemode, whether the lobby accepts
     * blocks, whether the selector is in your hand, and whether it survives a
     * restart - and somebody who does not know all four assumes it is broken
     * the first time one of them surprises them.
     */
    private void buildMode(Player player) {
        boolean on = hub.toggleBuilding(player);

        if (!on) {
            player.sendMessage(Text.says("Build mode off."));
            player.sendMessage(Text.plain("  The lobby is locked again."));
            return;
        }

        player.sendMessage(Text.good("Build mode on."));
        player.sendMessage(Text.plain("  Creative, and the lobby accepts your blocks."));
        player.sendMessage(Text.plain("  Nobody else can touch it."));
        player.sendMessage(Text.plain("  It stays on through restarts. /build again to stop."));
    }

    /**
     * An amount of money from a command's arguments, or null having said why.
     *
     * Written once because both halves of the guild bank need it and a
     * mistyped amount that silently became zero would be a confusing way to
     * lose track of a deposit.
     */
    private Double money(Player player, String[] args) {
        if (args.length < 2) {
            player.sendMessage(Text.bad("How much?"));
            return null;
        }

        try {
            return Double.parseDouble(args[1]);
        } catch (NumberFormatException notANumber) {
            player.sendMessage(Text.bad("'" + args[1] + "' is not an amount."));
            return null;
        }
    }

    /**
     * A whole number from the arguments, or a sensible default.
     *
     * Written once because a dozen build commands take one, and a mistyped
     * number that quietly became zero would look like the command doing
     * nothing at all.
     */
    private static int whole(String[] args, int at, int fallback) {
        if (args.length <= at) return fallback;

        try {
            return Integer.parseInt(args[at]);
        } catch (NumberFormatException notANumber) {
            return fallback;
        }
    }

    /** Whether "hollow" appears anywhere in what was typed. */
    private static boolean hollowAsked(String[] args) {
        for (String arg : args) {
            if (arg.equalsIgnoreCase("hollow")) return true;
        }
        return false;
    }

    /** One command from the building set, already known to be allowed. */
    private boolean building(Player player, String name, String[] args) {
        switch (name) {
            case "wand" -> toolkit.giveWand(player);
            case "buildhelp" -> toolkit.help(player);

            case "pos1" -> toolkit.setFirst(player, player.getLocation().getBlock());
            case "pos2" -> toolkit.setSecond(player, player.getLocation().getBlock());

            case "sel" -> {
                long size = toolkit.countOf(player);
                player.sendMessage(size == 0
                        ? Text.bad("No selection. /wand, then click two corners.")
                        : Text.says(size + " blocks selected."));
            }

            case "set" -> {
                if (args.length < 1) {
                    player.sendMessage(Text.bad("/set <block>"));
                    return true;
                }
                toolkit.set(player, args[0]);
            }

            case "replace" -> {
                if (args.length < 2) {
                    player.sendMessage(Text.bad("/replace <from> <to>"));
                    return true;
                }
                toolkit.replace(player, args[0], args[1]);
            }

            case "walls" -> {
                if (args.length < 1) {
                    player.sendMessage(Text.bad("/walls <block>"));
                    return true;
                }
                toolkit.walls(player, args[0]);
            }

            case "shell" -> {
                if (args.length < 1) {
                    player.sendMessage(Text.bad("/shell <block>"));
                    return true;
                }
                toolkit.shell(player, args[0]);
            }

            case "hollow" -> toolkit.hollow(player);
            case "redo" -> toolkit.redo(player);
            case "count" -> toolkit.count(player);

            case "stack" -> toolkit.stack(player, whole(args, 0, 1),
                    args.length > 1 ? args[1] : null);

            case "move" -> toolkit.move(player, whole(args, 0, 1),
                    args.length > 1 ? args[1] : null);

            case "expand" -> toolkit.resize(player, whole(args, 0, 1),
                    args.length > 1 ? args[1] : null, true);

            case "contract" -> toolkit.resize(player, whole(args, 0, 1),
                    args.length > 1 ? args[1] : null, false);

            case "up" -> toolkit.up(player, whole(args, 0, 1));
            case "drain" -> toolkit.drain(player, whole(args, 0, 8));

            case "sphere" -> {
                if (args.length < 2) {
                    player.sendMessage(Text.bad("/sphere <block> <radius> [hollow]"));
                    return true;
                }
                toolkit.sphere(player, args[0], whole(args, 1, 5), hollowAsked(args));
            }

            case "cyl" -> {
                if (args.length < 2) {
                    player.sendMessage(Text.bad("/cyl <block> <radius> [height] [hollow]"));
                    return true;
                }
                toolkit.cylinder(player, args[0], whole(args, 1, 5),
                        args.length > 2 && !args[2].equalsIgnoreCase("hollow")
                                ? whole(args, 2, 1) : 1,
                        hollowAsked(args));
            }

            case "pyramid" -> {
                if (args.length < 2) {
                    player.sendMessage(Text.bad("/pyramid <block> <size> [hollow]"));
                    return true;
                }
                toolkit.pyramid(player, args[0], whole(args, 1, 5), hollowAsked(args));
            }

            case "line" -> {
                if (args.length < 1) {
                    player.sendMessage(Text.bad("/line <block>"));
                    return true;
                }
                toolkit.line(player, args[0]);
            }

            case "overlay" -> {
                if (args.length < 1) {
                    player.sendMessage(Text.bad("/overlay <block>"));
                    return true;
                }
                toolkit.overlay(player, args[0]);
            }
            case "copy" -> toolkit.copy(player);
            case "paste" -> toolkit.paste(player);
            case "undo" -> toolkit.undo(player);

            default -> {
                return false;
            }
        }
        return true;
    }

    private boolean admin(CommandSender sender, String[] args) {
        if (!sender.hasPermission("nexus.admin")) {
            sender.sendMessage(Text.bad("Not for you."));
            return true;
        }

        if (args.length == 0) {
            sender.sendMessage(Text.plain("  /nexus setrank <player> <rank>"));
            sender.sendMessage(Text.plain("  /nexus setspawn          use your own lobby build"));
            sender.sendMessage(Text.plain("  /nexus setnpc <world>    move a greeter here"));
            sender.sendMessage(Text.plain("  /nexus wand [id]         point-and-click placement tool"));
            sender.sendMessage(Text.plain("  /nexus clearnpc <id>     remove them (add 'last' for one)"));
            sender.sendMessage(Text.plain("  /nexus setboss           where the world boss rises"));
            sender.sendMessage(Text.plain("  /nexus startboss         bring it up now"));
            sender.sendMessage(Text.plain("  /nexus boss              when the next one is due"));
            sender.sendMessage(Text.plain("  /nexus event <name>      fire one now"));
            sender.sendMessage(Text.plain("  /nexus chatgame          ask a question now"));
            sender.sendMessage(Text.plain("  /nexus holopreset <name> a ready-made hologram"));
            sender.sendMessage(Text.plain("  /nexus holosize <n>      resize the nearest"));
            sender.sendMessage(Text.plain("  /nexus holoraise <n>     move the nearest up/down"));
            sender.sendMessage(Text.plain("  /nexus holobackdrop      dark panel behind it"));
            sender.sendMessage(Text.plain("  /nexus tpnpc <id>        go and look at one"));
            sender.sendMessage(Text.plain("  /nexus layout            place every bot and sign around you"));
            sender.sendMessage(Text.plain("  /nexus clearholograms    remove all floating text"));
            sender.sendMessage(Text.plain("  /nexus npcs              put the greeters back"));
            sender.sendMessage(Text.plain("  /nexus pack              re-read the resource pack"));
            sender.sendMessage(Text.plain("  /nexus build             unlock the lobby and go creative"));
            sender.sendMessage(Text.plain("  /nexus digspot <what>    dig site arrival, buyer or gear, here"));
            sender.sendMessage(Text.plain("  /nexus setportal <id>    stand in your portal, name where it goes"));
            sender.sendMessage(Text.plain("  /nexus clearportal <id>  and its greeter comes back"));
            sender.sendMessage(Text.plain("  /nexus undoportal        put the last portal change back"));
            sender.sendMessage(Text.plain("  /nexus portals           which ones are placed"));
            sender.sendMessage(Text.plain("  /nexus hologram <text>   floating text where you stand"));
            sender.sendMessage(Text.plain("  /nexus unhologram        remove the nearest one"));
            sender.sendMessage(Text.plain("  /nexus pay <player> <amount>"));
            sender.sendMessage(Text.plain("  /nexus start <game>   force a queue to start"));
            sender.sendMessage(Text.plain("  /nexus testarena   build a map and check it"));
            sender.sendMessage(Text.plain("  /nexus save"));
            return true;
        }

        switch (args[0].toLowerCase()) {
            case "setrank" -> {
                if (args.length < 3) {
                    sender.sendMessage(Text.bad("/nexus setrank <player> <rank>"));
                    return true;
                }
                Player target = Bukkit.getPlayerExact(args[1]);
                if (target == null) {
                    sender.sendMessage(Text.bad("They are not online."));
                    return true;
                }
                Ranks rank = Ranks.of(args[2]);
                stats.setRank(target.getUniqueId(), rank);
                nameplates();

                sender.sendMessage(Text.good(target.getName() + " is now " + rank.name() + "."));
                target.sendMessage(Text.says("You are now " + rank.name() + "."));
            }

            case "testarena" -> {
                /*
                 * Builds a map, checks it, throws it away.
                 *
                 * The arena is generated rather than pasted, so the thing most
                 * likely to be quietly wrong is the geometry — a bed whose two
                 * halves disagree, an island centred a block off, a generator
                 * inside the floor. None of that shows up until eight people
                 * are standing in it, which is the worst time to find out.
                 */
                var world = Arena.create("selftest");
                try {
                    var field = new dev.nexuscraft.nexus.bedwars.Field(world);
                    var squads = dev.nexuscraft.nexus.bedwars.Squad.four();

                    org.bukkit.Material[] wool = new org.bukkit.Material[squads.length];
                    for (int i = 0; i < squads.length; i++) wool[i] = squads[i].wool;

                    long began = System.currentTimeMillis();
                    field.build(squads.length, wool);
                    long took = System.currentTimeMillis() - began;

                    int problems = 0;
                    for (int team = 0; team < squads.length; team++) {
                        var bed = field.bed(team).getBlock();
                        if (!bed.getType().name().endsWith("_BED")) {
                            sender.sendMessage(Text.bad("team " + team + ": no bed at " + field.bed(team)));
                            problems++;
                        } else if (!(bed.getBlockData() instanceof org.bukkit.block.data.type.Bed data)
                                || data.getPart() != org.bukkit.block.data.type.Bed.Part.FOOT) {
                            sender.sendMessage(Text.bad("team " + team + ": bed foot is wrong"));
                            problems++;
                        }

                        var under = field.baseSpawn(team).getBlock().getRelative(0, -1, 0);
                        if (!under.getType().isSolid()) {
                            sender.sendMessage(Text.bad("team " + team + ": spawn has no floor"));
                            problems++;
                        }
                        var feet = field.baseSpawn(team).getBlock();
                        if (feet.getType().isSolid()) {
                            sender.sendMessage(Text.bad("team " + team + ": spawn is inside a block"));
                            problems++;
                        }
                    }

                    for (var at : field.diamondGenerators()) {
                        if (!at.getBlock().getRelative(0, -1, 0).getType().isSolid()) {
                            sender.sendMessage(Text.bad("a diamond generator has no floor"));
                            problems++;
                        }
                    }
                    for (var at : field.emeraldGenerators()) {
                        if (!at.getBlock().getRelative(0, -1, 0).getType().isSolid()) {
                            sender.sendMessage(Text.bad("the emerald generator has no floor"));
                            problems++;
                        }
                    }

                    sender.sendMessage(problems == 0
                            ? Text.good("arena ok - built in " + took + "ms")
                            : Text.bad(problems + " problem(s) with the arena"));
                } finally {
                    Arena.destroy(world);
                }
            }

            case "check" -> {
                /*
                 * Is the lobby actually there?
                 *
                 * The build is generated, so the way it fails is silently: a
                 * world that got created but never filled looks identical to a
                 * working one from the console. This looks at the blocks.
                 */
                var world = hub.world();

                // The wall, the keep, the gate you walk through, and the moat.
                boolean wall = world.getBlockAt(0, Castle.GROUND + 10, -56).getType().isSolid();
                boolean keepTall = world.getBlockAt(15, Castle.GROUND + 38, 0).getType().isSolid();
                boolean gateOpen = world.getBlockAt(0, Castle.GROUND + 2, 56).getType()
                        == org.bukkit.Material.AIR;
                boolean moat = world.getBlockAt(0, Castle.GROUND - 2, 68).getType()
                        == org.bukkit.Material.WATER;
                boolean courtyard = world.getBlockAt(0, Castle.GROUND, 30).getType().isSolid();

                // Only the ones that send you somewhere; merchants are counted
                // separately, and counting both as greeters read as 13 of 8.
                long greeters = world.getEntities().stream()
                        .filter(e -> Npc.destinationOf(e) != null).count();

                long merchants = world.getEntities().stream()
                        .filter(e -> Npc.opensOf(e) != null).count();
                sender.sendMessage(Text.field("merchants", merchants + " of " + Hub.SERVICES.length));

                // Configured against drawn. They were silently dropped at load
                // once, and the file looked perfectly fine while it happened.
                long drawn = world.getEntities().stream()
                        .filter(e -> e.getScoreboardTags().contains(Holograms.TAG)).count();
                sender.sendMessage(Text.field("holograms",
                        drawn + " drawn, " + holograms.count() + " configured"));

                sender.sendMessage(Text.field("curtain wall", String.valueOf(wall)));
                sender.sendMessage(Text.field("keep at 40 blocks", String.valueOf(keepTall)));
                sender.sendMessage(Text.field("gate is open", String.valueOf(gateOpen)));
                sender.sendMessage(Text.field("moat has water", String.valueOf(moat)));
                sender.sendMessage(Text.field("courtyard floor", String.valueOf(courtyard)));
                java.util.List<String> unplaced = hub.unplacedGreeters();
                sender.sendMessage(Text.field("greeters",
                        greeters + " of " + Hub.DESTINATIONS.length));

                if (!unplaced.isEmpty()) {
                    sender.sendMessage(Text.plain("  not placed yet: "
                            + String.join(", ", unplaced)));
                    sender.sendMessage(Text.plain("  /nexus wand <id> to put one down."));
                }

                /*
                 * How many different blocks are actually in it.
                 *
                 * The complaint about the first castle was "all the same block",
                 * which is a thing that can be counted rather than argued about.
                 * Sampled across the whole footprint so it measures the build
                 * and not one wall.
                 */
                java.util.Map<org.bukkit.Material, Integer> seen = new java.util.HashMap<>();
                for (int x = -74; x <= 74; x += 3) {
                    for (int z = -74; z <= 74; z += 3) {
                        for (int y = Castle.GROUND; y <= Castle.GROUND + 44; y += 2) {
                            var type = world.getBlockAt(x, y, z).getType();
                            if (type != org.bukkit.Material.AIR) {
                                seen.merge(type, 1, Integer::sum);
                            }
                        }
                    }
                }

                sender.sendMessage(Text.field("distinct blocks", String.valueOf(seen.size())));

                /*
                 * Does a skyblock island actually come out right?
                 *
                 * The first one had an empty chest, because filling a BlockState
                 * snapshot throws the items away with no error anywhere. That is
                 * exactly the kind of failure worth a check rather than a look:
                 * it is invisible until somebody opens the chest.
                 */
                java.util.UUID probe = java.util.UUID.nameUUIDFromBytes("nexus-selftest".getBytes());
                skyBlock.build(probe);

                var island = skyBlock.islandOf(probe);
                var chestBlock = island.getWorld().getBlockAt(
                        island.getBlockX() - 2, island.getBlockY(), island.getBlockZ() - 2);

                int inChest = 0;
                boolean hasLava = false;
                if (chestBlock.getState() instanceof org.bukkit.block.Chest chest) {
                    for (var stack : chest.getBlockInventory().getContents()) {
                        if (stack == null) continue;
                        inChest++;
                        if (stack.getType() == org.bukkit.Material.LAVA_BUCKET) hasLava = true;
                    }
                }

                int grass = 0;
                for (int x = -4; x <= 4; x++) {
                    for (int z = -4; z <= 4; z++) {
                        if (island.getWorld().getBlockAt(island.getBlockX() + x,
                                island.getBlockY() - 1, island.getBlockZ() + z)
                                .getType() == org.bukkit.Material.GRASS_BLOCK) grass++;
                    }
                }

                sender.sendMessage(Text.field("skyblock chest", inChest + " stacks, lava=" + hasLava));
                sender.sendMessage(Text.field("skyblock island", grass + " grass blocks"));

                // The island scan runs on the main thread every second, so its
                // cost is a tick budget question rather than a detail.
                long scanBegan = System.nanoTime();
                skyBlock.scanFor(probe);
                long scanMicros = (System.nanoTime() - scanBegan) / 1000;
                sender.sendMessage(Text.field("island scan", scanMicros + " microseconds"));
                sender.sendMessage(inChest >= 7 && hasLava && grass > 30
                        ? Text.good("skyblock ok") : Text.bad("skyblock is not right"));

                String top = seen.entrySet().stream()
                        .sorted((a, b) -> b.getValue() - a.getValue())
                        .limit(6)
                        .map(e -> e.getKey().name().toLowerCase())
                        .reduce((a, b) -> a + ", " + b).orElse("none");
                sender.sendMessage(Text.field("most used", top));

                /*
                  * Every greeter that was asked for is standing.
                  *
                  * Counted against what the lobby was told to place rather than
                  * against the full list, because a custom lobby legitimately
                  * has none placed on the day a new game is added - and a check
                  * that fails for a reason the operator already knows about is
                  * a check people stop reading.
                  */
                boolean allGreeters = greeters
                        >= Hub.DESTINATIONS.length - unplaced.size();

                sender.sendMessage(wall && keepTall && gateOpen && moat && courtyard
                        && allGreeters
                        && merchants == Hub.SERVICES.length
                        ? Text.good("castle ok") : Text.bad("castle is not right"));

                /*
                 * Grief protection, which fails in the worst possible way.
                 *
                 * If claims do not load, the server starts, the file is there,
                 * nobody sees an error, and the land is simply not protected -
                 * you find out when somebody's house is gone. Both of these
                 * round-trip their storage in memory rather than trusting it.
                 */
                String claimTest = claims.selfTest();
                String logTest = blockLog.selfTest();

                sender.sendMessage(Text.field("claims", claims.total() + " claimed"));
                sender.sendMessage(Text.field("block log", blockLog.size() + " changes"));
                sender.sendMessage(Text.field("games", String.valueOf(games.all().size())));

                /*
                 * Both solo ladders actually generated.
                 *
                 * A course that fails to build leaves an empty layer of sky and
                 * says nothing about it - the player finds out by falling
                 * through the floor of course four. Counting them is the only
                 * check that catches it before somebody runs it.
                 */
                parkour.world();
                int built = parkour.builtCourses();

                sender.sendMessage(Text.field("parkour",
                        built + " of " + Course.count() + " courses built"));

                StringBuilder shapes = new StringBuilder();
                for (int i = 0; i < Course.count(); i++) {
                    if (shapes.length() > 0) shapes.append(", ");
                    shapes.append(parkour.jumpsIn(i));
                }
                sender.sendMessage(Text.field("  jumps each", shapes.toString()));

                sender.sendMessage(Text.field("dropper",
                        Dropper.shafts() + " shafts"));

                boolean coursesOk = built == Course.count();
                for (int i = 0; i < Course.count(); i++) {
                    if (parkour.jumpsIn(i) != Course.of(i).jumps()) coursesOk = false;
                }

                String reachTest = parkour.selfTest();

                StringBuilder finishes = new StringBuilder();
                boolean padsOk = true;

                for (int i = 0; i < Course.count(); i++) {
                    var finish = parkour.finishOf(i);
                    if (!parkour.landsSafely(i)) padsOk = false;

                    if (finishes.length() > 0) finishes.append("  ");
                    finishes.append(finish == null ? "?"
                            : finish.getBlockX() + "," + finish.getBlockY()
                                    + "," + finish.getBlockZ());
                }

                sender.sendMessage(Text.field("  finishes", finishes.toString()));
                if (!padsOk) sender.sendMessage(Text.bad("  a course has no landing pad"));

                StringBuilder longest = new StringBuilder();
                for (int i = 0; i < Course.count(); i++) {
                    if (longest.length() > 0) longest.append(", ");
                    longest.append(String.format("%.1f", parkour.longestJump(i)));
                }
                sender.sendMessage(Text.field("  longest jump", longest.toString()));

                sender.sendMessage(coursesOk && padsOk && "ok".equals(reachTest)
                        ? Text.good("parkour ok")
                        : Text.bad("parkour is not right: "
                                + (!coursesOk ? "a course did not build"
                                : !padsOk ? "a course has no landing pad"
                                : reachTest)));
                sender.sendMessage(Text.field("achievements",
                        Achievements.total() + " to earn"));
                sender.sendMessage(Text.field("pets",
                        pets.out() + " out, " + Pets.kinds() + " to buy"));

                sender.sendMessage("ok".equals(claimTest)
                        ? Text.good("claims ok")
                        : Text.bad("claims are not right: " + claimTest));

                sender.sendMessage("ok".equals(logTest)
                        ? Text.good("block log ok")
                        : Text.bad("block log is not right: " + logTest));

                /*
                 * An auction listing has to come back as the thing that went in.
                 *
                 * The one failure here that would be both catastrophic and
                 * silent: an enchanted sword loaded as a plain one has quietly
                 * eaten somebody's item, and nothing anywhere would say so.
                 */
                String auctionTest = auction.selfTest();

                sender.sendMessage(Text.field("auction", auction.size() + " listed"));
                sender.sendMessage(Text.field("season", String.valueOf(seasons.season())));
                sender.sendMessage(Text.field("guide", Guide.steps() + " steps"));

                sender.sendMessage("ok".equals(auctionTest)
                        ? Text.good("auction ok")
                        : Text.bad("auction is not right: " + auctionTest));

                /*
                 * Moderation and the safety net.
                 *
                 * A duration read wrongly is a ban that ends before the message
                 * finishes printing, and a filter that only catches the plain
                 * spelling is moderation in appearance only. Both fail quietly,
                 * so both are checked rather than trusted.
                 */
                String banTest = punishments.selfTest();
                String filterTest = chatGuard.selfTest();

                sender.sendMessage(Text.field("punishments",
                        punishments.total() + " on record"));

                int age = backups.newestAge();
                sender.sendMessage(Text.field("backups", backups.count()
                        + " kept, newest " + (age < 0 ? "never" : Text.roughly(age) + " ago")));

                sender.sendMessage("ok".equals(banTest)
                        ? Text.good("durations ok")
                        : Text.bad("durations are not right: " + banTest));

                sender.sendMessage("ok".equals(filterTest)
                        ? Text.good("chat filter ok")
                        : Text.bad("chat filter is not right: " + filterTest));

                /*
                 * The vote listener, which fails in both directions quietly.
                 *
                 * Too strict and no vote ever arrives; too loose and anybody
                 * who finds the port can vote for themselves all day. Neither
                 * writes anything to the log.
                 */
                String voteTest = voting.selfTest();

                sender.sendMessage(Text.field("votes",
                        voting.running() ? voting.votesReceived() + " received"
                                : "not listening"));

                sender.sendMessage("ok".equals(voteTest)
                        ? Text.good("vote listener ok")
                        : Text.bad("vote listener is not right: " + voteTest));

                // The one that is a problem rather than a failure: a server
                // with no backup at all is one bad afternoon from losing it.
                if (backups.count() == 0) {
                    sender.sendMessage(Text.bad("  nothing is backed up yet"));
                    sender.sendMessage(Text.plain("  /nexus backup to take one now"));
                }
            }

            case "setspawn" -> {
                if (!(sender instanceof Player player)) return true;
                settings.setSpawn(player.getLocation());
                sender.sendMessage(Text.good("Hub spawn set here, custom spawn switched on."));
                sender.sendMessage(Text.plain("  The generated lobby will not be rebuilt."));
            }

            case "setnpc" -> {
                if (!(sender instanceof Player player)) return true;
                String moving = args.length < 2 ? null : Hub.idFor(args[1]);

                if (moving == null) {
                    sender.sendMessage(Text.bad("/nexus setnpc <id>"));
                    sender.sendMessage(Text.plain("  " + String.join(", ", Hub.npcIds())));
                    return true;
                }

                settings.setNpc(moving, player.getLocation());
                hub.placeNpcs();
                holograms.rebuild();
                sender.sendMessage(Text.good(moving + " greeter moved here."));
            }

            case "build" -> {
                if (!(sender instanceof Player player)) return true;

                buildMode(player);
            }

            case "digspot" -> {
                if (!(sender instanceof Player player)) return true;

                digSite.setSpot(player, args.length > 1 ? args[1] : "");
            }

            case "setportal" -> {
                if (!(sender instanceof Player player)) return true;

                if (args.length < 2 || !Hub.npcIds().contains(args[1].toLowerCase())) {
                    sender.sendMessage(Text.bad("/nexus setportal <id>"));
                    sender.sendMessage(Text.plain("  " + String.join(", ", Hub.npcIds())));
                    return true;
                }

                String id = args[1].toLowerCase();
                if (!portals.set(id, player)) return true;

                hub.placeNpcs();

                sender.sendMessage(Text.good("That portal now leads to " + id + "."));
                sender.sendMessage(Text.plain("  Its greeter has stood down."));
            }

            case "clearportal" -> {
                if (args.length < 2) {
                    sender.sendMessage(Text.bad("/nexus clearportal <id>"));
                    return true;
                }

                String id = args[1].toLowerCase();
                if (!portals.clear(id)) {
                    sender.sendMessage(Text.bad("No portal for '" + id + "'."));
                    return true;
                }

                hub.placeNpcs();
                sender.sendMessage(Text.good(id + " portal forgotten."));
                sender.sendMessage(Text.plain("  The blocks are yours; they are still there."));
            }

            case "undoportal" -> {
                String what = portals.undoLast();

                if (what == null) {
                    sender.sendMessage(Text.bad("No portal changes to undo."));
                    return true;
                }

                hub.placeNpcs();
                sender.sendMessage(Text.good(what + "."));
                sender.sendMessage(Text.plain("  " + portals.undosLeft() + " more to undo."));
            }

            case "portals" -> {
                var placed = portals.placed();
                sender.sendMessage(Text.heading("Portals"));

                if (placed.isEmpty()) {
                    sender.sendMessage(Text.plain("  None. /nexus setportal survival"));
                    return true;
                }
                for (String id : placed) sender.sendMessage(Text.plain("  " + id));
            }

            case "hologram", "holo" -> {
                if (!(sender instanceof Player player)) return true;

                if (args.length < 2) {
                    sender.sendMessage(Text.plain("  /nexus hologram <text>      floating text here"));
                    sender.sendMessage(Text.plain("  /nexus hologram leaderboard the top ten, live"));
                    sender.sendMessage(Text.plain("  /nexus hologram online      how many are on"));
                    sender.sendMessage(Text.plain("  Colours with &a &b &c ... and &l for bold."));
                    sender.sendMessage(Text.plain("  Use | to split lines: &6&lSHOP|&7this way"));
                    return true;
                }

                String written = String.join(" ",
                        java.util.Arrays.copyOfRange(args, 1, args.length));

                java.util.List<String> lines = switch (written.toLowerCase()) {
                    case "leaderboard" -> java.util.List.of(
                            "&6&lTOP PLAYERS", Holograms.LEADERBOARD);
                    case "online" -> java.util.List.of(Holograms.ONLINE);
                    default -> java.util.Arrays.asList(written.split("\\|"));
                };

                holograms.add(player.getLocation().add(0, 2.2, 0), lines);
                sender.sendMessage(Text.good("Placed. " + holograms.count() + " in total."));
            }

            case "holopreset", "preset" -> {
                if (!(sender instanceof Player player)) return true;

                if (args.length < 2) {
                    sender.sendMessage(Text.plain("  /nexus holopreset <name>"));
                    sender.sendMessage(Text.plain("  " + String.join(", ", Presets.names())));
                    return true;
                }

                var preset = Presets.get(args[1]);
                if (preset == null) {
                    sender.sendMessage(Text.bad("No preset called that."));
                    sender.sendMessage(Text.plain("  " + String.join(", ", Presets.names())));
                    return true;
                }

                holograms.add(player.getLocation().add(0, 2.4, 0),
                        preset.lines(), preset.scale(), preset.backdrop());
                sender.sendMessage(Text.good("Placed " + preset.name()
                        + " at size " + preset.scale() + "."));
                sender.sendMessage(Text.plain("  /nexus holosize <n> to resize it."));
            }

            case "holosize" -> {
                if (!(sender instanceof Player player)) return true;
                if (args.length < 2) {
                    sender.sendMessage(Text.bad("/nexus holosize <0.25 to 10>"));
                    return true;
                }
                try {
                    float size = holograms.resizeNearest(player.getLocation(),
                            Float.parseFloat(args[1]));
                    sender.sendMessage(size < 0
                            ? Text.bad("Nothing near enough.")
                            : Text.good("Size " + size + "."));
                } catch (NumberFormatException bad) {
                    sender.sendMessage(Text.bad("That is not a number."));
                }
            }

            case "holoraise" -> {
                if (!(sender instanceof Player player)) return true;
                double by = args.length > 1 ? tryDouble(args[1], 0.5) : 0.5;
                sender.sendMessage(holograms.raiseNearest(player.getLocation(), by)
                        ? Text.good("Moved it " + by + " blocks.")
                        : Text.bad("Nothing near enough."));
            }

            case "holobackdrop" -> {
                if (!(sender instanceof Player player)) return true;
                sender.sendMessage(holograms.backdropNearest(player.getLocation())
                        ? Text.good("Toggled the panel behind it.")
                        : Text.bad("Nothing near enough."));
            }

            case "unhologram", "unholo" -> {
                if (!(sender instanceof Player player)) return true;

                sender.sendMessage(holograms.removeNearest(player.getLocation())
                        ? Text.good("Removed the nearest one.")
                        : Text.bad("Nothing within a few blocks."));
            }

            /*
             * Custom armour, handed out the way everything else is.
             *
             * The sets come from the config the launcher writes when it builds
             * the pack, so this lists whatever that pack actually defines
             * rather than a second copy of the same list kept here.
             */
            case "armour", "armor" -> {
                if (args.length < 2) {
                    sender.sendMessage(Text.good(armoury.ids().isEmpty()
                            ? "No armour sets yet. Build a pack with some in the launcher."
                            : "Sets: " + String.join(", ", armoury.ids())));
                    sender.sendMessage(Text.plain("/nexus armour <set> <player> [piece]"));
                    return true;
                }

                String setId = args[1];
                if (!armoury.has(setId)) {
                    sender.sendMessage(Text.bad("There is no set called " + setId + "."));
                    return true;
                }

                Player who = args.length > 2
                        ? getServer().getPlayerExact(args[2])
                        : (sender instanceof Player self ? self : null);

                if (who == null) {
                    sender.sendMessage(Text.bad(args.length > 2
                            ? args[2] + " is not online."
                            : "Name somebody to give it to."));
                    return true;
                }

                /*
                 * A named piece, or the whole set. Handing over four items when
                 * one was asked for is the kind of thing that fills an
                 * inventory and looks like a bug.
                 */
                if (args.length > 3) {
                    Armoury.Piece piece = Armoury.piece(args[3]);
                    if (piece == null) {
                        sender.sendMessage(Text.bad("No such piece. Try helmet, chestplate, leggings or boots."));
                        return true;
                    }

                    org.bukkit.inventory.ItemStack made = armoury.make(setId, piece);
                    if (made == null) {
                        sender.sendMessage(Text.bad("That set could not be made."));
                        return true;
                    }

                    for (org.bukkit.inventory.ItemStack left : who.getInventory().addItem(made).values()) {
                        who.getWorld().dropItemNaturally(who.getLocation(), left);
                    }

                    sender.sendMessage(Text.good("Gave " + who.getName() + " the "
                            + armoury.get(setId).label() + " " + piece.label() + "."));
                    return true;
                }

                armoury.give(who, setId);
                sender.sendMessage(Text.good("Gave " + who.getName() + " the "
                        + armoury.get(setId).label() + " set."));
                return true;
            }

            /*
             * Re-read the config without a restart.
             *
             * Everything that reads a setting reads it out of the config each
             * time rather than caching it, so this is genuinely all it takes -
             * and it is what lets the launcher write a webhook or a pack url
             * into the file and have it take effect while people are playing.
             */
            case "reload" -> {
                reloadConfig();
                packs.reload();
                armoury.reload();

                sender.sendMessage(Text.good("Config re-read."));
                return true;
            }

            case "pack" -> {
                packs.reload();

                /*
                 * The same config carries the armour the pack defines, and a
                 * new pack usually means new sets - so re-reading one without
                 * the other leaves the server offering textures for armour it
                 * cannot hand out.
                 */
                reloadConfig();
                armoury.reload();

                sender.sendMessage(Text.good(packs.configured()
                        ? "Re-reading the resource pack. Hashing it now."
                        : "No resourcePack.url set in config.yml."));
            }

            case "wand", "place" -> {
                if (!(sender instanceof Player player)) return true;

                /*
                 * No argument lists them rather than picking one quietly.
                 *
                 * It used to default to the first id, so `/nexus wand` handed
                 * over a survival bot with nothing saying why - which reads as
                 * "the wand only does survival" to anybody who did not know
                 * there was an argument at all.
                 */
                if (args.length < 2) {
                    sender.sendMessage(Text.heading("Bots you can place"));
                    sender.sendMessage(Text.plain("  " + String.join(", ", Hub.npcIds())));
                    sender.sendMessage(Component.empty());
                    sender.sendMessage(Text.plain("  /nexus wand <name>   eg /nexus wand creative"));
                    return true;
                }

                String id = Hub.idFor(args[1]);
                if (id == null) {
                    sender.sendMessage(Text.bad("No bot called '" + args[1] + "'."));
                    sender.sendMessage(Text.plain("  " + String.join(", ", Hub.npcIds())));
                    return true;
                }
                placer.give(player, id);
            }

            /*
             * For the row of them a crash can leave behind.
             *
             * Killing them by hand means finding each one, and they are
             * persistent and do not despawn - so somebody who restarted a few
             * times has a queue of Wardens and no way to say so.
             */
            /*
             * One command for "make them go away", whichever they are.
             *
             * Two - one for the live boss and one for the strays - would mean
             * knowing which you were looking at, and from across an arena a
             * Warden left over from a crash and a Warden that rose on schedule
             * look exactly alike.
             */
            /*
             * A circuit designed in the launcher, put in somebody's clipboard.
             *
             * The launcher writes the file; this reads it. Into the clipboard
             * rather than straight into the world so it lands where the player
             * chooses to stand and so /undo takes it away - which matters more
             * for redstone than for anything else, because a circuit is
             * something you try, look at, and try again two blocks over.
             */
            case "circuit" -> {
                if (args.length < 2) {
                    sender.sendMessage(Text.bad("/nexus circuit <name> [player]"));
                    return true;
                }

                Player who = args.length > 2
                        ? getServer().getPlayerExact(args[2])
                        : (sender instanceof Player self ? self : null);

                if (who == null) {
                    sender.sendMessage(Text.bad(args.length > 2
                            ? args[2] + " is not online."
                            : "Name somebody to give it to."));
                    return true;
                }

                java.io.File file = new java.io.File(
                        new java.io.File(getDataFolder(), "circuits"), args[1] + ".txt");

                if (!file.isFile()) {
                    sender.sendMessage(Text.bad("There is no circuit called " + args[1] + "."));
                    return true;
                }

                try {
                    int many = toolkit.load(who, java.nio.file.Files.readAllLines(file.toPath()));

                    if (many == 0) {
                        sender.sendMessage(Text.bad("Nothing in that circuit could be placed."));
                        return true;
                    }

                    who.sendMessage(Text.good(many + " blocks ready. Stand where you want it and /paste."));
                    if (!who.equals(sender)) {
                        sender.sendMessage(Text.good("Sent " + args[1] + " to " + who.getName() + "."));
                    }
                } catch (java.io.IOException unreadable) {
                    sender.sendMessage(Text.bad("Could not read that circuit."));
                    getLogger().warning("circuit " + args[1] + ": " + unreadable.getMessage());
                }

                return true;
            }

            case "stopboss", "clearbosses", "bossoff" -> {
                int gone = boss.dismiss();

                sender.sendMessage(gone == 0
                        ? Text.good("No Warden to send away.")
                        : Text.good("Sent away " + gone + " Warden"
                                + (gone == 1 ? "" : "s") + ". The next is due in "
                                + Text.roughly((int) boss.secondsUntil()) + "."));
                return true;
            }

            case "startboss", "bossnow" -> {
                if (boss.startNow(sender)) {
                    sender.sendMessage(Text.good("The Warden is up."));
                    sender.sendMessage(Text.plain("  /boss go to get there."));
                }
                return true;
            }

            case "setboss" -> {
                if (!(sender instanceof Player player)) return true;

                // Where the boss rises. Without one it uses the survival spawn,
                // which is rarely where anybody wants a ravager appearing.
                settings().setSpot("boss", player.getLocation());
                sender.sendMessage(Text.good("The boss will rise here."));
                return true;
            }

            case "boss" -> {
                boss.show(sender);
                return true;
            }

            case "tpnpc" -> {
                if (!(sender instanceof Player player)) return true;
                if (args.length < 2) {
                    sender.sendMessage(Text.bad("/nexus tpnpc <id>"));
                    return true;
                }

                // Goes to where the bot is, so you can see what you placed
                // without hunting for it.
                var at = settings().npcAt(Hub.idFor(args[1]), hub.world(), null);
                if (at == null) sender.sendMessage(Text.bad("That one has not been placed yet."));
                else {
                    player.teleport(at);
                    sender.sendMessage(Text.good("There it is."));
                }
            }

            case "layout" -> {
                if (!(sender instanceof Player player)) return true;

                layout.report(player, layout.arrange(player));
            }

            case "clearholograms" -> {
                int had = holograms.count();
                holograms.clearAll();
                sender.sendMessage(Text.good("Removed " + had + "."));
            }

            case "event" -> {
                if (args.length < 2) {
                    sender.sendMessage(Text.plain("  /nexus event airdrop|happyhour|meteors|horde"));
                    sender.sendMessage(Text.plain("  next one on its own in "
                            + Text.clock(events.nextIn())));
                    return true;
                }
                sender.sendMessage(events.force(args[1])
                        ? Text.good("Fired.") : Text.bad("No event called that."));
            }

            case "chatgame" -> {
                chatGames.forceOne();
                sender.sendMessage(Text.good("Asked one."));
            }

            case "clearnpc" -> {
                if (args.length < 2) {
                    sender.sendMessage(Text.bad("/nexus clearnpc <id> [last]"));
                    return true;
                }
                /*
                 * Resolved before it is used, and said so when it cannot be.
                 *
                 * This passed whatever was typed straight through, so a name
                 * that is not a bot at all came back as "none of those are
                 * placed" - which reads as the name being right.
                 */
                String clearing = Hub.idFor(args[1]);

                if (clearing == null) {
                    sender.sendMessage(Text.bad("There is no bot called '" + args[1] + "'."));
                    sender.sendMessage(Text.plain("  " + String.join(", ", Hub.npcIds())));
                    return true;
                }

                boolean onlyLast = args.length > 2 && args[2].equalsIgnoreCase("last");
                sender.sendMessage(settings.clearNpc(clearing, onlyLast)
                        ? Text.good(onlyLast ? "Removed the last one." : "Removed them all.")
                        : Text.bad("No " + clearing + " is placed anywhere."));
                hub.placeNpcs();
            }

            case "npcs" -> {
                hub.placeNpcs();
                holograms.rebuild();
                sender.sendMessage(Text.good("Greeters replaced."));
            }

            case "addskin" -> {
                if (args.length < 4) {
                    sender.sendMessage(Text.bad("/nexus addskin <id> <price> <url>"));
                    sender.sendMessage(Text.plain("  The URL must be a textures.minecraft.net one."));
                    sender.sendMessage(Text.plain("  Upload the PNG to MineSkin to get one."));
                    return true;
                }
                try {
                    String trouble = skins.add(args[1], args[1],
                            Integer.parseInt(args[2]), args[3]);
                    sender.sendMessage(trouble == null
                            ? Text.good("Added. " + skins.count() + " skins in the shop.")
                            : Text.bad(trouble));
                } catch (NumberFormatException bad) {
                    sender.sendMessage(Text.bad("The price has to be a number."));
                }
            }

            case "removeskin" -> {
                if (args.length < 2) {
                    sender.sendMessage(Text.bad("/nexus removeskin <id>"));
                    return true;
                }
                sender.sendMessage(skins.remove(args[1])
                        ? Text.good("Removed.") : Text.bad("No skin called that."));
            }

            case "givekey" -> {
                if (args.length < 3) {
                    sender.sendMessage(Text.bad("/nexus givekey <player> <common|rare|legendary> [n]"));
                    return true;
                }
                Player target = Bukkit.getPlayerExact(args[1]);
                if (target == null) {
                    sender.sendMessage(Text.bad("They are not online."));
                    return true;
                }
                try {
                    Crates.Tier tier = Crates.Tier.valueOf(args[2].toUpperCase());
                    int many = args.length > 3 ? Integer.parseInt(args[3]) : 1;
                    crates.give(target, tier, Math.max(1, Math.min(64, many)));
                    sender.sendMessage(Text.good("Given."));
                } catch (IllegalArgumentException bad) {
                    sender.sendMessage(Text.bad("common, rare or legendary."));
                }
            }

            case "pay" -> {
                if (args.length < 3) {
                    sender.sendMessage(Text.bad("/nexus pay <player> <amount>"));
                    return true;
                }
                Player target = Bukkit.getPlayerExact(args[1]);
                if (target == null) {
                    sender.sendMessage(Text.bad("They are not online."));
                    return true;
                }
                try {
                    double amount = Double.parseDouble(args[2]);
                    stats.pay(target.getUniqueId(), amount);
                    sender.sendMessage(Text.good("Paid " + target.getName() + " " + Stats.cash(amount)));
                    target.sendMessage(Text.says("You were given " + Stats.cash(amount) + "."));
                } catch (NumberFormatException notANumber) {
                    sender.sendMessage(Text.bad("That is not a number."));
                }
            }

            case "rollback" -> {
                if (args.length < 3) {
                    sender.sendMessage(Text.bad("/nexus rollback <player> <minutes>"));
                    return true;
                }

                int minutes = tryInt(args[2], 0);
                if (minutes <= 0) {
                    sender.sendMessage(Text.bad("Minutes has to be a number above zero."));
                    return true;
                }

                blockLog.rollback(sender, args[1], minutes);
                return true;
            }

            case "lookup" -> {
                if (args.length < 2) {
                    sender.sendMessage(Text.bad("/nexus lookup <player> [minutes]"));
                    return true;
                }

                blockLog.recent(sender, args[1],
                        args.length > 2 ? tryInt(args[2], 60) : 60);
                return true;
            }

            case "votekey" -> {
                voting.showKey(sender);
                return true;
            }

            case "rebuild" -> {
                /*
                 * Lay a generated world out again, now.
                 *
                 * The version markers handle this on a restart, but a shaft you
                 * are standing in front of that is visibly wrong should not need
                 * one - and if a rebuild ever goes wrong, this is how it gets
                 * put right without editing a file.
                 */
                String what = args.length > 1 ? args[1].toLowerCase() : "";

                switch (what) {
                    case "dropper" -> {
                        dropper.world();
                        dropper.rebuild();
                        sender.sendMessage(Text.good("Dropper rebuilt: "
                                + Dropper.shafts() + " shafts."));
                    }
                    case "digsite", "dig" -> {
                        digSite.rebuild();
                        sender.sendMessage(Text.good("Dig site rebuilt."));
                        sender.sendMessage(Text.plain("  The camp meets the field now."));
                    }
                    case "prison" -> {
                        prison.rebuild();
                        sender.sendMessage(Text.good("Prison rebuilt: "
                                + Prison.LETTERS.length + " mines."));
                        sender.sendMessage(Text.plain("  The mines are further apart now."));
                    }
                    case "parkour" -> {
                        parkour.rebuild();
                        sender.sendMessage(Text.good("Parkour rebuilt: "
                                + Course.count() + " courses."));
                    }
                    default -> {
                        sender.sendMessage(Text.bad("/nexus rebuild <dropper|parkour>"));
                        sender.sendMessage(Text.plain("  Clears it out and lays it again."));
                    }
                }
                return true;
            }

            case "backup" -> {
                backups.take(sender, false);
                return true;
            }

            case "backups" -> {
                backups.list(sender);
                return true;
            }

            case "endseason" -> {
                /*
                 * The one command here with no undo.
                 *
                 * It wipes every balance on the server, so it asks for the word
                 * and the season number typed out. Anything easier than that is
                 * something somebody eventually does by accident at midnight.
                 */
                int current = seasons.season();

                if (args.length < 3 || !args[1].equalsIgnoreCase("confirm")
                        || tryInt(args[2], -1) != current) {
                    sender.sendMessage(Text.bad("This wipes everybody's money, "
                            + "ranks and records."));
                    sender.sendMessage(Text.plain("  Prestige, achievements, "
                            + "cosmetics and skins are kept."));
                    sender.sendMessage(Text.plain("  /nexus endseason confirm "
                            + current));
                    return true;
                }

                seasons.endSeason(sender);
                return true;
            }

            case "coins" -> {
                if (args.length < 3) {
                    sender.sendMessage(Text.bad("/nexus coins <player> <amount>"));
                    return true;
                }

                Player target = getServer().getPlayerExact(args[1]);
                if (target == null) {
                    sender.sendMessage(Text.bad("They are not online."));
                    return true;
                }

                int amount = tryInt(args[2], 0);
                stats.of(target.getUniqueId()).coins += amount;

                sender.sendMessage(Text.good("Gave " + target.getName() + " "
                        + amount + " coins."));
                target.sendMessage(Text.good("+" + amount + " coins."));
                return true;
            }

            case "ignoreclaims" -> {
                if (sender instanceof Player player) claims.toggleIgnore(player);
                return true;
            }

            case "save" -> {
                stats.save();
                sender.sendMessage(Text.good("Saved."));
            }

            default -> sender.sendMessage(Text.bad("No such subcommand."));
        }
        return true;
    }
}
