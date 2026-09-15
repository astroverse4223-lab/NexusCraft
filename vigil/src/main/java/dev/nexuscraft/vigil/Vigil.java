package dev.nexuscraft.vigil;

import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents;
import net.fabricmc.fabric.api.object.builder.v1.entity.FabricDefaultAttributeRegistry;
import net.minecraft.entity.EntityType;
import net.minecraft.entity.SpawnGroup;
import net.minecraft.registry.Registries;
import net.minecraft.registry.Registry;
import net.minecraft.registry.RegistryKey;
import net.minecraft.registry.RegistryKeys;
import net.minecraft.server.network.ServerPlayerEntity;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.util.Identifier;
import net.minecraft.util.math.BlockPos;
import net.minecraft.util.math.Box;
import net.minecraft.util.math.Vec3d;
import net.minecraft.world.Heightmap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.List;

/**
 * Vigil — something followed you home.
 *
 * The name is the instruction. There is exactly one defence against the thing
 * this mod adds, and it is to stop what you are doing and watch it, which is
 * what keeping vigil means and what it costs.
 *
 * Deliberately a separate jar from Ember. Ember is a companion that fills the
 * dark with a friendly voice; this fills it with something that does not talk
 * at all, and a player should be able to want one without the other.
 */
public class Vigil implements ModInitializer {

    public static final String MOD_ID = "vigil";

    public static final Logger LOG = LoggerFactory.getLogger("Vigil");

    /** Stamped at build time so a running game can be told from a stale one. */
    public static final String BUILD = "0.1.0";

    public static Identifier id(String path) {
        return Identifier.of(MOD_ID, path);
    }

    public static final RegistryKey<EntityType<?>> FOLLOWER_KEY =
            RegistryKey.of(RegistryKeys.ENTITY_TYPE, id("follower"));

    /**
     * Tall and narrow.
     *
     * 2.4 blocks means it does not fit under a two-high ceiling, which sounds
     * like a problem and is the opposite: a corridor it cannot stand up in is a
     * corridor it cannot come down, and the player works that out on their own
     * without ever being told a rule.
     */
    public static final EntityType<FollowerEntity> FOLLOWER = Registry.register(
            Registries.ENTITY_TYPE,
            FOLLOWER_KEY,
            EntityType.Builder.create(FollowerEntity::new, SpawnGroup.MISC)
                    .dimensions(0.6f, 2.4f)
                    .makeFireImmune()
                    .build(FOLLOWER_KEY));

    /** How often the nightfall roll is made, in ticks. Ten seconds. */
    private static final int ROLL_EVERY = 200;

    @Override
    public void onInitialize() {
        LOG.info("Vigil {} loaded", BUILD);

        FabricDefaultAttributeRegistry.register(FOLLOWER, FollowerEntity.createFollowerAttributes());
        VigilCommand.register();

        ServerTickEvents.END_SERVER_TICK.register(server -> {
            if (server.getTicks() % ROLL_EVERY != 0) return;
            if (!VigilConfig.get().hunt) return;

            for (ServerPlayerEntity player : server.getPlayerManager().getPlayerList()) {
                consider(player);
            }
        });
    }

    /**
     * Whether tonight is the night, for one player.
     *
     * Rolled once per in-game day rather than once per check, or a long evening
     * would be twenty separate chances and the odds in the config file would
     * mean nothing. Anyone who already has one following them is skipped, and
     * so is anyone it is currently sulking away from.
     */
    private static void consider(ServerPlayerEntity player) {
        if (!(player.getEntityWorld() instanceof ServerWorld world)) return;
        if (player.isSpectator() || player.isCreative()) return;
        if (!world.isNight()) return;

        long day = world.getTimeOfDay() / 24000L;
        if (Haunting.lastRolled(player.getUuid()) == day) return;
        Haunting.rolled(player.getUuid(), day);

        if (Haunting.dormant(player.getUuid())) return;
        if (alreadyFollowing(world, player)) return;

        if (world.getRandom().nextDouble() > VigilConfig.get().nightlyChance) return;

        if (send(world, player, false)) {
            LOG.info("something set off after {}", player.getGameProfile().name());
        }
    }

    /** Whether one is already out there with this player's name on it. */
    private static boolean alreadyFollowing(ServerWorld world, ServerPlayerEntity player) {
        List<FollowerEntity> existing = world.getEntitiesByClass(
                FollowerEntity.class,
                new Box(player.getBlockPos()).expand(192.0),
                candidate -> player.getUuid().equals(candidate.quarry()));

        return !existing.isEmpty();
    }

    /**
     * Puts one in the world, well out of sight, and points it at somebody.
     *
     * Far enough that the first thing the player ever knows about it is a shape
     * at the edge of their render distance that was not there a minute ago. It
     * is placed rather than spawned by the usual rules on purpose — mob caps,
     * light levels and spawn eggs have nothing to do with this, and letting the
     * spawner decide would mean it turns up in a swarm or not at all.
     *
     * `commanded` is whether a person asked for this one. One that arrives on
     * its own gives up at dawn, which is the rule the night is built around;
     * one somebody typed out is for testing or for running an event, and having
     * it evaporate the moment it steps into the sun makes it untestable in
     * exactly the conditions you want to look at it in.
     */
    public static boolean send(ServerWorld world, ServerPlayerEntity player, boolean commanded) {
        Vec3d where = somewhereOutThere(world, player);
        if (where == null) return false;

        FollowerEntity follower = FOLLOWER.create(world, net.minecraft.entity.SpawnReason.EVENT);
        if (follower == null) return false;

        follower.setQuarry(player.getUuid());
        follower.setCommanded(commanded);
        follower.refreshPositionAndAngles(where.x, where.y, where.z, 0.0f, 0.0f);
        world.spawnEntity(follower);
        return true;
    }

    /**
     * A place to start from: far off, on the ground, and not in view.
     *
     * The not-in-view part matters more than the distance. Appearing inside
     * somebody's screen is a magic trick and reads as a spawn; appearing behind
     * them reads as having been there for a while.
     */
    private static Vec3d somewhereOutThere(ServerWorld world, ServerPlayerEntity player) {
        for (int attempt = 0; attempt < 24; attempt++) {
            double angle = world.getRandom().nextDouble() * Math.PI * 2.0;
            double away = 44.0 + world.getRandom().nextDouble() * 20.0;

            double x = player.getX() + Math.cos(angle) * away;
            double z = player.getZ() + Math.sin(angle) * away;

            int surface = world.getTopY(Heightmap.Type.MOTION_BLOCKING_NO_LEAVES,
                    (int) Math.floor(x), (int) Math.floor(z));

            Vec3d at = new Vec3d(x, surface, z);

            BlockPos below = BlockPos.ofFloored(x, surface - 0.5, z);
            if (!world.getBlockState(below).isSolidBlock(world, below)) continue;
            if (!world.isSpaceEmpty(FOLLOWER.getDimensions().getBoxAt(at))) continue;
            if (Observation.inView(player.getEyePos(), player.getYaw(), player.getPitch(),
                    at.add(0.0, 1.2, 0.0))) continue;

            return at;
        }
        return null;
    }
}
