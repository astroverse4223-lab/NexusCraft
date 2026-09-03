import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createLogger } from '../../core/logger'

const run = promisify(execFile)
const log = createLogger('vram')

/**
 * Whether a local model and the game will both fit on the graphics card.
 *
 * This became worth writing after watching it happen: an 8 GB card, a 5.2 GB
 * model, and a shader pack. Ollama loads the model into VRAM and keeps it
 * there; Minecraft then asks for what is left, and with shaders that is more
 * than remains. Nothing reports an error. The model silently spills into system
 * memory and answers ten times slower, the game stutters, and there is no
 * single place that says why — the launcher looks broken and so does the game.
 *
 * Everything here degrades to silence. A machine with no NVIDIA tools, an AMD
 * card, or an integrated GPU simply gets no warning, which is correct: a wrong
 * warning about hardware is worse than none.
 */

export interface VramReport {
  /** Total VRAM on the busiest card, in MB. Null when it cannot be read. */
  totalMb: number | null
  /** In use right now, in MB. */
  usedMb: number | null
  /** What a loaded model is holding, in MB, when one is loaded. */
  modelMb: number | null
  modelName: string | null
  /** Rough guess at what this instance wants, in MB. */
  gameMb: number
  /** True when the sum does not fit. */
  tight: boolean
  advice: string | null
}

/**
 * What Minecraft wants from the card.
 *
 * Approximate on purpose. The difference that matters is vanilla versus
 * shaders, which is roughly a factor of three, and no amount of precision
 * elsewhere changes the advice.
 */
export function estimateGameMb(hasShaders: boolean, renderDistance: number): number {
  const base = hasShaders ? 2600 : 900
  // Render distance moves it, but not as much as shaders do.
  return Math.round(base + Math.max(0, renderDistance - 8) * 60)
}

async function readNvidia(): Promise<{ totalMb: number; usedMb: number } | null> {
  try {
    const { stdout } = await run(
      'nvidia-smi',
      ['--query-gpu=memory.total,memory.used', '--format=csv,noheader,nounits'],
      { timeout: 4000, windowsHide: true }
    )
    const line = stdout.trim().split(/\r?\n/)[0]
    if (!line) return null
    const [total, used] = line.split(',').map((value) => Number(value.trim()))
    if (!Number.isFinite(total) || !Number.isFinite(used)) return null
    return { totalMb: total, usedMb: used }
  } catch {
    // No NVIDIA card, or no driver tools. Not an error.
    return null
  }
}

/**
 * What Ollama currently holds in VRAM.
 *
 * `/api/ps` lists loaded models rather than installed ones, which is the
 * question that matters: a 30 GB model on disk costs nothing until it is used.
 */
async function readLoadedModel(): Promise<{ name: string; mb: number } | null> {
  try {
    const response = await fetch('http://127.0.0.1:11434/api/ps', {
      signal: AbortSignal.timeout(1500)
    })
    if (!response.ok) return null
    const body = (await response.json()) as {
      models?: Array<{ name?: string; size_vram?: number; size?: number }>
    }
    const loaded = (body.models ?? [])[0]
    if (!loaded?.name) return null

    // size_vram is what is actually on the card; size includes what spilled.
    const bytes = loaded.size_vram ?? loaded.size ?? 0
    return { name: loaded.name, mb: Math.round(bytes / (1024 * 1024)) }
  } catch {
    return null
  }
}

export async function checkVramBudget(options: {
  hasShaders: boolean
  renderDistance: number
}): Promise<VramReport> {
  const gameMb = estimateGameMb(options.hasShaders, options.renderDistance)
  const [gpu, model] = await Promise.all([readNvidia(), readLoadedModel()])

  const report: VramReport = {
    totalMb: gpu?.totalMb ?? null,
    usedMb: gpu?.usedMb ?? null,
    modelMb: model?.mb ?? null,
    modelName: model?.name ?? null,
    gameMb,
    tight: false,
    advice: null
  }

  // Without a card reading there is nothing to compare against, and a guess
  // would be worse than staying quiet.
  if (gpu === null) return report

  /*
   * Measured against what is free rather than what is total. Something else is
   * usually already holding a slice of the card — a browser, the desktop — and
   * comparing to the total would call a comfortable setup tight.
   */
  const freeMb = gpu.totalMb - gpu.usedMb
  const headroomMb = 400

  if (gameMb + headroomMb <= freeMb) return report

  report.tight = true

  if (model) {
    const wouldFit = gameMb + headroomMb <= freeMb + model.mb
    report.advice = wouldFit
      ? `${model.name} is holding ${model.mb} MB of your ${gpu.totalMb} MB card. ` +
        `This instance wants about ${gameMb} MB and there is ${freeMb} MB free. ` +
        `A smaller model, or letting this one unload, would clear it.`
      : `${model.name} is holding ${model.mb} MB and this instance wants about ${gameMb} MB, ` +
        `which is more than the ${gpu.totalMb} MB card has either way. ` +
        `Turning shaders down is the bigger saving of the two.`
  } else {
    report.advice =
      `This instance wants about ${gameMb} MB and only ${freeMb} MB of the ` +
      `${gpu.totalMb} MB card is free. Something else is using it.`
  }

  log.info(`vram tight: free=${freeMb}MB game≈${gameMb}MB model=${model?.mb ?? 0}MB`)
  return report
}
