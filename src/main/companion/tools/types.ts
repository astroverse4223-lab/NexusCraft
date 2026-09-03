/**
 * Shapes shared by every companion tool.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { LlmConfig, ToolSchema } from '../llm'

export interface ToolContext {
  bot: any
  mcData: any
  goals: any
  Movements: any
  /** Player the companion treats as its owner, for "come here" and similar. */
  owner: string | null
  log: (message: string) => void
  addMemory: (note: string) => void
  setGoal: (goal: string | null) => void
  /** Aborts long-running actions when the user stops the bot. */
  signal: AbortSignal
  /**
   * Where the owner last died, when anything has been seen.
   *
   * Optional because the watcher is started by the bot process and tools are
   * also exercised in tests, where there is no live player to die.
   */
  deathWatch?: {
    site: () => { x: number; y: number; z: number; dimension: string; at: number; cause: string | null } | null
    timeLeft: () => number
    forget: () => void
  }
  /**
   * The model this companion runs on, for the few tools that need one of their
   * own — drawing a blueprint is a big structured answer that does not belong
   * in the middle of an agent turn. Absent for routine-driven workers, which
   * have no model at all.
   */
  llm?: LlmConfig
}

export interface Tool {
  schema: ToolSchema
  /** `memory` is passed so a tool can read notes the bot has written itself. */
  execute: (context: ToolContext, args: Record<string, any>, memory?: string[]) => Promise<string>
}
