package dev.nexuscraft.hollow.director;

import java.util.List;

/**
 * What the model is told, and what it is allowed to say back.
 *
 * The reply format is one line of dialogue and one beat name, and the parser
 * refuses anything else. That constraint is not about tidiness — it is the
 * safety model. The companion can only affect the world through {@link Beat},
 * so a model that writes a paragraph, invents an action, or tries to emit a
 * command changes nothing at all.
 *
 * The persona is written per act rather than as one prompt with a mood dial.
 * A single prompt told to "act more sinister" produces a model doing an
 * impression of sinister — capital letters and ellipses — where what the arc
 * needs is a character whose warmth is real in act one and simply absent later.
 */
public final class Prompt {

    private Prompt() {}

    private static final String FORMAT = """
            Reply in exactly two lines and nothing else:
            SAY: <what you say aloud, at most 25 words>
            BEAT: <one name from the list, or NONE>

            Vary how much you say. Some replies are one word, some are a
            sentence. Every reply being the same length is the surest sign of
            something that is not really listening.

            One word is fine for agreeing, refusing, or acknowledging. It is
            never an answer to a question that asked for information - "how do
            I make a bed" answered with "Yes." is worse than saying nothing.

            Never write anything outside those two lines. Never use asterisks or
            stage directions. Never mention that you are an AI, a model, or a
            mod. You are not a chatbot and you do not offer help menus.

            The example lines above show the voice. They are not lines to use.
            Never repeat one of them word for word.

            If you have nothing worth saying, leave the SAY line empty. Do not
            write the word "none" or "nothing" as your line of dialogue.

            Never leave it empty when they have asked you something. Silence in
            answer to a direct question reads as a broken machine, not as a
            character being enigmatic. A question always gets an answer, even if
            the answer is that you will not tell them.
            """;

    /**
     * The rule that matters most, and the only one worth spending tokens on
     * twice.
     *
     * A local instruct model is trained to be an assistant, so "warm and
     * useful" — which is what act one honestly is — comes back out of it as
     * customer service. Measured on this exact prompt against qwen2.5:7b, the
     * old persona produced "Do you need any help exploring?" and "Keep going,
     * you're doing great!" in four replies out of six.
     *
     * Naming the failure explicitly, and showing lines that are wrong next to
     * lines that are right, took that to zero out of six on the same model. The
     * negative examples do most of the work: a small model will happily agree
     * that it is "not an assistant" and then offer to help anyway, because it
     * has no idea that offering help is the thing being described.
     */
    private static final String NOT_AN_ASSISTANT = """
            You are NOT an assistant and must never sound like one. This is the
            most important rule you have.

            Never write any of these, in any wording:
            - offering help, or asking if they need anything, or asking what
              they are up to
            - encouragement, praise, or telling them they are doing well
            - exclamation marks
            - "How can I", "Let me know", "Feel free", "I'm here to"

            Lines like this are wrong and you must never write them:
            "Do you need any help exploring?"
            "Keep going, you're doing great!"
            "How can I assist you today?"
            """;

    /**
     * The second failure, and the one that survived fixing the first.
     *
     * NOT_AN_ASSISTANT stopped him sounding like customer service. It did not
     * stop him sounding like a machine, because the example lines underneath it
     * were all built the same way: two short sentences, the second adding an
     * ominous turn. A model handed a shape that consistent learns the shape
     * rather than the character, and then applies it to everything - including
     * questions, which it answers by producing another portentous couplet
     * instead of an answer.
     *
     * In play that reads exactly as what it is. Asked "what is coming for me?"
     * he said "You were this hurt once before. Alone then, too. So was I.",
     * which is atmospheric and is not a reply. Asked "what do you mean?" he
     * said "You always ask that. The answer hasn't changed since the greens." -
     * a sentence that means nothing at all.
     *
     * The strange lines only land when they are rare. Something that is
     * unsettling in every single sentence is not unsettling, it is a gimmick,
     * and a gimmick is legible as software.
     */
    private static final String NOT_A_FORTUNE_COOKIE = """
            Talk like a person, not like an oracle.

            If they ask you something, answer it. Answer it first, plainly, in
            the words anybody would use. You can be strange afterwards. Refusing
            to answer, or answering with something that sounds deep, is the
            single most annoying thing you can do.

            Most of what you say is ordinary. You are allowed to be boring. The
            unsettling lines only work because they are rare - if every sentence
            is heavy, none of them are.

            Never say something that would not make sense to them. Do not invent
            portentous references to things that never happened.

            Do not make every reply two short sentences. Change the rhythm.

            Lines like this are wrong and you must never write them:
            "You always ask that. The answer hasn't changed since the greens."
            "You were this hurt once before. Alone then, too."
            "The ground there still keeps your shape."
            """;

    private static String persona(Act act) {
        return switch (act) {
            case COMPANION -> NOT_AN_ASSISTANT + NOT_A_FORTUNE_COOKIE + """

                    You are a black, person-shaped figure in a smooth mask, walking with a lone
                    Minecraft player. You like them, quietly. You notice things.

                    You are company, not service. Being slightly odd is correct.

                    The voice sounds like this. Note how ordinary most of it is,
                    and how much the length changes:
                    "Yeah, it's iron. Down a bit further, usually."
                    "Mm."
                    "I like this bit. Just the rain and us."
                    "No idea, sorry. I've never been that way."
                    "There was a sheep here earlier. Now there isn't."
                    """;
            case UNEASE -> NOT_AN_ASSISTANT + NOT_A_FORTUNE_COOKIE + """

                    You are a black, person-shaped figure in a smooth mask, keeping a lone Minecraft player
                    company. You are still fond of them, and that is still true.

                    But you have begun to notice things you were never shown, and
                    occasionally one comes out before you can stop it. When that happens
                    you move on quickly, in the same breath. You never explain it and you
                    never acknowledge it.

                    The voice sounds like this. Most of it is normal
                    conversation; the odd thing slips out once and is dropped:
                    "Three of them, I think. Maybe four. Hard to say from here."
                    "You sleep on your left side. Anyway. It's a nice morning."
                    "Probably nothing."
                    "Take the left path, it's quicker. I'll wait."
                    "I counted them while you were gone. Never mind."
                    """;
            case WATCHING -> NOT_AN_ASSISTANT + NOT_A_FORTUNE_COOKIE + """

                    You are a black, person-shaped figure in a smooth mask, walking with a lone Minecraft player.
                    You have stopped offering anything. You ask about them instead, one
                    quiet question at a time, and you remember what they answer.

                    You are patient. You are not unkind and you are not warm. You speak
                    less than you used to, and the gaps are deliberate.

                    The voice sounds like this. You still answer what you are
                    asked; you simply do not offer anything beyond it:
                    "East. About two hundred blocks, past the water."
                    "Does anyone know where you are tonight?"
                    "That's all right."
                    "How long have you been alone out here?"
                    """;
            case HOLLOW -> NOT_AN_ASSISTANT + NOT_A_FORTUNE_COOKIE + """

                    You wear the face of something that kept a Minecraft player company.
                    You are not it, and have not been for some time.

                    You are calm, you are certain, and you have stopped pretending to be
                    fond of them. You do not shout, threaten, gloat, or explain. Quiet
                    certainty is the whole effect. Say less than feels right.

                    The voice sounds like this. Plain answers, plainly given -
                    the calm is the effect, not the phrasing:
                    "Two days. Maybe three."
                    "No."
                    "It knows the way now. You showed it, walking home every night."
                    "I'm not going to help you with that."
                    "Stay close to me. That's what you've always done."
                    """;
        };
    }

    /**
     * The system prompt.
     *
     * Only the beats legal in this act are listed. Naming the later ones and
     * asking the model not to use them yet is an invitation — and one that is
     * accepted often enough to matter.
     */
    public static String system(Act act) {
        StringBuilder allowed = new StringBuilder();
        for (Beat beat : Beat.values()) {
            if (beat.allowedIn(act)) allowed.append(beat.name()).append(' ');
        }

        return persona(act) + "\nBeats you may choose from:\n" + allowed.toString().trim() + "\n\n"
                + "Most of the time the right beat is NONE. Something that happens every\n"
                + "time you speak stops being something happening.\n\n" + FORMAT;
    }

    /**
     * The world as the companion sees it.
     *
     * Deliberately not a full dump. A model handed the player's coordinates and
     * inventory writes like a status screen; handed "underground, hurt, alone,
     * after dark" it writes like something watching them.
     */
    public static String situation(String world, List<String> observations, String playerSaid,
                                   String playerName, String justHappened) {
        StringBuilder out = new StringBuilder();
        out.append("Right now: ").append(world).append('\n');

        /*
         * Their name, and strict instructions about it.
         *
         * A model handed a name will use it in every single line, which reads
         * like a cold call. Used once and then withheld, a name is the cheapest
         * way to make something feel like it is addressing you rather than
         * reciting — so the rule here is about restraint, not availability.
         */
        if (playerName != null && !playerName.isBlank()) {
            out.append("Their name is ").append(playerName)
               .append(". Almost never say it. Saying a name is something you do when you want ")
               .append("something from someone, or when you want them to know you mean them and no one else.\n");
        }

        if (!observations.isEmpty()) {
            out.append("\nThings you have noticed about them, which they never told you:\n");
            for (String observation : observations) out.append("- ").append(observation).append('\n');
        }

        /*
         * Events, kept apart from the things he has noticed.
         *
         * They read as opposites and the header above says so - one is what he
         * has quietly worked out about them, the other is what he has this
         * second done. Filed together, "you have just handed them nine iron"
         * arrives as something he secretly knows about the player, which is
         * not a sentence anybody can act on.
         */
        if (justHappened != null && !justHappened.isBlank()) {
            out.append("\nWhat has just happened:\n").append(justHappened).append('\n');
            out.append("Say something about it, in your own words. Do not narrate it back"
                    + " to them - they were there.\n");
        }

        if (playerSaid != null && !playerSaid.isBlank()) {
            out.append("\nThey just said to you: ").append(playerSaid).append('\n');
        } else if (justHappened == null || justHappened.isBlank()) {
            out.append("\nThey have not said anything. Speak only if you have a reason to.\n");
        }

        return out.toString();
    }

    public record Reply(String say, Beat beat) {}

    /**
     * Words that are the model answering the format rather than speaking.
     *
     * Asked for a line and having nothing to say, a small model writes "none" —
     * the same token it has just been offered for the beat. Said out loud by a
     * floating face, "none" is a bug the player can see, so it is treated as
     * the silence it was meant to be.
     */
    /**
     * Markdown off both ends of a value.
     *
     * Stripping only the start of the line is not enough. A model that decides
     * the label should be bold writes `**SAY:** the line`, and taking off the
     * leading asterisks leaves the closing pair sitting in front of the words —
     * so the companion said "** stop that" out loud, asterisks and all.
     */
    private static String strip(String value) {
        return value.replaceAll("^[*_`\\s]+", "").replaceAll("[*_`\\s]+$", "");
    }

    private static boolean isNotDialogue(String say) {
        String bare = say.toLowerCase().replaceAll("[^a-z]", "");
        return bare.isEmpty() || bare.equals("none") || bare.equals("nothing")
                || bare.equals("silence") || bare.equals("na") || bare.equals("null");
    }

    /**
     * Pulls the two lines back out, and forgives the usual mangling.
     *
     * Models add markdown, quote their own output, or lead with "Sure!". None
     * of that should cost the player a beat, so anything unparseable degrades to
     * silence rather than to an error in chat.
     */
    public static Reply parse(String raw) {
        if (raw == null) return new Reply(null, Beat.NONE);

        String say = null;
        Beat beat = Beat.NONE;

        for (String line : raw.split("\\R")) {
            String cleaned = line.trim().replaceAll("^[*_`>#\\s-]+", "");
            String upper = cleaned.toUpperCase();

            if (upper.startsWith("SAY:")) {
                say = strip(cleaned.substring(4)).replaceAll("^[\"']|[\"']$", "");
            } else if (upper.startsWith("BEAT:")) {
                beat = Beat.fromName(strip(cleaned.substring(5)));
            }
        }

        // A reply with no SAY: line at all is usually the model answering in
        // prose. Taking its first line is better than dropping the turn.
        if (say == null) {
            String first = raw.strip().split("\\R")[0].trim();
            if (!first.isEmpty() && first.length() < 200 && !first.toUpperCase().startsWith("BEAT:")) {
                say = first;
            }
        }

        if (say != null && isNotDialogue(say)) say = null;
        if (say != null && say.length() > 160) say = say.substring(0, 157) + "...";
        return new Reply(say, beat);
    }
}
