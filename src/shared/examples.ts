/**
 * Something to click when you cannot think of anything to type.
 *
 * An empty box asking you to describe a banner is a worse prompt than no
 * feature at all — the hard part of every one of these is not the typing, it is
 * knowing what sort of thing to ask for and how much detail helps.
 *
 * These are written to suit what each generator can actually do. The banner
 * ones name shapes a loom can weave; the icon ones describe things that read at
 * sixty-four pixels; the item ones name enchantments that exist. A suggestion
 * that produces a poor result teaches the wrong lesson about the tool.
 */
export type Generator =
  | 'banner'
  | 'icon'
  | 'motd'
  | 'logo'
  | 'firework'
  | 'item'
  | 'recipes'
  | 'loot'
  | 'advancement'

export const EXAMPLES: Record<Generator, string[]> = {
  banner: [
    'a red and gold shield for a kingdom server',
    'black and aqua, sharp and modern, for a minigame network',
    'a green and white striped flag for a farming town',
    'something that looks like a creeper',
    'deep blue with a white cross, like a naval flag',
    'purple and black diagonal stripes for an end-themed guild'
  ],
  icon: [
    'a glowing blue crystal on a dark background',
    'a red and gold crown for a kingdom server',
    'a green creeper face',
    'a white pickaxe crossed with a sword on navy',
    'an orange campfire on a dark brown circle',
    'a single bold letter N in gold on black'
  ],
  motd: [
    'a friendly welcome for a survival server called Nexus',
    'a hyped-up message for a minigame network with lots of colour',
    'a calm, tidy message for a whitelisted friends-only world',
    'announce that a new season just started',
    'a message for a skyblock server, mention the shop and quests',
    'short and mysterious, dark colours'
  ],
  logo: [
    'a bold gold and orange logo for a kingdom server',
    'aqua and white, clean and modern, for a minigame network',
    'blood red on black for a hardcore server',
    'green and lime for a farming and towns server',
    'purple to pink gradient for a creative building server',
    'ice blue with a dark outline for a winter-themed world'
  ],
  firework: [
    'a red and gold burst with a trail',
    'a huge blue and white star that fades to purple',
    'a creeper-shaped green burst that twinkles',
    'three small bursts in rainbow colours',
    'a slow gold rocket that fades to white, for a celebration',
    'purple and black, spooky, for a halloween event'
  ],
  advancement: [
    'a set of goals for a new survival player',
    'challenges for beating the mob arena',
    'milestones for a skyblock island, from first tree to level twenty',
    'achievements for exploring the nether',
    'a few silly ones for dying in stupid ways'
  ],
  loot: [
    'zombies drop an emerald one time in twenty',
    'creepers sometimes drop a diamond',
    'put netherite scrap in dungeon chests, rarely',
    'endermen drop a few ender pearls more often',
    'stone sometimes drops a bit of coal when mined'
  ],
  recipes: [
    'a way to turn cobblestone back into stone ore',
    'cheaper saddles and horse armour, crafted from leather and iron',
    'recipes for things you normally only find in chests',
    'turn nine of each ingot back into its block and the other way round',
    'a recipe for a name tag, so they are not only fishing luck',
    'compact recipes that make travel gear cheaper for a survival server'
  ],
  item: [
    'a legendary sword for a boss drop, very sharp and unbreakable',
    'a miner pickaxe with fortune and efficiency',
    'an enchanted golden apple named for a quest reward',
    'a fishing rod for a fishing tournament prize',
    'a bow for an archery minigame, punchy and quick',
    'diamond armour for the top player of the season'
  ]
}

/** A few of them, chosen without repeating and without randomness. */
export function someExamples(kind: Generator, count = 4, offset = 0): string[] {
  const all = EXAMPLES[kind]
  return Array.from({ length: Math.min(count, all.length) }, (_, i) => all[(offset + i) % all.length])
}
