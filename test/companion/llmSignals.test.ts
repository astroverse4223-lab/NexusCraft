import { afterEach, describe, expect, it, vi } from 'vitest'
import { getEventListeners } from 'node:events'
import { chat } from '../../src/main/companion/llm'

/**
 * The abort listeners a model call leaves behind.
 *
 * One turn makes a model call per tool step, all sharing the turn's signal, and
 * each call used to add a listener to it and never take it off. After a dozen
 * steps Node started warning: "MaxListenersExceededWarning: 11 abort listeners
 * added to [AbortSignal]". It is a leak rather than a crash, which is exactly
 * why it needs a test — nothing else would ever notice.
 */

const config = {
  baseUrl: 'http://127.0.0.1:11434/v1',
  apiKey: '',
  model: 'test-model',
  timeoutMs: 5000
}

function reply(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('abort listeners on a shared signal', () => {
  it('leaves none behind after a run of calls', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        reply({ choices: [{ message: { content: 'fine' } }], usage: { total_tokens: 1 } })
      )
    )

    const turn = new AbortController()

    for (let step = 0; step < 20; step += 1) {
      await chat(config, [{ role: 'user', content: 'hello' }], [], turn.signal)
    }

    expect(getEventListeners(turn.signal, 'abort')).toHaveLength(0)
  })

  it('leaves none behind when the endpoint refuses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 500 }))
    )

    const turn = new AbortController()

    for (let step = 0; step < 5; step += 1) {
      await chat(config, [{ role: 'user', content: 'hello' }], [], turn.signal).catch(() => undefined)
    }

    expect(getEventListeners(turn.signal, 'abort')).toHaveLength(0)
  })

  it('leaves none behind when the connection fails outright', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('fetch failed')
      })
    )

    const turn = new AbortController()

    // Retries happen inside one call; the listener still belongs to that call.
    await chat(config, [{ role: 'user', content: 'hello' }], [], turn.signal).catch(() => undefined)

    expect(getEventListeners(turn.signal, 'abort')).toHaveLength(0)
  })

  it('still aborts the request when the turn is cancelled', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
          })
      )
    )

    const turn = new AbortController()
    const call = chat(config, [{ role: 'user', content: 'hello' }], [], turn.signal)
    turn.abort()

    await expect(call).rejects.toThrow(/cancelled|abort/i)
  })
})
