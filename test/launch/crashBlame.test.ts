import { describe, expect, it } from 'vitest'
import type { ModInfo } from '@shared/types'
import { blameFor, framesOf } from '../../src/main/services/launch/crashBlame'

/**
 * Naming the mod, from the trace of a crash that actually happened.
 *
 * This is the disconnect crash from the Zombie Invade instance, reported to the
 * player as "Exit code 4294967295. Open the log for details." — while the very
 * first non-game frame named the mod responsible. The launcher held both halves
 * and never put them together.
 */
const REPORT = `---- Minecraft Crash Report ----
Description: Unexpected error

java.lang.ClassCastException: class com.electronwill.nightconfig.core.SimpleCommentedConfig cannot be cast to class com.electronwill.nightconfig.core.file.CommentedFileConfig
	at LAYER PLUGIN/net.minecraftforge.fmlcore@1.21.11-61.2.1/net.minecraftforge.fml.config.ModConfig.save(ModConfig.java:80)
	at LAYER PLUGIN/net.minecraftforge.fmlcore@1.21.11-61.2.1/net.minecraftforge.fml.config.ConfigTracker.closeConfig(ConfigTracker.java:94)
	at TRANSFORMER/forgeconfigapiport@21.11.1/fuzs.forgeconfigapiport.forge.impl.neoforge.NeoForgeConfigSpecAdapter.lambda$registerEventHandlers$4(NeoForgeConfigSpecAdapter.java:59)
	at TRANSFORMER/net.minecraftforge.forge@61.2.1/net.minecraftforge.client.event.ForgeEventFactoryClient.firePlayerLogout(ForgeEventFactoryClient.java:185)
	at java.base/java.lang.Thread.run(Thread.java:1583)
`

function mod(fileName: string, modId: string | null, name: string): ModInfo {
  return {
    path: 'C:/mods/' + fileName,
    fileName,
    modId,
    name,
    version: null,
    description: null,
    authors: [],
    loaders: ['forge'],
    issues: []
  } as unknown as ModInfo
}

const INSTALLED = [
  mod('ForgeConfigAPIPort-v21.11.1-mc1.21.11-Forge.jar', 'forgeconfigapiport', 'Forge Config API Port'),
  mod('open-parties-and-claims-forge-1.21.11-0.30.3.jar', 'openpartiesandclaims', 'Open Parties and Claims'),
  mod('Jade-1.20.1-Forge-11.13.2.jar', 'jade', 'Jade'),
  mod('sodium-fabric-0.8.7+mc1.21.11.jar', 'sodium', 'Sodium')
]

describe('reading a stack trace', () => {
  it('pulls the frames out, prefixes and all', () => {
    const frames = framesOf(REPORT)
    expect(frames[0]).toBe('net.minecraftforge.fml.config.ModConfig')
    expect(frames).toContain('fuzs.forgeconfigapiport.forge.impl.neoforge.NeoForgeConfigSpecAdapter')
  })

  it('ignores anything that is not a frame', () => {
    expect(framesOf('Description: Unexpected error\nnot a frame at all')).toEqual([])
  })
})

describe('blaming a mod', () => {
  it('names the one from the real crash', () => {
    const blame = blameFor(REPORT, INSTALLED)
    expect(blame).not.toBeNull()
    expect(blame!.name).toBe('Forge Config API Port')
    expect(blame!.fileName).toContain('ForgeConfigAPIPort')
  })

  it('skips the game and the loader to get there', () => {
    // The first two frames are Forge's own; blaming those would be useless.
    const blame = blameFor(REPORT, INSTALLED)
    expect(blame!.frame).toContain('forgeconfigapiport')
  })

  it('blames nothing when the trace is all game code', () => {
    const vanilla = `java.lang.NullPointerException
	at net.minecraft.client.Minecraft.runTick(Minecraft.java:1333)
	at java.base/java.lang.Thread.run(Thread.java:1583)
`
    expect(blameFor(vanilla, INSTALLED)).toBeNull()
  })

  it('blames nothing when the mod is not installed', () => {
    // A crash in someone else's mod, on an instance that does not have it.
    const elsewhere = `java.lang.IllegalStateException
	at com.someone.othermod.Thing.go(Thing.java:1)
`
    expect(blameFor(elsewhere, INSTALLED)).toBeNull()
  })

  it('matches on the jar name when the mod id is missing', () => {
    const noId = [mod('SomeCoolMod-1.2.3.jar', null, 'Some Cool Mod')]
    const report = `at somecoolmod.internal.Boom.explode(Boom.java:4)`
    expect(blameFor(report, noId)?.fileName).toBe('SomeCoolMod-1.2.3.jar')
  })

  it('does not blame a mod for a short coincidental match', () => {
    // A two- or three-letter id would otherwise match half the packages alive.
    const shortId = [mod('ab.jar', 'ab', 'AB')]
    const report = `at com.fabric.something.Thing.go(Thing.java:1)`
    expect(blameFor(report, shortId)).toBeNull()
  })
})
