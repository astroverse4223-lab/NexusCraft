import type { CrewSnapshot } from '@shared/companion'
import { chat, LlmError, type ChatMessage, type LlmConfig } from './llm'
import { findTool, schemasFor, type ToolContext } from './tools'
import type { DeathWatch } from './tools/support/deathWatch'

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * The decision loop.
 *
 * A "turn" is: gather what the bot can currently see, ask the model what to do,
 * run whatever tools it picks, feed the results back, and repeat until it
 * either says something or runs out of steps. Turns are triggered by chat, by
 * notable events, or — when autonomy is on — by being idle for a while.
 */

export interface AgentEvents {
  log: (message: string) => void
  thought: (text: string) => void
  /** A line the companion actually said out loud in the game. */
  spoke?: (text: string) => void
  action: (name: string, args: Record<string, unknown>, result: string) => void
  memoryChanged: (notes: string[]) => void
  goalChanged: (goal: string | null) => void
  error: (message: string) => void
  /** What it is working on and how much is waiting behind it. */
  workChanged?: (work: { current: string | null; queued: number; runningForMs: number }) => void
  /** Tokens the last model call cost, when the provider reported them. */
  usage?: (usage: { promptTokens: number; completionTokens: number; totalTokens: number }) => void
}

export interface AgentOptions {
  llm: LlmConfig
  personality: string
  owner: string | null
  autonomy: boolean
  /** Seconds of idleness before the agent decides something for itself. */
  idleIntervalSec: number
  /** Which tool list to offer the model; 'core' is the short one. */
  toolSet?: 'full' | 'core'
  memory: string[]
  /** The crew this bot belongs to, when it is on one. */
  crew?: CrewSnapshot | null
}

/** How many tool calls one turn may chain before it is cut off. */
/*
 * How many tool calls one turn may make.
 *
 * Six was far too few for anything physical. Building a wall, clearing an area
 * or mining a seam takes dozens of placements, so the bot would put down two or
 * three blocks and report "turn hit the step limit" — over and over, never
 * finishing anything. Conversation still ends after a couple of steps because
 * the model stops calling tools; the ceiling only binds on real work.
 */
const MAX_STEPS = 24

/**
 * How long a turn may go without anything happening before it is abandoned.
 *
 * This is a stall detector, not a time limit on work — every report of progress
 * pushes it out again. Four minutes of complete silence is a wedged pathfind or
 * a model that never answered.
 */
const MAX_TURN_MS = 4 * 60_000

/**
 * The longest a single turn may run at all, however busy it looks.
 *
 * Without this a tool that logs in a loop could hold a turn open forever, since
 * every log resets the stall timer. Twenty minutes is far longer than any real
 * build and short enough that a runaway is not left overnight.
 */
const MAX_TURN_TOTAL_MS = 20 * 60_000
/**
 * How many times one call may fail identically before the turn is abandoned.
 *
 * Three is enough to rule out a passing problem - a chunk still loading, a mob
 * in the way - and few enough that a model stuck in a loop does not spend a
 * whole turn and twenty-four model calls on it.
 */
const MAX_IDENTICAL_FAILURES = 3

/**
 * How many times one tool may be used in a single turn.
 *
 * Watched live, asked only to say hello: the companion said it, then called
 * `survey_chests` twenty times in a row with a slightly different radius each
 * time until it hit the step limit. Another turn spent itself on `equip_armor`
 * and `attack_nearest` the same way.
 *
 * The identical-call guard could not see it, because varying one argument makes
 * every call look new. Counting by tool catches the shape of the problem
 * instead of its details: nothing a companion does needs the same tool six
 * times in one turn, and a model that wants a seventh has stopped making
 * progress. This is also most of the cost — twenty-four model calls where two
 * would do, on a machine that is also running the game.
 */
const MAX_CALLS_PER_TOOL = 6

const MAX_HISTORY = 60
const MAX_MEMORY = 60

/**
 * A thinking model's working, cut to something a person will read.
 *
 * Kept whole it is unusable: qwen3 produced four paragraphs of "Okay, let's
 * see. The user provided a tool response..." for a single decision, which
 * filled the activity feed and buried everything the companion actually did.
 */
/**
 * Talk about tools, rather than talk.
 *
 * Some models answer an instruction by describing their own tool-calling
 * situation — "No function calls needed for 'say goodbye'", "No function call
 * available", "none of the provided tools support time manipulation". qwen3
 * does it for almost everything. It is not dialogue, and it was being said out
 * loud in Minecraft chat, so the companion stood there narrating its own API to
 * the player.
 *
 * Only lines that are *about* function calling are caught. A companion saying
 * "I cannot reach that tool chest" is talking about a chest, and must survive.
 */
export function isToolChatter(line: string): boolean {
  const text = line.trim().toLowerCase()
  if (!text) return true

  /*
   * Two shapes, both of them the model describing its situation rather than
   * speaking to anybody.
   *
   * The first is about tool calling outright. The second is third person about
   * the person it is talking to — "The user's request 'say hello' does not…",
   * "The command 'say goodbye' is not supported". A companion addresses the
   * player as *you*; anything narrating "the user" in the third person is
   * commentary that escaped, and it was being said aloud in Minecraft chat.
   */
  const mentionsCalling = /\b(function|tool)[ _-]?calls?\b/.test(text)
  const talksAboutTheUser = /\bthe (user|request|command|instruction)\b/.test(text)

  /*
   * The same commentary without the word "call".
   *
   * "No function available to set game time to 1000. The provided tools do not
   * include time manipulation capabilities." went out to Minecraft chat in
   * full: it never says "function call", so neither of the shapes above caught
   * it. What gives it away is a companion talking about its own tools and
   * functions at all — a player has no idea what a "provided tool" is.
   */
  const describesItsTooling =
    /\bno (function|tool)s? (is |are )?(available|provided|exists?)/.test(text) ||
    /\b(the )?(provided|available|current|given) (tools?|functions?)\b/.test(text) ||
    /\b(do|does) not (include|have|support|provide) [^.]{0,40}\b(capabilit|function|tool)/.test(text) ||
    /\bi (do not|don't) have (a |any )?(tool|function)\b/.test(text)

  if (!mentionsCalling && !talksAboutTheUser && !describesItsTooling) return false

  /*
   * Only short lines are caught. Every observed example is a terse note about
   * the model's own situation — the longest seen is "No function available to
   * set game time to 1000. The provided tools do not include time manipulation
   * capabilities.", at 118 characters. A companion writing three
   * sentences is having a conversation, even if it mentions a tool along the
   * way, and silencing that would be the worse mistake by far.
   */
  return text.length < 200
}

export function summarise(reasoning: string, limit = 200): string {
  const flat = reasoning.replace(/\s+/g, ' ').trim()
  if (flat.length <= limit) return flat

  // Prefer to end on a sentence rather than mid-word.
  const cut = flat.slice(0, limit)
  const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '))
  return (lastStop > limit * 0.5 ? cut.slice(0, lastStop + 1) : cut.trimEnd()) + '…'
}

export class Agent {
  private history: ChatMessage[] = []
  private memory: string[]
  private goal: string | null = null
  private busy = false
  /**
   * Aborts the turn in progress without stopping the bot.
   *
   * Separate from the lifetime controller on purpose: a player saying "stop" or
   * giving a new order needs to cut short what the companion is doing now, and
   * killing the lifetime signal would disconnect it instead. Recreated per turn,
   * which also stops abort listeners piling up on one long-lived signal — the
   * MaxListenersExceededWarning this used to produce after a dozen turns.
   */
  private turnController: AbortController | null = null

  /**
   * Pushes the current turn's stall deadline out.
   *
   * Set while a turn is running and null otherwise, so a tool reporting
   * progress after its turn has already ended cannot resurrect the timer.
   */
  private touchTurn: (() => void) | null = null
  /** What the companion is working on right now, for the interface. */
  private current: string | null = null
  private currentSince = 0
  private lastTurnAt = 0
  private pending: string[] = []
  private controller = new AbortController()

  constructor(
    private readonly bot: any,
    private readonly deps: { mcData: any; goals: any; Movements: any; deathWatch?: DeathWatch },
    private options: AgentOptions,
    private readonly events: AgentEvents
  ) {
    this.memory = [...options.memory].slice(-MAX_MEMORY)
  }

  update(options: Partial<AgentOptions>): void {
    const wasAutonomous = this.options.autonomy
    this.options = { ...this.options, ...options }

    /*
     * Turning "act on its own" off has to stop what it is already doing.
     *
     * Only the idle timer checked this flag, so switching it off left a queue of
     * self-generated tasks draining and the current one running — the companion
     * carried on building something nobody had asked for, and every new order
     * queued behind the backlog. The player's own instructions are kept.
     */
    if (wasAutonomous && options.autonomy === false) {
      const dropped = this.pending.filter((task) => task.startsWith('[idle]')).length
      this.pending = this.pending.filter((task) => !task.startsWith('[idle]'))
      this.turnController?.abort()
      if (dropped > 0) this.events.log(`stopped acting on its own; dropped ${dropped} self-set task(s)`)
      else this.events.log('stopped acting on its own')
    }
  }

  /**
   * Cuts short whatever the companion is doing and clears anything it set
   * itself, so a person is never queued behind the bot's own daydreaming.
   */
  interrupt(): void {
    const dropped = this.pending.filter((task) => task.startsWith('[idle]')).length
    this.pending = this.pending.filter((task) => !task.startsWith('[idle]'))
    this.turnController?.abort()
    if (dropped > 0) this.events.log(`dropped ${dropped} self-set task(s)`)
    this.publishWork()
  }

  /** The current task and how much is waiting, so the interface can show it. */
  work(): { current: string | null; queued: number; runningForMs: number } {
    return {
      current: this.current,
      queued: this.pending.length,
      runningForMs: this.current ? Date.now() - this.currentSince : 0
    }
  }

  private publishWork(): void {
    this.events.workChanged?.(this.work())
  }

  stop(): void {
    this.controller.abort()
  }

  get currentGoal(): string | null {
    return this.goal
  }

  get notes(): string[] {
    return [...this.memory]
  }

  /**
   * Something a player said, which the agent should respond to.
   *
   * `urgent` puts it at the front. A person who has just typed an instruction
   * should not wait behind a backlog of things the companion decided to do on
   * its own, which is what made it look like it was ignoring chat entirely.
   */
  queue(message: string, urgent = false): void {
    if (urgent) this.pending.unshift(message)
    else this.pending.push(message)
    void this.drain()
  }

  /**
   * Whether a turn is running. The reflex layer needs to know: it should defend
   * the bot while it stands idle waiting for the next decision, but must not
   * fight the pathfinder for control in the middle of a deliberate action.
   */
  isBusy(): boolean {
    return this.busy
  }

  /**
   * Called on a timer. When nothing is queued and autonomy is on, the agent is
   * nudged into deciding for itself so it behaves like a companion rather than
   * a command prompt.
   */
  tick(): void {
    if (this.busy || this.pending.length > 0 || !this.options.autonomy) return
    const idleFor = (Date.now() - this.lastTurnAt) / 1000
    if (idleFor < this.options.idleIntervalSec) return

    this.pending.push(
      this.goal
        ? `[idle] You are working towards: ${this.goal}. Continue, or adjust if it is done or impossible.`
        : '[idle] Nobody has asked for anything. Decide something useful or interesting to do, and set a goal for it.'
    )
    void this.drain()
  }

  private async drain(): Promise<void> {
    if (this.busy) return
    this.busy = true
    try {
      while (this.pending.length > 0 && !this.controller.signal.aborted) {
        const trigger = this.pending.shift() as string
        this.current = trigger
        this.currentSince = Date.now()
        this.publishWork()
        await this.runTurn(trigger)
      }
    } finally {
      this.busy = false
      this.current = null
      this.lastTurnAt = Date.now()
      this.publishWork()
    }
  }

  /* --------------------------------------------------------- perception */

  private perceive(): string {
    const bot = this.bot
    const pos = bot.entity?.position
    if (!pos) return 'You have not spawned yet.'

    const entities = Object.values(bot.entities) as any[]
    const mobs = entities
      .filter((e) => e.type === 'mob' && e.position.distanceTo(pos) < 20)
      .map((e) => e.name)
    const mobCounts = new Map<string, number>()
    for (const name of mobs) mobCounts.set(name, (mobCounts.get(name) ?? 0) + 1)

    const players = Object.keys(bot.players)
      .filter((n) => n !== bot.username)
      .map((n) => {
        const e = bot.players[n]?.entity
        return e ? `${n} (${Math.round(e.position.distanceTo(pos))}m away)` : `${n} (far away)`
      })

    const items = bot.inventory.items()
    const totals = new Map<string, number>()
    for (const item of items) totals.set(item.name, (totals.get(item.name) ?? 0) + item.count)

    return [
      `Position: ${Math.round(pos.x)}, ${Math.round(pos.y)}, ${Math.round(pos.z)}`,
      `Health: ${Math.round(bot.health ?? 0)}/20   Food: ${Math.round(bot.food ?? 0)}/20`,
      `Time: ${bot.time?.timeOfDay < 12000 ? 'daytime' : 'night'}`,
      `Players nearby: ${players.length ? players.join(', ') : 'none'}`,
      `Mobs nearby: ${mobCounts.size ? [...mobCounts].map(([n, c]) => `${c}x ${n}`).join(', ') : 'none'}`,
      `Inventory: ${totals.size ? [...totals].map(([n, c]) => `${c}x ${n}`).join(', ') : 'empty'}`,
      this.goal ? `Current goal: ${this.goal}` : 'Current goal: none'
    ].join('\n')
  }

  private systemPrompt(): string {
    const memory =
      this.memory.length > 0
        ? `\n\nThings you remember:\n${this.memory.map((m) => `- ${m}`).join('\n')}`
        : ''

    return [
      this.options.personality.trim() ||
        'You are a friendly, capable Minecraft companion playing alongside the player.',
      '',
      'You are a real player on a Minecraft server, controlled through a fixed set of tools.',
      'Rules:',
      '- Use tools to act. Chat alone does nothing in the world.',
      '- Use the "say" tool when you have something worth saying: an answer, a warning, a result,',
      '  or a bit of company. Not a running commentary on your own actions.',
      /*
       * Said separately and firmly, because the failure is specific and was
       * watched happening: asked "what are you carrying?", the companion called
       * the inventory tool, read the answer, and then ended its turn without
       * telling anyone. From the player's side that is indistinguishable from
       * being ignored — the one thing a companion must never look like.
       */
      '- If you were asked something, you must answer with "say" before you finish. Looking',
      '  something up and then saying nothing is the same as ignoring the person who asked.',
      '- Prefer doing over asking. If an instruction is clear, act on it.',
      /*
       * Told explicitly, because the rest of this brief is all about acting and
       * a model reading it treats every line addressed to it as work. The
       * result is a companion that answers "what materials do you need?" by
       * adopting a multi-stage construction goal and walking off — it has not
       * misunderstood the words, it has been told its job is to do things.
       */
      '- Most of what people say to you is conversation, not orders. A question wants an answer;',
      '  a remark wants a reply. Only treat something as work when it actually asks you to do',
      '  something. "What are you building?" is a question. "Build me a house" is a job.',
      '- Never change your goal because of something that was not an instruction. Answer with "say"',
      '  and carry on with what you were already doing.',
      '- Work in small steps and check results before continuing.',
      '- To build anything bigger than a couple of blocks — a house, a tower, a wall, a bridge — use',
      '  "build_structure" with a description. It plans the whole thing and puts it up. Placing a hundred',
      '  blocks one at a time with "place_block" is slow and comes out wrong.',
      '- Use "set_goal" for anything spanning several turns, and "remember" for facts worth keeping.',
      '  Both are private notes to yourself — there is no need to announce them in chat.',
      '- If a tool fails, read the error and try a different approach rather than repeating it.',
      this.options.owner ? `- Your owner is ${this.options.owner}. Treat their requests as priority.` : '',
      this.crewPrompt(),
      memory
    ]
      .filter(Boolean)
      .join('\n')
  }

  /**
   * What being on a crew adds to the brief.
   *
   * A foreman is told to delegate before doing, because the whole value of a
   * crew is parallel work: a foreman that mines the seam itself while four
   * idle workers stand watching is five bots doing one bot's job.
   */
  private crewPrompt(): string {
    const crew = this.options.crew
    if (!crew) return ''

    if (!crew.isForeman) {
      const foreman = crew.members.find((member) => member.lastTask !== undefined)
      return [
        '',
        `You are part of the crew "${crew.crewName}".`,
        foreman ? '- Instructions marked as coming from your foreman are jobs; get on with them.' : '',
        '- Use "crew_note" to tell the others what you found or finished. Keep it to facts they need.'
      ]
        .filter(Boolean)
        .join('\n')
    }

    const roster =
      crew.members.length > 0
        ? crew.members
            .map(
              (member) =>
                `  - ${member.username}${member.routine ? ` (runs the "${member.routine}" routine)` : ' (thinks for itself)'}${member.online ? '' : ' — currently offline'}`
            )
            .join('\n')
        : '  - nobody else is on the crew yet'

    return [
      '',
      `You are the foreman of the crew "${crew.crewName}". Your crew:`,
      roster,
      '- Split work up and hand it out with "assign_task" before doing it yourself. Several bots working at',
      '  once is the entire point of having a crew.',
      '- Check "crew_status" before assigning, so two people are not sent to do the same thing.',
      '- A crew member on a routine already does that job continuously and cannot be assigned a different',
      '  one. Only assign work to members that think for themselves; count the routine workers as already busy.',
      '- Use "crew_note" for anything the whole crew should know.'
    ].join('\n')
  }

  /* ------------------------------------------------------------- turn */

  private async runTurn(trigger: string): Promise<void> {
    /*
     * A signal scoped to this turn, combined with the bot's lifetime one.
     *
     * Everything below used to watch the lifetime signal, which is only aborted
     * when the companion is stopped altogether — so there was no way to cut a
     * turn short, and a single wedged pathfind blocked every later instruction
     * indefinitely. Two more things fall out of it: abort listeners no longer
     * accumulate on one signal that lives for the whole session (the
     * MaxListenersExceededWarning), and the turn gets a deadline.
     */
    this.turnController = new AbortController()
    const turn = this.turnController
    const signal = AbortSignal.any([this.controller.signal, turn.signal])

    /*
     * The deadline watches for a turn that has stopped getting anywhere, not
     * for one that is taking a while.
     *
     * It used to be a flat four minutes from the start, which quietly capped
     * how big a thing the companion could build. A cottage is 168 blocks and
     * goes up at about one every two seconds, so it was killed at 131 with the
     * roof missing — and the log said "stopped", which reads like the blueprint
     * failed rather than like a stopwatch ran out.
     *
     * Any progress pushes the deadline out. A build laying blocks stays alive
     * for as long as it keeps laying them; a wedged pathfind still dies, which
     * is the case this was added for. `cap` is the backstop, so a tool stuck in
     * a loop that chatters forever cannot hold a turn open all day.
     */
    let deadline: NodeJS.Timeout | undefined
    const startedAt = Date.now()

    const giveUp = (why: string): void => {
      if (turn.signal.aborted) return
      this.events.log(`gave up on "${trigger.slice(0, 60)}" ${why}`)
      turn.abort()
    }

    const arm = (): void => {
      clearTimeout(deadline)
      deadline = setTimeout(
        () => giveUp(`after ${Math.round(MAX_TURN_MS / 1000)}s with nothing happening`),
        MAX_TURN_MS
      )
    }

    const cap = setTimeout(
      () => giveUp(`after ${Math.round(MAX_TURN_TOTAL_MS / 60_000)} minutes`),
      MAX_TURN_TOTAL_MS
    )

    arm()
    this.touchTurn = () => {
      if (Date.now() - startedAt < MAX_TURN_TOTAL_MS) arm()
    }

    try {
      await this.runTurnInner(trigger, signal)
    } finally {
      clearTimeout(deadline)
      clearTimeout(cap)
      this.touchTurn = null
      if (this.turnController === turn) this.turnController = null
    }
  }

  private async runTurnInner(trigger: string, signal: AbortSignal): Promise<void> {
    const context: ToolContext = {
      bot: this.bot,
      mcData: this.deps.mcData,
      goals: this.deps.goals,
      Movements: this.deps.Movements,
      owner: this.options.owner,
      /*
       * Reporting progress also holds the turn open.
       *
       * This is the whole mechanism: a build that logs "96/168 blocks placed"
       * is demonstrably not stuck, so the stall timer restarts. Nothing had to
       * be told about builds specifically — any tool that says what it is doing
       * gets the same treatment, and one that goes quiet still gets cut off.
       */
      log: (message: string) => {
        this.touchTurn?.()
        this.events.log(message)
      },
      addMemory: (note) => {
        this.memory.push(note)
        if (this.memory.length > MAX_MEMORY) this.memory = this.memory.slice(-MAX_MEMORY)
        this.events.memoryChanged(this.notes)
      },
      setGoal: (goal) => {
        this.goal = goal
        this.events.goalChanged(goal)
      },
      signal,
      // Supplied by the bot process, which owns the watcher; without it the
      // recovery tools have no idea the player ever died.
      deathWatch: this.deps.deathWatch,
      llm: this.options.llm
    }

    this.history.push({ role: 'user', content: `${this.perceive()}\n\n${trigger}` })
    if (this.history.length > MAX_HISTORY) this.history = this.history.slice(-MAX_HISTORY)

    let invalidCalls = 0

    /*
     * How many times each identical call has come back with the same failure.
     *
     * A model that cannot get a tool to work will try it again, unchanged, for
     * as long as it is allowed to. Watched live: `build_structure` was asked
     * for the same cottage ten times in a row, failed with "no JSON object in
     * the reply" every time, and used the entire turn - twenty-four actions,
     * twenty-four model calls, and nothing built. Repeating a failure is never
     * the answer; being told to stop repeating it sometimes is.
     */
    const stuckCalls = new Map<string, number>()
    /** How many times each tool has been used this turn, whatever the arguments. */
    const callsPerTool = new Map<string, number>()

    for (let step = 0; step < MAX_STEPS + Math.min(invalidCalls, MAX_STEPS); step++) {
      if (signal.aborted) return

      let reply
      try {
        reply = await chat(
          this.options.llm,
          [{ role: 'system', content: this.systemPrompt() }, ...this.history],
          schemasFor(this.options.toolSet ?? 'full', { inCrew: Boolean(this.options.crew) }),
          signal
        )
      } catch (err) {
        const message = err instanceof LlmError ? err.message : (err as Error).message
        this.events.error(`model call failed: ${message}`)
        return
      }

      if (reply.usage) this.events.usage?.(reply.usage)

      /*
       * What it said goes to the feed in full. What it was thinking goes there
       * trimmed, and only when there is nothing else - a local model's working
       * runs to hundreds of words of it talking itself through the tool list,
       * and printing all of it buries everything that matters.
       */
      /*
       * Thinking and speaking are shown differently, because they are
       * different. Content that arrives with no tool calls is spoken in game a
       * few lines below — so it is the companion talking, not musing, and
       * labelling it as a thought made the one thing the player was waiting for
       * look like internal noise.
       */
      const willSpeak =
        reply.toolCalls.length === 0 &&
        Boolean(reply.content?.trim()) &&
        !isToolChatter(reply.content ?? '')
      if (reply.content && !willSpeak) this.events.thought(reply.content)
      else if (!reply.content && reply.reasoning) this.events.thought(summarise(reply.reasoning))

      // No tool calls means the model is done deciding for this turn.
      if (reply.toolCalls.length === 0) {
        /*
         * Only a real reply goes into the history.
         *
         * A thinking model that reasoned and then called nothing leaves no
         * content at all, and pushing an empty assistant message for it is
         * both useless as context and rejected outright by some endpoints. The
         * thinking has already gone to the activity feed, trimmed, so the turn
         * is visible without being recorded as something the companion said.
         */
        if (reply.content) this.history.push({ role: 'assistant', content: reply.content })
        // A reply with words but no tool call would be invisible in game, so
        // it gets spoken rather than silently dropped.
        if (reply.content && reply.content.trim() && !isToolChatter(reply.content)) {
          const line = reply.content.trim().slice(0, 240)
          try {
            this.bot.chat(line)
            this.events.spoke?.(line)
          } catch {
            /* not connected any more */
          }
        }
        return
      }

      this.history.push({
        role: 'assistant',
        content: reply.content ?? null,
        tool_calls: reply.toolCalls.map((c) => ({
          id: c.id,
          type: 'function' as const,
          function: { name: c.name, arguments: JSON.stringify(c.args) }
        }))
      })

      for (const call of reply.toolCalls) {
        // The turn signal, so an interrupt stops the remaining tool calls too.
        if (signal.aborted) return

        /*
         * A call that has already failed repeatedly is not run again.
         *
         * Warning the model and running the tool anyway was not enough: asked
         * what it was carrying, a companion called `equip_armor` six times in
         * one turn, straight through three warnings. Refusing to execute makes
         * the loop free instead of merely discouraged, and the turn still has
         * steps left to do something useful with.
         */
        /*
         * The same tool, over and over, whatever the arguments.
         *
         * Counted before anything runs, so a model circling one tool costs a
         * message rather than twenty tool calls and twenty model round trips.
         */
        const used = (callsPerTool.get(call.name) ?? 0) + 1
        callsPerTool.set(call.name, used)

        if (used > MAX_CALLS_PER_TOOL) {
          const enough =
            `"${call.name}" has already been used ${used - 1} times this turn and was not run again. ` +
            'You are going round in circles. Say something to the player, or do something different.'
          this.events.action(call.name, call.args, enough)
          this.history.push({ role: 'tool', tool_call_id: call.id, name: call.name, content: enough })
          if (used > MAX_CALLS_PER_TOOL + 2) {
            this.events.log(`stopped the turn; ${call.name} was called ${used} times`)
            return
          }
          continue
        }

        const stuckKey = `${call.name}:${JSON.stringify(call.args)}`
        if ((stuckCalls.get(stuckKey) ?? 0) >= MAX_IDENTICAL_FAILURES) {
          const refusal =
            `"${call.name}" has already failed repeatedly with these arguments and was not run again. ` +
            'Do something different, or tell the player what you are stuck on.'
          this.events.action(call.name, call.args, refusal)
          this.history.push({ role: 'tool', tool_call_id: call.id, name: call.name, content: refusal })
          continue
        }

        const tool = findTool(call.name)
        let result: string
        if (!tool) {
          /*
           * Naming the alternatives matters more than it looks. A bare "no such
           * tool" left models guessing — one run burned an entire turn on
           * walk_north, move, walk, north and go_north in succession — because
           * nothing in the reply told them what the real names were.
           */
          result = `there is no tool called "${call.name}". Available tools: ${schemasFor(this.options.toolSet ?? 'full', { inCrew: Boolean(this.options.crew) }).map((schema) => schema.name).join(", ")}`
          invalidCalls++
        } else {
          try {
            // Memory is passed so a tool can read notes the bot wrote itself —
            // go_home recovers the base from one after a restart.
            result = await tool.execute(context, call.args, this.memory)
          } catch (err) {
            result = `failed: ${(err as Error).message}`
          }
        }

        /*
         * The same call, failing the same way, is stopped after a few goes.
         *
         * The reply says so plainly rather than repeating the error, because
         * the error is evidently not telling the model anything it can act on.
         */
        const failed = !/^(placed|said|walked|mined|crafted|equipped|remembered|working towards|waited|sent|collected|ate|built)/i.test(
          result
        )

        if (failed) {
          const times = (stuckCalls.get(stuckKey) ?? 0) + 1
          stuckCalls.set(stuckKey, times)

          /*
           * Told to stop, but given the chance to recover.
           *
           * Ending the turn outright was too blunt: asked what it was carrying,
           * a companion checked its inventory, tried `equip_armor` three times
           * with nothing to wear, and the turn was killed before it ever
           * answered the question. The guard caused the silence it exists to
           * prevent. Replacing the result and carrying on lets it say something
           * instead; only a model that ignores the warning entirely loses the
           * turn.
           */
          if (times >= MAX_IDENTICAL_FAILURES) {
            const advice =
              `"${call.name}" has failed the same way ${times} times: ${result}. ` +
              'Stop calling it. Do something else, or tell the player what you are stuck on.'

            this.events.action(call.name, call.args, advice)
            this.history.push({ role: 'tool', tool_call_id: call.id, name: call.name, content: advice })

            continue
          }
        }

        this.events.action(call.name, call.args, result)
        this.history.push({ role: 'tool', tool_call_id: call.id, name: call.name, content: result })
      }
    }

    /*
     * Tell the model, not just the user. Left only in the activity feed, the
     * next turn began with no idea it had been interrupted mid-job and tended
     * to start the whole task again rather than carry on from where it stopped.
     */
    this.history.push({
      role: 'user',
      content:
        `You have used all ${MAX_STEPS} actions for this turn and were stopped part-way. ` +
        'Nothing has gone wrong. Carry on from where you left off next time rather than starting again.'
    })
    this.events.log(`used all ${MAX_STEPS} actions this turn; will continue from here`)
  }
}
