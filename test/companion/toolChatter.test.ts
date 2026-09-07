import { describe, expect, it } from 'vitest'
import { isToolChatter } from '../../src/main/companion/agent'

/**
 * Lines that are about tool calling, not about Minecraft.
 *
 * Some models answer an instruction by narrating their own API. Observed from
 * qwen3:4b, for "say hello", "say your name" and "say goodbye" in turn:
 *
 *   "No function call available for 'say hello'"
 *   "No function calls needed. The instruction..."
 *
 * All three were spoken in Minecraft chat, and the same thing produced the
 * reported "No function calls can be made to set the time to 1000, as none of
 * the provided tools support time manipulation."
 */
describe('recognising talk about tools', () => {
  it('catches the lines a model produces instead of acting', () => {
    for (const line of [
      'No function call available for "say hello"',
      'No function calls needed. The instruction is conversational.',
      'No function calls can be made to set the time to 1000, as none of the provided tools support time manipulation.',
      'I cannot make a tool call for that.',
      'The available function calls do not include time manipulation.'
    ]) {
      expect(isToolChatter(line), line).toBe(true)
    }
  })

  it('catches the model talking about the player in the third person', () => {
    // qwen3:4b produced all three of these for "say hello", "say your name"
    // and "say goodbye" — and every one was spoken aloud in Minecraft chat.
    for (const line of [
      `The user's request "say hello" does not require any action.`,
      'The user asked to "say your name", but no name is configured.',
      'The command "say goodbye" is not supported by the available actions.'
    ]) {
      expect(isToolChatter(line), line).toBe(true)
    }
  })

  it('lets real dialogue through', () => {
    for (const line of [
      'Hello!',
      'I found some iron over there.',
      "It's getting dark, we should head back.",
      'I cannot reach that chest — there is a wall in the way.',
      'I have 12 oak logs and a stone pickaxe.'
    ]) {
      expect(isToolChatter(line), line).toBe(false)
    }
  })

  it('treats an empty line as nothing worth saying', () => {
    expect(isToolChatter('')).toBe(true)
    expect(isToolChatter('   ')).toBe(true)
  })

  it('leaves a long sentence alone even if it mentions tools', () => {
    /*
     * A companion explaining itself at length is having a conversation. Only
     * short lines whose whole content is about calling functions are caught —
     * over-filtering would silence the companion, which is the worse failure.
     */
    const long =
      'I looked through everything I am carrying and the only tool call I could sensibly make ' +
      'was to check the chests nearby, but there are none within thirty blocks of here, so I ' +
      'walked back to the shore instead and waited for you to catch up with the boat.'
    expect(isToolChatter(long)).toBe(false)
  })
})
