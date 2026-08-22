import { chat, LlmError, type ChatMessage, type LlmConfig } from './llm'
import { findTool, TOOL_SCHEMAS, schemasFor, type ToolContext } from './tools'

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
  action: (name: string, args: Record<string, unknown>, result: string) => void
  memoryChanged: (notes: string[]) => void
  goalChanged: (goal: string | null) => void
  error: (message: string) => void
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
const MAX_HISTORY = 60
const MAX_MEMORY = 60

export class Agent {
  private history: ChatMessage[] = []
  private memory: string[]
  private goal: string | null = null
  private busy = false
  private lastTurnAt = 0
  private pending: string[] = []
  private controller = new AbortController()

  constructor(
    private readonly bot: any,
    private readonly deps: { mcData: any; goals: any; Movements: any },
    private options: AgentOptions,
    private readonly events: AgentEvents
  ) {
    this.memory = [...options.memory].slice(-MAX_MEMORY)
  }

  update(options: Partial<AgentOptions>): void {
    this.options = { ...this.options, ...options }
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

  /** Something a player said, which the agent should respond to. */
  queue(message: string): void {
    this.pending.push(message)
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
        await this.runTurn(trigger)
      }
    } finally {
      this.busy = false
      this.lastTurnAt = Date.now()
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
      '- Prefer doing over asking. If an instruction is clear, act on it.',
      '- Work in small steps and check results before continuing.',
      '- Use "set_goal" for anything spanning several turns, and "remember" for facts worth keeping.',
      '  Both are private notes to yourself — there is no need to announce them in chat.',
      '- If a tool fails, read the error and try a different approach rather than repeating it.',
      this.options.owner ? `- Your owner is ${this.options.owner}. Treat their requests as priority.` : '',
      memory
    ]
      .filter(Boolean)
      .join('\n')
  }

  /* ------------------------------------------------------------- turn */

  private async runTurn(trigger: string): Promise<void> {
    const context: ToolContext = {
      bot: this.bot,
      mcData: this.deps.mcData,
      goals: this.deps.goals,
      Movements: this.deps.Movements,
      owner: this.options.owner,
      log: this.events.log,
      addMemory: (note) => {
        this.memory.push(note)
        if (this.memory.length > MAX_MEMORY) this.memory = this.memory.slice(-MAX_MEMORY)
        this.events.memoryChanged(this.notes)
      },
      setGoal: (goal) => {
        this.goal = goal
        this.events.goalChanged(goal)
      },
      signal: this.controller.signal
    }

    this.history.push({ role: 'user', content: `${this.perceive()}\n\n${trigger}` })
    if (this.history.length > MAX_HISTORY) this.history = this.history.slice(-MAX_HISTORY)

    let invalidCalls = 0

    for (let step = 0; step < MAX_STEPS + Math.min(invalidCalls, MAX_STEPS); step++) {
      if (this.controller.signal.aborted) return

      let reply
      try {
        reply = await chat(
          this.options.llm,
          [{ role: 'system', content: this.systemPrompt() }, ...this.history],
          schemasFor(this.options.toolSet ?? 'full'),
          this.controller.signal
        )
      } catch (err) {
        const message = err instanceof LlmError ? err.message : (err as Error).message
        this.events.error(`model call failed: ${message}`)
        return
      }

      if (reply.content) this.events.thought(reply.content)

      // No tool calls means the model is done deciding for this turn.
      if (reply.toolCalls.length === 0) {
        this.history.push({ role: 'assistant', content: reply.content ?? '' })
        // A reply with words but no tool call would be invisible in game, so
        // it gets spoken rather than silently dropped.
        if (reply.content && reply.content.trim()) {
          try {
            this.bot.chat(reply.content.trim().slice(0, 240))
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
        if (this.controller.signal.aborted) return

        const tool = findTool(call.name)
        let result: string
        if (!tool) {
          /*
           * Naming the alternatives matters more than it looks. A bare "no such
           * tool" left models guessing — one run burned an entire turn on
           * walk_north, move, walk, north and go_north in succession — because
           * nothing in the reply told them what the real names were.
           */
          result = `there is no tool called "${call.name}". Available tools: ${schemasFor(this.options.toolSet ?? 'full').map((schema) => schema.name).join(", ")}`
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
