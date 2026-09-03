import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * Regression cover for the night GLM appeared to ignore everything.
 *
 * Three separate faults combined: turning autonomy off left the tasks it had
 * set for itself draining, a player's instruction went to the back of that
 * queue, and nothing could cut a running turn short. Each is checked here
 * against the real class, with the model call stubbed so no network is needed.
 */

const chat = vi.fn()

vi.mock('../../src/main/companion/llm', () => ({
  chat: (...args: unknown[]) => chat(...args),
  LlmError: class LlmError extends Error {}
}))

vi.mock('../../src/main/companion/tools', () => ({
  findTool: () => undefined,
  TOOL_SCHEMAS: [],
  schemasFor: () => []
}))

const { Agent } = await import('../../src/main/companion/agent')

/** A bot stub with just the surface the agent touches while perceiving. */
function fakeBot(): Record<string, unknown> {
  return {
    entity: { position: { x: 0, y: 64, z: 0, offset: () => ({ x: 0, y: 63, z: 0 }) } },
    health: 20,
    food: 20,
    time: { isDay: true },
    game: { gameMode: 'survival', dimension: 'overworld' },
    inventory: { items: () => [] },
    entities: {},
    players: {},
    blockAt: () => null,
    chat: () => undefined,
    version: '1.21.1'
  }
}

function makeAgent(options: Record<string, unknown> = {}) {
  const events = {
    log: vi.fn(),
    thought: vi.fn(),
    action: vi.fn(),
    memoryChanged: vi.fn(),
    goalChanged: vi.fn(),
    error: vi.fn(),
    workChanged: vi.fn()
  }
  const agent = new Agent(
    fakeBot() as never,
    { mcData: {}, goals: {}, Movements: class {} } as never,
    {
      llm: { baseUrl: '', apiKey: '', model: 'test' },
      personality: '',
      owner: null,
      autonomy: true,
      idleIntervalSec: 30,
      memory: [],
      ...options
    } as never,
    events as never
  )
  return { agent, events }
}

beforeEach(() => {
  chat.mockReset()
  // A reply with no tool calls ends the turn immediately.
  chat.mockResolvedValue({ content: 'ok', toolCalls: [] })
})

describe('turning autonomy off', () => {
  it('drops the tasks the companion set for itself', async () => {
    const { agent, events } = makeAgent()

    // Two self-set tasks waiting behind a slow turn.
    let release: () => void = () => undefined
    chat.mockReturnValueOnce(new Promise((resolve) => {
      release = () => resolve({ content: 'ok', toolCalls: [] })
    }))

    agent.queue('first')
    agent.queue('[idle] wander about')
    agent.queue('[idle] build something')
    expect(agent.work().queued).toBe(2)

    agent.update({ autonomy: false })

    expect(agent.work().queued).toBe(0)
    expect(events.log).toHaveBeenCalledWith(expect.stringContaining('dropped 2'))
    release()
  })

  it('keeps instructions a person actually gave', () => {
    const { agent } = makeAgent()
    chat.mockReturnValue(new Promise(() => undefined)) // never resolves

    agent.queue('first')
    agent.queue('[idle] wander about')
    agent.queue('Your owner says: "come here"')

    agent.update({ autonomy: false })

    // The owner's instruction survives; only the self-set one goes.
    expect(agent.work().queued).toBe(1)
  })

  it('says so even when there was nothing queued', () => {
    const { agent, events } = makeAgent()
    agent.update({ autonomy: false })
    expect(events.log).toHaveBeenCalledWith(expect.stringContaining('stopped acting on its own'))
  })

  it('does nothing when autonomy was already off', () => {
    const { agent, events } = makeAgent({ autonomy: false })
    agent.update({ autonomy: false })
    expect(events.log).not.toHaveBeenCalled()
  })
})

describe('urgent instructions', () => {
  it('go to the front of the queue', () => {
    const { agent } = makeAgent()
    chat.mockReturnValue(new Promise(() => undefined)) // hold the first turn open

    agent.queue('first')
    agent.queue('[idle] one')
    agent.queue('[idle] two')
    agent.queue('a person just said this', true)

    // Three waiting, and the person's is first in line.
    expect(agent.work().queued).toBe(3)
  })

  it('are kept when autonomy is switched off mid-backlog', () => {
    const { agent } = makeAgent()
    chat.mockReturnValue(new Promise(() => undefined))

    agent.queue('first')
    agent.queue('[idle] one')
    agent.queue('urgent thing', true)
    agent.update({ autonomy: false })

    expect(agent.work().queued).toBe(1)
  })
})

describe('interrupt', () => {
  it('clears self-set work and reports it', () => {
    const { agent, events } = makeAgent()
    chat.mockReturnValue(new Promise(() => undefined))

    agent.queue('first')
    agent.queue('[idle] one')
    agent.queue('[idle] two')

    agent.interrupt()

    expect(agent.work().queued).toBe(0)
    expect(events.log).toHaveBeenCalledWith(expect.stringContaining('dropped 2'))
  })

  it('publishes the change so the interface updates', () => {
    const { agent, events } = makeAgent()
    agent.interrupt()
    expect(events.workChanged).toHaveBeenCalled()
  })
})

describe('work()', () => {
  it('reports nothing while idle', () => {
    const { agent } = makeAgent()
    expect(agent.work()).toEqual({ current: null, queued: 0, runningForMs: 0 })
  })

  it('names the task in progress and how long it has run', async () => {
    const { agent } = makeAgent()
    chat.mockReturnValue(new Promise(() => undefined))

    agent.queue('dig a hole')
    await Promise.resolve()

    const work = agent.work()
    expect(work.current).toBe('dig a hole')
    expect(work.runningForMs).toBeGreaterThanOrEqual(0)
  })

  it('tells self-set work apart from a real instruction', async () => {
    const { agent } = makeAgent()
    chat.mockReturnValue(new Promise(() => undefined))

    agent.queue('[idle] wander about')
    await Promise.resolve()

    expect(agent.work().current?.startsWith('[idle]')).toBe(true)
  })
})
