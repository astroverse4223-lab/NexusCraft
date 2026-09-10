import { describe, expect, it } from 'vitest'

import { foldToModels, modelLabel, type ModelSource } from '../../src/main/services/banners/brainModels'

/**
 * Which models a generator offers.
 *
 * The list is built from the AI companions, which is convenient and was also
 * wrong: it offered Andy, LumberJack, Miner and HighWorldBot as if they were
 * four different things to think with, when they are four characters sharing
 * one Ollama install. Nothing about a companion except its model reaches the
 * request a generator makes.
 */

const bot = (over: Partial<ModelSource> = {}): ModelSource => ({
  id: 'a',
  baseUrl: 'http://localhost:11434/v1',
  provider: 'ollama',
  model: 'llama3.1',
  hasApiKey: false,
  ...over
})

describe('the models a generator can pick', () => {
  it('folds companions sharing one model into a single choice', () => {
    const folded = foldToModels([
      bot({ id: 'andy' }),
      bot({ id: 'lumberjack' }),
      bot({ id: 'miner' }),
      bot({ id: 'highworldbot' })
    ])

    expect(folded).toHaveLength(1)
    expect(folded[0].model).toBe('llama3.1')
  })

  it('keeps genuinely different models apart', () => {
    const folded = foldToModels([
      bot({ id: 'a', model: 'llama3.1' }),
      bot({ id: 'b', model: 'qwen2.5' }),
      bot({
        id: 'c',
        baseUrl: 'https://api.z.ai/api/paas/v4',
        provider: 'zai',
        model: 'glm-4.6',
        hasApiKey: true
      })
    ])

    expect(folded.map((b) => b.model).sort()).toEqual(['glm-4.6', 'llama3.1', 'qwen2.5'])
  })

  it('drops a companion that has no model chosen', () => {
    expect(foldToModels([bot({ model: '' })])).toEqual([])
  })

  it('prefers the companion that actually has the key', () => {
    const remote = { baseUrl: 'https://api.z.ai/api/paas/v4', provider: 'zai', model: 'glm-4.6' }

    const folded = foldToModels([
      bot({ id: 'keyless', ...remote, hasApiKey: false }),
      bot({ id: 'keyed', ...remote, hasApiKey: true })
    ])

    expect(folded).toHaveLength(1)
    expect(folded[0].id).toBe('keyed')
    expect(folded[0].ready).toBe(true)
  })

  it('does not swap a working entry for a later broken one', () => {
    const remote = { baseUrl: 'https://api.z.ai/api/paas/v4', provider: 'zai', model: 'glm-4.6' }

    const folded = foldToModels([
      bot({ id: 'keyed', ...remote, hasApiKey: true }),
      bot({ id: 'keyless', ...remote, hasApiKey: false })
    ])

    expect(folded[0].id).toBe('keyed')
  })

  it('counts anything local as configured, because Ollama takes no key', () => {
    expect(foldToModels([bot({ baseUrl: 'http://127.0.0.1:11434/v1' })])[0].ready).toBe(true)
  })
})

describe('what a model is called in the list', () => {
  it('names the model and says it is local', () => {
    expect(modelLabel('http://localhost:11434/v1', 'ollama', 'llama3.1')).toBe('llama3.1 · Ollama')
  })

  it('names the host for a remote one, without the api prefix', () => {
    expect(modelLabel('https://api.z.ai/api/paas/v4', 'zai', 'glm-4.6')).toBe('glm-4.6 · z.ai')
  })

  it('falls back to the provider when the url will not parse', () => {
    expect(modelLabel('not a url', 'zai', 'glm-4.6')).toBe('glm-4.6 · zai')
  })

  it('is still the model on its own when there is nothing else to say', () => {
    expect(modelLabel('not a url', '', 'glm-4.6')).toBe('glm-4.6')
  })
})
