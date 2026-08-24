/**
 * Crops, soil, and noticing that the bot died mid-job.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Seed item -> the crop block it becomes, and what it drops when grown. */
export const CROPS: Record<string, { block: string; label: string }> = {
  wheat_seeds: { block: 'wheat', label: 'wheat' },
  carrot: { block: 'carrots', label: 'carrots' },
  potato: { block: 'potatoes', label: 'potatoes' },
  beetroot_seeds: { block: 'beetroots', label: 'beetroots' },
  melon_seeds: { block: 'melon_stem', label: 'melons' },
  pumpkin_seeds: { block: 'pumpkin_stem', label: 'pumpkins' }
}

/** Ground a hoe will turn into farmland. */
export const TILLABLE = new Set(['grass_block', 'dirt', 'coarse_dirt', 'rooted_dirt', 'dirt_path'])

/**
 * Whether a crop has finished growing.
 *
 * Harvesting early destroys the crop for a fraction of the yield, so age is
 * checked rather than assumed. Most crops finish at age 7; beetroot at 3.
 */
export function isRipe(block: any): boolean {
  try {
    const age = Number(block.getProperties?.().age)
    if (Number.isNaN(age)) return false
    return block.name === 'beetroots' ? age >= 3 : age >= 7
  } catch {
    return false
  }
}

/**
 * Notices when the bot dies part-way through a job.
 *
 * Nothing in the tools watched for this, so a bot that died while gathering
 * carried on running the loop for another eighty seconds and then reported
 * "mined 38x short_grass" with an empty inventory — everything it had was lying
 * on the ground where it was killed. Dying invalidates whatever the job was
 * doing, and the model needs to be told rather than handed a false success.
 */
export function watchForDeath(bot: any): { died: () => boolean; stop: () => void } {
  let dead = false
  const onDeath = (): void => {
    dead = true
  }
  bot.on('death', onDeath)
  return {
    died: () => dead,
    stop: () => bot.removeListener('death', onDeath)
  }
}
