import { mkdtemp, readdir, stat, utimes, writeFile } from 'node:fs/promises'
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

  /*
   * This used to assert `warm < cold / 2` off a stopwatch, and failed roughly
   * one run in fifteen - once at 106ms against a 98ms bar. A ratio of two wall
   * clocks measures the machine, not the cache: when the operating system's
   * own file cache is already warm from the run before, the cold scan is fast,
   * the ratio narrows, and a busy moment tips it over.
   *
   * What the cache actually claims is that it does not open a jar twice, and
   * that can be proved rather than timed. Every jar is replaced with the same
   * number of bytes of nonsense and its timestamp put back: the cache is keyed
   * on path, size and modification time, so it should not notice, while
   * anything that does open a jar now finds a file that is not a zip at all.
   */
  it('does not open a jar it has already read', { timeout: 120_000 }, async () => {
    const dir = await makePack(20)

    /*
     * Stamped before the first scan as well as after the second.
     *
     * Reading a timestamp and writing it back does not round-trip: NTFS keeps
     * hundred-nanosecond ticks and utimes takes whole milliseconds, so putting
     * back what stat reported still moved the file by a fraction and the cache
     * correctly missed. Setting the same whole millisecond both times is the
     * only way to hold the key still.
     */
    const stamp = new Date(1_700_000_000_000)
    for (const entry of await readdir(dir)) await utimes(join(dir, entry), stamp, stamp)

    const cold = await analyseModsIn(target(dir))
    expect(cold.length).toBe(20)

    for (const entry of await readdir(dir)) {
      const path = join(dir, entry)
      await writeFile(path, Buffer.alloc((await stat(path)).size, 0))
      await utimes(path, stamp, stamp)
    }

    const warm = await analyseModsIn(target(dir))

    expect(warm.map((m) => m.name)).toEqual(cold.map((m) => m.name))
    expect(warm.map((m) => m.version)).toEqual(cold.map((m) => m.version))
  })

  it('really would fail if the jars were re-read', { timeout: 120_000 }, async () => {
    // Guards the test above: same wrecking, but the timestamp is left moved on,
    // so the cache misses and the ruined jars are what comes back.
    const dir = await makePack(3)
    const cold = await analyseModsIn(target(dir))

    for (const entry of await readdir(dir)) {
      await writeFile(join(dir, entry), Buffer.alloc((await stat(join(dir, entry))).size, 0))
    }

    const warm = await analyseModsIn(target(dir))

    expect(warm.map((m) => m.name)).not.toEqual(cold.map((m) => m.name))
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
