package dev.nexuscraft.nexus;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.Sound;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.entity.Player;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;
import org.bukkit.profile.PlayerTextures;

import java.io.File;
import java.net.URI;
import java.util.ArrayList;
import java.util.List;

/**
 * A shop that sells how you look.
 *
 * The server cannot change anybody's actual Minecraft skin — that belongs to
 * their Mojang account and nothing here can touch it. What it can do is change
 * how they appear *to everybody on this server*, which for a cosmetic shop is
 * better than the real thing: it is reversible, it is per server, and nobody
 * has to log into anything.
 *
 * Built to be fed by something else. The catalogue is a file of name, price and
 * texture URL, and it can be added to in game, so a skin generator can publish
 * straight into the shop without anybody editing YAML or restarting a server.
 *
 * The one hard requirement is where the texture lives. Minecraft clients only
 * load skins from Mojang's own texture host, so a PNG on any other server will
 * not render — it has to be uploaded to Mojang first, and the usual free way to
 * do that is MineSkin, which takes a PNG and hands back a textures.minecraft.net
 * URL. That URL is what goes in the catalogue.
 */
public final class Skins {

    public static final Component TITLE =
            Component.text("Skins", NamedTextColor.DARK_GRAY);

    /** Where a texture has to be hosted for a client to load it. */
    private static final String MOJANG_TEXTURES = "textures.minecraft.net";

    /** One thing on the rack. */
    public record Skin(String id, String name, int price, String url) {
    }

    private final Nexus nexus;
    private final File file;

    private final List<Skin> rack = new ArrayList<>();

    public Skins(Nexus nexus) {
        this.nexus = nexus;
        this.file = new File(nexus.getDataFolder(), "skins.yml");
        load();
    }

    public int count() {
        return rack.size();
    }

    /* --------------------------------------------------------------- rack */

    private void load() {
        if (!file.exists()) {
            save();
            return;
        }

        YamlConfiguration yaml = YamlConfiguration.loadConfiguration(file);
        for (String id : yaml.getKeys(false)) {
            String url = yaml.getString(id + ".url", "");
            if (url.isBlank()) continue;

            rack.add(new Skin(id,
                    yaml.getString(id + ".name", id),
                    yaml.getInt(id + ".price"),
                    url));
        }
    }

    public void save() {
        YamlConfiguration yaml = new YamlConfiguration();
        for (Skin skin : rack) {
            yaml.set(skin.id() + ".name", skin.name());
            yaml.set(skin.id() + ".price", skin.price());
            yaml.set(skin.id() + ".url", skin.url());
        }

        try {
            yaml.save(file);
        } catch (Exception e) {
            nexus.getLogger().warning("could not save skins: " + e);
        }
    }

    /**
     * Adds one to the rack, checking the thing most likely to be wrong.
     *
     * A URL that is not on Mojang's texture host will save happily, appear in
     * the shop, sell for money, and then simply not change how anybody looks —
     * with no error anywhere. Refusing it here is the difference between a typo
     * and a mystery.
     */
    public String add(String id, String name, int price, String url) {
        if (!url.contains(MOJANG_TEXTURES)) {
            return "That URL is not on " + MOJANG_TEXTURES + ". Clients will not load it."
                    + " Upload the PNG to MineSkin first and use the URL it gives you.";
        }
        if (rack.stream().anyMatch(skin -> skin.id().equalsIgnoreCase(id))) {
            return "There is already a skin called " + id + ".";
        }

        rack.add(new Skin(id.toLowerCase(), name, price, url));
        save();
        return null;
    }

    public boolean remove(String id) {
        boolean removed = rack.removeIf(skin -> skin.id().equalsIgnoreCase(id));
        if (removed) save();
        return removed;
    }

    /* ---------------------------------------------------------------- shop */

    public void open(Player player) {
        Stats.Record record = nexus.stats().of(player.getUniqueId());

        int rows = Math.max(1, Math.min(6, (rack.size() + 9) / 9 + 1));
        Inventory menu = Bukkit.createInventory(null, rows * 9, TITLE);

        if (rack.isEmpty()) {
            ItemStack empty = new ItemStack(Material.BARRIER);
            empty.editMeta(meta -> {
                meta.displayName(Text.item("No skins yet", NamedTextColor.RED));
                meta.lore(List.of(
                        Text.item("An operator adds them with", NamedTextColor.GRAY),
                        Text.item("/nexus addskin <id> <price> <url>", NamedTextColor.DARK_GRAY)));
            });
            menu.setItem(4, empty);
            player.openInventory(menu);
            return;
        }

        for (int i = 0; i < Math.min(rack.size(), menu.getSize() - 9); i++) {
            Skin skin = rack.get(i);
            boolean owned = record.skins.contains(skin.id());
            boolean worn = record.skin.equals(skin.id());
            boolean afford = record.money >= skin.price();

            ItemStack item = new ItemStack(Material.PLAYER_HEAD);
            item.editMeta(meta -> {
                meta.displayName(Text.item(skin.name(),
                        worn ? NamedTextColor.YELLOW
                                : owned ? NamedTextColor.GREEN
                                : afford ? NamedTextColor.WHITE : NamedTextColor.RED));

                List<Component> lore = new ArrayList<>();
                if (worn) lore.add(Text.item("Wearing this. Click to take it off.",
                        NamedTextColor.GRAY));
                else if (owned) lore.add(Text.item("Click to wear", NamedTextColor.YELLOW));
                else {
                    lore.add(Text.item(Stats.cash(skin.price()), NamedTextColor.GOLD));
                    lore.add(Component.empty());
                    lore.add(Text.item(afford ? "Click to buy" : "You cannot afford this",
                            afford ? NamedTextColor.YELLOW : NamedTextColor.DARK_GRAY));
                }
                meta.lore(lore);
            });
            menu.setItem(i, item);
        }

        // Somewhere to go back to your own face.
        ItemStack reset = new ItemStack(Material.WATER_BUCKET);
        reset.editMeta(meta -> {
            meta.displayName(Text.item("My own skin", NamedTextColor.AQUA));
            meta.lore(List.of(Text.item("Back to how you normally look", NamedTextColor.GRAY)));
        });
        menu.setItem(menu.getSize() - 1, reset);

        player.openInventory(menu);
    }

    public void clicked(Player player, int slot) {
        Inventory open = player.getOpenInventory().getTopInventory();

        if (slot == open.getSize() - 1) {
            wearOwn(player);
            return;
        }
        if (slot < 0 || slot >= rack.size()) return;

        Skin skin = rack.get(slot);
        Stats.Record record = nexus.stats().of(player.getUniqueId());

        if (!record.skins.contains(skin.id())) {
            if (!nexus.stats().charge(player.getUniqueId(), skin.price())) {
                player.sendMessage(Text.bad(skin.name() + " costs "
                        + Stats.cash(skin.price()) + "."));
                player.playSound(player, Sound.ENTITY_VILLAGER_NO, 1f, 1f);
                return;
            }
            record.skins.add(skin.id());
            player.sendMessage(Text.good("Bought " + skin.name() + "."));
        }

        if (record.skin.equals(skin.id())) {
            wearOwn(player);
            return;
        }

        record.skin = skin.id();
        apply(player, skin.url());

        player.sendMessage(Text.says("Wearing " + skin.name() + "."));
        player.playSound(player, Sound.ITEM_ARMOR_EQUIP_LEATHER, 0.8f, 1.2f);
        open(player);
    }

    private void wearOwn(Player player) {
        nexus.stats().of(player.getUniqueId()).skin = "";
        apply(player, null);

        player.sendMessage(Text.says("Back to your own skin."));
        open(player);
    }

    /* -------------------------------------------------------------- wearing */

    /**
     * Puts a texture on somebody, or takes it off.
     *
     * Null means their real skin, which is done by clearing the texture and
     * letting Paper fill it from Mojang again rather than by remembering what
     * it was — remembering it would mean storing a copy that goes stale the
     * moment they change it.
     *
     * Whether other players see the change without relogging is up to the
     * client, and worth knowing before anybody sells this: the player who
     * changed it sees it immediately, and everybody else may need them to move
     * out of and back into view.
     */
    public void apply(Player player, String url) {
        try {
            // Paper's PlayerProfile, not Bukkit's. getPlayerProfile returns the
            // Paper one and setPlayerProfile only accepts it; the Bukkit type
            // it extends compiles fine on the way in and not on the way out.
            com.destroystokyo.paper.profile.PlayerProfile profile = player.getPlayerProfile();
            PlayerTextures textures = profile.getTextures();

            if (url == null) textures.setSkin(null);
            else textures.setSkin(URI.create(url).toURL());

            profile.setTextures(textures);
            player.setPlayerProfile(profile);
        } catch (Exception e) {
            nexus.getLogger().warning("could not apply a skin to "
                    + player.getName() + ": " + e);
            player.sendMessage(Text.bad("That skin would not load."));
        }
    }

    /** Puts their chosen skin back on when they join. */
    public void restore(Player player) {
        String chosen = nexus.stats().of(player.getUniqueId()).skin;
        if (chosen == null || chosen.isEmpty()) return;

        rack.stream()
                .filter(skin -> skin.id().equals(chosen))
                .findFirst()
                .ifPresent(skin -> apply(player, skin.url()));
    }
}
