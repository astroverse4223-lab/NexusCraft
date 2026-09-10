package dev.nexuscraft.nexus;

import org.bukkit.configuration.file.YamlConfiguration;

import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * What everybody has done, kept between restarts.
 *
 * This is the part that turns a server into somewhere people come back to. A
 * match nobody records is an afternoon; a match that moves a number is a
 * season. Wins, kills, beds and coins, and nothing else — every extra column is
 * one more thing to keep correct and one fewer that anybody reads.
 *
 * Held in memory and written to one YAML file, which is the right shape at this
 * size: a few hundred players is a file you can open and read, and there is no
 * database to install before anyone can play. If it ever outgrows that, the
 * whole storage layer is the two methods at the bottom.
 */
public final class Stats {

    /** One player's record. Mutable, and only ever touched on the main thread. */
    public static final class Record {
        public String rank = "PLAYER";

        /**
         * Money, which is not the same thing as coins.
         *
         * Coins are earned in minigames and are a score. Money is earned by
         * working in prison or selling in survival and is spent in the shops.
         * Keeping them apart means winning at BedWars cannot buy a prison
         * rankup, which would make the ladder meaningless within an hour.
         */
        public double money;

        /* ----------------------------------------------------------- the dig */

        /** How many finds are in the pack right now. */
        public int carrying;

        /** What those finds will fetch, worked out as they were dug. */
        public double dugValue;

        /** Which pack and which shovel have been paid for. */
        public int packLevel;
        public int shovelLevel;
        /** 0 until a metal detector is bought. Higher hears further. */
        public int detectorLevel;
        /** Relics handed to the museum, by name, so a set can be completed. */
        public final java.util.Set<String> donated = new java.util.HashSet<>();
        /** How many times the dig has been started over, for the multiplier. */
        public int digPrestige;
        /**
         * What somebody won in a season that is over.
         *
         * The one thing a wipe never touches. A season with nothing left at
         * the end of it is six weeks of work deleted, and the whole reason to
         * chase a leaderboard is that finishing top of it stays true.
         */
        public final java.util.Set<String> trophies = new java.util.LinkedHashSet<>();

        /** How many blocks have ever been dug, for the record. */
        public int blocksDug;

        /** How far up the prison ladder, as an index into the rank letters. */
        public int prisonRank;
        /**
         * What `blocksMined` stood at when this player last ranked up.
         *
         * Rank used to cost only money, so anybody who arrived with savings
         * could buy their way from A to J without ever swinging a pickaxe, and
         * every mine after the first was scenery.
         */
        public int rankMinedAt;

        public int blocksMined;

        /**
         * What the work has made of them.
         *
         * Separate from blocksMined, which counts and pays; these are spent on
         * perks and are the only numbers here that change how the game plays
         * rather than what it is worth.
         */
        public int miningPoints;
        public int combatPoints;
        public int farmingPoints;

        /** How far into the One Block run they are. */
        public int oneBlockBroken;

        /** What their Skyblock island last scored, and the level that made. */
        public int islandPoints;

        /** What has been bought for the island, and what has been asked of it. */
        public int upgradeGenerator;
        public int upgradeSize;
        public int upgradeGrowth;
        public final java.util.Set<String> challengesDone = new java.util.HashSet<>();

        public int islandLevel;

        /** Daily reward: the day it was last taken, and the run of days. */
        public int lastDailyDay;
        public int dailyStreak;

        /** Minutes actually spent on the server, paid out in twenty minute blocks. */
        public int minutesPlayed;

        /** Money made from selling, which one of the quests asks about. */
        public double soldValue;

        /**
         * Quests, as a day plus a snapshot.
         *
         * Progress is "how much since this morning", so the baselines are what
         * each counter read the first time they were seen today. Counting from
         * zero would need counters that get cleared, and a nightly clearing job
         * is a thing that fails while nobody is watching.
         */
        public int questDay;
        public int questsDone;
        public int questBaseMined;
        public double questBaseSold;
        public int questBaseWins;
        public int questBaseOneBlock;
        public int questBaseMinutes;

        /** Cosmetics owned, as "trail:FLAME" and "hat:PUMPKIN". */
        public final java.util.Set<String> cosmetics = new java.util.HashSet<>();

        /** And which of them is on. */
        public String trail = "NONE";
        public String hat = "NONE";

        /** The job they hold now, and how far into it. */
        public String job = "NONE";
        public int jobLevel = 1;
        public int jobExperience;
        public double jobEarned;

        /**
         * Levels kept per job rather than one shared number.
         *
         * Switching job would otherwise wipe what you had, which turns a choice
         * into a trap somebody sprang in their first ten minutes.
         */
        public final java.util.Map<String, Integer> jobLevels = new java.util.HashMap<>();
        public final java.util.Map<String, Integer> jobExperiences = new java.util.HashMap<>();

        /** Which of the trader's three deals have been taken, and on what day. */
        public int tradeDay;
        public int tradesDone;

        /** Skins bought from the skin shop, and the one being worn. */
        public final java.util.Set<String> skins = new java.util.HashSet<>();
        public String skin = "";

        /** Parkour: best time in seconds, and how many runs finished. */
        /**
         * Best time across every course, and how many runs in total.
         *
         * Kept alongside the per-course times rather than derived from them,
         * because this is what the achievements and the leaderboard read and
         * neither wants to walk a map to answer "what is their best".
         */
        public int parkourBest;
        public int parkourRuns;

        /**
         * Best time on each course, keyed by course number.
         *
         * A map rather than a field each, so adding a course is a constant in
         * one file and not a change to the save format. A course with no entry
         * has never been finished, which is also how the ladder knows what is
         * unlocked.
         */
        public final java.util.Map<Integer, Integer> parkourTimes = new java.util.HashMap<>();

        /** How many courses they have finished at least once. */
        public int parkourCleared() {
            return parkourTimes.size();
        }

        /** Their best on one course, or 0 if they have never finished it. */
        public int parkourBestOn(int course) {
            return parkourTimes.getOrDefault(course, 0);
        }

        /** Dropper stages cleared, as a bitmask. */
        /**
         * Which dropper stages have been cleared, one bit each.
         *
         * A bitmask rather than a count, so it knows the difference between
         * clearing three different stages and clearing the first one three
         * times, and so adding stages never invalidates what is stored.
         *
         * Read it with dropperLevels(), never as a number - the two are only
         * the same for the first stage, which is exactly long enough for the
         * mistake to look like it works.
         */
        public int dropperCleared;

        /** How many stages have actually been cleared. */
        public int dropperLevels() {
            return Integer.bitCount(dropperCleared);
        }

        /** Best fall on each shaft, in seconds, keyed by shaft number. */
        public final java.util.Map<Integer, Integer> dropperTimes = new java.util.HashMap<>();

        public int dropperBestOn(int shaft) {
            return dropperTimes.getOrDefault(shaft, 0);
        }

        /** Chat games won, which pays a key every tenth. */
        public int chatWins;

        /** Achievements already earned, by id. Nothing is ever taken away. */
        public final java.util.Set<String> achievements = new java.util.HashSet<>();

        /** Pets bought, and the one currently following them around. */
        public final java.util.Set<String> pets = new java.util.HashSet<>();
        public String pet = "NONE";

        /**
         * How many times they have given everything up and started again.
         *
         * Survives a season reset, deliberately: it is the one number that
         * says what somebody did rather than what they currently have.
         */
        public int prestige;

        /**
         * Votes, and the run of days they have voted on.
         *
         * The streak counts days rather than votes, because most lists allow
         * one vote a day each - counting votes would reward having found more
         * sites rather than turning up.
         */
        public int votes;
        public int voteStreak;
        public int lastVoteDay;

        /** Money other people have put on this player's head. */
        public double bounty;

        /** Collected from other people's heads, which is worth bragging about. */
        public double bountiesClaimed;

        public int coins;
        public int wins;
        public int losses;
        public int kills;
        public int deaths;
        public int bedsBroken;
        public int gamesPlayed;

        /** Best run of wins without losing, which people chase harder than totals. */
        public int bestStreak;
        public int streak;

        public double kd() {
            return deaths == 0 ? kills : (double) kills / deaths;
        }

        void won() {
            wins++;
            gamesPlayed++;
            streak++;
            if (streak > bestStreak) bestStreak = streak;
        }

        void lost() {
            losses++;
            gamesPlayed++;
            streak = 0;
        }
    }

    /**
     * A multiplier on everything paid out, for happy hour.
     *
     * Applied here rather than at each call site because there are now a dozen
     * places that pay somebody, and one of them being missed would mean an
     * event that visibly does not apply to whatever you happen to be doing.
     */
    private volatile double multiplier = 1.0;

    private final File file;
    private final Map<UUID, Record> records = new ConcurrentHashMap<>();

    public Stats(File directory) {
        this.file = new File(directory, "stats.yml");
        load();
    }

    public Record of(UUID who) {
        return records.computeIfAbsent(who, id -> new Record());
    }

    /**
     * Everybody the server has ever seen, for anything that has to sweep.
     *
     * Read only in spirit rather than by type - the records themselves are
     * mutable and are meant to be, since that is how every other caller here
     * changes somebody's money. What must not happen is adding or removing
     * entries, which is what `of` is for.
     */
    public Map<UUID, Record> everybody() {
        return records;
    }

    public Ranks rankOf(UUID who) {
        return Ranks.of(of(who).rank);
    }

    public void setRank(UUID who, Ranks rank) {
        of(who).rank = rank.name();
    }

    /* ------------------------------------------------------------ scoring */

    public void wonMatch(UUID who, int coins) {
        Record record = of(who);
        record.won();
        record.coins += coins;
    }

    /** Blocks broken anywhere that counts toward the mining quest. */
    public void mined(UUID who) {
        of(who).blocksMined++;
    }

    public void lostMatch(UUID who, int coins) {
        Record record = of(who);
        record.lost();
        record.coins += coins;
    }

    public void killed(UUID who) {
        of(who).kills++;
        of(who).coins += 5;
    }

    public void died(UUID who) {
        of(who).deaths++;
    }

    public void brokeBed(UUID who) {
        of(who).bedsBroken++;
        of(who).coins += 25;
    }

    /* --------------------------------------------------------------- money */

    public double moneyOf(UUID who) {
        return of(who).money;
    }

    /**
     * Somebody's prestige bonus, folded in with the happy hour multiplier.
     *
     * Applied here for the same reason the multiplier is: there are now more
     * than a dozen places that pay somebody, and a bonus that visibly applies
     * to mining but not to quests is a bug report rather than a feature.
     */
    private double bonusFor(UUID who) {
        return 1.0 + 0.05 * of(who).prestige;
    }

    public void pay(UUID who, double amount) {
        of(who).money += amount * multiplier * bonusFor(who);
    }

    public void setMultiplier(double value) {
        this.multiplier = Math.max(0.1, value);
    }

    public double multiplier() {
        return multiplier;
    }

    /** Takes money if there is enough. Returns false and takes nothing if not. */
    public boolean charge(UUID who, double amount) {
        Record record = of(who);
        if (record.money < amount) return false;

        record.money -= amount;
        return true;
    }

    /** Money as people expect to see it, with a symbol and two decimals. */
    public static String cash(double amount) {
        return String.format("$%,.2f", amount);
    }

    /* -------------------------------------------------------- leaderboards */

    /** The top few by whatever is asked for, with names resolved by the caller. */
    public List<Map.Entry<UUID, Record>> top(Comparator<Record> by, int many) {
        List<Map.Entry<UUID, Record>> all = new ArrayList<>(records.entrySet());
        all.sort((a, b) -> by.compare(b.getValue(), a.getValue()));
        return all.subList(0, Math.min(many, all.size()));
    }

    /* -------------------------------------------------------------- on disk */

    private void load() {
        if (!file.exists()) return;

        YamlConfiguration yaml = YamlConfiguration.loadConfiguration(file);
        for (String key : yaml.getKeys(false)) {
            UUID who;
            try {
                who = UUID.fromString(key);
            } catch (IllegalArgumentException notAnId) {
                continue;
            }

            Record record = new Record();
            record.rank = yaml.getString(key + ".rank", "PLAYER");
            record.money = yaml.getDouble(key + ".money");
            record.prisonRank = yaml.getInt(key + ".prisonRank");

            record.carrying = yaml.getInt(key + ".carrying");
            record.dugValue = yaml.getDouble(key + ".dugValue");
            record.packLevel = yaml.getInt(key + ".packLevel");
            record.shovelLevel = yaml.getInt(key + ".shovelLevel");
            record.detectorLevel = yaml.getInt(key + ".detectorLevel");
            record.digPrestige = yaml.getInt(key + ".digPrestige");
            record.trophies.addAll(yaml.getStringList(key + ".trophies"));
            record.donated.addAll(yaml.getStringList(key + ".donated"));
            record.blocksDug = yaml.getInt(key + ".blocksDug");
            record.rankMinedAt = yaml.getInt(key + ".rankMinedAt");
            record.blocksMined = yaml.getInt(key + ".blocksMined");
            record.miningPoints = yaml.getInt(key + ".miningPoints");
            record.combatPoints = yaml.getInt(key + ".combatPoints");
            record.farmingPoints = yaml.getInt(key + ".farmingPoints");
            record.oneBlockBroken = yaml.getInt(key + ".oneBlockBroken");
            record.islandPoints = yaml.getInt(key + ".islandPoints");
            record.upgradeGenerator = yaml.getInt(key + ".upgradeGenerator");
            record.upgradeSize = yaml.getInt(key + ".upgradeSize");
            record.upgradeGrowth = yaml.getInt(key + ".upgradeGrowth");
            record.challengesDone.addAll(yaml.getStringList(key + ".challengesDone"));
            record.islandLevel = yaml.getInt(key + ".islandLevel");
            record.lastDailyDay = yaml.getInt(key + ".lastDailyDay");
            record.dailyStreak = yaml.getInt(key + ".dailyStreak");
            record.minutesPlayed = yaml.getInt(key + ".minutesPlayed");
            record.soldValue = yaml.getDouble(key + ".soldValue");
            record.questDay = yaml.getInt(key + ".questDay");
            record.questsDone = yaml.getInt(key + ".questsDone");
            record.questBaseMined = yaml.getInt(key + ".questBaseMined");
            record.questBaseSold = yaml.getDouble(key + ".questBaseSold");
            record.questBaseWins = yaml.getInt(key + ".questBaseWins");
            record.questBaseOneBlock = yaml.getInt(key + ".questBaseOneBlock");
            record.questBaseMinutes = yaml.getInt(key + ".questBaseMinutes");
            record.cosmetics.addAll(yaml.getStringList(key + ".cosmetics"));
            record.trail = yaml.getString(key + ".trail", "NONE");
            record.hat = yaml.getString(key + ".hat", "NONE");
            record.job = yaml.getString(key + ".job", "NONE");
            record.jobLevel = Math.max(1, yaml.getInt(key + ".jobLevel"));
            record.jobExperience = yaml.getInt(key + ".jobExperience");
            record.jobEarned = yaml.getDouble(key + ".jobEarned");
            record.tradeDay = yaml.getInt(key + ".tradeDay");
            record.tradesDone = yaml.getInt(key + ".tradesDone");
            record.skins.addAll(yaml.getStringList(key + ".skins"));
            record.skin = yaml.getString(key + ".skin", "");
            record.parkourBest = yaml.getInt(key + ".parkourBest");

            var times = yaml.getConfigurationSection(key + ".parkourTimes");
            if (times != null) {
                for (String course : times.getKeys(false)) {
                    try {
                        record.parkourTimes.put(Integer.parseInt(course),
                                times.getInt(course));
                    } catch (NumberFormatException notACourse) {
                        // A hand-edited file should not stop the server loading.
                    }
                }
            } else if (record.parkourBest > 0) {
                /*
                 * Somebody who ran the old single course.
                 *
                 * Their time was set on what is now course 1, so it is recorded
                 * there rather than discarded - throwing away a personal best
                 * because the file format changed is the sort of thing people
                 * do not forgive.
                 */
                record.parkourTimes.put(0, record.parkourBest);
            }
            record.parkourRuns = yaml.getInt(key + ".parkourRuns");
            record.dropperCleared = yaml.getInt(key + ".dropperCleared");

            var falls = yaml.getConfigurationSection(key + ".dropperTimes");
            if (falls != null) {
                for (String shaft : falls.getKeys(false)) {
                    try {
                        record.dropperTimes.put(Integer.parseInt(shaft),
                                falls.getInt(shaft));
                    } catch (NumberFormatException notAShaft) {
                        // A hand-edited file should not stop the server loading.
                    }
                }
            }
            record.achievements.addAll(yaml.getStringList(key + ".achievements"));
            record.pets.addAll(yaml.getStringList(key + ".pets"));
            record.pet = yaml.getString(key + ".pet", "NONE");
            record.prestige = yaml.getInt(key + ".prestige");
            record.votes = yaml.getInt(key + ".votes");
            record.voteStreak = yaml.getInt(key + ".voteStreak");
            record.lastVoteDay = yaml.getInt(key + ".lastVoteDay");
            record.bounty = yaml.getDouble(key + ".bounty");
            record.bountiesClaimed = yaml.getDouble(key + ".bountiesClaimed");
            record.chatWins = yaml.getInt(key + ".chatWins");

            var levels = yaml.getConfigurationSection(key + ".jobLevels");
            if (levels != null) {
                for (String job : levels.getKeys(false)) {
                    record.jobLevels.put(job, levels.getInt(job));
                }
            }
            var experiences = yaml.getConfigurationSection(key + ".jobExperiences");
            if (experiences != null) {
                for (String job : experiences.getKeys(false)) {
                    record.jobExperiences.put(job, experiences.getInt(job));
                }
            }
            record.coins = yaml.getInt(key + ".coins");
            record.wins = yaml.getInt(key + ".wins");
            record.losses = yaml.getInt(key + ".losses");
            record.kills = yaml.getInt(key + ".kills");
            record.deaths = yaml.getInt(key + ".deaths");
            record.bedsBroken = yaml.getInt(key + ".bedsBroken");
            record.gamesPlayed = yaml.getInt(key + ".gamesPlayed");
            record.bestStreak = yaml.getInt(key + ".bestStreak");
            records.put(who, record);
        }
    }

    /**
     * Saves everything.
     *
     * Called on a timer and again on shutdown rather than after every change:
     * writing a file every time somebody gets a kill is a lot of disk for a
     * number that nobody will miss if the power goes out mid-match.
     *
     * The current streak is deliberately not saved. A streak is a thing you are
     * on right now, and carrying one across a restart three days later is not
     * what anybody means by it.
     */
    public void save() {
        YamlConfiguration yaml = new YamlConfiguration();

        for (Map.Entry<UUID, Record> entry : records.entrySet()) {
            String key = entry.getKey().toString();
            Record record = entry.getValue();

            yaml.set(key + ".rank", record.rank);
            yaml.set(key + ".money", record.money);
            yaml.set(key + ".prisonRank", record.prisonRank);

            yaml.set(key + ".carrying", record.carrying);
            yaml.set(key + ".dugValue", record.dugValue);
            yaml.set(key + ".packLevel", record.packLevel);
            yaml.set(key + ".shovelLevel", record.shovelLevel);
            yaml.set(key + ".detectorLevel", record.detectorLevel);
            yaml.set(key + ".digPrestige", record.digPrestige);
            yaml.set(key + ".trophies", new java.util.ArrayList<>(record.trophies));
            yaml.set(key + ".donated", new java.util.ArrayList<>(record.donated));
            yaml.set(key + ".blocksDug", record.blocksDug);
            yaml.set(key + ".rankMinedAt", record.rankMinedAt);
            yaml.set(key + ".blocksMined", record.blocksMined);
            yaml.set(key + ".miningPoints", record.miningPoints);
            yaml.set(key + ".combatPoints", record.combatPoints);
            yaml.set(key + ".farmingPoints", record.farmingPoints);
            yaml.set(key + ".oneBlockBroken", record.oneBlockBroken);
            yaml.set(key + ".islandPoints", record.islandPoints);
            yaml.set(key + ".upgradeGenerator", record.upgradeGenerator);
            yaml.set(key + ".upgradeSize", record.upgradeSize);
            yaml.set(key + ".upgradeGrowth", record.upgradeGrowth);
            yaml.set(key + ".challengesDone", new java.util.ArrayList<>(record.challengesDone));
            yaml.set(key + ".islandLevel", record.islandLevel);
            yaml.set(key + ".lastDailyDay", record.lastDailyDay);
            yaml.set(key + ".dailyStreak", record.dailyStreak);
            yaml.set(key + ".minutesPlayed", record.minutesPlayed);
            yaml.set(key + ".soldValue", record.soldValue);
            yaml.set(key + ".questDay", record.questDay);
            yaml.set(key + ".questsDone", record.questsDone);
            yaml.set(key + ".questBaseMined", record.questBaseMined);
            yaml.set(key + ".questBaseSold", record.questBaseSold);
            yaml.set(key + ".questBaseWins", record.questBaseWins);
            yaml.set(key + ".questBaseOneBlock", record.questBaseOneBlock);
            yaml.set(key + ".questBaseMinutes", record.questBaseMinutes);
            yaml.set(key + ".cosmetics", new java.util.ArrayList<>(record.cosmetics));
            yaml.set(key + ".trail", record.trail);
            yaml.set(key + ".hat", record.hat);
            yaml.set(key + ".job", record.job);
            yaml.set(key + ".jobLevel", record.jobLevel);
            yaml.set(key + ".jobExperience", record.jobExperience);
            yaml.set(key + ".jobEarned", record.jobEarned);
            yaml.set(key + ".tradeDay", record.tradeDay);
            yaml.set(key + ".tradesDone", record.tradesDone);
            yaml.set(key + ".skins", new java.util.ArrayList<>(record.skins));
            yaml.set(key + ".skin", record.skin);
            yaml.set(key + ".parkourBest", record.parkourBest);

            for (var time : record.parkourTimes.entrySet()) {
                yaml.set(key + ".parkourTimes." + time.getKey(), time.getValue());
            }
            yaml.set(key + ".parkourRuns", record.parkourRuns);
            yaml.set(key + ".dropperCleared", record.dropperCleared);

            for (var fall : record.dropperTimes.entrySet()) {
                yaml.set(key + ".dropperTimes." + fall.getKey(), fall.getValue());
            }
            yaml.set(key + ".chatWins", record.chatWins);
            yaml.set(key + ".achievements", new java.util.ArrayList<>(record.achievements));
            yaml.set(key + ".pets", new java.util.ArrayList<>(record.pets));
            yaml.set(key + ".pet", record.pet);
            yaml.set(key + ".prestige", record.prestige);
            yaml.set(key + ".votes", record.votes);
            yaml.set(key + ".voteStreak", record.voteStreak);
            yaml.set(key + ".lastVoteDay", record.lastVoteDay);
            yaml.set(key + ".bounty", record.bounty);
            yaml.set(key + ".bountiesClaimed", record.bountiesClaimed);

            for (var level : record.jobLevels.entrySet()) {
                yaml.set(key + ".jobLevels." + level.getKey(), level.getValue());
            }
            for (var experience : record.jobExperiences.entrySet()) {
                yaml.set(key + ".jobExperiences." + experience.getKey(), experience.getValue());
            }
            yaml.set(key + ".coins", record.coins);
            yaml.set(key + ".wins", record.wins);
            yaml.set(key + ".losses", record.losses);
            yaml.set(key + ".kills", record.kills);
            yaml.set(key + ".deaths", record.deaths);
            yaml.set(key + ".bedsBroken", record.bedsBroken);
            yaml.set(key + ".gamesPlayed", record.gamesPlayed);
            yaml.set(key + ".bestStreak", record.bestStreak);
        }

        try {
            yaml.save(file);
        } catch (IOException e) {
            throw new IllegalStateException("could not write " + file, e);
        }
    }
}
