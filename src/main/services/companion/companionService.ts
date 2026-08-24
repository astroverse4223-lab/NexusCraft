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
import type {
  Companion,
  CompanionConfig,
  CompanionEvent,
  CompanionInbound,
  CompanionOutbound,
  CompanionSettings,
  CompanionState
} from '@shared/companion'
import { DEFAULT_PERSONALITY } from '@shared/companion'
import { db } from '../../core/database'
import { emit } from '../../core/events'
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

  if (!settings.baseUrl.trim()) {
    throw new LauncherError('INVALID_INPUT', 'no model endpoint configured', {
      title: 'No model endpoint set',
      message: 'The companion needs somewhere to send its decisions — a local Ollama server or a hosted API.',
      actions: ['Choose a provider in the Companion screen', 'Ollama runs locally and needs no key']
    })
  }
  if (!settings.model.trim()) {
    throw new LauncherError('INVALID_INPUT', 'no model selected', {
      title: 'No model chosen',
      message: 'Choose the model to use. Press Load models to see what your endpoint serves rather than typing a name.',
      actions: ['Set a model name in the Companion screen']
    })
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
    toolSet: settings.toolSet ?? 'full',
    llm: { baseUrl: settings.baseUrl, apiKey, model: settings.model, timeoutMs: 90_000 },
    memory: loadMemory(id)
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
  }
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
