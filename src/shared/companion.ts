/**
 * Message contract between the launcher and the companion bot process.
 *
 * Kept separate from `types.ts` because the bot process imports it directly and
 * must stay free of anything Electron-specific.
 */

export interface CompanionLlmConfig {
  baseUrl: string
  apiKey: string
  model: string
  temperature?: number
  timeoutMs?: number
}

export interface CompanionConfig {
  host: string
  port: number
  username: string
  /** 'offline' for your own LAN world; 'microsoft' signs in as a real account. */
  auth: 'offline' | 'microsoft'
  /** Pin the protocol version, or leave empty to auto-detect. */
  version: string
  owner: string
  personality: string
  autonomy: boolean
  idleIntervalSec: number
  /** Watch the owner and raise a desktop alert when something closes in. */
  sentinel?: boolean
  /**
   * How many tools to offer. Small local models handle a short list far better
   * than the full one, which is thirty tools of schema on every request.
   */
  toolSet: 'full' | 'core'
  llm: CompanionLlmConfig
  memory?: string[]

  /**
   * Follow a script rather than a model.
   *
   * Empty means think for itself with the language model. Naming a routine —
   * 'lumberjack', 'miner' and the rest — makes it a worker instead: no model, no
   * API key, no waiting on a reply, and the same behaviour every time. Plenty of
   * jobs need doing rather than deciding.
   */
  routine?: string
}

/** A scripted worker, as offered to the interface. */
export interface RoutineInfo {
  id: string
  label: string
  description: string
  needs?: string
}

export type CompanionStatus = 'idle' | 'connecting' | 'playing' | 'disconnected' | 'error'

/** Launcher -> bot */
export type CompanionInbound =
  | { type: 'start'; config: CompanionConfig }
  | { type: 'instruct'; text: string }
  | { type: 'say'; text: string }
  | { type: 'configure'; autonomy: boolean; personality: string; idleIntervalSec: number }
  /** The crew as it currently stands, pushed whenever it changes. */
  | { type: 'crew'; snapshot: CrewSnapshot }
  /** Start or stop streaming a view of the bot's surroundings. */
  | { type: 'camera'; on: boolean }
  /** Build a structure chosen in the launcher: a library entry or an import. */
  | { type: 'build'; blueprint: unknown; label: string }
  /** Drop what it is doing and clear anything it set for itself. */
  | { type: 'interrupt' }
  /** Take a recorded build back out of the world. */
  | { type: 'undoBuild'; record: BuildRecord }
  | { type: 'stop' }

/** Bot -> launcher */
export type CompanionOutbound =
  | { type: 'status'; status: CompanionStatus; detail: string }
  | { type: 'log'; message: string }
  | { type: 'chat'; from: string; message: string }
  | { type: 'thought'; text: string }
  | { type: 'action'; name: string; args: Record<string, unknown>; result: string }
  | { type: 'memory'; notes: string[] }
  | { type: 'goal'; goal: string | null }
  | { type: 'agentError'; message: string }
  /** Give a job to another member of the crew. */
  | { type: 'assign'; toUsername: string; task: string }
  /** Post something to the crew's shared notes. */
  | { type: 'crewNote'; text: string }
  /** One rendered view of what is around the bot. */
  | { type: 'camera'; frame: CameraFrame }
  /** What it is working on, and how much is waiting behind it. */
  | { type: 'work'; work: CompanionWork }
  /** A finished build, with everything needed to reverse it. */
  | { type: 'buildRecord'; record: BuildRecord }
  /** Tokens spent, reported after each model call. */
  | { type: 'usage'; usage: { promptTokens: number; completionTokens: number; totalTokens: number } }
  /** Something the player should know about right now, even tabbed away. */
  | { type: 'alert'; title: string; body: string }

/** A structure the launcher can offer to build. */
export interface BlueprintSummary {
  id: string
  name: string
  blurb: string
  width: number
  height: number
  depth: number
  /** Total blocks to place, so the cost is visible before starting. */
  blocks: number
  /** Biggest material requirements first. */
  materials: Array<{ block: string; count: number }>
  /** Set for a schematic read off disk rather than a bundled entry. */
  imported?: boolean
  /** Anything lost on import, e.g. dropped block states. */
  notes?: string[]
}

/**
 * What a companion is doing right now.
 *
 * Without this there was no way to tell a busy companion from a stuck one — an
 * instruction that was merely queued behind a long task looked identical to one
 * that had been ignored.
 */
export interface CompanionWork {
  /** The instruction being carried out, or null when idle. */
  current: string | null
  /** How many instructions are waiting behind it. */
  queued: number
  /** How long the current one has been running. */
  runningForMs: number
}

/* ------------------------------------------------------------------ spend */

/**
 * What a companion has cost, this session and in total.
 *
 * A companion on autonomy makes a model call every idle interval whether or not
 * anything is happening, so the bill accrues while nobody is watching. Tokens
 * are what every provider reports; the money figure is only as good as the rate
 * the user enters, and is left out entirely when they have not entered one.
 */
export interface CompanionUsage {
  calls: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  /** Tokens since this bot process started, for "what is it costing me now". */
  sessionTokens: number
  sessionCalls: number
}

/* ------------------------------------------------------------------ builds */

/** One block the companion placed, and what the position held before. */
export interface BuildPlacement {
  x: number
  y: number
  z: number
  /** What went down. */
  placed: string
  /** What was there first — usually air, which is why undo is mostly clearing. */
  was: string
}

/**
 * A build the companion carried out, kept so it can be taken back out.
 *
 * Without this a misplaced structure was permanent, which is the thing that
 * makes people reluctant to let a bot build at all.
 */
export interface BuildRecord {
  id: string
  companionId: string
  /** The structure's name, for the interface. */
  label: string
  at: number
  origin: { x: number; y: number; z: number }
  placements: BuildPlacement[]
  /** Set once it has been undone, so it is not offered twice. */
  undoneAt?: number
}

export interface BuildUndoResult {
  buildId: string
  removed: number
  /** Original blocks put back where something real was displaced. */
  restored: number
  /** Positions something else had already changed; left alone. */
  skipped: number
  failed: number
  total: number
  stoppedBecause: string | null
}

/** A build in the list, without the placement data behind it. */
export interface BuildSummary {
  id: string
  companionId: string
  label: string
  at: number
  blocks: number
  origin: { x: number; y: number; z: number }
  undoneAt?: number
}

/* ----------------------------------------------------------------- bot cam */

/**
 * A look at what is around the bot, sampled from the world it already knows.
 *
 * This is a live top-down slice rather than a rendered 3D image, and that is a
 * deliberate limit rather than a stopgap. Producing a photographic first-person
 * view needs a GL context and a block-texture atlas — `prismarine-viewer` and
 * its native canvas/gl dependencies — which cannot run inside this app's
 * sandboxed, strict-CSP renderer, and would have to be rasterised in a third
 * process and shipped over as images. What the bot actually navigates by is the
 * block data below, so that is what is drawn: honest about its source, cheap
 * enough to send twice a second, and no new native dependencies.
 */
export interface CameraFrame {
  /** Odd-numbered edge length in blocks; the bot sits at the centre. */
  size: number
  /** Block position of the frame's centre. */
  origin: { x: number; y: number; z: number }
  /**
   * Row-major `size * size` grid, north-up, of the highest non-air block in
   * each column. An empty string means the column was unknown or empty.
   */
  columns: string[]
  /** Surface height per column, matching `columns`, for shading. */
  heights: number[]
  /** Where the bot is looking, in radians. */
  yaw: number
  /** Other things nearby, positioned relative to the frame's centre. */
  entities: Array<{
    dx: number
    dz: number
    name: string
    kind: 'player' | 'hostile' | 'passive' | 'item' | 'other'
  }>
  health: number
  food: number
  /** What the bot is holding, if anything. */
  holding: string | null
  at: number
}

/* ------------------------------------------------------------------ crews */

/**
 * A crew: several companions working the same world, with one in charge.
 *
 * The point is division of labour that costs almost nothing. A foreman runs on
 * a language model and decides; the workers it directs can be routine-driven,
 * which means no model, no API key and no per-step latency for the parts of the
 * job that need doing rather than deciding.
 */
export interface Crew {
  id: string
  name: string
  /** Companion id of the one that gives the orders. */
  foremanId: string
  /** Companion ids of everyone taking them, foreman excluded. */
  memberIds: string[]
  createdAt: number
}

/** One member, as the foreman's tools see them. */
export interface CrewMemberView {
  companionId: string
  username: string
  /** Empty when this member thinks for itself rather than following a routine. */
  routine: string
  online: boolean
  status: CompanionStatus
  /** What it was last told to do, if anything. */
  lastTask: string | null
}

/** A line on the crew's shared board. */
export interface CrewNote {
  at: number
  /** Who wrote it, by in-game name. */
  from: string
  text: string
}

/** Everything a bot needs to know about its crew, pushed from the launcher. */
export interface CrewSnapshot {
  crewId: string
  crewName: string
  /** True when this bot is the one in charge. */
  isForeman: boolean
  members: CrewMemberView[]
  notes: CrewNote[]
}

/** One line in the interface's activity feed. */
export interface CompanionEvent {
  id: number
  at: number
  kind: 'status' | 'log' | 'chat' | 'thought' | 'action' | 'error'
  text: string
  /** Set for chat lines. */
  from?: string
  /** Set for tool calls. */
  tool?: string
  /** Which companion produced this; feeds are shown per companion. */
  companionId: string
}

export interface CompanionState {
  /** Which companion this belongs to; several run at once. */
  companionId: string
  status: CompanionStatus
  detail: string
  goal: string | null
  memory: string[]
  events: CompanionEvent[]
  /** Minecraft version the bot actually connected with. */
  connectedVersion: string | null
  /** What it is carrying out right now, and what is waiting behind it. */
  work?: CompanionWork
  /**
   * Whether a bot process actually exists. Distinct from `status`: a bot that
   * failed to connect reports `error` while its process is still alive, and the
   * UI must offer Stop in that state rather than a Start that will be refused.
   */
  alive: boolean
}

/** A configured companion: its settings plus the id everything is keyed by. */
export interface Companion extends CompanionSettings {
  id: string
}

/** Settings persisted between sessions. The API key is stored separately. */
export interface CompanionSettings {
  provider: string
  baseUrl: string
  model: string
  host: string
  port: number
  username: string
  auth: 'offline' | 'microsoft'
  version: string
  owner: string
  personality: string
  autonomy: boolean
  idleIntervalSec: number
  /**
   * What a million tokens costs on this endpoint, in whatever currency the user
   * thinks in. Zero — the default — means the meter shows tokens only, which is
   * the honest thing to do rather than inventing a rate for a provider whose
   * pricing the launcher cannot know.
   */
  pricePerMillionTokens?: number
  /**
   * Watch the owner and raise a desktop notification when something hostile
   * closes in. For playing while tabbed out — the companion is the only thing
   * still looking at the screen.
   */
  sentinel?: boolean
  /**
   * How many tools to offer. A small local model copes far better with a short
   * list than with the full thirty, which is ~2,300 tokens of schema per call.
   */
  toolSet: 'full' | 'core'
  /** True when an API key is saved in the encrypted store. */
  hasApiKey: boolean
  /**
   * Names a scripted routine to follow instead of thinking. Empty means use the
   * language model, which is what a companion does by default.
   */
  routine: string
  /**
   * The hosted server this companion lives on, or empty for a free agent.
   *
   * A steward follows its server's lifecycle: it joins when the server is
   * ready and leaves when the server stops, so the world is never left with a
   * bot trying to reconnect to something that is gone.
   */
  stewardOf: string
}

export const DEFAULT_PERSONALITY =
  'You are a cheerful, competent Minecraft companion. You enjoy exploring and building, ' +
  'you speak briefly and naturally in chat, and you get on with things without asking for ' +
  'permission on every small step.'
