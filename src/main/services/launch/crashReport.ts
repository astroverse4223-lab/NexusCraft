import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Instance } from '@shared/types'
import { createLogger } from '../../core/logger'

const log = createLogger('crash')

export interface CrashDiagnosis {
  /** Path of the crash report Minecraft wrote, when there is one. */
  reportPath: string | null
  /** The exception line Minecraft blamed, e.g. "java.lang.UnsatisfiedLinkError: ...". */
  cause: string | null
  /** Minecraft's own one-line description, e.g. "Loading library LWJGL system". */
  description: string | null
  /** A plain-language explanation when the cause is one we recognise. */
  explanation: string | null
  /** Concrete steps for this specific failure. */
  actions: string[]
  /** Trimmed excerpt of the report for the technical detail panel. */
  excerpt: string | null
}

/**
 * Patterns for the crashes players actually hit, mapped to advice that names
 * the real problem. Order matters: the first match wins.
 */
const KNOWN: Array<{
  test: RegExp
  explanation: string
  actions: string[]
}> = [
  {
    test: /UnsatisfiedLinkError|Failed to locate library|Failed to load a library|LWJGL/i,
    explanation:
      'Minecraft could not load its native graphics libraries. The files it needs were missing from the folder this version expects them in.',
    actions: [
      'Press "Repair instance" — this re-extracts the native libraries',
      'If it persists, check that antivirus is not quarantining .dll files'
    ]
  },
  {
    test: /OutOfMemoryError|Could not reserve enough space|unable to create native thread/i,
    explanation:
      'The game ran out of memory. Either the heap is too small for what is loaded, or too much was allocated for the system to provide.',
    actions: [
      'Edit the instance and raise the maximum memory a step',
      'If it is already high, lower it — over-allocating starves Windows and makes this worse',
      'Modpacks with large worlds need more than vanilla'
    ]
  },
  {
    /*
     * Leaving a server takes the client down with it.
     *
     * On logout Forge unloads mod configs, and a config that was synced from
     * the server is held in memory rather than backed by a file. `ModConfig.save`
     * casts it to the file-backed type without checking, so the disconnect that
     * should have returned you to the menu ends in a crash report instead. The
     * world is already saved by then, which is why this looks alarming and costs
     * nothing.
     */
    test: /SimpleCommentedConfig cannot be cast|nightconfig.*ClassCastException|ClassCastException.*nightconfig/i,
    explanation:
      'The game crashed while disconnecting, not while playing. Forge tried to save a config that the server had sent it, which is held in memory and has no file to be saved to. Your world and everything in it were already saved before this happened.',
    actions: [
      'Nothing is lost — this happens after the world is saved',
      'It comes from Forge Config API Port, which is installed because another mod asks for it',
      'Find the mod that needs it on the Mods screen; removing both stops the crash',
      'Or leave it: the only symptom is the crash report on the way out'
    ]
  },
  {
    test: /Mixin apply failed|MixinApplyError|Mixin transformation of/i,
    explanation:
      'A mod tried to patch game code that did not look the way it expected. This nearly always means a mod does not match this Minecraft version, or two mods are patching the same thing.',
    actions: [
      'Open the Mods screen and check for version warnings',
      'Disable the mod named in the report and launch again',
      'Update the mod to a build made for this Minecraft version'
    ]
  },
  {
    test: /java\.lang\.UnsupportedClassVersionError|has been compiled by a more recent version/i,
    explanation: 'A mod or library was built for a newer Java version than the runtime being used to launch.',
    actions: [
      'Let NexusCraft pick the Java runtime automatically (clear any override in Settings → Java)',
      'Or install the Java version this Minecraft release expects'
    ]
  },
  {
    test: /Pixel format not accelerated|Couldn't set pixel format|WGL|GLFW error|Failed to create window|OpenGL/i,
    explanation:
      'The graphics driver refused to give Minecraft the display mode it asked for. This is a driver problem rather than a launcher one.',
    actions: [
      'Update your graphics drivers',
      'If you have both integrated and discrete graphics, force Minecraft onto the discrete card',
      'Close any overlay software (recording, FPS counters) and retry'
    ]
  },
  {
    test: /Duplicate mods|ModResolutionException|Incompatible mod set|missing dependenc/i,
    explanation: 'The mod loader refused to start because the installed mods do not fit together.',
    actions: [
      'Open the Mods screen — conflicts and duplicates are flagged there',
      'Remove one of each duplicated mod',
      'Install any dependency the report names'
    ]
  },
  {
    test: /Access is denied|java\.io\.FileNotFoundException|AccessDeniedException/i,
    explanation: 'Minecraft could not read or write a file it needed, usually because another program has it locked.',
    actions: [
      'Make sure the game is not already running',
      'Add the NexusCraft data folder to your antivirus exclusions',
      'Press "Repair instance" to restore anything damaged'
    ]
  }
]

/**
 * Reads the newest crash report Minecraft wrote for an instance and turns it
 * into something a player can act on.
 *
 * Minecraft writes a far better explanation of its own failures than an exit
 * code ever conveys — this surfaces it instead of leaving the user to go
 * hunting through crash-reports/ by hand.
 */
export async function diagnoseCrash(instance: Instance, since: number): Promise<CrashDiagnosis> {
  const empty: CrashDiagnosis = {
    reportPath: null,
    cause: null,
    description: null,
    explanation: null,
    actions: [],
    excerpt: null
  }

  const dir = join(instance.gameDir, 'crash-reports')
  let newest: { path: string; at: number } | null = null

  try {
    for (const name of await readdir(dir)) {
      if (!name.endsWith('.txt')) continue
      const full = join(dir, name)
      const info = await stat(full)
      // Only consider reports written by the run that just ended.
      if (info.mtimeMs + 5000 < since) continue
      if (!newest || info.mtimeMs > newest.at) newest = { path: full, at: info.mtimeMs }
    }
  } catch {
    return empty
  }

  if (!newest) return empty

  let text: string
  try {
    text = await readFile(newest.path, 'utf8')
  } catch {
    return empty
  }

  const description = text.match(/^Description:\s*(.+)$/m)?.[1]?.trim() ?? null

  // The first exception line after the description is what Minecraft blamed.
  const cause =
    text.match(/^(?:[a-z][\w.]*\.)+[A-Z]\w*(?:Error|Exception)[^\n]*/m)?.[0]?.trim() ??
    text.match(/^Caused by:\s*(.+)$/m)?.[1]?.trim() ??
    null

  const haystack = `${description ?? ''}\n${cause ?? ''}\n${text.slice(0, 4000)}`
  const known = KNOWN.find((entry) => entry.test.test(haystack))

  // Keep the head of the report: description, cause and the top stack frames.
  const excerpt = text
    .split(/\r?\n/)
    .slice(0, 40)
    .join('\n')
    .slice(0, 1800)

  log.info(`crash report parsed: ${description ?? 'no description'} / ${cause ?? 'no cause'}`)

  return {
    reportPath: newest.path,
    cause,
    description,
    explanation: known?.explanation ?? null,
    actions: known?.actions ?? [],
    excerpt
  }
}
