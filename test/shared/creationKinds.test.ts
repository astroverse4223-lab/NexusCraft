import { describe, expect, it } from 'vitest'
import { IpcRequestSchemas } from '../../src/shared/ipc'
import { CREATION_KINDS } from '../../src/shared/types'

/*
 * The schema and the type used to be separate lists. Adding loot updated the
 * type and left the schema refusing to save one - which the interface reported
 * as "nothing saved yet", so the failure looked like the save button doing
 * nothing rather than like a rejected request.
 */
describe('creation kinds', () => {
  it('lets every kind be saved', () => {
    for (const kind of CREATION_KINDS) {
      const parsed = IpcRequestSchemas['creations:save'].safeParse({
        kind,
        name: 'Something',
        data: {}
      })

      expect(parsed.success, `${kind} should be saveable`).toBe(true)
    }
  })

  it('lets every kind be listed', () => {
    for (const kind of CREATION_KINDS) {
      expect(IpcRequestSchemas['creations:list'].safeParse({ kind }).success).toBe(true)
    }
  })

  it('lets every kind ask for variations', () => {
    for (const kind of CREATION_KINDS) {
      const parsed = IpcRequestSchemas['banners:variations'].safeParse({
        kind,
        prompt: 'something',
        companionId: 'a-companion',
        count: 4
      })

      expect(parsed.success, `${kind} should be able to ask`).toBe(true)
    }
  })

  it('still refuses a kind that does not exist', () => {
    expect(
      IpcRequestSchemas['creations:save'].safeParse({
        kind: 'sandwich',
        name: 'Something',
        data: {}
      }).success
    ).toBe(false)
  })

  it('includes loot, which is the one that was missing', () => {
    expect(CREATION_KINDS).toContain('loot')
  })
})
