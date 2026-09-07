import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { IpcRequestSchemas } from '../../src/shared/ipc'
import { IPC_CHANNELS } from '../../src/shared/channels'

/**
 * Guards the whole IPC surface against the fault that lost ten server settings.
 *
 * Zod's `.object()` strips keys it does not name, and does it silently: the
 * form sends the value, the schema drops it, the service never sees it, and
 * nothing anywhere reports a problem. "Allow flight" was saved, discarded in
 * transit, and showed as off again on reopening — with no error to follow.
 *
 * These checks are structural. They cannot know a field is missing, but they
 * can insist the surface stays coherent: every channel declared, every channel
 * validated, and every handler reachable.
 */
const root = join(__dirname, '..', '..')
const handlers = readFileSync(join(root, 'src', 'main', 'ipc', 'handlers.ts'), 'utf8')
const api = readFileSync(join(root, 'src', 'renderer', 'src', 'api.ts'), 'utf8')

/** Channels the preload/api layer actually calls. */
const called = new Set(
  [...api.matchAll(/'([a-zA-Z]+:[a-zA-Z]+)'/g)].map((m) => m[1]).filter((c) => c.includes(':'))
)

/** Channels the main process registers a handler for. */
const handled = new Set(
  [...handlers.matchAll(/handle\(\s*'([a-zA-Z]+:[a-zA-Z]+)'/g)].map((m) => m[1])
)

describe('the IPC surface', () => {
  it('validates every channel it declares', () => {
    const missing = IPC_CHANNELS.filter((channel) => !(channel in IpcRequestSchemas))
    expect(missing).toEqual([])
  })

  it('declares every channel it validates', () => {
    const stray = Object.keys(IpcRequestSchemas).filter(
      (channel) => !IPC_CHANNELS.includes(channel as never)
    )
    expect(stray).toEqual([])
  })

  it('handles every channel the renderer can call', () => {
    const unhandled = [...called].filter(
      (channel) => IPC_CHANNELS.includes(channel as never) && !handled.has(channel)
    )
    expect(unhandled).toEqual([])
  })

  it('has no handler for a channel that no longer exists', () => {
    const orphans = [...handled].filter((channel) => !IPC_CHANNELS.includes(channel as never))
    expect(orphans).toEqual([])
  })

  /**
   * A schema that passes anything is the same hole by another route: it accepts
   * the payload and hands the service whatever arrived, unchecked.
   */
  it('does not validate any channel with a bare passthrough', () => {
    const loose: string[] = []
    for (const [channel, schema] of Object.entries(IpcRequestSchemas)) {
      if (schema instanceof z.ZodAny || schema instanceof z.ZodUnknown) loose.push(channel)
    }
    expect(loose).toEqual([])
  })
})
