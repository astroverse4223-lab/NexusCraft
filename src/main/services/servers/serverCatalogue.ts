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
  },

  /*
   * Added in a second pass, the same way as the first: every one of these
   * answered a real ping before it was written down, and the descriptions come
   * from what the server itself said in its MOTD rather than from a server-list
   * site. Twenty-three candidates that did not answer were dropped, and seven
   * more were the same networks already listed above on a different domain.
   *
   * A warning for whoever probes the next batch: ping them in small groups.
   * Firing sixty-four at once made sixty-three of them time out and look dead,
   * which very nearly deleted most of this list before it was written.
   */
  {
    id: 'gommehd',
    name: 'GommeHD.net',
    address: 'gommehd.net',
    port: 25565,
    category: 'minigames',
    description: 'Long-running German network. Bed wars, sky wars and cores, with English players welcome.',
    version: '1.21',
    tags: ['bedwars', 'skywars', 'german']
  },
  {
    id: 'blocksmc',
    name: 'BlocksMC',
    address: 'play.blocksmc.com',
    port: 25565,
    category: 'minigames',
    description: 'Practice PvP, bed wars and a rotating set of custom games.',
    version: '1.21',
    tags: ['pvp', 'bedwars', 'practice']
  },
  {
    id: 'mineland',
    name: 'Mineland Network',
    address: 'play.mineland.net',
    port: 25565,
    category: 'minigames',
    description: 'Minigames, creative plots and its own mini-game builder. Takes 1.8 through current.',
    version: '1.21',
    tags: ['minigames', 'creative']
  },
  {
    id: 'hoplite',
    name: 'Hoplite Network',
    address: 'mc.hoplite.gg',
    port: 25565,
    category: 'minigames',
    description: 'Competitive minigames with limited-time modes. Runs a current version rather than 1.8.',
    version: '1.21.11',
    tags: ['pvp', 'minigames']
  },
  {
    id: 'minefun',
    name: 'MineFun Network',
    address: 'play.minefun.net',
    port: 25565,
    category: 'minigames',
    description: 'Mixed network of survival, skyblock and PvP modes.',
    version: '1.21',
    tags: ['survival', 'pvp']
  },
  {
    id: 'mineverse',
    name: 'Mineverse',
    address: 'play.mineverse.com',
    port: 25565,
    category: 'minigames',
    description: 'Veteran minigame network — kit PvP, prison and factions.',
    version: '1.21',
    tags: ['kitpvp', 'prison', 'factions']
  },
  {
    id: 'vortex-network',
    name: 'Vortex Network',
    address: 'play.vortexnetwork.net',
    port: 25565,
    category: 'skyblock',
    description: 'Skyblock, prison and survival modes across one network.',
    version: '1.21',
    tags: ['skyblock', 'prison']
  },
  {
    id: 'advancius',
    name: 'Advancius Network',
    address: 'mc.advancius.net',
    port: 25565,
    category: 'survival',
    description: 'Towny earth map and prison on one network, accepting 1.8 through current.',
    version: '1.21',
    tags: ['towny', 'earth', 'prison']
  },
  {
    id: 'craftyourtown',
    name: 'CraftYourTown',
    address: 'mc.craftyourtown.com',
    port: 25565,
    category: 'survival',
    description: 'Towny survival with Slimefun and minigames alongside it.',
    version: '1.21',
    tags: ['towny', 'slimefun', 'survival']
  },
  {
    id: 'extremecraft',
    name: 'ExtremeCraft',
    address: 'play.extremecraft.net',
    port: 25565,
    category: 'survival',
    description: 'Survival with a custom economy, plus skyblock, factions and prison worlds.',
    version: '1.21',
    tags: ['survival', 'economy', 'factions']
  },
  {
    id: 'snapcraft',
    name: 'SnapCraft',
    address: 'play.snapcraft.net',
    port: 25565,
    category: 'survival',
    description: 'Survival network running alongside skyblock and prison modes.',
    version: '1.21',
    tags: ['survival', 'skyblock']
  },
  {
    id: 'mythicmc',
    name: 'MythicMC',
    address: 'play.mythicmc.org',
    port: 25565,
    category: 'survival',
    description: 'Factions, survival, creative and PvP together on one address.',
    version: '1.21',
    tags: ['factions', 'survival', 'creative']
  },
  {
    id: 'foxcraft',
    name: 'Foxcraft',
    address: 'play.foxcraft.net',
    port: 25565,
    category: 'survival',
    description: 'Survival, skyblock and prison, on a current version.',
    version: '1.21',
    tags: ['survival', 'skyblock', 'prison']
  },
  {
    id: 'piratecraft',
    name: 'PirateCraft',
    address: 'mc.piratemc.com',
    port: 25565,
    category: 'adventure',
    description: 'Pirate-themed survival with buildable, sailable ships, cannons and sea battles.',
    version: '1.21',
    tags: ['pirates', 'ships', 'survival']
  },
  {
    id: 'grandtheftmc',
    name: 'Grand Theft Minecart',
    address: 'play.grandtheftmc.net',
    port: 25565,
    category: 'adventure',
    description: 'Open-world roleplay with cars, guns, jobs and heists.',
    version: '1.21',
    tags: ['roleplay', 'guns', 'cars']
  },
  {
    id: 'buildersrefuge',
    name: 'Builders Refuge',
    address: 'play.buildersrefuge.com',
    port: 25565,
    category: 'creative',
    description: 'Creative plots aimed at serious builders, with a large plugin toolkit.',
    version: '1.21.11',
    tags: ['creative', 'plots', 'building']
  },
  {
    id: 'mcmiddleearth',
    name: 'Minecraft Middle Earth',
    address: 'mcmiddleearth.com',
    port: 25565,
    category: 'creative',
    description: 'A years-long collaborative build of Tolkien’s Middle-earth. Tours run for visitors.',
    version: '1.21',
    tags: ['building', 'tolkien', 'tours']
  },
  {
    id: 'skyblock-net',
    name: 'Skyblock.net',
    address: 'play.skyblock.net',
    port: 25565,
    category: 'skyblock',
    description: 'One of the older dedicated skyblock servers, now with Bedrock support.',
    version: '1.21',
    tags: ['skyblock', 'bedrock']
  },
  {
    id: 'fadecloud',
    name: 'FadeCloud',
    address: 'play.fadecloud.com',
    port: 25565,
    category: 'skyblock',
    description: 'Skyblock, prison and gens, taking 1.13 through current.',
    version: '1.21',
    tags: ['skyblock', 'prison', 'gens']
  },
  {
    id: 'lemoncloud',
    name: 'LemonCloud',
    address: 'play.lemoncloud.net',
    port: 25565,
    category: 'skyblock',
    description: 'Skyblock and survival with a heavy custom-item economy.',
    version: '1.21',
    tags: ['skyblock', 'survival']
  },
  {
    id: 'aslanmc',
    name: 'AslanMC',
    address: 'play.mineheroes.net',
    port: 25565,
    category: 'skyblock',
    description: 'Formerly MineHeroes — skyblock and survival. The old address still reaches it.',
    version: '1.21',
    tags: ['skyblock', 'survival']
  },
  {
    id: 'pvpwars',
    name: 'PvPWars',
    address: 'play.pvpwars.net',
    port: 25565,
    category: 'skyblock',
    description: 'Skyblock and factions. Was showing a maintenance message when this was added.',
    version: '1.19.2',
    tags: ['skyblock', 'factions']
  },
  {
    id: 'minecadia',
    name: 'Minecadia',
    address: 'play.minecadia.com',
    port: 25565,
    category: 'prison',
    description: 'Factions and prison with custom enchants, from 1.8 upward.',
    version: '1.21',
    tags: ['factions', 'prison', 'enchants']
  },
  {
    id: 'saicopvp',
    name: 'SaiCoPvP',
    address: 'play.saicopvp.com',
    port: 25565,
    category: 'prison',
    description: 'Prison and factions realms with a long-running competitive scene.',
    version: '1.21',
    tags: ['prison', 'factions', 'pvp']
  },
  {
    id: 'wildnetwork',
    name: 'WildNetwork',
    address: 'play.wildprison.net',
    port: 25565,
    category: 'prison',
    description: 'Prison and survival on one network.',
    version: '1.21',
    tags: ['prison', 'survival']
  },
  {
    id: 'akumamc',
    name: 'AkumaMC',
    address: 'play.akumamc.net',
    port: 25565,
    category: 'prison',
    description: 'Prison, skyblock and factions, accepting 1.8 through current.',
    version: '1.21',
    tags: ['prison', 'skyblock', 'factions']
  },
  {
    id: 'cosmicpvp',
    name: 'Cosmic Prisons',
    address: 'play.cosmicpvp.me',
    port: 25565,
    category: 'prison',
    description: 'Prisons and factions with heavily customised progression.',
    version: '1.21',
    tags: ['prison', 'factions']
  },
  {
    id: 'bosscraft',
    name: 'BossCraft',
    address: 'play.mcprison.net',
    port: 25565,
    category: 'prison',
    description: 'Prison server running 1.17 through current.',
    version: '1.21',
    tags: ['prison']
  },
  {
    id: '6b6t',
    name: '6b6t',
    address: '6b6t.org',
    port: 25565,
    category: 'anarchy',
    description: 'Anarchy since 2022, but with /tpa and /home — a gentler take than 2b2t.',
    version: '1.21',
    tags: ['anarchy', 'no-rules']
  },
  {
    id: 'pixelmon-realms',
    name: 'Pixelmon Realms',
    address: 'play.pixelmonrealms.com',
    port: 25565,
    category: 'modded',
    description: 'Pixelmon with warzones and custom content. Needs the Pixelmon mod.',
    version: '1.16.5',
    tags: ['pixelmon', 'modded']
  },
  {
    id: 'pokesaga',
    name: 'PokéSaga',
    address: 'play.pokesaga.org',
    port: 25565,
    category: 'modded',
    description: 'Pixelmon with custom enchants and fishing. Needs the Pixelmon mod.',
    version: '1.16.5',
    tags: ['pixelmon', 'modded']
  }
]
