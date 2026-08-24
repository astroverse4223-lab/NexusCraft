/**
 * Reading the world's players, and the small utilities every tool needs.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ToolContext } from '../types'

export function itemCounts(bot: any): string {
  const items = bot.inventory.items()
  if (items.length === 0) return 'nothing'
  const totals = new Map<string, number>()
  for (const item of items) totals.set(item.name, (totals.get(item.name) ?? 0) + item.count)
  return [...totals].map(([name, count]) => `${count}x ${name}`).join(', ')
}

export function nearbyPlayers(bot: any): string[] {
  return Object.keys(bot.players).filter((name) => name !== bot.username)
}

/** Resolves the player a command refers to, falling back to the owner. */
export function resolvePlayer(context: ToolContext, username?: string): any | null {
  const name = username ?? context.owner ?? nearbyPlayers(context.bot)[0]
  if (!name) return null
  return context.bot.players[name]?.entity ?? null
}

/**
 * Explains why a player could not be reached.
 *
 * "Cannot see that player" reads as "they are not here", but the usual cause is
 * that they are online and simply beyond render distance, where the server
 * sends no entity. The model needs to tell those apart: one means give up, the
 * other means go and look.
 */
export function explainMissingPlayer(context: ToolContext, username?: string): string {
  const { bot } = context
  const name = username ?? context.owner ?? nearbyPlayers(bot)[0]
  if (!name) return 'nobody else is on the server'

  const listed = bot.players[name]
  if (!listed) {
    const others = nearbyPlayers(bot)
    return others.length
      ? `${name} is not on the server. Online: ${others.join(', ')}`
      : `${name} is not on the server, and nobody else is either`
  }

  return `${name} is online but too far away to locate — the server only sends positions for players nearby. Explore towards them, or ask them where they are.`
}

export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} took too long`)), ms))
  ])
}
