/**
 * Save it, refine it, or ask for several and pick one.
 *
 * The same three things every generator wanted, written once. Each screen keeps
 * its own preview — a banner and a firework look nothing alike — so this takes
 * a render function for that and knows nothing else about the shape of a
 * design.
 */
import { useCallback, useEffect, useState } from 'react'
import { Layers, Save, Trash2, Wand2 } from 'lucide-react'

import type { CreationKind, LauncherErrorPayload, SavedCreation } from '@shared/types'

import { api, toPayload } from '../api'
import { Modal, Spinner } from './ui'

/** Sends a request to whichever designer owns this kind. */
async function askFor(
  kind: CreationKind,
  text: string,
  brainId: string,
  current?: unknown
): Promise<unknown> {
  switch (kind) {
    case 'banner':
      return (await api.banners.design(text, brainId, current)).design
    case 'icon':
      return (await api.banners.designIcon(text, brainId, current)).art
    case 'motd':
      return (await api.banners.designMotd(text, brainId, current)).design
    case 'logo':
      return (await api.banners.designLogo(text, brainId, current)).design
    case 'firework':
      return (await api.banners.designFirework(text, brainId, current)).design
    /*
     * Datapacks were missing from here entirely, so they fell to the default
     * and were refined by the *item* designer - asking to make a recipe
     * cheaper handed back a sword.
     */
    case 'datapack':
      return (await api.banners.designRecipes(text, brainId, current as never)).pack
    case 'loot':
      return (await api.banners.designLoot(text, brainId, current as never)).pack
    default:
      return (await api.banners.designItem(text, brainId, current)).design
  }
}

export function DesignTools<T>({
  kind,
  design,
  name,
  prompt,
  brainId,
  busy,
  thumbnail,
  onLoad,
  onError,
  preview
}: {
  kind: CreationKind
  /** What would be saved, and what a refinement starts from. */
  design: T
  /** A suggested name for the save box. */
  name: string
  /** Where a batch of ideas gets its wording. */
  prompt: string
  brainId: string
  busy?: boolean
  /** A small PNG for the library strip, when the screen can make one. */
  thumbnail?: () => string | null
  onLoad: (data: T) => void
  onError: (error: LauncherErrorPayload) => void
  preview?: (data: T) => JSX.Element
}): JSX.Element {
  const [saved, setSaved] = useState<SavedCreation[]>([])
  const [title, setTitle] = useState(name)
  const [refinement, setRefinement] = useState('')
  const [working, setWorking] = useState(false)

  const [ideas, setIdeas] = useState<T[] | null>(null)
  const [asked, setAsked] = useState(0)

  const reload = useCallback(async () => {
    try {
      setSaved(await api.creations.list(kind))
    } catch (err) {
      onError(toPayload(err))
    }
  }, [kind, onError])

  useEffect(() => {
    void reload()
  }, [reload])

  // Follows the design's own name until somebody types over it.
  useEffect(() => setTitle(name), [name])

  /** Runs something that talks to the model, with the busy state around it. */
  const attempt = async (job: () => Promise<void>): Promise<void> => {
    setWorking(true)
    try {
      await job()
    } catch (err) {
      onError(toPayload(err))
    } finally {
      setWorking(false)
    }
  }

  const save = (): Promise<void> =>
    attempt(async () => {
      await api.creations.save({
        kind,
        name: title.trim() || 'Untitled',
        data: design,
        thumbnail: thumbnail?.() ?? null
      })
      await reload()
    })

  const remove = (id: string): Promise<void> =>
    attempt(async () => {
      await api.creations.remove(id)
      await reload()
    })

  const refine = (text: string): Promise<void> =>
    attempt(async () => {
      onLoad((await askFor(kind, text, brainId, design)) as T)
    })

  /**
   * Several at once.
   *
   * The results come back opaque, because one channel serves six generators
   * that share nothing but being JSON. The screen that asked knows what shape
   * it wanted, which is why drawing them is its job and not this one's.
   */
  const several = (): Promise<void> =>
    attempt(async () => {
      const got = await api.banners.variations(kind, prompt.trim(), brainId, 4)
      setIdeas(got.results as T[])
      setAsked(got.asked)
    })

  const submitRefinement = (): void => {
    const text = refinement.trim()
    if (!text || !brainId) return
    setRefinement('')
    void refine(text)
  }

  const canAsk = Boolean(brainId) && Boolean(prompt.trim())

  return (
    <>
      <div className="panel panel-pad col gap-12">
        <div className="section-title">
          <Save size={15} /> Keep it
        </div>

        <div className="row gap-8 wrap">
          <input
            className="input"
            style={{ flex: '1 1 160px' }}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Name it"
          />
          <button
            className="btn btn-primary btn-sm"
            disabled={busy || working}
            onClick={() => void save()}
          >
            <Save size={14} /> Save
          </button>
        </div>

        {saved.length === 0 ? (
          <p className="tiny dim">Nothing saved yet.</p>
        ) : (
          <div className="row gap-8 wrap">
            {saved.map((entry) => (
              <div
                key={entry.id}
                className="panel row gap-8"
                style={{ padding: 6, alignItems: 'center' }}
              >
                {entry.thumbnail && (
                  <img
                    src={entry.thumbnail}
                    alt=""
                    style={{ width: 24, height: 24, borderRadius: 4, imageRendering: 'pixelated' }}
                  />
                )}
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => onLoad(entry.data as T)}
                  title="Open this one"
                >
                  {entry.name}
                </button>
                <button
                  className="btn btn-ghost btn-icon"
                  onClick={() => void remove(entry.id)}
                  title="Delete"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="section-title mt-8">
          <Wand2 size={15} /> Change it
        </div>

        <div className="row gap-8 wrap">
          <input
            className="input"
            style={{ flex: '1 1 200px' }}
            value={refinement}
            onChange={(e) => setRefinement(e.target.value)}
            placeholder="make it darker, fewer layers, add a trail…"
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitRefinement()
            }}
          />
          <button
            className="btn btn-sm"
            disabled={busy || working || !brainId || !refinement.trim()}
            onClick={submitRefinement}
          >
            {working ? <Spinner /> : null} Refine
          </button>
          <button
            className="btn btn-sm"
            disabled={busy || working || !canAsk}
            onClick={() => void several()}
            title={canAsk ? 'Four takes on the prompt above' : 'Type a prompt first'}
          >
            <Layers size={14} /> Four ideas
          </button>
        </div>

        <p className="tiny dim">
          Refining starts from what is on screen. Four ideas start fresh from the prompt above.
        </p>
      </div>

      <Modal
        open={ideas !== null}
        title={
          ideas && asked > ideas.length ? `Pick one — ${ideas.length} of ${asked} came back` : 'Pick one'
        }
        onClose={() => setIdeas(null)}
        width={720}
      >
        <div className="row gap-12 wrap">
          {ideas?.map((idea, index) => (
            <button
              key={index}
              className="panel panel-hover panel-pad"
              style={{ cursor: 'pointer' }}
              onClick={() => {
                onLoad(idea)
                setIdeas(null)
              }}
            >
              {preview ? preview(idea) : <span className="small">Idea {index + 1}</span>}
            </button>
          ))}
        </div>
      </Modal>
    </>
  )
}
