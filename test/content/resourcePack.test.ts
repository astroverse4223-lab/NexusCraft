import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import AdmZip from 'adm-zip'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))

import { guessResourceFormat } from '../../src/main/services/content/datapackService'
import {
  pointServerAtPack,
  writeResourcePack
} from '../../src/main/services/content/resourcePackService'
import { emptyDraft } from '../../src/shared/resourcePacks'

/**
 * What actually ends up in the zip.
 *
 * A resource pack fails the same silent way map art did: a texture one folder
 * off is not an error, it is the vanilla texture still showing. So these check
 * paths and contents rather than that the call returned - the paths themselves
 * were read out of a real 26.2 jar, which is the only reason to trust them.
 */

// A 1x1 png, which is all the builder needs to be handed.
const PNG =
  'data:image/png;base64,' +
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'respack-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function open(path: string): AdmZip {
  return new AdmZip(path)
}

function names(zip: AdmZip): string[] {
  return zip.getEntries().map((e) => e.entryName)
}

function read(zip: AdmZip, name: string): string {
  const entry = zip.getEntry(name)
  if (!entry) throw new Error(`no ${name} in the pack`)
  return entry.getData().toString('utf8')
}

describe('the pack metadata', () => {
  it('declares the resource format, not the data format', async () => {
    const draft = { ...emptyDraft(), logo: PNG }
    const dest = join(root, 'pack.zip')

    await writeResourcePack(draft, '26.2', dest)

    const meta = JSON.parse(read(open(dest), 'pack.mcmeta')) as {
      pack: { pack_format: number }
    }

    // 26.2 is resource 88 and data 107. Writing 107 here is the mistake this
    // guards: the pack loads and every file in it is ignored.
    expect(meta.pack.pack_format).toBe(88)
    expect(meta.pack.pack_format).not.toBe(107)
  })

  it('carries min_format and max_format above 81, as the game demands', async () => {
    const dest = join(root, 'pack.zip')
    await writeResourcePack({ ...emptyDraft(), logo: PNG }, '26.2', dest)

    const meta = JSON.parse(read(open(dest), 'pack.mcmeta')) as {
      pack: Record<string, unknown>
    }

    expect(meta.pack.min_format).toBe(88)
    expect(meta.pack.max_format).toBe(88)
  })
})

describe('a custom item', () => {
  const item = {
    id: 'champions_rod',
    label: "Champion's Rod",
    base: 'minecraft:stick',
    image: PNG,
    replaces: false
  }

  it('writes a texture, a model and an item definition', async () => {
    const dest = join(root, 'pack.zip')
    await writeResourcePack({ ...emptyDraft(), items: [item] }, '26.2', dest)

    const inside = names(open(dest))

    expect(inside).toContain('assets/nexus/textures/item/champions_rod.png')
    expect(inside).toContain('assets/nexus/models/item/champions_rod.json')
    // The definition is what `item_model` points at, and is the piece that is
    // easy to leave out - without it the item is the missing texture.
    expect(inside).toContain('assets/nexus/items/champions_rod.json')

    // And it leaves the vanilla stick alone.
    expect(inside).not.toContain('assets/minecraft/textures/item/stick.png')
  })

  it('shapes the item definition the way the jar does', async () => {
    const dest = join(root, 'pack.zip')
    await writeResourcePack({ ...emptyDraft(), items: [item] }, '26.2', dest)

    expect(JSON.parse(read(open(dest), 'assets/nexus/items/champions_rod.json'))).toEqual({
      model: { type: 'minecraft:model', model: 'nexus:item/champions_rod' }
    })
  })

  it('hands back a give command that names the model and the item', async () => {
    const dest = join(root, 'pack.zip')
    const built = await writeResourcePack({ ...emptyDraft(), items: [item] }, '26.2', dest)

    expect(built.commands).toHaveLength(1)
    expect(built.commands[0]).toContain('minecraft:item_model="nexus:champions_rod"')
    expect(built.commands[0]).toContain('/give @p minecraft:stick')
    // The apostrophe in the name is inside a single-quoted argument.
    expect(built.commands[0]).toContain("Champion\\'s Rod")
  })

  it('overwrites the vanilla texture when asked to replace', async () => {
    const dest = join(root, 'pack.zip')
    await writeResourcePack(
      { ...emptyDraft(), items: [{ ...item, replaces: true }] },
      '26.2',
      dest
    )

    const inside = names(open(dest))

    expect(inside).toContain('assets/minecraft/textures/item/stick.png')
    expect(inside).not.toContain('assets/nexus/items/champions_rod.json')
  })

  it('tidies a name that is not a legal resource location', async () => {
    const dest = join(root, 'pack.zip')
    await writeResourcePack(
      { ...emptyDraft(), items: [{ ...item, id: 'Grand Line CHAMPION!' }] },
      '26.2',
      dest
    )

    // Upper case and spaces are dropped by the game with no warning at all.
    expect(names(open(dest))).toContain('assets/nexus/textures/item/grand_line_champion.png')
  })
})

describe('sounds', () => {
  it('writes the ogg and points an event at it', async () => {
    const ogg = join(root, 'song.ogg')
    writeFileSync(ogg, 'not really ogg, but bytes')

    const dest = join(root, 'pack.zip')
    await writeResourcePack(
      {
        ...emptyDraft(),
        sounds: [
          { id: 'my_song', label: 'My song', event: 'music_disc.cat', file: ogg, stream: true }
        ]
      },
      '26.2',
      dest
    )

    const zip = open(dest)

    expect(names(zip)).toContain('assets/minecraft/sounds/nexus/my_song.ogg')
    expect(JSON.parse(read(zip, 'assets/minecraft/sounds.json'))).toEqual({
      'music_disc.cat': { sounds: [{ name: 'nexus/my_song', stream: true }] }
    })
  })

  it('names only the events being changed, so the rest of the game is untouched', async () => {
    const ogg = join(root, 'song.ogg')
    writeFileSync(ogg, 'bytes')

    const dest = join(root, 'pack.zip')
    await writeResourcePack(
      {
        ...emptyDraft(),
        sounds: [
          { id: 'a', label: 'a', event: 'music.menu', file: ogg, stream: true },
          { id: 'b', label: 'b', event: 'ui.button.click', file: ogg, stream: false }
        ]
      },
      '26.2',
      dest
    )

    const events = JSON.parse(read(open(dest), 'assets/minecraft/sounds.json'))
    expect(Object.keys(events).sort()).toEqual(['music.menu', 'ui.button.click'])
  })

  it('refuses anything that is not an ogg', async () => {
    const mp3 = join(root, 'song.mp3')
    writeFileSync(mp3, 'bytes')

    await expect(
      writeResourcePack(
        {
          ...emptyDraft(),
          sounds: [{ id: 'a', label: 'a', event: 'music.menu', file: mp3, stream: true }]
        },
        '26.2',
        join(root, 'pack.zip')
      )
    ).rejects.toThrow(/ogg/i)
  })

  it('says so when the file has gone since it was added', async () => {
    await expect(
      writeResourcePack(
        {
          ...emptyDraft(),
          sounds: [
            {
              id: 'a',
              label: 'a',
              event: 'music.menu',
              file: join(root, 'never-existed.ogg'),
              stream: true
            }
          ]
        },
        '26.2',
        join(root, 'pack.zip')
      )
    ).rejects.toThrow()
  })
})

describe('the menu', () => {
  it('writes all six panorama faces where the title screen looks', async () => {
    const dest = join(root, 'pack.zip')
    await writeResourcePack(
      { ...emptyDraft(), panorama: new Array(6).fill(PNG) },
      '26.2',
      dest
    )

    const inside = names(open(dest))

    for (let at = 0; at < 6; at++) {
      expect(inside).toContain(
        `assets/minecraft/textures/gui/title/background/panorama_${at}.png`
      )
    }
  })

  it('puts the logo on the wordmark', async () => {
    const dest = join(root, 'pack.zip')
    await writeResourcePack({ ...emptyDraft(), logo: PNG }, '26.2', dest)

    expect(names(open(dest))).toContain('assets/minecraft/textures/gui/title/minecraft.png')
  })
})

describe('the built file', () => {
  it('refuses a pack with nothing in it', async () => {
    await expect(
      writeResourcePack(emptyDraft(), '26.2', join(root, 'pack.zip'))
    ).rejects.toThrow()
  })

  it('reports a sha1 that is really the file', async () => {
    const dest = join(root, 'pack.zip')
    const built = await writeResourcePack({ ...emptyDraft(), logo: PNG }, '26.2', dest)

    // A server that publishes the wrong hash has every client refuse the pack.
    expect(built.sha1).toBe(createHash('sha1').update(readFileSync(dest)).digest('hex'))
    expect(built.bytes).toBe(readFileSync(dest).length)
  })
})

describe('pointing a server at a pack', () => {
  function properties(): string {
    return readFileSync(join(root, 'server.properties'), 'utf8')
  }

  beforeEach(() => {
    writeFileSync(
      join(root, 'server.properties'),
      '#Minecraft server properties\nmotd=hello\nview-distance=10\n'
    )
  })

  it('writes the url, the hash and whether it is required', async () => {
    await pointServerAtPack(root, { url: 'http://a.b:1/c.zip', sha1: 'a'.repeat(40), required: true })

    expect(properties()).toContain('resource-pack=http://a.b:1/c.zip')
    expect(properties()).toContain(`resource-pack-sha1=${'a'.repeat(40)}`)
    expect(properties()).toContain('require-resource-pack=true')
  })

  it('keeps every other setting in the file', async () => {
    await pointServerAtPack(root, { url: 'http://a.b:1/c.zip', sha1: 'a'.repeat(40), required: false })

    // The launcher rewrites this file from its own record on every settings
    // save and keeps what it does not manage, so these have to survive.
    expect(properties()).toContain('motd=hello')
    expect(properties()).toContain('view-distance=10')
  })

  it('clears all three when the pack is taken away', async () => {
    await pointServerAtPack(root, { url: 'http://a.b:1/c.zip', sha1: 'a'.repeat(40), required: true })
    await pointServerAtPack(root, null)

    expect(properties()).toContain('resource-pack=\n')
    expect(properties()).toContain('resource-pack-sha1=\n')
    expect(properties()).toContain('require-resource-pack=false')
  })
})

describe('guessing a resource format without the jar', () => {
  it('matches the numbers real jars report', () => {
    // Every one of these was read out of a version.json on this machine.
    expect(guessResourceFormat('26.2')).toBe(88)
    expect(guessResourceFormat('26.1.2')).toBe(84)
    expect(guessResourceFormat('1.21.11')).toBe(75)
    expect(guessResourceFormat('1.20.1')).toBe(15)
  })

  it('never returns a data format by mistake', () => {
    // The data numbers for the same versions, which must not appear here.
    for (const [version, data] of [
      ['26.2', 107],
      ['26.1.2', 101],
      ['1.21.11', 94]
    ] as const) {
      expect(guessResourceFormat(version)).not.toBe(data)
    }
  })
})
