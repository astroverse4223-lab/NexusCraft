package dev.nexuscraft.nexus;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.OfflinePlayer;
import org.bukkit.Sound;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.block.BlockFace;
import org.bukkit.block.Container;
import org.bukkit.block.Sign;
import org.bukkit.block.data.type.WallSign;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.entity.Player;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;

import java.io.File;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Shops players run themselves.
 *
 * The auction house is a list: you put something on it and somebody, somewhere,
 * buys it. This is the other half of an economy - a shop in a place, that
 * people have to walk to. It is what makes the land somebody claimed worth
 * showing anyone, and it is the only reason to visit another player's base once
 * you have your own.
 *
 * A sign on a chest, and the chest is the stock. Deliberately not a virtual
 * inventory: a shop that runs out because somebody bought everything is a shop
 * that has to be restocked by its owner, which is the part that makes it a
 * business rather than an infinite dispenser.
 */
public final class PlayerShops {

    /** How many shops each rank may run. */
    private static int allowance(Ranks rank) {
        return switch (rank) {
            case PLAYER -> 5;
            case VIP -> 12;
            case MVP -> 25;
            case ADMIN, OWNER -> 500;
        };
    }

    /** The word on the first line that turns a sign into a shop. */
    private static final String KEYWORD = "[shop]";

    /** One shop. The stock is whatever is in the chest, so it is not stored. */
    private record Stall(UUID owner, Material item, int amount, double price) {
    }

    private final Nexus nexus;
    private final File file;

    /** Keyed "world:x:y:z" of the sign, which is what a click gives us. */
    private final Map<String, Stall> stalls = new HashMap<>();

    public PlayerShops(Nexus nexus) {
        this.nexus = nexus;
        this.file = new File(nexus.getDataFolder(), "playershops.yml");
        load();
    }

    private static String key(Location at) {
        return at.getWorld().getName() + ":" + at.getBlockX() + ":"
                + at.getBlockY() + ":" + at.getBlockZ();
    }

    /* ---------------------------------------------------------------- chest */

    /**
     * The container a shop sign is selling out of.
     *
     * A wall sign sells from what it is nailed to; a standing sign from what is
     * underneath it. Anything else is just a sign.
     */
    private Block containerFor(Block sign) {
        Block holding;

        if (sign.getBlockData() instanceof WallSign wall) {
            holding = sign.getRelative(wall.getFacing().getOppositeFace());
        } else {
            holding = sign.getRelative(BlockFace.DOWN);
        }

        return holding.getState() instanceof Container ? holding : null;
    }

    private Inventory stockOf(Block sign) {
        Block container = containerFor(sign);
        if (container == null) return null;
        return container.getState() instanceof Container box ? box.getInventory() : null;
    }

    /** How many of the item the shop still has. */
    private int stock(Inventory inventory, Material item) {
        int count = 0;
        for (ItemStack stack : inventory.getContents()) {
            if (stack != null && stack.getType() == item) count += stack.getAmount();
        }
        return count;
    }

    /* --------------------------------------------------------------- making */

    /**
     * Turns a freshly written sign into a shop, or explains why it cannot.
     *
     * Returns the lines to put on the sign, or null to leave it as ordinary
     * text. Every refusal says what was wrong: a sign that silently stays a
     * sign is indistinguishable from one the server did not notice.
     */
    public String[] create(Player player, Block sign, String[] lines) {
        if (lines.length < 3 || !lines[0].trim().equalsIgnoreCase(KEYWORD)) return null;

        if (!nexus.claims().mayBuild(player, sign)) {
            player.sendMessage(Text.bad("You can only open a shop on land you own."));
            return null;
        }

        Block container = containerFor(sign);
        if (container == null) {
            player.sendMessage(Text.bad("A shop sign goes on a chest, or on a sign above one."));
            player.sendMessage(Text.plain("  Put the chest down first, then the sign on it."));
            return null;
        }

        int amount = tryInt(lines[1]);
        double price = tryDouble(lines[2]);

        if (amount < 1 || amount > 64) {
            player.sendMessage(Text.bad("Second line: how many, from 1 to 64."));
            return null;
        }
        if (price < 0.01 || price > 10_000_000) {
            player.sendMessage(Text.bad("Third line: the price for that many."));
            return null;
        }

        Inventory inventory = stockOf(sign);
        Material item = firstItem(inventory);

        if (item == null) {
            player.sendMessage(Text.bad("Put what you are selling in the chest first."));
            player.sendMessage(Text.plain("  The shop sells whatever is in there."));
            return null;
        }

        int have = countOf(player.getUniqueId());
        int allowed = allowance(nexus.stats().rankOf(player.getUniqueId()));

        if (have >= allowed) {
            player.sendMessage(Text.bad("You already run all " + allowed + " of your shops."));
            player.sendMessage(Text.plain("  Break one of the signs, or rank up for more."));
            return null;
        }

        stalls.put(key(sign.getLocation()), new Stall(player.getUniqueId(), item, amount, price));
        save();

        player.sendMessage(Text.good("Shop open: " + amount + " x " + nameOf(item)
                + " for " + Stats.cash(price) + "."));
        player.sendMessage(Text.plain("  Keep the chest stocked. Break the sign to close it."));
        player.playSound(player, Sound.BLOCK_AMETHYST_BLOCK_CHIME, 0.9f, 1.2f);

        return face(player.getName(), item, amount, price);
    }

    /** What the sign reads once it is a shop. */
    private String[] face(String owner, Material item, int amount, double price) {
        return new String[] {
                "[Shop]",
                owner,
                amount + " x " + nameOf(item),
                Stats.cash(price)
        };
    }

    /** The first thing in the chest, which is what the shop sells. */
    private Material firstItem(Inventory inventory) {
        if (inventory == null) return null;

        for (ItemStack stack : inventory.getContents()) {
            if (stack != null && stack.getType() != Material.AIR) return stack.getType();
        }
        return null;
    }

    /* --------------------------------------------------------------- buying */

    public boolean isStall(Block sign) {
        return sign != null && stalls.containsKey(key(sign.getLocation()));
    }

    /**
     * Somebody has right clicked a shop sign.
     *
     * The owner gets told how it is doing rather than sold to, because buying
     * from yourself is only ever a mistake - and being able to see the stock
     * without breaking the sign is the thing an owner actually wants.
     */
    public void use(Player player, Block sign) {
        Stall stall = stalls.get(key(sign.getLocation()));
        if (stall == null) return;

        Inventory inventory = stockOf(sign);
        if (inventory == null) {
            player.sendMessage(Text.bad("The chest behind this shop is gone."));
            return;
        }

        int available = stock(inventory, stall.item());

        if (stall.owner().equals(player.getUniqueId())) {
            player.sendMessage(Text.heading("Your shop"));
            player.sendMessage(Text.field("Selling", stall.amount() + " x " + nameOf(stall.item())));
            player.sendMessage(Text.field("Price", Stats.cash(stall.price())));
            player.sendMessage(Text.field("In stock", available + " ("
                    + (available / stall.amount()) + " sales)"));
            return;
        }

        if (available < stall.amount()) {
            player.sendMessage(Text.bad("Sold out."));
            player.playSound(player, Sound.BLOCK_NOTE_BLOCK_BASS, 0.8f, 0.8f);
            return;
        }

        if (!nexus.stats().charge(player.getUniqueId(), stall.price())) {
            player.sendMessage(Text.bad("That costs " + Stats.cash(stall.price())
                    + " and you have " + Stats.cash(nexus.stats().moneyOf(player.getUniqueId())) + "."));
            return;
        }

        /*
         * Taken from the chest before it is handed over.
         *
         * The other order hands out the goods and then discovers the chest was
         * emptied a tick ago by the owner, which is how a shop prints items.
         */
        inventory.removeItem(new ItemStack(stall.item(), stall.amount()));

        ItemStack bought = new ItemStack(stall.item(), stall.amount());
        for (ItemStack spare : player.getInventory().addItem(bought).values()) {
            player.getWorld().dropItemNaturally(player.getLocation(), spare);
        }

        nexus.stats().pay(stall.owner(), stall.price());

        player.sendMessage(Text.good("Bought " + stall.amount() + " x " + nameOf(stall.item())
                + " for " + Stats.cash(stall.price()) + "."));
        player.playSound(player, Sound.ENTITY_EXPERIENCE_ORB_PICKUP, 1f, 1.2f);

        Player owner = Bukkit.getPlayer(stall.owner());
        if (owner != null) {
            owner.sendMessage(Text.says(player.getName() + " bought " + stall.amount() + " x "
                    + nameOf(stall.item()) + " for " + Stats.cash(stall.price()) + "."));
            owner.playSound(owner, Sound.BLOCK_AMETHYST_BLOCK_CHIME, 0.6f, 1.6f);
        }
    }

    /* -------------------------------------------------------------- keeping */

    /**
     * Whether this player may break this shop sign.
     *
     * The claim already stops strangers building here, but a shop is worth
     * protecting from the people who are trusted on the land as well - being
     * allowed to help build is not the same as being allowed to close somebody
     * else's business.
     */
    public boolean mayBreak(Player player, Block block) {
        Stall stall = stalls.get(key(block.getLocation()));
        if (stall == null) return true;

        if (stall.owner().equals(player.getUniqueId())) return true;
        if (player.hasPermission("nexus.admin")) return true;

        player.sendMessage(Text.bad("That is " + nameOf(stall.owner()) + "'s shop."));
        return false;
    }

    /** Forgets a shop whose sign has gone. */
    public void closed(Block sign) {
        if (stalls.remove(key(sign.getLocation())) != null) save();
    }

    /**
     * Whether this container is the stock of a shop somebody else runs.
     *
     * Without this the sign is protected and the chest under it is not, which
     * protects the shop's name and none of its goods.
     */
    public boolean guardsContainer(Player player, Block container) {
        for (BlockFace face : new BlockFace[] {
                BlockFace.NORTH, BlockFace.SOUTH, BlockFace.EAST, BlockFace.WEST, BlockFace.UP }) {

            Block maybeSign = container.getRelative(face);
            Stall stall = stalls.get(key(maybeSign.getLocation()));
            if (stall == null) continue;

            // Only if that sign really is selling out of this container.
            Block theirs = containerFor(maybeSign);
            if (theirs == null || !theirs.equals(container)) continue;

            if (stall.owner().equals(player.getUniqueId())) return false;
            if (player.hasPermission("nexus.admin")) return false;

            player.sendMessage(Text.bad("That is " + nameOf(stall.owner()) + "'s shop stock."));
            return true;
        }
        return false;
    }

    /* ---------------------------------------------------------------- lists */

    /** Somebody's own shops, so they can find the one they forgot about. */
    public void mine(Player player) {
        player.sendMessage(Text.heading("Your shops"));

        int shown = 0;
        for (Map.Entry<String, Stall> entry : stalls.entrySet()) {
            if (!entry.getValue().owner().equals(player.getUniqueId())) continue;

            String[] parts = entry.getKey().split(":");
            Stall stall = entry.getValue();

            player.sendMessage(Text.field(
                    stall.amount() + " x " + nameOf(stall.item()) + " for " + Stats.cash(stall.price()),
                    parts[1] + ", " + parts[2] + ", " + parts[3] + " in " + parts[0]));
            shown++;
        }

        int allowed = allowance(nexus.stats().rankOf(player.getUniqueId()));
        if (shown == 0) player.sendMessage(Text.plain("  None yet."));
        player.sendMessage(Text.plain("  " + shown + " of " + allowed + "."));
    }

    public int total() {
        return stalls.size();
    }

    private int countOf(UUID who) {
        int count = 0;
        for (Stall stall : stalls.values()) if (stall.owner().equals(who)) count++;
        return count;
    }

    private String nameOf(UUID who) {
        OfflinePlayer player = Bukkit.getOfflinePlayer(who);
        return player.getName() == null ? "somebody" : player.getName();
    }

    private static String nameOf(Material item) {
        String words = item.name().toLowerCase().replace('_', ' ');
        return Character.toUpperCase(words.charAt(0)) + words.substring(1);
    }

    private static int tryInt(String text) {
        try {
            return Integer.parseInt(text.trim());
        } catch (Exception ignored) {
            return -1;
        }
    }

    private static double tryDouble(String text) {
        try {
            return Double.parseDouble(text.trim().replace("$", "").replace(",", ""));
        } catch (Exception ignored) {
            return -1;
        }
    }

    /* ------------------------------------------------------------ on disk */

    private void load() {
        if (!file.exists()) return;

        YamlConfiguration yaml = YamlConfiguration.loadConfiguration(file);
        for (String key : yaml.getKeys(false)) {
            try {
                Material item = Material.valueOf(yaml.getString(key + ".item", "STONE"));
                stalls.put(key, new Stall(
                        UUID.fromString(yaml.getString(key + ".owner", "")),
                        item,
                        yaml.getInt(key + ".amount", 1),
                        yaml.getDouble(key + ".price", 1)));
            } catch (Exception broken) {
                nexus.getLogger().warning("skipping an unreadable shop at " + key);
            }
        }
    }

    public void save() {
        YamlConfiguration yaml = new YamlConfiguration();

        for (Map.Entry<String, Stall> entry : stalls.entrySet()) {
            Stall stall = entry.getValue();
            yaml.set(entry.getKey() + ".owner", stall.owner().toString());
            yaml.set(entry.getKey() + ".item", stall.item().name());
            yaml.set(entry.getKey() + ".amount", stall.amount());
            yaml.set(entry.getKey() + ".price", stall.price());
        }

        try {
            yaml.save(file);
        } catch (Exception broken) {
            nexus.getLogger().warning("could not save the player shops: " + broken);
        }
    }

    /**
     * Drops shops whose sign is no longer there.
     *
     * A sign can go without the break event firing - the block it was on was
     * removed, the chunk was rolled back, a world was regenerated. Left alone
     * those entries protect a spot with nothing in it and count against
     * somebody's allowance forever.
     */
    public int sweep() {
        List<String> gone = new ArrayList<>();

        for (String key : stalls.keySet()) {
            String[] parts = key.split(":");
            World world = Bukkit.getWorld(parts[0]);

            if (world == null) continue; // Not loaded is not the same as gone.

            Location at = new Location(world, Integer.parseInt(parts[1]),
                    Integer.parseInt(parts[2]), Integer.parseInt(parts[3]));

            if (!at.getChunk().isLoaded()) continue;
            if (!(at.getBlock().getState() instanceof Sign)) gone.add(key);
        }

        for (String key : gone) stalls.remove(key);
        if (!gone.isEmpty()) save();

        return gone.size();
    }
}
