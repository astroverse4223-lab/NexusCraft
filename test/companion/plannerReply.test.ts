import { afterEach, describe, expect, it, vi } from 'vitest'
import { chat } from '../../src/main/companion/llm'
import { parseBlueprint } from '../../src/main/companion/build/blueprint'

/**
 * A reply to a caller that offered no tools must come back as content.
 *
 * The blueprint planner asks the model for JSON and passes no tools at all.
 * Tool-call salvage looks for a JSON object with a `name` key — which is
 * exactly the shape of a blueprint — so it claimed the planner's answer as a
 * tool call and blanked the content. Every `build_structure` then failed with
 * "could not plan that: no JSON object in the reply", ten times in a row in the
 * run that found it, using the whole turn.
 */

const config = {
  baseUrl: 'http://127.0.0.1:11434/v1',
  apiKey: '',
  model: 'test-model',
  timeoutMs: 5000
}

const BLUEPRINT = JSON.stringify({
  name: 'Small Cottage',
  description: 'a cottage',
  palette: { s: 'cobblestone', w: 'oak_planks' },
  layers: [
    ['sss', 'sss', 'sss'],
    ['www', 'w.w', 'www']
  ]
})

function reply(content: string): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content } }], usage: { total_tokens: 1 } }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('a reply to a caller that offered no tools', () => {
  it('keeps the blueprint JSON as content', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply(BLUEPRINT)))

    const result = await chat(config, [{ role: 'user', content: 'draw a cottage' }], [])

    expect(result.toolCalls).toHaveLength(0)
    expect(result.content).toBeTruthy()
    // And the thing the planner actually does with it works.
    expect(parseBlueprint(result.content ?? '').name).toBe('Small Cottage')
  })

  it('keeps it even when the model wraps it in a code fence', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply('Here you go:\n```json\n' + BLUEPRINT + '\n```')))

    const result = await chat(config, [{ role: 'user', content: 'draw a cottage' }], [])
    expect(result.toolCalls).toHaveLength(0)
    expect(parseBlueprint(result.content ?? '').layers).toHaveLength(2)
  })

  it('still rescues a tool call when tools were offered', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply('{"name": "look_around", "args": {}}')))

    const tools = [{ name: 'look_around', description: 'look', parameters: { type: 'object', properties: {} } }]
    const result = await chat(config, [{ role: 'user', content: 'what is around' }], tools)

    expect(result.toolCalls).toHaveLength(1)
    expect(result.toolCalls[0].name).toBe('look_around')
  })
})
