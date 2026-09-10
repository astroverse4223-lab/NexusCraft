package dev.nexuscraft.nexus;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Color;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.entity.ArmorStand;
import org.bukkit.entity.Entity;
import org.bukkit.entity.EntityType;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.LeatherArmorMeta;
import org.bukkit.util.EulerAngle;

/**
 * The people standing in spawn that you right click to go somewhere.
 *
 * This is how a lobby is supposed to work and it is a much better idea than the
 * archways it replaces. A portal you walk into is a trap: you cross it by
 * accident chasing somebody, and you cannot stand next to it to read what it
 * says. Somebody standing there holding a sign is unambiguous — you point at
 * them, you click, you go.
 *
 * Built from an armour stand rather than a real player NPC. Player-skinned NPCs
 * need packet work through NMS or ProtocolLib, which means a dependency and a
 * class that breaks every Minecraft release; an armour stand with a head and
 * dyed clothes reads as a person, is clickable, survives updates, and needs
 * nothing installed. If you want proper skinned NPCs later that is a real
 * upgrade and it is a contained one — only this file changes.
 */
public final class Npc {

    /** Every NPC carries this, so a click can be recognised without a lookup. */
    public static final String TAG = "nexus_npc";

    /** And this, to say where it sends you: "nexus_to_survival". */
    public static final String TO = "nexus_to_";

    /**
     * Or what it opens: "nexus_opens_shop".
     *
     * Two kinds of NPC rather than one with a flag, because they answer
     * different questions. A greeter is a door and a merchant is a counter, and
     * conflating them is how you end up with a shop that teleports you.
     */
    public static final String OPENS = "nexus_opens_";

    private Npc() {
    }

    /**
     * Stands somebody in the world.
     *
     * Marked non-persistent so a restart never leaves two of them in the same
     * spot. They are rebuilt on boot, which is cheaper and more reliable than
     * hunting for the ones that are already there.
     */
    public static ArmorStand place(World world, Location at, String name, String subtitle,
                                   String tag, Color colour, Material head,
                                   Material holding) {

        return world.spawn(at, ArmorStand.class, stand -> {
            stand.setBasePlate(false);
            stand.setArms(true);
            stand.setGravity(false);
            stand.setInvulnerable(true);
            stand.setCanPickupItems(false);
            stand.setPersistent(false);

            // The name floats above the head; the subtitle is on the sign it
            // holds, because two lines of floating text needs a second entity
            // and one is enough clutter.
            stand.customName(label(name, -1));
            stand.setCustomNameVisible(true);

            var gear = stand.getEquipment();
            gear.setHelmet(new ItemStack(head));
            gear.setChestplate(dyed(Material.LEATHER_CHESTPLATE, colour));
            gear.setLeggings(dyed(Material.LEATHER_LEGGINGS, colour));
            gear.setBoots(dyed(Material.LEATHER_BOOTS, colour));
            gear.setItemInMainHand(new ItemStack(holding));

            // A pose, so it does not stand to attention like a mannequin.
            stand.setRightArmPose(new EulerAngle(Math.toRadians(-40), 0, Math.toRadians(10)));
            stand.setLeftArmPose(new EulerAngle(Math.toRadians(-10), 0, Math.toRadians(-8)));
            stand.setHeadPose(new EulerAngle(Math.toRadians(-5), 0, 0));

            stand.addScoreboardTag(TAG);
            stand.addScoreboardTag(tag);
        });
    }

    /**
     * The floating name, with a live count when there is one to show.
     *
     * "0 playing" is deliberately shown rather than hidden. An empty server is
     * empty whether or not it says so, and a count that vanishes when it hits
     * zero is one nobody trusts when it says three.
     */
    public static Component label(String name, int count) {
        Component out = Component.text(name, NamedTextColor.AQUA);

        if (count >= 0) {
            out = out.append(Component.text("  " + count,
                            count > 0 ? NamedTextColor.GREEN : NamedTextColor.DARK_GRAY))
                    .append(Component.text(count == 1 ? " playing" : " playing",
                            NamedTextColor.DARK_GRAY));
        }

        return out.append(Component.text("  ▸ right click", NamedTextColor.DARK_GRAY));
    }

    private static ItemStack dyed(Material material, Color colour) {
        ItemStack piece = new ItemStack(material);
        piece.editMeta(LeatherArmorMeta.class, meta -> meta.setColor(colour));
        return piece;
    }

    /** Where this NPC sends you, or null if it is not a greeter. */
    public static String destinationOf(Entity entity) {
        return taggedWith(entity, TO);
    }

    /** What this NPC opens, or null if it is not a merchant. */
    public static String opensOf(Entity entity) {
        return taggedWith(entity, OPENS);
    }

    private static String taggedWith(Entity entity, String prefix) {
        if (entity.getType() != EntityType.ARMOR_STAND) return null;
        if (!entity.getScoreboardTags().contains(TAG)) return null;

        for (String tag : entity.getScoreboardTags()) {
            if (tag.startsWith(prefix)) return tag.substring(prefix.length());
        }
        return null;
    }

    /** Clears ours out of a world before putting them back. */
    public static void clear(World world) {
        for (Entity entity : world.getEntities()) {
            if (entity.getScoreboardTags().contains(TAG)) entity.remove();
        }
    }
}
