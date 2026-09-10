package dev.nexuscraft.nexus;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextDecoration;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.Sound;
import org.bukkit.entity.Entity;
import org.bukkit.entity.EntityType;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;
import org.bukkit.util.Vector;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Something that follows you around.
 *
 * Pure decoration, and that is the point: it is the cheapest thing on the
 * server to want. A pet costs coins rather than money, so it is bought with
 * what people earn from playing rather than from the economy, and it gives the
 * coin balance somewhere to go other than sitting there.
 *
 * The hard part is not the following, it is the not-leaking. A live entity
 * attached to a player is a thing that survives their disconnect, their world
 * change, a server crash, and a chunk unload - and every one of those leaves a
 * silent bee hovering in an empty lobby forever. So: nothing here is ever
 * persistent, every pet is tagged, and every tag found without an owner is
 * removed on sight.
 */
public final class Pets {

    /** Marks an entity as one of ours, so a stray can always be identified. */
    public static final String TAG = "nexus_pet";

    public static final Component TITLE = Component.text("Pets");

    /** One thing somebody can have following them. */
    private record Kind(String id, String name, EntityType type,
                        Material icon, int coins) {
    }

    private static final List<Kind> KINDS = List.of(
            new Kind("bee", "Bee", EntityType.BEE, Material.HONEYCOMB, 150),
            new Kind("cat", "Cat", EntityType.CAT, Material.COD, 250),
            new Kind("wolf", "Wolf", EntityType.WOLF, Material.BONE, 250),
            new Kind("fox", "Fox", EntityType.FOX, Material.SWEET_BERRIES, 400),
            new Kind("parrot", "Parrot", EntityType.PARROT, Material.FEATHER, 400),
            new Kind("allay", "Allay", EntityType.ALLAY, Material.AMETHYST_SHARD, 700),
            new Kind("axolotl", "Axolotl", EntityType.AXOLOTL, Material.TROPICAL_FISH, 700),
            new Kind("panda", "Panda", EntityType.PANDA, Material.BAMBOO, 1200),
            new Kind("turtle", "Turtle", EntityType.TURTLE, Material.SEAGRASS, 1200),
            new Kind("frog", "Frog", EntityType.FROG, Material.LILY_PAD, 1500));

    private final Nexus nexus;

    /** The entity currently following each player. */
    private final Map<UUID, UUID> following = new HashMap<>();

    public Pets(Nexus nexus) {
        this.nexus = nexus;
    }

    private static Kind kindOf(String id) {
        for (Kind kind : KINDS) if (kind.id().equals(id)) return kind;
        return null;
    }

    /* --------------------------------------------------------------- owning */

    public void open(Player player) {
        Stats.Record record = nexus.stats().of(player.getUniqueId());

        Inventory page = nexus.getServer().createInventory(null, 27, TITLE);

        int slot = 0;
        for (Kind kind : KINDS) {
            boolean owned = record.pets.contains(kind.id());
            boolean out = record.pet.equals(kind.id());

            ItemStack icon = new ItemStack(kind.icon());
            icon.editMeta(meta -> {
                meta.displayName(Component.text(kind.name(),
                                owned ? NamedTextColor.GREEN : NamedTextColor.WHITE)
                        .decoration(TextDecoration.ITALIC, false));

                List<Component> lore = new ArrayList<>();
                if (out) {
                    lore.add(Text.item("Following you", NamedTextColor.AQUA));
                    lore.add(Text.item("Click to put it away", NamedTextColor.GRAY));
                } else if (owned) {
                    lore.add(Text.item("Click to bring it out", NamedTextColor.YELLOW));
                } else {
                    lore.add(Text.item(kind.coins() + " coins", NamedTextColor.YELLOW));
                    lore.add(Text.item(record.coins >= kind.coins()
                                    ? "Click to buy" : "Not enough coins",
                            record.coins >= kind.coins()
                                    ? NamedTextColor.GREEN : NamedTextColor.RED));
                }
                meta.lore(lore);
            });

            page.setItem(slot++, icon);
        }

        ItemStack none = new ItemStack(Material.BARRIER);
        none.editMeta(meta -> {
            meta.displayName(Component.text("No pet", NamedTextColor.RED)
                    .decoration(TextDecoration.ITALIC, false));

            // The balance lives here rather than in the title, so the title can
            // stay a constant the click handler is able to recognise.
            meta.lore(List.of(Text.item(record.coins + " coins", NamedTextColor.YELLOW),
                    Text.item("Coins come from playing games", NamedTextColor.DARK_GRAY)));
        });
        page.setItem(26, none);

        player.openInventory(page);
    }

    /** A click in the menu, by slot, the way every other menu here works. */
    public void clicked(Player player, int slot) {
        if (slot == 26) {
            put(player, "NONE");
            open(player);
            return;
        }

        if (slot < 0 || slot >= KINDS.size()) return;
        Kind kind = KINDS.get(slot);

        Stats.Record record = nexus.stats().of(player.getUniqueId());

        if (!record.pets.contains(kind.id())) {
            if (record.coins < kind.coins()) {
                player.sendMessage(Text.bad("That costs " + kind.coins()
                        + " coins. You have " + record.coins + "."));
                return;
            }

            record.coins -= kind.coins();
            record.pets.add(kind.id());
            player.sendMessage(Text.good("Bought a " + kind.name() + "."));
            player.playSound(player, Sound.ENTITY_PLAYER_LEVELUP, 0.7f, 1.4f);
        }

        put(player, record.pet.equals(kind.id()) ? "NONE" : kind.id());
        open(player);
    }

    private void put(Player player, String id) {
        nexus.stats().of(player.getUniqueId()).pet = id;
        despawn(player);

        if (id.equals("NONE")) {
            player.sendMessage(Text.says("Pet put away."));
            return;
        }

        spawn(player);
        player.sendMessage(Text.good("Out it comes."));
    }

    /* ------------------------------------------------------------- the pet */

    /** Brings out whatever somebody has chosen. Called on join and on warp. */
    public void restore(Player player) {
        String id = nexus.stats().of(player.getUniqueId()).pet;
        if (!id.equals("NONE")) spawn(player);
    }

    private void spawn(Player player) {
        Kind kind = kindOf(nexus.stats().of(player.getUniqueId()).pet);
        if (kind == null) return;

        despawn(player);

        // Not in an arena. A pet in a Duel is a distraction with a hitbox, and
        // the arena world is deleted underneath it when the match ends.
        if (nexus.games().matchOf(player.getUniqueId()) != null) return;

        Location at = player.getLocation().clone().add(1, 0, 1);

        Entity entity = player.getWorld().spawnEntity(at, kind.type());
        if (!(entity instanceof LivingEntity pet)) {
            entity.remove();
            return;
        }

        /*
         * Everything that stops it being a real animal.
         *
         * setPersistent(false) is the important one: a persistent entity is
         * written into the chunk and comes back after a restart with nobody to
         * follow, forever. The rest stop it wandering, breeding, being hurt,
         * being pushed into a wall by somebody, or making noise.
         */
        pet.setAI(false);
        pet.setSilent(true);
        pet.setInvulnerable(true);
        pet.setPersistent(false);
        pet.setCollidable(false);
        pet.setRemoveWhenFarAway(true);
        pet.addScoreboardTag(TAG);

        pet.customName(Component.text(player.getName() + "'s " + kind.name(),
                NamedTextColor.AQUA));
        pet.setCustomNameVisible(true);

        if (pet instanceof org.bukkit.entity.Ageable young) young.setBaby();

        following.put(player.getUniqueId(), pet.getUniqueId());
    }

    public void despawn(Player player) {
        UUID id = following.remove(player.getUniqueId());
        if (id == null) return;

        Entity pet = nexus.getServer().getEntity(id);
        if (pet != null) pet.remove();
    }

    /**
     * Keeps every pet near its owner, four times a second.
     *
     * Teleported rather than given a follow goal. A real pathfinding pet gets
     * stuck on a fence, drowns in the moat, and cannot follow anybody up the
     * castle stairs - and none of that is a thing anybody wants to debug for a
     * decoration.
     */
    public void tick() {
        for (Player player : nexus.getServer().getOnlinePlayers()) {
            UUID id = following.get(player.getUniqueId());
            if (id == null) continue;

            Entity pet = nexus.getServer().getEntity(id);

            if (pet == null || !pet.isValid()) {
                following.remove(player.getUniqueId());
                continue;
            }

            // Followed the player through a warp rather than left behind in the
            // world they used to be in.
            if (!pet.getWorld().equals(player.getWorld())) {
                pet.remove();
                following.remove(player.getUniqueId());
                spawn(player);
                continue;
            }

            Location want = behind(player);
            double away = pet.getLocation().distanceSquared(want);

            // Close enough is left alone, so it does not vibrate on the spot.
            if (away < 1.2) continue;

            if (away > 400) {
                pet.teleport(want);
                continue;
            }

            // Glided rather than snapped, which is the difference between a pet
            // and a jittering entity that happens to be nearby.
            Vector step = want.toVector().subtract(pet.getLocation().toVector())
                    .multiply(0.35);

            Location next = pet.getLocation().add(step);
            next.setDirection(player.getLocation().getDirection());
            pet.teleport(next);
        }
    }

    private Location behind(Player player) {
        Location at = player.getLocation();
        Vector back = at.getDirection().setY(0).normalize().multiply(-1.4);

        return at.clone().add(back).add(0.8, 0.2, 0);
    }

    /* --------------------------------------------------------------- tidying */

    public void forget(Player player) {
        despawn(player);
    }

    /**
     * Removes any pet that has outlived its owner's session.
     *
     * Called at startup and when a chunk loads. Tagged entities with nobody
     * following them are the failure this whole class is arranged around: they
     * cost nothing to check for and they accumulate forever if nobody does.
     */
    public int sweep() {
        int removed = 0;

        for (org.bukkit.World world : nexus.getServer().getWorlds()) {
            for (Entity entity : world.getEntities()) {
                if (!entity.getScoreboardTags().contains(TAG)) continue;
                if (following.containsValue(entity.getUniqueId())) continue;

                entity.remove();
                removed++;
            }
        }
        return removed;
    }

    public int out() {
        return following.size();
    }

    public static int kinds() {
        return KINDS.size();
    }
}
