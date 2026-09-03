package dev.nexuscraft.hollow.director;

/**
 * "Something is coming."
 *
 * The best thing in this mod, and the cheapest: three days before the hunt, the
 * companion starts warning you about it. Every line is protective. It tells you
 * to bar the door, to stay close, that it will not let anything find you — and
 * it is the reason the thing is coming at all.
 *
 * The countdown does the work that a jump scare cannot. A player who is told
 * "three days" spends three days preparing, and every one of those days is
 * spent doing what the companion suggested, which is the trap closing. By the
 * night it arrives they are exactly where they were told to be.
 *
 * None of these lines lie. That is deliberate — the companion never says
 * anything untrue, it simply does not say that it is the one bringing it. A
 * character that lies outright can be caught lying; one that only omits cannot,
 * and the player replaying the conversation afterwards finds nothing to have
 * spotted.
 */
public final class Warning {

    private Warning() {}

    /** How many days before the hunt the warnings begin. */
    public static final int LEAD_DAYS = 3;

    /**
     * What it says on the day with `daysLeft` remaining.
     *
     * Returns null on a day with nothing to say, so a caller can ask every day
     * without checking first.
     */
    public static String forDay(int daysLeft) {
        return switch (daysLeft) {
            case 3 -> "Something's coming. Three days, near enough. Stay close to me and you'll be fine.";
            case 2 -> "Two days. You should put a door on that. I'd feel better if you did.";
            case 1 -> "Tomorrow night. Don't go far. I'll be right here — I'm always right here.";
            case 0 -> "It's tonight. Whatever happens, don't run. It's worse if you run.";
            default -> null;
        };
    }

    /**
     * What it says once the thing has been dealt with.
     *
     * Warm again, immediately, as though the last hour did not happen. The
     * player has just fought something for their life beside a companion that
     * watched with no expression, and it goes straight back to being pleased to
     * see them. Nothing is acknowledged. Nothing is explained.
     */
    public static String afterwards() {
        return "There. All over. I told you you'd be fine.";
    }
}
