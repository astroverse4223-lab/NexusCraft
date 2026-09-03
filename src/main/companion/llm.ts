/**
 * A minimal OpenAI-compatible chat client.
 *
 * GLM (Zhipu) and Ollama both expose the same `/chat/completions` shape, so one
 * client with a configurable base URL covers a hosted model and a local one
 * without branching on provider anywhere else in the agent.
 */

export interface LlmConfig {
  /** e.g. https://open.bigmodel.cn/api/paas/v4 or http://localhost:11434/v1 */
  baseUrl: string
  apiKey: string
  model: string
  temperature?: number
  /** Milliseconds before a single completion is abandoned. */
  timeoutMs?: number
}

export interface ToolSchema {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export type ChatMessage =
  | { role: 'system' | 'user' | 'assistant'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls: ToolCall[] }
  | { role: 'tool'; content: string; tool_call_id: string; name?: string }

export interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface LlmReply {
  content: string | null
  toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }>
  /**
   * What the call cost, when the provider says.
   *
   * Every OpenAI-compatible endpoint returns a `usage` block, and a companion
   * left on autonomy makes a call every idle interval whether or not anything
   * happened — so this is the difference between a bot that quietly spends
   * money and one whose running cost is on screen. Absent on providers that
   * omit it, which is why it is optional rather than zero.
   */
  usage?: LlmUsage
}

export interface LlmUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message)
    this.name = 'LlmError'
  }
}

/**
 * Asks the endpoint which models it actually serves.
 *
 * Typing a model name by hand is a guessing game: providers rename and retire
 * models, and the only feedback is a rejected request — GLM answers an unknown
 * name with "模型不存在", which tells a user nothing about what to type instead.
 * Every OpenAI-compatible endpoint exposes this list, including Ollama.
 */
export async function listModels(config: LlmConfig): Promise<string[]> {
  const trimmed = config.baseUrl.replace(/\/+$/, '')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.timeoutMs ?? 20_000)

  let response: Response
  try {
    response = await fetch(`${trimmed}/models`, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {})
      }
    })
  } catch (err) {
    clearTimeout(timer)
    throw new LlmError(`could not reach the model list: ${(err as Error).message}`)
  }
  clearTimeout(timer)

  const text = await response.text()
  if (!response.ok) throw new LlmError(text.slice(0, 200) || `HTTP ${response.status}`, response.status)

  try {
    const parsed = JSON.parse(text) as { data?: Array<{ id?: string }>; models?: Array<{ name?: string }> }
    // OpenAI and GLM use `data[].id`; Ollama's native shape uses `models[].name`.
    const ids = (parsed.data ?? []).map((m) => m.id).filter((id): id is string => Boolean(id))
    const names = (parsed.models ?? []).map((m) => m.name).filter((n): n is string => Boolean(n))
    return [...new Set([...ids, ...names])].sort()
  } catch {
    throw new LlmError('the model list was not JSON')
  }
}

function endpoint(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '')
  return `${trimmed}/chat/completions`
}

/**
 * Some local models ignore the tool-calling protocol and just describe the call
 * in prose. Rather than losing the turn, a JSON object naming a tool is
 * accepted from the message body as a fallback.
 */
/*
 * The MindCraft command dialect.
 *
 * Minecraft-specific models — Andy-4 and its relatives — are fine-tuned on the
 * MindCraft project's syntax rather than on OpenAI tool calling. They ignore the
 * `tools` array entirely and write their action into ordinary prose:
 *
 *     Got it. Collecting wood. !collectBlocks("oak_log", 8)
 *
 * The decision is sound and the arguments are right; only the packaging differs.
 * Rejecting it wastes the one class of model actually trained for this game, so
 * the dialect is translated into our own tools instead.
 *
 * Each entry maps a MindCraft command to one of ours, naming the positional
 * arguments in the order that dialect passes them.
 */
const MINDCRAFT_COMMANDS: Record<string, { tool: string; params: string[] }> = {
  collectblocks: { tool: 'mine_block', params: ['block', 'count'] },
  collectblock: { tool: 'mine_block', params: ['block', 'count'] },
  searchforblock: { tool: 'mine_block', params: ['block'] },
  mine: { tool: 'mine_block', params: ['block', 'count'] },
  craftrecipe: { tool: 'craft_item', params: ['item', 'count'] },
  craft: { tool: 'craft_item', params: ['item', 'count'] },
  smeltitem: { tool: 'smelt', params: ['item', 'count'] },
  placehere: { tool: 'place_block', params: ['block'] },
  placeblock: { tool: 'place_block', params: ['block'] },
  gotoplayer: { tool: 'come_to_player', params: ['username'] },
  gotoplayerposition: { tool: 'come_to_player', params: ['username'] },
  followplayer: { tool: 'follow_player', params: ['username'] },
  gotocoordinates: { tool: 'go_to', params: ['x', 'y', 'z'] },
  gotoposition: { tool: 'go_to', params: ['x', 'y', 'z'] },
  moveaway: { tool: 'explore', params: ['distance'] },
  explore: { tool: 'explore', params: ['distance'] },
  attack: { tool: 'attack_nearest', params: ['mob'] },
  attacknearest: { tool: 'attack_nearest', params: ['mob'] },
  equip: { tool: 'equip', params: ['item'] },
  wear: { tool: 'equip_armor', params: [] },
  consume: { tool: 'eat_food', params: ['item'] },
  eat: { tool: 'eat_food', params: ['item'] },
  discard: { tool: 'drop_item', params: ['item', 'count'] },
  dropitem: { tool: 'drop_item', params: ['item', 'count'] },
  giveplayer: { tool: 'give_to_player', params: ['username', 'item', 'count'] },
  putinchest: { tool: 'store_items', params: ['item', 'count'] },
  takefromchest: { tool: 'take_items', params: ['item', 'count'] },
  activate: { tool: 'use_block', params: ['block'] },
  digdown: { tool: 'dig_down', params: ['depth'] },
  goalsleep: { tool: 'sleep_in_bed', params: [] },
  sleep: { tool: 'sleep_in_bed', params: [] },
  rememberhere: { tool: 'set_home', params: ['name'] },
  gotorememberedplace: { tool: 'go_home', params: ['name'] },
  stop: { tool: 'stop_moving', params: [] },
  stay: { tool: 'wait', params: ['seconds'] },
  inventory: { tool: 'inventory', params: [] },
  stats: { tool: 'look_around', params: [] },
  nearbyblocks: { tool: 'look_around', params: [] },
  entities: { tool: 'look_around', params: [] },
  say: { tool: 'say', params: ['message'] },
  chat: { tool: 'say', params: ['message'] },
  newaction: { tool: 'set_goal', params: ['goal'] },
  goal: { tool: 'set_goal', params: ['goal'] }
}

/** Reads `!command("arg", 12)` — quoted strings, bare numbers, or no arguments. */
function parseMindcraftCall(text: string): LlmReply['toolCalls'] {
  const match = text.match(/!([a-zA-Z]\w*)\s*(?:\(([^)]*)\))?/)
  if (!match) return []

  const known = MINDCRAFT_COMMANDS[match[1].toLowerCase()]
  if (!known) return []

  const values: unknown[] = []
  if (match[2]?.trim()) {
    for (const raw of match[2].match(/"[^"]*"|'[^']*'|[^,\s][^,]*/g) ?? []) {
      const piece = raw.trim()
      if (/^["']/.test(piece)) values.push(piece.slice(1, -1))
      else if (/^-?\d+(\.\d+)?$/.test(piece)) values.push(Number(piece))
      else if (/^(true|false)$/i.test(piece)) values.push(/^true$/i.test(piece))
      else values.push(piece)
    }
  }

  const args: Record<string, unknown> = {}
  known.params.forEach((name, index) => {
    if (values[index] !== undefined) args[name] = values[index]
  })

  return [{ id: `mindcraft_${known.tool}`, name: known.tool, args }]
}

function salvageToolCall(content: string): LlmReply['toolCalls'] {
  // Minecraft-tuned models speak MindCraft, not JSON.
  const mindcraft = parseMindcraftCall(content)
  if (mindcraft.length > 0) return mindcraft

  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = (fenced?.[1] ?? content).trim()

  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end <= start) return []

  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1)) as {
      tool?: string
      name?: string
      action?: string
      args?: Record<string, unknown>
      arguments?: Record<string, unknown>
      parameters?: Record<string, unknown>
    }
    const name = parsed.tool ?? parsed.name ?? parsed.action
    if (!name || typeof name !== 'string') return []
    const args = parsed.args ?? parsed.arguments ?? parsed.parameters ?? {}
    return [{ id: `salvaged_${Date.now()}`, name, args: args as Record<string, unknown> }]
  } catch {
    return []
  }
}

/**
 * Models that think before answering, and so need a longer leash.
 *
 * Matched by name because no endpoint advertises the trait: Ollama simply
 * starts returning a `reasoning` field and the caller is left to cope.
 */
function isReasoningModel(model: string): boolean {
  return /andy|deepseek-r1|qwq|marco-o1|reason|thinking|o1|o3/i.test(model ?? '')
}

export async function chat(
  config: LlmConfig,
  messages: ChatMessage[],
  tools: ToolSchema[],
  signal?: AbortSignal
): Promise<LlmReply> {
  const controller = new AbortController()

  /*
   * Reasoning models think before they speak, and the thinking is billed in
   * tokens like anything else — Andy-4 spends hundreds of them working out what
   * to do before the first byte of the answer appears. On a local Ollama that is
   * comfortably slower than a minute, so the old ceiling cut every request off
   * mid-thought and the launcher reported "the model did not respond in time"
   * for a model that was working perfectly.
   */
  const timeoutMs = config.timeoutMs ?? (isReasoningModel(config.model) ? 180_000 : 60_000)
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  signal?.addEventListener('abort', () => controller.abort(), { once: true })

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  // Ollama needs no key; sending an empty Authorization header upsets some proxies.
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`

  let response: Response
  try {
    response = await fetch(endpoint(config.baseUrl), {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: config.temperature ?? 0.7,
        ...(tools.length > 0
          ? { tools: tools.map((t) => ({ type: 'function', function: t })), tool_choice: 'auto' }
          : {})
      })
    })
  } catch (err) {
    clearTimeout(timer)
    if (controller.signal.aborted) throw new LlmError('the model did not respond in time')
    throw new LlmError(`could not reach the model: ${(err as Error).message}`)
  }
  clearTimeout(timer)

  const text = await response.text()

  if (!response.ok) {
    // Surface the provider's own explanation — it is usually specific
    // (bad key, unknown model, out of credit).
    let detail = text.slice(0, 300)
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string } | string }
      const message = typeof parsed.error === 'string' ? parsed.error : parsed.error?.message
      if (message) detail = message
    } catch {
      /* keep the raw body */
    }
    throw new LlmError(detail || `HTTP ${response.status}`, response.status)
  }

  let parsed: {
    choices?: Array<{
      // `reasoning` is where a thinking model puts its working; content stays
      // empty until it has finished.
      message?: { content?: string | null; reasoning?: string | null; tool_calls?: ToolCall[] }
    }>
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
  }
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new LlmError('the model returned a response that was not JSON')
  }

  const message = parsed.choices?.[0]?.message
  if (!message) throw new LlmError('the model returned no choices')

  const usage: LlmUsage | undefined = parsed.usage
    ? {
        promptTokens: Number(parsed.usage.prompt_tokens ?? 0),
        completionTokens: Number(parsed.usage.completion_tokens ?? 0),
        totalTokens: Number(
          parsed.usage.total_tokens ?? (parsed.usage.prompt_tokens ?? 0) + (parsed.usage.completion_tokens ?? 0)
        )
      }
    : undefined

  const toolCalls = (message.tool_calls ?? []).map((call) => {
    let args: Record<string, unknown> = {}
    try {
      args = call.function.arguments ? (JSON.parse(call.function.arguments) as Record<string, unknown>) : {}
    } catch {
      /* a malformed argument blob becomes an empty call, which the tool rejects */
    }
    return { id: call.id, name: call.function.name, args }
  })

  /*
   * Ollama returns a reasoning model's thinking in its own field and leaves
   * `content` empty until the thinking is done. Reading `content` alone threw
   * away the whole reply — the model had answered, we just were not listening.
   * The thinking is the fallback, never the preference: a model that produced
   * real content gets read normally.
   */
  const reasoning = typeof message.reasoning === 'string' ? message.reasoning.trim() : ''
  const spoken = typeof message.content === 'string' ? message.content.trim() : ''
  const content = spoken || reasoning || null

  if (toolCalls.length === 0) {
    // Small models often describe the call in prose instead of emitting one,
    // and a reasoning model may do it inside its thinking.
    for (const text of [spoken, reasoning]) {
      if (!text) continue
      const salvaged = salvageToolCall(text)
      if (salvaged.length > 0) return { content: null, toolCalls: salvaged, usage }
    }
  }

  return { content, toolCalls, usage }
}

/** Presets so the interface can offer sensible defaults per provider. */
export const PROVIDER_PRESETS: Record<string, { baseUrl: string; needsKey: boolean; label: string; hint: string }> = {
  glm: {
    label: 'GLM (Zhipu AI)',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    needsKey: true,
    hint: 'Use your GLM API key. Load the model list rather than typing a name — GLM retires them.'
  },
  'glm-intl': {
    label: 'GLM (international)',
    baseUrl: 'https://api.z.ai/api/paas/v4',
    needsKey: true,
    hint: 'The international endpoint for the same GLM keys.'
  },
  ollama: {
    label: 'Ollama (local)',
    baseUrl: 'http://localhost:11434/v1',
    needsKey: false,
    hint: 'Runs entirely on this PC. No key, no cost, nothing leaves the machine.'
  },
  openai: {
    label: 'OpenAI-compatible',
    baseUrl: '',
    needsKey: true,
    hint: 'Any endpoint that implements /chat/completions.'
  }
}
