package dev.nexuscraft.hollow.director;

import com.mojang.serialization.Codec;
import com.mojang.serialization.codecs.RecordCodecBuilder;
import net.minecraft.datafixer.DataFixTypes;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.world.PersistentState;
import net.minecraft.world.PersistentStateType;

import java.util.ArrayList;
import java.util.List;

/**
 * How far the world has come, saved with the world.
 *
 * Kept in the world's own persistent state because the whole design depends on
 * continuity. A companion that forgot itself on every quit would be a random
 * event generator, and a player would work that out in an evening — nothing
 * accumulates, so nothing is worth being afraid of.
 *
 * Saved through a {@link Codec} rather than by writing NBT by hand. Recent
 * versions replaced the old `writeNbt`/`fromNbt` pair with a codec on
 * {@link PersistentStateType}, and the NBT getters now return {@link java.util.Optional},
 * so hand-rolled reading would be both broken and more code. Every field is
 * optional with a default, which means a save written by an older build still
 * loads instead of throwing a world away.
 */
public class Progression extends PersistentState {

    public static final Codec<Progression> CODEC = RecordCodecBuilder.create(instance -> instance.group(
            Codec.STRING.optionalFieldOf("act", Act.COMPANION.id).forGetter(state -> state.act.id),
            Codec.LONG.optionalFieldOf("metOnDay", -1L).forGetter(state -> state.metOnDay),
            Codec.INT.optionalFieldOf("beatsThisAct", 0).forGetter(state -> state.beatsThisAct),
            Codec.LONG.optionalFieldOf("lastBeatTime", 0L).forGetter(state -> state.lastBeatTime),
            Codec.STRING.listOf().optionalFieldOf("observations", List.of())
                    .forGetter(state -> List.copyOf(state.observations)),
            Codec.LONG.optionalFieldOf("huntOnDay", -1L).forGetter(state -> state.huntOnDay),
            Codec.LONG.optionalFieldOf("lastWarnedDay", -1L).forGetter(state -> state.lastWarnedDay),
            Codec.LONG.optionalFieldOf("restUntilDay", -1L).forGetter(state -> state.restUntilDay),
            Codec.BOOL.optionalFieldOf("huntReleased", false).forGetter(state -> state.huntReleased),
            Codec.LONG.optionalFieldOf("boxX", Long.MIN_VALUE).forGetter(state -> state.boxX),
            Codec.LONG.optionalFieldOf("boxY", Long.MIN_VALUE).forGetter(state -> state.boxY),
            Codec.LONG.optionalFieldOf("boxZ", Long.MIN_VALUE).forGetter(state -> state.boxZ),
            Codec.BOOL.optionalFieldOf("released", false).forGetter(state -> state.released),
            Codec.INT.optionalFieldOf("callCount", 0).forGetter(state -> state.callCount)
    ).apply(instance, Progression::new));

    public static final PersistentStateType<Progression> TYPE =
            new PersistentStateType<>("hollow_progression", Progression::new, CODEC, DataFixTypes.LEVEL);

    private Act act;
    private long metOnDay;
    private int beatsThisAct;
    private long lastBeatTime;

    /** The day the hunt arrives. -1 until the companion has scheduled it. */
    private long huntOnDay;

    /** The last day a warning was given, so each is said once and only once. */
    private long lastWarnedDay;

    /**
     * No new hunt is scheduled before this day.
     *
     * Without it the next countdown began on the same tick the last hunt ended,
     * so "There. All over." was followed straight away by "Something's coming."
     * The quiet days are not filler — they are what the countdown interrupts,
     * and with nothing to interrupt it stops being a countdown and becomes a
     * timetable.
     */
    private long restUntilDay;

    /**
     * Whether this scheduled hunt has already been sent.
     *
     * Without it, killing the thing on the night it arrives simply spawned
     * another one, because the condition to send it — "the promised day, and
     * dark" — was still true a tick later. The fight could not be won, only
     * outlasted until dawn, which turns the one moment the player gets to act
     * into a punishment for acting.
     */
    private boolean huntReleased;

    /**
     * Where the box is, and whether it has been opened.
     *
     * Stored as three longs rather than a BlockPos codec because it is three
     * numbers and a nullable position needs a sentinel either way. MIN_VALUE
     * means "no box placed yet".
     */
    private long boxX;
    private long boxY;
    private long boxZ;
    private boolean released;
    private int callCount;

    /**
     * Things the player did that the companion was never told, and will later
     * repeat back. Deliberately short — see {@link #observe}.
     */
    private final ArrayList<String> observations = new ArrayList<>();

    public Progression() {
        this(Act.COMPANION.id, -1L, 0, 0L, List.of(), -1L, -1L, -1L, false,
                Long.MIN_VALUE, Long.MIN_VALUE, Long.MIN_VALUE, false, 0);
    }

    private Progression(String actId, long metOnDay, int beatsThisAct, long lastBeatTime,
                        List<String> observations, long huntOnDay, long lastWarnedDay, long restUntilDay,
                        boolean huntReleased, long boxX, long boxY, long boxZ,
                        boolean released, int callCount) {
        this.act = Act.fromId(actId);
        this.metOnDay = metOnDay;
        this.beatsThisAct = beatsThisAct;
        this.lastBeatTime = lastBeatTime;
        this.observations.addAll(observations);
        this.huntOnDay = huntOnDay;
        this.lastWarnedDay = lastWarnedDay;
        this.restUntilDay = restUntilDay;
        this.huntReleased = huntReleased;
        this.boxX = boxX;
        this.boxY = boxY;
        this.boxZ = boxZ;
        this.released = released;
        this.callCount = callCount;
    }

    /* ------------------------------------------------- the box it arrives in */

    public boolean released() {
        return released;
    }

    public boolean boxPlaced() {
        return boxX != Long.MIN_VALUE;
    }

    public net.minecraft.util.math.BlockPos boxPos() {
        return boxPlaced()
                ? new net.minecraft.util.math.BlockPos((int) boxX, (int) boxY, (int) boxZ)
                : null;
    }

    public void rememberBox(net.minecraft.util.math.BlockPos pos) {
        boxX = pos.getX();
        boxY = pos.getY();
        boxZ = pos.getZ();
        markDirty();
    }

    public int callCount() {
        return callCount;
    }

    public void calledOut() {
        callCount++;
        markDirty();
    }

    /** Opened. This never goes back — it is out for the life of the world. */
    public void release() {
        released = true;
        markDirty();
    }

    /**
     * Sets the day it arrives, three days out, once.
     *
     * Scheduled the moment the last act begins rather than rolled for each
     * night. A fixed date is what makes the countdown mean anything: the player
     * is told a number and that number is true, which is the only reason the
     * warnings frighten rather than annoy.
     */
    public void scheduleHunt(long today) {
        if (huntOnDay >= 0) return;
        if (today < restUntilDay) return;
        huntOnDay = today + Warning.LEAD_DAYS;
        markDirty();
    }

    public boolean huntScheduled() {
        return huntOnDay >= 0;
    }

    /** True once it has been sent, so it is never sent twice for one date. */
    public boolean huntReleased() {
        return huntReleased;
    }

    public void markHuntReleased() {
        if (huntReleased) return;
        huntReleased = true;
        markDirty();
    }

    /** Days until it arrives; negative once the day has passed. */
    public int daysUntilHunt(long today) {
        return huntOnDay < 0 ? Integer.MAX_VALUE : (int) (huntOnDay - today);
    }

    /** True the first time it is asked on a given day, so a warning is said once. */
    public boolean shouldWarn(long today) {
        if (huntOnDay < 0 || lastWarnedDay == today) return false;
        lastWarnedDay = today;
        markDirty();
        return true;
    }

    /** Clears the date so another can be set after this one is survived. */
    public void huntFinished(long today) {
        huntOnDay = -1;
        lastWarnedDay = -1;
        huntReleased = false;
        // Four quiet days before it starts again.
        restUntilDay = today + 4;
        markDirty();
    }

    public static Progression get(ServerWorld world) {
        return world.getPersistentStateManager().getOrCreate(TYPE);
    }

    public Act act() {
        return act;
    }

    public int beatsThisAct() {
        return beatsThisAct;
    }

    public List<String> observations() {
        return List.copyOf(observations);
    }

    /** Records first contact, which starts the clock. */
    public void meet(long day) {
        if (metOnDay < 0) {
            metOnDay = day;
            markDirty();
        }
    }

    public long daysKnown(long today) {
        return metOnDay < 0 ? 0 : Math.max(0, today - metOnDay);
    }

    /**
     * Remembers something the player did.
     *
     * Capped hard, and that cap is doing real work. "You buried something under
     * the birch" lands because it is specific, true, and rare. A companion that
     * can recite forty such details is not unsettling, it is a changelog.
     */
    public void observe(String detail) {
        if (detail == null || detail.isBlank()) return;
        if (observations.contains(detail)) return;
        observations.add(detail);
        while (observations.size() > 12) observations.remove(0);
        markDirty();
    }

    public void recordBeat(long worldTime) {
        beatsThisAct++;
        lastBeatTime = worldTime;
        markDirty();
    }

    public long sinceLastBeat(long worldTime) {
        return lastBeatTime == 0 ? Long.MAX_VALUE : worldTime - lastBeatTime;
    }

    /**
     * Moves to the next act when the world has earned it.
     *
     * Both conditions matter. Days alone would let a player who ignored the
     * companion entirely arrive at the ending having seen none of the middle;
     * beats alone would let one talkative evening burn the whole arc.
     */
    /**
     * Jumps straight to an act, for `/hollow act`.
     *
     * Only ever forward — the caller checks, and so does this. The arc having
     * exactly one rule is what makes it feel like something happening to you
     * rather than a set of states being toggled, and a debug path that broke
     * that rule would be the one everybody used.
     */
    public void forceAct(Act target) {
        if (target.ordinal() <= act.ordinal()) return;
        act = target;
        beatsThisAct = 0;
        markDirty();
    }

    public boolean maybeAdvance(long today) {
        Act next = act.next();
        if (next == act) return false;
        if (daysKnown(today) < next.daysRequired) return false;
        if (beatsThisAct < 4) return false;

        act = next;
        beatsThisAct = 0;
        markDirty();
        return true;
    }
}
