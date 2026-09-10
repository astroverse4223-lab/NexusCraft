import { describe, expect, it } from 'vitest'

/*
 * The exact lines the Nexus server wrote, copied from its log.
 *
 * The launcher used to watch for "Dave joined the game", which is a chat
 * message any plugin may replace - and the Nexus plugin does, with "+ Dave".
 * So every player list stayed empty on the one server this launcher exists to
 * run. These are the server's own lines about its own business.
 */
const JOINED =
  /\]: ([A-Za-z0-9_]{3,16}) joined the game/
const LOGGED_IN =
  /\]: ([A-Za-z0-9_]{3,16})\[\/[^\]]*\] logged in with entity id/
const LEFT = /\]: ([A-Za-z0-9_]{3,16}) left the game/
const LOST = /\]: ([A-Za-z0-9_]{3,16}) lost connection/

const nameFrom = (line: string): string | null =>
  (JOINED.exec(line) ?? LOGGED_IN.exec(line))?.[1] ?? null

const goneFrom = (line: string): string | null =>
  (LEFT.exec(line) ?? LOST.exec(line))?.[1] ?? null

describe('spotting players in the console', () => {
  it('sees a join on a server whose message a plugin replaced', () => {
    const line =
      '[11:00:43] [Server thread/INFO]: Dave0734[/127.0.0.1:50073] logged in with ' +
      'entity id 79 at ([minecraft:imperial_olympus_world]0.69, 100.0, 0.41)'

    expect(nameFrom(line)).toBe('Dave0734')
  })

  it('still sees the ordinary vanilla join', () => {
    const line = '[09Sep2026 09:51:44.152] [Server thread/INFO]: Dave0734 joined the game'
    expect(nameFrom(line)).toBe('Dave0734')
  })

  it('sees a leave both ways', () => {
    expect(goneFrom('[11:05:00] [Server thread/INFO]: Dave0734 lost connection: Disconnected')).toBe(
      'Dave0734'
    )
    expect(goneFrom('[11:05:00] [Server thread/INFO]: Dave0734 left the game')).toBe('Dave0734')
  })

  it('is not fooled by the plugin line that replaced the join', () => {
    // "+ Dave0734" is the Nexus plugin's own greeting, and matching it would
    // mean matching any line that happens to start with a symbol and a name.
    expect(nameFrom('[11:00:43] [Server thread/INFO]: + Dave0734')).toBeNull()
  })

  it('does not take a name out of a command somebody ran', () => {
    const line =
      '[11:01:18] [Server thread/INFO]: Dave0734 issued server command: /give @p minecraft:bow'

    expect(nameFrom(line)).toBeNull()
    expect(goneFrom(line)).toBeNull()
  })

  it('does not treat the authenticator line as a join', () => {
    const line =
      '[11:00:42] [User Authenticator #0/INFO]: UUID of player Dave0734 is 4d719be5-a3d0'

    expect(nameFrom(line)).toBeNull()
  })
})
