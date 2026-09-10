package dev.nexuscraft.nexus.bedwars;

import dev.nexuscraft.nexus.Game;
import dev.nexuscraft.nexus.Match;
import dev.nexuscraft.nexus.Nexus;
import dev.nexuscraft.nexus.Sidebar;
import dev.nexuscraft.nexus.Text;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.title.Title;
import org.bukkit.Color;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.Sound;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.enchantments.Enchantment;
import org.bukkit.entity.Player;
import org.bukkit.entity.Villager;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.LeatherArmorMeta;
import org.bukkit.potion.PotionEffect;
import org.bukkit.potion.PotionEffectType;

import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * A game of BedWars, from the first spawn to the last bed.
 *
 * The shape of the thing: four teams, four beds, and a rule that you only stay
 * dead once your bed is gone. Everything else — the generators, the shop, the
 * upgrades — exists to make the twenty minutes between those two facts
 * interesting, and the timings below are what keep it moving. A match with no
 * escalation is a stalemate, so the middle gets richer on a clock whether
 * anybody has gone for it or not.
 */
public final class BedWarsMatch extends Match {

    /** When the middle starts paying better, in seconds from the start. */
    private static final int DIAMOND_TIER_TWO = 6 * 60;
    private static final int EMERALD_TIER_TWO = 8 * 60;
    private static final int DIAMOND_TIER_THREE = 12 * 60;

    /**
     * When beds stop mattering.
     *
     * Without this a match between two turtling teams never ends. At twenty
     * minutes every bed goes at once and it becomes last-team-standing, which
     * resolves it within a couple of minutes every time.
     */
    private static final int SUDDEN_DEATH = 20 * 60;

    /** And a hard stop, so nothing runs forever if that somehow fails. */
    private static final int GIVE_UP = 30 * 60;

    private static final int RESPAWN_SECONDS = 5;

    private final BedWars game;

    private World world;
    private Field field;

    private final Squad[] squads = Squad.four();
    private final Map<UUID, Squad> squadOf = new HashMap<>();
    private final Map<UUID, Sidebar> boards = new HashMap<>();

    /** Still in the game, on their feet. Not the same as still connected. */
    private final Set<UUID> alive = new LinkedHashSet<>();

    /** Dead and counting down, in seconds. */
    private final Map<UUID, Integer> respawning = new HashMap<>();

    /**
     * Every block a player put down.
     *
     * Only these can be broken. Without the rule, the first thing anybody does
     * is mine the island out from under their own bed, and the map stops being
     * a map about ten seconds in.
     */
    private final Set<Long> placed = new HashSet<>();

    private int endingIn = -1;

    BedWarsMatch(Nexus nexus, BedWars game) {
        super(nexus);
        this.game = game;
    }

    @Override
    public Game game() {
        return game;
    }

    public Squad squadOf(UUID who) {
        return squadOf.get(who);
    }

    public boolean isAlive(UUID who) {
        return alive.contains(who);
    }

    public String worldName() {
        return world == null ? "" : world.getName();
    }

    /**
     * Which team a bed belongs to, from its colour.
     *
     * The bed colours are declared in the same order as the squads, so the
     * colour is the team. Working it out from the position instead would mean
     * comparing coordinates against four known points and getting it wrong the
     * moment a bed is one block from where it was expected.
     */
    public Squad squadForBed(Material bed) {
        for (Squad squad : squads) {
            if (bed.name().equals(squad.name.toUpperCase(java.util.Locale.ROOT) + "_BED")) return squad;
        }
        return null;
    }

    /**
     * Pushes a just-bought upgrade onto everybody who is already holding gear.
     *
     * Without this an upgrade only takes effect the next time somebody dies,
     * which is exactly backwards: the team that is winning and not dying is the
     * team that never sees what it paid for.
     */
    public void reapplyUpgrades(Squad squad) {
        for (UUID id : squad.members) {
            Player player = nexus.getServer().getPlayer(id);
            if (player == null || !alive.contains(id)) continue;

            for (ItemStack piece : player.getInventory().getArmorContents()) {
                if (piece == null) continue;
                if (squad.protection > 0) {
                    piece.addUnsafeEnchantment(Enchantment.PROTECTION, squad.protection);
                }
            }

            for (ItemStack held : player.getInventory().getContents()) {
                if (held != null && held.getType().name().endsWith("_SWORD") && squad.sharpness > 0) {
                    held.addUnsafeEnchantment(Enchantment.SHARPNESS, squad.sharpness);
                }
            }

            if (squad.haste > 0) {
                player.addPotionEffect(new PotionEffect(
                        PotionEffectType.HASTE, Integer.MAX_VALUE, squad.haste - 1, false, false));
            }
            player.updateInventory();
        }
    }

    /* --------------------------------------------------------------- start */

    @Override
    public void start(Set<UUID> joining) {
        players.addAll(joining);

        world = dev.nexuscraft.nexus.Arena.create("bedwars");
        field = new Field(world);

        Material[] wool = new Material[squads.length];
        for (int i = 0; i < squads.length; i++) wool[i] = squads[i].wool;
        field.build(squads.length, wool);

        share(joining);

        for (UUID id : joining) {
            Player player = nexus.getServer().getPlayer(id);
            if (player == null) continue;

            alive.add(id);
            spawn(player, true);
            player.showTitle(Title.title(
                    Component.text("BED WARS", Text.BRAND),
                    Component.text("Protect your bed", NamedTextColor.GRAY),
                    Title.Times.times(Duration.ofMillis(300), Duration.ofSeconds(2), Duration.ofMillis(500))));
        }

        shopkeepers();
        announce(Text.says("The match has begun. Break the other beds."));
    }

    /**
     * Splits the lobby into teams, keeping parties together.
     *
     * Dealing players out one at a time is simpler and it is the wrong
     * behaviour: four friends who queued together get one corner of the map
     * each, which is the exact opposite of what joining as a party is for.
     */
    private void share(Set<UUID> joining) {
        List<List<Player>> groups = new ArrayList<>();
        Set<UUID> done = new HashSet<>();

        for (UUID id : joining) {
            if (done.contains(id)) continue;

            List<Player> party = new ArrayList<>();
            for (Player member : nexus.parties().membersOnline(id)) {
                if (joining.contains(member.getUniqueId()) && done.add(member.getUniqueId())) {
                    party.add(member);
                }
            }
            if (!party.isEmpty()) groups.add(party);
        }

        // Biggest group first, always into the emptiest team - which keeps the
        // sides even without ever splitting one of them.
        groups.sort((a, b) -> b.size() - a.size());

        for (List<Player> group : groups) {
            Squad smallest = squads[0];
            for (Squad squad : squads) {
                if (squad.members.size() < smallest.members.size()) smallest = squad;
            }
            for (Player member : group) {
                smallest.members.add(member.getUniqueId());
                squadOf.put(member.getUniqueId(), smallest);
            }
        }
    }

    /**
     * The two villagers at every base.
     *
     * Villagers rather than signs or a command, because a shop you walk up to
     * is a place on the map: it can be camped, it can be cut off, and running
     * back to it is a real cost. A menu bound to a key would be more convenient
     * and would delete a whole layer of the game.
     *
     * AI off and invulnerable, or the first thing that happens is one wanders
     * off the island and somebody kills the other for the drops.
     */
    private void shopkeepers() {
        for (Squad squad : squads) {
            if (squad.members.isEmpty()) continue;

            stand(field.shop(squad.index), "Shop", SHOP_TAG, Villager.Profession.WEAPONSMITH);
            stand(field.upgrades(squad.index), "Team Upgrades", UPGRADE_TAG, Villager.Profession.LIBRARIAN);
        }
    }

    public static final String SHOP_TAG = "nexus_shop";
    public static final String UPGRADE_TAG = "nexus_upgrades";

    private void stand(Location at, String name, String tag, Villager.Profession trade) {
        world.spawn(at, Villager.class, villager -> {
            villager.setAI(false);
            villager.setInvulnerable(true);
            villager.setSilent(true);
            villager.setCollidable(false);
            villager.setProfession(trade);
            villager.customName(Component.text(name, NamedTextColor.GREEN));
            villager.setCustomNameVisible(true);
            villager.addScoreboardTag(tag);
        });
    }

    /* -------------------------------------------------------------- spawns */

    private void spawn(Player player, boolean fresh) {
        Squad squad = squadOf.get(player.getUniqueId());
        if (squad == null) return;

        player.teleport(field.baseSpawn(squad.index));
        player.setGameMode(GameMode.SURVIVAL);
        player.setHealth(20.0);
        player.setFoodLevel(20);
        player.setSaturation(20f);
        player.setFireTicks(0);
        player.setFallDistance(0f);

        for (PotionEffect effect : new ArrayList<>(player.getActivePotionEffects())) {
            player.removePotionEffect(effect.getType());
        }

        kit(player, squad);

        if (!fresh) {
            // A moment of grace so a spawn-camper cannot kill somebody in the
            // instant they appear, before they can even see the screen.
            player.addPotionEffect(new PotionEffect(PotionEffectType.RESISTANCE, 60, 4, false, false));
        }
        if (squad.haste > 0) {
            player.addPotionEffect(new PotionEffect(
                    PotionEffectType.HASTE, Integer.MAX_VALUE, squad.haste - 1, false, false));
        }
    }

    /**
     * What you get back after dying.
     *
     * A sword and armour, and nothing else. Everything bought is lost, which is
     * what makes buying it a decision — and the armour carries the team's
     * upgrades, so a team that invested in protection still has it after a
     * death they would otherwise have been punished twice for.
     */
    private void kit(Player player, Squad squad) {
        player.getInventory().clear();

        ItemStack sword = new ItemStack(Material.WOODEN_SWORD);
        if (squad.sharpness > 0) sword.addUnsafeEnchantment(Enchantment.SHARPNESS, squad.sharpness);
        player.getInventory().addItem(sword);

        player.getInventory().setHelmet(dyed(Material.LEATHER_HELMET, squad));
        player.getInventory().setChestplate(dyed(Material.LEATHER_CHESTPLATE, squad));
        player.getInventory().setLeggings(dyed(Material.LEATHER_LEGGINGS, squad));
        player.getInventory().setBoots(dyed(Material.LEATHER_BOOTS, squad));
    }

    private ItemStack dyed(Material material, Squad squad) {
        ItemStack piece = new ItemStack(material);
        piece.editMeta(LeatherArmorMeta.class, meta -> {
            meta.setColor(Color.fromRGB(squad.colour.value()));
            meta.setUnbreakable(true);
        });
        if (squad.protection > 0) piece.addUnsafeEnchantment(Enchantment.PROTECTION, squad.protection);
        return piece;
    }

    /* ---------------------------------------------------------------- tick */

    @Override
    public void tick() {
        elapsed++;

        generators();
        respawns();
        heals();
        sidebars();

        if (elapsed == SUDDEN_DEATH) suddenDeath();
        if (elapsed >= GIVE_UP) {
            announce(Text.says("Time. Nobody won that one."));
            finish();
            return;
        }

        if (endingIn > 0) {
            endingIn--;
            if (endingIn == 0) finish();
        }
    }

    /**
     * Everything that drops out of the ground, on its own clock.
     *
     * Base iron is fast and constant because it is what the game runs on; the
     * middle is slow and gets faster, because the middle is what teams are
     * meant to fight over rather than farm.
     */
    private void generators() {
        for (Squad squad : squads) {
            if (squad.members.isEmpty()) continue;

            Location at = field.baseGenerator(squad.index);
            int ironEvery = Math.max(1, 2 - squad.forge / 2);

            if (elapsed % ironEvery == 0) drop(at, Material.IRON_INGOT, 1 + squad.forge / 3);
            if (elapsed % 7 == 0) drop(at, Material.GOLD_INGOT, 1);
            if (squad.forge >= 4 && elapsed % 30 == 0) drop(at, Material.EMERALD, 1);
        }

        int diamondEvery = elapsed >= DIAMOND_TIER_THREE ? 12 : elapsed >= DIAMOND_TIER_TWO ? 20 : 30;
        if (elapsed % diamondEvery == 0) {
            for (Location at : field.diamondGenerators()) drop(at, Material.DIAMOND, 1);
        }

        int emeraldEvery = elapsed >= EMERALD_TIER_TWO ? 40 : 60;
        if (elapsed % emeraldEvery == 0) {
            for (Location at : field.emeraldGenerators()) drop(at, Material.EMERALD, 1);
        }
    }

    /**
     * Items are capped where they land.
     *
     * A base nobody has visited for five minutes otherwise holds a tower of
     * three hundred iron, and whoever finally walks in buys the game outright.
     */
    private void drop(Location at, Material what, int amount) {
        int already = 0;
        for (var entity : world.getNearbyEntities(at, 3, 3, 3)) {
            if (entity instanceof org.bukkit.entity.Item item
                    && item.getItemStack().getType() == what) {
                already += item.getItemStack().getAmount();
            }
        }
        if (already >= 48) return;

        var dropped = world.dropItem(at.clone().add(0, 0.5, 0), new ItemStack(what, amount));
        dropped.setVelocity(new org.bukkit.util.Vector(0, 0.1, 0));
    }

    private void respawns() {
        for (UUID id : new ArrayList<>(respawning.keySet())) {
            int left = respawning.get(id) - 1;
            Player player = nexus.getServer().getPlayer(id);

            if (player == null) {
                respawning.remove(id);
                continue;
            }

            if (left <= 0) {
                respawning.remove(id);
                alive.add(id);
                spawn(player, false);
                player.showTitle(Title.title(
                        Component.text("You are back", NamedTextColor.GREEN), Component.empty(),
                        Title.Times.times(Duration.ZERO, Duration.ofSeconds(1), Duration.ofMillis(300))));
            } else {
                respawning.put(id, left);
                player.showTitle(Title.title(
                        Component.text(String.valueOf(left), NamedTextColor.RED),
                        Component.text("Respawning", NamedTextColor.GRAY),
                        Title.Times.times(Duration.ZERO, Duration.ofSeconds(2), Duration.ZERO)));
            }
        }
    }

    /** The heal pool upgrade, applied to anybody standing at their own base. */
    private void heals() {
        for (UUID id : alive) {
            Squad squad = squadOf.get(id);
            if (squad == null || !squad.healPool) continue;

            Player player = nexus.getServer().getPlayer(id);
            if (player == null) continue;

            if (player.getLocation().distanceSquared(field.baseGenerator(squad.index)) < 100) {
                player.addPotionEffect(new PotionEffect(PotionEffectType.REGENERATION, 40, 0, false, false));
            }
        }
    }

    private void suddenDeath() {
        for (Squad squad : squads) squad.bedAlive = false;
        announce(Text.says("Sudden death. Every bed is gone."));

        for (UUID id : players) {
            Player player = nexus.getServer().getPlayer(id);
            if (player != null) {
                player.showTitle(Title.title(
                        Component.text("SUDDEN DEATH", NamedTextColor.RED),
                        Component.text("No more respawns", NamedTextColor.GRAY),
                        Title.Times.times(Duration.ofMillis(300), Duration.ofSeconds(3), Duration.ofMillis(500))));
            }
        }
        checkForWinner();
    }

    /* ------------------------------------------------------------- sidebar */

    private void sidebars() {
        for (UUID id : players) {
            Player player = nexus.getServer().getPlayer(id);
            if (player == null) continue;

            Sidebar board = boards.computeIfAbsent(id, key -> new Sidebar(player, "BED WARS"));

            List<Component> lines = new ArrayList<>();
            lines.add(Component.text(Text.clock(elapsed), NamedTextColor.GRAY));
            lines.add(Sidebar.gap());

            for (Squad squad : squads) {
                if (squad.members.isEmpty()) continue;

                int standing = 0;
                for (UUID member : squad.members) {
                    if (alive.contains(member) || respawning.containsKey(member)) standing++;
                }

                Component status = squad.bedAlive
                        ? Component.text("✔", NamedTextColor.GREEN)
                        : standing > 0
                                ? Component.text(String.valueOf(standing), NamedTextColor.GRAY)
                                : Component.text("✘", NamedTextColor.RED);

                Component you = squad.equals(squadOf.get(id))
                        ? Component.text(" (you)", NamedTextColor.DARK_GRAY)
                        : Component.empty();

                lines.add(Component.text(squad.name + " ", squad.colour).append(status).append(you));
            }

            lines.add(Sidebar.gap());
            lines.add(Component.text(nextEvent(), NamedTextColor.YELLOW));

            board.set(lines);
        }
    }

    private String nextEvent() {
        if (elapsed < DIAMOND_TIER_TWO) return "Diamond II in " + Text.clock(DIAMOND_TIER_TWO - elapsed);
        if (elapsed < EMERALD_TIER_TWO) return "Emerald II in " + Text.clock(EMERALD_TIER_TWO - elapsed);
        if (elapsed < DIAMOND_TIER_THREE) return "Diamond III in " + Text.clock(DIAMOND_TIER_THREE - elapsed);
        if (elapsed < SUDDEN_DEATH) return "Sudden death in " + Text.clock(SUDDEN_DEATH - elapsed);
        return "Sudden death";
    }

    /* --------------------------------------------------------------- rules */

    public boolean mayBreak(Block block) {
        return placed.contains(key(block)) || block.getType().name().endsWith("_BED");
    }

    public void notePlaced(Block block) {
        placed.add(key(block));
    }

    public void noteBroken(Block block) {
        placed.remove(key(block));
    }

    private static long key(Block block) {
        // Packed rather than a Location, because Location hashes on world and
        // yaw and a set of them is both slower and subtly wrong.
        return ((long) block.getX() & 0x3FFFFFF) << 38
                | ((long) block.getZ() & 0x3FFFFFF) << 12
                | ((long) block.getY() & 0xFFF);
    }

    /**
     * A bed goes. This is the moment the game turns, so it is loud.
     */
    public void bedBroken(Player breaker, Squad owner) {
        if (!owner.bedAlive) return;

        Squad theirs = squadOf.get(breaker.getUniqueId());
        if (theirs != null && theirs.equals(owner)) {
            breaker.sendMessage(Text.bad("That is your own bed."));
            return;
        }

        owner.bedAlive = false;
        nexus.stats().brokeBed(breaker.getUniqueId());

        announce(Component.text(owner.name + "'s bed", owner.colour)
                .append(Component.text(" was broken by ", NamedTextColor.GRAY))
                .append(Component.text(breaker.getName(),
                        theirs == null ? NamedTextColor.WHITE : theirs.colour)));

        for (UUID id : players) {
            Player player = nexus.getServer().getPlayer(id);
            if (player == null) continue;

            boolean theirBed = owner.members.contains(id);
            player.playSound(player, theirBed ? Sound.ENTITY_ENDER_DRAGON_GROWL : Sound.ENTITY_PLAYER_LEVELUP,
                    1f, 1f);

            if (theirBed) {
                player.showTitle(Title.title(
                        Component.text("BED DESTROYED", NamedTextColor.RED),
                        Component.text("You no longer respawn", NamedTextColor.GRAY),
                        Title.Times.times(Duration.ofMillis(300), Duration.ofSeconds(3), Duration.ofMillis(500))));
            }
        }

        checkForWinner();
    }

    /** Somebody died. Either they come back, or they are out. */
    public void died(Player player, Player killer) {
        UUID id = player.getUniqueId();
        alive.remove(id);
        nexus.stats().died(id);

        if (killer != null && !killer.equals(player)) {
            nexus.stats().killed(killer.getUniqueId());
            Squad theirs = squadOf.get(killer.getUniqueId());
            announce(Component.text(player.getName(), NamedTextColor.GRAY)
                    .append(Component.text(" was killed by ", NamedTextColor.DARK_GRAY))
                    .append(Component.text(killer.getName(),
                            theirs == null ? NamedTextColor.WHITE : theirs.colour)));
        }

        // Whatever they were carrying stays where they fell, which is what
        // makes a kill near the middle worth going for.
        player.getInventory().clear();
        player.setGameMode(GameMode.SPECTATOR);

        Squad squad = squadOf.get(id);
        if (squad != null && squad.bedAlive) {
            respawning.put(id, RESPAWN_SECONDS);
            player.teleport(field.baseSpawn(squad.index).clone().add(0, 6, 0));
            return;
        }

        player.sendMessage(Text.bad("You are out. Your bed was gone."));
        player.teleport(new Location(world, 0.5, Field.FLOOR + 20, 0.5));
        checkForWinner();
    }

    private void checkForWinner() {
        List<Squad> left = new ArrayList<>();
        for (Squad squad : squads) {
            if (squad.members.isEmpty()) continue;
            if (!squad.eliminated(alive)) left.add(squad);
        }

        if (left.size() > 1 || endingIn > 0) return;

        Squad won = left.isEmpty() ? null : left.get(0);
        for (UUID id : players) {
            Player player = nexus.getServer().getPlayer(id);
            if (player == null) continue;

            boolean theirs = won != null && won.members.contains(id);
            if (theirs) nexus.stats().wonMatch(id, 100);
            else nexus.stats().lostMatch(id, 20);

            player.showTitle(Title.title(
                    theirs ? Component.text("VICTORY", NamedTextColor.GOLD)
                            : Component.text("DEFEAT", NamedTextColor.RED),
                    won == null ? Component.empty()
                            : Component.text(won.name + " won", won.colour),
                    Title.Times.times(Duration.ofMillis(300), Duration.ofSeconds(4), Duration.ofSeconds(1))));
        }

        if (won != null) {
            announce(Component.text(won.name + " wins", won.colour));
        }

        // A few seconds to look at the scoreboard before being pulled out.
        endingIn = 6;
    }

    /* ------------------------------------------------------------ leaving */

    @Override
    public void remove(Player player) {
        UUID id = player.getUniqueId();

        players.remove(id);
        alive.remove(id);
        respawning.remove(id);
        squadOf.remove(id);

        Sidebar board = boards.remove(id);
        if (board != null) board.clear();

        for (Squad squad : squads) squad.members.remove(id);

        if (player.isOnline() && !player.getWorld().equals(world)) return;
        if (player.isOnline()) nexus.hub().send(player);

        if (!isOver()) checkForWinner();
    }

    @Override
    protected void teardown() {
        for (UUID id : new ArrayList<>(players)) {
            Player player = nexus.getServer().getPlayer(id);
            if (player == null) continue;

            Sidebar board = boards.remove(id);
            if (board != null) board.clear();

            nexus.hub().send(player);
        }
        players.clear();

        // Only once everybody is out, or the unload silently refuses.
        dev.nexuscraft.nexus.Arena.destroy(world);
    }
}
