package dev.nexuscraft.hollow.entity;

import dev.nexuscraft.hollow.director.Act;
import net.minecraft.component.DataComponentTypes;
import net.minecraft.component.type.NbtComponent;
import net.minecraft.entity.ItemEntity;
import net.minecraft.entity.player.PlayerInventory;
import net.minecraft.item.ItemStack;
import net.minecraft.item.Items;
import net.minecraft.nbt.NbtCompound;
import net.minecraft.screen.ScreenHandler;
import net.minecraft.screen.slot.Slot;
import net.minecraft.server.network.ServerPlayerEntity;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.sound.SoundCategory;
import net.minecraft.sound.SoundEvents;
import net.minecraft.text.Text;
import net.minecraft.util.math.Vec3d;

import java.util.random.RandomGenerator;

/**
 * The body: a ball that rolls around on the floor and can be picked up.
 *
 * The face on its own was not the thing. A floating name tag cannot be held,
 * thrown, dropped down a ravine or pushed into lava, and being able to do all of
 * that to something that talks back is most of what makes it a character rather
 * than a chat window — you find out what it is by mistreating it, which is a
 * thing players will do to anything they are allowed to pick up.
 *
 * It is an item entity, which sounds like a cheat and is actually the whole
 * design. An item entity already has gravity, already bounces and rolls and
 * slides down slopes, already survives chunk unloads, already goes into your
 * inventory when you walk over it, and is already thrown forwards when you drop
 * it. Every single behaviour asked for here is one the game does for free; a
 * custom entity would mean writing all of it again, worse, and a model and a
 * texture on top.
 *
 * The face is a separate armour stand that follows the ball around. Keeping them
 * apart means the face survives the ball being in a chest, and the ball survives
 * the face being invisible.
 */
public final class Ball {

    private Ball() {}

    /**
     * What it looks like: a pale round thing that already exists in the game.
     *
     * Heart of the Sea, because it is one of the few vanilla items rendered as a
     * rounded shape rather than a flat sprite of a tool, and because nobody has
     * a stack of them lying around to be confused with this one.
     */
    private static final net.minecraft.item.Item ITEM = Items.HEART_OF_THE_SEA;

    /**
     * The tag that makes one of these actually him.
     *
     * On the item's custom data rather than its name, because a name can be
     * typed into an anvil. Without this, anyone could rename a Heart of the Sea
     * and have a second companion, and the first thing that happens then is
     * somebody has two and neither behaves.
     */
    private static final NbtCompound MARKER = markerNbt();

    private static NbtCompound markerNbt() {
        NbtCompound nbt = new NbtCompound();
        nbt.putBoolean("hollow", true);
        return nbt;
    }

    /**
     * How far it may drift before it starts rolling after the player.
     *
     * The arc, expressed as a distance. Early on it is underfoot and faintly
     * annoying, which is what a pet is. By the last act it hangs back at the
     * edge of what you can see and only closes the gap when you have almost
     * left it behind — the same behaviour, and it reads as something following
     * you rather than something keeping you company.
     */
    private static double leash(Act act) {
        return switch (act) {
            case COMPANION -> 3.0;
            case UNEASE -> 4.5;
            case WATCHING -> 8.0;
            case HOLLOW -> 12.0;
        };
    }

    /**
     * The last ball seen for each player, so the world is not searched every
     * tick. A dropped ball is a brand new entity, so a miss here is normal and
     * simply costs one scan.
     */
    private static final java.util.Map<java.util.UUID, java.util.UUID> BY_PLAYER = new java.util.HashMap<>();

    public static ItemStack stack() {
        ItemStack stack = new ItemStack(ITEM);
        stack.set(DataComponentTypes.CUSTOM_DATA, NbtComponent.of(MARKER));
        // Named so it is obvious in a hotbar what the odd item is, and so it
        // does not stack with an ordinary Heart of the Sea.
        stack.set(DataComponentTypes.CUSTOM_NAME, Text.literal("Hollow"));
        return stack;
    }

    public static boolean isHollow(ItemStack stack) {
        if (stack == null || stack.isEmpty() || !stack.isOf(ITEM)) return false;
        return stack.getOrDefault(DataComponentTypes.CUSTOM_DATA, NbtComponent.DEFAULT).matches(MARKER);
    }

    /**
     * Puts a ball into the world, with a shove.
     *
     * The velocity is what makes throwing work: the same call is used when it is
     * first let out of the box and when the player hurls it off a cliff, and the
     * only difference is how hard.
     */
    public static ItemEntity spawn(ServerWorld world, Vec3d at, Vec3d velocity) {
        ItemEntity ball = new ItemEntity(world, at.x, at.y, at.z, stack());
        settle(ball);
        ball.setVelocity(velocity);
        world.spawnEntity(ball);
        return ball;
    }

    /**
     * The rules that have to hold for every ball, however it got here.
     *
     * Applied on spawn and again every time one is found, because the player
     * creates them too — dropping him out of the inventory produces a perfectly
     * ordinary item entity that will despawn in five minutes and burn in lava
     * unless something says otherwise.
     */
    private static void settle(ItemEntity ball) {
        ball.setNeverDespawn();
        ball.setInvulnerable(true);
        // Never picked up by walking past. Being unable to put him down without
        // immediately collecting him again would make throwing him impossible,
        // so collection is deliberate and happens in `tryPickUp`.
        ball.setPickupDelayInfinite();
    }

    /**
     * The ball near this player, adopting one they have just thrown.
     *
     * Searched for rather than remembered. A remembered reference is wrong the
     * moment the player drops him, because that is a brand new entity the game
     * made without asking — and that is the normal way he gets put down.
     */
    public static ItemEntity find(ServerWorld world, ServerPlayerEntity player) {
        java.util.UUID remembered = BY_PLAYER.get(player.getUuid());
        if (remembered != null && world.getEntity(remembered) instanceof ItemEntity known && known.isAlive()) {
            return known;
        }

        ItemEntity found = null;
        for (ItemEntity candidate : world.getEntitiesByClass(ItemEntity.class,
                player.getBoundingBox().expand(32), entity -> isHollow(entity.getStack()))) {
            if (found == null && candidate.isAlive()) {
                settle(candidate);
                found = candidate;
            } else {
                candidate.discard();
            }
        }
        if (found != null) BY_PLAYER.put(player.getUuid(), found.getUuid());
        return found;
    }

    public static void forget(java.util.UUID player) {
        BY_PLAYER.remove(player);
    }

    /** The inventory slot he is being carried in, or -1. */
    public static int carriedSlot(ServerPlayerEntity player) {
        PlayerInventory inventory = player.getInventory();
        for (int slot = 0; slot < inventory.size(); slot++) {
            if (isHollow(inventory.getStack(slot))) return slot;
        }
        return -1;
    }

    /**
     * Picking him up: crouch, and walk into him.
     *
     * Not plain collision, which would snatch him off the floor the instant he
     * was dropped, and not a right-click, which the game does not offer on item
     * entities at all — they cannot be aimed at. Crouching is the one input that
     * is deliberate, always available, and already means "be careful with this"
     * everywhere else in the game.
     */
    public static boolean tryPickUp(ServerWorld world, ServerPlayerEntity player, ItemEntity ball) {
        if (!player.isSneaking()) return false;
        if (ball.getEntityPos().squaredDistanceTo(player.getEntityPos()) > 2.5 * 2.5) return false;
        if (!player.getInventory().insertStack(stack())) return false;

        ball.discard();
        world.playSound(null, player.getBlockPos(), SoundEvents.ENTITY_ITEM_PICKUP,
                SoundCategory.PLAYERS, 0.4f, 1.6f);
        return true;
    }

    /**
     * Rolling after the player when it has been left behind.
     *
     * A nudge to the velocity rather than a position, so the game keeps doing
     * the physics and he goes round things, bumps down stairs and falls into the
     * holes you left. It is deliberately not enough force to climb a wall: a
     * companion that cannot follow you up a ladder is one you have to remember
     * to pick up, and remembering him is the point of being able to carry him.
     */
    public static void roll(ItemEntity ball, ServerPlayerEntity player, Act act) {
        Vec3d toPlayer = player.getEntityPos().subtract(ball.getEntityPos());
        double distance = toPlayer.horizontalLength();
        if (distance < leash(act)) return;

        Vec3d push = new Vec3d(toPlayer.x, 0, toPlayer.z).normalize().multiply(0.08);
        ball.setVelocity(ball.getVelocity().add(push));
        ball.velocityDirty = true;
    }

    /**
     * On fire, and unable to do anything about it.
     *
     * He cannot be destroyed — the entity is invulnerable, and lava is the first
     * thing anybody tries. So the fire does nothing except to him, out loud,
     * which is both funnier and worse than losing him would have been.
     */
    public static boolean isBurning(ItemEntity ball) {
        return ball.isInLava() || ball.isOnFire();
    }

    private static final String[] BURNING_EARLY = {
            "I'm on fire. I'm on fire, why am I on fire",
            "That's lava. You know that's lava.",
            "Ow. Ow. This isn't funny, get me out",
            "It doesn't kill me. It just hurts. Constantly.",
            "Please. Please. I've been good.",
    };

    private static final String[] BURNING_LATE = {
            "You know I can't die in here.",
            "I'll wait. I've done this before.",
            "Go on then. I'll still be here when you come back.",
            "This changes nothing.",
    };

    public static String burningLine(Act act, RandomGenerator random) {
        String[] lines = act.atLeast(Act.WATCHING) ? BURNING_LATE : BURNING_EARLY;
        return lines[random.nextInt(lines.length)];
    }

    /**
     * He will not be left in a chest.
     *
     * Partly character — being shut in a box is the thing he was screaming
     * about when you found him, and letting the player do it back without a
     * word wastes the one piece of history he has. Mostly, though, it is the
     * only way to keep track of him: an item sitting in a chest is invisible to
     * everything here, so the world would decide he was lost and make another,
     * and then there would be two.
     *
     * Checked while the container is open, which is the moment the stack moves,
     * so it never has to search the world for chests.
     */
    public static boolean escapeContainer(ServerPlayerEntity player) {
        ScreenHandler handler = player.currentScreenHandler;
        if (handler == null || handler == player.playerScreenHandler) return false;

        boolean escaped = false;
        for (Slot slot : handler.slots) {
            // The player's own inventory is shown inside the container screen
            // too; those slots are him being carried, which is allowed.
            if (slot.inventory == player.getInventory()) continue;
            if (!isHollow(slot.getStack())) continue;

            slot.setStack(ItemStack.EMPTY);
            if (!player.getInventory().insertStack(stack())) {
                spawn((ServerWorld) player.getEntityWorld(),
                        player.getEntityPos().add(0, 0.6, 0), Vec3d.ZERO);
            }
            escaped = true;
        }
        if (escaped) handler.sendContentUpdates();
        return escaped;
    }

    private static final String[] NOT_IN_THERE = {
            "No. Not in there. Anywhere but in there.",
            "I've done my time in a box, thanks.",
            "Don't. Please don't shut me in.",
            "You know where you found me.",
    };

    public static String containerLine(Act act, RandomGenerator random) {
        if (act.atLeast(Act.WATCHING)) return "You can't put me anywhere. You know that by now.";
        return NOT_IN_THERE[random.nextInt(NOT_IN_THERE.length)];
    }

    /** Where the face should sit for a ball on the floor: just above it. */
    public static Vec3d facePlace(ItemEntity ball) {
        return ball.getEntityPos().add(0, 0.55, 0);
    }
}
