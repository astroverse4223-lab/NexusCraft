/**
 * Keeping the things people design.
 *
 * Every generator was one-shot: make a banner you like, switch tabs, and the
 * only way to keep it was to apply it there and then. Designs are small
 * structured objects, so storing them costs almost nothing and turns each
 * generator from a slot machine into something you can build a set with.
 *
 * The payload is deliberately opaque here. A banner, a firework and an icon
 * have nothing in common beyond being JSON, and a library that understood each
 * of them would need changing every time a generator does. The screen that
 * saved it is the one that knows how to read it back.
 */
import { randomUUID } from 'node:crypto'

import type { SavedCreation, CreationKind } from '@shared/types'

import { Collections, db } from '../../core/database'
import { LauncherError } from '../../core/errors'
import { createLogger } from '../../core/logger'

const log = createLogger('creations')

/**
 * A ceiling, so a runaway loop cannot fill the store.
 *
 * Generous enough that nobody designing by hand will meet it.
 */
const LIMIT = 500

/**
 * Loot packs saved before loot had a kind of its own.
 *
 * Both generators wrote `datapack`, so a loot pack appeared in the recipe
 * tab's list - and opening it there handed a pack with `rules` to a screen
 * that reads `recipes`, which took the whole interface down. Old saves are
 * re-labelled by their shape on the way out, which fixes them wherever they
 * are read from without a migration step anybody has to remember to run.
 */
function trueKindOf(saved: SavedCreation): CreationKind {
  if (saved.kind !== 'datapack') return saved.kind

  const body = saved.data as { rules?: unknown; recipes?: unknown } | null
  return Array.isArray(body?.rules) && !Array.isArray(body?.recipes) ? 'loot' : 'datapack'
}

/** Everything saved, newest first. */
export function listCreations(kind?: CreationKind): SavedCreation[] {
  const all = db()
    .all<SavedCreation>(Collections.creations)
    .map((saved) => ({ ...saved, kind: trueKindOf(saved) }))

  const wanted = kind ? all.filter((c) => c.kind === kind) : all
  return wanted.sort((a, b) => b.savedAt - a.savedAt)
}

export function saveCreation(input: {
  id?: string | null
  kind: CreationKind
  name: string
  data: unknown
  /** A small preview image, when the generator can make one cheaply. */
  thumbnail?: string | null
}): SavedCreation {
  const existing = input.id ? db().get<SavedCreation>(Collections.creations, input.id) : null

  if (!existing && listCreations().length >= LIMIT) {
    throw new LauncherError('INVALID_INPUT', 'the library is full', {
      title: 'The library is full',
      message: `There are already ${LIMIT} saved designs. Delete some to make room.`
    })
  }

  const creation: SavedCreation = {
    id: existing?.id ?? randomUUID(),
    kind: input.kind,
    name: input.name.trim().slice(0, 60) || 'Untitled',
    data: input.data,
    thumbnail: input.thumbnail ?? existing?.thumbnail ?? null,
    savedAt: Date.now()
  }

  db().put(Collections.creations, creation.id, creation)
  log.info(`saved a ${creation.kind} called "${creation.name}"`)

  return creation
}

export function deleteCreation(id: string): boolean {
  const existing = db().get<SavedCreation>(Collections.creations, id)
  if (!existing) return false

  db().remove(Collections.creations, id)
  return true
}

export function renameCreation(id: string, name: string): SavedCreation {
  const existing = db().get<SavedCreation>(Collections.creations, id)
  if (!existing) {
    throw new LauncherError('NOT_FOUND', 'no such design', {
      title: 'That design is gone',
      message: 'It may have been deleted in another window.'
    })
  }

  const renamed = { ...existing, name: name.trim().slice(0, 60) || existing.name }
  db().put(Collections.creations, id, renamed)
  return renamed
}
