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
import org.bukkit.potion.PotionEffect;
import org.bukkit.potion.PotionEffectType;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Random;
import java.util.Set;
import java.util.UUID;

/**
 * Hide and Seek: a head start, a big room, and somebody counting.
 *
 * The hiders are invisible rather than disguised as blocks. Block disguises
 * need packets sent by hand - either NMS or ProtocolLib - and this plugin
 * deliberately has neither, for the same reason {@link dev.nexuscraft.nexus.Npc}
 * builds its greeters out of armour stands: a dependency that breaks every
 * Minecraft release is a worse thing to own than a slightly different game.
 *
 * So it is played on hearing and inference. Invisibility does not hide the
 * items you hold, the particles you walk through, or the sound of you moving,
 * and the map is built with enough clutter that being still is genuinely a
 * hiding place.
 */
public final class HideAndSeek implements Game {

    /** How long the hiders get before anybody comes looking. */
    static final int HIDE_SECONDS = 30;

    /** And how long the round runs in total. */
    static final int ROUND_SECONDS = 240;

    /** After this much of the round, the hiders start giving themselves away. */
    private static final int HINTS_AFTER = 120;

    /** How often a hint happens once they have started. */
    private static final int HINT_EVERY = 30;

    @Override
    public String id() {
        return "hideandseek";
    }

    @Override
    public String name() {
        return "Hide and Seek";
    }

    @Override
    public String blurb() {
        return "Thirty seconds, then somebody comes looking.";
    }

    @Override
    public Material icon() {
        return Material.GRASS_BLOCK;
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
        return new HideMatch(nexus, this);
    }

    /* ---------------------------------------------------------------- match */

    public static final class HideMatch extends Fighting {

        private static final int RADIUS = 30;

        private final HideAndSeek game;
        private final Random random = new Random();

        private final Set<UUID> seekers = new HashSet<>();

        private boolean released;
        private boolean announced;

        HideMatch(Nexus nexus, HideAndSeek game) {
            super(nexus);
            this.game = game;
        }

        @Override
        public Game game() {
            return game;
        }

        @Override
        protected String sidebarTitle() {
            return "HIDE AND SEEK";
        }

        /**
         * One seeker per five players, and never fewer than one.
         *
         * Scaled rather than fixed because one seeker against eleven hiders is
         * a four-minute walk, and three against three is a scramble.
         */
        @Override
        public void start(Set<UUID> joining) {
            List<UUID> order = new ArrayList<>(joining);
            Collections.shuffle(order, random);

            int howMany = Math.max(1, order.size() / 5);
            for (int i = 0; i < howMany && i < order.size(); i++) seekers.add(order.get(i));

            super.start(joining);

            for (UUID id : joining) {
                Player player = nexus.getServer().getPlayer(id);
                if (player == null) continue;

                if (seekers.contains(id)) {
                    player.sendMessage(Text.bad("You are seeking."));
                    player.sendMessage(Text.plain("  " + HIDE_SECONDS + " seconds, then go."));

                    /*
                     * Blind and rooted, rather than trusted to count.
                     *
                     * A seeker who can see the map during the head start has
                     * watched everybody choose their hiding place, which is
                     * the entire game given away in the first ten seconds.
                     */
                    player.addPotionEffect(new PotionEffect(PotionEffectType.BLINDNESS,
                            HIDE_SECONDS * 20, 1, false, false));
                    player.addPotionEffect(new PotionEffect(PotionEffectType.SLOWNESS,
                            HIDE_SECONDS * 20, 250, false, false));
                    continue;
                }

                player.sendMessage(Text.good("You are hiding."));
                player.sendMessage(Text.plain("  Invisible while you are still. Go."));

                hide(player);
            }

            announce(Text.heading("Hide and Seek"));
            announce(Text.plain("  " + howMany
                    + (howMany == 1 ? " seeker." : " seekers.") + " Four minutes."));
        }

        /** Invisibility, and nothing worn that would give it away. */
        private void hide(Player player) {
            player.getInventory().setHelmet(null);
            player.getInventory().setChestplate(null);
            player.getInventory().setLeggings(null);
            player.getInventory().setBoots(null);

            player.addPotionEffect(new PotionEffect(PotionEffectType.INVISIBILITY,
                    ROUND_SECONDS * 20, 0, false, false));
        }

        @Override
        protected void buildArena() {
            disc(FLOOR, Material.MOSS_BLOCK, RADIUS);

            /*
             * Clutter, and lots of it.
             *
             * Invisibility on an empty floor is not hiding - the seeker sweeps
             * it in one pass and sees the footstep particles. The map has to
             * have enough corners that standing still is a real decision.
             */
            for (int i = 0; i < 40; i++) {
                double angle = random.nextDouble() * Math.PI * 2;
                double away = random.nextDouble() * (RADIUS - 4);

                int x = (int) (Math.cos(angle) * away);
                int z = (int) (Math.sin(angle) * away);
                int high = 2 + random.nextInt(4);

                box(x - 1, FLOOR + 1, z - 1, x + 1, FLOOR + high, z + 1,
                        random.nextBoolean() ? Material.OAK_LEAVES : Material.STONE_BRICKS);
            }

            // A rim, so nobody hides by standing outside the map.
            for (int i = 0; i < 360; i += 2) {
                double angle = Math.toRadians(i);

                int x = (int) (Math.cos(angle) * RADIUS);
                int z = (int) (Math.sin(angle) * RADIUS);

                box(x, FLOOR + 1, z, x, FLOOR + 6, z, Material.BARRIER);
            }
        }

        @Override
        protected List<Location> spawns() {
            return ring(12, RADIUS - 6.0, FLOOR + 1);
        }

        @Override
        protected void equip(Player player) {
            if (!seekers.contains(player.getUniqueId())) return;

            ItemStack stick = new ItemStack(Material.STICK);
            stick.addUnsafeEnchantment(org.bukkit.enchantments.Enchantment.SHARPNESS, 12);
            stick.editMeta(meta -> meta.displayName(Text.item("Tag", NamedTextColor.RED)));

            player.getInventory().setItem(0, stick);
            player.getInventory().setHeldItemSlot(0);
        }

        /* ----------------------------------------------------------- running */

        @Override
        protected void play() {
            if (!released && elapsed >= HIDE_SECONDS) {
                released = true;

                announce(Text.bad("They are coming."));

                for (UUID id : seekers) {
                    Player seeker = nexus.getServer().getPlayer(id);
                    if (seeker == null) continue;

                    seeker.removePotionEffect(PotionEffectType.BLINDNESS);
                    seeker.removePotionEffect(PotionEffectType.SLOWNESS);
                    seeker.playSound(seeker, Sound.ENTITY_ENDER_DRAGON_GROWL, 0.6f, 1.4f);
                }
            }

            if (elapsed < HINTS_AFTER || elapsed % HINT_EVERY != 0) return;

            /*
             * The hiders glow, briefly.
             *
             * Without it a good hider simply wins by standing in a corner for
             * four minutes, which is not a game either side enjoys. Late and
             * short, so hiding still pays for most of the round.
             */
            announce(Text.says("They cannot stay hidden."));

            for (UUID id : alive) {
                if (seekers.contains(id)) continue;

                Player hider = nexus.getServer().getPlayer(id);
                if (hider == null) continue;

                hider.addPotionEffect(new PotionEffect(PotionEffectType.GLOWING,
                        60, 0, false, false));
            }
        }

        @Override
        protected boolean decided() {
            boolean anyHiding = false;
            for (UUID id : alive) {
                if (!seekers.contains(id)) anyHiding = true;
            }

            boolean timeUp = elapsed >= ROUND_SECONDS;

            if (anyHiding && !timeUp) return false;

            if (!announced) {
                announced = true;

                announce(Text.heading(anyHiding
                        ? "The hiders win" : "The seekers win"));

                if (anyHiding) {
                    List<String> left = new ArrayList<>();

                    for (UUID id : alive) {
                        if (seekers.contains(id)) continue;

                        Player hider = nexus.getServer().getPlayer(id);
                        if (hider != null) left.add(hider.getName());
                    }

                    announce(Component.text("  Never found: " + String.join(", ", left),
                            NamedTextColor.GRAY));
                }
            }
            return true;
        }
    }
}
