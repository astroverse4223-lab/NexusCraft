/**
 * Message contract between the launcher and the companion bot process.
 *
 * Kept separate from `types.ts` because the bot process imports it directly and
 * must stay free of anything Electron-specific.
 */

export interface CompanionLlmConfig {
  baseUrl: string
  apiKey: string
  model: string
  temperature?: number
  timeoutMs?: number
}

export interface CompanionConfig {
  host: string
  port: number
  username: string
  /** 'offline' for your own LAN world; 'microsoft' signs in as a real account. */
  auth: 'offline' | 'microsoft'
  /** Pin the protocol version, or leave empty to auto-detect. */
  version: string
  owner: string
  personality: string
  autonomy: boolean
  idleIntervalSec: number
  /**
   * How many tools to offer. Small local models handle a short list far better
   * than the full one, which is thirty tools of schema on every request.
   */
  toolSet: 'full' | 'core'
  llm: CompanionLlmConfig
  memory?: string[]
}

export type CompanionStatus = 'idle' | 'connecting' | 'playing' | 'disconnected' | 'error'

/** Launcher -> bot */
export type CompanionInbound =
  | { type: 'start'; config: CompanionConfig }
  | { type: 'instruct'; text: string }
  | { type: 'say'; text: string }
  | { type: 'configure'; autonomy: boolean; personality: string; idleIntervalSec: number }
  | { type: 'stop' }

/** Bot -> launcher */
export type CompanionOutbound =
  | { type: 'status'; status: CompanionStatus; detail: string }
  | { type: 'log'; message: string }
  | { type: 'chat'; from: string; message: string }
  | { type: 'thought'; text: string }
  | { type: 'action'; name: string; args: Record<string, unknown>; result: string }
  | { type: 'memory'; notes: string[] }
  | { type: 'goal'; goal: string | null }
  | { type: 'agentError'; message: string }

/** One line in the interface's activity feed. */
export interface CompanionEvent {
  id: number
  at: number
  kind: 'status' | 'log' | 'chat' | 'thought' | 'action' | 'error'
  text: string
  /** Set for chat lines. */
  from?: string
  /** Set for tool calls. */
  tool?: string
  /** Which companion produced this; feeds are shown per companion. */
  companionId: string
}

export interface CompanionState {
  /** Which companion this belongs to; several run at once. */
  companionId: string
  status: CompanionStatus
  detail: string
  goal: string | null
  memory: string[]
  events: CompanionEvent[]
  /** Minecraft version the bot actually connected with. */
  connectedVersion: string | null
  /**
   * Whether a bot process actually exists. Distinct from `status`: a bot that
   * failed to connect reports `error` while its process is still alive, and the
   * UI must offer Stop in that state rather than a Start that will be refused.
   */
  alive: boolean
}

/** A configured companion: its settings plus the id everything is keyed by. */
export interface Companion extends CompanionSettings {
  id: string
}

/** Settings persisted between sessions. The API key is stored separately. */
export interface CompanionSettings {
  provider: string
  baseUrl: string
  model: string
  host: string
  port: number
  username: string
  auth: 'offline' | 'microsoft'
  version: string
  owner: string
  personality: string
  autonomy: boolean
  idleIntervalSec: number
  /**
   * How many tools to offer. A small local model copes far better with a short
   * list than with the full thirty, which is ~2,300 tokens of schema per call.
   */
  toolSet: 'full' | 'core'
  /** True when an API key is saved in the encrypted store. */
  hasApiKey: boolean
}

export const DEFAULT_PERSONALITY =
  'You are a cheerful, competent Minecraft companion. You enjoy exploring and building, ' +
  'you speak briefly and naturally in chat, and you get on with things without asking for ' +
  'permission on every small step.'
