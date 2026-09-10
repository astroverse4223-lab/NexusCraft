package dev.nexuscraft.nexus;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.nio.charset.StandardCharsets;

/**
 * The server talking into a Discord channel.
 *
 * Built on a webhook rather than a bot, deliberately. A bot means a Discord
 * application, a token to keep secret, a websocket held open, and a library the
 * size of this whole plugin — for a feature whose entire job is posting text.
 * A webhook is a URL you paste into the config, and it is one HTTP request.
 *
 * The limitation is real and worth stating: a webhook only goes one way. Chat
 * from Discord back into the game genuinely does need a bot, and that is worth
 * adding later if anybody wants it. But the direction that matters on a quiet
 * server is this one — people who are not playing seeing that somebody is.
 *
 * Everything is posted off the main thread. A Discord outage or a slow network
 * would otherwise hold the entire server still on every chat message.
 */
public final class DiscordFeed {

    private final Nexus nexus;

    public DiscordFeed(Nexus nexus) {
        this.nexus = nexus;
    }

    private String webhook() {
        return nexus.getConfig().getString("discord.webhook", "").trim();
    }

    public boolean configured() {
        return webhook().startsWith("https://");
    }

    /* --------------------------------------------------------------- saying */

    /** Somebody said something in game. */
    public void chat(String who, String said) {
        if (!nexus.getConfig().getBoolean("discord.chat", true)) return;
        post("**" + escape(who) + "**: " + escape(said));
    }

    public void joined(String who) {
        if (!nexus.getConfig().getBoolean("discord.joins", true)) return;
        post("→ **" + escape(who) + "** joined  ·  "
                + nexus.getServer().getOnlinePlayers().size() + " online");
    }

    public void left(String who) {
        if (!nexus.getConfig().getBoolean("discord.joins", true)) return;
        post("← **" + escape(who) + "** left");
    }

    /** An airdrop, a happy hour, somebody pulling a nether star. */
    public void event(String what) {
        if (!nexus.getConfig().getBoolean("discord.events", true)) return;
        post("**" + escape(what) + "**");
    }

    /**
     * Sends one message, on a worker thread.
     *
     * Failures are swallowed after one log line. A webhook that has been
     * deleted should not produce a stack trace for every sentence anybody says
     * for the rest of the evening.
     */
    private void post(String content) {
        String url = webhook();
        if (!url.startsWith("https://")) return;

        nexus.getServer().getScheduler().runTaskAsynchronously(nexus, () -> {
            try {
                HttpURLConnection connection =
                        (HttpURLConnection) URI.create(url).toURL().openConnection();

                connection.setRequestMethod("POST");
                connection.setRequestProperty("Content-Type", "application/json");
                connection.setRequestProperty("User-Agent", "Nexus");
                connection.setConnectTimeout(8_000);
                connection.setReadTimeout(8_000);
                connection.setDoOutput(true);

                // allowed_mentions empty, so nobody can make the server ping
                // everyone by typing it in chat.
                String body = "{\"content\":\"" + json(content) + "\","
                        + "\"allowed_mentions\":{\"parse\":[]}}";

                try (OutputStream out = connection.getOutputStream()) {
                    out.write(body.getBytes(StandardCharsets.UTF_8));
                }

                int code = connection.getResponseCode();
                if (code / 100 != 2) {
                    complain("Discord returned HTTP " + code);
                }
            } catch (Exception unreachable) {
                complain("could not reach Discord: " + unreachable);
            }
        });
    }

    private boolean complained;

    private void complain(String what) {
        if (complained) return;
        complained = true;
        nexus.getLogger().warning(what + " — no further Discord warnings this session");
    }

    /** Stops chat text closing the JSON string it is being put inside. */
    private static String json(String text) {
        StringBuilder out = new StringBuilder();

        for (char c : text.toCharArray()) {
            switch (c) {
                case '"' -> out.append("\\\"");
                case '\\' -> out.append("\\\\");
                case '\n' -> out.append("\\n");
                case '\r' -> {
                }
                default -> {
                    if (c < 0x20) out.append(' ');
                    else out.append(c);
                }
            }
        }
        return out.toString();
    }

    /**
     * Stops chat text being read as Discord markdown.
     *
     * Without it somebody typing asterisks reformats the channel, and a message
     * containing an @ pings people who are not playing.
     */
    private static String escape(String text) {
        return text.replace("@", "@​")
                .replace("*", "\\*")
                .replace("_", "\\_")
                .replace("`", "\\`")
                .replace("~", "\\~")
                .replace(">", "\\>");
    }
}
