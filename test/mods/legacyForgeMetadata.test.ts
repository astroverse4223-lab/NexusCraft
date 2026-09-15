import { describe, expect, it } from 'vitest'
import { parseLegacyMcmod, parseModManifest } from '../../src/main/services/mods/modMetadata'

/**
 * 1.12.2 mods that also ship a mods.toml they never use.
 *
 * A fresh RLCraft install had four mods refused with "would crash this
 * instance", and every one of them was fine. They carry both manifests: the
 * `mcmod.info` that Forge 14 actually reads, and a `META-INF/mods.toml` left
 * over from a template - MixinCompat's still opens with "This is an example
 * mods.toml file".
 *
 * The toml said `loaderVersion="[24,)"`. The instance runs Forge 14.23.5.2860.
 * Fourteen is less than twenty-four, so the launcher called it too old and
 * refused to start - except that Forge changed its numbering at the same
 * release it changed its metadata format, so the two numbers were never
 * measuring the same thing.
 */

/** EnhancedVisuals_v1.4.4_mc1.12.2.jar, as it actually ships. */
const ENHANCED_VISUALS_MCMOD = `[
{
  "modid": "enhancedvisuals",
  "name": "Enhanced Visuals",
  "description": "Experience realism and extra video effects.",
  "mcversion": "\${mcversion}",
  "version": "1.3",
  "authorList": ["Sonicjumper", "CreativeMD"]
}
]`

const ENHANCED_VISUALS_TOML = `modLoader="javafml"
loaderVersion="[24,)"
license="GNU General Public License v3.0"

[[mods]]
modId="enhancedvisuals"
version="1.3.0"
displayName="EnhancedVisuals"
`

/** [___MixinCompat-0.8___].jar, which never filled either field in. */
const MIXIN_COMPAT_MCMOD = `[
  {
    "modid": "mixincompat",
    "name": "Mixin Compatibility",
    "version": "\${version}",
    "mcversion": "\${mcversion}",
    "authorList": ["NotStirred"]
  }
]`

describe('a template mods.toml left in a 1.12.2 jar', () => {
  it('still reads the mod, from whichever manifest is there', () => {
    const meta = parseModManifest({
      forge: ENHANCED_VISUALS_TOML,
      legacy: ENHANCED_VISUALS_MCMOD
    })

    expect(meta).not.toBeNull()
    expect(meta!.modId).toBe('enhancedvisuals')
  })

  it('carries the loader range the toml declares, for whoever asks', () => {
    /*
     * Not removed here. The range is real, it is simply about a Forge that
     * this jar will never meet - so the metadata keeps it and the decision
     * about whether it means anything is made where the instance is known.
     */
    const meta = parseModManifest({ forge: ENHANCED_VISUALS_TOML, legacy: ENHANCED_VISUALS_MCMOD })

    expect(meta!.loaderVersionRange).toBe('[24,)')
  })
})

describe('build placeholders that were never filled in', () => {
  it('does not treat ${mcversion} as a Minecraft version', () => {
    /*
     * Left alone this was compared against the instance and warned that a mod
     * built for 1.12.2 does not support 1.12.2.
     */
    const meta = parseLegacyMcmod(ENHANCED_VISUALS_MCMOD)

    expect(meta!.mcVersionRange).toBeNull()
  })

  it('does not treat ${version} as the mod version', () => {
    const meta = parseLegacyMcmod(MIXIN_COMPAT_MCMOD)

    expect(meta!.version).toBeNull()
    expect(meta!.modId).toBe('mixincompat')
  })

  it('keeps a version that is a real one', () => {
    const meta = parseLegacyMcmod(ENHANCED_VISUALS_MCMOD)

    expect(meta!.version).toBe('1.3')
  })

  it('keeps a real mcversion', () => {
    const meta = parseLegacyMcmod(`[{"modid": "a", "mcversion": "1.12.2"}]`)

    expect(meta!.mcVersionRange).toBe('1.12.2')
  })

  it('treats the maven style of placeholder the same way', () => {
    const meta = parseLegacyMcmod(`[{"modid": "a", "version": "@VERSION@"}]`)

    expect(meta!.version).toBeNull()
  })
})
