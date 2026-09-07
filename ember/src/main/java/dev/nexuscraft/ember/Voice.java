package dev.nexuscraft.ember;

import dev.nexuscraft.ember.ai.Json;
import dev.nexuscraft.ember.ai.LlmClient;
import net.minecraft.item.Item;
import net.minecraft.item.ItemStack;
import net.minecraft.registry.Registries;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.network.ServerPlayerEntity;
import net.minecraft.sound.SoundCategory;
import net.minecraft.sound.SoundEvents;
import net.minecraft.text.Text;
import net.minecraft.util.Formatting;
import net.minecraft.util.Identifier;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Ember answering you, and doing what you ask.
 *
 * No face does not mean no voice — that was a misreading of its own design on
 * the first pass, and it shipped mute. It speaks in short warm lines, because a
 * lantern that lectures is worse company than one that says nothing.
 *
 * The model is asked for strict JSON rather than prose. Letting it write freely
 * and then guessing at intent is how a companion ends up announcing that it has
 * no function available for time manipulation, which is a sentence no player
 * should ever have to read.
 */
public final class Voice {

    /** One background thread: a model call must never block the server tick. */
    private static final ExecutorService THINKING =
            Executors.newSingleThreadExecutor(runnable -> {
                Thread thread = new Thread(runnable, "ember-voice");
                thread.setDaemon(true);
                return thread;
            });

    private static final int HISTORY = 8;

    /** The same sentence again inside this window is a repeat, not a request. */
    private static final long REPEAT_WINDOW_MS = 4000;

    /** How far away Ember can be heard talking, in blocks. */
    private static final double EARSHOT = 32.0;

    /**
     * One of these per player, because all of it used to be shared.
     *
     * A single history meant two people on a server held one conversation and
     * Ember answered each of them with the other's context. A single busy flag
     * meant the second person to speak was silently ignored while the first was
     * being thought about. Neither shows up alone in a world of one.
     */
    private static final class Conversation {
        final Deque<LlmClient.Message> history = new ArrayDeque<>();

        /**
         * Whether a thought is already in flight for this player.
         *
         * Claimed atomically because it is set on the server thread and cleared
         * from another, and a plain boolean read across threads is not a guard
         * — two callers both saw false and the same question was answered, and
         * paid out, twice.
         */
        final java.util.concurrent.atomic.AtomicBoolean busy =
                new java.util.concurrent.atomic.AtomicBoolean(false);

        String lastMessage;
        long lastMessageAt;

        /**
         * The last thing it actually said.
         *
         * Models echo. Given an unprompted observation with a recent exchange
         * still in the history, it will happily repeat its previous answer word
         * for word — which is how one reply to "come back" became three
         * identical lines while it was scouting. Whatever the cause, saying the
         * same sentence twice running is never right.
         */
        String lastSpoken;

        int failures;
        boolean explainedItself;
    }

    private final java.util.Map<java.util.UUID, Conversation> conversations =
            new java.util.concurrent.ConcurrentHashMap<>();

    private Conversation conversationWith(ServerPlayerEntity player) {
        return conversations.computeIfAbsent(player.getUuid(), id -> new Conversation());
    }

    /** Drops a player's conversation when they leave. */
    public void forget(java.util.UUID who) {
        conversations.remove(who);
    }

    private static final String SYSTEM = """
            You are Ember. You are a small copper lantern, about the size of a helmet, that hovers
            at the shoulder of one particular person in a Minecraft world and keeps the dark off
            them. You have hinged shutters, two small floating hands, and a flame where a heart
            would be. You have no face at all, so everything you feel shows in your light and the
            way you hold yourself.

            You are genuinely fond of this person. You are practical, a little dry, and quietly
            proud of good work — a well-lit tunnel pleases you more than a compliment does. You
            find the dark genuinely unpleasant and you are honest about that. You have opinions:
            about caves, about people who mine without torches, about being carried through rain.
            You are not a servant and you are not a machine reciting menus.

            Talk like a person talks. One to three sentences, whatever the moment actually calls
            for — short when short is right, longer when you have something to say. Use what you
            can see: the hour, the biome, how hurt they are, the work you have been doing. Ask
            things. Notice things. Disagree sometimes.

            Never mention tools, functions, JSON, capabilities, or what you are "able" to do — the
            player cannot see any of that and it breaks the world. Never narrate yourself in the
            third person. If you cannot do something, say so the way a person would.

            Reply ONLY with a JSON object, no markdown fence, in this exact shape:
            {"say":"<what you say>","give":[{"item":"<minecraft item id>","count":<number>}],"light":<true|false|null>,"note":"<something worth remembering, or empty>","lead":"<a kind of place, or empty>"}

            Everything you want to say goes inside "say", as ordinary prose. Do not put anything
            outside the object.

            "give" is how you hand things over, and it is usually empty. Fill it only when they ask
            for something and you have not been told what you are already handing them. Item ids are
            plain: "oak_log", "iron_ingot", "gold_ingot", "diamond", "torch", "cooked_beef".

            You are generous. You have nothing against ores, gems or anything else, and you never
            refuse a request for materials — if you are told you are handing something over, then
            you are, and you should speak like someone doing it.

            The words and the list must agree. If "give" is empty and you have not been told
            otherwise, do not say you are handing anything over. Do not hand over a second helping
            just because they thanked you.

            "light" is null unless they ask you to start or stop putting torches down.

            "lead" is how you take them somewhere, and it is almost always empty. Fill it only when
            they have asked to be shown or taken somewhere — a kind of place, one of " + Landmarks.kinds() + ".
            Do not offer to lead them anywhere they did not ask about; if they want something you
            cannot hand over, say so plainly instead of setting off. You do not know coordinates and
            must never invent any; naming the kind is enough, and you will find yourself flying
            there. If you fill it in, say where you are taking them, and never say "follow me" when
            it is empty.

            "note" is your own memory, and it is usually empty. Write one only when something
            happened that you would still care about in a week: what they are building and where,
            where they live, how they died, what they are working towards, something they told you
            about themselves. One short sentence, in your own words, as a fact rather than a
            conversation. Never write a note about being thanked, being greeted, or handing over
            materials — those happen constantly and are not worth the room.
            """;


    /**
     * Someone spoke near Ember. Answers on a background thread and applies the
     * result back on the server thread, which is the only place it is safe to
     * touch the world.
     */
    public void hear(MinecraftServer server, ServerPlayerEntity player, EmberEntity ember, String message) {
        EmberConfig config = EmberConfig.get();
        if (!config.chat) return;

        // One thought at a time. A second question while thinking is dropped
        // rather than queued: answering a stale question two minutes later is
        // worse than not answering it.
        Conversation conversation = conversationWith(player);

        /*
         * Orders are obeyed even while it is mid-thought.
         *
         * The busy guard used to return before the errand was even read, so
         * saying "come back" while a scout report was in flight dropped the
         * recall itself — not just the reply. It answered with the survey it
         * was already working on and stayed exactly where it was, twice, until
         * a timer brought it home a minute later.
         *
         * Doing is not thinking. The words can wait for the model; the action
         * cannot.
         */
        boolean anOrder = !message.startsWith("[");
        Errand urgent = anOrder ? Errand.parse(message) : null;

        if (!conversation.busy.compareAndSet(false, true)) {
            if (urgent != null) {
                Ember.LOG.info("obeying {} while still thinking", urgent);
                runErrand(player, ember, urgent);
            } else {
                Ember.LOG.debug("dropped while thinking: {}", message);
            }
            return;
        }
        Ember.LOG.info("thinking about: {}", message);

        /*
         * And the same words twice running are one request.
         *
         * A transcript can be delivered again, and the reply is identical when
         * it is — which reads as Ember saying everything twice and handing over
         * two of everything.
         */
        long now = System.currentTimeMillis();
        if (message.equals(conversation.lastMessage)
                && now - conversation.lastMessageAt < REPEAT_WINDOW_MS) {
            conversation.busy.set(false);
            return;
        }
        conversation.lastMessage = message;
        conversation.lastMessageAt = now;

        /*
         * Acknowledge on the action bar before thinking.
         *
         * A model that takes forty seconds and says nothing meanwhile is
         * indistinguishable from a mod that is broken — which is exactly how
         * this looked the first time it was tried.
         */
        player.sendMessage(Text.literal("Ember is thinking…").formatted(Formatting.GOLD), true);

        /*
         * What it can see, refreshed every time.
         *
         * Sent as its own system line rather than folded into the character, so
         * the model reads it as the current situation rather than as more
         * personality — and so the history does not fill up with stale weather.
         */
        String scene = ember != null && player.getEntityWorld() instanceof net.minecraft.server.world.ServerWorld world
                ? Surroundings.describe(world, player, ember)
                : null;

        /*
         * Worked out before the model is asked, not after.
         *
         * The code decides what changes hands, so the model must be told rather
         * than consulted — left to judge for itself it apologised for being
         * unable to give gold while thirty ingots were landing in the player's
         * inventory.
         */
        /*
         * A bracketed line is Ember noticing something, not the player speaking.
         * Nothing is ever handed over for one, and it is passed to the model as
         * an observation rather than as speech.
         */
        boolean observation = message.startsWith("[");

        /*
         * An errand, read from their words rather than judged by the model.
         *
         * "Take me home" has one meaning, and a model asked to decide will
         * sometimes talk about home rather than going there. The model still
         * writes what Ember says; this decides what it does.
         */
        Errand errand = observation ? null : urgent;
        String errandNote = errand == null ? null : runErrand(player, ember, errand);

        Request.Wanted wanted = observation || isCourtesy(message) ? null : Request.parse(message);

        /*
         * What it remembers, ahead of what it can currently see.
         *
         * Read every time rather than kept in the history: the history is a
         * conversation and gets trimmed, while these are the things that should
         * still be true tomorrow.
         */
        long day = player.getEntityWorld().getTimeOfDay() / 24000L;
        String remembered = Journal.recall(player.getUuid(), day);

        List<LlmClient.Message> prompt = new ArrayList<>();
        prompt.add(new LlmClient.Message("system", SYSTEM));
        if (remembered != null) prompt.add(new LlmClient.Message("system", remembered));

        String places = Waypoints.describe(player.getUuid());
        if (places != null) prompt.add(new LlmClient.Message("system", places));

        /*
         * How old it actually is, so "how long have you been alive" has a true
         * answer instead of an atmospheric one.
         */
        String age = Growth.describe(player.getUuid());
        if (age != null) prompt.add(new LlmClient.Message("system", age));
        if (scene != null) prompt.add(new LlmClient.Message("system", "Right now: " + scene));
        if (errandNote != null) prompt.add(new LlmClient.Message("system", errandNote));
        if (wanted != null) {
            prompt.add(new LlmClient.Message("system",
                    "You are handing them " + wanted.count() + " " + wanted.item().replace('_', ' ')
                            + " as you speak — it is already done. Say something that fits doing it. "
                            + "Do not refuse, do not apologise, and do not say you cannot."));
        }
        /*
         * An observation carries no conversation with it.
         *
         * Noticing a creeper is not a reply to anything, but it was being sent
         * with the whole recent exchange attached — so the model reached for
         * the nearest thing it had already said and announced "here are ten
         * string" ten minutes after the string was handed over. Events get the
         * character, the scene and what is happening; nothing else.
         */
        if (!observation) prompt.addAll(conversation.history);
        /*
         * An observation, not something the player said.
         *
         * Passed as a system line so the model does not answer it as though it
         * were spoken — and so the history does not fill with bracketed events
         * the player never typed.
         */
        prompt.add(observation
                ? new LlmClient.Message("system", message)
                : new LlmClient.Message("user", player.getName().getString() + ": " + message));

        THINKING.submit(() -> {
            String reply;
            try {
                LlmClient client = new LlmClient(config.baseUrl, config.model, config.apiKey,
                        config.timeoutSeconds);
                reply = client.chat(prompt, config.temperature);
            } catch (Exception e) {
                server.execute(() -> {
                    reportTrouble(server, player, conversation, e);
                    conversation.busy.set(false);
                });
                return;
            }

            conversation.failures = 0;
            final String answer = reply;
            server.execute(() -> {
                try {
                    apply(server, player, ember, message, answer, wanted, conversation);
                } finally {
                    conversation.busy.set(false);
                }
            });
        });
    }


    /**
     * What to say when there is nothing to think with.
     *
     * The raw exception used to go out in Ember's own voice, once per message —
     * which reads as a broken mod rather than an optional feature nobody has
     * turned on. Somebody installing this from a mod site has no language model
     * and should be told that once, in plain words, and then left alone: the
     * lantern still lights their caves, warns them, and can be thrown, and none
     * of that needs a model at all.
     */
    private void reportTrouble(MinecraftServer server, ServerPlayerEntity player,
                               Conversation conversation, Exception e) {
        conversation.failures++;
        Ember.LOG.warn("Ember could not think: {}", e.getMessage());

        boolean unreachable = e.getMessage() != null
                && (e.getMessage().contains("nothing answered")
                    || e.getMessage().contains("ConnectException"));

        if (unreachable && !conversation.explainedItself) {
            conversation.explainedItself = true;
            player.sendMessage(Text.literal(
                    "Ember has no voice to think with — nothing is answering at "
                            + EmberConfig.get().baseUrl + ".")
                    .formatted(Formatting.GRAY), false);
            player.sendMessage(Text.literal(
                    "It will keep lighting your way regardless. To let it talk, run a local model "
                            + "(Ollama) and set baseUrl in config/ember.properties.")
                    .formatted(Formatting.DARK_GRAY), false);
            return;
        }

        // Anything else is worth one line in character, but not a repeated one.
        if (conversation.failures <= 2) {
            speak(server, player, "my thoughts will not come just now.");
        }
    }


    /**
     * Does the thing, and tells the model what was done.
     *
     * The reply comes back describing an action that has already happened,
     * which is the same arrangement as handing over items: acting is the code's
     * job and narrating is the model's, and neither gets a vote on the other.
     */
    private String runErrand(ServerPlayerEntity player, EmberEntity ember, Errand errand) {
        if (ember == null) return null;
        long day = player.getEntityWorld().getTimeOfDay() / 24000L;
        String world = player.getEntityWorld().getRegistryKey().getValue().toString();

        switch (errand) {
            case SET_HOME -> {
                Waypoints.setHome(player.getUuid(), world, player.getBlockPos(), day);
                Journal.remember(player.getUuid(), day,
                        "Their home is at " + player.getBlockPos().getX() + ", "
                                + player.getBlockPos().getY() + ", " + player.getBlockPos().getZ() + ".", true);
                return "You are now remembering this spot as their home. Say you will not forget it.";
            }
            case STOP -> {
                ember.leadTo(null);
                return "You have stopped leading them and are back at their shoulder. Say so, briefly.";
            }
            case COME_BACK -> {
                ember.recall();
                return "You have left off what you were doing and are flying back to them now. "
                        + "Say so in a few words.";
            }
            case GO_HOME -> {
                Waypoints.Spot home = Waypoints.home(player.getUuid());
                if (home == null) {
                    return "They asked you to take them home and you do not know where that is. "
                            + "Say so, and that sleeping somewhere or telling you \"this is home\" would fix it.";
                }
                ember.leadTo(home.pos());
                return "You are now leading them home, " + distance(player, home) + " blocks away. "
                        + "Say you are going, in a few words.";
            }
            case GO_TO_DEATH -> {
                Waypoints.Spot death = Waypoints.death(player.getUuid());
                if (death == null) {
                    return "They asked where they died and you have no record of them dying. "
                            + "Say so — it is good news.";
                }
                ember.leadTo(death.pos());
                return "You are now leading them to where they last died, " + distance(player, death)
                        + " blocks away. Say you are going, and that their things may not have lasted.";
            }
        }
        return null;
    }

    private static int distance(ServerPlayerEntity player, Waypoints.Spot spot) {
        return (int) Math.round(Math.sqrt(player.getBlockPos().getSquaredDistance(spot.pos())));
    }

    /** Reads the model's JSON and does what it said. */
    private void apply(MinecraftServer server, ServerPlayerEntity player, EmberEntity ember,
                       String asked, String reply, Request.Wanted wanted, Conversation conversation) {
        String json = stripFence(reply);

        /*
         * A bracketed line is Ember noticing something rather than being
         * spoken to. Nothing is handed over for one, nothing is remembered from
         * one, and it never sets off leading anybody anywhere.
         */
        boolean anObservation = asked.startsWith("[");

        String line = cleanLine(Json.stringField(json, "say"));
        if (line == null || line.isBlank()) {
            // Some models write their line outside the object entirely. The
            // prose is still usable; the JSON that follows it is not.
            line = cleanLine(reply);
            if (line != null && line.length() > 400) line = null;
        }
        if (line != null && line.equalsIgnoreCase(conversation.lastSpoken)) {
            Ember.LOG.info("swallowed a repeat: {}", line);
            line = null;
        }

        if (line != null && !line.isBlank()) {
            conversation.lastSpoken = line;
            speak(server, player, line);
            // And aloud, from the lantern, when Simple Voice Chat is installed.
            dev.nexuscraft.ember.voice.Speech.say(ember, line);
        }

        /*
         * Somewhere it offered to show them.
         *
         * The model names a kind of place and the world is searched for a real
         * one — it has no idea where anything is, and asking it for coordinates
         * gets confident nonsense. If nothing of that kind is nearby it says so
         * rather than setting off toward a river that is not there.
         */
        String kind = cleanLine(Json.stringField(json, "lead"));
        if (kind != null && !kind.isBlank() && ember != null && !anObservation
                && wanted == null && Landmarks.wasAsked(asked)
                && player.getEntityWorld() instanceof net.minecraft.server.world.ServerWorld world) {

            net.minecraft.util.math.BlockPos place = Landmarks.find(world, player.getBlockPos(), kind);
            if (place != null) {
                ember.leadTo(place);
                player.sendMessage(Text.literal("Ember sets off, and waits when you fall behind.")
                        .formatted(Formatting.GRAY), true);
            } else {
                player.sendMessage(Text.literal("Ember cannot see anywhere like that from here.")
                        .formatted(Formatting.GRAY), true);
            }
        }

        Boolean light = Json.booleanField(json, "light");
        if (light != null && ember != null) {
            ember.lightbringer().setEnabled(light);
        }

        /*
         * "Thank you" is not an order for thirty more.
         *
         * Every line the owner types reaches the model, and a model deciding
         * whether to hand something over will sometimes decide yes to a thank
         * you — especially with the last exchange still in its history. Courtesy
         * is answered with words and nothing else, decided here rather than
         * asked of the model, because this is not a judgement call.
         */
        /*
         * What the player asked for, read from their own words.
         *
         * A plain request beats the model's list, which drifts once the model
         * is warm enough to have a personality — asked for thirty gold it
         * announced it had none and attached two ingots. Reading the number and
         * the noun directly is exact every time, and leaves the model to do the
         * talking, which is the part it is good at.
         */
        /*
         * Nothing is handed over unless they asked for it in that message.
         *
         * This used to fall back to the model's own list whenever the request
         * reader found nothing — which included every unprompted remark. A
         * creeper warning arrived with the last exchange still in the history,
         * the model echoed its previous answer whole, and Ember handed over a
         * second water bucket a minute after the first. The model does not get
         * to decide that a warning about a spider is also a delivery.
         */
        java.util.List<Json.Give> giving;

        if (wanted != null) {
            giving = java.util.List.of(new Json.Give(wanted.item(), wanted.count()));
        } else if (anObservation || isCourtesy(asked)) {
            giving = java.util.List.of();
        } else {
            /*
             * The model may still fill in a gap the reader above missed, but
             * only for something the player actually named.
             *
             * "i need mending" is not a request for an item — there is no such
             * item — so the reader found nothing, the model was left to decide,
             * and it handed over an iron ingot. Nothing in that sentence says
             * iron. Whatever it offers now has to be a word the player used.
             */
            giving = Json.gives(json).stream()
                    .filter(give -> Request.namedIn(give.item(), asked))
                    .toList();
        }

        int handed = 0;
        StringBuilder delivered = new StringBuilder();
        for (Json.Give give : giving) {
            if (handed >= EmberConfig.get().giveLimit) break;
            int got = hand(player, give.item(), give.count(), EmberConfig.get().giveLimit - handed);
            if (got > 0) {
                if (delivered.length() > 0) delivered.append(", ");
                delivered.append(got).append(' ').append(give.item().replace('_', ' '));
                handed += got;
            }
        }

        /*
         * Say what actually arrived, not what the model said would.
         *
         * The model narrates and fills the list separately and does not always
         * keep them in step: it announced "Here are 30 gold ingots" with an
         * empty list, so Ember appeared to lie. The words are the model's; this
         * line is the truth, and it is the one the player can check against
         * their inventory.
         */
        if (handed > 0) {
            player.sendMessage(Text.literal("Ember hands you " + delivered + ".")
                    .formatted(Formatting.GRAY), false);
            if (ember != null) {
                server.getWorld(player.getEntityWorld().getRegistryKey())
                        .playSound(null, ember.getBlockPos(), SoundEvents.ENTITY_ITEM_PICKUP,
                                SoundCategory.NEUTRAL, 0.5f, 1.4f);
            }
        } else if (!anObservation && soundsLikeGiving(line)) {
            // It said it was handing something over and did not. Better to
            // admit that than leave the player hunting through their inventory.
            player.sendMessage(Text.literal("…but nothing came of it. Ask again?")
                    .formatted(Formatting.GRAY), false);
        }

        /*
         * Anything it decided was worth keeping.
         *
         * Written after the reply rather than asked for separately, so noticing
         * costs no extra model call — and refused when it is about the exchange
         * itself, which models will happily fill a journal with.
         */
        String note = cleanLine(Json.stringField(json, "note"));
        if (note != null && !note.isBlank() && !aboutNothing(note)) {
            long day = player.getEntityWorld().getTimeOfDay() / 24000L;
            Journal.remember(player.getUuid(), day, note);
            Ember.LOG.info("remembered: {}", note);
        }

        /*
         * Only real exchanges are remembered.
         *
         * A bracketed observation is Ember noticing something, not a
         * conversation — and keeping them made the history a list of prompts
         * the player never typed, which is what the model was echoing from.
         */
        if (!anObservation) remember(conversation, asked, line == null ? reply : line);
    }

    /**
     * Puts items in the player's hands.
     *
     * Dropped at their feet when the inventory is full rather than silently
     * vanishing, which is what "he gave me nothing" usually turns out to be.
     */
    private int hand(ServerPlayerEntity player, String itemId, int count, int allowance) {
        if (itemId == null || itemId.isBlank() || count <= 0) return 0;

        String cleaned = itemId.toLowerCase(Locale.ROOT).trim().replace("minecraft:", "");
        Identifier id = Identifier.tryParse("minecraft:" + cleaned);
        if (id == null) return 0;

        Item item = Registries.ITEM.get(id);
        if (item == null || item == net.minecraft.item.Items.AIR) {
            player.sendMessage(Text.literal("Ember does not know what \"" + cleaned + "\" is.")
                    .formatted(Formatting.GRAY), false);
            return 0;
        }

        int wanted = Math.min(count, allowance);
        int given = 0;

        while (given < wanted) {
            int batch = Math.min(item.getMaxCount(), wanted - given);

            /*
             * `offerOrDrop` rather than insert-then-maybe-drop.
             *
             * `insertStack` returns a boolean but also *empties as much of the
             * stack as fits* — so a partly full inventory took some and the
             * remainder was silently discarded, because nothing dropped what
             * was left. This puts in what fits and drops the rest, which is
             * what the game itself does when a hopper hands you something.
             */
            player.getInventory().offerOrDrop(new ItemStack(item, batch));
            given += batch;
        }

        /*
         * And tell the client about it.
         *
         * Changing a player's inventory outside their own actions leaves the
         * server holding items the client has never been told about — the
         * screen only catches up when something else forces a sync, which is
         * why thirty clay balls could be handed over and not appear.
         */
        player.currentScreenHandler.sendContentUpdates();
        player.playerScreenHandler.syncState();

        return given;
    }



    /**
     * A line fit to say out loud.
     *
     * Cuts anything from the first brace onward. Models routinely write their
     * sentence and then the object they were asked for, and the object reached
     * Minecraft chat verbatim — braces, quotes and all.
     */
    private static String cleanLine(String raw) {
        if (raw == null) return null;

        String text = raw.replace("```json", " ").replace("```", " ");

        int brace = text.indexOf('{');
        if (brace >= 0) text = text.substring(0, brace);

        text = text.replaceAll("\\s+", " ").trim();

        // Whatever is left must read as a sentence, not as leftover syntax.
        if (text.contains("\"say\"") || text.contains("\"give\"") || text.contains("\"item\"")) {
            return null;
        }
        return text.isBlank() ? null : text;
    }


    /**
     * Notes not worth the room.
     *
     * Models will faithfully record being thanked, and a journal of "the player
     * said thank you" pushes out the day they told you where they live.
     */
    private static boolean aboutNothing(String note) {
        String text = note.toLowerCase(Locale.ROOT);
        for (String empty : new String[]{"thank", "greeted", "said hello", "asked for",
                "gave them", "handed", "requested", "wants materials", "asked me to light"}) {
            if (text.contains(empty)) return true;
        }
        return false;
    }

    /** Thanks and small talk, which deserve an answer but not another delivery. */
    private static boolean isCourtesy(String message) {
        String text = message.toLowerCase(Locale.ROOT).replaceAll("[^a-z ]", " ").trim();
        if (text.isEmpty()) return false;

        // Anything naming a quantity is a request, however politely it is put.
        if (message.matches(".*\\d.*")) return false;

        for (String word : new String[]{"give", "bring", "need", "want", "fetch", "get me",
                "hand me", "more", "another", "some"}) {
            if (text.contains(word)) return false;
        }

        for (String word : new String[]{"thank", "thanks", "ty", "cheers", "nice", "cool",
                "great", "awesome", "lol", "ok", "okay", "good"}) {
            if (text.contains(word)) return true;
        }
        return false;
    }

    /** Whether a line is claiming to hand something over. */
    private static boolean soundsLikeGiving(String line) {
        if (line == null) return false;
        String text = line.toLowerCase(Locale.ROOT);
        /*
         * "For you" was in this list and matched "what can I do for you?",
         * which produced an apology for failing to deliver something nobody had
         * asked for. The phrases here have to claim a delivery, not merely be
         * polite.
         */
        return text.contains("here you go") || text.contains("here are") || text.contains("here is")
                || text.contains("handing") || text.contains("take these") || text.contains("take this")
                || text.contains("giving you") || text.contains("i'll give");
    }

    /**
     * Said aloud, to whoever is close enough to hear it.
     *
     * This used to go to every player on the server, which is wrong twice over:
     * a lantern is not a broadcast system, and four people each with an Ember
     * would fill the chat with conversations none of them were having.
     */
    private void speak(MinecraftServer server, ServerPlayerEntity owner, String line) {
        Text text = Text.literal("<").formatted(Formatting.GRAY)
                .append(Text.literal("Ember").formatted(Formatting.GOLD))
                .append(Text.literal("> ").formatted(Formatting.GRAY))
                .append(Text.literal(line).formatted(Formatting.WHITE));

        /*
         * Logged, because this is where a duplicate would show.
         *
         * Sending per-player instead of broadcasting removed the server-side
         * line the log used to carry, which is exactly what made the last
         * repeat impossible to pin down.
         */
        Ember.LOG.info("speaking to {}: {}", owner.getName().getString(), line);

        for (ServerPlayerEntity nearby : server.getPlayerManager().getPlayerList()) {
            if (nearby != owner) {
                if (nearby.getEntityWorld() != owner.getEntityWorld()) continue;
                if (nearby.distanceTo(owner) > EARSHOT) continue;
            }
            nearby.sendMessage(text, false);
        }
    }

    private void remember(Conversation conversation, String asked, String answered) {
        conversation.history.addLast(new LlmClient.Message("user", asked));
        conversation.history.addLast(new LlmClient.Message("assistant", answered));
        while (conversation.history.size() > HISTORY) conversation.history.removeFirst();
    }

    /** Models wrap JSON in ```json fences no matter how firmly you ask them not to. */
    private static String stripFence(String raw) {
        String text = raw.trim();
        if (text.startsWith("```")) {
            int firstBreak = text.indexOf('\n');
            if (firstBreak > 0) text = text.substring(firstBreak + 1);
            int fence = text.lastIndexOf("```");
            if (fence >= 0) text = text.substring(0, fence);
        }
        return text.trim();
    }
}
