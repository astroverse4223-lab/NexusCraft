/**
 * Shapes shared by every companion tool.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ToolSchema } from '../llm'

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
}

export interface Tool {
  schema: ToolSchema
  /** `memory` is passed so a tool can read notes the bot has written itself. */
  execute: (context: ToolContext, args: Record<string, any>, memory?: string[]) => Promise<string>
}
