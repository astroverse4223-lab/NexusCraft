import type { DirectoryCategory, DirectoryServer } from '@shared/types'

/**
 * The public servers the Discover screen starts from.
 *
 * A note on why this is a list in the source rather than a feed: there is no
 * free, open API that returns a global index of Minecraft servers. Every
 * server-list site that has one puts it behind a paid key, and scraping their
 * pages would break the moment they changed a class name — and would be
 * inventing data the launcher could not stand behind.
 *
 * So this is a starting point, not a claim about what is out there. Everything
 * a player actually reads — whether it is up, how many people are on it, its
 * MOTD, its version, its icon — comes from pinging the server itself, exactly
 * as the game's own multiplayer screen does. An entry whose owner has moved or
 * closed shows as offline rather than as a lie, and `directoryUrl` in settings
 * points the same screen at a JSON file of your own when this list is not the
 * one you want.
 *
 * Every entry below answered a real ping when it was added; seven candidates
 * that did not were dropped rather than shipped as dead rows. They will still
 * rot over time, which is what the live status and the custom feed are for.
 * `test/servers/catalogueLive.check.ts` re-checks the whole list on demand.
 */

export const DIRECTORY_CATEGORIES: Array<{ id: DirectoryCategory; label: string; blurb: string }> = [
  { id: 'minigames', label: 'Minigames', blurb: 'Bed wars, sky wars, parkour and party games.' },
  { id: 'survival', label: 'Survival & SMP', blurb: 'Long-running worlds to build in with other people.' },
  { id: 'skyblock', label: 'Skyblock', blurb: 'Start on an island with nothing and grow it.' },
  { id: 'anarchy', label: 'Anarchy', blurb: 'No rules, no resets. Bring a friend and low expectations.' },
  { id: 'prison', label: 'Prison & Factions', blurb: 'Rank up, raid, and defend what you have taken.' },
  { id: 'adventure', label: 'Adventure & MMO', blurb: 'Custom quests, classes and hand-built worlds.' },
  { id: 'creative', label: 'Creative & Towny', blurb: 'Plots, cities and nations to build in.' },
  { id: 'modded', label: 'Modded', blurb: 'Pixelmon and other servers that need a mod pack.' }
]

/**
 * `version` is what the server was last known to accept, used to pick a
 * matching instance. It is a hint for choosing what to launch — the live ping
 * reports the real version, and that is what the screen shows.
 */
export const BUNDLED_DIRECTORY: DirectoryServer[] = [
  {
    id: 'hypixel',
    name: 'Hypixel',
    address: 'mc.hypixel.net',
    port: 25565,
    category: 'minigames',
    description: 'The largest Minecraft server in the world. Bed Wars, SkyBlock, Murder Mystery and dozens more.',
    version: '1.21',
    tags: ['bedwars', 'skyblock', 'duels']
  },
  {
    id: 'cubecraft',
    name: 'CubeCraft Games',
    address: 'play.cubecraft.net',
    port: 25565,
    category: 'minigames',
    description: 'Long-running minigame network with Eggwars, Skyblock and Lucky Islands.',
    version: '1.21',
    tags: ['eggwars', 'skywars']
  },
  {
    id: 'manacube',
    name: 'ManaCube',
    address: 'play.manacube.com',
    port: 25565,
    category: 'minigames',
    description: 'Parkour, survival, factions and islands across one network.',
    version: '1.21',
    tags: ['parkour', 'islands']
  },
  {
    id: 'pika',
    name: 'PikaNetwork',
    address: 'play.pika-network.net',
    port: 25565,
    category: 'minigames',
    description: 'Practice PvP, bed wars, skyblock and lifesteal.',
    version: '1.21',
    tags: ['pvp', 'lifesteal']
  },
  {
    id: 'jartex',
    name: 'JartexNetwork',
    address: 'play.jartexnetwork.com',
    port: 25565,
    category: 'minigames',
    description: 'Bed wars, skyblock, prison and survival with a large player base.',
    version: '1.21',
    tags: ['bedwars', 'prison']
  },
  {
    id: 'mccentral',
    name: 'MCCentral',
    address: 'play.mccentral.org',
    port: 25565,
    category: 'minigames',
    description: 'Skyblock, prison, factions and creative plots.',
    version: '1.21',
    tags: ['skyblock', 'creative']
  },

  {
    id: 'donutsmp',
    name: 'DonutSMP',
    address: 'donutsmp.net',
    port: 25565,
    category: 'survival',
    description: 'Survival with an economy where everything has a price. Popular with streamers.',
    version: '1.21',
    tags: ['economy', 'smp']
  },
  {
    id: 'loverfella',
    name: 'LoverFella',
    address: 'play.loverfella.com',
    port: 25565,
    category: 'survival',
    description: 'Whitelist-style community survival built around a YouTube channel.',
    version: '1.21',
    tags: ['community', 'smp']
  },
  {
    id: 'minesuperior',
    name: 'MineSuperior',
    address: 'play.minesuperior.com',
    port: 25565,
    category: 'survival',
    description: 'Skyblock, survival and prison across several long-lived worlds.',
    version: '1.21',
    tags: ['skyblock', 'prison']
  },

  {
    id: 'opblocks',
    name: 'OPBlocks',
    address: 'play.opblocks.com',
    port: 25565,
    category: 'skyblock',
    description: 'Skyblock and prison with heavy custom progression.',
    version: '1.21',
    tags: ['skyblock', 'prison']
  },

  {
    id: '2b2t',
    name: '2b2t',
    address: '2b2t.org',
    port: 25565,
    category: 'anarchy',
    description: 'The oldest anarchy server in Minecraft. No rules, never reset, and usually a long queue.',
    version: '1.21',
    tags: ['anarchy', 'queue']
  },
  {
    id: '9b9t',
    name: '9b9t',
    address: '9b9t.com',
    port: 25565,
    category: 'anarchy',
    description: 'Anarchy server with no rules and a shorter queue than 2b2t.',
    version: '1.21',
    tags: ['anarchy']
  },
  {
    id: 'constantiam',
    name: 'Constantiam',
    address: 'constantiam.net',
    port: 25565,
    category: 'anarchy',
    description: 'Anarchy with an unusually technical, redstone-heavy community.',
    version: '1.21',
    tags: ['anarchy', 'technical']
  },

  {
    id: 'purpleprison',
    name: 'Purple Prison',
    address: 'purpleprison.net',
    port: 25565,
    category: 'prison',
    description: 'One of the longest-running prison servers, with mining ranks and gangs.',
    version: '1.21',
    tags: ['prison', 'gangs']
  },

  {
    id: 'wynncraft',
    name: 'Wynncraft',
    address: 'play.wynncraft.com',
    port: 25565,
    category: 'adventure',
    description: 'A full MMORPG built inside Minecraft: classes, quests and a hand-built continent.',
    version: '1.21',
    tags: ['mmorpg', 'quests']
  },
  {
    id: 'originrealms',
    name: 'Origin Realms',
    address: 'play.originrealms.com',
    port: 25565,
    category: 'adventure',
    description: 'Custom blocks and mechanics with no mods required, thanks to a resource pack.',
    version: '1.21',
    tags: ['custom', 'no-mods']
  },

  {
    id: 'earthmc',
    name: 'EarthMC',
    address: 'earthmc.net',
    port: 25565,
    category: 'creative',
    description: 'A 1:3000 scale map of Earth where players found real towns and nations.',
    version: '1.21',
    tags: ['towny', 'earth']
  },

  {
    id: 'complex',
    name: 'Complex Gaming',
    address: 'hub.mc-complex.com',
    port: 25565,
    category: 'modded',
    description: 'The best known Pixelmon network, plus skyblock and factions worlds.',
    version: '1.21',
    tags: ['pixelmon', 'modded']
  },
  {
    id: 'pixelmoncraft',
    name: 'PixelmonCraft',
    address: 'play.pixelmoncraft.com',
    port: 25565,
    category: 'modded',
    description: 'Pixelmon server with recreated Kanto and Johto regions. Needs the Pixelmon mod.',
    version: '1.20.2',
    tags: ['pixelmon', 'modded']
  }
]
