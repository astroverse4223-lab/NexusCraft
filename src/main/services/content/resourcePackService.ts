import { createHash } from 'node:crypto'
import { crc32 } from 'node:zlib'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import AdmZip from 'adm-zip'
import { parseDocument } from 'yaml'
import { packMcmeta } from '@shared/creations'
import {
  type BuiltPack,
  type PackItem,
  type PackSound,
  type PackTexture,
  type ResourcePackDraft,
  ARMOUR_PIECES,
  describeAudio,
  giveArmour,
  isEmpty,
  isOggVorbis,
  safeId,
  type PackArmour
} from '@shared/resourcePacks'
import type { Instance } from '@shared/types'
import { LauncherError } from '../../core/errors'
import { createLogger } from '../../core/logger'
import { instanceSubdir } from '../instances/instanceService'
import { packFormatOf } from './datapackService'
import { versionJarPath } from '../minecraft/versionService'

const log = createLogger('resourcepack')

/**
 * Building a resource pack.
 *
 * The whole thing is a zip: `pack.mcmeta` at the root saying which format it
 * is, and an `assets` tree under it. Every path below was read out of a real
 * 26.2 client jar rather than remembered, because a texture one folder off is
 * not an error - the game loads the pack, finds nothing at that path, and uses
 * the vanilla one, so a mistake here looks exactly like the pack not being on.
 */

const NAMESPACE = 'nexus'

/** Where the game looks for the title screen background and wordmark. */
const PANORAMA = 'assets/minecraft/textures/gui/title/background/panorama'
const LOGO = 'assets/minecraft/textures/gui/title/minecraft.png'

/** The bytes behind a `data:image/png;base64,...` url. */
function fromDataUrl(url: string): Buffer {
  const comma = url.indexOf(',')
  if (comma < 0) throw new LauncherError('INVALID_INPUT', 'not a data url')

  return Buffer.from(url.slice(comma + 1), 'base64')
}

/**
 * The model files behind one custom item.
 *
 * Two shapes, and the difference matters. Replacing writes over the vanilla
 * texture, so every stick in the world becomes the new picture. Not replacing
 * adds a separate model the item points at through its `item_model` component,
 * which leaves ordinary sticks alone - that is the one that pairs with the
 * custom items generator, so it is the default.
 */
function itemFiles(item: PackItem, zip: AdmZip): void {
  const id = safeId(item.id)
  const png = fromDataUrl(item.image)
  const bare = item.base.replace(/^minecraft:/, '')

  if (item.replaces) {
    zip.addFile(`assets/minecraft/textures/item/${bare}.png`, png)
    return
  }

  zip.addFile(`assets/${NAMESPACE}/textures/item/${id}.png`, png)

  zip.addFile(
    `assets/${NAMESPACE}/models/item/${id}.json`,
    json({
      parent: 'minecraft:item/generated',
      textures: { layer0: `${NAMESPACE}:item/${id}` }
    })
  )

  /*
   * The item definition, which is what `item_model` actually points at.
   *
   * Read from `assets/minecraft/items/stick.json` in the 26.2 jar, which is
   * exactly this shape. It is not the model file and it is not optional - the
   * component names a definition, and a missing one renders as the purple and
   * black missing texture.
   */
  zip.addFile(
    `assets/${NAMESPACE}/items/${id}.json`,
    json({
      model: { type: 'minecraft:model', model: `${NAMESPACE}:item/${id}` }
    })
  )
}

/**
 * One custom armour set: two worn layers, four icons, one definition.
 *
 * The definition is the part that is easy to get wrong. `equippable.asset_id`
 * on the item names an equipment asset, not a texture, and that asset lists
 * which model each layer is drawn on. Read from `assets/minecraft/equipment/
 * diamond.json` in the 26.2 jar, which names humanoid, humanoid_baby and
 * humanoid_leggings among others - the texture id inside then resolves to
 * `textures/entity/equipment/<layer>/<id>.png`, which is why one id covers two
 * files that look nothing alike.
 */
function armourFiles(set: PackArmour, zip: AdmZip): void {
  const id = safeId(set.id)

  zip.addFile(
    `assets/${NAMESPACE}/equipment/${id}.json`,
    json({
      layers: {
        humanoid: [{ texture: `${NAMESPACE}:${id}` }],
        humanoid_baby: [{ texture: `${NAMESPACE}:${id}` }],
        humanoid_leggings: [{ texture: `${NAMESPACE}:${id}` }]
      }
    })
  )

  zip.addFile(`assets/${NAMESPACE}/textures/entity/equipment/humanoid/${id}.png`, fromDataUrl(set.body))
  zip.addFile(`assets/${NAMESPACE}/textures/entity/equipment/humanoid_leggings/${id}.png`, fromDataUrl(set.legs))

  for (const piece of ARMOUR_PIECES) {
    const at = `${id}_${piece.id}`
    const icon = set.icons[piece.id]
    if (!icon) continue

    zip.addFile(`assets/${NAMESPACE}/textures/item/${at}.png`, fromDataUrl(icon))

    zip.addFile(
      `assets/${NAMESPACE}/models/item/${at}.json`,
      json({
        parent: 'minecraft:item/generated',
        textures: { layer0: `${NAMESPACE}:item/${at}` }
      })
    )

    zip.addFile(
      `assets/${NAMESPACE}/items/${at}.json`,
      json({ model: { type: 'minecraft:model', model: `${NAMESPACE}:item/${at}` } })
    )
  }
}

/**
 * One replaced vanilla texture, at the path the game reads it from.
 *
 * The path is checked rather than trusted: it ends up inside a zip handed to
 * every player, and a `..` in it would write outside the assets tree. Anything
 * that is not a plain lowercase resource path is refused outright.
 */
function textureFile(texture: PackTexture, zip: AdmZip): void {
  const path = texture.path.replace(/\.png$/i, '').replace(/^\/+/, '')

  if (!/^[a-z0-9_\-/]+$/.test(path) || path.includes('..')) {
    throw new LauncherError('INVALID_INPUT', `bad texture path: ${texture.path}`, {
      title: 'That texture path is not usable',
      message:
        `"${texture.path}" is not a Minecraft texture path. They look like ` +
        '"block/stone" or "item/diamond_sword", lowercase, no spaces.'
    })
  }

  zip.addFile(`assets/minecraft/textures/${path}.png`, fromDataUrl(texture.image))
}

function json(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value, null, 2), 'utf8')
}

/**
 * Sound files, and the one document that points at them.
 *
 * `sounds.json` is merged across packs event by event rather than replaced
 * wholesale, so naming only the events being changed leaves every other sound
 * in the game alone.
 */
async function soundFiles(sounds: PackSound[], zip: AdmZip): Promise<void> {
  const events: Record<string, unknown> = {}

  for (const sound of sounds) {
    if (!existsSync(sound.file)) {
      throw new LauncherError('NOT_FOUND', `sound file missing: ${sound.file}`, {
        title: 'One of the sounds is gone',
        message: `${basename(sound.file)} is no longer where it was when you added it.`,
        actions: ['Add it again']
      })
    }

    if (!sound.file.toLowerCase().endsWith('.ogg')) {
      throw new LauncherError('INVALID_INPUT', `not an ogg: ${sound.file}`, {
        title: 'Minecraft only plays .ogg',
        message:
          `${basename(sound.file)} is not an .ogg file. Minecraft will not play mp3 or wav, ` +
          'so it has to be converted first.',
        actions: ['Convert it to .ogg and add it again']
      })
    }

    const id = safeId(sound.id)
    const audio = await readFile(sound.file)

    /*
     * The last gate, because the extension is not the format.
     *
     * The game decodes with stb_vorbis, so an Ogg carrying Opus passes every
     * check a filename can make and is then silent in the world with nothing
     * logged anywhere. Everything added through the launcher is converted on
     * the way in; this catches a pack opened from disk or saved before that
     * conversion existed.
     */
    if (!isOggVorbis(audio)) {
      throw new LauncherError('INVALID_INPUT', `not vorbis: ${sound.file}`, {
        title: 'That sound would be silent in game',
        message:
          `${basename(sound.file)} is ${describeAudio(basename(sound.file), audio)}, not Ogg ` +
          'Vorbis. Minecraft only decodes Vorbis, and plays nothing at all for the rest.',
        actions: ['Remove it and add it again, which converts it']
      })
    }

    zip.addFile(`assets/minecraft/sounds/${NAMESPACE}/${id}.ogg`, audio)

    events[sound.event] = {
      sounds: [{ name: `${NAMESPACE}/${id}`, stream: sound.stream }]
    }
  }

  zip.addFile('assets/minecraft/sounds.json', json(events))
}

/** Everything in the draft, as a zip in memory. */
async function buildZip(draft: ResourcePackDraft, minecraftVersion: string): Promise<AdmZip> {
  const zip = new AdmZip()

  /*
   * The resource format, which is not the data format.
   *
   * 26.2 is resource 88 and data 107. Writing the data number here produces a
   * pack the game considers built for a different version - it either refuses
   * it or warns and carries on ignoring it, and neither says why.
   */
  const format = packFormatOf(minecraftVersion, 'resource')

  zip.addFile('pack.mcmeta', json(packMcmeta(format, draft.description || draft.name)))

  for (const texture of draft.textures) textureFile(texture, zip)
  for (const item of draft.items) itemFiles(item, zip)
  for (const set of draft.armour) armourFiles(set, zip)
  if (draft.sounds.length > 0) await soundFiles(draft.sounds, zip)

  if (draft.panorama) {
    draft.panorama.forEach((face, at) => {
      zip.addFile(`${PANORAMA}_${at}.png`, fromDataUrl(face))
    })
  }

  if (draft.logo) zip.addFile(LOGO, fromDataUrl(draft.logo))

  return zip
}

/** Builds the pack and writes it wherever it was asked to go. */
/**
 * How many of these are byte-for-byte what the game already draws.
 *
 * A pack can be built, served, downloaded and applied perfectly and change
 * nothing at all, because "replacing" a texture with an identical copy of the
 * original is a thing the app will happily let you do - importing the folder
 * of extracted vanilla textures without editing them does exactly that. The
 * symptom is somebody standing in their world looking at 3,400 unchanged
 * blocks with no idea which of the ten steps went wrong.
 *
 * Compared by CRC out of the jar's own index rather than by decompressing it,
 * so checking three thousand costs nothing worth measuring.
 */
function unchangedFromVanilla(textures: PackTexture[], minecraftVersion: string): number | null {
  if (typeof crc32 !== 'function') return null

  try {
    /*
     * Inside the try, not above it. versionJarPath needs the launcher's data
     * root, which throws outright when it has not been set up - so resolving
     * it first turns "cannot check" into "cannot build", which is the same
     * mistake packFormatOf made in this file once already.
     */
    const jar = versionJarPath(minecraftVersion)
    if (!existsSync(jar)) return null

    const zip = new AdmZip(jar)
    let unchanged = 0

    for (const texture of textures) {
      const path = texture.path.replace(/\.png$/i, '').replace(/^\/+/, '')
      const entry = zip.getEntry(`assets/minecraft/textures/${path}.png`)
      if (!entry) continue

      if (entry.header.crc >>> 0 === crc32(fromDataUrl(texture.image)) >>> 0) unchanged += 1
    }

    return unchanged
  } catch (err) {
    log.warn(`could not compare against vanilla: ${(err as Error).message}`)
    return null
  }
}

export async function writeResourcePack(
  draft: ResourcePackDraft,
  minecraftVersion: string,
  dest: string
): Promise<BuiltPack> {
  if (isEmpty(draft)) {
    throw new LauncherError('INVALID_INPUT', 'nothing in the pack', {
      title: 'There is nothing in the pack yet',
      message: 'Add a texture, a sound or a menu background before building it.'
    })
  }

  const zip = await buildZip(draft, minecraftVersion)
  const bytes = zip.toBuffer()

  await mkdir(join(dest, '..'), { recursive: true })
  await writeFile(dest, bytes)

  /*
   * Sha-1 of the exact file, which a server needs alongside the url.
   *
   * Without it every client re-downloads the pack on every join, and with a
   * stale one they refuse it outright - so it is computed from the bytes just
   * written rather than tracked separately.
   */
  const sha1 = createHash('sha1').update(bytes).digest('hex')

  log.info(`built ${basename(dest)}: ${bytes.length} bytes, sha1 ${sha1}`)

  return {
    path: dest,
    sha1,
    bytes: bytes.length,
    commands: [
      ...draft.items.filter((i) => !i.replaces).map((i) => giveLine(i)),
      ...draft.armour.flatMap((set) =>
        ARMOUR_PIECES.filter((piece) => set.icons[piece.id]).map((piece) => giveArmour(set, piece, NAMESPACE))
      )
    ],
    contents: {
      textures: draft.textures.length,
      unchanged: unchangedFromVanilla(draft.textures, minecraftVersion),
      items: draft.items.length,
      armour: draft.armour.length,
      sounds: draft.sounds.length,
      panorama: draft.panorama !== null,
      logo: draft.logo !== null
    }
  }
}

function giveLine(item: PackItem): string {
  const name = item.label.replace(/\\/g, '\\\\').replace(/'/g, "\\'")

  return (
    `/give @p ${item.base}[minecraft:item_model="${NAMESPACE}:${safeId(item.id)}",` +
    `minecraft:custom_name='{"text":"${name}","italic":false}']`
  )
}

/** Where the plugin keeps its settings, when the plugin is installed at all. */
const pluginConfig = (serverDir: string): string => join(serverDir, 'plugins', 'Nexus', 'config.yml')

/**
 * Points the plugin at the pack, and tells it what armour the pack defines.
 *
 * Worth doing instead of only writing server.properties, because Minecraft
 * reads `resource-pack` once at startup and never again - so every rebuild
 * needed a restart, and the url carries the pack's own hash so every rebuild
 * is a new url. The plugin offers the pack itself on join and can be told to
 * re-read at any moment, which turns that loop into pressing one button.
 *
 * The document is edited rather than rewritten: this file is full of comments
 * explaining what each setting does, and a config that loses them the first
 * time the launcher touches it is a worse config.
 *
 * Returns false when there is no plugin, which is how the caller knows to fall
 * back to server.properties.
 */
export async function pointPluginAtPack(
  serverDir: string,
  pack: { url: string; required: boolean } | null,
  armour: PackArmour[] = []
): Promise<boolean> {
  const file = pluginConfig(serverDir)
  if (!existsSync(file)) return false

  try {
    const doc = parseDocument(await readFile(file, 'utf8'))

    doc.setIn(['resourcePack', 'url'], pack?.url ?? '')
    doc.setIn(['resourcePack', 'required'], pack?.required ?? false)

    /*
     * The armour sets, written from the pack that defines them.
     *
     * So the two cannot drift: the ids the plugin hands out are the ids the
     * pack was built with, rather than something typed twice.
     */
    const sets: Record<string, { label: string; base: string }> = {}
    for (const set of armour) sets[safeId(set.id)] = { label: set.label, base: set.base }

    doc.set('armoury', doc.createNode(sets))

    await writeFile(file, doc.toString(), 'utf8')
    log.info(`plugin now offers ${pack ? pack.url : 'no pack'}, ${armour.length} armour sets`)

    return true
  } catch (err) {
    log.warn(`could not write the plugin config: ${(err as Error).message}`)
    return false
  }
}

/**
 * Writes one setting into the plugin's config, keeping its comments.
 *
 * Exists so the launcher can offer a box to paste a Discord webhook into
 * rather than telling somebody to find a YAML file, count the indentation and
 * not break it. The plugin re-reads every setting on use, so a `nexus reload`
 * afterwards is enough - nobody has to restart a server to turn a feed on.
 */
export async function setPluginSetting(
  serverDir: string,
  path: string[],
  value: string | boolean | number
): Promise<boolean> {
  const file = pluginConfig(serverDir)
  if (!existsSync(file)) return false

  try {
    const doc = parseDocument(await readFile(file, 'utf8'))
    doc.setIn(path, value)
    await writeFile(file, doc.toString(), 'utf8')

    log.info(`plugin config: ${path.join('.')} set`)
    return true
  } catch (err) {
    log.warn(`could not write ${path.join('.')}: ${(err as Error).message}`)
    return false
  }
}

/**
 * Points a server at a pack, or stops it pointing at one.
 *
 * Written straight into server.properties rather than through the launcher's
 * own server record, because the launcher rewrites that file from the record
 * on every settings save and keeps every key it does not manage - so these
 * three survive, and nothing has to be threaded through the settings screen to
 * make them.
 *
 * The hash is not optional in practice. Without it every client downloads the
 * whole pack again on every single join; with a stale one they refuse it.
 */
export async function pointServerAtPack(
  serverDir: string,
  pack: { url: string; sha1: string; required: boolean } | null
): Promise<void> {
  const file = join(serverDir, 'server.properties')

  if (!existsSync(file)) {
    throw new LauncherError('NOT_FOUND', 'no server.properties', {
      title: 'That server has not been set up yet',
      message: 'Start it once so it writes its settings, then try again.'
    })
  }

  const lines = (await readFile(file, 'utf8')).split(/\r?\n/)
  const properties = new Map<string, string>()
  const comments: string[] = []

  for (const line of lines) {
    if (!line) continue
    if (line.startsWith('#')) {
      comments.push(line)
      continue
    }

    const eq = line.indexOf('=')
    if (eq > 0) properties.set(line.slice(0, eq), line.slice(eq + 1))
  }

  if (pack === null) {
    properties.set('resource-pack', '')
    properties.set('resource-pack-sha1', '')
    properties.set('require-resource-pack', 'false')
  } else {
    properties.set('resource-pack', pack.url)
    properties.set('resource-pack-sha1', pack.sha1)
    properties.set('require-resource-pack', String(pack.required))
  }

  const body = [...properties.entries()].map(([key, value]) => `${key}=${value}`).sort()
  await writeFile(file, [...comments, ...body, ''].join('\n'), 'utf8')

  log.info(pack === null ? 'cleared the server resource pack' : `server now points at ${pack.url}`)
}

/** Into the instance's own resourcepacks folder, where it can be turned on. */
export async function installResourcePack(instance: Instance, draft: ResourcePackDraft): Promise<BuiltPack> {
  const folder = instanceSubdir(instance, 'resourcepacks')
  await mkdir(folder, { recursive: true })

  return await writeResourcePack(draft, instance.minecraftVersion, join(folder, `${safeId(draft.name)}.zip`))
}

/**
 * Every texture path the game actually reads, from its own jar.
 *
 * The alternative is somebody typing a path from memory, and a path that is
 * one letter wrong is not an error - the pack loads, that file is never looked
 * at, and the block stays exactly as it was. Listing the real ones turns a
 * guess into a search.
 */
export function vanillaTextures(minecraftVersion: string): string[] {
  const jar = versionJarPath(minecraftVersion)
  if (!existsSync(jar)) return []

  try {
    const out: string[] = []

    for (const entry of new AdmZip(jar).getEntries()) {
      const name = entry.entryName

      if (!name.startsWith('assets/minecraft/textures/')) continue
      if (!name.endsWith('.png')) continue

      out.push(name.slice('assets/minecraft/textures/'.length, -'.png'.length))
    }

    return out.sort()
  } catch (err) {
    log.warn(`could not read textures from ${minecraftVersion}: ${(err as Error).message}`)
    return []
  }
}

/**
 * One vanilla texture's bytes, as a data url.
 *
 * Restyling needs the original pixels, and the only copy that is certainly
 * right is the one inside the jar the server actually runs - not a folder
 * somebody may have edited already.
 */
export function vanillaTexture(minecraftVersion: string, path: string): string | null {
  const jar = versionJarPath(minecraftVersion)
  if (!existsSync(jar)) return null

  if (!/^[a-z0-9_\-/]+$/.test(path) || path.includes('..')) return null

  try {
    const entry = new AdmZip(jar).getEntry(`assets/minecraft/textures/${path}.png`)
    if (!entry) return null

    return 'data:image/png;base64,' + entry.getData().toString('base64')
  } catch (err) {
    log.warn(`could not read ${path}: ${(err as Error).message}`)
    return null
  }
}

/**
 * An existing pack, read back into something editable.
 *
 * Only the parts this app knows how to put back. A pack can hold shaders,
 * fonts, custom model data and a dozen other things, and pretending to import
 * those would mean rebuilding a pack that quietly lost half of what was in it -
 * so what is not understood is reported rather than swallowed.
 */
export async function readResourcePack(file: string): Promise<{
  name: string
  description: string
  textures: { path: string; image: string }[]
  panorama: string[] | null
  logo: string | null
  ignored: number
}> {
  if (!existsSync(file)) {
    throw new LauncherError('NOT_FOUND', `no pack at ${file}`, {
      title: 'That file is not there',
      message: 'Pick the .zip again.'
    })
  }

  const zip = new AdmZip(file)

  const textures: { path: string; image: string }[] = []
  const panorama: (string | null)[] = [null, null, null, null, null, null]

  let logo: string | null = null
  let description = ''
  let ignored = 0

  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue

    const name = entry.entryName

    if (name === 'pack.mcmeta') {
      try {
        const meta = JSON.parse(entry.getData().toString('utf8')) as {
          pack?: { description?: unknown }
        }
        if (typeof meta.pack?.description === 'string') description = meta.pack.description
      } catch {
        /* A pack.mcmeta that will not parse is one the game would refuse too. */
      }
      continue
    }

    const prefix = 'assets/minecraft/textures/'

    if (!name.startsWith(prefix) || !name.endsWith('.png')) {
      ignored++
      continue
    }

    const path = name.slice(prefix.length, -'.png'.length)
    const image = 'data:image/png;base64,' + entry.getData().toString('base64')

    const face = /^gui\/title\/background\/panorama_([0-5])$/.exec(path)

    if (face) {
      panorama[Number(face[1])] = image
      continue
    }

    if (path === 'gui/title/minecraft') {
      logo = image
      continue
    }

    textures.push({ path, image })
  }

  return {
    name: basename(file).replace(/\.zip$/i, ''),
    description,
    textures,
    // All six or none: a partial cube is a menu that flickers between yours
    // and Mojang's as the camera turns.
    panorama: panorama.every((f) => f !== null) ? (panorama as string[]) : null,
    logo,
    ignored
  }
}
