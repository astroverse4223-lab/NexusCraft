import type { Tool } from './types'

/**
 * The live tool table, kept apart from `index.ts` on purpose.
 *
 * Several tools call other tools — `smelt` reaches for `craft_item` when it is
 * short of fuel, `go_home` reuses `go_to` — so they need to look one up by
 * name. Importing the assembled list from `index.ts` would make every set file
 * a cyclic dependency of the module that assembles them. Registering into this
 * small, import-free module instead breaks the cycle: the sets only ever read
 * from it at call time, by which point `index.ts` has filled it in.
 */
let registered: Tool[] = []

export function registerTools(tools: Tool[]): void {
  registered = tools
}

export function allTools(): Tool[] {
  return registered
}

export function findTool(name: string): Tool | undefined {
  return registered.find((t) => t.schema.name === name)
}
