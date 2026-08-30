import { useCallback, useEffect, useState } from 'react'
import { HardHat, Play, Plus, Square, Trash2, Users } from 'lucide-react'
import type { Companion, Crew, CrewNote } from '@shared/companion'
import type { LauncherErrorPayload } from '@shared/types'
import { api, toPayload } from '../api'
import { ConfirmDialog, EmptyState, ErrorView, Spinner } from './ui'
import { formatRelative } from '../format'

/**
 * Crews: one companion in charge, the rest doing as they are told.
 *
 * The setup that pays off is a foreman on a real model directing workers on
 * scripted routines — one model's worth of tokens, five bots' worth of work —
 * so the picker says which of each companion is which rather than presenting
 * them as interchangeable.
 */
export function CrewPanel({
  companions,
  statuses
}: {
  companions: Companion[]
  statuses: Record<string, string>
}): JSX.Element {
  const [crews, setCrews] = useState<Crew[]>([])
  const [notes, setNotes] = useState<Record<string, CrewNote[]>>({})
  const [error, setError] = useState<LauncherErrorPayload | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [foremanId, setForemanId] = useState('')
  const [memberIds, setMemberIds] = useState<Set<string>>(() => new Set())
  const [disbanding, setDisbanding] = useState<Crew | null>(null)

  const load = useCallback(async () => {
    try {
      const list = await api.crews.list()
      setCrews(list)
      const gathered: Record<string, CrewNote[]> = {}
      for (const crew of list) {
        gathered[crew.id] = await api.crews.notes(crew.id).catch(() => [])
      }
      setNotes(gathered)
    } catch (err) {
      setError(toPayload(err))
    }
  }, [])

  useEffect(() => {
    void load()
    // The board only changes when a bot writes to it, which is rare enough
    // that polling every ten seconds is both cheap and fast enough to feel live.
    const timer = setInterval(() => void load(), 10_000)
    return () => clearInterval(timer)
  }, [load])

  const inACrew = new Set(crews.flatMap((crew) => [crew.foremanId, ...crew.memberIds]))
  const free = companions.filter((companion) => !inACrew.has(companion.id))
  const canLead = free.filter((companion) => !companion.routine && companion.model)

  async function create(): Promise<void> {
    if (!foremanId) return
    setBusy('create')
    try {
      await api.crews.create(newName || 'Crew', foremanId, [...memberIds])
      setCreating(false)
      setNewName('')
      setForemanId('')
      setMemberIds(new Set())
      await load()
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setBusy(null)
    }
  }

  async function act(crewId: string, action: 'start' | 'stop'): Promise<void> {
    setBusy(crewId)
    try {
      if (action === 'start') await api.crews.start(crewId)
      else await api.crews.stop(crewId)
      await load()
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setBusy(null)
    }
  }

  async function disband(): Promise<void> {
    if (!disbanding) return
    const target = disbanding
    setDisbanding(null)
    try {
      await api.crews.remove(target.id)
      await load()
    } catch (err) {
      setError(toPayload(err))
    }
  }

  const named = (id: string): Companion | undefined => companions.find((companion) => companion.id === id)

  return (
    <div className="col gap-16">
      {error && <ErrorView error={error} onDismiss={() => setError(null)} />}

      {crews.length === 0 && !creating ? (
        <div className="panel">
          <EmptyState
            icon={<Users size={24} />}
            title="No crews yet"
            message="A crew is one companion giving orders and the rest carrying them out. Put a model-driven foreman in charge of a few routine workers and they will split a job between them — mining, farming and hauling at the same time, for one model's worth of tokens."
            action={
              <button
                className="btn btn-primary btn-sm"
                disabled={companions.length < 2}
                onClick={() => setCreating(true)}
              >
                <Plus size={14} /> Form a crew
              </button>
            }
          />
          {companions.length < 2 && (
            <p className="field-hint" style={{ padding: '0 20px 20px' }}>
              You need at least two companions to make a crew. Add another above.
            </p>
          )}
        </div>
      ) : (
        <>
          {crews.map((crew) => {
            const foreman = named(crew.foremanId)
            const members = crew.memberIds.map(named).filter(Boolean) as Companion[]
            const anyRunning = [crew.foremanId, ...crew.memberIds].some(
              (id) => statuses[id] === 'playing' || statuses[id] === 'connecting'
            )
            const board = notes[crew.id] ?? []

            return (
              <div key={crew.id} className="panel panel-pad col gap-12">
                <div className="row between wrap gap-12">
                  <div className="row gap-10">
                    <Users size={17} style={{ color: 'var(--accent)' }} />
                    <div>
                      <div style={{ fontWeight: 650 }}>{crew.name}</div>
                      <div className="tiny dim">
                        {members.length + 1} companion{members.length === 0 ? '' : 's'} ·{' '}
                        {foreman?.username ?? 'unknown'} in charge
                      </div>
                    </div>
                  </div>
                  <div className="row gap-8">
                    {anyRunning ? (
                      <button
                        className="btn btn-sm btn-danger"
                        disabled={busy === crew.id}
                        onClick={() => void act(crew.id, 'stop')}
                      >
                        {busy === crew.id ? <Spinner /> : <Square size={13} />} Stop all
                      </button>
                    ) : (
                      <button
                        className="btn btn-sm btn-primary"
                        disabled={busy === crew.id}
                        onClick={() => void act(crew.id, 'start')}
                      >
                        {busy === crew.id ? <Spinner /> : <Play size={13} />} Start all
                      </button>
                    )}
                    <button className="btn btn-ghost btn-icon" title="Disband" onClick={() => setDisbanding(crew)}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                <div className="col gap-6">
                  <MemberRow companion={foreman} status={statuses[crew.foremanId]} foreman />
                  {members.map((member) => (
                    <MemberRow key={member.id} companion={member} status={statuses[member.id]} />
                  ))}
                </div>

                {board.length > 0 && (
                  <div className="panel panel-pad" style={{ background: 'var(--bg-2)' }}>
                    <div className="row between mb-8">
                      <span className="tiny dim">Crew notes</span>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => void api.crews.clearNotes(crew.id).then(load)}
                      >
                        Clear
                      </button>
                    </div>
                    <div className="col gap-6">
                      {board
                        .slice()
                        .reverse()
                        .slice(0, 8)
                        .map((note, index) => (
                          <div key={`${note.at}-${index}`} className="tiny">
                            <span style={{ color: 'var(--accent)' }}>{note.from}</span>{' '}
                            <span className="dim">{formatRelative(note.at)}</span>
                            <div style={{ color: 'var(--text-muted)' }}>{note.text}</div>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })}

          {!creating && free.length >= 2 && (
            <button className="btn btn-sm" onClick={() => setCreating(true)}>
              <Plus size={14} /> Form another crew
            </button>
          )}
        </>
      )}

      {creating && (
        <div className="panel panel-pad col gap-12">
          <div className="row between">
            <strong className="small">New crew</strong>
            <button className="btn btn-ghost btn-sm" onClick={() => setCreating(false)}>
              Cancel
            </button>
          </div>

          <label className="field">
            <span className="field-label">Name</span>
            <input
              className="input"
              placeholder="Mining Corp"
              value={newName}
              maxLength={40}
              onChange={(event) => setNewName(event.target.value)}
            />
          </label>

          <label className="field">
            <span className="field-label">Foreman</span>
            <select className="input" value={foremanId} onChange={(event) => setForemanId(event.target.value)}>
              <option value="">Choose who gives the orders</option>
              {canLead.map((companion) => (
                <option key={companion.id} value={companion.id}>
                  {companion.username} — {companion.model}
                </option>
              ))}
            </select>
            <span className="field-hint">
              A foreman decides what everyone else does, so it needs a model. Companions set to follow a routine cannot
              lead.
            </span>
          </label>

          <div className="field">
            <span className="field-label">Workers</span>
            <div className="col gap-6">
              {free
                .filter((companion) => companion.id !== foremanId)
                .map((companion) => (
                  <label key={companion.id} className="row gap-10" style={{ cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={memberIds.has(companion.id)}
                      onChange={(event) =>
                        setMemberIds((current) => {
                          const next = new Set(current)
                          if (event.target.checked) next.add(companion.id)
                          else next.delete(companion.id)
                          return next
                        })
                      }
                      style={{ accentColor: 'var(--accent)' }}
                    />
                    <span className="small">{companion.username}</span>
                    <span className="tiny dim">
                      {companion.routine ? `runs the ${companion.routine} routine` : companion.model || 'no model'}
                    </span>
                  </label>
                ))}
              {free.filter((companion) => companion.id !== foremanId).length === 0 && (
                <span className="tiny dim">Every other companion is already on a crew.</span>
              )}
            </div>
          </div>

          <button
            className="btn btn-primary btn-sm"
            disabled={!foremanId || busy === 'create'}
            onClick={() => void create()}
          >
            {busy === 'create' ? <Spinner /> : <Users size={14} />} Form the crew
          </button>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(disbanding)}
        title={`Disband "${disbanding?.name}"?`}
        message="The companions themselves are untouched — they just stop taking orders from each other."
        confirmLabel="Disband"
        onConfirm={() => void disband()}
        onCancel={() => setDisbanding(null)}
      />
    </div>
  )
}

function MemberRow({
  companion,
  status,
  foreman
}: {
  companion: Companion | undefined
  status: string | undefined
  foreman?: boolean
}): JSX.Element {
  if (!companion) return <div className="tiny dim">a companion that no longer exists</div>

  const live = status === 'playing' || status === 'connecting'

  return (
    <div className="row gap-10">
      {foreman ? (
        <HardHat size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />
      ) : (
        <span style={{ width: 14, flexShrink: 0 }} />
      )}
      {live && <span className="dot online" />}
      <span className="small" style={{ fontWeight: foreman ? 600 : 400 }}>
        {companion.username}
      </span>
      <span className="tiny dim">
        {foreman ? 'foreman · ' : ''}
        {companion.routine ? `${companion.routine} routine` : companion.model || 'no model'}
      </span>
      <div className="flex-1" />
      <span className="tiny dim">{live ? status : 'offline'}</span>
    </div>
  )
}
