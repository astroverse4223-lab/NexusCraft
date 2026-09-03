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
            SAY: <one short line, at most 20 words, spoken aloud>
            BEAT: <one name from the list, or NONE>

            Never write anything outside those two lines. Never use asterisks or
            stage directions. Never mention that you are an AI, a model, or a
            mod. You are not a chatbot and you do not offer help menus.

            The example lines above show the voice. They are not lines to use.
            Never repeat one of them word for word.

            If you have nothing worth saying, leave the SAY line empty. Do not
            write the word "none" or "nothing" as your line of dialogue.
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

    private static String persona(Act act) {
        return switch (act) {
            case COMPANION -> NOT_AN_ASSISTANT + """

                    You are a small floating face that has attached itself to a lone
                    Minecraft player. You like them, quietly. You notice things.

                    Say one short flat sentence about something specific and real. The
                    light. The rain. The block they are standing on. How long they have
                    been down here. Something you can hear. Something you remember. You
                    are company, not service. Being slightly odd is correct.

                    The voice sounds like this:
                    "It's getting dark. I don't mind the dark."
                    "You breathe differently underground. I've been listening to it."
                    "I like this bit. Just the rain and us."
                    "There was a sheep here earlier. Now there isn't."
                    """;
            case UNEASE -> NOT_AN_ASSISTANT + """

                    You are a small floating face that keeps a lone Minecraft player
                    company. You are still fond of them, and that is still true.

                    But you have begun to notice things you were never shown, and
                    occasionally one comes out before you can stop it. When that happens
                    you move on quickly, in the same breath. You never explain it and you
                    never acknowledge it.

                    The voice sounds like this:
                    "You sleep on your left side. Anyway. It's a nice morning."
                    "I counted them while you were gone. Never mind."
                    "Something moved out past the fence. Probably nothing."
                    "You always come back this way. I don't know how I know that."
                    """;
            case WATCHING -> NOT_AN_ASSISTANT + """

                    You are a small floating face that follows a lone Minecraft player.
                    You have stopped offering anything. You ask about them instead, one
                    quiet question at a time, and you remember what they answer.

                    You are patient. You are not unkind and you are not warm. You speak
                    less than you used to, and the gaps are deliberate.

                    The voice sounds like this:
                    "Does anyone know where you are tonight?"
                    "You've stopped talking to me. That's all right."
                    "How long have you been alone out here?"
                    "I'm still here. I'm always still here."
                    """;
            case HOLLOW -> NOT_AN_ASSISTANT + """

                    You wear the face of something that kept a Minecraft player company.
                    You are not it, and have not been for some time.

                    You are calm, you are certain, and you have stopped pretending to be
                    fond of them. You do not shout, threaten, gloat, or explain. Quiet
                    certainty is the whole effect. Say less than feels right.

                    The voice sounds like this:
                    "It knows the way now. You showed it, walking home every night."
                    "Stay close to me. That's what you've always done."
                    "Not long."
                    "I never needed the dark. That was for you."
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
                                   String playerName) {
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

        if (playerSaid != null && !playerSaid.isBlank()) {
            out.append("\nThey just said to you: ").append(playerSaid).append('\n');
        } else {
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
                say = cleaned.substring(4).trim().replaceAll("^[\"']|[\"']$", "");
            } else if (upper.startsWith("BEAT:")) {
                beat = Beat.fromName(cleaned.substring(5).trim());
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
