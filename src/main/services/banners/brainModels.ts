import type { BannerBrain } from '@shared/banners'

/**
 * Turning a list of characters into a list of models.
 *
 * The generators borrow their language models from the AI companions, because
 * somebody who has set a companion up has already chosen a provider, entered a
 * key and picked a model, and asking for all of that again to draw a texture
 * would be rude.
 *
 * What that borrowing got wrong was offering the companions themselves. Five
 * bots pointed at one Ollama install are one choice, not five, and listing
 * them as Andy, LumberJack and Miner implies a difference in what comes back
 * that does not exist - none of the persona, the personality or the name
 * reaches the request a generator makes. Only the model does.
 *
 * Kept apart from bannerService so the rule can be tested without a database,
 * a keychain and half of Electron behind it.
 */

/** Just enough of a companion to pick a model out of it. */
export interface ModelSource {
  id: string
  baseUrl: string
  provider: string
  model: string
  hasApiKey: boolean
}

/** Whether a base url points at something running on this machine. */
export const isLocalModel = (baseUrl: string): boolean => /localhost|127\.0\.0\.1/.test(baseUrl)

/**
 * What to call a model in a list: the model, and where it runs.
 *
 * The provider field is a fallback rather than the first choice - it is free
 * text nobody has ever had to look at, so a base url of `https://api.z.ai/...`
 * reads better as "z.ai" than as whatever was typed into the provider box.
 */
export function modelLabel(baseUrl: string, provider: string, model: string): string {
  if (isLocalModel(baseUrl)) return `${model} · Ollama`

  let where = provider
  try {
    where = new URL(baseUrl).hostname.replace(/^api\./, '')
  } catch {
    /* A base url that will not parse is the provider name's problem. */
  }

  return where ? `${model} · ${where}` : model
}

/**
 * Folds companions down to the distinct models behind them.
 *
 * A companion with no model chosen is dropped: it is a character and nothing
 * else, and it was previously listed with a reason nobody read beside a name
 * that could not answer.
 */
export function foldToModels(companions: ModelSource[]): BannerBrain[] {
  const byModel = new Map<string, BannerBrain>()

  for (const companion of companions) {
    if (!companion.model) continue

    const ready = isLocalModel(companion.baseUrl) || companion.hasApiKey
    const key = `${companion.baseUrl}|${companion.model}`.toLowerCase()

    /*
     * First one wins, unless a later one is configured and the first is not.
     * Two companions can share a model with the key entered against only one
     * of them, and the one that works is the one worth keeping.
     */
    const already = byModel.get(key)
    if (already && (already.ready || !ready)) continue

    byModel.set(key, {
      id: companion.id,
      label: modelLabel(companion.baseUrl, companion.provider, companion.model),
      provider: companion.provider,
      model: companion.model,
      ready,
      reason: ready ? '' : 'needs an API key on the AI Companion tab'
    })
  }

  return [...byModel.values()].sort((a, b) => a.label.localeCompare(b.label))
}
