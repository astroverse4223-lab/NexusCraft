/**
 * Resource packs: the half of Minecraft that changes what things look and
 * sound like, as opposed to what they do.
 *
 * A resource pack is a zip with `pack.mcmeta` at the root and an `assets`
 * folder under it. Nothing is compiled and nothing is a mod, which is why the
 * launcher can build one honestly - the same reason it can build data packs.
 *
 * The two formats are not interchangeable and their version numbers are not
 * the same number. 26.2 is resource format 88 and data format 107; 1.21.1 is
 * 34 and 48. Writing a data format into `pack.mcmeta` produces a pack the game
 * silently ignores, so the two are kept apart everywhere.
 */

/** The vanilla items a custom texture can be built on top of. */
export const BASE_ITEMS = [
  'minecraft:stick',
  'minecraft:paper',
  'minecraft:iron_ingot',
  'minecraft:gold_ingot',
  'minecraft:diamond',
  'minecraft:emerald',
  'minecraft:nether_star',
  'minecraft:blaze_rod',
  'minecraft:bone',
  'minecraft:feather',
  'minecraft:book',
  'minecraft:apple',
  'minecraft:bread',
  'minecraft:carrot_on_a_stick',
  'minecraft:fishing_rod',
  'minecraft:iron_sword',
  'minecraft:diamond_sword',
  'minecraft:netherite_sword',
  'minecraft:bow',
  'minecraft:trident',
  'minecraft:shield',
  'minecraft:totem_of_undying',
  'minecraft:heart_of_the_sea',
  'minecraft:echo_shard',
  'minecraft:amethyst_shard',
  'minecraft:prismarine_shard',
  'minecraft:ghast_tear',
  'minecraft:phantom_membrane',
  'minecraft:music_disc_13'
] as const

/**
 * The music discs, and the sound event each one plays.
 *
 * A disc is the easiest custom sound to ship because the event already exists
 * and every client already knows how to trigger it - swapping the file under
 * an event is a pure resource pack change with no data pack and no command.
 */
export const MUSIC_DISCS = [
  { item: 'minecraft:music_disc_13', event: 'music_disc.13', label: '13' },
  { item: 'minecraft:music_disc_5', event: 'music_disc.5', label: '5' },
  { item: 'minecraft:music_disc_bounce', event: 'music_disc.bounce', label: 'Bounce' },
  { item: 'minecraft:music_disc_tears', event: 'music_disc.tears', label: 'Tears' },
  {
    item: 'minecraft:music_disc_lava_chicken',
    event: 'music_disc.lava_chicken',
    label: 'Lava Chicken'
  },
  {
    item: 'minecraft:music_disc_creator_music_box',
    event: 'music_disc.creator_music_box',
    label: 'Creator (Music Box)'
  },
  { item: 'minecraft:music_disc_cat', event: 'music_disc.cat', label: 'Cat' },
  { item: 'minecraft:music_disc_blocks', event: 'music_disc.blocks', label: 'Blocks' },
  { item: 'minecraft:music_disc_chirp', event: 'music_disc.chirp', label: 'Chirp' },
  { item: 'minecraft:music_disc_far', event: 'music_disc.far', label: 'Far' },
  { item: 'minecraft:music_disc_mall', event: 'music_disc.mall', label: 'Mall' },
  { item: 'minecraft:music_disc_mellohi', event: 'music_disc.mellohi', label: 'Mellohi' },
  { item: 'minecraft:music_disc_stal', event: 'music_disc.stal', label: 'Stal' },
  { item: 'minecraft:music_disc_strad', event: 'music_disc.strad', label: 'Strad' },
  { item: 'minecraft:music_disc_ward', event: 'music_disc.ward', label: 'Ward' },
  { item: 'minecraft:music_disc_11', event: 'music_disc.11', label: '11' },
  { item: 'minecraft:music_disc_wait', event: 'music_disc.wait', label: 'Wait' },
  { item: 'minecraft:music_disc_otherside', event: 'music_disc.otherside', label: 'Otherside' },
  { item: 'minecraft:music_disc_pigstep', event: 'music_disc.pigstep', label: 'Pigstep' },
  { item: 'minecraft:music_disc_relic', event: 'music_disc.relic', label: 'Relic' },
  { item: 'minecraft:music_disc_creator', event: 'music_disc.creator', label: 'Creator' },
  { item: 'minecraft:music_disc_precipice', event: 'music_disc.precipice', label: 'Precipice' }
] as const

/** Other sounds worth replacing, that are not a disc. */
export const SOUND_EVENTS = [
  { event: 'music.menu', label: 'Main menu music', stream: true },
  { event: 'music.game', label: 'Overworld music', stream: true },
  { event: 'music.creative', label: 'Creative music', stream: true },
  { event: 'music.end', label: 'End music', stream: true },
  { event: 'music.dragon', label: 'Dragon fight music', stream: true },
  { event: 'entity.player.levelup', label: 'Level up', stream: false },
  { event: 'entity.experience_orb.pickup', label: 'Experience pickup', stream: false },
  { event: 'block.note_block.pling', label: 'Note block pling', stream: false },
  { event: 'ui.button.click', label: 'Button click', stream: false },
  { event: 'entity.villager.yes', label: 'Villager yes', stream: false },
  { event: 'entity.lightning_bolt.thunder', label: 'Thunder', stream: false },
  { event: 'entity.ender_dragon.growl', label: 'Dragon growl', stream: false }
] as const

/** The six faces of the menu background, in the order the game reads them. */
export const PANORAMA_FACES = ['North', 'East', 'South', 'West', 'Up', 'Down'] as const

export interface PackItem {
  /** The name inside the pack. Lowercase, no spaces - it becomes a file name. */
  id: string
  label: string
  /** The vanilla item this is built on, which decides how it behaves in hand. */
  base: string
  /** A png, as a data url. */
  image: string
  /**
   * Whether to take over the base item's own look.
   *
   * Off, the texture is a separate model the item points at with the
   * `item_model` component, and an ordinary stick still looks like a stick.
   * On, every one of that item in the world changes - which is sometimes
   * exactly what somebody wants and is always worth being asked about.
   */
  replaces: boolean
}

export interface PackSound {
  id: string
  label: string
  /** The sound event this replaces, eg `music_disc.cat`. */
  event: string
  /** Absolute path to an .ogg on disk. */
  file: string
  /** Long audio is streamed rather than held in memory. */
  stream: boolean
}

/**
 * A vanilla texture being replaced by one of yours.
 *
 * `path` is where the game looks, without the extension and relative to the
 * textures folder - "block/stone", "item/diamond_sword", "entity/creeper/
 * creeper". That is the only thing that decides whether a picture is used or
 * silently ignored, which is why it is stored rather than derived from a
 * filename somebody typed.
 */
export interface PackTexture {
  path: string
  /** A png, as a data url. */
  image: string
}

export interface ResourcePackDraft {
  name: string
  description: string
  items: PackItem[]
  sounds: PackSound[]
  /** Vanilla textures being replaced, by the path the game looks them up at. */
  textures: PackTexture[]
  /** Six data urls, or null for no custom menu background. */
  panorama: string[] | null
  /** The Minecraft wordmark on the title screen, as a data url. */
  logo: string | null
}

export function emptyDraft(): ResourcePackDraft {
  return {
    name: 'Nexus',
    description: 'Made with NexusCraft Launcher',
    items: [],
    sounds: [],
    textures: [],
    panorama: null,
    logo: null
  }
}

/**
 * A name that is safe as a file and as a resource location.
 *
 * Minecraft resource locations accept `[a-z0-9_.-]` and nothing else. A
 * capital letter or a space does not warn - the pack loads and that one entry
 * is dropped, so the tidying happens here rather than in the game.
 */
export function safeId(value: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '_')
    .replace(/^_+|_+$/g, '')

  return cleaned || 'item'
}

/** Whether a draft has anything in it worth building. */
export function isEmpty(draft: ResourcePackDraft): boolean {
  return (
    draft.items.length === 0 &&
    draft.sounds.length === 0 &&
    draft.textures.length === 0 &&
    draft.panorama === null &&
    draft.logo === null
  )
}

/** How to get one of these items in game, once the pack is on. */
export function giveFor(item: PackItem, namespace: string): string {
  if (item.replaces) return `/give @p ${item.base}`

  const name = item.label.replace(/\\/g, '\\\\').replace(/'/g, "\\'")

  return (
    `/give @p ${item.base}[minecraft:item_model="${namespace}:${item.id}",` +
    `minecraft:custom_name='{"text":"${name}","italic":false}']`
  )
}

/** What a build produced, as both sides need to talk about it. */
/**
 * What went into a pack, in words.
 *
 * Written down here because the screen used to assemble it inline and got it
 * wrong in the worst possible way: it printed `contents.items` and labelled it
 * "texture", so a pack holding 3,416 restyled textures and one hat announced
 * itself as "1 texture" and looked like a build that had silently dropped
 * everything. The zip was right the whole time.
 *
 * Empty categories are left out rather than printed as zero - "0 sounds" on
 * every pack that has no sounds is noise that makes the real numbers harder
 * to find.
 */
export function packSummary(contents: BuiltPack['contents']): string {
  const many = (n: number, word: string): string => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`

  const parts = [
    contents.textures > 0 ? many(contents.textures, 'texture') : '',
    contents.items > 0 ? many(contents.items, 'item') : '',
    contents.sounds > 0 ? many(contents.sounds, 'sound') : '',
    contents.panorama ? 'a menu background' : '',
    contents.logo ? 'a logo' : ''
  ].filter(Boolean)

  return parts.length > 0 ? parts.join(', ') : 'nothing'
}

export interface BuiltPack {
  /** Where the zip was written. */
  path: string
  /** The hash a server has to publish alongside the url. */
  sha1: string
  bytes: number
  /** How to get each custom item, once the pack is on. */
  commands: string[]
  contents: {
    textures: number
    items: number
    sounds: number
    panorama: boolean
    logo: boolean
  }
}

export interface PackHostStatus {
  running: boolean
  port: number | null
  /** This machine on the local network, for a url that works in the house. */
  localAddress: string | null
  /** The path clients ask for, once there is something to serve. */
  path: string | null
  sha1: string | null
  bytes: number | null
}

/**
 * Whether the router is forwarding the pack port.
 *
 * The same shape the server port reports, because it is the same question
 * asked about a different number - and the pack needs its own, since http and
 * the game's own protocol cannot share one port.
 */
export interface PackForwarding {
  available: boolean
  open: boolean
  externalAddress: string | null
  router: string | null
  reason: string | null
}

/**
 * The server's cosmetic hats, and what the plugin calls each one's model.
 *
 * These ids are a contract with Cosmetics.Hat on the server: it points every
 * hat at `nexus:hat_<name>`, so a texture filed under any other name is a
 * texture the game never looks for. Kept here rather than derived, because
 * nothing in the launcher can read the plugin's Java - which is exactly why
 * they are written down together with what they have to match.
 */
export const COSMETIC_HATS = [
  { id: 'hat_pumpkin', label: 'Pumpkin', base: 'minecraft:carved_pumpkin' },
  { id: 'hat_melon', label: 'Melon', base: 'minecraft:melon' },
  { id: 'hat_cake', label: 'Cake', base: 'minecraft:cake' },
  { id: 'hat_tnt', label: 'TNT', base: 'minecraft:tnt' },
  { id: 'hat_diamond', label: 'Diamond', base: 'minecraft:diamond_block' },
  { id: 'hat_emerald', label: 'Emerald', base: 'minecraft:emerald_block' },
  { id: 'hat_beacon', label: 'Beacon', base: 'minecraft:beacon' },
  { id: 'hat_dragon_egg', label: 'Dragon Egg', base: 'minecraft:dragon_egg' }
] as const
