import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { findLocalModel, forgetLocalModel } from '../../src/main/services/launch/localModel'

vi.mock('../../src/main/core/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
}))

/**
 * Which local model gets picked for crash diagnosis.
 *
 * The ranking is not cosmetic. Diagnosis asks for JSON about a crash report,
 * and the models measured on this machine differ enormously at that: a plain
 * instruct model answers in a fraction of a second, a reasoning model takes ten
 * seconds and can emit its chain of thought as the answer, and an agent-tuned
 * model replies in its own command syntax and ignores the question. Picking the
 * wrong one looks like the feature being broken.
 */

const original = globalThis.fetch

function ollamaWith(names: string[]): void {
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({ models: names.map((name) => ({ name })) })
  })) as unknown as typeof fetch
}

beforeEach(() => forgetLocalModel())
afterEach(() => {
  globalThis.fetch = original
  forgetLocalModel()
})

describe('findLocalModel', () => {
  it('returns nothing when Ollama is not running', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED')
    }) as unknown as typeof fetch
    expect(await findLocalModel()).toBeNull()
  })

  it('points at the OpenAI-compatible path, not the native one', async () => {
    ollamaWith(['qwen2.5:7b-instruct'])
    const found = await findLocalModel()
    // Without /v1 every request 404s.
    expect(found?.baseUrl).toBe('http://127.0.0.1:11434/v1')
    expect(found?.apiKey).toBe('')
  })

  it('prefers an instruct model over a reasoning one', async () => {
    ollamaWith(['deepseek-r1:8b', 'qwen2.5:7b-instruct'])
    expect((await findLocalModel())?.model).toBe('qwen2.5:7b-instruct')
  })

  it('refuses the agent-tuned model even when it is the only Minecraft one', async () => {
    // andy answers in its own command vocabulary and ignores the format.
    ollamaWith(['sweaterdog/andy-4:latest'])
    expect(await findLocalModel()).toBeNull()
  })

  it('refuses reasoning and code models outright', async () => {
    ollamaWith(['deepseek-r1:8b', 'qwen2.5-coder:7b'])
    expect(await findLocalModel()).toBeNull()
  })

  it('takes an unrecognised model rather than giving up', async () => {
    ollamaWith(['some-new-model:4b'])
    expect((await findLocalModel())?.model).toBe('some-new-model:4b')
  })

  it('ranks known families ahead of unknown ones', async () => {
    ollamaWith(['zzz-unknown:7b', 'llama3.1:8b'])
    expect((await findLocalModel())?.model).toBe('llama3.1:8b')
  })

  it('caches, so a crash does not re-probe on every question', async () => {
    ollamaWith(['qwen2.5:7b-instruct'])
    await findLocalModel()
    await findLocalModel()
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })
})
