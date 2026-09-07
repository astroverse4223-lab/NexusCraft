import { describe, expect, it } from 'vitest'
import { commandVerbs, forbiddenVerb } from '../../src/main/companion/tools/support/commandSafety'

/**
 * What a companion is allowed to run on somebody's server.
 *
 * It is an operator there, so this is the one tool that can do damage nothing
 * else can undo. The check used to read only the first word of the command,
 * which meant `execute as @a run stop` was waved through — the verb it saw was
 * `execute`, and the server stopped.
 */
describe('command safety', () => {
  it('allows the ordinary things a companion needs', () => {
    for (const command of [
      'time set day',
      'weather clear',
      'tp Steve',
      'give @s torch 16',
      'gamemode creative',
      'say hello'
    ]) {
      expect(forbiddenVerb(command), command).toBeNull()
    }
  })

  it('refuses commands that lock people out', () => {
    expect(forbiddenVerb('stop')).toBe('stop')
    expect(forbiddenVerb('ban Steve')).toBe('ban')
    expect(forbiddenVerb('deop Error420s')).toBe('deop')
  })

  it('refuses commands that destroy things irreversibly', () => {
    // `kill @e` removes every entity in the world.
    expect(forbiddenVerb('kill @e')).toBe('kill')
    expect(forbiddenVerb('clear @a')).toBe('clear')
    expect(forbiddenVerb('worldborder set 1')).toBe('worldborder')
  })

  it('sees through execute, which can carry anything', () => {
    expect(forbiddenVerb('execute as @a run stop')).toBe('stop')
    expect(forbiddenVerb('execute at @p run kill @e')).toBe('kill')
    expect(forbiddenVerb('execute as @a at @s run deop @s')).toBe('deop')
  })

  it('still allows a harmless execute', () => {
    expect(forbiddenVerb('execute as @p run say hello')).toBeNull()
    expect(forbiddenVerb('execute at @p run setblock ~ ~ ~ stone')).toBeNull()
  })

  it('does not mistake a word for the command of the same name', () => {
    // "clear" here is a weather type, not the `clear` command.
    expect(forbiddenVerb('weather clear')).toBeNull()
    // "kill" as part of a message is not the `kill` command either.
    expect(forbiddenVerb('say do not kill the sheep')).toBeNull()
  })

  it('ignores a leading slash and stray spacing', () => {
    expect(forbiddenVerb('  /stop  ')).toBe('stop')
    expect(forbiddenVerb('/execute   as @a   run   kick Steve')).toBe('kick')
  })

  it('reads the verbs out of a nested command', () => {
    expect(commandVerbs('execute as @a run say hi')).toEqual(['execute', 'say'])
    expect(commandVerbs('time set day')).toEqual(['time'])
    expect(commandVerbs('')).toEqual([])
  })

  it('is not case sensitive', () => {
    expect(forbiddenVerb('STOP')).toBe('stop')
    expect(forbiddenVerb('Execute as @a RUN Stop')).toBe('stop')
  })
})
