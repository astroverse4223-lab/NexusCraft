package dev.nexuscraft.hollow.client;

import dev.nexuscraft.hollow.Hollow;
import dev.nexuscraft.hollow.entity.HunterEntity;
import dev.nexuscraft.hollow.entity.MaskEntity;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gl.RenderPipelines;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.render.Camera;
import net.minecraft.entity.Entity;
import net.minecraft.util.Identifier;
import net.minecraft.util.hit.HitResult;
import net.minecraft.util.math.Box;
import net.minecraft.util.math.Vec3d;
import net.minecraft.world.RaycastContext;

import java.util.ArrayList;
import java.util.List;

/**
 * His eyes, drawn over the dark rather than under it.
 *
 * {@link NightFall} makes the night black by painting a rectangle over the
 * screen, and a rectangle over the screen dims everything beneath it — grass,
 * stone, and the one thing the whole mod exists to show you. At the darkness
 * the game actually wants, nothing survives: pure white is crushed to a grey so
 * near black you cannot tell it from the night.
 *
 * The two requirements are genuinely in tension and no amount of tuning
 * resolves them. So the eyes are simply drawn again, afterwards, on top: his
 * position is projected into screen space and a soft glow is put where his face
 * is. The world goes as black as you like and he burns through it.
 *
 * This is a trick, and worth being honest about. The proper fix is to darken
 * the *lightmap*, which leaves anything drawn fullbright alone by definition —
 * but in this version the lightmap is built on the GPU from a uniform buffer,
 * and reaching into it means guessing an injection point in code that is
 * rewritten every release. This needs no mixin and cannot break on an update.
 */
public final class EyeShine {

    private static final Identifier SHINE = Hollow.id("textures/gui/eyeshine.png");

    /** Beyond this the glow is too small to be worth the raycast. */
    private static final double RANGE = 64.0;

    /*
     * Where the eyes are, in model pixels above each model's own head pivot.
     *
     * This was one number for both of them, as a fraction of entity height,
     * and it could not have been right for either: MaskModel hangs its head
     * straight off the root, and HunterModel offsets its head another six
     * pixels up. Their eyes sit at different places on their bodies, so they
     * get different numbers.
     *
     *   mask     head pivot 0,  eyes 5 above it     ->   5
     *   hunter   head pivot 6,  eyes 5 above that   ->  11
     */
    private static final double MASK_EYES = 5.0;
    private static final double HUNTER_EYES = 11.0;

    /**
     * Model space to world, which is not a guess but the transform the entity
     * renderer itself applies: the model is flipped and dropped 1.501 blocks,
     * and there are sixteen model pixels to a block.
     *
     * Deriving the eyes through the same arithmetic the renderer uses is the
     * only thing that keeps them together. The previous number was a fraction
     * of entity height tuned against a screenshot, and it put the glow down at
     * his mouth.
     */
    private static final double MODEL_DROP = 1.501;
    private static final double PER_PIXEL = 1.0 / 16.0;

    /** Half the gap between them: each eye sits 2 pixels off the centre line. */
    private static final double EYE_OFF = 2.0;

    /** One eye cube, in model pixels. Wider than tall, as eyes are. */
    private static final double EYE_WIDE = 2.0;
    private static final double EYE_TALL = 1.0;

    /**
     * How far the light spreads past the eye itself.
     *
     * A light source is always bigger than its filament — without this the
     * glow is a two-pixel dot that reads as a dead pixel rather than as
     * something burning.
     *
     * Kept low deliberately. His head is half a block across and his eyes an
     * eighth, so anything past about 1.8 makes each glow wider than the gap
     * between them and the pair merge back into the single orb this was
     * written to get rid of.
     */
    private static final double BLOOM = 1.6;

    /** Never smaller than this, so a pair across a field is still a pair. */
    private static final double LEAST = 3.0;

    private EyeShine() {
    }

    /**
     * Drawn straight after the darkness, in the same HUD layer.
     *
     * Only while the darkness is actually showing — in daylight, or in a lit
     * room, his eyes are already visible on the model itself and a second glow
     * on top would be two of him.
     */
    public static void draw(DrawContext context, float darkness) {
        if (darkness < 0.05f) return;

        MinecraftClient client = MinecraftClient.getInstance();
        if (client.world == null || client.player == null) return;

        Camera camera = client.gameRenderer.getCamera();
        Vec3d eye = camera.getCameraPos();

        for (Lit lit : nearby(client)) {
            if (lit.at.squaredDistanceTo(eye) > RANGE * RANGE) continue;
            if (blocked(client, eye, lit.at)) continue;

            /*
             * Nothing shows through the back of his head.
             *
             * Without this the glow sits on him from every angle, so turning
             * around and finding two eyes burning out of the back of his skull
             * was possible — which is a different and much sillier effect than
             * the one wanted.
             */
            Vec3d facing = lit.facing;
            if (eye.subtract(lit.at).normalize().dotProduct(facing) < 0.15) continue;

            /*
             * Two of them, set apart across his face.
             *
             * Left and right in his own frame, not the camera's, so they close
             * together as he turns away and are at their widest looking
             * straight at you — which is the whole of why it reads as a face
             * rather than as a light.
             */
            Vec3d across = new Vec3d(-facing.z, 0.0, facing.x).normalize()
                    .multiply(EYE_OFF * PER_PIXEL * lit.scale);

            /*
             * Two of them near to, one of them far off.
             *
             * Past a certain distance the pair lands closer together on screen
             * than the glows are wide, and drawing both just paints the same
             * pixels twice. That is also what a distant pair of lights really
             * looks like - they merge into one point long before they fade -
             * so beyond that range it becomes a single point, which stays
             * visible across a field without ever being an orb in his face up
             * close.
             */
            if (apartOnScreen(client, camera, eye, lit, across) < 3.0) {
                drawOne(context, client, camera, eye, lit, lit.at, darkness);
            } else {
                drawOne(context, client, camera, eye, lit, lit.at.add(across), darkness);
                drawOne(context, client, camera, eye, lit, lit.at.subtract(across), darkness);
            }
        }
    }

    /** Everything of ours with something burning in its face. */
    private static List<Lit> nearby(MinecraftClient client) {
        List<Lit> found = new ArrayList<>();
        Box around = client.player.getBoundingBox().expand(RANGE);

        for (MaskEntity mask : client.world.getEntitiesByClass(MaskEntity.class, around, any -> true)) {
            // Nothing is lit on a blank face; that is what blank means.
            if (mask.expression() == dev.nexuscraft.hollow.entity.Expression.BLANK) continue;
            found.add(lit(mask, MASK_EYES, mask.eyeColour()));
        }

        for (HunterEntity hunter : client.world.getEntitiesByClass(HunterEntity.class, around, any -> true)) {
            found.add(lit(hunter, HUNTER_EYES, hunter.eyeColour()));
        }

        return found;
    }

    /**
     * One lit face: where it is, which way it looks, and how big it is.
     *
     * The direction is the *head's* yaw rather than the body's. He watches you
     * over his shoulder, and taking the body would put his eyes wherever his
     * feet happened to be pointing.
     */
    private static Lit lit(net.minecraft.entity.LivingEntity entity,
                           double eyePixels, int colour) {
        double yaw = Math.toRadians(entity.getHeadYaw());
        Vec3d facing = new Vec3d(-Math.sin(yaw), 0.0, Math.cos(yaw));

        // Everything on the model grows with the SCALE attribute, so the eyes
        // move up and apart exactly as far as the head they are set into does.
        double scale = entity.getScale();
        double up = (MODEL_DROP + eyePixels * PER_PIXEL) * scale;

        return new Lit(entity.getEntityPos().add(0.0, up, 0.0), facing, scale, colour);
    }

    /** Whether the world is in the way. */
    private static boolean blocked(MinecraftClient client, Vec3d from, Vec3d to) {
        return client.world.raycast(new RaycastContext(
                from, to,
                RaycastContext.ShapeType.COLLIDER,
                RaycastContext.FluidHandling.NONE,
                client.player)).getType() != HitResult.Type.MISS;
    }

    /**
     * Puts one glow where the face is on screen.
     *
     * The projection is done by hand because nothing public hands it over. The
     * camera gives a position and two angles; the rest is a basis and a
     * perspective divide, which is the same arithmetic the renderer is doing a
     * few microseconds earlier for the entity itself.
     */
    private static void drawOne(DrawContext context, MinecraftClient client,
                                Camera camera, Vec3d eye, Lit lit, Vec3d at,
                                float darkness) {

        double yaw = Math.toRadians(camera.getYaw());
        double pitch = Math.toRadians(camera.getPitch());

        double cosPitch = Math.cos(pitch);
        Vec3d forward = new Vec3d(-Math.sin(yaw) * cosPitch, -Math.sin(pitch), Math.cos(yaw) * cosPitch);
        Vec3d right = new Vec3d(-Math.cos(yaw), 0.0, -Math.sin(yaw));
        Vec3d up = right.crossProduct(forward);

        Vec3d delta = at.subtract(eye);

        double depth = delta.dotProduct(forward);
        // Behind the camera, or so close the divide explodes.
        if (depth < 0.1) return;

        double across = delta.dotProduct(right);
        double above = delta.dotProduct(up);

        int width = context.getScaledWindowWidth();
        int height = context.getScaledWindowHeight();

        double fov = Math.toRadians(client.options.getFov().getValue());
        double half = Math.tan(fov / 2.0);
        double aspect = (double) width / Math.max(1, height);

        double x = (width / 2.0) * (1.0 + (across / depth) / (half * aspect));
        double y = (height / 2.0) * (1.0 - (above / depth) / half);

        // Off screen, with a margin so it does not pop at the edges.
        if (x < -200 || y < -200 || x > width + 200 || y > height + 200) return;

        /*
         * The size an eye of that width would actually be on screen, which is
         * the ordinary perspective projection rather than a tuned number.
         *
         * It was tuned before, and to a single blob at the middle of his head —
         * which is why it came out as an orb sitting in his face instead of as
         * anything you would call an eye. Wider than tall, because his are.
         */
        double perBlock = (height / 2.0) / half / depth;
        double wide = Math.max(LEAST, EYE_WIDE * PER_PIXEL * lit.scale * BLOOM * perBlock);
        double tall = Math.max(LEAST, EYE_TALL * PER_PIXEL * lit.scale * BLOOM * perBlock);

        /*
         * And it fades with the dark, so it appears as the night closes in
         * rather than being pasted over a lit evening.
         */
        int alpha = (int) (Math.min(1.0f, darkness) * 235.0f);
        int tint = (alpha << 24) | (COLOURS[Math.floorMod(lit.colour, COLOURS.length)] & 0x00FFFFFF);

        context.drawTexture(RenderPipelines.GUI_TEXTURED, SHINE,
                (int) Math.round(x - wide / 2.0), (int) Math.round(y - tall / 2.0),
                0.0f, 0.0f, (int) Math.round(wide), (int) Math.round(tall), 32, 32, tint);
    }

    /**
     * The same eight colours tools/paint.py paints, as tints.
     *
     * Kept in step by hand, which is a loose end — but the glow sprite is one
     * white blob rather than eight files, and eight near-identical PNGs to hold
     * a number that fits in an int is the worse trade.
     */
    private static final int[] COLOURS = {
            0xFFBA40, // amber
            0xE2EAFF, // white
            0xFF2618, // red
            0x38FF42, // green
            0x28E8FF, // cyan
            0xB04AFF, // violet
            0xFF3EA8, // pink
            0xFFBE14, // gold
    };

    /** How far apart the pair lands on screen, in scaled pixels. */
    private static double apartOnScreen(MinecraftClient client, Camera camera,
                                        Vec3d eye, Lit lit, Vec3d across) {
        double depth = lit.at.subtract(eye).dotProduct(forwardOf(camera));
        if (depth < 0.1) return 0.0;

        double fov = Math.toRadians(client.options.getFov().getValue());
        double perBlock = (client.getWindow().getScaledHeight() / 2.0)
                / Math.tan(fov / 2.0) / depth;

        // Foreshortened as he turns: the pair is at its widest facing you.
        return Math.abs(across.dotProduct(rightOf(camera))) * 2.0 * perBlock;
    }

    private static Vec3d forwardOf(Camera camera) {
        double yaw = Math.toRadians(camera.getYaw());
        double pitch = Math.toRadians(camera.getPitch());
        double cosPitch = Math.cos(pitch);
        return new Vec3d(-Math.sin(yaw) * cosPitch, -Math.sin(pitch), Math.cos(yaw) * cosPitch);
    }

    private static Vec3d rightOf(Camera camera) {
        double yaw = Math.toRadians(camera.getYaw());
        return new Vec3d(-Math.cos(yaw), 0.0, -Math.sin(yaw));
    }

    /** One lit face: where it is, which way it faces, its scale, its colour. */
    private record Lit(Vec3d at, Vec3d facing, double scale, int colour) {
    }
}
