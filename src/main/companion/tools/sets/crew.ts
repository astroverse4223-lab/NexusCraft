/**
 * Working with the rest of the crew.
 *
 * These are the only tools that reach outside the bot's own world: everything
 * else drives mineflayer, while these send a message to the launcher, which is
 * the only thing that can see the other bots. That asymmetry is deliberate —
 * bots do not talk to each other directly, so a confused foreman can order
 * work and post notes, and nothing more.
 *
 * The crew snapshot is pushed in by the launcher rather than fetched, so
 * reading it is free and always reflects the last thing the launcher knew.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { CrewSnapshot } from '@shared/companion'
import type { Tool } from '../types'

let snapshot: CrewSnapshot | null = null

/** Called by the bot entry point whenever the launcher sends a new snapshot. */
export function setCrewSnapshot(next: CrewSnapshot | null): void {
  snapshot = next
}

export function currentCrew(): CrewSnapshot | null {
  return snapshot
}

/** Sends a message to the launcher, which is what routes it to the crew. */
function toLauncher(message: unknown): boolean {
  if (typeof process.send !== 'function') return false
  try {
    process.send(message)
    return true
  } catch {
    return false
  }
}

export const TOOLS: Tool[] = [
  {
    schema: {
      name: 'crew_status',
      description:
        'See who is in your crew, what each of them is doing, and the notes the crew has left. Use this before assigning work so you do not give two people the same job.',
      parameters: { type: 'object', properties: {} }
    },
    execute: async () => {
      if (!snapshot) return 'you are not in a crew'

      const members = snapshot.members
        .map((member) => {
          const job = member.routine ? `routine: ${member.routine}` : 'thinks for itself'
          const task = member.lastTask ? `, last told to: ${member.lastTask}` : ''
          return `- ${member.username} (${member.online ? member.status : 'offline'}, ${job}${task})`
        })
        .join('\n')

      const notes =
        snapshot.notes.length > 0
          ? `\n\nCrew notes:\n${snapshot.notes.map((note) => `- ${note.from}: ${note.text}`).join('\n')}`
          : ''

      return `Crew "${snapshot.crewName}"${snapshot.isForeman ? ' (you are the foreman)' : ''}\n${members || '- nobody else'}${notes}`
    }
  },

  {
    schema: {
      name: 'assign_task',
      description:
        'Give a job to another member of your crew, by their in-game name. Only the foreman can do this, and only to crew members that think for themselves — a member on a routine already does that job continuously and cannot take a different one. Say exactly what you want done.',
      parameters: {
        type: 'object',
        properties: {
          worker: { type: 'string', description: 'The in-game name of the crew member to give the job to.' },
          task: { type: 'string', description: 'What they should do, in one or two clear sentences.' }
        },
        required: ['worker', 'task']
      }
    },
    execute: async (_context, { worker, task }) => {
      if (!snapshot) return 'you are not in a crew, so there is nobody to assign work to'
      if (!snapshot.isForeman) return 'only the foreman can assign work'

      const name = String(worker ?? '').trim()
      const text = String(task ?? '').trim().slice(0, 400)
      if (!name || !text) return 'need both a crew member and a task'

      const member = snapshot.members.find(
        (candidate) => candidate.username.toLowerCase() === name.toLowerCase()
      )
      if (!member) {
        return `there is nobody called ${name} in the crew. Members: ${snapshot.members.map((m) => m.username).join(', ') || 'none'}`
      }
      if (!member.online) return `${member.username} is not connected, so cannot be given work`

      /*
       * A worker on a routine follows a fixed script and has no model to read
       * an instruction with, so it cannot take a free-text job. Reporting this
       * as delivered is worse than refusing it: the foreman moves on believing
       * the work is under way, and nothing happens.
       */
      if (member.routine) {
        return (
          `${member.username} follows the "${member.routine}" routine and cannot be given a different job — ` +
          'it already does that work continuously. Give this task to a crew member that thinks for itself, ' +
          'or do it yourself.'
        )
      }

      // Reflect it locally so a second assignment in the same turn sees it,
      // rather than waiting for the launcher's next snapshot.
      member.lastTask = text

      return toLauncher({ type: 'assign', toUsername: member.username, task: text })
        ? `told ${member.username} to: ${text}`
        : 'could not reach the launcher to pass that on'
    }
  },

  {
    schema: {
      name: 'crew_note',
      description:
        'Leave a short note the whole crew can read — what you found, where you are working, what is finished. Use it for facts the others need, not chatter.',
      parameters: {
        type: 'object',
        properties: { text: { type: 'string', description: 'The note. One sentence.' } },
        required: ['text']
      }
    },
    execute: async (_context, { text }) => {
      const note = String(text ?? '').trim().slice(0, 240)
      if (!note) return 'nothing to note'
      if (!snapshot) return 'you are not in a crew'

      return toLauncher({ type: 'crewNote', text: note }) ? `noted: ${note}` : 'could not reach the launcher'
    }
  }
]
