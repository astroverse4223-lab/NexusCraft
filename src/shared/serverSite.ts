/**
 * The public page for a hosted server.
 *
 * A Minecraft server list wants three things before it will take a listing:
 * an address that answers, a description, and somewhere to send people. The
 * third is the one nobody has, so this is that page - who is on, what the
 * leaderboards say, and the links people vote through.
 *
 * It is rendered fresh on every request from files already on disk rather
 * than kept in a database, because the plugin is already writing all of it.
 */

/** One of the server lists a player can vote on. */
export interface VoteSite {
  /** What the site calls itself, shown on the button. */
  name: string
  /** Where the vote button goes. */
  url: string
}

export interface SiteConfig {
  /** Which hosted server the page is about. */
  serverId: string
  /** Heading on the page. Falls back to the server's own name. */
  title: string
  /** A sentence under the heading. */
  blurb: string
  /** The address players type into Minecraft, which is not always the host. */
  joinAddress: string
  /** Where voting sends people. */
  votes: VoteSite[]
  /** Accent colour, as a hex string. */
  accent: string
}

export function defaultSite(serverId: string, name: string): SiteConfig {
  return {
    serverId,
    title: name,
    blurb: 'Survival, skyblock, prison, and a dozen minigames.',
    joinAddress: '',
    votes: [],
    accent: '#7c5cff'
  }
}

/** The leaderboards worth showing, and how to read each one from a record. */
export const BOARDS = [
  { key: 'money', label: 'Richest', read: 'money', money: true },
  { key: 'blocksMined', label: 'Most blocks mined', read: 'blocksMined', money: false },
  { key: 'blocksDug', label: 'Most dug at the dig site', read: 'blocksDug', money: false },
  { key: 'minutesPlayed', label: 'Most time played', read: 'minutesPlayed', money: false },
  { key: 'questsDone', label: 'Most quests done', read: 'questsDone', money: false },
  { key: 'islandLevel', label: 'Highest island', read: 'islandLevel', money: false },
  { key: 'oneBlockBroken', label: 'Deepest one block', read: 'oneBlockBroken', money: false },
  { key: 'soldValue', label: 'Most sold', read: 'soldValue', money: true }
] as const

export interface SiteStatus {
  running: boolean
  port: number | null
  url: string | null
}
