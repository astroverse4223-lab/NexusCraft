import { randomUUID } from 'node:crypto'
import type { Crew, CrewMemberView, CrewNote, CrewSnapshot } from '@shared/companion'
import { db } from '../../core/database'
import { LauncherError } from '../../core/errors'
import { createLogger } from '../../core/logger'
import {
  getCompanion,
  getCompanionState,
  isCompanionRunning,
  listCompanions,
  pushCrewSnapshot,
  instructCompanion,
  startCompanion,
  stopCompanion
} from './companionService'

const log = createLogger('crew')

/**
 * Several companions working together, with one in charge.
 *
 * The launcher is the only thing that can see every bot at once — each one is
 * its own child process, connected to the server independently — so
 * coordination lives here rather than in any of them. A foreman's `assign_task`
 * arrives as a message, is checked against the crew it actually belongs to,
 * and comes out as an ordinary instruction to the target bot. From the worker's
 * side there is nothing new to understand: it is told to do something, the way
 * the user might have told it.
 *
 * The economics are the point. A foreman on a good model plus four workers on
 * scripted routines costs one model's worth of tokens and behaves like five
 * players, because the jobs that fill most of a Minecraft session — chopping,
 * mining, farming, hauling — need doing rather than deciding.
 */

const CREWS_KEY = 'companion-crews'
const NOTES_KEY = 'companion-crew-notes'

/** How many notes a crew keeps. Old ones stop being useful quickly. */
const MAX_NOTES = 40

function readCrews(): Crew[] {
  const raw = db().kvGet(CREWS_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as Crew[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeCrews(crews: Crew[]): void {
  db().kvSet(CREWS_KEY, JSON.stringify(crews))
}

function readNotes(crewId: string): CrewNote[] {
  const raw = db().kvGet(`${NOTES_KEY}-${crewId}`)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as CrewNote[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeNotes(crewId: string, notes: CrewNote[]): void {
  db().kvSet(`${NOTES_KEY}-${crewId}`, JSON.stringify(notes.slice(-MAX_NOTES)))
}

/** What the foreman was last told to have each member do. */
const lastTasks = new Map<string, string>()

export function listCrews(): Crew[] {
  return readCrews()
}

export function getCrew(id: string): Crew {
  const crew = readCrews().find((entry) => entry.id === id)
  if (!crew) throw new LauncherError('NOT_FOUND', `crew ${id} does not exist`)
  return crew
}

/** The crew a companion belongs to, as foreman or worker, if any. */
export function crewOf(companionId: string): Crew | null {
  return (
    readCrews().find((crew) => crew.foremanId === companionId || crew.memberIds.includes(companionId)) ?? null
  )
}

export function createCrew(name: string, foremanId: string, memberIds: string[]): Crew {
  const foreman = getCompanion(foremanId)

  /*
   * A foreman with no model cannot lead: routines follow a script and have no
   * way to decide who should do what. Saying so here beats a crew that looks
   * set up and then never gives an order.
   */
  if (foreman.routine) {
    throw new LauncherError('INVALID_INPUT', 'the foreman follows a routine', {
      title: `${foreman.username} cannot lead a crew`,
      message:
        'A foreman decides what everyone else does, which needs a language model. This companion is set to follow a scripted routine instead.',
      actions: [`Set ${foreman.username}'s routine to "Think for itself" on the Companion screen`, 'Or pick a different foreman']
    })
  }

  // One crew per companion: two foremen giving the same worker orders is a
  // mess with no upside.
  const existing = readCrews()
  const taken = [foremanId, ...memberIds].filter((id) => crewOf(id))
  if (taken.length > 0) {
    const names = taken.map((id) => getCompanion(id).username).join(', ')
    throw new LauncherError('INVALID_INPUT', 'already in a crew', {
      title: 'Already on a crew',
      message: `${names} ${taken.length === 1 ? 'is' : 'are'} already part of another crew.`,
      actions: ['Remove them from that crew first']
    })
  }

  const crew: Crew = {
    id: randomUUID(),
    name: name.trim().slice(0, 40) || 'Crew',
    foremanId,
    memberIds: memberIds.filter((id) => id !== foremanId),
    createdAt: Date.now()
  }

  writeCrews([...existing, crew])
  log.info(`created crew "${crew.name}" under ${foreman.username} with ${crew.memberIds.length} workers`)
  broadcast(crew.id)
  return crew
}

export function updateCrew(id: string, patch: { name?: string; memberIds?: string[] }): Crew {
  const crews = readCrews()
  const index = crews.findIndex((entry) => entry.id === id)
  if (index < 0) throw new LauncherError('NOT_FOUND', `crew ${id} does not exist`)

  const crew = crews[index]

  if (typeof patch.name === 'string') crew.name = patch.name.trim().slice(0, 40) || crew.name

  if (Array.isArray(patch.memberIds)) {
    const wanted = patch.memberIds.filter((memberId) => memberId !== crew.foremanId)

    // Anyone newly added must not already belong to another crew.
    for (const memberId of wanted) {
      const other = crewOf(memberId)
      if (other && other.id !== id) {
        throw new LauncherError('INVALID_INPUT', 'already in another crew', {
          title: `${getCompanion(memberId).username} is on another crew`,
          message: `They are already part of "${other.name}".`,
          actions: ['Remove them from that crew first']
        })
      }
    }
    crew.memberIds = wanted
  }

  crews[index] = crew
  writeCrews(crews)
  broadcast(id)
  return crew
}

export function deleteCrew(id: string): void {
  writeCrews(readCrews().filter((crew) => crew.id !== id))
  db().kvSet(`${NOTES_KEY}-${id}`, JSON.stringify([]))
  log.info(`disbanded crew ${id}`)
}

/* ---------------------------------------------------------------- notes */

export function crewNotes(crewId: string): CrewNote[] {
  return readNotes(crewId)
}

export function addCrewNote(crewId: string, from: string, text: string): void {
  const notes = readNotes(crewId)
  notes.push({ at: Date.now(), from, text: text.slice(0, 240) })
  writeNotes(crewId, notes)
  broadcast(crewId)
}

export function clearCrewNotes(crewId: string): void {
  writeNotes(crewId, [])
  broadcast(crewId)
}

/* ------------------------------------------------------------ snapshots */

/** Everyone on a crew, as the bots see each other. */
function membersOf(crew: Crew, forCompanionId: string): CrewMemberView[] {
  const ids = [crew.foremanId, ...crew.memberIds].filter((id) => id !== forCompanionId)

  return ids.flatMap((id) => {
    const companion = listCompanions().find((entry) => entry.id === id)
    if (!companion) return []

    const online = isCompanionRunning(id)
    return [
      {
        companionId: id,
        username: companion.username,
        routine: companion.routine,
        online,
        status: online ? getCompanionState(id).status : 'idle',
        lastTask: lastTasks.get(id) ?? null
      }
    ]
  })
}

export function snapshotFor(companionId: string): CrewSnapshot | null {
  const crew = crewOf(companionId)
  if (!crew) return null

  return {
    crewId: crew.id,
    crewName: crew.name,
    isForeman: crew.foremanId === companionId,
    members: membersOf(crew, companionId),
    notes: readNotes(crew.id)
  }
}

/** Pushes the current picture to every running member of a crew. */
export function broadcast(crewId: string): void {
  const crew = readCrews().find((entry) => entry.id === crewId)
  if (!crew) return

  for (const id of [crew.foremanId, ...crew.memberIds]) {
    if (!isCompanionRunning(id)) continue
    const snapshot = snapshotFor(id)
    if (snapshot) pushCrewSnapshot(id, snapshot)
  }
}

/** Re-sends the snapshot to one bot, e.g. as it comes online. */
export function refreshFor(companionId: string): void {
  const snapshot = snapshotFor(companionId)
  if (snapshot && isCompanionRunning(companionId)) pushCrewSnapshot(companionId, snapshot)
}

/* ------------------------------------------------------------ delegation */

/**
 * Routes an `assign_task` from a foreman to the worker it names.
 *
 * The foreman's own crew is the boundary: a bot can only give work to someone
 * on the crew it belongs to, and only if it is that crew's foreman. Both are
 * checked here rather than trusted from the message, because the message came
 * from a language model.
 */
export function assignTask(fromCompanionId: string, toUsername: string, task: string): void {
  const crew = crewOf(fromCompanionId)
  if (!crew) {
    log.warn(`a companion not on a crew tried to assign work`)
    return
  }
  if (crew.foremanId !== fromCompanionId) {
    log.warn(`${getCompanion(fromCompanionId).username} is not the foreman and tried to assign work`)
    return
  }

  const target = listCompanions().find(
    (companion) =>
      companion.username.toLowerCase() === toUsername.toLowerCase() &&
      (crew.memberIds.includes(companion.id) || companion.id === crew.foremanId) &&
      companion.id !== fromCompanionId
  )

  if (!target) {
    log.warn(`no crew member called "${toUsername}" to assign work to`)
    return
  }

  if (!isCompanionRunning(target.id)) {
    log.info(`${target.username} is not connected; the task was not delivered`)
    return
  }

  /*
   * Checked again here, not only in the tool: the foreman decides from a
   * snapshot that may be a few seconds old, and a bot switched to a routine in
   * the meantime has no model to read the instruction with. It would be
   * dropped on arrival, leaving the foreman waiting on work nobody is doing.
   */
  if (target.routine) {
    log.info(`${target.username} follows the ${target.routine} routine and cannot take an assigned task`)
    addCrewNote(
      crew.id,
      getCompanion(fromCompanionId).username,
      `${target.username} runs the ${target.routine} routine and cannot take other jobs.`
    )
    return
  }

  lastTasks.set(target.id, task)

  const foremanName = getCompanion(fromCompanionId).username
  instructCompanion(target.id, `[from ${foremanName}, your crew foreman] ${task}`)
  log.info(`${foremanName} assigned "${task.slice(0, 60)}" to ${target.username}`)

  broadcast(crew.id)
}

/** Handles a `crewNote` message from a bot. */
export function noteFromCompanion(companionId: string, text: string): void {
  const crew = crewOf(companionId)
  if (!crew) return
  addCrewNote(crew.id, getCompanion(companionId).username, text)
}

/* -------------------------------------------------------------- control */

/** Starts every member of a crew, foreman first so it is there to give orders. */
export function startCrew(id: string): { started: string[]; failed: Array<{ username: string; reason: string }> } {
  const crew = getCrew(id)
  const started: string[] = []
  const failed: Array<{ username: string; reason: string }> = []

  for (const companionId of [crew.foremanId, ...crew.memberIds]) {
    if (isCompanionRunning(companionId)) continue
    const companion = getCompanion(companionId)
    try {
      startCompanion(companionId)
      started.push(companion.username)
    } catch (err) {
      failed.push({ username: companion.username, reason: (err as Error).message })
    }
  }

  // Give them a moment to connect before telling each about the others.
  setTimeout(() => broadcast(id), 5000).unref()

  return { started, failed }
}

export function stopCrew(id: string): string[] {
  const crew = getCrew(id)
  const stopped: string[] = []

  for (const companionId of [crew.foremanId, ...crew.memberIds]) {
    if (!isCompanionRunning(companionId)) continue
    stopCompanion(companionId)
    stopped.push(getCompanion(companionId).username)
  }

  return stopped
}
