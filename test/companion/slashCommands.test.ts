import { describe, expect, it } from 'vitest'
import { isForMe } from '../../src/main/companion/chatGate'
import { isToolChatter } from '../../src/main/companion/agent'

/**
 * Typing `/time set 1000` at the server had the nearest companion take it as an
 * instruction, fail to find a tool for it, and announce that in Minecraft chat:
 *
 *   <Andy> No function available to set game time to 1000. The provided tools
 *          do not include time manipulation capabilities.
 *
 * Two faults in one line. The gate should not have passed a server command on,
 * and that reply should never have been spoken aloud.
 */
const audience = { me: 'Andy', siblings: ['GLM', 'Miner'], owner: 'Error420s' }

describe('server commands are not instructions', () => {
  it('ignores the command that started this', () => {
    expect(isForMe('Error420s', '/time set 1000', audience)).toBe(false)
  })

  it('ignores every other slash command, whoever types it', () => {
    for (const command of ['/gamemode creative', '/tp Andy', '/give @p stone', '/weather clear']) {
      expect(isForMe('Error420s', command, audience), command).toBe(false)
      expect(isForMe('SomeoneElse', command, audience), command).toBe(false)
    }
  })

  it('ignores one that is named at the companion, since it is still the server being addressed', () => {
    expect(isForMe('Error420s', '/tp Andy 0 64 0', audience)).toBe(false)
  })

  it('ignores it despite leading whitespace', () => {
    expect(isForMe('Error420s', '   /time set 1000', audience)).toBe(false)
  })

  it('still hears an ordinary instruction from the owner', () => {
    expect(isForMe('Error420s', 'build a cottage here', audience)).toBe(true)
    expect(isForMe('Error420s', 'Andy, follow me', audience)).toBe(true)
  })

  it('does not mistake a sentence merely containing a slash', () => {
    expect(isForMe('Error420s', 'put the chest left/right of the door', audience)).toBe(true)
  })
})

describe('the companion does not narrate its tooling', () => {
  it('blocks the line from the screenshot', () => {
    expect(
      isToolChatter(
        'No function available to set game time to 1000. The provided tools do not include time manipulation capabilities.'
      )
    ).toBe(true)
  })

  it('blocks the shapes around it', () => {
    const lines = [
      'No function calls needed for this request.',
      'The provided tools do not include time manipulation capabilities.',
      'No tool available for that.',
      'I do not have a tool for changing the time.',
      "I don't have a function for that.",
      'The available functions do not cover this.'
    ]
    for (const line of lines) expect(isToolChatter(line), line).toBe(true)
  })

  it('still lets a companion actually talk', () => {
    const lines = [
      'Sure, on my way!',
      'Built the cottage — it came out well.',
      'I cannot change the time, sorry.',
      'That took a while, the stone was further than I thought.',
      'Give me a second, I am fighting a skeleton.'
    ]
    for (const line of lines) expect(isToolChatter(line), line).toBe(false)
  })

  it('does not silence a long, genuine explanation that happens to mention tools', () => {
    const real =
      'I ran out of tools while mining — the pickaxe broke about halfway through, so I came back to make another one before finishing the tunnel you asked for. Should be about five minutes.'
    expect(isToolChatter(real)).toBe(false)
  })
})
