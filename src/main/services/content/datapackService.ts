import { existsSync } from 'node:fs'
import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import AdmZip from 'adm-zip'
import { packMcmeta } from '@shared/creations'
import type { DataPackDefinition, DataPackOptionValues, Instance } from '@shared/types'
import { LauncherError } from '../../core/errors'
import { createLogger } from '../../core/logger'
import { assertInside } from '../../core/paths'
import { instanceSubdir } from '../instances/instanceService'
import { versionJarPath, resolveVersion } from '../minecraft/versionService'
import { PACKS, type BuildContext, type JsonFile } from './datapackCatalogue'

const log = createLogger('datapacks')

/**
 * Data packs are Minecraft's own extension format: JSON and `.mcfunction`
 * command scripts that vanilla loads directly. No compiler, no mod loader and
 * no Java toolchain is involved, which is why the launcher can generate them
 * honestly where it could not produce a real mod jar.
 */

const NAMESPACE = 'nexuscraft'

/* --------------------------------------------------------- pack format */

/**
 * The data pack format the target version expects.
 *
 * Read out of `version.json` inside the client jar, which is where Mojang
 * states it — so it stays correct for any release, including ones newer than
 * this launcher.
 */
/**
 * A rough data pack format for a Minecraft version, used only when the client
 * jar is not on disk to read it from. Deliberately generous: refusing a pack
 * that would have worked is worse than letting Minecraft reject it itself.
 */
/**
 * Exported so a generated pack can use the same table.
 *
 * A wrong pack_format is the worst kind of wrong: the game loads the pack,
 * ignores everything in it, and says so only in a log line nobody reads.
 */
/**
 * The data pack format a version really uses, read from its own jar.
 *
 * Guessing from the version number was wrong for two of the versions actually
 * installed here: 1.21.11 was guessed at 88 and is 94, and 26.2 was guessed at
 * 94 and is 107. A pack written with the wrong number declares support for a
 * version of the format the game is not running, and the game is entitled to
 * refuse it - so the jar is asked first and the guess is only the fallback for
 * a version that has not been downloaded.
 */
export function packFormatOf(versionId: string, kind: 'data' | 'resource' = 'data'): number {
  /*
   * Inside the try, because working out where the jar would be can itself
   * throw - an unknown version, or a data root not yet set up. This function
   * promises a number and falls back to a guess for exactly those cases, so
   * letting one escape would take the whole pack build down instead.
   */
  try {
    const jar = versionJarPath(versionId)

    if (existsSync(jar)) {
      const entry = new AdmZip(jar).getEntry('version.json')

      if (entry) {
        const meta = JSON.parse(entry.getData().toString('utf8')) as {
          pack_version?: number | Record<string, number>
        }

        const version = meta.pack_version

        /*
         * The two are not the same number and never have been.
         *
         * 26.2 is resource 88 and data 107; 1.21.1 is resource 34 and data 48.
         * Older jars state one number for both, newer ones split it into
         * `<kind>_major` - so all three shapes are read rather than assumed.
         */
        const found =
          typeof version === 'number'
            ? version
            : (version?.[`${kind}_major`] ?? version?.[kind])

        if (typeof found === 'number' && found > 0) return found
      }
    }
  } catch (err) {
    log.warn(`could not read pack_version from ${versionId}.jar: ${(err as Error).message}`)
  }

  return kind === 'resource' ? guessResourceFormat(versionId) : guessPackFormat(versionId)
}

/**
 * A rough resource pack format, for a version whose jar is not on disk.
 *
 * Every number below was read out of a real `version.json` rather than
 * remembered: 1.20.1 is 15, 1.21.1 is 34, 1.21.11 is 75, 26.1.2 is 84 and
 * 26.2 is 88.
 */
export function guessResourceFormat(versionId: string): number {
  const parts = versionId.split('.').map((n) => parseInt(n, 10))

  if (parts[0] >= 26) {
    if (parts[0] > 26) return 88
    return (parts[1] ?? 0) >= 2 ? 88 : 84
  }

  if (parts[0] === 1) {
    const minor = parts[1] ?? 0
    const patch = parts[2] ?? 0

    if (minor >= 22) return 75
    if (minor === 21) {
      if (patch >= 9) return 75
      if (patch >= 4) return 46
      if (patch >= 2) return 42
      return 34
    }
    if (minor === 20) {
      if (patch >= 5) return 32
      if (patch >= 2) return 18
      return 15
    }
    if (minor === 19) return 9
    if (minor === 18) return 8
  }

  return 15
}

export function guessPackFormat(versionId: string): number {
  const parts = versionId.split('.').map((n) => parseInt(n, 10))

  /*
   * Year-based versions. Measured, not assumed: 26.1.2 is 101 and 26.2 is 107,
   * so anything newer is at least that and the number climbs quickly.
   */
  if (parts[0] >= 26) {
    if (parts[0] > 26) return 107
    return (parts[1] ?? 0) >= 2 ? 107 : 101
  }

  if (parts[0] === 1) {
    const minor = parts[1] ?? 0
    const patch = parts[2] ?? 0
    if (minor >= 22) return 94
    if (minor === 21) {
      // 1.21.11's own jar says 94, where this used to say 88.
      if (patch >= 9) return 94
      if (patch >= 5) return 71
      if (patch >= 2) return 57
      return 48
    }
    if (minor === 20) {
      if (patch >= 5) return 41
      if (patch >= 2) return 18
      return 15
    }
    if (minor === 19) return 10
    if (minor === 18) return 8
  }

  return 15
}

/**
 * The pack.mcmeta document for a given data pack format.
 *
 * Formats above 81 changed the rules: Minecraft refuses the pack outright
 * unless `min_format` and `max_format` are present, with
 *
 *   Couldn't load ... pack metadata: Pack declares support for version newer
 *   than 81, but is missing mandatory fields min_format and max_format
 *
 * and it fails at the metadata stage, so the functions inside are never even
 * read — which shows up afterwards as tags "missing following references".
 * `pack_format` is still written for older versions that only understand that.
 */
function packMetadata(format: number, name: string): Record<string, unknown> {
  return packMcmeta(format, `${name} — generated by NexusCraft Launcher`)
}

export async function readPackFormat(instance: Instance): Promise<{ format: number; source: string }> {
  const versionId = instance.resolvedVersionId ?? instance.minecraftVersion
  let baseId = instance.minecraftVersion
  try {
    const version = await resolveVersion(versionId)
    baseId = version.resolvedBaseId ?? instance.minecraftVersion
  } catch {
    /* fall back to the instance's own version id */
  }

  const jar = versionJarPath(baseId)
  if (existsSync(jar)) {
    try {
      const entry = new AdmZip(jar).getEntry('version.json')
      if (entry) {
        /*
         * Three shapes have existed for this field:
         *
         *   pack_version: 15                                  (oldest)
         *   pack_version: { data: 15, resource: 15 }
         *   pack_version: { data_major: 94, data_minor: 1 }   (current)
         *
         * Only the first two were handled, so a modern jar produced no number
         * at all and fell through to the 15 fallback — which made the launcher
         * declare that Minecraft 1.21.11 "uses data pack format 15" and refuse
         * to install packs it is perfectly capable of running.
         */
        const meta = JSON.parse(entry.getData().toString('utf8')) as {
          pack_version?: number | { data?: number; resource?: number; data_major?: number }
        }
        const packVersion = meta.pack_version
        const data =
          typeof packVersion === 'number'
            ? packVersion
            : (packVersion?.data_major ?? packVersion?.data)

        if (typeof data === 'number' && data > 0) {
          return { format: data, source: `version.json in ${baseId}.jar` }
        }
      }
    } catch (err) {
      log.warn(`could not read pack_version from ${baseId}.jar: ${(err as Error).message}`)
    }
  }

  /*
   * Guess from the version number rather than assuming an ancient format.
   * Defaulting to 15 meant an uninstalled jar looked like Minecraft 1.20, and
   * every pack needing anything newer was refused for a version that supports
   * it. A rough mapping is wrong far less often than a fixed guess.
   */
  const guess = guessPackFormat(baseId)
  return { format: guess, source: `estimated from the version number (${baseId})` }
}

/**
 * Minecraft renamed data pack directories to singular forms in 1.21 (pack
 * format 48): `functions` became `function`, `advancements` became
 * `advancement`, and so on.
 *
 * Both layouts are written. A version only scans the directory names it knows,
 * so the unused set is ignored rather than loaded twice — and one pack then
 * works on old and new versions alike.
 */
interface Layout {
  function: string
  advancement: string
  recipe: string
  loot_table: string
  predicate: string
}

const MODERN: Layout = {
  function: 'function',
  advancement: 'advancement',
  recipe: 'recipe',
  loot_table: 'loot_table',
  predicate: 'predicate'
}

const LEGACY: Layout = {
  function: 'functions',
  advancement: 'advancements',
  recipe: 'recipes',
  loot_table: 'loot_tables',
  predicate: 'predicates'
}

function layouts(format: number): Layout[] {
  return format >= 48 ? [MODERN, LEGACY] : [LEGACY, MODERN]
}

/* ------------------------------------------------------------ catalogue */

export function listDataPacks(): DataPackDefinition[] {
  return PACKS.map(({ build, minPackFormat, ...definition }) => definition)
}

function findPack(id: string): (typeof PACKS)[number] {
  const pack = PACKS.find((p) => p.id === id)
  if (!pack) throw new LauncherError('NOT_FOUND', `no data pack named ${id}`)
  return pack
}

/* ------------------------------------------------------------- building */

export interface BuiltPack {
  fileName: string
  files: Array<{ path: string; content: string }>
  packFormat: number
  formatSource: string
}

/** Renders a pack definition into the exact files that go inside the zip. */
export async function buildDataPack(
  instance: Instance,
  packId: string,
  options: DataPackOptionValues
): Promise<BuiltPack> {
  const pack = findPack(packId)
  const { format, source } = await readPackFormat(instance)

  if (pack.minPackFormat && format < pack.minPackFormat) {
    throw new LauncherError('INVALID_INPUT', `${pack.id} needs pack format ${pack.minPackFormat}, got ${format}`, {
      title: `${pack.name} needs a newer Minecraft version`,
      message: `This pack relies on features Minecraft only gained in a later release. Minecraft ${instance.minecraftVersion} uses data pack format ${format}, and this pack needs at least ${pack.minPackFormat}.`,
      actions: ['Use this pack on a newer instance', 'Or pick a different pack']
    })
  }

  const ns = `${NAMESPACE}_${pack.id.replace(/-/g, '_')}`
  const context: BuildContext = { options, ns, format }
  const output = pack.build(context)

  const files: Array<{ path: string; content: string }> = [
    {
      path: 'pack.mcmeta',
      content: JSON.stringify(packMetadata(format, pack.name), null, 2)
    }
  ]

  const header = [
    `# ${pack.name}`,
    `# Generated by NexusCraft Launcher for Minecraft ${instance.minecraftVersion}`,
    '# Safe to edit by hand — it is a plain data pack.',
    ''
  ]

  const announce = `tellraw @a [{"text":"[NexusCraft] ","color":"aqua"},{"text":"${pack.name} loaded","color":"gray"}]`

  for (const layout of layouts(format)) {
    for (const [name, lines] of Object.entries(output.functions)) {
      // A pack with nothing to run on load still gets a load function, so the
      // "pack loaded" message confirms it is active.
      const body = name === 'load' ? [...lines, announce] : lines
      if (body.length === 0 && name !== 'load') continue

      files.push({
        path: `data/${ns}/${layout.function}/${name}.mcfunction`,
        content: [...header, ...body, ''].join('\n')
      })
    }

    if ('load' in output.functions) {
      files.push({
        path: `data/minecraft/tags/${layout.function}/load.json`,
        content: JSON.stringify({ values: [`${ns}:load`] }, null, 2)
      })
    }
    if (output.functions.tick && output.functions.tick.length > 0) {
      files.push({
        path: `data/minecraft/tags/${layout.function}/tick.json`,
        content: JSON.stringify({ values: [`${ns}:tick`] }, null, 2)
      })
    }

    for (const entry of output.json ?? []) {
      files.push({
        path: jsonPath(entry, layout, ns),
        content: JSON.stringify(entry.data, null, 2)
      })
    }
  }

  return { fileName: `${pack.id}.zip`, files, packFormat: format, formatSource: source }
}

function jsonPath(entry: JsonFile, layout: Layout, ns: string): string {
  const namespace = entry.namespace ?? ns
  if (entry.kind === 'raw') return `data/${namespace}/${entry.name}.json`
  return `data/${namespace}/${layout[entry.kind]}/${entry.name}.json`
}

/* ---------------------------------------------------------- installing */

/** Packs are a few kilobytes, so writing them synchronously is fine. */
function writeZip(built: BuiltPack, outputFile: string): void {
  const zip = new AdmZip()
  for (const file of built.files) zip.addFile(file.path, Buffer.from(file.content, 'utf8'))
  zip.writeZip(outputFile)
}

export interface DataPackInstallResult {
  world: string
  fileName: string
  path: string
  packFormat: number
  fileCount: number
}

/**
 * Installs a pack into a world's `datapacks` folder. Vanilla loads data packs
 * per world, so a world has to be chosen — there is no global location.
 */
export async function installDataPack(
  instance: Instance,
  worldFolder: string,
  packId: string,
  options: DataPackOptionValues
): Promise<DataPackInstallResult> {
  const saves = instanceSubdir(instance, 'saves')
  const world = assertInside(saves, join(saves, worldFolder))
  if (!existsSync(world)) {
    throw new LauncherError('NOT_FOUND', `world ${worldFolder} does not exist`, {
      title: 'That world no longer exists',
      message: 'The world you chose has been deleted or renamed.',
      actions: ['Pick a different world', 'Create a world in game first']
    })
  }

  const built = await buildDataPack(instance, packId, options)
  const target = join(world, 'datapacks')
  await mkdir(target, { recursive: true })

  const output = join(target, built.fileName)
  writeZip(built, output)

  log.info(
    `installed data pack "${packId}" into ${worldFolder} (pack_format ${built.packFormat}, ${built.files.length} files)`
  )

  return {
    world: worldFolder,
    fileName: built.fileName,
    path: output,
    packFormat: built.packFormat,
    fileCount: built.files.length
  }
}

/** Writes the pack anywhere the user chooses, for sharing or manual install. */
export async function exportDataPack(
  instance: Instance,
  packId: string,
  options: DataPackOptionValues,
  outputFile: string
): Promise<{ path: string; packFormat: number }> {
  const built = await buildDataPack(instance, packId, options)
  writeZip(built, outputFile)
  log.info(`exported data pack "${packId}" to ${outputFile}`)
  return { path: outputFile, packFormat: built.packFormat }
}

export async function listInstalledDataPacks(
  instance: Instance,
  worldFolder: string
): Promise<Array<{ fileName: string; sizeBytes: number; generated: boolean }>> {
  const saves = instanceSubdir(instance, 'saves')
  const dir = join(assertInside(saves, join(saves, worldFolder)), 'datapacks')
  try {
    const names = await readdir(dir)
    const out: Array<{ fileName: string; sizeBytes: number; generated: boolean }> = []
    for (const name of names) {
      const info = await stat(join(dir, name)).catch(() => null)
      if (!info) continue
      out.push({
        fileName: name,
        sizeBytes: info.isFile() ? info.size : 0,
        generated: PACKS.some((p) => name === `${p.id}.zip`)
      })
    }
    return out
  } catch {
    return []
  }
}

export async function removeDataPack(instance: Instance, worldFolder: string, fileName: string): Promise<void> {
  const saves = instanceSubdir(instance, 'saves')
  const dir = join(assertInside(saves, join(saves, worldFolder)), 'datapacks')
  const target = assertInside(dir, join(dir, fileName))
  await rm(target, { recursive: true, force: true })
  log.info(`removed data pack ${fileName} from ${worldFolder}`)
}

export const __internals = { layouts, buildDataPack }
