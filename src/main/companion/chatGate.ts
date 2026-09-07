/**
 * Deciding whether a line of chat was meant for this companion.
 *
 * Its own file, and a pure function, because getting it wrong is expensive and
 * invisible. Every companion listens to the same chat, so a rule that is
 * slightly too generous means one instruction sets four bots off at once — and
 * with a local model, four simultaneous requests is the launcher appearing to
 * freeze. The first version of this shipped with exactly that fault.
 */

export interface ChatAudience {
  /** This companion's Minecraft username. */
  me: string
  /** The other companions currently connected. */
  siblings: string[]
  /** The player this companion answers to, if one is set. */
  owner: string | null
}

/**
 * Whether `message` from `username` is this companion's business.
 *
 * The rules, in order:
 *
 *  - Another companion's chatter is never an instruction, unless it names us.
 *    Bots announce what they are doing, and one saying "building Stone
 *    Watchtower..." must not set the other three building one.
 *  - A message naming a different companion is for them. "Andy build a cottage"
 *    reaches Andy alone.
 *  - Otherwise: being named, or being addressed by the owner, counts. With no
 *    owner set, anything from a person counts.
 */
export function isForMe(username: string, message: string, audience: ChatAudience): boolean {
  const said = message.toLowerCase()
  const me = audience.me.toLowerCase()

  const namesMe = said.includes(me)

  const fromSibling = audience.siblings.some((name) => name.toLowerCase() === username.toLowerCase())
  /*
   * A slash command is aimed at the server, not at a companion.
   *
   * Changing the time with `/time set 1000` had the nearest companion abandon
   * what it was doing, look for a tool to do it with, and announce in chat
   * that it had none. Nothing beginning with a slash is ever an instruction to
   * a bot, whoever typed it — and a companion that answers them is answering
   * half of what its owner types at the server all day.
   */
  if (message.trim().startsWith('/')) return false

  if (fromSibling && !namesMe) return false

  const namesAnother = audience.siblings.some((name) => {
    const other = name.toLowerCase()
    return other !== me && said.includes(other)
  })
  if (namesAnother && !namesMe) return false

  if (namesMe) return true
  if (!audience.owner) return true
  return username.toLowerCase() === audience.owner.toLowerCase()
}
