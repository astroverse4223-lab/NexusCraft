/**
 * Runs the AI companions.
 *
 * The launcher used to hold exactly one bot — a single child process and a
 * single settings document — so starting a second replaced the first. Everything
 * here is now keyed by companion id instead, which is what lets a local Ollama
 * model and a hosted GLM one play in the same world at the same time and be
 * compared side by side.
 *
 * Each companion owns its process, its event feed, its memory and its API key.
 * They share nothing but the bot script.
 */

import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { app } from 'electron'
import type { BlueprintSummary,
  BuildRecord,
  CompanionUsage,
  BuildSummary,
  Companion,
  CompanionConfig,
  CompanionEvent,
  CompanionInbound,
  CompanionOutbound,
  CompanionSettings,
  CompanionState,
  CrewSnapshot
} from '@shared/companion'
import { DEFAULT_PERSONALITY } from '@shared/companion'
import { db } from '../../core/database'
import { emit } from '../../core/events'
import { notifyDesktop } from '../../core/notifications'
import { LauncherError } from '../../core/errors'
import { createLogger } from '../../core/logger'
import { getSecret, setSecret, removeSecret } from '../auth/secureStore'

const log = createLogger('companion')

const PROFILES_KEY = 'companion-profiles'
/** Pre-multi-companion storage, migrated into a single profile on first read. */
const LEGACY_SETTINGS_KEY = 'companion-settings'
const LEGACY_MEMORY_KEY = 'companion-memory'
const LEGACY_API_KEY = 'companion-llm-key'
const MAX_EVENTS = 400
const MAX_MEMORY = 60

const apiKeyName = (id: string): string => `companion-llm-key-${id}`
const memoryKey = (id: string): string => `companion-memory-${id}`

/* ------------------------------------------------------------- profiles */

function defaults(): CompanionSettings {
  return {
    provider: 'ollama',
    baseUrl: 'http://localhost:11434/v1',
    model: 'llama3.1',
    host: 'localhost',
    port: 25565,
    username: 'Companion',
    auth: 'offline',
    version: '',
    owner: '',
    personality: DEFAULT_PERSONALITY,
    autonomy: true,
    idleIntervalSec: 45,
    toolSet: 'full',
    pricePerMillionTokens: 0,
    sentinel: false,
    routine: '',
    stewardOf: '',
    hasApiKey: false
  }
}

function readProfiles(): Companion[] {
  const raw = db().kvGet(PROFILES_KEY)

  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Companion[]
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((p) => ({ ...defaults(), ...p, hasApiKey: Boolean(getSecret(apiKeyName(p.id))) }))
      }
    } catch {
      /* fall through and rebuild from the legacy document */
    }
  }

  /*
   * Migration. A user upgrading from the single-companion build keeps their
   * settings, their saved key and their bot's memory — losing any of those on
   * upgrade would be a poor trade for a feature they did not ask for yet.
   */
  const legacy = db().kvGet(LEGACY_SETTINGS_KEY)
  const id = randomUUID()
  let settings = defaults()
  if (legacy) {
    try {
      settings = { ...settings, ...(JSON.parse(legacy) as Partial<CompanionSettings>) }
    } catch {
      /* keep the defaults */
    }
  }

  const migrated: Companion = { ...settings, id, hasApiKey: false }

  const oldKey = getSecret(LEGACY_API_KEY)
  if (oldKey) {
    setSecret(apiKeyName(id), oldKey)
    // Only drop the old copy once the new one reads back. Deleting first would
    // lose the user's API key outright if the encrypted write failed quietly.
    if (getSecret(apiKeyName(id)) === oldKey) {
      removeSecret(LEGACY_API_KEY)
      migrated.hasApiKey = true
    } else {
      log.warn('could not copy the saved API key into the new profile; leaving the original in place')
    }
  }

  const oldMemory = db().kvGet(LEGACY_MEMORY_KEY)
  if (oldMemory) db().kvSet(memoryKey(id), oldMemory)

  writeProfiles([migrated])
  if (legacy) log.info('migrated the existing companion into a profile')
  return [migrated]
}

function writeProfiles(profiles: Companion[]): void {
  db().kvSet(PROFILES_KEY, JSON.stringify(profiles.map((p) => ({ ...p, hasApiKey: undefined }))))
}

/**
 * Minecraft usernames are 3 to 16 characters of letters, digits and
 * underscores. Anything else is refused by the server with a raw
 * `IllegalStateException: Invalid characters in username`, which reaches the
 * user as a disconnect that looks like a crash rather than a settings mistake.
 */
const VALID_USERNAME = /^[A-Za-z0-9_]{3,16}$/

function assertUsableUsername(username: string): void {
  if (VALID_USERNAME.test(username)) return

  const cleaned = username.replace(/[^A-Za-z0-9_]/g, '').slice(0, 16)
  throw new LauncherError('INVALID_INPUT', `"${username}" is not a valid Minecraft username`, {
    title: 'That bot username will not work',
    message:
      'Minecraft usernames are 3 to 16 characters long and may only contain letters, numbers and underscores. A server refuses anything else and drops the connection without explaining why.',
    actions: cleaned.length >= 3 ? [`Try "${cleaned}"`] : ['Pick a name of at least 3 letters or digits']
  })
}

export function listCompanions(): Companion[] {
  return readProfiles()
}

export function getCompanion(id: string): Companion {
  const found = readProfiles().find((p) => p.id === id)
  if (!found) throw new LauncherError('NOT_FOUND', `companion ${id} does not exist`)
  return found
}

export function createCompanion(name?: string): Companion {
  const profiles = readProfiles()
  const id = randomUUID()

  // A distinct in-game name matters: two bots cannot join under one username.
  const taken = new Set(profiles.map((p) => p.username.toLowerCase()))
  // Strip anything a server would reject before it can ever be saved.
  const base = (name ?? 'Companion').replace(/[^A-Za-z0-9_]/g, '') || 'Companion'
  let username = base.slice(0, 16)
  let suffix = 2
  while (taken.has(username.toLowerCase())) username = `${base.slice(0, 14)}${suffix++}`
  if (username.length < 3) username = `Companion${suffix}`

  const created: Companion = { ...defaults(), id, username }
  writeProfiles([...profiles, created])
  emit('companion:list', listCompanions())
  log.info(`created companion ${username}`)
  return created
}

export function deleteCompanion(id: string): void {
  if (running.has(id)) stopCompanion(id)
  const profiles = readProfiles().filter((p) => p.id !== id)
  writeProfiles(profiles)
  removeSecret(apiKeyName(id))
  db().kvSet(memoryKey(id), JSON.stringify([]))
  emit('companion:list', listCompanions())
}

export function updateCompanion(id: string, patch: Partial<CompanionSettings> & { apiKey?: string }): Companion {
  const profiles = readProfiles()
  const index = profiles.findIndex((p) => p.id === id)
  if (index < 0) throw new LauncherError('NOT_FOUND', `companion ${id} does not exist`)

  const current = profiles[index]
  const next: Companion = { ...current }

  // The key never goes into the settings document — it lives in the OS-encrypted
  // store alongside the Microsoft refresh token.
  if (typeof patch.apiKey === 'string') {
    if (patch.apiKey.trim()) setSecret(apiKeyName(id), patch.apiKey.trim())
    else removeSecret(apiKeyName(id))
  }

  for (const [key, value] of Object.entries(patch)) {
    if (key === 'apiKey' || key === 'hasApiKey' || key === 'id') continue
    if (!(key in current)) continue
    const typed = key as keyof CompanionSettings
    if (typeof value !== typeof current[typed]) continue
    if (typeof value === 'number') {
      ;(next[typed] as unknown) = Math.round(value)
    } else if (typeof value === 'string') {
      ;(next[typed] as unknown) = value.slice(0, 4000)
    } else {
      ;(next[typed] as unknown) = value
    }
  }

  next.port = Math.min(Math.max(next.port, 1), 65535)
  next.idleIntervalSec = Math.min(Math.max(next.idleIntervalSec, 10), 600)
  next.hasApiKey = Boolean(getSecret(apiKeyName(id)))

  // Refuse at the point of saving, where it can be explained, rather than at
  // connection time where it surfaces as an unexplained disconnect.
  assertUsableUsername(next.username.trim())
  next.username = next.username.trim()

  profiles[index] = next
  writeProfiles(profiles)
  emit('companion:list', listCompanions())

  // A live bot picks up personality and autonomy changes without reconnecting.
  const entry = running.get(id)
  if (entry) {
    post(id, {
      type: 'configure',
      autonomy: next.autonomy,
      personality: next.personality,
      idleIntervalSec: next.idleIntervalSec
    })
  }

  return next
}

/* --------------------------------------------------------------- memory */

function loadMemory(id: string): string[] {
  const raw = db().kvGet(memoryKey(id))
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as string[]
    return Array.isArray(parsed) ? parsed.slice(-MAX_MEMORY) : []
  } catch {
    return []
  }
}

function saveMemory(id: string, notes: string[]): void {
  db().kvSet(memoryKey(id), JSON.stringify(notes.slice(-MAX_MEMORY)))
}

/* ---------------------------------------------------------------- state */

interface Running {
  child: ChildProcess
  state: Omit<CompanionState, 'alive'>
  eventId: number
}

const running = new Map<string, Running>()

function blankState(id: string): Omit<CompanionState, 'alive'> {
  return {
    companionId: id,
    status: 'idle',
    detail: '',
    goal: null,
    memory: loadMemory(id),
    events: [],
    connectedVersion: null
  }
}

export function getCompanionState(id: string): CompanionState {
  const entry = running.get(id)
  const base = entry?.state ?? blankState(id)
  // `alive` is read from the process rather than stored, so it cannot drift
  // out of step with `status` the way a duplicated flag would.
  return { ...base, alive: running.has(id), memory: [...base.memory], events: [...base.events] }
}

export function allCompanionStates(): CompanionState[] {
  return listCompanions().map((c) => getCompanionState(c.id))
}

export function isCompanionRunning(id: string): boolean {
  return running.has(id)
}

/** Terminates a bot process without waiting for it to acknowledge. */
function killChild(id: string, immediate = false): void {
  const entry = running.get(id)
  if (!entry) return
  entry.child.removeAllListeners()

  /*
   * When the launcher itself is closing there is no time to be polite.
   *
   * The courteous logout below waits a moment for the companion to disconnect
   * cleanly, which is right when someone presses Stop. At shutdown it is not:
   * the wait keeps a live child and a pending timer attached to a process that
   * is supposed to be going away, and an installer trying to close the app sees
   * one that will not close.
   */
  if (immediate) {
    try {
      entry.child.kill()
    } catch {
      /* already gone */
    }
    running.delete(id)
    return
  }

  /*
   * Ask the companion to log out rather than killing it where it stands.
   *
   * A bare kill() sends no disconnect, so the server keeps the player in the
   * world until the connection times out — long enough for anything hostile
   * nearby to kill it and scatter its inventory across the ground. Stopping a
   * companion should not cost it everything it was carrying.
   */
  try {
    entry.child.send({ type: 'stop' })
  } catch {
    /* channel already closed; the kill below still applies */
  }

  // Not a moment longer than it takes to say goodbye.
  const forceQuit = setTimeout(() => {
    try {
      entry.child.kill()
    } catch {
      /* already gone */
    }
  }, 1_500)

  entry.child.once('exit', () => clearTimeout(forceQuit))
  running.delete(id)
}

function setStatus(id: string, status: CompanionState['status'], detail: string): void {
  const entry = running.get(id)
  if (entry) {
    entry.state.status = status
    entry.state.detail = detail
  }
  emitStatus(id)
}

/** Single place that publishes status, so `alive` can never be left out. */
function emitStatus(id: string): void {
  const s = getCompanionState(id)
  emit('companion:status', {
    companionId: id,
    status: s.status,
    detail: s.detail,
    goal: s.goal,
    connectedVersion: s.connectedVersion,
    alive: s.alive
  })
}

function pushEvent(
  id: string,
  kind: CompanionEvent['kind'],
  text: string,
  extra: Partial<CompanionEvent> = {}
): void {
  const entry = running.get(id)
  if (!entry) return
  const event: CompanionEvent = {
    id: ++entry.eventId,
    companionId: id,
    at: Date.now(),
    kind,
    text,
    ...extra
  }
  entry.state.events.push(event)
  if (entry.state.events.length > MAX_EVENTS) entry.state.events.shift()
  emit('companion:event', event)
}

function post(id: string, message: CompanionInbound): void {
  try {
    running.get(id)?.child.send(message)
  } catch (err) {
    log.warn(`could not talk to companion ${id}: ${(err as Error).message}`)
  }
}

function botScriptPath(): string {
  return app.isPackaged
    ? join(app.getAppPath(), 'out', 'main', 'bot.js')
    : join(app.getAppPath(), 'out', 'main', 'bot.js')
}

/* ---------------------------------------------------------------- start */

export function startCompanion(id: string): CompanionState {
  const settings = getCompanion(id)

  // The running total carries over; "this session" starts again from zero.
  startUsageSession(id)

  /*
   * Start means "start a working companion", so a process that is present but
   * not playing is reaped rather than treated as a conflict. Refusing here
   * used to strand the user: a bot that failed to connect stayed alive, the
   * screen offered Start because the status was `error`, and every press was
   * rejected as "already connected" with no Stop button in sight.
   */
  const existing = running.get(id)
  if (existing && existing.state.status !== 'playing' && existing.state.status !== 'connecting') {
    log.info(`replacing a ${settings.username} process that is not playing`)
    killChild(id)
  }

  if (running.has(id)) {
    throw new LauncherError('ALREADY_RUNNING', 'that companion is already connected', {
      title: `${settings.username} is already running`,
      message: 'Stop it before starting it again.',
      actions: ['Press Stop, then Start']
    })
  }

  // Two bots cannot hold the same name on one server, and the second is kicked.
  const clash = listCompanions().find(
    (c) => c.id !== id && running.has(c.id) && c.username.toLowerCase() === settings.username.toLowerCase()
  )
  if (clash) {
    throw new LauncherError('INVALID_INPUT', `username ${settings.username} is already in use`, {
      title: 'Two companions cannot share a name',
      message: `${clash.username} is already connected under that username, and the server would kick whichever joined second.`,
      actions: ['Give this one a different bot username in its settings']
    })
  }

  assertUsableUsername(settings.username.trim())

  const apiKey = getSecret(apiKeyName(id)) ?? ''

  /*
   * A model is only needed by a companion that thinks.
   *
   * A scripted worker follows a routine and never calls a model at all — that
   * is the whole point of routines, and of the crews built on them. Demanding
   * an endpoint and a model name before it could start contradicted the
   * interface, which offers routines as the option that needs neither.
   */
  if (!settings.routine.trim()) {
    if (!settings.baseUrl.trim()) {
      throw new LauncherError('INVALID_INPUT', 'no model endpoint configured', {
        title: 'No model endpoint set',
        message: 'The companion needs somewhere to send its decisions — a local Ollama server or a hosted API.',
        actions: [
          'Choose a provider in the Companion screen',
          'Ollama runs locally and needs no key',
          'Or set it to follow a routine, which needs no model at all'
        ]
      })
    }
    if (!settings.model.trim()) {
      throw new LauncherError('INVALID_INPUT', 'no model selected', {
        title: 'No model chosen',
        message:
          'Choose the model to use. Press Load models to see what your endpoint serves rather than typing a name.',
        actions: ['Set a model name in the Companion screen', 'Or set it to follow a routine, which needs no model']
      })
    }
  }

  const config: CompanionConfig = {
    host: settings.host,
    port: settings.port,
    username: settings.username,
    auth: settings.auth,
    version: settings.version,
    owner: settings.owner,
    personality: settings.personality,
    autonomy: settings.autonomy,
    idleIntervalSec: settings.idleIntervalSec,
    sentinel: settings.sentinel ?? false,
    toolSet: settings.toolSet ?? 'full',
    llm: { baseUrl: settings.baseUrl, apiKey, model: settings.model, timeoutMs: 90_000 },
    memory: loadMemory(id),
    // Empty means think with the model; a name makes it a scripted worker.
    routine: settings.routine ?? ''
  }

  const script = botScriptPath()
  if (!existsSync(script)) {
    throw new LauncherError('NOT_FOUND', `bot script missing at ${script}`, {
      title: 'The companion bot is missing from this build',
      message: 'The bot runs from a separate bundled script which could not be found.',
      actions: ['Rebuild the launcher with npm run build']
    })
  }

  // ELECTRON_RUN_AS_NODE turns the Electron binary into a plain Node runtime,
  // which is how the bot gets a Node process without shipping a second one.
  const env: Record<string, string | undefined> = { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  delete env.NODE_OPTIONS

  // 'ipc' in the stdio list is what gives us process.send in both directions.
  const child = spawn(process.execPath, [script], {
    env,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    windowsHide: true
  })

  running.set(id, {
    child,
    state: { ...blankState(id), memory: config.memory ?? [] },
    eventId: 0
  })

  child.stdout?.on('data', (chunk: Buffer) => log.debug(`${settings.username}: ${chunk.toString().trim()}`))
  child.stderr?.on('data', (chunk: Buffer) => log.warn(`${settings.username}: ${chunk.toString().trim()}`))

  child.on('message', (message: CompanionOutbound) => handleMessage(id, message))

  child.on('exit', (code) => {
    const wasError = running.get(id)?.state.status === 'error'
    running.delete(id)
    if (!wasError) {
      emit('companion:status', {
        companionId: id,
        status: 'idle',
        detail: code === 0 ? 'stopped' : `bot exited with code ${code}`,
        goal: null,
        connectedVersion: null,
        alive: false
      })
    }
    log.info(`${settings.username} exited with code ${code}`)
  })

  child.on('error', (err) => {
    running.delete(id)
    emit('companion:status', {
      companionId: id,
      status: 'error',
      detail: err.message,
      goal: null,
      connectedVersion: null,
      alive: false
    })
  })

  setStatus(id, 'connecting', `${settings.host}:${settings.port}`)
  pushEvent(id, 'status', `Connecting to ${settings.host}:${settings.port} as ${settings.username}…`)
  post(id, { type: 'start', config })

  log.info(`${settings.username} starting -> ${settings.host}:${settings.port} (model ${settings.model})`)
  return getCompanionState(id)
}

function handleMessage(id: string, message: CompanionOutbound): void {
  const entry = running.get(id)
  if (!entry) return

  switch (message.type) {
    case 'status':
      setStatus(id, message.status, message.detail)
      pushEvent(id, message.status === 'error' ? 'error' : 'status', message.detail || message.status)
      if (message.status === 'playing') {
        const version = message.detail.match(/on ([\d.]+\w*)/)?.[1] ?? null
        if (version) entry.state.connectedVersion = version
        // Now that it is in the world, tell it who else is.
        void import('./crewService').then(({ refreshFor, crewOf, broadcast }) => {
          refreshFor(id)
          // And tell the rest of the crew that this one has arrived.
          const crew = crewOf(id)
          if (crew) broadcast(crew.id)
        })
      }
      break

    case 'log':
      pushEvent(id, 'log', message.message)
      break

    case 'chat':
      pushEvent(id, 'chat', message.message, { from: message.from })
      break

    case 'thought':
      pushEvent(id, 'thought', message.text)
      break

    case 'action':
      pushEvent(id, 'action', message.result, { tool: message.name })
      break

    case 'memory':
      entry.state.memory = message.notes
      saveMemory(id, message.notes)
      emit('companion:memory', { companionId: id, notes: message.notes })
      break

    case 'goal':
      entry.state.goal = message.goal
      emitStatus(id)
      break

    case 'agentError':
      pushEvent(id, 'error', message.message)
      break

    /*
     * Crew messages are the only ones that leave this bot's own world, so they
     * are routed through the crew service, which is what knows whether this
     * companion is entitled to give the order at all. Loaded lazily: the crew
     * service reads this module back, and a static import would be a cycle.
     */
    case 'assign': {
      pushEvent(id, 'action', `assigned ${message.toUsername}: ${message.task}`, { tool: 'assign_task' })
      void import('./crewService').then(({ assignTask }) => assignTask(id, message.toUsername, message.task))
      break
    }

    case 'crewNote': {
      pushEvent(id, 'log', `crew note: ${message.text}`)
      void import('./crewService').then(({ noteFromCompanion }) => noteFromCompanion(id, message.text))
      break
    }

    /*
     * Camera frames go straight out to the renderer and are deliberately not
     * kept: they are large, they are worthless a second later, and holding them
     * in the event feed would push everything the player actually wants to read
     * off the top of it.
     */
    case 'camera':
      emit('companion:camera', { companionId: id, frame: message.frame })
      break

    /*
     * What it is doing, kept on the state rather than pushed into the event
     * feed: this changes on every turn and would drown the log the player
     * actually reads.
     */
    case 'work':
      entry.state.work = message.work
      emit('companion:work', { companionId: id, work: message.work })
      break

    /*
     * The point of an alert is to reach someone who is not looking at the
     * launcher, so it goes to the OS rather than the in-app feed alone.
     */
    case 'alert':
      pushEvent(id, 'log', `${message.title} — ${message.body}`)
      notifyDesktop({ title: message.title, body: message.body, onlyWhenAway: false })
      break

    case 'usage': {
      const totals = recordUsage(id, message.usage)
      emit('companion:usage', { companionId: id, usage: totals })
      break
    }

    case 'buildRecord': {
      // The bot does not know its own id; stamp it here where it is known.
      const records = readBuilds()
      records.push({ ...message.record, companionId: id })
      writeBuilds(records)
      pushEvent(id, 'log', `${message.record.label} can be undone (${message.record.placements.length} blocks)`)
      break
    }
  }
}

/**
 * Schematics read off disk this session, keyed by a generated id.
 *
 * Deliberately not persisted: a schematic is large, the file it came from is
 * still on the user's disk, and re-importing costs one read. Keeping them in
 * the store would grow it without end for no benefit.
 */
const importedBlueprints = new Map<string, { blueprint: unknown; summary: BlueprintSummary }>()

export function rememberImport(id: string, blueprint: unknown, summary: BlueprintSummary): void {
  importedBlueprints.set(id, { blueprint, summary })
  // A session's worth of imports, not a lifetime's.
  if (importedBlueprints.size > 24) {
    const oldest = importedBlueprints.keys().next().value
    if (oldest) importedBlueprints.delete(oldest)
  }
}

export function listImports(): BlueprintSummary[] {
  return [...importedBlueprints.values()].map((entry) => entry.summary)
}

export function getImport(id: string): { blueprint: unknown; summary: BlueprintSummary } | undefined {
  return importedBlueprints.get(id)
}

/** Sends a chosen blueprint to a running companion to build. */
export function buildWithCompanion(id: string, blueprint: unknown, label: string): void {
  post(id, { type: 'build', blueprint, label })
}

/* ---------------------------------------------------------------- spend */

const USAGE_KEY = 'companion-usage'

/** Totals survive restarts; the session half resets when a bot starts. */
function readUsage(): Record<string, CompanionUsage> {
  try {
    const raw = db().kvGet(USAGE_KEY)
    return raw ? (JSON.parse(raw) as Record<string, CompanionUsage>) : {}
  } catch {
    return {}
  }
}

function blankUsage(): CompanionUsage {
  return {
    calls: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    sessionTokens: 0,
    sessionCalls: 0
  }
}

export function companionUsage(): Record<string, CompanionUsage> {
  return readUsage()
}

/** Zeroes the running total for one companion, or all of them. */
export function resetUsage(id?: string): void {
  if (!id) {
    db().kvSet(USAGE_KEY, JSON.stringify({}))
    return
  }
  const all = readUsage()
  delete all[id]
  db().kvSet(USAGE_KEY, JSON.stringify(all))
}

function recordUsage(
  id: string,
  usage: { promptTokens: number; completionTokens: number; totalTokens: number }
): CompanionUsage {
  const all = readUsage()
  const entry = all[id] ?? blankUsage()

  entry.calls += 1
  entry.promptTokens += usage.promptTokens
  entry.completionTokens += usage.completionTokens
  entry.totalTokens += usage.totalTokens
  entry.sessionCalls += 1
  entry.sessionTokens += usage.totalTokens

  all[id] = entry
  db().kvSet(USAGE_KEY, JSON.stringify(all))
  return entry
}

/** Clears just the session half, when a bot process starts. */
function startUsageSession(id: string): void {
  const all = readUsage()
  const entry = all[id] ?? blankUsage()
  entry.sessionCalls = 0
  entry.sessionTokens = 0
  all[id] = entry
  db().kvSet(USAGE_KEY, JSON.stringify(all))
}

/* --------------------------------------------------------------- builds */

const BUILDS_KEY = 'companion-builds'

/**
 * How many builds stay undoable.
 *
 * Each record holds one entry per block placed, so a handful of large builds is
 * already megabytes. Ten is enough to cover "undo that" while keeping the store
 * a sensible size.
 */
const MAX_BUILD_RECORDS = 10

function readBuilds(): BuildRecord[] {
  try {
    const raw = db().kvGet(BUILDS_KEY)
    return raw ? (JSON.parse(raw) as BuildRecord[]) : []
  } catch {
    return []
  }
}

function writeBuilds(records: BuildRecord[]): void {
  db().kvSet(BUILDS_KEY, JSON.stringify(records.slice(-MAX_BUILD_RECORDS)))
}

/** Builds that can still be taken back out, newest first. */
export function listBuilds(): BuildSummary[] {
  return readBuilds()
    .map((record) => ({
      id: record.id,
      companionId: record.companionId,
      label: record.label,
      at: record.at,
      blocks: record.placements.length,
      origin: record.origin,
      undoneAt: record.undoneAt
    }))
    .reverse()
}

/**
 * Hands a build back to the companion that made it.
 *
 * The record is marked undone before the bot starts rather than after: an undo
 * that is interrupted half way has still changed the world, and offering it
 * again as though nothing happened would be worse than a slightly early mark.
 */
export function undoBuild(buildId: string, companionId?: string): void {
  const records = readBuilds()
  const record = records.find((entry) => entry.id === buildId)
  if (!record) throw new LauncherError('NOT_FOUND', `no build with id ${buildId}`)

  const target = companionId || record.companionId
  if (!target) throw new LauncherError('INVALID_INPUT', 'no companion to undo this with')

  post(target, { type: 'undoBuild', record })

  record.undoneAt = Date.now()
  writeBuilds(records)
}

/** Tells a companion to drop what it is doing. */
export function interruptCompanion(id: string): void {
  post(id, { type: 'interrupt' })
}

/** Starts or stops the bot cam for one companion. */
export function setCameraEnabled(id: string, on: boolean): void {
  post(id, { type: 'camera', on })
}

/** Hands a bot the current picture of its crew. */
export function pushCrewSnapshot(id: string, snapshot: CrewSnapshot): void {
  post(id, { type: 'crew', snapshot })
}

export function stopCompanion(id: string): CompanionState {
  const entry = running.get(id)
  if (!entry) return getCompanionState(id)

  post(id, { type: 'stop' })

  const dying = entry.child
  setTimeout(() => {
    if (dying && !dying.killed) dying.kill()
  }, 3000)

  setStatus(id, 'idle', 'stopping')
  return getCompanionState(id)
}

export function instructCompanion(id: string, text: string): void {
  if (!running.has(id)) {
    throw new LauncherError('NOT_FOUND', 'that companion is not running', {
      title: 'That companion is not connected',
      message: 'Start it before sending instructions.',
      actions: ['Press Start on the Companion screen']
    })
  }
  pushEvent(id, 'chat', text, { from: 'you' })
  post(id, { type: 'instruct', text: text.slice(0, 500) })
}

/**
 * Makes a running companion say something in chat verbatim.
 *
 * Distinct from `instructCompanion`, which hands text to the model as an order
 * to think about. This is for lines the launcher itself has decided on — a
 * steward's greeting when someone joins — where a round trip to a language
 * model would add latency, cost and the chance of it saying something else.
 */
export function sayAsCompanion(id: string, text: string): void {
  if (!running.has(id)) return
  post(id, { type: 'say', text: text.slice(0, 240) })
}

export function clearCompanionMemory(id: string): void {
  const entry = running.get(id)
  if (entry) entry.state.memory = []
  saveMemory(id, [])
  emit('companion:memory', { companionId: id, notes: [] })
}

/** Called on shutdown so no bot outlives the launcher. */
export function shutdownCompanion(): void {
  for (const id of [...running.keys()]) {
    // Tell it to log out, then end it — the launcher is not staying around to
    // wait, and a child left running would hold the whole app open.
    post(id, { type: 'stop' })
    killChild(id, true)
  }
}
