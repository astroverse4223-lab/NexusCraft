import { describe, expect, it } from 'vitest'
import {
  compareVersions,
  loaderAccepts,
  parseFabricJson,
  parseLegacyMcmod,
  parseModManifest,
  parseModsToml,
  parseQuiltJson,
  readTomlValue,
  versionSatisfies
} from '@main/services/mods/modMetadata'

/**
 * The manifests below are trimmed from real mods. Malformed input is the norm
 * here — mod authors hand-write these — so every parser is also checked for
 * degrading to "unknown" instead of throwing.
 */

describe('parseFabricJson', () => {
  const sodium = JSON.stringify({
    schemaVersion: 1,
    id: 'sodium',
    version: '0.6.5',
    name: 'Sodium',
    description: 'A modern rendering engine.',
    authors: ['JellySquid', { name: 'IMS' }],
    icon: 'assets/sodium/icon.png',
    depends: { minecraft: '>=1.21.4', fabricloader: '>=0.16.0' }
  })

  it('reads the common shape', () => {
    const meta = parseFabricJson(sodium)!
    expect(meta.modId).toBe('sodium')
    expect(meta.name).toBe('Sodium')
    expect(meta.version).toBe('0.6.5')
    expect(meta.loaders).toEqual(['fabric'])
    expect(meta.mcVersionRange).toBe('>=1.21.4')
    expect(meta.iconPath).toBe('assets/sodium/icon.png')
  })

  it('accepts authors as plain strings and as objects', () => {
    expect(parseFabricJson(sodium)!.authors).toEqual(['JellySquid', 'IMS'])
  })

  it('drops author objects with no name rather than emitting empty strings', () => {
    const meta = parseFabricJson(JSON.stringify({ id: 'a', authors: [{ contact: {} }, 'Real'] }))!
    expect(meta.authors).toEqual(['Real'])
  })

  it('joins an array of minecraft dependencies into one range', () => {
    const meta = parseFabricJson(JSON.stringify({ id: 'a', depends: { minecraft: ['1.21', '1.21.1'] } }))!
    expect(meta.mcVersionRange).toBe('1.21, 1.21.1')
  })

  it('reads the first entry when icon is a size map', () => {
    const meta = parseFabricJson(JSON.stringify({ id: 'a', icon: { '64': 'icon64.png' } }))!
    expect(meta.iconPath).toBe('icon64.png')
  })

  it('falls back to the id when there is no display name', () => {
    expect(parseFabricJson(JSON.stringify({ id: 'someid' }))!.name).toBe('someid')
  })

  it('reports "Unknown mod" when there is neither name nor id', () => {
    const meta = parseFabricJson('{}')!
    expect(meta.name).toBe('Unknown mod')
    expect(meta.modId).toBeNull()
  })

  it('returns null on invalid JSON instead of throwing', () => {
    expect(parseFabricJson('{ not json')).toBeNull()
  })
})

describe('parseQuiltJson', () => {
  const manifest = JSON.stringify({
    schema_version: 1,
    quilt_loader: {
      group: 'com.example',
      id: 'example_mod',
      version: '1.0.0',
      metadata: {
        name: 'Example Mod',
        description: 'Does things.',
        contributors: { Alice: 'Owner', Bob: 'Contributor' },
        icon: 'assets/example/icon.png'
      },
      depends: [{ id: 'quilt_loader', versions: '>=0.20.0' }, { id: 'minecraft', versions: '>=1.21' }]
    }
  })

  it('reads the nested quilt_loader block', () => {
    const meta = parseQuiltJson(manifest)!
    expect(meta.modId).toBe('example_mod')
    expect(meta.name).toBe('Example Mod')
    expect(meta.version).toBe('1.0.0')
    expect(meta.mcVersionRange).toBe('>=1.21')
    expect(meta.iconPath).toBe('assets/example/icon.png')
  })

  it('takes contributor names from the map keys', () => {
    expect(parseQuiltJson(manifest)!.authors).toEqual(['Alice', 'Bob'])
  })

  it('claims both quilt and fabric, since Quilt runs Fabric mods', () => {
    expect(parseQuiltJson(manifest)!.loaders).toEqual(['quilt', 'fabric'])
  })

  it('returns null when the quilt_loader block is missing', () => {
    expect(parseQuiltJson(JSON.stringify({ schema_version: 1 }))).toBeNull()
  })

  it('leaves the range null when minecraft is not a declared dependency', () => {
    const meta = parseQuiltJson(JSON.stringify({ quilt_loader: { id: 'a', depends: [{ id: 'quilt_loader' }] } }))!
    expect(meta.mcVersionRange).toBeNull()
  })

  it('returns null on invalid JSON', () => {
    expect(parseQuiltJson('nope')).toBeNull()
  })
})

describe('readTomlValue', () => {
  it('reads a double-quoted value', () => {
    expect(readTomlValue('modId = "jei"', 'modId')).toBe('jei')
  })

  it('reads a single-quoted value', () => {
    expect(readTomlValue("license = 'MIT'", 'license')).toBe('MIT')
  })

  it('reads a triple-quoted multiline value', () => {
    const toml = 'description = """\nLine one.\nLine two.\n"""'
    expect(readTomlValue(toml, 'description')).toBe('Line one.\nLine two.')
  })

  it('tolerates leading whitespace and spacing around the equals sign', () => {
    expect(readTomlValue('    modId="a"', 'modId')).toBe('a')
    expect(readTomlValue('modId   =   "a"', 'modId')).toBe('a')
  })

  it('returns null for a missing key', () => {
    expect(readTomlValue('modId = "a"', 'displayName')).toBeNull()
  })

  it('returns null for an empty value rather than an empty string', () => {
    expect(readTomlValue('modId = ""', 'modId')).toBeNull()
  })
})

describe('parseModsToml', () => {
  const forgeToml = `
modLoader = "javafml"
loaderVersion = "[47,)"
license = "MIT"

[[mods]]
modId = "jei"
version = "15.3.0.4"
displayName = "Just Enough Items"
authors = "mezz, Alice"
logoFile = "jei_logo.png"
description = """
Item and recipe viewing.
"""

[[dependencies.jei]]
    modId = "minecraft"
    mandatory = true
    versionRange = "[1.20.1,1.21)"
    ordering = "NONE"
    side = "BOTH"
`

  it('reads the first [[mods]] block', () => {
    const meta = parseModsToml(forgeToml, 'forge')
    expect(meta.modId).toBe('jei')
    expect(meta.name).toBe('Just Enough Items')
    expect(meta.version).toBe('15.3.0.4')
    expect(meta.description).toBe('Item and recipe viewing.')
    expect(meta.iconPath).toBe('jei_logo.png')
  })

  it('splits the authors string on commas', () => {
    expect(parseModsToml(forgeToml, 'forge').authors).toEqual(['mezz', 'Alice'])
  })

  it('finds the minecraft version range in the dependencies block', () => {
    expect(parseModsToml(forgeToml, 'forge').mcVersionRange).toBe('[1.20.1,1.21)')
  })

  it('tags the loader it was told to use', () => {
    expect(parseModsToml(forgeToml, 'neoforge').loaders).toEqual(['neoforge'])
  })

  it('does not pick up a non-minecraft dependency range', () => {
    const toml = `
[[mods]]
modId = "a"

[[dependencies.a]]
    modId = "someotherlib"
    versionRange = "[1.0,2.0)"
`
    expect(parseModsToml(toml, 'forge').mcVersionRange).toBeNull()
  })

  it('falls back to the whole document when there is no [[mods]] header', () => {
    expect(parseModsToml('modId = "loose"', 'forge').modId).toBe('loose')
  })

  it('degrades to "Unknown mod" rather than throwing on junk', () => {
    const meta = parseModsToml('this is not toml at all', 'forge')
    expect(meta.name).toBe('Unknown mod')
    expect(meta.modId).toBeNull()
    expect(meta.authors).toEqual([])
  })
})

describe('parseLegacyMcmod', () => {
  const array = JSON.stringify([
    {
      modid: 'oldmod',
      name: 'Old Mod',
      version: '1.2.3',
      description: 'From the 1.7.10 days.',
      mcversion: '1.7.10',
      authorList: ['Someone', ''],
      logoFile: '/logo.png'
    }
  ])

  it('reads the top-level array form', () => {
    const meta = parseLegacyMcmod(array)!
    expect(meta.modId).toBe('oldmod')
    expect(meta.name).toBe('Old Mod')
    expect(meta.version).toBe('1.2.3')
    expect(meta.mcVersionRange).toBe('1.7.10')
    expect(meta.loaders).toEqual(['forge'])
  })

  it('drops blank entries from authorList', () => {
    expect(parseLegacyMcmod(array)!.authors).toEqual(['Someone'])
  })

  it('reads the modList wrapper form', () => {
    const meta = parseLegacyMcmod(JSON.stringify({ modListVersion: 2, modList: [{ modid: 'x', name: 'X' }] }))!
    expect(meta.modId).toBe('x')
    expect(meta.name).toBe('X')
  })

  it('returns null for an empty array', () => {
    expect(parseLegacyMcmod('[]')).toBeNull()
  })

  it('returns null on invalid JSON', () => {
    expect(parseLegacyMcmod('{{{')).toBeNull()
  })
})

describe('parseModManifest', () => {
  const fabric = JSON.stringify({ id: 'f', name: 'Fabric One' })
  const quilt = JSON.stringify({ quilt_loader: { id: 'q', metadata: { name: 'Quilt One' } } })

  it('prefers the Fabric manifest when a jar ships both', () => {
    expect(parseModManifest({ fabric, quilt })!.name).toBe('Fabric One')
  })

  it('falls through to Quilt when the Fabric manifest is unparseable', () => {
    expect(parseModManifest({ fabric: 'broken{', quilt })!.name).toBe('Quilt One')
  })

  it('tags a plain mods.toml as running on both Forge and NeoForge', () => {
    const meta = parseModManifest({ forge: '[[mods]]\nmodId = "a"' })!
    expect(meta.loaders).toEqual(['forge', 'neoforge'])
  })

  it('tags neoforge.mods.toml as NeoForge only', () => {
    const meta = parseModManifest({ neoforge: '[[mods]]\nmodId = "a"' })!
    expect(meta.loaders).toEqual(['neoforge'])
  })

  it('prefers neoforge.mods.toml over a legacy mods.toml in the same jar', () => {
    const meta = parseModManifest({
      neoforge: '[[mods]]\nmodId = "new"',
      forge: '[[mods]]\nmodId = "old"'
    })!
    expect(meta.modId).toBe('new')
  })

  it('returns null when the jar carries no manifest at all', () => {
    expect(parseModManifest({})).toBeNull()
    expect(parseModManifest({ fabric: null, quilt: null, forge: null })).toBeNull()
  })
})

describe('loaderAccepts', () => {
  it('accepts a mod built for the instance loader', () => {
    expect(loaderAccepts('fabric', ['fabric'])).toBe('yes')
  })

  it('rejects a mod built for a different loader', () => {
    expect(loaderAccepts('fabric', ['forge'])).toBe('no')
    expect(loaderAccepts('forge', ['fabric'])).toBe('no')
  })

  it('accepts Fabric mods on Quilt', () => {
    expect(loaderAccepts('quilt', ['fabric'])).toBe('yes')
  })

  it('does not accept Quilt mods on Fabric', () => {
    expect(loaderAccepts('fabric', ['quilt'])).toBe('no')
  })

  it('warns rather than rejects across Forge and NeoForge', () => {
    expect(loaderAccepts('neoforge', ['forge'])).toBe('maybe')
    expect(loaderAccepts('forge', ['neoforge'])).toBe('maybe')
  })

  it('stays undecided when the mod declares no loader', () => {
    expect(loaderAccepts('fabric', [])).toBe('maybe')
  })

  it('rejects any mod on a vanilla instance', () => {
    expect(loaderAccepts('vanilla', ['fabric'])).toBe('no')
  })
})

describe('compareVersions', () => {
  it('orders by numeric segment', () => {
    expect(compareVersions('1.21.4', '1.21.3')).toBe(1)
    expect(compareVersions('1.21.3', '1.21.4')).toBe(-1)
    expect(compareVersions('1.21.4', '1.21.4')).toBe(0)
  })

  it('does not compare segments as strings', () => {
    // "10" sorts before "9" lexically but must sort after numerically.
    expect(compareVersions('1.10', '1.9')).toBe(1)
  })

  it('treats a missing segment as zero', () => {
    expect(compareVersions('1.21', '1.21.0')).toBe(0)
    expect(compareVersions('1.21', '1.21.1')).toBe(-1)
  })

  it('splits on dashes and pluses as well as dots', () => {
    expect(compareVersions('1.20.1-47', '1.20.1-46')).toBe(1)
  })
})

describe('versionSatisfies', () => {
  it('accepts an empty or wildcard range', () => {
    expect(versionSatisfies('1.21.4', '')).toBe(true)
    expect(versionSatisfies('1.21.4', '*')).toBe(true)
    expect(versionSatisfies('1.21.4', '   ')).toBe(true)
  })

  it('handles Fabric comparison operators', () => {
    expect(versionSatisfies('1.21.4', '>=1.21')).toBe(true)
    expect(versionSatisfies('1.20.1', '>=1.21')).toBe(false)
    expect(versionSatisfies('1.21.4', '>1.21.4')).toBe(false)
    expect(versionSatisfies('1.20.1', '<=1.21')).toBe(true)
    expect(versionSatisfies('1.21.4', '<1.21')).toBe(false)
    expect(versionSatisfies('1.21.4', '=1.21.4')).toBe(true)
    expect(versionSatisfies('1.21.4', '=1.21.3')).toBe(false)
  })

  it('treats ~ and ^ as same major.minor', () => {
    expect(versionSatisfies('1.21.4', '~1.21')).toBe(true)
    expect(versionSatisfies('1.21.4', '~1.21.0')).toBe(true)
    expect(versionSatisfies('1.20.1', '~1.21')).toBe(false)
  })

  it('handles inclusive Maven ranges', () => {
    expect(versionSatisfies('1.20.1', '[1.20.1,1.21]')).toBe(true)
    expect(versionSatisfies('1.21', '[1.20.1,1.21]')).toBe(true)
    expect(versionSatisfies('1.19.4', '[1.20.1,1.21]')).toBe(false)
  })

  it('honours an exclusive upper bound', () => {
    expect(versionSatisfies('1.20.6', '[1.20.1,1.21)')).toBe(true)
    expect(versionSatisfies('1.21', '[1.20.1,1.21)')).toBe(false)
  })

  it('honours an exclusive lower bound', () => {
    expect(versionSatisfies('1.20.1', '(1.20.1,1.21]')).toBe(false)
    expect(versionSatisfies('1.20.2', '(1.20.1,1.21]')).toBe(true)
  })

  it('handles an open-ended Maven range', () => {
    expect(versionSatisfies('1.21.4', '[1.20.1,)')).toBe(true)
    expect(versionSatisfies('1.19', '[1.20.1,)')).toBe(false)
  })

  it('handles an x-style prefix range', () => {
    expect(versionSatisfies('1.21.4', '1.21.x')).toBe(true)
    expect(versionSatisfies('1.20.1', '1.21.x')).toBe(false)
  })

  it('treats an unparseable range as a match rather than a false warning', () => {
    // These ranges are advisory metadata; a bad one must not flag a good mod.
    expect(versionSatisfies('1.21.4', 'whatever the author typed')).toBe(true)
    expect(versionSatisfies('1.21.4', '1.20.1')).toBe(true)
  })
})
