import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { minimatch } from 'minimatch'

/**
 * That the installer does not throw away files the app needs at import time.
 *
 * `electron-builder.yml` drops 329MB of Bedrock data out of minecraft-data,
 * which is entirely reasonable for a Java Edition launcher — none of the
 * per-version Bedrock data is ever read. Four small files in `bedrock/common`
 * are the exception, because minecraft-data's own entry point requires them at
 * the top of the file, before anything has said which edition it wants.
 *
 * Dropping those made `require('minecraft-data')` throw outright in the
 * packaged build, and every caller wrapped that require in a silent catch. The
 * Discover screen reported all fifty servers as "did not say which version it
 * runs"; the blueprint exporter quietly used a hardcoded data version; the
 * companion bot could not start at all. A source run was fine throughout,
 * because it reads the real node_modules — the bug existed only inside the
 * installer, where nobody looks.
 *
 * So this reads the exclusions and the requires and checks them against each
 * other, instead of relying on someone thinking to unpack an asar.
 */

const root = join(__dirname, '..', '..')

/** The `files` globs from electron-builder.yml, in the order they are applied. */
function filePatterns(): string[] {
  const yaml = readFileSync(join(root, 'electron-builder.yml'), 'utf8')
  const lines = yaml.split(/\r?\n/)

  const start = lines.findIndex((line) => line.trim() === 'files:')
  expect(start, 'electron-builder.yml has a files: section').toBeGreaterThanOrEqual(0)

  const patterns: string[] = []
  for (const line of lines.slice(start + 1)) {
    // The section ends at the next top-level key.
    if (/^\S/.test(line) && line.trim() !== '') break
    const match = /^\s*-\s*'?"?(.+?)'?"?\s*$/.exec(line)
    if (match && !line.trim().startsWith('#')) patterns.push(match[1])
  }
  return patterns
}

/**
 * Whether a path survives the patterns, applying them in order.
 *
 * The same rule electron-builder uses: a later pattern overrides an earlier
 * one, so a `!` exclusion can be undone by re-including a subpath below it.
 */
function survives(path: string, patterns: string[]): boolean {
  let included = true
  for (const pattern of patterns) {
    const negated = pattern.startsWith('!')
    const glob = negated ? pattern.slice(1) : pattern
    if (minimatch(path, glob)) included = !negated
  }
  return included
}

/** Data files minecraft-data requires as soon as it is imported. */
function eagerRequires(): string[] {
  const pkg = join(root, 'node_modules', 'minecraft-data')
  if (!existsSync(pkg)) return []

  const sources = [join(pkg, 'index.js')]
  const lib = join(pkg, 'lib')
  if (existsSync(lib)) {
    for (const file of readdirSync(lib)) {
      if (file.endsWith('.js')) sources.push(join(lib, file))
    }
  }

  const found = new Set<string>()
  for (const source of sources) {
    const body = readFileSync(source, 'utf8')
    for (const match of body.matchAll(/require\(['"](\.[^'"]*minecraft-data\/data\/[^'"]+)['"]\)/g)) {
      // "./minecraft-data/data/..." and "../minecraft-data/data/..." both land
      // in the same place; only the part from `minecraft-data/data` matters.
      const tail = match[1].slice(match[1].indexOf('minecraft-data/data'))
      found.add(`node_modules/minecraft-data/${tail}`)
    }
  }
  return [...found]
}

describe('what the installer keeps', () => {
  it('finds the requires minecraft-data makes at import time', () => {
    const required = eagerRequires()
    // If this ever goes to zero the test below passes for the wrong reason.
    expect(required.length).toBeGreaterThan(0)
  })

  it('keeps every file minecraft-data needs to be importable at all', () => {
    const patterns = filePatterns()
    const dropped = eagerRequires().filter((path) => !survives(path, patterns))

    expect(
      dropped,
      'these are required by minecraft-data/index.js at import time, so excluding ' +
        'them makes require("minecraft-data") throw in the packaged build only'
    ).toEqual([])
  })

  it('still drops the per-version Bedrock data, which is the whole 329MB', () => {
    const patterns = filePatterns()
    expect(
      survives('node_modules/minecraft-data/minecraft-data/data/bedrock/1.16.201/blocks.json', patterns)
    ).toBe(false)
  })

  it('ships a jar for every mod the launcher offers to install', () => {
    const yaml = readFileSync(join(root, 'electron-builder.yml'), 'utf8')
    const bundled = readFileSync(join(root, 'src/main/services/content/bundledMods.ts'), 'utf8')

    const jars = [...bundled.matchAll(/jarName:\s*'([^']+)'/g)].map((m) => m[1])
    expect(jars.length).toBeGreaterThan(0)

    /*
     * And the libraries they cannot start without.
     *
     * A missing dependency jar is worse than a missing mod: Fabric refuses to
     * load the mod that declares it and shows the player a loader error naming
     * something they have never heard of.
     */
    for (const list of bundled.matchAll(/alongside:\s*\[([^\]]*)\]/g)) {
      for (const found of list[1].matchAll(/'([^']+)'/g)) jars.push(found[1])
    }

    /*
     * Ember was in the table and missing from extraResources for a while. In
     * development the jar is read out of the repo, so the gap only existed in
     * the installed app — and it reported the mod as unavailable rather than
     * as missing, which reads like the mod was never finished.
     */
    for (const jar of jars) {
      expect(yaml, `${jar} needs an extraResources entry`).toContain(`to: ${jar}`)
    }
  })
})
