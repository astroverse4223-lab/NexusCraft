/**
 * Deciding whether a companion may run a Minecraft command.
 *
 * The companion is an operator on the player's own server, so `run_command` is
 * the one tool that can do damage nothing else can undo. The model is not
 * malicious, but it is confused often enough that "it seemed like a good idea"
 * must not be able to ban somebody, wipe an inventory, or delete every entity
 * in the world.
 *
 * Its own file, and pure, because a safety check that cannot be tested is not
 * one — and the first version had a hole wide enough to drive anything through.
 */

/**
 * Commands refused outright.
 *
 * Two kinds: administrative ones that can lock people out of their own server,
 * and destructive ones with no undo. `kill` is the sharpest of them — `kill @e`
 * removes every entity in the world, which is every dropped item, every animal,
 * every item frame and every armour stand somebody placed.
 */
export const FORBIDDEN_COMMANDS = new Set([
  // Locking people out, or out of control of their own server.
  'stop', 'ban', 'ban-ip', 'banlist', 'pardon', 'pardon-ip', 'kick',
  'op', 'deop', 'whitelist', 'save-off', 'setidletimeout',
  'forceload', 'reload', 'debug', 'perf', 'jfr', 'datapack',

  /*
   * Destructive, and not obviously so to a model reaching for a quick fix.
   * `kill` and `clear` read as tidying up; both are irreversible and both take
   * a selector that can mean everyone and everything.
   */
  'kill', 'clear',

  // Quietly changes the world out from under the player.
  'worldborder', 'setworldspawn', 'defaultgamemode', 'gamerule', 'difficulty'
])

/**
 * Every command verb inside a command, including wrapped ones.
 *
 * `execute` is why this exists. It can carry any other command after `run`, so
 * checking only the first word let `execute as @a run stop` straight through —
 * the filter saw `execute`, which is harmless on its own, and shut the server
 * down. Anything after a `run` is a command in its own right and is checked
 * like one.
 *
 * Only the first word and the words after `run` count as verbs. Scanning every
 * token instead would refuse `weather clear`, which is not the `clear` command
 * at all — it is a weather type, and blocking it would be the check being wrong
 * in the other direction.
 */
export function commandVerbs(command: string): string[] {
  const parts = command
    .trim()
    .replace(/^\//, '')
    .split(/\s+/)
    .filter(Boolean)
  if (parts.length === 0) return []

  const verbs = [parts[0].toLowerCase()]
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (parts[i].toLowerCase() === 'run') verbs.push(parts[i + 1].toLowerCase())
  }
  return verbs
}

/** The first refused verb in a command, or null if it is allowed. */
export function forbiddenVerb(command: string): string | null {
  for (const verb of commandVerbs(command)) {
    if (FORBIDDEN_COMMANDS.has(verb)) return verb
  }
  return null
}
