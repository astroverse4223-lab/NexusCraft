package dev.nexuscraft.nexus;

import dev.nexuscraft.nexus.bedwars.BedWarsMatch;
import dev.nexuscraft.nexus.minigames.Fighting;
import dev.nexuscraft.nexus.bedwars.Shop;
import dev.nexuscraft.nexus.bedwars.Squad;
import io.papermc.paper.event.player.AsyncChatEvent;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.GameMode;
import org.bukkit.Material;
import org.bukkit.block.Block;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.event.entity.EntityExplodeEvent;
import org.bukkit.event.block.BlockBurnEvent;
import org.bukkit.event.block.BlockIgniteEvent;
import org.bukkit.event.entity.FoodLevelChangeEvent;
import org.bukkit.event.hanging.HangingBreakByEntityEvent;
import org.bukkit.event.player.PlayerBucketEmptyEvent;
import org.bukkit.event.player.PlayerBucketFillEvent;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.player.PlayerDropItemEvent;
import org.bukkit.event.player.PlayerInteractEntityEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.event.player.PlayerRespawnEvent;

import java.util.Iterator;

/**
 * Everything the server reacts to.
 *
 * Kept in one place on purpose. Minecraft events fire in an order nobody
 * remembers and half of them overlap — a block broken during a match is also a
 * block broken in the hub, and the rules are opposite. Split across the classes
 * that care, those conflicts are invisible until one of them is wrong; in one
 * file the precedence is something you can read.
 *
 * The shape of nearly every handler here is the same: work out whether the
 * player is in the hub or in a match, and behave accordingly. There is no third
 * state, and anything that looks like one is a bug.
 */
public final class Listeners implements Listener {

    private final Nexus nexus;

    public Listeners(Nexus nexus) {
        this.nexus = nexus;
    }

    /* ------------------------------------------------------- coming and going */

    @EventHandler
    public void onJoin(PlayerJoinEvent event) {
        Player player = event.getPlayer();

        event.joinMessage(Component.text("+ ", NamedTextColor.GREEN)
                .append(nexus.stats().rankOf(player.getUniqueId()).nameOf(player)));

        nexus.hub().send(player);
        nexus.nameplates();
        nexus.packs().offer(player);

        nexus.quests().newDayIfNeeded(player);
        nexus.rewards().remind(player);
        nexus.afk().active(player);
        nexus.discord().joined(player.getName());
        nexus.pets().restore(player);

        // Checked on the way in as well as on the timer, so somebody who earned
        // something while offline - from a rank change, say - hears about it.
        nexus.achievements().check(player);

        // Only somebody who has genuinely just arrived, which the guide decides
        // for itself from how long they have played.
        nexus.guide().greetIfNew(player);
        nexus.vault().remind(player);
        nexus.cosmetics().applyHat(player);
        nexus.skins().restore(player);

        player.sendMessage(Text.heading("Nexus"));
        player.sendMessage(Text.plain("  Right click the compass to play."));
        player.sendMessage(Text.plain("  /party to play with friends, /stats for your record."));
    }

    @EventHandler
    public void onQuit(PlayerQuitEvent event) {
        Player player = event.getPlayer();

        event.quitMessage(Component.text("- ", NamedTextColor.RED)
                .append(Component.text(player.getName(), NamedTextColor.GRAY)));

        // Logging out in survival is leaving that world, as far as the
        // inventory is concerned. Without this, a disconnect empties it.
        nexus.backpacks().stash(player, nexus.worlds().placeOf(player));
        nexus.oneBlock().hideBar(player);
        nexus.skyBlock().hideBar(player);
        nexus.digSite().hideBar(player);
        nexus.rewards().forget(player);

        nexus.games().forget(player);
        nexus.parties().leave(player, true);
        nexus.hub().forget(player);
        nexus.toolkit().forget(player);
        nexus.afk().forget(player);
        nexus.discord().left(player.getName());
        nexus.pets().forget(player);
        nexus.guide().forget(player);
        nexus.chatGuard().forget(player);
        nexus.blockLog().forget(player);
        nexus.teleports().forget(player);
        nexus.whispers().forget(player);
    }

    @EventHandler
    public void onDeath(org.bukkit.event.entity.PlayerDeathEvent event) {
        /*
         * Where they fell, so /back can undo it.
         *
         * Recorded on death rather than on respawn, because by the time the
         * respawn fires the player has already been moved and their location
         * is the bed they woke up in.
         */
        nexus.teleports().remember(event.getEntity());
    }

    @EventHandler
    public void onArenaDeath(org.bukkit.event.entity.PlayerDeathEvent event) {
        nexus.mobArena().out(event.getEntity());
    }

    @EventHandler
    public void onRespawn(PlayerRespawnEvent event) {
        // Nothing in this server uses the vanilla respawn screen, but a death
        // that slips past a handler would otherwise drop somebody into a void
        // world with no floor.
        Match match = nexus.games().matchOf(event.getPlayer().getUniqueId());
        if (match != null) return;

        event.setRespawnLocation(nexus.hub().spawn());

        /*
         * And the lobby's arrival routine, on the next tick.
         *
         * Setting the respawn point puts them in the lobby world but runs none
         * of what the lobby does - so they arrived in survival mode, with no
         * compass, no sidebar, and whatever the world they died in was still
         * showing them. Next tick because teleporting inside a respawn event is
         * undefined behaviour.
         */
        Player player = event.getPlayer();
        nexus.getServer().getScheduler().runTask(nexus, () -> {
            if (player.isOnline()) nexus.hub().send(player);
        });
    }

    /* --------------------------------------------------------------- chat */

    /**
     * The Mojang commands that moderation has to own.
     *
     * Caught before the built-in runs, because a plugin cannot register a name
     * the server already has - and two of these decide whether a mute means
     * anything.
     */
    @EventHandler(priority = EventPriority.LOWEST, ignoreCancelled = true)
    public void onCommand(org.bukkit.event.player.PlayerCommandPreprocessEvent event) {
        Player player = event.getPlayer();

        try {
            String[] parts = event.getMessage().substring(1).trim().split("\\s+");
            if (parts.length == 0) return;

            String name = parts[0].toLowerCase(java.util.Locale.ROOT);
            String[] args = java.util.Arrays.copyOfRange(parts, 1, parts.length);

            switch (name) {
                case "msg", "tell", "w", "whisper" -> {
                    // Learned in passing, so /r works without intercepting
                    // anything that is not already being looked at.
                    if (args.length > 0) nexus.whispers().noted(player, args[0]);

                    /*
                     * Refused rather than rewritten.
                     *
                     * Vanilla's own /msg is left to do the delivering - all this
                     * has to do is stop a muted player using it, which is the
                     * hole that made muting pointless.
                     */
                    if (nexus.punishments().muteOn(player.getUniqueId()) != null
                            && !player.hasPermission("nexus.admin")) {
                        event.setCancelled(true);
                        player.sendMessage(Text.bad("You are muted."));
                    }
                }

                case "ban" -> {
                    if (!player.hasPermission("nexus.admin")) return;
                    event.setCancelled(true);

                    if (args.length == 0) {
                        player.sendMessage(Text.bad("/ban <player> [30m|2h|7d|forever] [reason]"));
                        return;
                    }

                    // A bare /ban with no duration means forever, which is what
                    // vanilla does and therefore what anybody typing it expects.
                    boolean timed = args.length > 1
                            && Punishments.readDuration(args[1]) >= 0;

                    nexus.punishments().ban(player, args[0],
                            timed ? args[1] : "forever",
                            reasonFrom(args, timed ? 2 : 1));
                }

                case "kick" -> {
                    if (!player.hasPermission("nexus.admin")) return;
                    event.setCancelled(true);

                    if (args.length == 0) {
                        player.sendMessage(Text.bad("/kick <player> [reason]"));
                        return;
                    }
                    nexus.punishments().kick(player, args[0], reasonFrom(args, 1));
                }

                default -> {
                }
            }
        } catch (RuntimeException unexpected) {
            /*
             * Left alone on anything unexpected.
             *
             * A bug in here must never be the reason a moderator cannot ban
             * somebody, so the vanilla command runs and the problem is a log
             * line rather than an emergency.
             */
            nexus.getLogger().warning("could not handle " + event.getMessage()
                    + ": " + unexpected);
        }
    }

    /** The rest of the arguments as a reason, matching the command handler. */
    private static String reasonFrom(String[] args, int from) {
        if (args.length <= from) return "No reason given";

        StringBuilder out = new StringBuilder();
        for (int i = from; i < args.length; i++) {
            if (out.length() > 0) out.append(' ');
            out.append(args[i]);
        }
        return out.toString();
    }

    @EventHandler
    public void onChat(AsyncChatEvent event) {
        /*
         * The chat game is checked here, on the message as typed.
         *
         * Back on the main thread, because paying somebody and broadcasting
         * cannot be done from the chat thread — and the answer is captured
         * first, since the event is consumed by the time the task runs.
         */
        String typed = net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer
                .plainText().serialize(event.message());
        var who = event.getPlayer();

        /*
         * Checked here, on the chat thread, before anything else looks at it.
         *
         * Cancelling is the whole response - nothing is punished for a blocked
         * message. A filter that bans on a false positive has to be perfect;
         * one that just declines to send can afford to be approximate, which is
         * the most any word filter ever is.
         */
        String refused = nexus.chatGuard().refuse(who, typed);
        if (refused != null) {
            event.setCancelled(true);
            nexus.chatGuard().explain(who, refused);
            return;
        }

        // Shouting is turned down rather than refused, because refusing it only
        // teaches people to retype it.
        String said = nexus.chatGuard().calm(who, typed);
        if (!said.equals(typed)) {
            event.message(net.kyori.adventure.text.Component.text(said));
        }

        nexus.getServer().getScheduler().runTask(nexus, () -> {
            nexus.afk().active(who);
            nexus.chatGames().guess(who, said);
            nexus.discord().chat(who.getName(), said);
        });

        Ranks rank = nexus.stats().rankOf(event.getPlayer().getUniqueId());

        event.renderer((source, name, message, viewer) ->
                rank.nameOf(source)
                        .append(Component.text(": ", NamedTextColor.DARK_GRAY))
                        .append(message.colorIfAbsent(NamedTextColor.WHITE)));
    }

    /* ------------------------------------------------------------- clicking */

    @EventHandler
    public void onInteract(PlayerInteractEvent event) {
        /*
         * The claim wand marks corners rather than digging.
         *
         * Handled before anything else and cancelled outright, so a left click
         * marks a corner instead of breaking the block under it - which is the
         * one thing that would make the tool worse than useless.
         */
        if (nexus.claims().isWand(event.getItem()) && event.getClickedBlock() != null) {
            boolean firstCorner = event.getAction() == org.bukkit.event.block.Action.LEFT_CLICK_BLOCK;
            boolean secondCorner = event.getAction() == org.bukkit.event.block.Action.RIGHT_CLICK_BLOCK;

            if (firstCorner || secondCorner) {
                event.setCancelled(true);
                nexus.claims().mark(event.getPlayer(), event.getClickedBlock(), firstCorner);
                return;
            }
        }

        Player player = event.getPlayer();

        /*
         * The builder's wand, before the block it clicked can react.
         *
         * First of all of them: a golden axe swung at a chest should pick a
         * corner, not open the chest, and every other handler below would
         * happily do the second thing.
         */
        if (nexus.toolkit().isWand(event.getItem()) && event.getClickedBlock() != null) {
            event.setCancelled(true);

            var action = event.getAction();
            if (action == org.bukkit.event.block.Action.LEFT_CLICK_BLOCK) {
                nexus.toolkit().setFirst(player, event.getClickedBlock());
            } else if (action == org.bukkit.event.block.Action.RIGHT_CLICK_BLOCK) {
                nexus.toolkit().setSecond(player, event.getClickedBlock());
            }
            return;
        }

        // The placement wand, before anything else looks at the click.
        String placing = nexus.placer().heldBy(event.getItem());
        if (placing != null) {
            event.setCancelled(true);

            /*
             * Cycling has to work while looking at nothing.
             *
             * This only listened for RIGHT_CLICK_BLOCK, so sneaking and
             * clicking at open air or the sky did nothing whatsoever - the
             * wand advanced only when a block happened to be under the
             * crosshair. From the outside that is a list that skips entries,
             * and the bot you are looking for appears not to be in it.
             */
            var action = event.getAction();

            boolean right = action == org.bukkit.event.block.Action.RIGHT_CLICK_BLOCK
                    || action == org.bukkit.event.block.Action.RIGHT_CLICK_AIR;
            boolean left = action == org.bukkit.event.block.Action.LEFT_CLICK_BLOCK
                    || action == org.bukkit.event.block.Action.LEFT_CLICK_AIR;

            if (player.isSneaking() && right) nexus.placer().cycle(player, placing, 1);
            else if (player.isSneaking() && left) nexus.placer().cycle(player, placing, -1);
            else if (right && event.getClickedBlock() != null) {
                nexus.placer().placeAt(player, placing, event.getClickedBlock());
            }
            return;
        }

        if (nexus.hub().isHub(player) && Hub.isSelector(nexus, event.getItem())
                && !nexus.hub().isBuilding(player.getUniqueId())) {
            event.setCancelled(true);
            Selector.open(nexus, player);
            return;
        }

        Block clicked = event.getClickedBlock();
        if (clicked == null) return;

        // A shop sign is a shop before it is a sign.
        if (event.getAction() == org.bukkit.event.block.Action.RIGHT_CLICK_BLOCK
                && nexus.playerShops().isStall(clicked)) {
            event.setCancelled(true);
            nexus.playerShops().use(player, clicked);
            return;
        }

        // Asking who touched this, rather than doing anything to it.
        if (nexus.blockLog().isInspecting(player.getUniqueId())) {
            event.setCancelled(true);
            nexus.blockLog().show(player, clicked);
            return;
        }

        /*
         * A claim that anybody can open is not a claim.
         *
         * Breaking blocks is the obvious grief and the loud one, but the theft
         * that actually empties a base is somebody walking in through an
         * unlocked door and taking the chests. Both go through here.
         */
        if (openable(clicked.getType())
                && event.getAction() == org.bukkit.event.block.Action.RIGHT_CLICK_BLOCK
                && nexus.claims().refuse(player, clicked)) {
            event.setCancelled(true);
        }
    }

    /**
     * Blocks whose whole purpose is being opened.
     *
     * A list rather than a category test, because Bukkit has no "has an
     * inventory" question that does not involve loading the block state, and
     * doing that on every right click anywhere is exactly the cost this is
     * meant to avoid.
     */
    private static boolean openable(Material type) {
        if (type.name().endsWith("_DOOR")
                || type.name().endsWith("_TRAPDOOR")
                || type.name().endsWith("_FENCE_GATE")
                || type.name().endsWith("_SHULKER_BOX")
                || type.name().endsWith("_BED")
                || type.name().endsWith("_SIGN")
                || type.name().endsWith("_BUTTON")) {
            return true;
        }

        return switch (type) {
            case CHEST, TRAPPED_CHEST, BARREL, HOPPER, DROPPER, DISPENSER,
                    FURNACE, BLAST_FURNACE, SMOKER, BREWING_STAND, BEACON,
                    ANVIL, CHIPPED_ANVIL, DAMAGED_ANVIL, ENCHANTING_TABLE,
                    LEVER, LECTERN, COMPOSTER, CAULDRON, JUKEBOX, NOTE_BLOCK,
                    CRAFTER, DECORATED_POT, CHISELED_BOOKSHELF, RESPAWN_ANCHOR,
                    CAKE, FLOWER_POT, ITEM_FRAME, GLOW_ITEM_FRAME -> true;
            default -> false;
        };
    }

    /**
     * Lava and water, which is how a base is destroyed without breaking a
     * single block somebody would notice in the log.
     */
    @EventHandler
    public void onBucketEmpty(PlayerBucketEmptyEvent event) {
        nexus.afk().active(event.getPlayer());

        if (event.getBlock() != null
                && nexus.claims().refuse(event.getPlayer(), event.getBlock())) {
            event.setCancelled(true);
        }
    }

    @EventHandler
    public void onBucketFill(PlayerBucketFillEvent event) {
        nexus.afk().active(event.getPlayer());

        if (event.getBlock() != null
                && nexus.claims().refuse(event.getPlayer(), event.getBlock())) {
            event.setCancelled(true);
        }
    }

    /** Flint and steel, which is the other one. */
    @EventHandler
    public void onIgnite(BlockIgniteEvent event) {
        Player player = event.getPlayer();

        if (player != null) {
            if (nexus.claims().refuse(player, event.getBlock())) event.setCancelled(true);
            return;
        }

        // Fire that nobody lit, spreading into somebody's house.
        if (nexus.claims().claimed(event.getBlock().getLocation())) event.setCancelled(true);
    }

    @EventHandler
    public void onBurn(BlockBurnEvent event) {
        if (nexus.claims().claimed(event.getBlock().getLocation())) event.setCancelled(true);
    }

    /** Item frames and paintings, which are blocks to everyone except Bukkit. */
    @EventHandler
    public void onHangingBreak(HangingBreakByEntityEvent event) {
        if (!(event.getRemover() instanceof Player player)) return;

        Block under = event.getEntity().getLocation().getBlock();
        if (nexus.claims().refuse(player, under)) event.setCancelled(true);
    }

    /**
     * Nobody takes an NPC's clothes.
     *
     * Right clicking an armour stand with an item on the cursor swaps that
     * item onto it. Without this the first thing that happens in the lobby is
     * somebody undressing the greeters.
     */
    @EventHandler
    public void onArmorStand(org.bukkit.event.player.PlayerArmorStandManipulateEvent event) {
        if (event.getRightClicked().getScoreboardTags().contains(Npc.TAG)) {
            event.setCancelled(true);
        }
    }

    /** The greeters in spawn, and the shopkeepers in a match. */
    @EventHandler
    public void onInteractEntity(PlayerInteractEntityEvent event) {
        Entity clicked = event.getRightClicked();
        Player player = event.getPlayer();

        String destination = Npc.destinationOf(clicked);
        if (destination != null) {
            event.setCancelled(true);
            nexus.travel(player, destination);
            return;
        }

        String opens = Npc.opensOf(clicked);
        if (opens != null) {
            event.setCancelled(true);

            switch (opens) {
                case "shop" -> Shops.open(nexus, player);
                case "sell" -> SellWindow.open(player);
                case "crate_common" -> nexus.crates().open(player, Crates.Tier.COMMON);
                case "crate_rare" -> nexus.crates().open(player, Crates.Tier.RARE);
                case "crate_legendary" -> nexus.crates().open(player, Crates.Tier.LEGENDARY);
                case "vault" -> nexus.vault().open(player);
                case "enchanter" -> Enchanter.open(nexus, player);
                case "cosmetics" -> nexus.cosmetics().open(player);
                case "jobs" -> nexus.jobs().open(player);
                case "trader" -> nexus.trader().open(player);
                case "dig_buyer" -> nexus.digSite().sell(player);
                case "dig_gear" -> nexus.digSite().openGear(player);
                case "skins" -> nexus.skins().open(player);
                default -> player.sendMessage(Text.bad("That does nothing yet."));
            }
            return;
        }

        boolean shop = clicked.getScoreboardTags().contains(BedWarsMatch.SHOP_TAG);
        boolean upgrades = clicked.getScoreboardTags().contains(BedWarsMatch.UPGRADE_TAG);
        if (!shop && !upgrades) return;

        event.setCancelled(true);

        Match match = nexus.games().matchOf(player.getUniqueId());
        if (!(match instanceof BedWarsMatch bedwars)) return;
        if (!bedwars.isAlive(player.getUniqueId())) return;

        Squad squad = bedwars.squadOf(player.getUniqueId());
        if (squad == null) return;

        if (shop) Shop.openItems(player);
        else Shop.openUpgrades(player, squad);
    }

    @EventHandler
    public void onMenuClick(InventoryClickEvent event) {
        if (!(event.getWhoClicked() instanceof Player player)) return;

        Component title = event.getView().title();

        if (title.equals(Selector.TITLE)) {
            event.setCancelled(true);
            if (event.getCurrentItem() != null) {
                Selector.clicked(nexus, player, event.getCurrentItem());
            }
            return;
        }

        if (title.equals(DigSite.TITLE)) {
            event.setCancelled(true);
            nexus.digSite().clicked(player, event.getRawSlot());
            return;
        }

        if (title.equals(Skins.TITLE)) {
            event.setCancelled(true);
            nexus.skins().clicked(player, event.getRawSlot());
            return;
        }

        if (title.equals(Jobs.TITLE)) {
            event.setCancelled(true);
            nexus.jobs().clicked(player, event.getRawSlot());
            return;
        }

        if (title.equals(Trader.TITLE)) {
            event.setCancelled(true);
            nexus.trader().clicked(player, event.getRawSlot());
            return;
        }

        if (title.equals(Enchanter.TITLE)) {
            event.setCancelled(true);
            Enchanter.clicked(nexus, player, event.getRawSlot());
            return;
        }

        if (title.equals(Menu.TITLE)) {
            event.setCancelled(true);
            Menu.clicked(nexus, player, event.getRawSlot());
            return;
        }

        if (title.equals(Kits.TITLE)) {
            event.setCancelled(true);
            nexus.kits().clicked(player, event.getRawSlot());
            return;
        }

        if (title.equals(Auction.TITLE)) {
            event.setCancelled(true);
            nexus.auction().clicked(player, event.getRawSlot());
            return;
        }

        if (title.equals(Pets.TITLE)) {
            event.setCancelled(true);
            nexus.pets().clicked(player, event.getRawSlot());
            return;
        }

        if (title.equals(Achievements.TITLE)) {
            // Nothing to click. Cancelled so nobody can take the icons out.
            event.setCancelled(true);
            return;
        }

        if (title.equals(Cosmetics.TITLE)) {
            event.setCancelled(true);
            nexus.cosmetics().clicked(player, event.getRawSlot());
            return;
        }

        if (title.equals(Shops.SHOP_TITLE)) {
            event.setCancelled(true);
            int aisle = event.getRawSlot() - 10;
            if (aisle >= 0 && aisle < Shops.AISLES.size()) {
                Shops.openAisle(nexus, player, aisle);
            }
            return;
        }

        int aisle = Shops.aisleFor(title);
        if (aisle >= 0) {
            event.setCancelled(true);

            // The arrow on the bottom row goes back to the aisles.
            if (event.getRawSlot() == 36) {
                Shops.open(nexus, player);
                return;
            }
            if (event.getRawSlot() < Shops.stockOf(aisle).size()) {
                Shops.buy(nexus, player, aisle, event.getRawSlot());
                Shops.openAisle(nexus, player, aisle);
            }
            return;
        }

        if (title.equals(Shop.ITEMS_TITLE)) {
            event.setCancelled(true);
            Match match = nexus.games().matchOf(player.getUniqueId());
            if (match instanceof BedWarsMatch bedwars) {
                Squad squad = bedwars.squadOf(player.getUniqueId());
                if (squad != null) {
                    Shop.buy(player, squad, event.getRawSlot());
                    Shop.openItems(player);
                }
            }
            return;
        }

        if (title.equals(Shop.UPGRADES_TITLE)) {
            event.setCancelled(true);
            Match match = nexus.games().matchOf(player.getUniqueId());
            if (match instanceof BedWarsMatch bedwars) {
                Squad squad = bedwars.squadOf(player.getUniqueId());
                if (squad != null) {
                    String bought = Shop.buyUpgrade(player, squad, event.getRawSlot());
                    if (bought != null) {
                        bedwars.announce(Component.text(bought, squad.colour));
                        bedwars.reapplyUpgrades(squad);
                    }
                    Shop.openUpgrades(player, squad);
                }
            }
        }
    }

    /* --------------------------------------------------------------- blocks */

    /**
     * Where you may build.
     *
     * Four different answers, which is why this is one method rather than a
     * rule scattered across four classes: never in the lobby, freely in
     * survival and creative, tracked in a match, and never inside a prison mine
     * — a player who walls off the mine they are standing in has broken the
     * only thing prison is.
     */
    /**
     * Nothing spawns in the boss arena by itself.
     *
     * Only natural spawning is refused. What the fight summons comes through
     * as CUSTOM, and so does anything an operator puts there on purpose with a
     * spawn egg - neither of those is the problem being solved.
     */
    @EventHandler
    public void onSpawn(org.bukkit.event.entity.CreatureSpawnEvent event) {
        var reason = event.getSpawnReason();

        boolean byItself =
                reason == org.bukkit.event.entity.CreatureSpawnEvent.SpawnReason.NATURAL
                        || reason == org.bukkit.event.entity.CreatureSpawnEvent.SpawnReason.REINFORCEMENTS
                        || reason == org.bukkit.event.entity.CreatureSpawnEvent.SpawnReason.PATROL
                        || reason == org.bukkit.event.entity.CreatureSpawnEvent.SpawnReason.RAID;

        if (!byItself) return;
        if (!nexus.boss().refusesSpawn(event.getLocation())) return;

        event.setCancelled(true);
    }

    @EventHandler
    public void onPlace(BlockPlaceEvent event) {
        Player player = event.getPlayer();
        nexus.afk().active(player);

        if (nexus.hub().isHub(player)) {
            if (!nexus.hub().isBuilding(player.getUniqueId())) event.setCancelled(true);
            return;
        }

        if (nexus.boss().guards(player, event.getBlock())) {
            event.setCancelled(true);
            player.sendActionBar(Text.item("Not in the arena",
                    net.kyori.adventure.text.format.NamedTextColor.RED));
            return;
        }

        if (refusedByPlot(player, event.getBlock())) {
            event.setCancelled(true);
            return;
        }

        if (refusedByBuildBattle(player, event.getBlock())) {
            event.setCancelled(true);
            return;
        }

        Match match = nexus.games().matchOf(player.getUniqueId());
        if (match instanceof BedWarsMatch bedwars) {
            bedwars.notePlaced(event.getBlock());
            return;
        }

        /*
         * Nowhere in prison, not merely inside the mines.
         *
         * The test used to be "is this inside a mine", which stopped somebody
         * walling off the ore and allowed them to build anything they liked in
         * the plaza around it - towers, bridges over the walls, a staircase
         * into a mine they had not earned.
         */
        if (nexus.worlds().placeOf(player) == Worlds.Place.PRISON
                && !nexus.hub().isBuilding(player.getUniqueId())) {
            event.setCancelled(true);
            player.sendMessage(Text.bad("You cannot build in prison."));
            return;
        }

        /*
         * A shop is protected from everyone but its owner.
         *
         * Before the claim check, because being trusted to build on somebody's
         * land is not the same as being allowed to close their business - and
         * the chest under the sign needs the same cover as the sign, or the
         * name is protected and the goods are not.
         */
        if (!nexus.playerShops().mayBreak(player, event.getBlock())
                || nexus.playerShops().guardsContainer(player, event.getBlock())) {
            event.setCancelled(true);
            return;
        }

        if (nexus.playerShops().isStall(event.getBlock())) {
            nexus.playerShops().closed(event.getBlock());
            player.sendMessage(Text.says("Shop closed."));
        }

        if (nexus.claims().refuse(player, event.getBlock())) {
            event.setCancelled(true);
            return;
        }

        nexus.blockLog().placed(player, event.getBlock());
    }

    /**
     * A sign written with [shop] on it becomes a shop.
     *
     * The lines are replaced rather than left as typed, so what ends up on the
     * wall is the shop's own face - the owner, the goods and the price - rather
     * than the three lines of setup somebody entered.
     */
    @EventHandler
    public void onSign(org.bukkit.event.block.SignChangeEvent event) {
        String[] typed = new String[event.lines().size()];

        for (int i = 0; i < typed.length; i++) {
            net.kyori.adventure.text.Component line = event.line(i);
            typed[i] = line == null
                    ? ""
                    : net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer
                            .plainText().serialize(line);
        }

        String[] face = nexus.playerShops().create(event.getPlayer(), event.getBlock(), typed);
        if (face == null) return;

        for (int i = 0; i < face.length && i < typed.length; i++) {
            event.line(i, net.kyori.adventure.text.Component.text(face[i]));
        }
    }

    /**
     * A generator making its next block.
     *
     * Fires when world conditions form a block - snow, ice, and cobblestone
     * where lava meets water, which is the one that matters here.
     */
    /**
     * A portal in survival, which the server would otherwise get wrong.
     *
     * Left alone it sends people to the default overworld's nether - a
     * dimension attached to a world nobody plays in.
     */
    @EventHandler
    public void onPortal(org.bukkit.event.player.PlayerPortalEvent event) {
        nexus.dimensions().portal(event);
        nexus.islandNether().portal(event);
    }

    /** Somebody arriving in the end, who would otherwise arrive in the void. */
    @EventHandler
    public void onChangedWorld(org.bukkit.event.player.PlayerChangedWorldEvent event) {
        nexus.dimensions().arrivedInEnd(event.getPlayer());
    }

    @EventHandler
    public void onForm(org.bukkit.event.block.BlockFormEvent event) {
        nexus.skyBlock().forming(event);
    }

    /**
     * Whether Build Battle says no to this.
     *
     * Your own plot, and only while there is still building time. Asked of the
     * match rather than worked out here, because the plot layout belongs to
     * the game and this file already knows too much about several of them.
     */
    private boolean refusedByBuildBattle(Player player, Block block) {
        Match playing = nexus.games().matchOf(player.getUniqueId());

        if (!(playing instanceof dev.nexuscraft.nexus.minigames
                .BuildBattle.BuildBattleMatch battle)) {
            return false;
        }
        return battle.refuseEdit(player, block);
    }

    /**
     * Whether the creative world says no to this.
     *
     * Only the creative world has plots, so everywhere else this is a quick
     * false. The message is rate-limited by being sent only on a refusal that
     * came from a real attempt - a player holding down the mouse on a road
     * would otherwise be told twenty times a second.
     */
    private boolean refusedByPlot(Player player, Block block) {
        if (!block.getWorld().getName().equals(Worlds.Place.CREATIVE.world)) return false;
        if (nexus.plots().mayBuild(player, block.getLocation())) return false;

        int px = Plots.indexOf(block.getX());
        int pz = Plots.indexOf(block.getZ());

        if (!Plots.onPlot(block.getX(), block.getZ())) {
            player.sendActionBar(Text.item("The roads are nobody's",
                    net.kyori.adventure.text.format.NamedTextColor.RED));
        } else if (nexus.plots().ownerOf(px, pz) == null) {
            player.sendActionBar(Text.item("Unclaimed - /plot claim",
                    net.kyori.adventure.text.format.NamedTextColor.RED));
        } else {
            player.sendActionBar(Text.item("Not your plot",
                    net.kyori.adventure.text.format.NamedTextColor.RED));
        }
        return true;
    }

    @EventHandler
    public void onBreak(BlockBreakEvent event) {
        Player player = event.getPlayer();
        nexus.afk().active(player);

        // The arena is the server's, not anybody's to mine the back row of.
        if (nexus.boss().guards(player, event.getBlock())) {
            event.setCancelled(true);
            player.sendActionBar(Text.item("The arena is protected  -  /build to edit it",
                    net.kyori.adventure.text.format.NamedTextColor.RED));
            return;
        }

        if (nexus.hub().isHub(player)) {
            if (!nexus.hub().isBuilding(player.getUniqueId())) event.setCancelled(true);
            return;
        }

        if (refusedByPlot(player, event.getBlock())) {
            event.setCancelled(true);
            return;
        }

        if (refusedByBuildBattle(player, event.getBlock())) {
            event.setCancelled(true);
            return;
        }

        Match match = nexus.games().matchOf(player.getUniqueId());

        if (match instanceof dev.nexuscraft.nexus.minigames.Spleef.SpleefMatch spleef) {
            if (spleef.refuseBreak(event.getBlock())) event.setCancelled(true);
            return;
        }

        if (nexus.claims().refuse(player, event.getBlock())) {
            event.setCancelled(true);
            return;
        }

        // Recorded before the block goes, because afterwards it is air and
        // there is nothing left to write down.
        nexus.blockLog().broke(player, event.getBlock());

        if (!(match instanceof BedWarsMatch bedwars)) {
            Worlds.Place place = nexus.worlds().placeOf(player);

            // The dig site decides whether that block was in the field.
            if (place == Worlds.Place.DIGSITE) {
                switch (nexus.digSite().dug(player, event.getBlock())) {
                    case REFUSED -> {
                        event.setCancelled(true);
                        return;
                    }
                    /*
                     * Broken, but it drops nothing.
                     *
                     * What the pack holds is a number the buyer pays out on.
                     * Letting the block drop as well handed the player real
                     * dirt that selling never removed, because selling empties
                     * the counter and never looks at the inventory.
                     */
                    case COUNTED -> event.setDropItems(false);
                    case IGNORED -> { }
                }
            }

            // Prison decides for itself whether that block was theirs to break.
            if (place == Worlds.Place.PRISON) {
                if (nexus.prison().mined(player, event.getBlock())) {
                    event.setCancelled(true);
                    return;
                }
                nexus.quests().check(player);
            }

            /*
             * Jobs pay everywhere except the lobby and the minigames.
             *
             * Including prison, deliberately: a miner mining is exactly what
             * the job is for, and excluding the one world built around mining
             * would be a strange rule to have to explain.
             */
            if (place != null) nexus.jobs().mined(player, event.getBlock().getType());

            // And what the work makes of them, which is the other half.
            nexus.skills().broke(player, event.getBlock());

            /*
             * One Block: the block comes back, so the break is allowed but the
             * replacement is scheduled. Anything else on their island is an
             * ordinary block, and still wants picking up for them.
             */
            if (place == Worlds.Place.ONEBLOCK) {
                if (!nexus.oneBlock().broke(player, event)) {
                    Pickup.straightToPlayer(player, event);
                }
                return;
            }

            // Skyblock: everything you mine is over lava or a drop.
            if (place == Worlds.Place.SKYBLOCK) {
                // And the generator lets something out now and then.
                nexus.skyBlock().mined(player, event.getBlock());
                Pickup.straightToPlayer(player, event);
            }
            return;
        }

        Block block = event.getBlock();

        Squad bedOwner = bedOf(bedwars, block);
        if (bedOwner != null) {
            event.setCancelled(true);
            // Cancelled and handled by hand: breaking one half of a bed leaves
            // the other half behind as an orphan, and the match needs to know
            // regardless of which half was hit.
            removeBed(block);
            bedwars.bedBroken(player, bedOwner);
            return;
        }

        if (!bedwars.mayBreak(block)) {
            event.setCancelled(true);
            player.sendMessage(Text.bad("You can only break blocks that were placed."));
            return;
        }

        bedwars.noteBroken(block);
    }

    private Squad bedOf(BedWarsMatch match, Block block) {
        if (!block.getType().name().endsWith("_BED")) return null;
        return match.squadForBed(block.getType());
    }

    /** Takes both halves, whichever one was hit. */
    private void removeBed(Block block) {
        if (!(block.getBlockData() instanceof org.bukkit.block.data.type.Bed bed)) {
            block.setType(Material.AIR);
            return;
        }

        Block other = bed.getPart() == org.bukkit.block.data.type.Bed.Part.HEAD
                ? block.getRelative(bed.getFacing().getOppositeFace())
                : block.getRelative(bed.getFacing());

        block.setType(Material.AIR, false);
        if (other.getType().name().endsWith("_BED")) other.setType(Material.AIR, false);
    }

    /**
     * TNT takes player-placed blocks and nothing else.
     *
     * Otherwise a single stack blows the floor out of a base and the bed falls
     * into the void, which ends a game without anybody having reached the bed.
     */
    @EventHandler
    public void onExplode(EntityExplodeEvent event) {
        Match match = matchInWorld(event.getEntity().getWorld().getName());

        if (!(match instanceof BedWarsMatch bedwars)) {
            /*
             * Creepers and TNT stop at a claim border.
             *
             * Filtering the block list rather than cancelling the event, so the
             * explosion still happens, still hurts, and still destroys the
             * unclaimed ground around it - only the protected blocks survive.
             */
            event.blockList().removeIf(block -> nexus.claims().claimed(block.getLocation()));
            return;
        }

        Iterator<Block> blocks = event.blockList().iterator();
        while (blocks.hasNext()) {
            Block block = blocks.next();
            if (block.getType().name().endsWith("_BED")) continue;
            if (!bedwars.mayBreak(block)) blocks.remove();
            else bedwars.noteBroken(block);
        }
    }

    private Match matchInWorld(String worldName) {
        for (Match match : nexus.games().running()) {
            if (match instanceof BedWarsMatch bedwars && bedwars.worldName().equals(worldName)) {
                return match;
            }
        }
        return null;
    }

    /* --------------------------------------------------------------- damage */

    @EventHandler(priority = EventPriority.HIGH)
    public void onDamage(EntityDamageEvent event) {
        if (!(event.getEntity() instanceof Player player)) return;

        if (nexus.games().matchOf(player.getUniqueId()) instanceof Fighting fight) {
            if (!fight.fighting()) {
                event.setCancelled(true);
                return;
            }

            /*
             * Nobody dies. Fatal damage is cancelled and turned into an
             * elimination instead.
             *
             * Letting a player actually die means a death screen, a respawn to
             * intercept, and an inventory scattered across an arena that is
             * about to be deleted. Every one of those is a place for a match to
             * leak into the next one, and none of them buys anything: the game
             * needs to know somebody is out, which it can be told directly.
             */
            if (event.getFinalDamage() >= player.getHealth()) {
                event.setCancelled(true);
                player.setHealth(20.0);
                player.setFireTicks(0);
                fight.eliminated(player, null);
            }
            return;
        }

        /*
         * Falling is the whole game here, so it cannot also be the punishment.
         *
         * The dropper's rule is that the water saves you and an obstacle sends
         * you back to the top, and both of those are decided by the plugin
         * watching where you end up. Fall damage is a third outcome nobody
         * asked for, arriving from Minecraft rather than from the game - and
         * because it kills, it overrules the other two.
         */
        if (nexus.worlds().placeOf(player) == Worlds.Place.DROPPER
                && event.getCause() == EntityDamageEvent.DamageCause.FALL) {
            event.setCancelled(true);
            player.setFallDistance(0f);
            return;
        }

        if (nexus.hub().isHub(player)) {
            event.setCancelled(true);

            // Except falling off, which puts them back on the platform rather
            // than killing them in a world with no floor.
            if (player.getLocation().getY() < 30) nexus.hub().send(player);
            return;
        }

        Match match = nexus.games().matchOf(player.getUniqueId());
        if (!(match instanceof BedWarsMatch bedwars)) return;

        if (player.getGameMode() == GameMode.SPECTATOR) {
            event.setCancelled(true);
            return;
        }

        // The void is a kill however far the fall was, and a fall that would
        // kill is a kill; both go through the same door so the killer is
        // credited either way.
        double after = player.getHealth() - event.getFinalDamage();
        if (after > 0 && event.getCause() != EntityDamageEvent.DamageCause.VOID) return;

        event.setCancelled(true);
        bedwars.died(player, lastAttacker(player));
    }

    @EventHandler(priority = EventPriority.LOW)
    public void onPlayerDamage(EntityDamageByEntityEvent event) {
        /*
         * The boss counts what everybody does to it.
         *
         * First, before anything can cancel the event: the purse is split by
         * damage share, so a hit that lands has to be recorded whatever else
         * happens to it afterwards.
         */
        if (nexus.boss().is(event.getEntity())) {
            Player hitter = attackerOf(event);
            if (hitter != null) nexus.boss().hurt(hitter, event.getFinalDamage());
        }

        /*
         * The combat perk, applied to anything a player hits.
         *
         * Above the guard below, which only concerns players being hurt - a
         * skill that made you hit players harder but not mobs would be a
         * strange thing to have levelled by killing mobs.
         */
        Player hitting = attackerOf(event);
        if (hitting != null) {
            double bonus = nexus.skills().damageBonus(hitting);
            if (bonus > 1.0) event.setDamage(event.getDamage() * bonus);
        }

        if (!(event.getEntity() instanceof Player hurt)) return;

        Player attacker = attackerOf(event);
        if (attacker == null) return;

        Match match = nexus.games().matchOf(hurt.getUniqueId());

        if (match instanceof Fighting fight) {
            /*
             * Nobody is hurt before the countdown ends.
             *
             * Without this the player who loads fastest gets two free hits on
             * everybody still seeing a black screen, which decides a Duel
             * before either of them has moved.
             */
            if (!fight.fighting()) {
                event.setCancelled(true);
                return;
            }

            // Remembered even when the hit does no damage, because in Sumo the
            // hit that wins a round is the one that does no damage at all.
            fight.hitBy(hurt, attacker);

            if (!fight.hurts()) event.setDamage(0.0);
            return;
        }

        if (!(match instanceof BedWarsMatch bedwars)) {
            // Nobody hits anybody in the hub.
            if (nexus.hub().isHub(hurt)) event.setCancelled(true);
            return;
        }

        Squad theirs = bedwars.squadOf(hurt.getUniqueId());
        Squad ours = bedwars.squadOf(attacker.getUniqueId());

        if (theirs != null && theirs.equals(ours)) event.setCancelled(true);
    }

    private Player attackerOf(EntityDamageByEntityEvent event) {
        if (event.getDamager() instanceof Player direct) return direct;
        if (event.getDamager() instanceof org.bukkit.entity.Projectile shot
                && shot.getShooter() instanceof Player shooter) {
            return shooter;
        }
        return null;
    }

    /** Who hit them last, for crediting a kill they finished by falling. */
    private Player lastAttacker(Player player) {
        Entity killer = player.getKiller();
        if (killer instanceof Player direct) return direct;

        var damage = player.getLastDamageCause();
        if (damage instanceof EntityDamageByEntityEvent byEntity) {
            return attackerOf(byEntity);
        }
        return null;
    }

    /**
     * Where somebody is standing, for the one game that cares.
     *
     * Move events fire several times a second per player and this runs on all
     * of them, so it does as little as possible: one map lookup and an early
     * return for everybody not in a TNT Run match, which is everybody.
     */
    @EventHandler(ignoreCancelled = true)
    public void onMove(org.bukkit.event.player.PlayerMoveEvent event) {
        Match match = nexus.games().matchOf(event.getPlayer().getUniqueId());
        if (match instanceof dev.nexuscraft.nexus.minigames.TntRun.TntRunMatch tnt) {
            tnt.stoodOn(event.getPlayer());
        }
    }

    /**
     * Selling happens on close, which is the only moment the contents are final.
     *
     * Doing it per click would mean an item is sold the instant it lands in the
     * window, and putting something in by accident would be unrecoverable.
     */
    @EventHandler
    public void onMenuClose(org.bukkit.event.inventory.InventoryCloseEvent event) {
        if (!(event.getPlayer() instanceof Player player)) return;
        if (event.getView().title().equals(Vault.TITLE)) {
            nexus.vault().settle(player, event.getInventory());
            return;
        }

        if (!event.getView().title().equals(SellWindow.TITLE)) return;

        SellWindow.settle(nexus, player, event.getInventory());
    }

    @EventHandler
    public void onFish(org.bukkit.event.player.PlayerFishEvent event) {
        if (event.getState() != org.bukkit.event.player.PlayerFishEvent.State.CAUGHT_FISH) return;
        if (nexus.worlds().placeOf(event.getPlayer()) == null) return;

        nexus.jobs().caught(event.getPlayer());
    }

    @EventHandler
    public void onKill(org.bukkit.event.entity.EntityDeathEvent event) {
        /*
         * The world boss, first, for the same reason the dungeon boss is early:
         * it has to be noticed however it died, and the ordinary path below
         * gives up as soon as there is no player to pay.
         */
        if (nexus.boss().is(event.getEntity())) {
            nexus.boss().killed();
            return;
        }

        /*
         * A dungeon boss, before the early return below.
         *
         * Asked first because it has to be noticed however it died - drowned,
         * fallen, or finished off by its own spawner's skeletons - and the
         * ordinary path here gives up as soon as there is no player to pay.
         */
        if (event.getEntity() instanceof org.bukkit.entity.LivingEntity beast
                && nexus.dungeons().killed(beast, event.getEntity().getKiller())) {
            return;
        }

        Player killer = event.getEntity().getKiller();
        if (killer == null) return;

        /*
         * A player killing a player is a bounty, not a job.
         *
         * Handled before the match and world guards below, because those exist
         * to decide whether somebody gets paid wages for hunting animals, and
         * a bounty answers a different question with its own rules.
         */
        // The arena is counting what is left, and only it knows.
        if (nexus.mobArena().killed(event.getEntity().getUniqueId())) return;

        // What the fight made of them, before anything decides on payment.
        nexus.skills().killed(killer, event.getEntity());

        if (event.getEntity() instanceof Player victim) {
            nexus.bounties().killed(killer, victim);
            return;
        }

        // Not in a match: a Bed Wars kill is worth coins, not wages.
        if (nexus.games().matchOf(killer.getUniqueId()) != null) return;
        if (nexus.worlds().placeOf(killer) == null) return;

        nexus.jobs().killed(killer, event.getEntity().getType());
    }

    /**
     * Bots and signs are put back when their ground arrives.
     *
     * They are non-persistent, so they are gone the moment a chunk unloads.
     * That is the design — it is what stops a restart leaving a duplicate of
     * every greeter — and it means the only reliable moment to place one is
     * when its chunk loads. Which also means nothing has to be held open.
     */
    @EventHandler
    public void onChunkLoad(org.bukkit.event.world.ChunkLoadEvent event) {
        // Null while the hub world is still being created, and every chunk of
        // it loading fires this. Asking the hub for itself at that moment is
        // what made it build twice.
        var hub = nexus.hub().worldIfReady();
        if (hub == null || !event.getWorld().equals(hub)) return;

        nexus.hub().placeInChunk(event.getChunk());
        nexus.holograms().drawInChunk(event.getChunk());
    }

    /**
     * Walking into one of the lobby's doorways.
     *
     * Cancelled whatever happens, because a nether portal block sitting in the
     * overworld means one thing to the game and something else to us: left to
     * itself it would send somebody to the default world's nether, a dimension
     * belonging to a world nobody plays in.
     */
    @EventHandler
    public void onPortalEnter(org.bukkit.event.entity.EntityPortalEnterEvent event) {
        if (!(event.getEntity() instanceof Player player)) return;

        if (nexus.portals().entered(player, event.getLocation())) {
            event.setCancelled(true);
        }
    }

    /** The same refusal, one step later, in case anything gets past the first. */
    @EventHandler
    public void onHubPortal(org.bukkit.event.player.PlayerPortalEvent event) {
        if (nexus.hub().isHub(event.getPlayer())) event.setCancelled(true);
    }

    @EventHandler
    public void onHunger(FoodLevelChangeEvent event) {
        if (event.getEntity() instanceof Player player && nexus.hub().isHub(player)) {
            event.setCancelled(true);
        }
    }

    @EventHandler
    public void onDrop(PlayerDropItemEvent event) {
        if (nexus.hub().isHub(event.getPlayer())
                && !nexus.hub().isBuilding(event.getPlayer().getUniqueId())) {
            event.setCancelled(true);
        }
    }
}
