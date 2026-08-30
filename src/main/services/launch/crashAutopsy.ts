import { readFile } from 'node:fs/promises'
import type { CrashDiagnosis, CrashAutopsy, Instance, ModInfo } from '@shared/types'
import { LauncherError } from '../../core/errors'
import { createLogger, redact } from '../../core/logger'
import { chat, LlmError, type ChatMessage } from '../../companion/llm'
import { listCompanions } from '../companion/companionService'
import { getSecret } from '../auth/secureStore'
import { analyseMods } from '../mods/modService'
import { recentLogs } from './launchService'

const log = createLogger('autopsy')

/**
 * Reads a crash the way an experienced player would.
 *
 * `crashReport.ts` already recognises the crashes with a stable signature —
 * out of memory, a missing native, a mixin failure — and those answers are
 * better than a model's because they are certain. What it cannot do is the
 * common case: a 180-mod pack where the stack trace names a class nobody has
 * heard of and the actual culprit is one jar three frames up. That is a
 * reading-comprehension problem over text the launcher already has, which is
 * exactly what a language model is good at.
 *
 * Everything sent has been through the launcher's redaction: the log ring
 * buffer is redacted as it is captured, and JVM dumps are scrubbed on exit.
 * The mod list is names and versions. No token, path or account detail leaves
 * this machine beyond that.
 */

/** How much of the log to send. Enough for a stack trace, short of a novel. */
const LOG_TAIL_LINES = 220
const MAX_REPORT_CHARS = 14_000

const SYSTEM_PROMPT = `You diagnose Minecraft crashes for a launcher. You are given a crash report, the tail of the game log, and the list of installed mods.

Reply with JSON only, in exactly this shape:
{
  "summary": "one or two sentences, plain language, no jargon",
  "confidence": "high" | "medium" | "low",
  "suspects": [
    { "modFileName": "exact file name from the mod list, or null", "modName": "readable name", "why": "one sentence", "confidence": "high" | "medium" | "low" }
  ],
  "fixes": [
    { "kind": "disable-mod" | "update-mod" | "more-memory" | "less-memory" | "repair" | "manual",
      "label": "what the button should say",
      "detail": "one sentence saying what this does",
      "modFileName": "exact file name when the fix targets a mod, else null" }
  ]
}

Rules:
- Only name a mod in modFileName if that exact file name appears in the provided mod list. Otherwise use null.
- List at most 4 suspects and at most 4 fixes, best first.
- Prefer "disable-mod" or "update-mod" when a specific mod is implicated; "more-memory" only for genuine out-of-memory errors.
- If the log does not actually say why it crashed, say so in the summary and set confidence to "low". Do not invent a cause.
- Output the JSON object and nothing else.`

/** The companion profile whose model does the reading, if any is configured. */
function pickModel(): { baseUrl: string; apiKey: string; model: string } | null {
  const companions = listCompanions()

  // Any companion that can actually answer will do; a local Ollama is free, so
  // prefer one that needs no key over one that spends credit.
  const usable = companions.filter((companion) => companion.model && companion.baseUrl)
  const preferred = usable.find((companion) => !companion.hasApiKey) ?? usable[0]
  if (!preferred) return null

  return {
    baseUrl: preferred.baseUrl,
    apiKey: getSecret(`companion-llm-key-${preferred.id}`) ?? '',
    model: preferred.model
  }
}

/** True when a model is configured, so the UI can offer this at all. */
export function autopsyAvailable(): boolean {
  return pickModel() !== null
}

/** Pulls the JSON object out of a reply that may be wrapped in prose or fences. */
function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
  const candidate = fenced ? fenced[1] : text

  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('the model did not return JSON')

  return JSON.parse(candidate.slice(start, end + 1))
}

/** Keeps only what the shape promises, so a creative model cannot reach the UI. */
function sanitise(raw: unknown, mods: ModInfo[]): CrashAutopsy {
  const object = (raw ?? {}) as Record<string, unknown>
  const known = new Set(mods.map((mod) => mod.fileName))

  const confidenceOf = (value: unknown): 'high' | 'medium' | 'low' =>
    value === 'high' || value === 'medium' ? value : 'low'

  const modFileOf = (value: unknown): string | null =>
    typeof value === 'string' && known.has(value) ? value : null

  const suspects = Array.isArray(object.suspects)
    ? object.suspects.slice(0, 4).map((entry) => {
        const suspect = (entry ?? {}) as Record<string, unknown>
        return {
          modFileName: modFileOf(suspect.modFileName),
          modName: String(suspect.modName ?? 'Unknown mod').slice(0, 120),
          why: String(suspect.why ?? '').slice(0, 400),
          confidence: confidenceOf(suspect.confidence)
        }
      })
    : []

  const allowedKinds = new Set(['disable-mod', 'update-mod', 'more-memory', 'less-memory', 'repair', 'manual'])

  const fixes = Array.isArray(object.fixes)
    ? object.fixes.slice(0, 4).map((entry) => {
        const fix = (entry ?? {}) as Record<string, unknown>
        const kind = allowedKinds.has(String(fix.kind)) ? (fix.kind as CrashAutopsy['fixes'][number]['kind']) : 'manual'
        const modFileName = modFileOf(fix.modFileName)

        return {
          // A mod-targeted fix with no valid mod behind it is a button that
          // would do nothing; demote it to advice instead of offering it.
          kind: (kind === 'disable-mod' || kind === 'update-mod') && !modFileName ? 'manual' : kind,
          label: String(fix.label ?? 'Try this').slice(0, 80),
          detail: String(fix.detail ?? '').slice(0, 300),
          modFileName
        }
      })
    : []

  return {
    summary: String(object.summary ?? 'The model did not explain the crash.').slice(0, 900),
    confidence: confidenceOf(object.confidence),
    suspects,
    fixes,
    model: ''
  }
}

/**
 * Reads a crash and returns what it thinks went wrong.
 *
 * The known-signature diagnosis is passed in rather than replaced: when
 * `crashReport.ts` already recognised the failure, that certainty is given to
 * the model as context so it can name the specific mod instead of repeating
 * the generic explanation the user has already read.
 */
export async function diagnoseWithModel(
  instance: Instance,
  crash: CrashDiagnosis | null
): Promise<CrashAutopsy> {
  const config = pickModel()
  if (!config) {
    throw new LauncherError('INVALID_INPUT', 'no model configured', {
      title: 'No model is set up to read the crash',
      message:
        'Crash Autopsy uses the same model as your AI companion. Set one up on the Companion screen — Ollama runs locally and costs nothing.',
      actions: ['Open the Companion screen and configure a model', 'Then press "Explain this crash" again']
    })
  }

  const mods = await analyseMods(instance).catch(() => [] as ModInfo[])
  const enabled = mods.filter((mod) => mod.enabled)

  // The report Minecraft wrote, when it wrote one, is the best evidence there is.
  let report = ''
  if (crash?.reportPath) {
    try {
      report = redact(await readFile(crash.reportPath, 'utf8')).slice(0, MAX_REPORT_CHARS)
    } catch {
      /* fall back to the log tail alone */
    }
  }

  const logTail = recentLogs(instance.id, LOG_TAIL_LINES)
    .map((line) => line.line)
    .join('\n')
    .slice(-MAX_REPORT_CHARS)

  if (!report && !logTail.trim()) {
    throw new LauncherError('NOT_FOUND', 'nothing to read', {
      title: 'There is nothing to diagnose',
      message: 'No crash report was written and the game log is empty, so there is no evidence to read.',
      actions: ['Launch the game again and let it fail, then try once more']
    })
  }

  const modList = enabled
    .map((mod) => `${mod.fileName} — ${mod.name}${mod.version ? ` ${mod.version}` : ''}`)
    .join('\n')
    .slice(0, 12_000)

  const context = [
    `Minecraft ${instance.minecraftVersion}, loader: ${instance.loader}${instance.loaderVersion ? ` ${instance.loaderVersion}` : ''}`,
    `Memory: ${instance.java.minRamMb}–${instance.java.maxRamMb} MB`,
    crash?.cause ? `Reported cause: ${crash.cause}` : null,
    crash?.description ? `Doing: ${crash.description}` : null,
    crash?.explanation ? `The launcher already recognised this as: ${crash.explanation}` : null,
    '',
    `Enabled mods (${enabled.length}):`,
    modList || '(none)',
    '',
    report ? `Crash report:\n${report}` : null,
    logTail ? `Log tail:\n${logTail}` : null
  ]
    .filter(Boolean)
    .join('\n')

  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: context }
  ]

  log.info(`asking ${config.model} to read a crash in "${instance.name}"`)

  let reply
  try {
    reply = await chat({ ...config, temperature: 0.2, timeoutMs: 120_000 }, messages, [])
  } catch (err) {
    if (err instanceof LlmError) {
      throw new LauncherError('UNKNOWN', err.message, {
        title: 'The model could not read the crash',
        message: err.message.slice(0, 300),
        actions: ['Check the model works on the Companion screen', 'Then try again']
      })
    }
    throw err
  }

  let parsed: CrashAutopsy
  try {
    parsed = sanitise(extractJson(reply.content ?? ''), mods)
  } catch (err) {
    log.warn(`the model's answer was not usable: ${(err as Error).message}`)
    throw new LauncherError('UNKNOWN', 'unparseable model reply', {
      title: 'The model did not answer in a usable form',
      message:
        'It replied, but not with the structured diagnosis the launcher asked for. Smaller local models sometimes do this.',
      actions: ['Press "Explain this crash" again', 'Or try a larger model on the Companion screen']
    })
  }

  parsed.model = config.model
  return parsed
}
