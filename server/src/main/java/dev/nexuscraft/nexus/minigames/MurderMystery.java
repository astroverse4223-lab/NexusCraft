package dev.nexuscraft.nexus.minigames;

import dev.nexuscraft.nexus.Game;
import dev.nexuscraft.nexus.Match;
import dev.nexuscraft.nexus.Nexus;
import dev.nexuscraft.nexus.Text;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.Sound;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.Set;
import java.util.UUID;

/**
 * Murder Mystery: one of you has a knife and nobody knows who.
 *
 * The only game here that is won by watching people rather than by aiming at
 * them. The murderer's problem is that killing is loud; everybody else's is
 * that the only way to be sure is to be wrong once.
 *
 * Roles are told privately and never shown again - no nameplate, no team
 * colour, no sidebar entry that lists who is what. The whole game is that
 * information being absent, so every convenience that would leak it is left
 * out on purpose.
 */
public final class MurderMystery implements Game {

    /** How much gold an innocent needs before they are handed a bow. */
    static final int GOLD_FOR_BOW = 8;

    /** How often another ingot appears somewhere in the map, in seconds. */
    private static final int GOLD_EVERY = 8;

    @Override
    public String id() {
        return "murder";
    }

    @Override
    public String name() {
        return "Murder Mystery";
    }

    @Override
    public String blurb() {
        return "One knife, one bow, and no idea who has them.";
    }

    @Override
    public Material icon() {
        return Material.IRON_SWORD;
    }

    @Override
    public int minPlayers() {
        return 3;
    }

    @Override
    public int maxPlayers() {
        return 12;
    }

    @Override
    public Match newMatch(Nexus nexus) {
        return new MurderMatch(nexus, this);
    }

    /* ---------------------------------------------------------------- match */

    public static final class MurderMatch extends Fighting {

        private static final int RADIUS = 26;

        private enum Role { MURDERER, DETECTIVE, INNOCENT }

        private final MurderMystery game;
        private final Random random = new Random();

        private final Map<UUID, Role> roles = new HashMap<>();

        private boolean announced;

        MurderMatch(Nexus nexus, MurderMystery game) {
            super(nexus);
            this.game = game;
        }

        @Override
        public Game game() {
            return game;
        }

        @Override
        protected String sidebarTitle() {
            return "MURDER MYSTERY";
        }

        /**
         * Roles first, because equipping depends on them.
         *
         * {@link Fighting#start} hands everybody their kit on the way in, so
         * anything that decides what the kit is has to have happened already.
         */
        @Override
        public void start(Set<UUID> joining) {
            List<UUID> order = new ArrayList<>(joining);
            Collections.shuffle(order, random);

            for (int i = 0; i < order.size(); i++) {
                roles.put(order.get(i), switch (i) {
                    case 0 -> Role.MURDERER;
                    case 1 -> Role.DETECTIVE;
                    default -> Role.INNOCENT;
                });
            }

            super.start(joining);

            for (UUID id : joining) {
                Player player = nexus.getServer().getPlayer(id);
                if (player == null) continue;

                switch (roles.get(id)) {
                    case MURDERER -> {
                        player.sendMessage(Text.bad("You are the murderer."));
                        player.sendMessage(Text.plain("  Kill them all. Do not be seen."));
                    }
                    case DETECTIVE -> {
                        player.sendMessage(Text.good("You have the bow."));
                        player.sendMessage(Text.plain("  Find the murderer. Do not shoot a friend."));
                    }
                    default -> {
                        player.sendMessage(Text.says("You are innocent."));
                        player.sendMessage(Text.plain("  Collect " + GOLD_FOR_BOW
                                + " gold for a bow. Stay alive."));
                    }
                }
            }

            announce(Text.heading("Murder Mystery"));
            announce(Text.plain("  One of you has a knife. One of you has a bow."));
        }

        @Override
        protected void buildArena() {
            disc(FLOOR, Material.POLISHED_ANDESITE, RADIUS);

            /*
             * Walls and corners, rather than the open disc the others use.
             *
             * Every other game here wants clean sight lines. This one wants
             * the opposite: the murderer needs somewhere to be alone with
             * somebody, and an open floor means the first swing is seen by
             * everyone and the game is over in twenty seconds.
             */
            for (int i = 0; i < 14; i++) {
                double angle = 2 * Math.PI * i / 14;

                int x = (int) (Math.cos(angle) * (RADIUS - 9));
                int z = (int) (Math.sin(angle) * (RADIUS - 9));

                box(x - 2, FLOOR + 1, z - 2, x + 2, FLOOR + 4, z + 2,
                        i % 2 == 0 ? Material.STONE_BRICKS : Material.DARK_OAK_PLANKS);

                // Hollowed, so they are rooms to be caught in rather than
                // pillars to be seen around.
                box(x - 1, FLOOR + 1, z - 1, x + 1, FLOOR + 3, z + 1, Material.AIR);
            }

            // A lit middle, so there is one place that is obviously unsafe.
            disc(FLOOR + 1, Material.SEA_LANTERN, 3);
        }

        @Override
        protected List<Location> spawns() {
            return ring(12, RADIUS - 4.0, FLOOR + 1);
        }

        @Override
        protected void equip(Player player) {
            var kit = player.getInventory();
            Role role = roles.getOrDefault(player.getUniqueId(), Role.INNOCENT);

            switch (role) {
                case MURDERER -> {
                    /*
                     * A knife that kills in one hit, named like a normal item.
                     *
                     * Sharpness rather than special-cased damage, for the same
                     * reason One in the Chamber does it: it applies to exactly
                     * the swing that should kill and leaves falls and stray
                     * arrows behaving normally.
                     */
                    ItemStack knife = new ItemStack(Material.IRON_SWORD);
                    knife.addUnsafeEnchantment(
                            org.bukkit.enchantments.Enchantment.SHARPNESS, 12);
                    knife.editMeta(meta -> meta.displayName(
                            Text.item("Knife", NamedTextColor.RED)));

                    kit.setItem(0, knife);
                }

                case DETECTIVE -> {
                    kit.setItem(0, new ItemStack(Material.BOW));
                    kit.setItem(8, new ItemStack(Material.ARROW, 1));
                }

                default -> kit.setItem(0, new ItemStack(Material.WOODEN_HOE));
            }

            kit.setHeldItemSlot(0);
        }

        /* ----------------------------------------------------------- running */

        @Override
        protected void play() {
            if (elapsed % GOLD_EVERY == 0) dropGold();

            for (UUID id : new ArrayList<>(alive)) {
                if (roles.get(id) != Role.INNOCENT) continue;

                Player player = nexus.getServer().getPlayer(id);
                if (player == null) continue;

                if (!player.getInventory().contains(Material.GOLD_INGOT, GOLD_FOR_BOW)) continue;

                player.getInventory().removeItem(
                        new ItemStack(Material.GOLD_INGOT, GOLD_FOR_BOW));

                player.getInventory().addItem(new ItemStack(Material.BOW));
                player.getInventory().addItem(new ItemStack(Material.ARROW, 1));

                player.sendMessage(Text.good("A bow. One arrow. Be sure."));
                player.playSound(player, Sound.ENTITY_PLAYER_LEVELUP, 0.8f, 1.4f);
            }
        }

        /** One ingot, somewhere on the floor. */
        private void dropGold() {
            double angle = random.nextDouble() * Math.PI * 2;
            double away = random.nextDouble() * (RADIUS - 4);

            Location where = new Location(world,
                    Math.cos(angle) * away, FLOOR + 1.5, Math.sin(angle) * away);

            world.dropItem(where, new ItemStack(Material.GOLD_INGOT));
        }

        /**
         * Shooting an innocent costs the shooter the game.
         *
         * The rule that makes a bow frightening to hold. Without it the right
         * play is to shoot everybody you meet and apologise afterwards.
         */
        @Override
        protected void scored(Player killer, Player victim) {
            Role theirs = roles.getOrDefault(killer.getUniqueId(), Role.INNOCENT);
            Role hit = roles.getOrDefault(victim.getUniqueId(), Role.INNOCENT);

            if (theirs == Role.MURDERER) {
                killer.sendMessage(Text.good("Quietly done."));
                return;
            }

            if (hit == Role.MURDERER) {
                announce(Component.text(killer.getName(), NamedTextColor.GOLD)
                        .append(Component.text(" shot the murderer.", NamedTextColor.GRAY)));
                return;
            }

            // An innocent shot an innocent: the bow is taken away.
            killer.getInventory().remove(Material.BOW);
            killer.getInventory().remove(Material.ARROW);

            killer.sendMessage(Text.bad("That was not the murderer."));
            announce(Text.says("Somebody shot the wrong person."));
        }

        @Override
        protected boolean decided() {
            boolean murdererAlive = false;
            boolean anyoneElseAlive = false;

            for (UUID id : alive) {
                if (roles.get(id) == Role.MURDERER) murdererAlive = true;
                else anyoneElseAlive = true;
            }

            if (murdererAlive && anyoneElseAlive) return false;

            if (!announced) {
                announced = true;

                announce(Text.heading(murdererAlive
                        ? "The murderer wins" : "The innocents win"));
            }
            return true;
        }
    }
}
