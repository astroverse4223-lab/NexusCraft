/**
 * Suggestions that do not run out.
 *
 * The chips under each generator were a hand-written list of five, so the
 * refresh button had nothing to show after two presses and the same three
 * ideas came round again. This builds them instead: a handful of sentence
 * shapes per generator, each with slots, filled from word lists.
 *
 * Combinatorial rather than asked of a language model, because a suggestion has
 * to appear the instant somebody opens the tab. Asking the model would mean a
 * spinner where the ideas should be, would cost tokens for something nobody
 * reads half of, and would not work at all before an AI is set up - which is
 * exactly when somebody most needs a hint about what to type.
 */
import { EXAMPLES, type Generator } from './examples'

interface Shape {
  /** Sentences with {slots} in them. */
  templates: string[]
  /** What each slot can be. */
  slots: Record<string, string[]>
}

const IDEAS: Record<Generator, Shape> = {
  banner: {
    templates: [
      'a {colour} and {colour2} banner with {motif} for {place}',
      'a {mood} banner for {place}',
      'a banner that looks like {thing}',
      '{motif} on a {colour} field, {mood}',
      'a {colour} banner for a {role} guild'
    ],
    slots: {
      colour: [
        'black', 'crimson', 'deep blue', 'gold', 'white', 'forest green',
        'purple', 'orange', 'cyan', 'grey', 'pink', 'lime'
      ],
      colour2: ['gold', 'white', 'silver', 'black', 'red', 'sky blue', 'bone', 'copper'],
      motif: [
        'a skull', 'crossed swords', 'a crown', 'a rising sun', 'a wolf',
        'a tree', 'a lightning bolt', 'a shield', 'a diamond', 'a creeper face',
        'waves', 'a mountain'
      ],
      place: [
        'a PvP arena', 'a spawn town', 'a guild hall', 'a shop front',
        'a nether outpost', 'an end portal room', 'a farm', 'a castle gate',
        'a tavern', 'a harbour'
      ],
      mood: [
        'stark and simple', 'ornate', 'faded and old', 'bright and cheerful',
        'grim', 'regal', 'nautical', 'wintry'
      ],
      thing: [
        'a chessboard', 'a sunset', 'a pirate flag', 'stained glass',
        'a target', 'a snowy pine', 'a lava flow', 'an eye', 'a compass rose',
        'a striped awning'
      ],
      role: ['builders', 'miners', 'raiders', 'traders', 'archers', 'farmers']
    }
  },

  icon: {
    templates: [
      'a {style} {subject} in {colour}',
      '{subject}, {style}, on a {background} background',
      'a server icon of {subject} for {place}',
      '{colour} {subject} with {detail}'
    ],
    slots: {
      style: [
        'glowing', 'flat', 'chunky pixel-art', 'minimal', 'shaded',
        'outlined', 'worn', 'shining'
      ],
      subject: [
        'a diamond', 'a creeper face', 'a pickaxe', 'a nether portal',
        'a castle tower', 'a tree', 'a sword and shield', 'an ender eye',
        'a treasure chest', 'a compass', 'a wolf head', 'a crown',
        'a potion bottle', 'a heart', 'a lightning bolt'
      ],
      colour: ['purple', 'gold', 'emerald green', 'deep red', 'ice blue', 'orange', 'black and white'],
      background: ['dark', 'transparent', 'starry', 'stone', 'gradient'],
      place: ['a survival server', 'a skyblock server', 'a minigame lobby', 'a prison server'],
      detail: ['a soft glow', 'a thin outline', 'sparkles', 'a shadow', 'a gradient']
    }
  },

  motd: {
    templates: [
      'a {tone} welcome for a {kind} server',
      '{tone} two-liner for {kind}, mentioning {feature}',
      'something {tone} that says we are {state}',
      'a {tone} message about {feature}',
      '{tone} welcome for {kind} that mentions {feature}'
    ],
    slots: {
      tone: [
        'warm', 'short and punchy', 'mysterious', 'funny', 'grand',
        'friendly', 'ominous', 'proud', 'casual', 'old-fashioned'
      ],
      kind: [
        'survival', 'skyblock', 'one block', 'prison', 'creative',
        'a minigame network', 'a small friends-only server', 'hardcore'
      ],
      feature: [
        'the new nether', 'weekly events', 'player shops', 'guilds',
        'the mob arena', 'build battles', 'dungeons', 'ranks', 'the map reset'
      ],
      state: ['open', 'back online', 'freshly reset', 'looking for builders', 'whitelisted']
    }
  },

  logo: {
    templates: [
      'a {weight} {colour} logo for {kind}',
      '{colour} lettering with {edge}, {weight}',
      'a logo that feels {mood}, in {colour}, for {kind}',
      '{weight} logo with a tagline about {feature}',
      '{mood} {colour} logo with {edge}'
    ],
    slots: {
      weight: ['bold', 'thin', 'heavy', 'clean', 'blocky', 'tall', 'wide', 'cramped'],
      colour: [
        'gold on black', 'crimson', 'ice blue', 'emerald green', 'purple and pink',
        'orange to yellow', 'silver', 'red to orange'
      ],
      kind: [
        'a survival server', 'a skyblock server', 'a PvP network',
        'a friends-only realm', 'a prison server', 'a creative server'
      ],
      edge: ['a dark outline', 'a glow', 'a hard shadow', 'no outline at all'],
      mood: ['medieval', 'futuristic', 'cosy', 'dangerous', 'nautical', 'volcanic'],
      feature: ['weekly resets', 'guild wars', 'the new map', 'free ranks', 'dungeons']
    }
  },

  firework: {
    templates: [
      'a {colour} {shape} with {trail}',
      '{colour} and {colour2}, {shape}, {size}',
      'a firework for {occasion}, mostly {colour}',
      '{size} {shape} that fades to {colour2}'
    ],
    slots: {
      colour: ['red', 'gold', 'deep blue', 'green', 'purple', 'white', 'orange', 'pink', 'cyan'],
      colour2: ['gold', 'white', 'silver', 'black', 'red', 'blue'],
      shape: ['big ball', 'small ball', 'star burst', 'creeper face', 'burst'],
      trail: ['a long trail', 'a twinkle', 'a trail and a twinkle', 'no trail'],
      size: ['a short flight', 'a high flight', 'a slow climb'],
      occasion: [
        'new year', 'a server anniversary', 'a wedding', 'a boss kill',
        'a grand opening', 'a tournament win'
      ]
    }
  },

  item: {
    templates: [
      'a {quality} {item} for {purpose}',
      '{quality} {item} named after {theme}',
      'a {item} that feels {mood}, with lore',
      'a reward {item} for {purpose}'
    ],
    slots: {
      quality: ['legendary', 'cursed', 'ancient', 'humble', 'royal', 'battered', 'blessed'],
      item: [
        'sword', 'bow', 'pickaxe', 'helmet', 'trident', 'axe', 'shovel',
        'fishing rod', 'shield', 'chestplate', 'crossbow', 'elytra'
      ],
      purpose: [
        'a boss drop', 'the top of a crate', 'a quest reward', 'a PvP kit',
        'a mining rank', 'an event prize', 'a starter kit'
      ],
      theme: [
        'the sea', 'a volcano', 'the end', 'a fallen king', 'winter',
        'a thunderstorm', 'the deep caves', 'an old god'
      ],
      mood: ['heavy and slow', 'quick and light', 'unlucky', 'holy', 'wicked']
    }
  },

  recipes: {
    templates: [
      'a recipe that makes {item} cheaper for {purpose}',
      'turn {thing} back into {thing2}, {balance}',
      'a way to craft {item} without {ingredient}',
      'compact recipes for {purpose}, {balance}',
      'let {item} be made from {ingredient}',
      'recipes for {item} on {purpose}, {balance}'
    ],
    slots: {
      item: [
        'saddles', 'name tags', 'elytra', 'shulker boxes', 'horse armour',
        'tridents', 'chainmail', 'bells', 'spyglasses', 'lodestones',
        'enchanted golden apples', 'totems', 'anvils', 'beacons',
        'ender chests', 'nametag books'
      ],
      thing: [
        'cobblestone', 'gravel', 'sand', 'coal blocks', 'bricks', 'concrete',
        'deepslate', 'terracotta', 'glass panes'
      ],
      thing2: ['stone', 'flint', 'glass', 'coal', 'clay', 'dye', 'sandstone', 'quartz'],
      ingredient: [
        'diamonds', 'netherite', 'a trip to the end', 'blaze rods',
        'ancient debris', 'leather', 'a villager', 'a fortress'
      ],
      purpose: [
        'a survival server', 'a skyblock island', 'a prison server',
        'travel gear', 'a farming server', 'early game', 'a hardcore world',
        'a friends-only realm'
      ],
      balance: [
        'without making it silly', 'kept expensive', 'much cheaper',
        'a little cheaper', 'for a fast-paced server'
      ]
    }
  },

  advancement: {
    templates: [
      '{count} goals for {who}, ending with {finale}',
      'achievements for {activity}',
      '{count} challenges about {activity}, {tone}',
      'milestones for {who}, from {start} to {finale}',
      '{tone} achievements for {activity}'
    ],
    slots: {
      count: ['a few', 'five', 'a handful of', 'a dozen'],
      who: [
        'a new survival player', 'a skyblock island', 'a prison inmate',
        'somebody building a base', 'a guild', 'a fisherman', 'a miner'
      ],
      activity: [
        'exploring the nether', 'beating the mob arena', 'building a farm',
        'fighting the dragon', 'trading with villagers', 'enchanting gear',
        'digging to bedrock', 'taming animals', 'brewing potions',
        'sailing to a distant island', 'surviving the first night'
      ],
      finale: [
        'killing the dragon', 'a full netherite set', 'island level twenty',
        'a beacon', 'an elytra', 'the top of the leaderboard', 'a full shop'
      ],
      start: [
        'punching a tree', 'a first stone pickaxe', 'a single island',
        'an empty chest', 'the tutorial'
      ],
      tone: ['serious', 'silly', 'hard', 'gentle', 'for a hardcore world']
    }
  },

  loot: {
    templates: [
      '{mob} drop {drop} {rarity}',
      'put {drop} in {chest} chests, {rarity}',
      'mining {block} sometimes gives {drop}',
      '{mob} drop a bit more {drop}'
    ],
    slots: {
      mob: [
        'zombies', 'skeletons', 'creepers', 'spiders', 'endermen', 'witches',
        'drowned', 'phantoms', 'piglins', 'blazes', 'guardians', 'ravagers'
      ],
      drop: [
        'emeralds', 'diamonds', 'gold ingots', 'iron ingots', 'ender pearls',
        'gunpowder', 'experience bottles', 'netherite scrap', 'amethyst shards',
        'golden apples', 'lapis', 'quartz'
      ],
      rarity: [
        'one time in twenty', 'rarely', 'about a third of the time',
        'one in fifty', 'now and then'
      ],
      chest: [
        'dungeon', 'mineshaft', 'desert temple', 'shipwreck', 'stronghold',
        'buried treasure', 'bastion'
      ],
      block: ['stone', 'deepslate', 'gravel', 'sand', 'netherrack', 'andesite']
    }
  },

}

/** The slot names in a template, in the order they appear. */
function slotsOf(template: string): string[] {
  return [...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1])
}

/** How many different sentences one template can make. */
function sizeOf(shape: Shape, template: string): number {
  return slotsOf(template).reduce((total, slot) => total * (shape.slots[slot]?.length ?? 1), 1)
}

/** Every prompt this generator could ever suggest. */
export function ideaCount(kind: Generator): number {
  const shape = IDEAS[kind]
  if (!shape) return 0

  return shape.templates.reduce((total, template) => total + sizeOf(shape, template), 0)
}

/**
 * The idea at a given position in the whole space.
 *
 * Counted out rather than picked at random, so pressing refresh cannot show
 * the same suggestion twice until every one of them has been seen.
 */
function ideaAt(kind: Generator, index: number): string {
  const shape = IDEAS[kind]
  if (!shape) return ''

  let left = index

  for (const template of shape.templates) {
    const size = sizeOf(shape, template)

    if (left >= size) {
      left -= size
      continue
    }

    // Mixed radix: each slot is a digit, its word list the base.
    let rest = left

    return template.replace(/\{(\w+)\}/g, (_, slot: string) => {
      const words = shape.slots[slot] ?? []
      if (words.length === 0) return ''

      const word = words[rest % words.length]
      rest = Math.floor(rest / words.length)

      return word
    })
  }

  return ''
}

/**
 * Suggestions starting from an offset, without repeats.
 *
 * The offset is scattered across the space by a large odd step rather than
 * walked in order, or the first several presses of refresh would all differ
 * only in their last word - the same sentence with a different colour in it,
 * which reads as the button not working.
 */
/**
 * A stride that walks the whole space without clustering.
 *
 * A fixed large constant looked right and was not: taken modulo the number of
 * recipe ideas it came to 81, so three consecutive picks landed 81 apart in a
 * space of 1424 - the same sentence with the last word changed, three times in
 * a row. Scaling the stride to the space keeps neighbours far apart, and the
 * golden ratio is the proportion that leaves the fewest gaps as it goes round.
 */
function strideFor(total: number): number {
  let stride = Math.max(1, Math.floor(total * 0.6180339887))

  // Coprime with the total, or the walk closes early and repeats itself.
  while (gcd(stride, total) !== 1) stride++

  return stride
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b)
}

/** The nth idea, scattered across the whole space. */
function nthIdea(kind: Generator, n: number): string {
  const total = ideaCount(kind)
  if (total === 0) return ''

  return ideaAt(kind, (n * strideFor(total)) % total)
}

export function ideasFor(kind: Generator, count: number, offset: number): string[] {
  const total = ideaCount(kind)
  if (total === 0) return []

  const out: string[] = []
  const seen = new Set<string>()

  for (let i = 0; out.length < count && i < count * 40; i++) {
    const text = nthIdea(kind, offset + i)

    if (!text || seen.has(text)) continue

    seen.add(text)
    out.push(text)
  }

  return out
}

/**
 * What the chips actually show.
 *
 * The hand-written examples come first, because they were chosen and the
 * generated ones were only assembled - the first thing somebody sees should be
 * the best sentence available, not a random one. Once those run out the space
 * below is effectively bottomless.
 */
export function promptsFor(kind: Generator, count: number, offset: number): string[] {
  const written = EXAMPLES[kind] ?? []
  const out: string[] = []

  /*
   * One list, read straight through.
   *
   * Splitting it into "the written ones" and "the generated ones" made the
   * press that straddled the join hand out generated ideas from position zero,
   * which the next press then handed out again - so a suggestion appeared
   * twice within a few seconds of itself.
   */
  for (let i = 0; out.length < count && i < offset + count * 40; i++) {
    const at = offset + i

    const text = at < written.length ? written[at] : nthIdea(kind, at - written.length)
    if (!text || out.includes(text)) continue

    out.push(text)
  }

  return out
}
