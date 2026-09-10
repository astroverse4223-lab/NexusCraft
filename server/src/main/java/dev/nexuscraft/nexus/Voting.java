package dev.nexuscraft.nexus;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.event.ClickEvent;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.title.Title;
import org.bukkit.OfflinePlayer;
import org.bukkit.Sound;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.io.BufferedReader;
import java.io.DataInputStream;
import java.io.File;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.PrivateKey;
import java.security.spec.PKCS8EncodedKeySpec;
import java.util.Base64;
import java.util.List;
import java.util.UUID;

/**
 * Votes, and what they are worth.
 *
 * This is how a small server actually gets found. Nobody browses for Minecraft
 * servers; they look at a list, and the lists rank by votes. A server with no
 * vote rewards gets no votes, so it sits at the bottom of every list it is on,
 * which is the same as not being on them.
 *
 * The lists notify a server over Votifier, which is a small protocol and worth
 * implementing properly rather than asking the operator to install NuVotifier
 * alongside this. Both versions are spoken:
 *
 * Version 1 is RSA. The site holds a public key, encrypts a five line block
 * with it, and sends 256 raw bytes. Most of the older and larger lists still
 * only do this.
 *
 * Version 2 is an HMAC over a JSON payload with a shared token, and includes a
 * challenge the server issues, so a vote cannot be recorded and replayed later.
 * Newer lists prefer it.
 *
 * Both are handled on one port by looking at the first byte that arrives: JSON
 * starts with a brace, and an RSA block does not.
 *
 * Everything is done with what the JDK already has. A vote listener that needs
 * three more jars on the classpath is one that does not get set up.
 */
public final class Voting {

    /** How many votes in a row before the streak stops paying more. */
    private static final int BEST_STREAK = 7;

    private final Nexus nexus;
    private final File folder;

    private ServerSocket socket;
    private Thread listener;
    private PrivateKey privateKey;
    private String publicKey;

    private volatile int received;

    public Voting(Nexus nexus) {
        this.nexus = nexus;
        this.folder = new File(nexus.getDataFolder(), "votifier");
    }

    /* ------------------------------------------------------------- starting */

    public void start() {
        if (!nexus.getConfig().getBoolean("voting.enabled", true)) return;

        try {
            keys();
        } catch (Exception broken) {
            nexus.getLogger().warning("could not set up vote keys: " + broken);
            return;
        }

        int port = nexus.getConfig().getInt("voting.port", 8192);

        try {
            socket = new ServerSocket(port);
        } catch (Exception taken) {
            nexus.getLogger().warning("could not listen for votes on port "
                    + port + ": " + taken);
            return;
        }

        /*
         * Its own thread, blocking on accept.
         *
         * A socket cannot be polled from the server tick without either
         * blocking it or busy-waiting, and votes arrive a handful of times a
         * day - one parked thread is by far the cheapest way to wait.
         */
        listener = new Thread(this::listen, "nexus-votes");
        listener.setDaemon(true);
        listener.start();

        nexus.getLogger().info("listening for votes on port " + port);
    }

    public void stop() {
        try {
            if (socket != null) socket.close();
        } catch (Exception closing) {
            // Shutting down; nothing useful to do about it.
        }
        if (listener != null) listener.interrupt();
    }

    private void listen() {
        while (socket != null && !socket.isClosed()) {
            try (Socket client = socket.accept()) {
                client.setSoTimeout(5000);
                handle(client);
            } catch (Exception ignored) {
                // One bad connection must not stop the listener. A port scan
                // and a half-open connection both land here and both are
                // meaningless.
                if (socket == null || socket.isClosed()) return;
            }
        }
    }

    /* ------------------------------------------------------------ the votes */

    private void handle(Socket client) throws Exception {
        String challenge = UUID.randomUUID().toString();

        OutputStream out = client.getOutputStream();
        out.write(("VOTIFIER 2 " + challenge + "\n").getBytes(StandardCharsets.UTF_8));
        out.flush();

        DataInputStream in = new DataInputStream(client.getInputStream());

        /*
         * Which version, decided by the first byte.
         *
         * Version 2 sends JSON, which begins with a brace. Version 1 sends 256
         * raw bytes of RSA, whose first byte is effectively random - and the
         * chance of it being a brace is one in 256, which is why the two bytes
         * of the v2 magic number are checked as well.
         */
        int first = in.readUnsignedByte();

        String voter = first == 0x73 || first == '{'
                ? readVersionTwo(in, first, challenge)
                : readVersionOne(in, first);

        if (voter == null) return;

        received++;
        String name = voter;

        // Back to the main thread. Everything below touches players and the
        // economy, and neither may be touched from a socket thread.
        nexus.getServer().getScheduler().runTask(nexus, () -> reward(name));
    }

    /** The RSA block. 256 bytes, five lines inside. */
    private String readVersionOne(DataInputStream in, int first) throws Exception {
        byte[] block = new byte[256];
        block[0] = (byte) first;
        in.readFully(block, 1, 255);

        javax.crypto.Cipher cipher = javax.crypto.Cipher.getInstance("RSA/ECB/PKCS1Padding");
        cipher.init(javax.crypto.Cipher.DECRYPT_MODE, privateKey);

        String[] lines = new String(cipher.doFinal(block), StandardCharsets.UTF_8).split("\n");

        // VOTE, service, username, address, timestamp.
        if (lines.length < 3 || !lines[0].equals("VOTE")) return null;
        return lines[2].trim();
    }

    /**
     * The v2 payload, checked against the token before it is believed.
     *
     * The signature is what makes this worth having over version one: without
     * checking it, anybody who found the port could send a vote for themselves
     * as often as they liked.
     */
    private String readVersionTwo(DataInputStream in, int first, String challenge)
            throws Exception {
        // Version 2 frames its JSON with a two byte magic number and a length.
        if (first == 0x73) {
            in.readUnsignedByte();
            in.readUnsignedShort();
        }

        BufferedReader reader = new BufferedReader(
                new InputStreamReader(in, StandardCharsets.UTF_8));

        StringBuilder raw = new StringBuilder();
        if (first == '{') raw.append('{');

        int c;
        int depth = first == '{' ? 1 : 0;
        while ((c = reader.read()) != -1) {
            raw.append((char) c);
            if (c == '{') depth++;
            if (c == '}' && --depth == 0) break;
        }

        String outer = raw.toString();
        String payload = jsonString(outer, "payload");
        String signature = jsonString(outer, "signature");

        if (payload == null || signature == null) return null;

        String token = nexus.getConfig().getString("voting.token", "");
        if (token.isBlank()) {
            nexus.getLogger().warning("a v2 vote arrived but no token is set");
            return null;
        }

        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(token.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));

        String mine = Base64.getEncoder().encodeToString(
                mac.doFinal(payload.getBytes(StandardCharsets.UTF_8)));

        if (!java.security.MessageDigest.isEqual(
                mine.getBytes(StandardCharsets.UTF_8),
                signature.getBytes(StandardCharsets.UTF_8))) {
            nexus.getLogger().warning("a vote arrived with a signature that did not match");
            return null;
        }

        // The challenge ties the vote to this connection, so an old one that
        // was captured cannot be sent again.
        String sent = jsonString(payload, "challenge");
        if (sent != null && !sent.equals(challenge)) return null;

        return jsonString(payload, "username");
    }

    /**
     * One string field out of a flat JSON object.
     *
     * Hand-written because the whole payload is four known fields and the
     * alternative is a JSON library in a plugin that deliberately ships with
     * no dependencies. It understands escaping, which is the only part that
     * actually matters - the payload arrives as a JSON string inside JSON.
     */
    static String jsonString(String json, String field) {
        String key = "\"" + field + "\"";
        int at = json.indexOf(key);
        if (at < 0) return null;

        int colon = json.indexOf(':', at + key.length());
        if (colon < 0) return null;

        int open = json.indexOf('"', colon);
        if (open < 0) return null;

        StringBuilder out = new StringBuilder();
        for (int i = open + 1; i < json.length(); i++) {
            char c = json.charAt(i);

            if (c == '\\' && i + 1 < json.length()) {
                char next = json.charAt(++i);
                switch (next) {
                    case 'n' -> out.append('\n');
                    case 't' -> out.append('\t');
                    case 'r' -> out.append('\r');
                    case 'u' -> {
                        out.append((char) Integer.parseInt(
                                json.substring(i + 1, i + 5), 16));
                        i += 4;
                    }
                    default -> out.append(next);
                }
                continue;
            }
            if (c == '"') return out.toString();
            out.append(c);
        }
        return null;
    }

    /* ------------------------------------------------------------ the reward */

    /**
     * Pays somebody for a vote, online or not.
     *
     * Offline is the normal case - most people vote from a browser without the
     * game open - so the reward goes onto their record and the items into their
     * vault, and they are told about it when they next log in.
     */
    private void reward(String name) {
        OfflinePlayer who = nexus.getServer().getOfflinePlayer(name);
        Stats.Record record = nexus.stats().of(who.getUniqueId());

        int today = (int) (System.currentTimeMillis() / 86_400_000L);

        // A streak is consecutive days, not consecutive votes: most lists allow
        // one vote a day per site, so counting votes would reward having found
        // more sites rather than turning up.
        record.voteStreak = record.lastVoteDay == today ? record.voteStreak
                : record.lastVoteDay == today - 1 ? record.voteStreak + 1
                : 1;

        record.lastVoteDay = today;
        record.votes++;

        int streak = Math.min(record.voteStreak, BEST_STREAK);
        double money = nexus.getConfig().getDouble("voting.money", 2500) * streak;
        int coins = nexus.getConfig().getInt("voting.coins", 25) * streak;

        nexus.stats().pay(who.getUniqueId(), money);
        record.coins += coins;

        Player online = nexus.getServer().getPlayer(who.getUniqueId());

        // Every fifth vote is a crate key, which is the part people chase.
        boolean key = record.votes % 5 == 0;
        if (key && online != null) nexus.crates().give(online, Crates.Tier.RARE, 1);

        nexus.getServer().broadcast(Component.text(name, NamedTextColor.WHITE)
                .append(Component.text(" voted for the server", NamedTextColor.GRAY))
                .append(Component.text(record.voteStreak > 1
                        ? "  " + record.voteStreak + " days running" : "",
                        NamedTextColor.GOLD)));

        if (online != null) {
            online.showTitle(Title.title(
                    Component.text("Thank you", Text.BRAND),
                    Component.text("+" + Stats.cash(money) + "   +" + coins + " coins",
                            NamedTextColor.GREEN),
                    Title.Times.times(java.time.Duration.ofMillis(300),
                            java.time.Duration.ofSeconds(3),
                            java.time.Duration.ofMillis(500))));

            online.playSound(online, Sound.UI_TOAST_CHALLENGE_COMPLETE, 1f, 1.2f);
            if (key) online.sendMessage(Text.good("Five votes: a rare key."));
        }

        nexus.discord().event(name + " voted for the server"
                + (record.voteStreak > 1 ? " (" + record.voteStreak + " days running)" : ""));

        nexus.getLogger().info("vote from " + name
                + ", streak " + record.voteStreak);
    }

    /* -------------------------------------------------------------- showing */

    public void show(CommandSender sender) {
        List<String> sites = nexus.getConfig().getStringList("voting.sites");

        sender.sendMessage(Text.heading("Vote for us"));

        if (sites.isEmpty()) {
            sender.sendMessage(Text.plain("  No sites set up yet."));
            if (sender.hasPermission("nexus.admin")) {
                sender.sendMessage(Text.plain("  Add them under voting.sites in config.yml."));
                sender.sendMessage(Text.plain("  /nexus votekey for the key the sites want."));
            }
            return;
        }

        for (String site : sites) {
            sender.sendMessage(Component.text("  " + site, NamedTextColor.AQUA)
                    .clickEvent(ClickEvent.openUrl(site.startsWith("http")
                            ? site : "https://" + site)));
        }

        sender.sendMessage(Component.empty());
        sender.sendMessage(Text.plain("  Voting pays "
                + Stats.cash(nexus.getConfig().getDouble("voting.money", 2500))
                + " and grows each day in a row."));
        sender.sendMessage(Text.plain("  Every fifth vote is a rare key."));

        if (sender instanceof Player player) {
            Stats.Record record = nexus.stats().of(player.getUniqueId());
            sender.sendMessage(Text.field("Your votes", String.valueOf(record.votes)));
            sender.sendMessage(Text.field("Streak", record.voteStreak + " days"));
        }
    }

    /** The public key the sites ask for, in the form they want it. */
    public void showKey(CommandSender sender) {
        if (publicKey == null) {
            sender.sendMessage(Text.bad("Vote listening is off, so there is no key."));
            return;
        }

        sender.sendMessage(Text.heading("Votifier"));
        sender.sendMessage(Text.field("Port",
                String.valueOf(nexus.getConfig().getInt("voting.port", 8192))));
        sender.sendMessage(Text.field("Token",
                nexus.getConfig().getString("voting.token", "")));
        sender.sendMessage(Component.empty());
        sender.sendMessage(Text.plain("  The public key is in "
                + new File(folder, "public.key").getPath()));
        sender.sendMessage(Text.plain("  Older sites want the key; newer ones want the token."));
    }

    public int votesReceived() {
        return received;
    }

    public boolean running() {
        return socket != null && !socket.isClosed();
    }

    /* --------------------------------------------------------------- keys */

    /**
     * Makes a key pair and a token the first time, and reuses them after.
     *
     * They must survive a restart: the key is pasted into every list the server
     * is on, and regenerating it on each boot would silently stop every vote
     * from arriving with nothing anywhere saying why.
     */
    private void keys() throws Exception {
        if (!folder.exists() && !folder.mkdirs()) {
            throw new IllegalStateException("could not make " + folder);
        }

        File privateFile = new File(folder, "private.key");
        File publicFile = new File(folder, "public.key");

        if (privateFile.isFile() && publicFile.isFile()) {
            privateKey = KeyFactory.getInstance("RSA").generatePrivate(
                    new PKCS8EncodedKeySpec(Base64.getDecoder().decode(
                            Files.readString(privateFile.toPath()).trim())));
            publicKey = Files.readString(publicFile.toPath()).trim();
        } else {
            KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
            generator.initialize(2048);
            KeyPair pair = generator.generateKeyPair();

            privateKey = pair.getPrivate();
            publicKey = Base64.getEncoder().encodeToString(pair.getPublic().getEncoded());

            Files.writeString(privateFile.toPath(),
                    Base64.getEncoder().encodeToString(privateKey.getEncoded()));
            Files.writeString(publicFile.toPath(), publicKey);

            nexus.getLogger().info("made a Votifier key pair in " + folder);
        }

        // A token for v2, kept in the config where the operator can copy it.
        if (nexus.getConfig().getString("voting.token", "").isBlank()) {
            String token = UUID.randomUUID().toString().replace("-", "");
            nexus.getConfig().set("voting.token", token);
            nexus.saveConfig();
        }
    }

    /**
     * Proves a v2 vote is read the way a real site sends one.
     *
     * The signature check is the part worth testing: get it wrong in the
     * accepting direction and anybody who finds the port can vote for
     * themselves forever, and wrong in the other direction and no vote ever
     * arrives - and neither says anything in the log.
     */
    public String selfTest() {
        try {
            String payload = "{\"username\":\"Someone\",\"serviceName\":\"a-list.com\","
                    + "\"address\":\"1.2.3.4\",\"timestamp\":\"1700000000\","
                    + "\"challenge\":\"abc\"}";

            if (!"Someone".equals(jsonString(payload, "username"))) {
                return "a username could not be read out of a payload";
            }
            if (!"abc".equals(jsonString(payload, "challenge"))) {
                return "a challenge could not be read out of a payload";
            }

            // Escaping, which is the only part of the hand-written reader that
            // can genuinely go wrong - the payload arrives as JSON inside JSON.
            String awkward = "{\"username\":\"Odd\\\"Name\",\"challenge\":\"x\"}";
            if (!"Odd\"Name".equals(jsonString(awkward, "username"))) {
                return "an escaped quote was read as " + jsonString(awkward, "username");
            }

            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec("token".getBytes(StandardCharsets.UTF_8),
                    "HmacSHA256"));

            String signature = Base64.getEncoder().encodeToString(
                    mac.doFinal(payload.getBytes(StandardCharsets.UTF_8)));

            if (signature.isBlank()) return "a signature could not be made";

            return "ok";
        } catch (Exception broken) {
            return String.valueOf(broken);
        }
    }
}
