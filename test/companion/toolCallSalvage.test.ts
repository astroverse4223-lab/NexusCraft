import { describe, expect, it } from 'vitest'
import { salvageToolCall } from '../../src/main/companion/llm'

/**
 * Reading a tool call a model wrote as prose.
 *
 * Small local models routinely ignore the tool-calling API and describe the
 * call instead. When that is not understood the call never runs and the raw
 * text lands in the player's activity feed, which is exactly what happened:
 * `<function_call> { "function": "crew_status", "arguments": {} } </function_call>`
 * appeared verbatim in the log while the companion did nothing.
 *
 * Every string here is a shape actually observed or a near neighbour of one.
 */
describe('salvaging a tool call from text', () => {
  it('reads the tagged form a local model produced', () => {
    const calls = salvageToolCall(
      '<function_call> { "function": "crew_status", "arguments": {} } </function_call>'
    )
    expect(calls).toHaveLength(1)
    expect(calls[0].name).toBe('crew_status')
    expect(calls[0].args).toEqual({})
  })

  it('keeps the arguments from a tagged call', () => {
    const calls = salvageToolCall(
      '<tool_call>{"function": "go_to", "arguments": {"x": 10, "y": 64, "z": -3}}</tool_call>'
    )
    expect(calls[0].name).toBe('go_to')
    expect(calls[0].args).toEqual({ x: 10, y: 64, z: -3 })
  })

  it('reads the nested OpenAI shape', () => {
    const calls = salvageToolCall('{"function": {"name": "say", "arguments": {"text": "hello"}}}')
    expect(calls[0].name).toBe('say')
    expect(calls[0].args).toEqual({ text: 'hello' })
  })

  it('parses arguments that arrive as a JSON string', () => {
    const calls = salvageToolCall('{"function": {"name": "say", "arguments": "{\\"text\\":\\"hi\\"}"}}')
    expect(calls[0].name).toBe('say')
    expect(calls[0].args).toEqual({ text: 'hi' })
  })

  it('still reads a fenced json block', () => {
    const calls = salvageToolCall('Sure!\n```json\n{"tool": "look_around", "args": {}}\n```')
    expect(calls[0].name).toBe('look_around')
  })

  it('still reads the older key names', () => {
    expect(salvageToolCall('{"name": "wait", "parameters": {"seconds": 5}}')[0]).toMatchObject({
      name: 'wait',
      args: { seconds: 5 }
    })
  })

  it('finds nothing in ordinary conversation', () => {
    expect(salvageToolCall('I think I will go and chop some wood now.')).toEqual([])
  })

  it('finds nothing in a reply that only reasons about tools', () => {
    // The wall of thinking from the same screenshot: it names tools repeatedly
    // but never actually calls one, and must not be mistaken for a call.
    const rambling =
      'The functions available include crew_status, assign_task, crew_note, etc. ' +
      'Since Blueprint was teleported to Error420s, maybe the user needs to check ' +
      'if Blueprint is still part of the crew or if there is an issue.'
    expect(salvageToolCall(rambling)).toEqual([])
  })
})
