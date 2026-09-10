/**
 * Designing banners, and putting them where they are useful.
 *
 * Three outputs come out of one design: the banner block a player can hold, the
 * 64x64 icon the server shows in a server list, and a wide image for a listing
 * site. The drawing all happens in the renderer, where there is a canvas — this
 * file designs, validates, and writes files.
 *
 * The designing is done by whichever language model the user already configured
 * for a companion. That is deliberate: a picture generator would be a second
 * provider to set up and pay for, and it is not needed. A banner is a base
 * colour and up to six named layers, which is a thing any text model can pick.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'

import AdmZip from 'adm-zip'
import { join } from 'node:path'

import {
  designerPrompt,
  giveCommand,
  readDesign,
  supportsGive,
  type BannerBrain,
  type BannerDesign
} from '@shared/banners'

import { iconPrompt, readIconArt, type IconArt } from '@shared/icons'
import {
  fireworkPrompt,
  itemPrompt,
  logoPrompt,
  motdPrompt,
  motdToProperty,
  readFirework,
  readItem,
  readLogo,
  readMotd,
  readRecipes,
  recipePackFiles,
  recipePrompt,
  packNamespace,
  type FireworkDesign,
  type ItemDesign,
  type LogoDesign,
  type MotdDesign,
  type RecipePack,
  lootPool,
  lootPrompt,
  packMcmeta,
  readLoot,
  type LootPack
} from '@shared/creations'

import { chat, LlmError, type ChatMessage, type LlmConfig } from '../../companion/llm'
import { listCompanions } from '../companion/companionService'
import { getSecret } from '../auth/secureStore'
import {
  getHostedServer,
  getHostedServerConsole,
  hostedServerDir,
  isHostedServerRunning,
  saveHostedServer,
  sendHostedServerCommand
} from '../servers/hostService'
import {
  readRecipe as readTextureStyle,
  recipePrompt as texturePrompt,
  type TextureRecipe
} from '@shared/textureRecipe'
import { LauncherError } from '../../core/errors'
import { createLogger } from '../../core/logger'
import { packFormatOf } from '../content/datapackService'
import {
  advancementJson,
  advancementPrompt,
  readAdvancements,
  rootJson,
  type AdvancementPack
} from '@shared/advancements'
import { versionJarPath } from '../minecraft/versionService'
import { instanceSubdir } from '../instances/instanceService'
import { assertInside } from '../../core/paths'
import type { Instance } from '@shared/types'

const log = createLogger('banners')

/** Matches companionService's own naming for the encrypted key. */
const apiKeyName = (id: string): string => `companion-llm-key-${id}`

/* --------------------------------------------------------------- designers */

/**
 * The language models available to design with.
 *
 * Borrowed from the companions rather than configured again. Somebody who has
 * set up a companion has already chosen a provider, entered a key and picked a
 * model; asking for all of that a second time to draw a flag would be rude.
 */
export function bannerBrains(): BannerBrain[] {
  return listCompanions().map((companion) => {
    const local = /localhost|127\.0\.0\.1/.test(companion.baseUrl)
    const ready = Boolean(companion.model) && (local || companion.hasApiKey)

    let reason = ''
    if (!companion.model) reason = 'no model chosen for this companion yet'
    else if (!ready) reason = 'needs an API key on the AI Companion tab'

    return {
      id: companion.id,
      label: companion.username || 'Companion',
      provider: companion.provider,
      model: companion.model,
      ready,
      reason
    }
  })
}

function brainConfig(companionId: string): LlmConfig {
  const companion = listCompanions().find((c) => c.id === companionId)
  if (!companion) {
    throw new LauncherError('NOT_FOUND', 'no such companion', {
      title: 'That AI is not set up',
      message: 'Pick a different one, or configure it on the AI Companion tab.'
    })
  }

  return {
    baseUrl: companion.baseUrl,
    apiKey: getSecret(apiKeyName(companion.id)) ?? '',
    model: companion.model,
    timeoutMs: 120_000,
    /*
     * Enough room to think, and a stop to it.
     *
     * Measured, because both ends of this go wrong. Asked for a banner with 300
     * tokens, GLM returned empty `content` having spent the lot on
     * `reasoning_content` - a request that succeeded and said nothing. Asked
     * with no ceiling at all, it thinks past the timeout above and the answer
     * is thrown away. At three thousand it answers in seconds.
     */
    maxTokens: 3000
  }
}

/* ------------------------------------------------------------- the request */

export interface DesignRequest {
  prompt: string
  companionId: string
  /**
   * The design being changed, when this is a refinement rather than a fresh
   * request. Handed to the model as what it previously produced, so "make it
   * darker" has something to be darker than.
   */
  current?: unknown
}

/**
 * The conversation a design request is, which is two turns or four.
 *
 * A refinement is put as a real exchange - here is what you made, now change it
 * - rather than as one long instruction. Models follow an edit far better when
 * the thing being edited is something they appear to have said.
 */
function turns(system: string, wanted: string, current: unknown): ChatMessage[] {
  if (current === undefined || current === null) {
    return [
      { role: 'system', content: system },
      { role: 'user', content: wanted }
    ]
  }

  return [
    { role: 'system', content: system },
    { role: 'user', content: 'Design something.' },
    { role: 'assistant', content: JSON.stringify(current) },
    {
      role: 'user',
      content:
        `Change it: ${wanted}\n\n` +
        'Keep everything the change does not touch. Answer with the whole object again.'
    }
  ]
}

export interface DesignResult {
  design: BannerDesign
  /** Layers the model named that do not exist, so the UI can be honest. */
  dropped: string[]
  model: string
}

/**
 * Asks a model for a banner and returns one that can actually be rendered.
 *
 * Anything unparseable is a failure rather than a silent default: handing back
 * a plain white banner and calling it the design would look like the feature
 * working badly rather than the model not answering.
 */
export async function designBanner(request: DesignRequest): Promise<DesignResult> {
  const config = brainConfig(request.companionId)
  const wanted = request.prompt.trim().slice(0, 500)

  if (!wanted) {
    throw new LauncherError('INVALID_INPUT', 'no description given', {
      title: 'Describe the banner',
      message: 'Say what you want — "a red and gold shield", say — and try again.'
    })
  }

  let reply
  try {
    reply = await chat(
      config,
      [
        { role: 'system', content: designerPrompt() },
        { role: 'user', content: wanted }
      ],
      []
    )
  } catch (err) {
    if (err instanceof LlmError) {
      throw new LauncherError('NETWORK_ERROR', err.message, {
        title: 'The AI could not be reached',
        message: err.message
      })
    }
    throw err
  }

  const parsed = parseDesign(reply.content ?? '')
  if (!parsed) {
    log.warn(`no usable design in ${reply.content?.length ?? 0} characters from ${config.model}`)
    throw new LauncherError('NETWORK_ERROR', 'the model did not return a design', {
      title: 'That did not come back as a design',
      message: reply.content?.trim()
        ? 'The AI answered, but not with a banner. Try describing it differently.'
        : 'The AI returned nothing at all. A reasoning model can spend its whole budget thinking — try a plain model, or a shorter description.'
    })
  }

  if (parsed.dropped.length) {
    log.info(`dropped invented layers: ${parsed.dropped.join(', ')}`)
  }

  return { design: parsed.design, dropped: parsed.dropped, model: config.model }
}

/**
 * Finds the JSON in whatever the model said.
 *
 * Models wrap answers in code fences and preface them with "Here's a banner:"
 * however firmly they are asked not to, so the first balanced object in the
 * text is taken rather than the whole string being parsed.
 */
function parseDesign(content: string): { design: BannerDesign; dropped: string[] } | null {
  return readDesign(findJson(content))
}

/**
 * Finds the first balanced JSON object in whatever the model said.
 *
 * Models wrap answers in code fences and preface them with "Here's a banner:"
 * however firmly they are asked not to, so the first complete object is taken
 * rather than the whole string being parsed.
 */
function findJson(content: string): unknown {
  const text = content.replace(/```(?:json)?/gi, '').trim()
  if (!text) return null

  const start = text.indexOf('{')
  if (start < 0) return null

  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < text.length; i++) {
    const ch = text[i]

    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }

    if (ch === '"') inString = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1))
        } catch {
          return null
        }
      }
    }
  }

  return null
}

/* ------------------------------------------------------------ icon design */

export interface IconDesignResult {
  art: IconArt
  /** Shapes the model described that could not be read, so the UI can say so. */
  dropped: number
  model: string
}

/**
 * Asks a model to describe a server icon as shapes.
 *
 * Shapes rather than pixels, and that was measured rather than assumed. Asked
 * for a grid of palette letters, GLM spent its whole budget thinking and
 * returned nothing, and the local model produced thirty-three rows where
 * thirty-two were wanted, with letters missing from its own palette - nought
 * out of eight attempts usable. Asked for shapes, both providers produced a
 * usable icon every time.
 */
export async function designIcon(request: DesignRequest): Promise<IconDesignResult> {
  const config = brainConfig(request.companionId)
  const wanted = request.prompt.trim().slice(0, 500)

  if (!wanted) {
    throw new LauncherError('INVALID_INPUT', 'no description given', {
      title: 'Describe the icon',
      message: 'Say what you want on it — "a blue crystal on a dark background", say.'
    })
  }

  let reply
  try {
    reply = await chat(
      {
        ...config,
        /*
         * Far more room than the banner request needs.
         *
         * An icon is several shapes with coordinates, and a reasoning model
         * plans it before writing it. At 4,000 GLM returned empty content every
         * time; at 16,000 it answered on every attempt, taking 22 to 49 seconds.
         */
        maxTokens: 16_000
      },
      [
        { role: 'system', content: iconPrompt() },
        { role: 'user', content: wanted }
      ],
      []
    )
  } catch (err) {
    if (err instanceof LlmError) {
      throw new LauncherError('NETWORK_ERROR', err.message, {
        title: 'The AI could not be reached',
        message: err.message
      })
    }
    throw err
  }

  const parsed = readIconArt(findJson(reply.content ?? ''))
  if (!parsed) {
    log.warn(`no usable icon in ${reply.content?.length ?? 0} characters from ${config.model}`)
    throw new LauncherError('NETWORK_ERROR', 'the model did not return an icon', {
      title: 'That did not come back as an icon',
      message: reply.content?.trim()
        ? 'The AI answered, but not with shapes that could be drawn. Try describing it differently.'
        : 'The AI returned nothing at all. Try a shorter description, or a plain model rather than a reasoning one.'
    })
  }

  return { art: parsed.art, dropped: parsed.dropped, model: config.model }
}

/* ------------------------------------------------------ the other designers */

/**
 * One shape for every "describe it and get structured data back" request.
 *
 * They differ only in what they are told and what they accept, so the retry
 * behaviour, the empty-answer message and the token ceiling are written once.
 * The ceiling matters: a reasoning model with no limit thinks past the timeout
 * and the answer is thrown away, and with too small a limit it spends the whole
 * budget thinking and returns nothing at all.
 */
async function describe<T>(
  request: DesignRequest,
  what: string,
  system: string,
  read: (raw: unknown) => T | null,
  maxTokens: number
): Promise<{ result: T; model: string }> {
  const config = brainConfig(request.companionId)
  const wanted = request.prompt.trim().slice(0, 500)

  if (!wanted) {
    throw new LauncherError('INVALID_INPUT', 'no description given', {
      title: `Describe the ${what}`,
      message: 'Say what you want and try again.'
    })
  }

  let reply
  try {
    reply = await chat(
      { ...config, maxTokens },
      turns(system, wanted, request.current),
      []
    )
  } catch (err) {
    if (err instanceof LlmError) {
      throw new LauncherError('NETWORK_ERROR', err.message, {
        title: 'The AI could not be reached',
        message: err.message
      })
    }
    throw err
  }

  const result = read(findJson(reply.content ?? ''))
  if (!result) {
    log.warn(`no usable ${what} in ${reply.content?.length ?? 0} characters from ${config.model}`)
    throw new LauncherError('NETWORK_ERROR', `the model did not return a ${what}`, {
      title: `That did not come back as a ${what}`,
      message: reply.content?.trim()
        ? `The AI answered, but not with a ${what} that could be used. Try describing it differently.`
        : 'The AI returned nothing at all. Try a shorter description, or a plain model rather than a reasoning one.'
    })
  }

  return { result, model: config.model }
}

/**
 * A restyling recipe, from a description of how a pack should feel.
 *
 * A small answer - ten numbers - so the ceiling is low. The model is not
 * drawing anything here, it is choosing knobs, and a reasoning model given
 * room to plan a picture will use it and time out.
 */
export async function designRecipe(
  request: DesignRequest
): Promise<{ recipe: TextureRecipe; model: string }> {
  const { result, model } = await describe(
    request,
    'texture style',
    texturePrompt(),
    readTextureStyle,
    2_000
  )
  return { recipe: result, model }
}

export async function designMotd(
  request: DesignRequest
): Promise<{ design: MotdDesign; model: string }> {
  const { result, model } = await describe(request, 'MOTD', motdPrompt(), readMotd, 2_000)
  return { design: result, model }
}

export async function designLogo(
  request: DesignRequest
): Promise<{ design: LogoDesign; model: string }> {
  const { result, model } = await describe(request, 'logo', logoPrompt(), readLogo, 3_000)
  return { design: result, model }
}

export async function designFirework(
  request: DesignRequest
): Promise<{ design: FireworkDesign; dropped: number; model: string }> {
  const { result, model } = await describe(
    request,
    'firework',
    fireworkPrompt(),
    readFirework,
    4_000
  )
  return { design: result.design, dropped: result.dropped, model }
}

export async function designItem(
  request: DesignRequest
): Promise<{ design: ItemDesign; dropped: string[]; model: string }> {
  /*
   * The largest ceiling of the four, because the prompt itself is the largest -
   * it lists all forty-three enchantments and their level caps, which is the
   * only reliable way to stop a model inventing "sharpness_v".
   */
  const { result, model } = await describe(request, 'item', itemPrompt(), readItem, 6_000)
  return { design: result.design, dropped: result.dropped, model }
}

/**
 * Puts a designed firework or item in somebody's hands.
 *
 * Shares the version check with the banner command for the same reason: on a
 * server older than 1.20.5 the component syntax is accepted and quietly
 * produces a plain item, which is a wrong answer rather than an error.
 */
export async function giveDesigned(
  serverId: string,
  command: string
): Promise<GiveResult> {
  const server = getHostedServer(serverId)

  if (!supportsGive(server.minecraftVersion)) {
    throw new LauncherError('INVALID_INPUT', 'server too old for item components', {
      title: `Minecraft ${server.minecraftVersion} is too old for this`,
      message:
        'Items are described with components from 1.20.5 onwards. On an older server this command would hand out a plain one.'
    })
  }

  if (!isHostedServerRunning(server.id)) return { command, sent: false }

  const before = getHostedServerConsole(server.id).length
  sendHostedServerCommand(server.id, command)

  /*
   * Watch the console rather than assuming.
   *
   * Writing to a server's stdin always "works" - it is a pipe - so reporting
   * success from that told somebody their item had been handed over while the
   * server was refusing the command in a log they were not reading. The
   * refusal appears on the console within a tick or two, so the honest answer
   * is a moment away and worth waiting for.
   */
  return await waitForRefusal(server.id, command, before)
}

/**
 * The marker vanilla puts at the point a command stopped making sense.
 *
 * Every syntax error carries it, whatever the wording, which is what makes it
 * a better test than a list of phrases. The list came first and missed
 * "Expected ']'" - so a command the server had plainly rejected was still
 * reported as handed over, which is exactly the lie this was meant to end.
 */
const SYNTAX_MARKER = '<--[HERE]'

/** Refusals that are not syntax errors, so carry no marker. */
const REFUSALS = [
  'No player was found',
  'No entity was found',
  'Invalid name or UUID',
  'Unknown item',
  'Unknown enchantment',
  'Unknown or incomplete command',
  'Can only be used by a player',
  'That player does not exist'
]

async function waitForRefusal(
  serverId: string,
  command: string,
  before: number
): Promise<GiveResult> {
  // Long enough for the server to have answered, short enough that nobody
  // notices the button pausing.
  await new Promise((resolve) => setTimeout(resolve, 700))

  const lines = getHostedServerConsole(serverId)
    .slice(before)
    .map((line) => line.text)

  const said = lines.join('\n')

  const marker = said.includes(SYNTAX_MARKER) ? SYNTAX_MARKER : null
  const refusal = marker ?? REFUSALS.find((phrase) => said.includes(phrase))

  if (!refusal) return { command, sent: true }

  log.warn(`the server refused a generated command: ${refusal}`)

  /*
   * The line before the marker is the one worth reading.
   *
   * A syntax error is two lines: what was wrong, then the command with the
   * marker in it. Showing only the second is showing somebody their own
   * command back.
   */
  const at = lines.findIndex((line) => line.includes(refusal))
  const explanation = at > 0 && marker ? lines[at - 1] : lines[at]

  return { command, sent: false, refused: explanation }
}

/**
 * Writes the MOTD into the server's settings.
 *
 * Through `saveHostedServer` rather than by editing server.properties directly,
 * so it goes wherever the launcher already puts it and survives the next time
 * the launcher rewrites that file - which it does on every start.
 */
export function applyMotd(serverId: string, design: MotdDesign): { motd: string } {
  const server = getHostedServer(serverId)
  const motd = motdToProperty(design)

  saveHostedServer({ ...server, motd })
  log.info(`set the MOTD for ${server.name}`)

  return { motd }
}

/**
 * The same request, several times over.
 *
 * Run together rather than one after another: each is a small object taking a
 * few seconds, so four at once cost about what one does, and choosing between
 * four is a different thing from accepting or re-rolling one.
 *
 * A failure among them is dropped rather than failing the set. Getting three
 * good ideas back is a better outcome than getting an error because the fourth
 * model call timed out.
 */
export async function designMany<T>(
  count: number,
  one: () => Promise<T>
): Promise<{ results: T[]; asked: number }> {
  const asked = Math.max(1, Math.min(6, count))

  const settled = await Promise.allSettled(Array.from({ length: asked }, () => one()))

  const results = settled
    .filter((s): s is PromiseFulfilledResult<Awaited<T>> => s.status === 'fulfilled')
    .map((s) => s.value)

  if (results.length === 0) {
    const first = settled.find((s) => s.status === 'rejected')
    throw (first as PromiseRejectedResult | undefined)?.reason ??
      new LauncherError('NETWORK_ERROR', 'nothing came back', {
        title: 'Nothing came back',
        message: 'None of the attempts produced a design. Try again.'
      })
  }

  log.info(`${results.length} of ${asked} variations came back`)
  return { results, asked }
}

/* ----------------------------------------------------------------- recipes */

export async function designRecipes(
  request: DesignRequest
): Promise<{ pack: RecipePack; dropped: string[]; model: string }> {
  const { result, model } = await describe(
    request,
    'recipe pack',
    recipePrompt(),
    readRecipes,
    6_000
  )
  return { pack: result.pack, dropped: result.dropped, model }
}

/* -------------------------------------------------------------------- loot */

export async function designLoot(
  request: DesignRequest
): Promise<{ pack: LootPack; dropped: string[]; model: string }> {
  const { result, model } = await describe(request, 'loot pack', lootPrompt(), readLoot, 6_000)
  return { pack: result.pack, dropped: result.dropped, model }
}

/**
 * The vanilla loot table for a path, out of the client jar.
 *
 * Read rather than assumed, because overriding a loot table replaces it
 * outright - a pack that adds emeralds to zombies by writing a table with only
 * emeralds in it has also stopped zombies dropping rotten flesh, and nothing
 * anywhere says so. The vanilla pools are kept and the new ones appended.
 */
function vanillaLootTable(versionId: string, table: string): unknown | null {
  const jar = versionJarPath(versionId)
  if (!existsSync(jar)) return null

  try {
    const zip = new AdmZip(jar)

    // The folder was renamed in 1.21; both are tried so one version of this
    // works across the versions people actually have installed.
    for (const folder of ['loot_table', 'loot_tables']) {
      const entry = zip.getEntry(`data/minecraft/${folder}/${table}.json`)
      if (entry) return JSON.parse(entry.getData().toString('utf8'))
    }
  } catch (err) {
    log.warn(`could not read ${table} from ${versionId}.jar: ${(err as Error).message}`)
  }

  return null
}

export interface LootBuild {
  files: { path: string; content: string }[]
  packFormat: number
  /** Rules left out because the vanilla table could not be read. */
  skipped: string[]
}

/**
 * Every file the loot pack needs.
 *
 * A rule whose vanilla table cannot be found is left out rather than written
 * as a replacement. Being told a rule was skipped is a small annoyance; having
 * a mob silently stop dropping what it always dropped is a bug somebody spends
 * an evening on.
 */
export function buildLootPack(pack: LootPack, versionId: string): LootBuild {
  const packFormat = packFormatOf(versionId)
  const namespace = packNamespace(pack.name)

  const files: { path: string; content: string }[] = [
    { path: 'pack.mcmeta', content: JSON.stringify(packMcmeta(packFormat, pack.name), null, 2) }
  ]

  const skipped: string[] = []

  for (const rule of pack.rules) {
    const base = vanillaLootTable(versionId, rule.table) as
      | { pools?: unknown[] }
      | null

    if (!base) {
      skipped.push(`${rule.id}: no vanilla ${rule.table} to add to`)
      continue
    }

    const merged = {
      ...base,
      pools: [...(Array.isArray(base.pools) ? base.pools : []), ...rule.drops.map(lootPool)]
    }

    // Written under minecraft, which is what makes it an override of the
    // vanilla table rather than a new one nothing refers to.
    for (const folder of ['loot_table', 'loot_tables']) {
      files.push({
        path: `data/minecraft/${folder}/${rule.table}.json`,
        content: JSON.stringify(merged, null, 2)
      })
    }
  }

  log.info(`built loot pack "${namespace}" (${files.length} files, ${skipped.length} skipped)`)
  return { files, packFormat, skipped }
}

function writeLootZip(pack: LootPack, built: LootBuild, output: string): void {
  const zip = new AdmZip()
  for (const file of built.files) zip.addFile(file.path, Buffer.from(file.content, 'utf8'))
  zip.writeZip(output)
}

export interface LootInstallResult extends RecipeInstallResult {
  skipped: string[]
}

export async function installLootPack(
  serverId: string,
  pack: LootPack
): Promise<LootInstallResult> {
  const server = getHostedServer(serverId)
  const dir = hostedServerDir(server.id)

  const built = buildLootPack(pack, server.minecraftVersion)

  const world = worldFolderOf(dir)
  const target = join(dir, world, 'datapacks')
  await mkdir(target, { recursive: true })

  const output = join(target, `${packNamespace(pack.name)}.zip`)
  writeLootZip(pack, built, output)

  const running = isHostedServerRunning(server.id)
  if (running) sendHostedServerCommand(server.id, 'reload confirm')

  return {
    path: output,
    fileCount: built.files.length,
    packFormat: built.packFormat,
    world,
    reloadNeeded: running,
    skipped: built.skipped
  }
}

export async function installLootPackIntoWorld(
  instance: Instance,
  worldFolder: string,
  pack: LootPack
): Promise<LootInstallResult> {
  const saves = instanceSubdir(instance, 'saves')
  const world = assertInside(saves, join(saves, worldFolder))

  if (!existsSync(world)) {
    throw new LauncherError('NOT_FOUND', `world ${worldFolder} does not exist`, {
      title: 'That world no longer exists',
      message: 'The world you chose has been deleted or renamed.',
      actions: ['Pick a different world']
    })
  }

  const built = buildLootPack(pack, instance.minecraftVersion)

  const target = join(world, 'datapacks')
  await mkdir(target, { recursive: true })

  const output = join(target, `${packNamespace(pack.name)}.zip`)
  writeLootZip(pack, built, output)

  return {
    path: output,
    fileCount: built.files.length,
    packFormat: built.packFormat,
    world: worldFolder,
    reloadNeeded: false,
    skipped: built.skipped
  }
}

export async function exportLootPack(
  path: string,
  pack: LootPack,
  minecraftVersion: string
): Promise<{ path: string; packFormat: number; skipped: string[] }> {
  const built = buildLootPack(pack, minecraftVersion)
  writeLootZip(pack, built, path)

  return { path, packFormat: built.packFormat, skipped: built.skipped }
}

/* ------------------------------------------------------------ advancements */

export async function designAdvancements(
  request: DesignRequest
): Promise<{ pack: AdvancementPack; dropped: string[]; model: string }> {
  const { result, model } = await describe(
    request,
    'advancement pack',
    advancementPrompt(),
    readAdvancements,
    6_000
  )
  return { pack: result.pack, dropped: result.dropped, model }
}

/**
 * Every file the pack needs, root included.
 *
 * The root is written here rather than asked of the model, because it is not a
 * design decision - it is the thing that makes the others one tab in the menu
 * instead of a dozen tabs holding one entry each.
 */
export function buildAdvancementPack(
  pack: AdvancementPack,
  versionId: string
): { files: { path: string; content: string }[]; packFormat: number } {
  const packFormat = packFormatOf(versionId)
  const namespace = packNamespace(pack.name)

  const files = [
    { path: 'pack.mcmeta', content: JSON.stringify(packMcmeta(packFormat, pack.name), null, 2) },
    {
      path: `data/${namespace}/advancement/root.json`,
      content: rootJson(pack.name, pack.advancements[0]?.icon ?? 'grass_block')
    }
  ]

  for (const design of pack.advancements) {
    files.push({
      path: `data/${namespace}/advancement/${design.id}.json`,
      content: advancementJson(design, namespace, 'root')
    })
  }

  return { files, packFormat }
}

function writePackZip(files: { path: string; content: string }[], output: string): void {
  const zip = new AdmZip()
  for (const file of files) zip.addFile(file.path, Buffer.from(file.content, 'utf8'))
  zip.writeZip(output)
}

export async function installAdvancementPack(
  serverId: string,
  pack: AdvancementPack
): Promise<RecipeInstallResult> {
  const server = getHostedServer(serverId)
  const dir = hostedServerDir(server.id)

  const built = buildAdvancementPack(pack, server.minecraftVersion)

  const world = worldFolderOf(dir)
  const target = join(dir, world, 'datapacks')
  await mkdir(target, { recursive: true })

  const output = join(target, `${packNamespace(pack.name)}.zip`)
  writePackZip(built.files, output)

  const running = isHostedServerRunning(server.id)
  if (running) sendHostedServerCommand(server.id, 'reload confirm')

  return {
    path: output,
    fileCount: built.files.length,
    packFormat: built.packFormat,
    world,
    reloadNeeded: running
  }
}

export async function installAdvancementPackIntoWorld(
  instance: Instance,
  worldFolder: string,
  pack: AdvancementPack
): Promise<RecipeInstallResult> {
  const saves = instanceSubdir(instance, 'saves')
  const world = assertInside(saves, join(saves, worldFolder))

  if (!existsSync(world)) {
    throw new LauncherError('NOT_FOUND', `world ${worldFolder} does not exist`, {
      title: 'That world no longer exists',
      message: 'The world you chose has been deleted or renamed.',
      actions: ['Pick a different world']
    })
  }

  const built = buildAdvancementPack(pack, instance.minecraftVersion)

  const target = join(world, 'datapacks')
  await mkdir(target, { recursive: true })

  const output = join(target, `${packNamespace(pack.name)}.zip`)
  writePackZip(built.files, output)

  return {
    path: output,
    fileCount: built.files.length,
    packFormat: built.packFormat,
    world: worldFolder,
    reloadNeeded: false
  }
}

export async function exportAdvancementPack(
  path: string,
  pack: AdvancementPack,
  minecraftVersion: string
): Promise<{ path: string; packFormat: number }> {
  const built = buildAdvancementPack(pack, minecraftVersion)
  writePackZip(built.files, path)

  return { path, packFormat: built.packFormat }
}

/** Which folder the server keeps its world in. */
export function worldFolderOf(dir: string): string {
  try {
    const properties = readFileSync(join(dir, 'server.properties'), 'utf8')
    const named = /^level-name\s*=\s*(.+)$/m.exec(properties)
    const name = named?.[1]?.trim()

    // A level-name that tries to climb out of the server folder is not a name.
    if (name && !name.includes('/') && !name.includes('\\') && name !== '..') return name
  } catch {
    /* No properties file yet, which means the default. */
  }
  return 'world'
}

export interface RecipeInstallResult {
  path: string
  fileCount: number
  packFormat: number
  world: string
  /** True when the server is up and has to be told to reload. */
  reloadNeeded: boolean
}

/**
 * Writes the pack into the server's world.
 *
 * A datapack is read when the world loads, so a running server has to be told
 * to reload before it notices - which it is, rather than leaving somebody
 * wondering why their new recipe does not craft.
 */
export async function installRecipePack(
  serverId: string,
  pack: RecipePack
): Promise<RecipeInstallResult> {
  const server = getHostedServer(serverId)
  const dir = hostedServerDir(server.id)

  const packFormat = packFormatOf(server.minecraftVersion)
  const files = recipePackFiles(pack, packFormat)

  const world = worldFolderOf(dir)
  const target = join(dir, world, 'datapacks')
  await mkdir(target, { recursive: true })

  const output = join(target, `${packNamespace(pack.name)}.zip`)

  const zip = new AdmZip()
  for (const file of files) zip.addFile(file.path, Buffer.from(file.content, 'utf8'))
  zip.writeZip(output)

  const running = isHostedServerRunning(server.id)
  if (running) sendHostedServerCommand(server.id, 'reload confirm')

  log.info(
    `wrote ${files.length} files to ${output} (pack_format ${packFormat})`
  )

  return { path: output, fileCount: files.length, packFormat, world, reloadNeeded: running }
}

/**
 * Writes the pack into a singleplayer world.
 *
 * The other install goes to a hosted server. Both existed because the tab only
 * ever offered servers - so somebody testing in singleplayer installed to a
 * server of a similar name, went looking in their own world, and found the
 * recipes missing with nothing anywhere saying why.
 */
export async function installRecipePackIntoWorld(
  instance: Instance,
  worldFolder: string,
  pack: RecipePack
): Promise<RecipeInstallResult> {
  const saves = instanceSubdir(instance, 'saves')
  const world = assertInside(saves, join(saves, worldFolder))

  if (!existsSync(world)) {
    throw new LauncherError('NOT_FOUND', `world ${worldFolder} does not exist`, {
      title: 'That world no longer exists',
      message: 'The world you chose has been deleted or renamed.',
      actions: ['Pick a different world']
    })
  }

  const packFormat = packFormatOf(instance.minecraftVersion)
  const files = recipePackFiles(pack, packFormat)

  const target = join(world, 'datapacks')
  await mkdir(target, { recursive: true })

  const output = join(target, `${packNamespace(pack.name)}.zip`)

  const zip = new AdmZip()
  for (const file of files) zip.addFile(file.path, Buffer.from(file.content, 'utf8'))
  zip.writeZip(output)

  log.info(`wrote ${files.length} files to ${output} (pack_format ${packFormat})`)

  /*
   * A singleplayer world is never running, so nothing is reloaded - but the
   * world does have to be re-entered, which the caller says out loud.
   */
  return { path: output, fileCount: files.length, packFormat, world: worldFolder, reloadNeeded: false }
}

/** Saves the pack wherever the user chooses, for a world the launcher does not run. */
export async function exportRecipePack(
  path: string,
  pack: RecipePack,
  minecraftVersion: string
): Promise<{ path: string; packFormat: number }> {
  const packFormat = packFormatOf(minecraftVersion)

  const zip = new AdmZip()
  for (const file of recipePackFiles(pack, packFormat)) {
    zip.addFile(file.path, Buffer.from(file.content, 'utf8'))
  }
  zip.writeZip(path)

  return { path, packFormat }
}

/* ----------------------------------------------------------------- outputs */

/** Turns a canvas data URL back into the bytes it encodes. */
function fromDataUrl(dataUrl: string): Buffer {
  const comma = dataUrl.indexOf(',')
  if (!dataUrl.startsWith('data:image/png') || comma < 0) {
    throw new LauncherError('INVALID_INPUT', 'not a PNG data URL', {
      title: 'That image could not be read',
      message: 'The preview did not produce a PNG.'
    })
  }
  return Buffer.from(dataUrl.slice(comma + 1), 'base64')
}

export interface IconResult {
  path: string
  /** True when the server is up, and so will not show it until it restarts. */
  restartNeeded: boolean
}

/**
 * Writes the server's icon.
 *
 * Minecraft reads `server-icon.png` once, at startup, and insists on 64x64 —
 * the renderer draws it at exactly that size. Writing it while the server is
 * running is allowed and harmless; it simply will not be seen until a restart,
 * which the caller is told rather than left to wonder about.
 */
export async function applyServerIcon(serverId: string, png: string): Promise<IconResult> {
  const server = getHostedServer(serverId)
  const bytes = fromDataUrl(png)
  const path = join(hostedServerDir(server.id), 'server-icon.png')

  await writeFile(path, bytes)
  log.info(`wrote a ${bytes.length}-byte icon for ${server.name}`)

  return { path, restartNeeded: isHostedServerRunning(server.id) }
}

/** Saves a rendered image wherever the user chose. */
export async function saveBannerImage(path: string, png: string): Promise<string> {
  await writeFile(path, fromDataUrl(png))
  return path
}

export interface GiveResult {
  command: string
  sent: boolean
  /** What the server said, when it would not run it. */
  refused?: string
}

/**
 * Puts the banner in a player's hands on a running server.
 *
 * The command uses item components, which arrived in 1.20.5. On an older server
 * it would be accepted and produce a plain undecorated banner — a silent wrong
 * answer — so the version is checked first and the command is handed back for
 * the user to run themselves rather than sent.
 */
export async function giveBanner(
  serverId: string,
  target: string,
  design: BannerDesign
): Promise<GiveResult> {
  const server = getHostedServer(serverId)
  const command = giveCommand(design, target.trim() || '@a')

  if (!supportsGive(server.minecraftVersion)) {
    throw new LauncherError('INVALID_INPUT', 'server too old for banner components', {
      title: `Minecraft ${server.minecraftVersion} is too old for this`,
      message:
        'Banner items are described with components from 1.20.5 onwards. On an older server this command would hand out a plain banner instead of the design.'
    })
  }

  if (!isHostedServerRunning(server.id)) {
    return { command, sent: false }
  }

  /*
   * Watched, like the item give is.
   *
   * This one still reported success from the fact that a write to a pipe
   * worked - so a banner handed to a target the server would not accept was
   * announced as handed over, and the only sign otherwise was a line in a log.
   */
  const before = getHostedServerConsole(server.id).length
  sendHostedServerCommand(server.id, command)

  return await waitForRefusal(server.id, command, before)
}
