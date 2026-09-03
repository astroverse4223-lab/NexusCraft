import { createLogger } from '../../core/logger'

const log = createLogger('local-model')

/**
 * Finding a model on this machine when nothing has been configured.
 *
 * Crash diagnosis reads a crash report and says which mod caused it, and it
 * needed an AI companion set up first — because it borrowed that companion's
 * endpoint. That is backwards. The person most likely to be staring at a crash
 * they cannot read is the person who just installed the launcher and has not
 * set up a companion, and telling them to configure an AI assistant before
 * they can be told which mod is broken is not a feature, it is a toll.
 *
 * So this looks for an Ollama that is already running. If one is, diagnosis
 * works with no configuration at all, no key, and nothing sent off the machine.
 */

const OLLAMA = 'http://127.0.0.1:11434'

/** Cached, because this is asked on every crash and the answer rarely changes. */
let cached: { at: number; found: LocalModel | null } | null = null
const CACHE_MS = 60_000

export interface LocalModel {
  baseUrl: string
  model: string
  apiKey: string
}

/**
 * Models worth choosing, best first.
 *
 * Ordered from measurement rather than by size. Instruction-following is what
 * matters for reading a crash report and answering in JSON, and reasoning
 * models are actively worse at it here: they are slow, and when their thinking
 * is disabled some of them emit the reasoning as the answer.
 *
 * The families below are matched as prefixes so a specific tag — `:7b`,
 * `:latest`, a quantisation suffix — still matches.
 */
const PREFERRED = ['qwen2.5', 'qwen3', 'llama3.1', 'llama3.2', 'mistral', 'gemma2', 'phi4']

/** Models to skip even if present, because they will not answer usefully. */
const AVOID = [
  // Trained for an agent framework with its own command vocabulary; it answers
  // in that instead of doing as it is asked.
  'andy',
  // Reasoning models: slow, and their chain of thought leaks into the answer.
  'deepseek-r1',
  // Code models write code when asked for prose.
  'coder'
]

function score(name: string): number {
  const lower = name.toLowerCase()
  if (AVOID.some((bad) => lower.includes(bad))) return -1

  const rank = PREFERRED.findIndex((family) => lower.startsWith(family))
  // Unknown models are usable but ranked below anything recognised.
  return rank === -1 ? PREFERRED.length : rank
}

/**
 * An Ollama on this machine, if one is listening.
 *
 * Deliberately short-timeout: this runs while someone is waiting to be told why
 * their game crashed, and a slow answer to "is anything there" is a no.
 */
export async function findLocalModel(): Promise<LocalModel | null> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.found

  let found: LocalModel | null = null
  try {
    const response = await fetch(`${OLLAMA}/api/tags`, {
      signal: AbortSignal.timeout(1500)
    })
    if (response.ok) {
      const body = (await response.json()) as { models?: Array<{ name?: string }> }
      const names = (body.models ?? []).map((entry) => entry.name).filter((n): n is string => Boolean(n))

      const usable = names
        .map((name) => ({ name, rank: score(name) }))
        .filter((entry) => entry.rank >= 0)
        .sort((a, b) => a.rank - b.rank)

      if (usable.length > 0) {
        // Ollama speaks the OpenAI API at /v1, which is what the caller wants.
        found = { baseUrl: `${OLLAMA}/v1`, model: usable[0].name, apiKey: '' }
        log.info(`found a local model for diagnosis: ${usable[0].name}`)
      } else if (names.length > 0) {
        log.info(`Ollama is running but only has models unsuited to this: ${names.join(', ')}`)
      }
    }
  } catch {
    // Nothing listening. Entirely normal, and not worth a warning.
  }

  cached = { at: Date.now(), found }
  return found
}

/** Forgets the cached answer, for when the user has just installed a model. */
export function forgetLocalModel(): void {
  cached = null
}
