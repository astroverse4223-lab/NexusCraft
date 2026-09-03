package dev.nexuscraft.hollow.client;

import dev.nexuscraft.hollow.Hollow;
import dev.nexuscraft.hollow.director.Act;
import net.fabricmc.loader.api.FabricLoader;

import java.nio.file.Files;
import java.nio.file.Path;

/**
 * One line on disk: how far this client has seen a world go.
 *
 * Lives in the config directory rather than in a world save, because the whole
 * point is that it outlives the world. Delete a world and start again and the
 * menu still knows — which is the difference between a scary save file and a
 * mod that has got out of the box.
 *
 * Every failure here is swallowed. Not being able to read a text file is never
 * a reason to stop someone reaching their game.
 */
final class ClientMemory {

    private ClientMemory() {}

    private static Path file() {
        return FabricLoader.getInstance().getConfigDir().resolve("hollow-seen.txt");
    }

    /** Whether anything has been written yet, so a no-op save can still land. */
    static boolean exists() {
        try {
            return Files.exists(file());
        } catch (Exception e) {
            return false;
        }
    }

    static Act load() {
        try {
            Path path = file();
            if (!Files.exists(path)) return Act.COMPANION;
            return Act.fromId(Files.readString(path).trim());
        } catch (Exception e) {
            Hollow.LOG.debug("could not read the client memory: {}", e.toString());
            return Act.COMPANION;
        }
    }

    static void save(Act act) {
        try {
            Files.createDirectories(file().getParent());
            Files.writeString(file(), act.id);
        } catch (Exception e) {
            Hollow.LOG.debug("could not write the client memory: {}", e.toString());
        }
    }
}
