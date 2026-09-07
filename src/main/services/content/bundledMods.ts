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

const log = createLogger('bundled')

/**
 * The mods this launcher ships and can install with one press.
 *
 * Written and built in this repository, so installing one is a copy rather than
 * a download. What makes it worth a button is everything either side of the
 * copy: checking the instance can actually run it, noticing Fabric API is
 * missing, and — for the one that talks to a model — filling in an endpoint
 * that has been measured to work.
 *
 * This started as a single file that only knew about Hollow. Adding a second
 * mod by copying it would have meant two of every layer, from the channel down
 * to the card, so the shape became a table instead: a new mod is one entry
 * here and appears in the Mods tab on its own.
 */

export interface BundledMod {
    /** Stable id, used on the wire and as the React key. */
    id: string
    name: string
    /** The file it is copied to, and what "installed" is checked against. */
    jarName: string
    /** One or two sentences, shown on the card. */
    blurb: string
    loader: string
    minecraftVersion: string
    /** Names a lucide icon the card should draw. */
    icon: 'ghost' | 'flame'
    /** True when the mod wants a local model, which changes what the card says. */
    wantsModel: boolean
}

export const BUNDLED_MODS: BundledMod[] = [
    {
        id: 'hollow',
        name: 'Hollow',
        jarName: 'hollow.jar',
        blurb:
            'A companion that is genuinely useful, and stays that way for a while. It talks, it fetches you ' +
            'materials, and it will not give you diamonds. Over a fortnight of play it stops being helpful. ' +
            'Runs on a model on this machine — nothing is sent anywhere.',
        loader: 'fabric',
        minecraftVersion: '1.21.11',
        icon: 'ghost',
        wantsModel: true
    },
    {
        id: 'ember',
        name: 'Ember',
        jarName: 'ember.jar',
        blurb:
            'A lantern keeper that hovers at your shoulder and burns the dark back — it finds the unlit spots ' +
            'mobs would spawn in and puts torches there, and throws its shutters open to blind anything that ' +
            'gets close. No face: it speaks with its flame, its shutters and its hands. Hit it and it sulks.',
        loader: 'fabric',
        minecraftVersion: '1.21.11',
        icon: 'flame',
        wantsModel: false
    }
]

export function findBundledMod(id: string): BundledMod {
    const mod = BUNDLED_MODS.find((candidate) => candidate.id === id)
    if (!mod) {
        throw new LauncherError('NOT_FOUND', `no bundled mod called ${id}`, {
            title: 'That mod is not one this launcher ships',
            message: `Nothing named "${id}" is bundled with the launcher.`,
            actions: ['Reinstall the launcher if you expected it to be there']
        })
    }
    return mod
}

/**
 * The shipped jar.
 *
 * Packaged as an extra resource rather than inside the asar, because it is
 * copied out to disk and asar paths are not real files to everything that
 * might read them.
 */
function bundledJar(mod: BundledMod): string {
    return app.isPackaged
        ? join(process.resourcesPath, mod.jarName)
        : join(app.getAppPath(), 'resources', mod.jarName)
}

export interface BundledModStatus {
    id: string
    name: string
    blurb: string
    icon: BundledMod['icon']
    wantsModel: boolean
    /** What it needs, phrased for the pill on the card. */
    requires: string
    /** Whether the launcher has a jar to install at all. */
    available: boolean
    /** Whether this instance can run it. */
    compatible: boolean
    installed: boolean
    /** Present when `compatible` is false, saying why. */
    reason: string | null
    /** Whether Fabric API is present, which these mods need. */
    hasFabricApi: boolean
    /** The model it would be configured to use, when one can be found. */
    suggestedModel: string | null
    /**
     * Names of instances that can run it.
     *
     * So an incompatible instance can point somewhere rather than being a dead
     * end. Hiding the card on instances that cannot run it seemed tidy and was
     * the reason nobody found the feature: the instance most people have
     * selected is the one they were last playing, which is exactly the one it
     * hid on.
     */
    compatibleInstances: string[]
}

export async function bundledModStatus(instance: Instance, id: string): Promise<BundledModStatus> {
    const mod = findBundledMod(id)

    const mods = instanceSubdir(instance, 'mods')
    let entries: string[] = []
    try {
        entries = await readdir(mods)
    } catch {
        // No mods folder yet is normal for a fresh instance.
    }

    const compatible =
        instance.loader === mod.loader && instance.minecraftVersion === mod.minecraftVersion

    const local = mod.wantsModel ? await findLocalModel() : null

    const compatibleInstances = listInstances()
        .filter(
            (other) =>
                other.loader === mod.loader && other.minecraftVersion === mod.minecraftVersion
        )
        .map((other) => other.name)

    return {
        id: mod.id,
        name: mod.name,
        blurb: mod.blurb,
        icon: mod.icon,
        wantsModel: mod.wantsModel,
        requires: `Fabric ${mod.minecraftVersion}`,
        available: existsSync(bundledJar(mod)),
        compatibleInstances,
        compatible,
        installed: entries.includes(mod.jarName),
        reason: compatible
            ? null
            : `${mod.name} is built for Fabric ${mod.minecraftVersion}, and this instance is ` +
              `${instance.loader} ${instance.minecraftVersion}.`,
        // Matched loosely: the file is named for its version, which changes.
        hasFabricApi: entries.some((name) => name.toLowerCase().startsWith('fabric-api')),
        suggestedModel: local?.model ?? null
    }
}

export async function allBundledModStatuses(instance: Instance): Promise<BundledModStatus[]> {
    return await Promise.all(BUNDLED_MODS.map((mod) => bundledModStatus(instance, mod.id)))
}

/**
 * The config Hollow reads, written for this machine.
 *
 * Written on install rather than left to the mod's own defaults so that the
 * model name is one that has been measured to follow the format. The mod will
 * write its own file if this is absent, and its default is a reasonable guess;
 * this is a better one because it can see what is actually installed.
 */
function hollowConfig(model: string): string {
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

export interface BundledInstallResult {
    id: string
    name: string
    installedJar: boolean
    wroteConfig: boolean
    model: string | null
    warning: string | null
}

export async function installBundledMod(
    instance: Instance,
    id: string
): Promise<BundledInstallResult> {
    const mod = findBundledMod(id)
    const status = await bundledModStatus(instance, id)

    if (!status.available) {
        throw new LauncherError('NOT_FOUND', `the ${mod.name} jar was not shipped with this build`, {
            title: `${mod.name} is not available in this build`,
            message: 'The launcher could not find the mod file it ships with.',
            actions: ['Reinstall the launcher']
        })
    }

    if (!status.compatible) {
        throw new LauncherError('INVALID_INPUT', status.reason ?? 'incompatible instance', {
            title: `This instance cannot run ${mod.name}`,
            message: status.reason ?? '',
            actions: [`Create a Fabric ${mod.minecraftVersion} instance and install it there`]
        })
    }

    const mods = instanceSubdir(instance, 'mods')
    await mkdir(mods, { recursive: true })
    await copyFile(bundledJar(mod), join(mods, mod.jarName))

    let wroteConfig = false
    const local = mod.wantsModel ? await findLocalModel() : null

    /*
     * The config is only written when there is not one already. Overwriting it
     * would throw away a hand-edited endpoint every time someone reinstalled,
     * and reinstalling is exactly what people do when something is not working.
     */
    if (mod.id === 'hollow' && local) {
        const configDir = join(instanceDir(instance.id), 'minecraft', 'config')
        const configPath = join(configDir, 'hollow.properties')
        if (!existsSync(configPath)) {
            await mkdir(configDir, { recursive: true })
            await writeFile(configPath, hollowConfig(local.model), 'utf8')
            wroteConfig = true
        }
    }

    const warning = !status.hasFabricApi
        ? `Fabric API is not installed in this instance, and ${mod.name} needs it. Install it from the Browse tab.`
        : mod.wantsModel && !local
          ? 'No local model was found, so the mod will use its own defaults. Start Ollama, or edit config/hollow.properties.'
          : null

    log.info(`installed ${mod.name} into "${instance.name}"${local ? ` using ${local.model}` : ''}`)
    return {
        id: mod.id,
        name: mod.name,
        installedJar: true,
        wroteConfig,
        model: local?.model ?? null,
        warning
    }
}
