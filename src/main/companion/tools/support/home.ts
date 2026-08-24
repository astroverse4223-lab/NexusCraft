/**
 * Where the companion considers home.
 */

export interface HomePosition {
  x: number
  y: number
  z: number
}

/**
 * Kept in memory as well as written down: this variable dies with the process,
 * and a companion that forgot the base every restart would be no use. The
 * written note is the durable copy and is parsed back on first use.
 *
 * Reached through accessors rather than exported directly, because a module's
 * exported binding is read-only to everyone importing it — the tools that set
 * home live in `sets/movement`, not here.
 */
let homePosition: HomePosition | null = null

export function getHome(): HomePosition | null {
  return homePosition
}

export function setHome(position: HomePosition | null): void {
  homePosition = position
}

export const HOME_NOTE = /home is at (-?\d+) (-?\d+) (-?\d+)/i

export function rememberedHome(memory: string[]): HomePosition | null {
  for (const note of [...memory].reverse()) {
    const match = HOME_NOTE.exec(note)
    if (match) return { x: Number(match[1]), y: Number(match[2]), z: Number(match[3]) }
  }
  return null
}
