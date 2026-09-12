import { describe, expect, it } from 'vitest'

import { IpcRequestSchemas } from '../../src/shared/ipc'
import { emptyDraft, type ResourcePackDraft } from '../../src/shared/resourcePacks'

/**
 * A whole pack has to fit through the door.
 *
 * The draft schema capped `textures` at 512. A 26.2 jar ships 3,855 of them
 * and "restyle the whole pack" is the feature the array exists for, so every
 * `resourcepack:serve` and every `resourcepack:remember` was refused at the
 * IPC boundary before any handler ran.
 *
 * What made it hard to see: `creations:save` takes `data: z.unknown()` and has
 * no cap, so a 3,446-texture pack saved perfectly and then refused to be
 * served or auto-kept. On screen that is a Build button that does nothing.
 *
 * These check the shapes against real numbers rather than round ones.
 */

/** The largest pack the app can produce: one entry per vanilla texture. */
const VANILLA_TEXTURES = 3855

/** What a saved pack of theirs actually held. */
const A_REAL_PACK = 3446

const png = 'data:image/png;base64,iVBORw0KGgo='

function draftWith(textures: number): ResourcePackDraft {
  return {
    ...emptyDraft(),
    textures: Array.from({ length: textures }, (_, i) => ({
      path: `block/stone_${i}`,
      image: png
    }))
  }
}

describe('sending a pack to the main process', () => {
  it('takes a pack with every vanilla texture replaced', () => {
    const parsed = IpcRequestSchemas['resourcepack:serve'].safeParse({
      serverId: '2db55584-1555-46e9-8cdc-cd60f5b64347',
      draft: draftWith(VANILLA_TEXTURES),
      port: 25567,
      required: false
    })

    expect(parsed.success).toBe(true)
  })

  it('takes the pack that was actually being refused', () => {
    const parsed = IpcRequestSchemas['resourcepack:remember'].safeParse({
      draft: draftWith(A_REAL_PACK)
    })

    expect(parsed.success).toBe(true)
  })

  /*
   * The same shape of mistake, twice more.
   *
   * items was 64 and sounds was 32. A 26.2 jar has 796 item textures and the
   * eight cosmetic hats are items too, so a pack replacing a category of them
   * went over without trying - and going over is silent, because the call is
   * refused at the boundary and the screen simply does nothing.
   */
  it('takes a pack that replaces a category of items', () => {
    const parsed = IpcRequestSchemas['resourcepack:remember'].safeParse({
      draft: {
        ...emptyDraft(),
        items: Array.from({ length: 800 }, (_, i) => ({
          id: `thing_${i}`,
          label: `Thing ${i}`,
          base: 'minecraft:stick',
          image: png,
          replaces: false
        }))
      }
    })

    expect(parsed.success).toBe(true)
  })

  it('takes an album of music discs', () => {
    const parsed = IpcRequestSchemas['resourcepack:remember'].safeParse({
      draft: {
        ...emptyDraft(),
        sounds: Array.from({ length: 60 }, (_, i) => ({
          id: `track_${i}`,
          label: `Track ${i}`,
          event: 'music_disc.cat',
          file: 'C:/sounds/track.ogg',
          stream: true
        }))
      }
    })

    expect(parsed.success).toBe(true)
  })

  it('still refuses a draft with no plausible end', () => {
    const parsed = IpcRequestSchemas['resourcepack:remember'].safeParse({
      draft: draftWith(50_000)
    })

    expect(parsed.success).toBe(false)
  })

  it('still refuses a texture path that climbs out of the folder', () => {
    const parsed = IpcRequestSchemas['resourcepack:remember'].safeParse({
      draft: { ...emptyDraft(), textures: [{ path: '/etc/passwd', image: png }] }
    })

    expect(parsed.success).toBe(false)
  })

  it('accepts the same pack on the install path, which shares the shape', () => {
    const parsed = IpcRequestSchemas['resourcepack:install'].safeParse({
      instanceId: '2db55584-1555-46e9-8cdc-cd60f5b64347',
      draft: draftWith(A_REAL_PACK)
    })

    expect(parsed.success).toBe(true)
  })
})
