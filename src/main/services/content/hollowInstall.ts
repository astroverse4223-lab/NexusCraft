import { app } from 'electron'
import { copyFile, mkdir, readdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Instance } from '@shared/types'
import { createLogger } from '../../core/logger'
import { LauncherError } from '../../core/errors'
import { instanceSubdir, listInstances } from '../instances/instanceService'
import { instanceDir } from '../../core/paths'
import { findLocalModel } from '../launch/localModel'

const log = createLogger('hollow')

/**
 * Installing the Hollow mod into an instance.
 *
 * The mod is written and built in this repository and shipped alongside the
 * launcher, so installing it is a copy rather than a download. What makes this
 * worth a button is not the copy — it is everything either side of it. A mod
 * that talks to a language model normally means finding a jar, checking your
 * loader, installing the API it depends on, then hand-editing a config file to
 * point at an endpoint, choose a model, and get the `/v1` on the end right.
 *
 * Every one of those steps is a place to give up, and the last is the worst:
 * the wrong model produces a companion that answers in the wrong format and
 * looks broken rather than misconfigured. The launcher already knows the
 * instance, already knows what Ollama has, and has measured which of those
 * models actually behave. So it fills all of it in.
 */

/** What the mod was built against. Anything else will not load. */
const REQUIRES_LOADER = 'fabric'
const REQUIRES_VERSION = '1.21.11'

const JAR_NAME = 'hollow.jar'

/**
 * The shipped jar.
 *
 * Packaged as an extra resource rather than inside the asar, because it is
 * copied out to disk and asar paths are not real files to everything that
 * might read them.
 */
function bundledJar(): string {
  // Packaged builds put extra resources beside the app; a source run has them
  // in the repository.
  return app.isPackaged
    ? join(process.resourcesPath, JAR_NAME)
    : join(app.getAppPath(), 'resources', JAR_NAME)
}

export interface HollowStatus {
  /** Whether the launcher has a jar to install at all. */
  available: boolean
  /** Whether this instance can run it. */
  compatible: boolean
  installed: boolean
  /** Present when `compatible` is false, saying why. */
  reason: string | null
  /** Whether Fabric API is present, which the mod needs. */
  hasFabricApi: boolean
  /** The model it would be configured to use, when one can be found. */
  suggestedModel: string | null
  /**
   * Names of instances that can run it.
   *
   * So an incompatible instance can point somewhere rather than being a dead
   * end. Hiding the card on instances that cannot run it seemed tidy and was
   * the reason nobody found the feature: the instance most people have selected
   * is the one they were last playing, which is exactly the one it hid on.
   */
  compatibleInstances: string[]
}

export async function hollowStatus(instance: Instance): Promise<HollowStatus> {
  const mods = instanceSubdir(instance, 'mods')
  let entries: string[] = []
  try {
    entries = await readdir(mods)
  } catch {
    // No mods folder yet is normal for a fresh instance.
  }

  const compatible =
    instance.loader === REQUIRES_LOADER && instance.minecraftVersion === REQUIRES_VERSION

  const local = await findLocalModel()

  const compatibleInstances = listInstances()
    .filter((other) => other.loader === REQUIRES_LOADER && other.minecraftVersion === REQUIRES_VERSION)
    .map((other) => other.name)

  return {
    available: existsSync(bundledJar()),
    compatibleInstances,
    compatible,
    installed: entries.includes(JAR_NAME),
    reason: compatible
      ? null
      : `Hollow is built for Fabric ${REQUIRES_VERSION}, and this instance is ` +
        `${instance.loader} ${instance.minecraftVersion}.`,
    // Matched loosely: the file is named for its version, which changes.
    hasFabricApi: entries.some((name) => name.toLowerCase().startsWith('fabric-api')),
    suggestedModel: local?.model ?? null
  }
}

/**
 * The config the mod reads, written for this machine.
 *
 * Written on install rather than left to the mod's own defaults so that the
 * model name is one that has been measured to follow the format. The mod will
 * write its own file if this is absent, and its default is a reasonable guess;
 * this is a better one because it can see what is actually installed.
 */
function configFor(model: string): string {
  return `# Hollow — written by NexusCraft Launcher on install.
#
# Anything speaking the OpenAI chat-completions API works here. This was
# pointed at the Ollama already running on this machine, and at a model
# measured to hold the reply format the mod needs.
#
# If the companion starts answering in prose, or narrating its own reasoning
# out loud, the model is the cause rather than the mod. Reasoning models
# (deepseek-r1, qwen3 with thinking) and agent-tuned ones (andy) all do this.

baseUrl=http://127.0.0.1:11434/v1
model=${model}
apiKey=

timeoutSeconds=30

# Seconds between the director considering whether anything happens. Lower is
# not scarier: something that speaks every twenty seconds is company.
thinkEverySeconds=90

# 0 turns the model off and leaves only the written lines.
temperature=0.9
`
}

export interface HollowInstallResult {
  installedJar: boolean
  wroteConfig: boolean
  model: string | null
  warning: string | null
}

export async function installHollow(instance: Instance): Promise<HollowInstallResult> {
  const status = await hollowStatus(instance)

  if (!status.available) {
    throw new LauncherError('NOT_FOUND', 'the Hollow jar was not shipped with this build', {
      title: 'Hollow is not available in this build',
      message: 'The launcher could not find the mod file it ships with.',
      actions: ['Reinstall the launcher']
    })
  }

  if (!status.compatible) {
    throw new LauncherError('INVALID_INPUT', status.reason ?? 'incompatible instance', {
      title: 'This instance cannot run Hollow',
      message: status.reason ?? '',
      actions: [`Create a Fabric ${REQUIRES_VERSION} instance and install it there`]
    })
  }

  const mods = instanceSubdir(instance, 'mods')
  await mkdir(mods, { recursive: true })
  await copyFile(bundledJar(), join(mods, JAR_NAME))

  /*
   * The config is only written when there is not one already. Overwriting it
   * would throw away a hand-edited endpoint every time someone reinstalled,
   * and reinstalling is exactly what people do when something is not working.
   */
  const configDir = join(instanceDir(instance.id), 'minecraft', 'config')
  const configPath = join(configDir, 'hollow.properties')
  let wroteConfig = false
  const local = await findLocalModel()

  if (!existsSync(configPath) && local) {
    await mkdir(configDir, { recursive: true })
    await writeFile(configPath, configFor(local.model), 'utf8')
    wroteConfig = true
  }

  const warning = !status.hasFabricApi
    ? 'Fabric API is not installed in this instance, and Hollow needs it. Install it from the Browse tab.'
    : !local
      ? 'No local model was found, so the mod will use its own defaults. Start Ollama, or edit config/hollow.properties.'
      : null

  log.info(`installed Hollow into "${instance.name}"${local ? ` using ${local.model}` : ''}`)
  return { installedJar: true, wroteConfig, model: local?.model ?? null, warning }
}
