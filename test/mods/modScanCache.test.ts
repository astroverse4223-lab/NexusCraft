import { mkdtemp, writeFile, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import AdmZip from 'adm-zip'
import { analyseModsIn } from '../../src/main/services/mods/modService'

/**
 * Scanning a mod folder means unzipping every jar and decoding its icon. A
 * 143-mod pack is 326 MB on disk and took 1.24 seconds — paid on every press of
 * Play, and again after every action on the Mods screen, so enabling one mod
 * re-read the other hundred and forty-two.
 *
 * A jar does not change once written, so the answer is cached against its size
 * and modification time.
 */
async function makePack(count: number): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'mods-'))

  for (let i = 0; i < count; i += 1) {
    const zip = new AdmZip()
    zip.addFile(
      'fabric.mod.json',
      Buffer.from(
        JSON.stringify({
          id: `test_mod_${i}`,
          name: `Test Mod ${i}`,
          version: '1.0.0',
          depends: { minecraft: '>=1.20 <1.21' }
        })
      )
    )
    // Something to decode, as a real jar has.
    zip.addFile('assets/icon.png', Buffer.alloc(24 * 1024, i % 251))
    await writeFile(join(dir, `test-mod-${i}.jar`), zip.toBuffer())
  }

  return dir
}

const target = (dir: string) =>
  ({
    dir,
    loader: 'fabric' as const,
    loaderVersion: '0.16.0',
    minecraftVersion: '1.20.1',
    description: 'the test instance'
  }) as never

describe('scanning a mod folder twice', () => {
  it('returns the same mods from cache', { timeout: 120_000 }, async () => {
    const dir = await makePack(40)

    const first = await analyseModsIn(target(dir))
    const second = await analyseModsIn(target(dir))

    expect(first.length).toBe(40)
    expect(second.length).toBe(40)
    expect(second.map((m) => m.fileName)).toEqual(first.map((m) => m.fileName))
    expect(second.map((m) => m.name)).toEqual(first.map((m) => m.name))
  })

  it('is markedly faster the second time', { timeout: 120_000 }, async () => {
    const dir = await makePack(60)

    const coldStart = Date.now()
    await analyseModsIn(target(dir))
    const cold = Date.now() - coldStart

    const warmStart = Date.now()
    await analyseModsIn(target(dir))
    const warm = Date.now() - warmStart

    console.log(`cold ${cold} ms, warm ${warm} ms`)

    // Generous: the point is that a re-scan no longer re-reads every jar, not
    // that a particular machine hits a particular number.
    expect(warm).toBeLessThan(Math.max(cold / 2, 30))
  })

  it('notices a jar that has actually changed', { timeout: 120_000 }, async () => {
    const dir = await makePack(3)
    await analyseModsIn(target(dir))

    // Rewrite one jar with a different name inside, and age its timestamp so
    // the change is unambiguous.
    const zip = new AdmZip()
    zip.addFile(
      'fabric.mod.json',
      Buffer.from(JSON.stringify({ id: 'renamed', name: 'Renamed Mod', version: '2.0.0' }))
    )
    const changed = join(dir, 'test-mod-1.jar')
    await writeFile(changed, zip.toBuffer())
    const later = new Date(Date.now() + 5000)
    await utimes(changed, later, later)

    const after = await analyseModsIn(target(dir))
    const names = after.map((m) => m.name)
    expect(names).toContain('Renamed Mod')
    expect(names).not.toContain('Test Mod 1')
  })
})
