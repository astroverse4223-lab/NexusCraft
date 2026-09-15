package dev.nexuscraft.nexus;

import net.kyori.adventure.resource.ResourcePackInfo;
import net.kyori.adventure.resource.ResourcePackRequest;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.entity.Player;

import java.io.InputStream;
import java.net.URI;
import java.security.MessageDigest;
import java.util.UUID;

/**
 * The "would you like to use this server's resource pack?" prompt.
 *
 * A server cannot install anything on a player's machine, but it can offer one
 * pack and the client will download it for the session. That is how every
 * server with custom items, custom fonts or a themed menu does it, and it is
 * the only visual thing a server actually controls.
 *
 * The fiddly part is the hash. Minecraft caches a pack by its SHA-1, and if the
 * hash you send does not match the file, the client re-downloads it on every
 * single join — which looks like the pack simply not working and is the most
 * common way this is set up wrong. So the hash is not asked for: the file is
 * fetched once at startup and hashed here, which cannot disagree with itself.
 */
public final class Packs {

    private final Nexus nexus;

    private volatile String url;
    private volatile String sha1;
    private volatile boolean required;
    private volatile String prompt;

    public Packs(Nexus nexus) {
        this.nexus = nexus;
        reload();
    }

    /**
     * Reads the config and, if a pack is set, hashes it.
     *
     * Off the main thread: this fetches a file that might be fifty megabytes
     * over somebody else's connection, and doing that during startup on the
     * server thread would hold the whole boot open.
     */
    public void reload() {
        var config = nexus.getConfig();

        this.url = config.getString("resourcePack.url", "").trim();
        this.required = config.getBoolean("resourcePack.required", false);
        this.prompt = config.getString("resourcePack.prompt",
                "This server has its own textures. Worth saying yes.");
        this.sha1 = null;

        if (url.isEmpty()) return;

        nexus.getServer().getScheduler().runTaskAsynchronously(nexus, () -> {
            String hashed = hashOf(url);
            if (hashed == null) {
                nexus.getLogger().warning("could not fetch the resource pack at " + url
                        + " - it will be hashed when the first player joins instead."
                        + " If that fails too, nothing on this machine can reach that"
                        + " address");
            } else {
                nexus.getLogger().info("resource pack ready (" + hashed.substring(0, 8) + ")");
            }
            sha1 = hashed;
        });
    }

    /** Downloads the pack once and returns its SHA-1, or null. */
    private String hashOf(String from) {
        try {
            var connection = URI.create(from).toURL().openConnection();
            connection.setConnectTimeout(15_000);
            connection.setReadTimeout(60_000);

            MessageDigest digest = MessageDigest.getInstance("SHA-1");

            try (InputStream in = connection.getInputStream()) {
                byte[] buffer = new byte[8192];
                int read;
                while ((read = in.read(buffer)) > 0) digest.update(buffer, 0, read);
            }

            StringBuilder out = new StringBuilder();
            for (byte b : digest.digest()) out.append(String.format("%02x", b));
            return out.toString();
        } catch (Exception unreachable) {
            return null;
        }
    }

    public boolean configured() {
        return url != null && !url.isEmpty();
    }

    /**
     * Offers the pack to somebody who has just joined.
     *
     * Never forced by default. A required pack turns a failed download into a
     * kick, and the people most likely to fail a download are the ones on a bad
     * connection who were going to have a hard time anyway.
     */
    public void offer(Player player) {
        if (!configured()) return;

        var info = ResourcePackInfo.resourcePackInfo()
                .id(UUID.nameUUIDFromBytes(url.getBytes()))
                .uri(URI.create(url));

        /*
         * A hash is not optional, whatever it looks like.
         *
         * The builder throws if one was never set, so the obvious "leave it out
         * and let the client cope" is not a thing that exists - it used to read
         * `if (sha1 != null) info.hash(sha1)` and then threw on build, which
         * meant one unreachable pack at startup was nobody getting a pack for
         * the rest of the server's life.
         *
         * So when the startup fetch did not manage it, the pack is fetched and
         * hashed now instead. That also mends the common case by itself: the
         * launcher's pack host often comes up a moment after the server, and
         * by the time somebody actually joins it is answering.
         */
        if (sha1 != null) {
            send(player, info.hash(sha1).build());
            return;
        }

        info.computeHashAndBuild().whenComplete((built, failed) -> {
            if (failed != null || built == null) {
                nexus.getLogger().warning("the resource pack at " + url
                        + " could not be reached, so " + player.getName()
                        + " was not offered it: " + failed);
                return;
            }

            // Kept, so the next player down the line takes the quick path.
            sha1 = built.hash();

            /*
             * Back to the main thread. This lands on whichever thread finished
             * the download, and sending a packet to a player from off the
             * server thread is how a server ends up with a corrupted
             * connection rather than a missing pack.
             */
            nexus.getServer().getScheduler().runTask(nexus, () -> {
                if (player.isOnline()) send(player, built);
            });
        });
    }

    private void send(Player player, ResourcePackInfo info) {
        try {
            player.sendResourcePacks(ResourcePackRequest.resourcePackRequest()
                    .packs(info)
                    .required(required)
                    .prompt(Component.text(prompt, NamedTextColor.WHITE))
                    .build());
        } catch (Exception e) {
            nexus.getLogger().warning("could not offer the resource pack: " + e);
        }
    }
}
