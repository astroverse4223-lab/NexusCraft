import type { ModInfo } from '@shared/types'

/**
 * Works out which mod is actually in the stack trace.
 *
 * The launcher already reads crash reports and already reads every mod's
 * metadata, and until now nothing joined the two — so a crash that names
 * `fuzs.forgeconfigapiport.forge.impl.neoforge.NeoForgeConfigSpecAdapter` in
 * its first frame was reported to the player as "Exit code 4294967295". The
 * information to say "Forge Config API Port did this" was sitting in two places
 * at once.
 *
 * Matching is on package names against mod ids and jar names, which is a
 * heuristic rather than proof — mod authors are not obliged to name their
 * packages after their mod, and most do. So this reports a *suspect* with a
 * confidence, and never states it as fact.
 */

export interface Blame {
  /** The jar as it sits in the mods folder. */
  fileName: string
  /** The mod's display name, for saying out loud. */
  name: string
  modId: string | null
  /** The stack frame that pointed at it. */
  frame: string
  /**
   * How far down the trace it appeared. The first frames are where the fault
   * happened; deeper ones are only the road it travelled.
   */
  depth: number
}

/** Frames belonging to the game, the loader or Java itself never blame a mod. */
const NOT_A_MOD = [
  'java.', 'javax.', 'jdk.', 'sun.', 'com.sun.',
  'net.minecraft.', 'com.mojang.',
  'net.fabricmc.', 'net.minecraftforge.', 'net.neoforged.',
  'cpw.mods.', 'org.spongepowered.', 'io.netty.', 'org.lwjgl.',
  'org.apache.', 'it.unimi.', 'com.google.'
]

/**
 * Package-ish names out of the stack, in order.
 *
 * Crash reports write frames several ways depending on the loader — plain
 * `at com.example.Thing.method(Thing.java:12)`, or with a TRANSFORMER/ prefix
 * and a jar in brackets after it. The package is what matters and it always
 * sits after the `at `.
 */
export function framesOf(report: string): string[] {
  const frames: string[] = []

  for (const line of report.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('at ')) continue

    /*
     * Strip the loader's routing prefix, then take what looks like a class path.
     *
     * Forge writes several: `TRANSFORMER/mod@version/`, `LAYER PLUGIN/...`,
     * `SECURE-BOOTSTRAP/...`. The first pattern here allowed no spaces, so
     * every `LAYER PLUGIN` frame was silently dropped — which would have hidden
     * any mod unlucky enough to appear under one.
     */
    const body = trimmed.slice(3).replace(/^[A-Z][A-Z -]*\/[^/]*\//, '')
    const match = /^([a-z][\w.$]*\.[A-Z]\w*)/.exec(body) ?? /^([a-z][\w.$]{4,})/.exec(body)
    if (match) frames.push(match[1])
  }

  return frames
}

/** Whether a frame could belong to a mod at all. */
function couldBeAMod(frame: string): boolean {
  return !NOT_A_MOD.some((prefix) => frame.startsWith(prefix))
}

/**
 * Names that would identify a mod inside a package.
 *
 * A mod id of `forgeconfigapiport` appears verbatim in
 * `fuzs.forgeconfigapiport.forge.impl`. A file name of
 * `ForgeConfigAPIPort-v21.11.1-mc1.21.11-Forge.jar` reduces to the same thing
 * once the version and loader noise is taken off it.
 */
function namesFor(mod: ModInfo): string[] {
  const names = new Set<string>()

  if (mod.modId) names.add(mod.modId.toLowerCase().replace(/[^a-z0-9]/g, ''))

  const bare = mod.fileName
    .replace(/\.jar$/i, '')
    // Everything from the first version-looking segment onward is noise.
    .split(/[-_+]/)[0]
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')

  if (bare.length >= 4) names.add(bare)

  const fromName = mod.name.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (fromName.length >= 4) names.add(fromName)

  // Two-letter ids match half the packages in the world.
  return [...names].filter((name) => name.length >= 4)
}

/**
 * The most likely culprit, or null when the trace is all game and loader.
 *
 * Shallowest match wins: the frame where a fault happened is nearer the top
 * than the frames that merely led to it, and the deepest frame in almost every
 * crash is the game's own main loop.
 */
export function blameFor(report: string, mods: ModInfo[]): Blame | null {
  const frames = framesOf(report);

  const candidates = mods
    .map((mod) => ({ mod, names: namesFor(mod) }))
    .filter((entry) => entry.names.length > 0)

  for (let depth = 0; depth < frames.length; depth++) {
    const frame = frames[depth]
    if (!couldBeAMod(frame)) continue

    const flattened = frame.toLowerCase().replace(/[^a-z0-9]/g, '')

    for (const { mod, names } of candidates) {
      if (!names.some((name) => flattened.includes(name))) continue

      return {
        fileName: mod.fileName,
        name: mod.name,
        modId: mod.modId,
        frame,
        depth
      }
    }
  }

  return null
}
