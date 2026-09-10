import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AdmZip from 'adm-zip'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))
vi.mock('../../src/main/core/database', () => ({
  db: () => ({ kvGet: () => null, kvSet: () => undefined })
}))

import { writeResourcePack } from '../../src/main/services/content/resourcePackService'
import { ARMOUR_PIECES, emptyDraft, giveArmour, type PackArmour } from '../../src/shared/resourcePacks'

/**
 * Custom armour, which is four files more than anybody expects.
 *
 * A pack cannot add an item, so a set is real armour wearing different
 * pictures. Two components do it: `item_model` swaps the inventory icon, and
 * `equippable.asset_id` names an equipment asset the pack defines, which is
 * what changes the armour drawn on the body.
 *
 * The paths below are not guesses. `assets/minecraft/equipment/diamond.json`
 * in the 26.2 jar names humanoid, humanoid_baby and humanoid_leggings, and the
 * texture id inside resolves to `textures/entity/equipment/<layer>/<id>.png` -
 * which is why one id covers two files that look nothing alike. Every one of
 * these is silent when wrong: the game draws nothing, or draws vanilla, and
 * logs neither.
 */

const png = 'data:image/png;base64,iVBORw0KGgo='

const set: PackArmour = {
  id: 'emberforged',
  label: 'Emberforged',
  base: 'diamond',
  body: png,
  legs: png,
  icons: { helmet: png, chestplate: png, leggings: png, boots: png }
}

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'armour-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

async function build(): Promise<AdmZip> {
  const out = join(root, 'pack.zip')
  await writeResourcePack({ ...emptyDraft(), armour: [set] }, '26.2', out)
  return new AdmZip(out)
}

describe('a custom armour set in a pack', () => {
  it('writes both worn layers where the equipment asset points', async () => {
    const names = (await build()).getEntries().map((e) => e.entryName)

    expect(names).toContain('assets/nexus/textures/entity/equipment/humanoid/emberforged.png')
    expect(names).toContain('assets/nexus/textures/entity/equipment/humanoid_leggings/emberforged.png')
  })

  it('declares the layers the game draws armour on', async () => {
    const asset = JSON.parse((await build()).readAsText('assets/nexus/equipment/emberforged.json'))

    expect(Object.keys(asset.layers).sort()).toEqual(['humanoid', 'humanoid_baby', 'humanoid_leggings'])
    expect(asset.layers.humanoid).toEqual([{ texture: 'nexus:emberforged' }])
  })

  it('gives every piece its own icon, model and item definition', async () => {
    const names = (await build()).getEntries().map((e) => e.entryName)

    for (const piece of ARMOUR_PIECES) {
      expect(names).toContain(`assets/nexus/textures/item/emberforged_${piece.id}.png`)
      expect(names).toContain(`assets/nexus/models/item/emberforged_${piece.id}.json`)

      // The item definition is what `item_model` names. A missing one renders
      // as the purple and black missing texture rather than as vanilla.
      expect(names).toContain(`assets/nexus/items/emberforged_${piece.id}.json`)
    }
  })

  it('reports the set and hands back a give line for each piece', async () => {
    const out = join(root, 'pack.zip')
    const built = await writeResourcePack({ ...emptyDraft(), armour: [set] }, '26.2', out)

    expect(built.contents.armour).toBe(1)
    expect(built.commands).toHaveLength(ARMOUR_PIECES.length)
  })
})

describe('the command that hands a piece out', () => {
  it('names a real vanilla item, the slot, and the pack asset', () => {
    const chest = ARMOUR_PIECES.find((p) => p.id === 'chestplate')!
    const line = giveArmour(set, chest, 'nexus')

    expect(line).toContain('minecraft:diamond_chestplate')
    expect(line).toContain('minecraft:equippable={slot:"chest",asset_id:"nexus:emberforged"}')
    expect(line).toContain('minecraft:item_model="nexus:emberforged_chestplate"')
  })

  it('gives it to whoever was picked, and to the nearest player by default', () => {
    const boots = ARMOUR_PIECES.find((p) => p.id === 'boots')!

    expect(giveArmour(set, boots, 'nexus')).toContain('/give @p ')
    expect(giveArmour(set, boots, 'nexus', 'Dave0734')).toContain('/give Dave0734 ')
    expect(giveArmour(set, boots, 'nexus', '@a')).toContain('/give @a ')
  })

  it('puts each piece in the slot it belongs in', () => {
    const slots = ARMOUR_PIECES.map((p) => p.slot)
    expect(slots).toEqual(['head', 'chest', 'legs', 'feet'])
  })

  it('escapes a name that would otherwise break out of the component', () => {
    const awkward = { ...set, label: "Bob's \\ Set" }
    const line = giveArmour(awkward, ARMOUR_PIECES[0], 'nexus')

    // The name sits inside a single-quoted SNBT string; an unescaped quote
    // would end it and the rest would be read as more components.
    expect(line).toContain("Bob\\'s")
    expect(line).toContain('\\\\')
  })
})
