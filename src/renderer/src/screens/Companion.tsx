import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Bot,
  Brain,
  CheckCircle2,
  ExternalLink,
  MessageSquare,
  RefreshCw,
  Play,
  Plus,
  Send,
  Server,
  Square,
  Target,
  Trash2,
  Wrench,
  Zap
} from 'lucide-react'
import type { Companion, CompanionEvent, CompanionSettings, CompanionState, CompanionStatus } from '@shared/companion'
import type { LauncherErrorPayload } from '@shared/types'
import { api, subscribe, toPayload } from '../api'
import { useStore } from '../store/useStore'
import { ErrorView, SettingRow, Spinner, Toggle, useAutoScroll } from '../components/ui'

const PROVIDERS: Array<{ id: string; label: string; baseUrl: string; needsKey: boolean; model: string; hint: string }> = [
  {
    id: 'ollama',
    label: 'Ollama (local)',
    baseUrl: 'http://localhost:11434/v1',
    needsKey: false,
    model: 'llama3.1',
    hint: 'Runs entirely on this PC. No key, no cost, and nothing leaves the machine.'
  },
  {
    id: 'glm',
    label: 'GLM (Zhipu AI)',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    needsKey: true,
    model: 'glm-4.6',
    hint: 'Uses your GLM API key. Press Load models — GLM retires model names, so any default here goes stale.'
  },
  {
    id: 'glm-intl',
    label: 'GLM (international)',
    baseUrl: 'https://api.z.ai/api/paas/v4',
    needsKey: true,
    model: 'glm-4.6',
    hint: 'Pay-as-you-go against your GLM wallet balance. Not the endpoint a Coding Plan subscription uses.'
  },
  {
    id: 'glm-coding',
    label: 'GLM Coding Plan',
    baseUrl: 'https://api.z.ai/api/coding/paas/v4',
    needsKey: true,
    // A Coding Plan only pays for a call when the base URL and the model both
    // qualify; otherwise the call silently falls through to the wallet balance
    // and fails as "insufficient balance" even though the subscription is live.
    model: 'glm-4.7',
    hint: 'For a GLM Coding Plan subscription. Only GLM-4.7, GLM-5-Turbo and GLM-5.3 draw on the plan — anything else bills your wallet.'
  },
  {
    id: 'openai',
    label: 'Other OpenAI-compatible',
    baseUrl: '',
    needsKey: true,
    model: '',
    hint: 'Any endpoint implementing /chat/completions.'
  }
]

const STATUS_STYLE: Record<CompanionStatus, { label: string; className: string }> = {
  idle: { label: 'Stopped', className: 'pill' },
  connecting: { label: 'Connecting', className: 'pill warning' },
  playing: { label: 'Playing', className: 'pill success' },
  disconnected: { label: 'Disconnected', className: 'pill warning' },
  error: { label: 'Error', className: 'pill danger' }
}

const EVENT_COLOUR: Record<CompanionEvent['kind'], string> = {
  status: 'var(--text-muted)',
  log: 'var(--text-dim)',
  chat: 'var(--text)',
  thought: 'var(--accent)',
  action: 'var(--info)',
  error: 'var(--danger)'
}

/**
 * Drives the AI companion: a real Minecraft player controlled by a language
 * model, running in its own process. Everything it decides and does is shown
 * live, so it is never a black box.
 */
export function CompanionScreen(): JSX.Element {
  const pushToast = useStore((s) => s.pushToast)

  const [companions, setCompanions] = useState<Companion[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [settings, setSettings] = useState<CompanionSettings | null>(null)
  const [state, setState] = useState<CompanionState | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [instruction, setInstruction] = useState('')
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)
  const [models, setModels] = useState<string[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [statuses, setStatuses] = useState<Record<string, CompanionStatus>>({})
  const [error, setError] = useState<LauncherErrorPayload | null>(null)
  const [tab, setTab] = useState<'activity' | 'setup'>('setup')

  const feedRef = useAutoScroll(state?.events.length ?? 0)

  const load = useCallback(async () => {
    try {
      const list = await api.companion.list()
      setCompanions(list)
      setSelectedId((current) => (current && list.some((c) => c.id === current) ? current : (list[0]?.id ?? null)))
    } catch (err) {
      setError(toPayload(err))
    }
  }, [])

  // Everything below is about whichever companion is selected.
  const loadSelected = useCallback(async (id: string) => {
    try {
      const [s, st] = await Promise.all([api.companion.settings(id), api.companion.state(id)])
      setSettings(s)
      setState(st)
      setModels([])
      if (st.status === 'playing' || st.status === 'connecting') setTab('activity')
    } catch (err) {
      setError(toPayload(err))
    }
  }, [])

  useEffect(() => {
    if (selectedId) void loadSelected(selectedId)
  }, [selectedId, loadSelected])

  useEffect(() => {
    void load()
  }, [load])

  // Live feed from the bot process.
  useEffect(() => {
    const offList = subscribe('companion:list', (list: Companion[]) => setCompanions(list))

    const offEvent = subscribe('companion:event', (event: CompanionEvent) => {
      // Several bots stream at once, so anything not from the selected one is
      // for a feed the user is not looking at.
      setState((current) =>
        current && event.companionId === current.companionId
          ? { ...current, events: [...current.events, event].slice(-400) }
          : current
      )
    })
    const offStatus = subscribe(
      'companion:status',
      (payload: {
        companionId: string
        status: CompanionStatus
        detail: string
        goal: string | null
        connectedVersion: string | null
        alive: boolean
      }) => {
        setStatuses((current) => ({ ...current, [payload.companionId]: payload.status }))
        setState((current) =>
          current && payload.companionId === current.companionId
            ? {
                ...current,
                status: payload.status,
                detail: payload.detail,
                goal: payload.goal,
                connectedVersion: payload.connectedVersion,
                alive: payload.alive
              }
            : current
        )
      }
    )
    const offMemory = subscribe('companion:memory', (payload: { companionId: string; notes: string[] }) => {
      setState((current) =>
        current && payload.companionId === current.companionId ? { ...current, memory: payload.notes } : current
      )
    })
    return () => {
      offList()
      offEvent()
      offStatus()
      offMemory()
    }
  }, [])

  async function patch(update: Partial<CompanionSettings> & { apiKey?: string }): Promise<void> {
    try {
      if (!selectedId) return
      setSettings(await api.companion.updateSettings(selectedId, update))
    } catch (err) {
      setError(toPayload(err))
    }
  }

  async function start(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      setState(await api.companion.start(selectedId!))
      setTab('activity')
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setBusy(false)
    }
  }

  async function stop(): Promise<void> {
    setBusy(true)
    try {
      setState(await api.companion.stop(selectedId!))
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setBusy(false)
    }
  }

  /** Asks the endpoint what it serves, so the model name stops being a guess. */
  async function loadModels(): Promise<void> {
    setLoadingModels(true)
    setError(null)
    try {
      const list = await api.companion.listModels(selectedId!)
      setModels(list)
      if (list.length === 0) {
        pushToast({ kind: 'warning', title: 'The endpoint listed no models' })
      } else {
        pushToast({ kind: 'success', title: `${list.length} models available` })
      }
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setLoadingModels(false)
    }
  }

  async function test(): Promise<void> {
    setTesting(true)
    setError(null)
    try {
      const result = await api.companion.testModel(selectedId!)
      pushToast({
        kind: 'success',
        title: `${result.model} replied in ${result.ms} ms`,
        message: result.reply ? `It said: "${result.reply}"` : 'The endpoint is reachable.'
      })
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setTesting(false)
    }
  }

  async function send(): Promise<void> {
    const text = instruction.trim()
    if (!text) return
    setInstruction('')
    try {
      await api.companion.instruct(selectedId!, text)
    } catch (err) {
      setError(toPayload(err))
    }
  }

  if (!settings || !state) {
    return (
      <div className="panel panel-pad row gap-12 muted">
        <Spinner /> Loading the companion…
      </div>
    )
  }

  const provider = PROVIDERS.find((p) => p.id === settings.provider) ?? PROVIDERS[0]
  /*
   * Offer Stop whenever a bot process exists, not merely when it is playing.
   * Deriving this from `status` hid the Stop button on a bot that had failed to
   * connect but was still alive, leaving Start as the only control — and Start
   * was refused because the process was there.
   */
  const running = state.alive
  const status = STATUS_STYLE[state.status]

  return (
    <>
      <div className="screen-header">
        <div>
          <div className="eyebrow">You</div>
          <h1>AI Companions</h1>
          <p className="subtitle">
            A language model playing Minecraft alongside you as a real player on your server. It talks in chat, follows
            you, gathers what you ask for, fights what attacks you, and decides things for itself when left alone.
          </p>
        </div>
        <div className="row gap-8">
          <span className={status.className}>
            {state.status === 'playing' && <span className="dot online" />}
            {status.label}
          </span>
          {running ? (
            <button className="btn btn-danger" disabled={busy} onClick={() => void stop()}>
              {busy ? <Spinner /> : <Square size={15} />} Stop
            </button>
          ) : (
            <button className="btn btn-primary" disabled={busy} onClick={() => void start()}>
              {busy ? <Spinner /> : <Play size={15} />} Start
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-16">
          <ErrorView error={error} onDismiss={() => setError(null)} />
        </div>
      )}

      {state.detail && state.status !== 'idle' && (
        <div className="panel panel-pad row gap-12 mb-16">
          <Server size={16} className="dim" />
          <span className="small muted flex-1">{state.detail}</span>
          {state.connectedVersion && <span className="pill">{state.connectedVersion}</span>}
        </div>
      )}

      {/*
        * One row per configured companion. Several can play at once — a local
        * Ollama model and a hosted one side by side, say — so the screen has to
        * show which is which rather than assuming a single bot.
        */}
      <div className="row gap-8 wrap mb-16">
        {companions.map((companion) => {
          const status = statuses[companion.id] ?? (companion.id === selectedId ? state?.status : 'idle')
          const live = status === 'playing' || status === 'connecting'
          return (
            <button
              key={companion.id}
              className={`panel panel-hover row gap-8 ${companion.id === selectedId ? 'selected' : ''}`}
              style={{ padding: '7px 12px', border: '1px solid var(--border)' }}
              onClick={() => setSelectedId(companion.id)}
            >
              {live && <span className="dot online" />}
              <span className="small">{companion.username}</span>
              <span className="tiny dim">{companion.model || 'no model'}</span>
            </button>
          )
        })}

        <button
          className="btn btn-ghost btn-sm"
          disabled={busy}
          onClick={() =>
            void (async () => {
              try {
                const created = await api.companion.create()
                setSelectedId(created.id)
                setTab('setup')
              } catch (err) {
                setError(toPayload(err))
              }
            })()
          }
        >
          <Plus size={14} /> Add companion
        </button>

        {companions.length > 1 && selectedId && (
          <button
            className="btn btn-ghost btn-sm danger"
            disabled={busy}
            onClick={() =>
              void (async () => {
                try {
                  await api.companion.remove(selectedId)
                  setSelectedId(null)
                } catch (err) {
                  setError(toPayload(err))
                }
              })()
            }
          >
            <Trash2 size={14} /> Remove
          </button>
        )}
      </div>

      <div className="tabs mb-24">
        <button className={`tab ${tab === 'activity' ? 'active' : ''}`} onClick={() => setTab('activity')}>
          Activity
        </button>
        <button className={`tab ${tab === 'setup' ? 'active' : ''}`} onClick={() => setTab('setup')}>
          Setup
        </button>
      </div>

      {tab === 'activity' ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 16, alignItems: 'start' }}>
          <div>
            <div
              ref={feedRef}
              className="panel"
              style={{ padding: 14, height: 460, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 7 }}
            >
              {state.events.length === 0 ? (
                <div className="muted small">
                  Nothing yet. Press Start, then talk to it in Minecraft chat or send an instruction below.
                </div>
              ) : (
                state.events.map((event) => (
                  <div key={event.id} className="row gap-8 items-start" style={{ fontSize: 12.5 }}>
                    <span className="tiny dim mono" style={{ minWidth: 52, flexShrink: 0 }}>
                      {new Date(event.at).toLocaleTimeString(undefined, { hour12: false })}
                    </span>
                    {event.kind === 'action' && <Wrench size={12} style={{ color: EVENT_COLOUR.action, marginTop: 3, flexShrink: 0 }} />}
                    {event.kind === 'thought' && <Brain size={12} style={{ color: EVENT_COLOUR.thought, marginTop: 3, flexShrink: 0 }} />}
                    {event.kind === 'chat' && <MessageSquare size={12} style={{ color: EVENT_COLOUR.chat, marginTop: 3, flexShrink: 0 }} />}
                    <span style={{ color: EVENT_COLOUR[event.kind], flex: 1, minWidth: 0, wordBreak: 'break-word' }}>
                      {event.from && <strong style={{ color: 'var(--accent)' }}>{event.from}: </strong>}
                      {event.tool && <span className="mono tiny dim">{event.tool} → </span>}
                      {event.text}
                    </span>
                  </div>
                ))
              )}
            </div>

            <div className="row gap-8 mt-16">
              <input
                className="input"
                placeholder={running ? 'Tell it what to do…' : 'Start the companion first'}
                value={instruction}
                disabled={!running}
                onChange={(event) => setInstruction(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void send()
                }}
              />
              <button className="btn btn-primary" disabled={!running || !instruction.trim()} onClick={() => void send()}>
                <Send size={15} /> Send
              </button>
            </div>
            <p className="field-hint mt-8">
              You can also just talk to it in Minecraft chat — it reads the server chat directly.
            </p>
          </div>

          <div className="col gap-16">
            <div className="panel panel-pad">
              <div className="row gap-8 mb-8">
                <Target size={15} style={{ color: 'var(--accent)' }} />
                <span className="section-title" style={{ margin: 0 }}>
                  Current goal
                </span>
              </div>
              <p className="small muted">{state.goal ?? 'Nothing in particular right now.'}</p>
            </div>

            <div className="panel panel-pad">
              <div className="row between mb-8">
                <div className="row gap-8">
                  <Brain size={15} style={{ color: 'var(--accent)' }} />
                  <span className="section-title" style={{ margin: 0 }}>
                    Memory ({state.memory.length})
                  </span>
                </div>
                {state.memory.length > 0 && (
                  <button
                    className="btn btn-ghost btn-icon"
                    title="Forget everything"
                    onClick={() => {
                      void api.companion.clearMemory(selectedId!).then(() => setState((c) => (c ? { ...c, memory: [] } : c)))
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
              {state.memory.length === 0 ? (
                <p className="small muted">
                  Nothing remembered yet. It saves notes for itself — where your base is, what it promised to do — and
                  they survive restarts.
                </p>
              ) : (
                <div className="col gap-4" style={{ maxHeight: 300, overflowY: 'auto' }}>
                  {state.memory.map((note, index) => (
                    <div key={index} className="tiny muted">
                      • {note}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
          {/* ------------------------------------------------------ model */}
          <div className="panel panel-pad">
            <div className="section-title">The brain</div>

            <div className="field">
              <label className="field-label">Provider</label>
              <select
                className="select"
                value={settings.provider}
                onChange={(event) => {
                  const next = PROVIDERS.find((p) => p.id === event.target.value)
                  if (!next) return
                  void patch({
                    provider: next.id,
                    baseUrl: next.baseUrl || settings.baseUrl,
                    model: next.model || settings.model
                  })
                }}
              >
                {PROVIDERS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
              <p className="field-hint">{provider.hint}</p>
            </div>

            <div className="field">
              <label className="field-label">Endpoint</label>
              <input
                className="input mono"
                value={settings.baseUrl}
                placeholder="http://localhost:11434/v1"
                onChange={(event) => setSettings({ ...settings, baseUrl: event.target.value })}
                onBlur={() => void patch({ baseUrl: settings.baseUrl })}
              />
            </div>

            <div className="field">
              <label className="field-label">Model</label>
              <div className="row gap-8">
                {models.length > 0 ? (
                  <select
                    className="input mono flex-1"
                    value={settings.model}
                    onChange={(event) => {
                      setSettings({ ...settings, model: event.target.value })
                      void patch({ model: event.target.value })
                    }}
                  >
                    {/* Keep whatever is configured selectable even if the endpoint omits it. */}
                    {!models.includes(settings.model) && settings.model && (
                      <option value={settings.model}>{settings.model} (not listed)</option>
                    )}
                    {models.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    className="input mono flex-1"
                    value={settings.model}
                    placeholder="llama3.1"
                    onChange={(event) => setSettings({ ...settings, model: event.target.value })}
                    onBlur={() => void patch({ model: settings.model })}
                  />
                )}
                <button className="btn btn-ghost" disabled={loadingModels} onClick={() => void loadModels()}>
                  {loadingModels ? <Spinner /> : <RefreshCw size={14} />} Load models
                </button>
              </div>
              <div className="field-hint">
                Model names change often and each endpoint serves its own set. Load the list rather than guessing —
                an unknown name is rejected with the provider's own wording, which is not always in English.
              </div>
            </div>

            <div className="field">
              <label className="field-label">Tools offered</label>
              <select
                className="input"
                value={settings.toolSet ?? 'full'}
                onChange={(event) => void patch({ toolSet: event.target.value as 'full' | 'core' })}
              >
                <option value="full">Everything (30 tools)</option>
                <option value="core">Essentials only (14 tools)</option>
              </select>
              <div className="field-hint">
                The full set is around 2,300 tokens of tool descriptions on every request. Large hosted models
                handle it; a 7B local model given thirty choices tends to stall or invent tool names. Essentials
                covers looking, moving, gathering, crafting, building, fighting and eating.
              </div>
            </div>

            {provider.needsKey && (
              <div className="field">
                <label className="field-label">API key</label>
                <div className="row gap-8">
                  <input
                    className="input mono"
                    type="password"
                    value={apiKey}
                    placeholder={settings.hasApiKey ? '•••••••• saved' : 'Paste your key'}
                    onChange={(event) => setApiKey(event.target.value)}
                  />
                  <button
                    className="btn btn-primary"
                    disabled={!apiKey.trim()}
                    onClick={() => {
                      void patch({ apiKey: apiKey.trim() })
                      setApiKey('')
                      pushToast({ kind: 'success', title: 'API key saved' })
                    }}
                  >
                    Save
                  </button>
                </div>
                <p className="field-hint">
                  Encrypted with Windows DPAPI, in the same store as your Microsoft token. It never reaches the
                  interface once saved.
                </p>
              </div>
            )}

            <button className="btn mt-8" disabled={testing} onClick={() => void test()}>
              {testing ? <Spinner /> : <CheckCircle2 size={15} />} Test the model
            </button>
          </div>

          {/* ---------------------------------------------------- server */}
          <div className="panel panel-pad">
            <div className="section-title">The server</div>

            <div className="row gap-12">
              <div className="field flex-1">
                <label className="field-label">Host</label>
                <input
                  className="input"
                  value={settings.host}
                  onChange={(event) => setSettings({ ...settings, host: event.target.value })}
                  onBlur={() => void patch({ host: settings.host })}
                />
              </div>
              <div className="field" style={{ width: 110 }}>
                <label className="field-label">Port</label>
                <input
                  className="input"
                  type="number"
                  value={settings.port}
                  onChange={(event) => setSettings({ ...settings, port: Number(event.target.value) })}
                  onBlur={() => void patch({ port: settings.port })}
                />
              </div>
            </div>

            <div className="field">
              <label className="field-label">Bot username</label>
              <input
                className="input"
                value={settings.username}
                onChange={(event) => setSettings({ ...settings, username: event.target.value })}
                onBlur={() => void patch({ username: settings.username })}
              />
            </div>

            <div className="field">
              <label className="field-label">How it signs in</label>
              <select
                className="select"
                value={settings.auth}
                onChange={(event) => void patch({ auth: event.target.value as 'offline' | 'microsoft' })}
              >
                <option value="offline">Your own LAN world or local server</option>
                <option value="microsoft">Microsoft account (needed for online servers)</option>
              </select>
              <p className="field-hint">
                {settings.auth === 'offline'
                  ? 'LAN worlds and local servers do not authenticate players, so the bot can join as a second player with no extra account. This only works for servers you host.'
                  : 'The bot signs in as a real player, so it needs its own Microsoft account that owns Minecraft — you cannot use the same account you are playing on.'}
              </p>
            </div>

            <div className="field">
              <label className="field-label">Minecraft version</label>
              <input
                className="input"
                value={settings.version}
                placeholder="auto-detect"
                onChange={(event) => setSettings({ ...settings, version: event.target.value })}
                onBlur={() => void patch({ version: settings.version })}
              />
              <p className="field-hint">
                Leave empty to detect it. The bot protocol library currently reaches <strong>26.1</strong>. It is
                volunteer-maintained and adds versions by hand, so it trails new Minecraft releases — sometimes by
                months. Newer instances will not connect until it catches up. This limits only the companion, not
                the game.
              </p>
            </div>

            <div className="field">
              <label className="field-label">Your username</label>
              <input
                className="input"
                value={settings.owner}
                placeholder="who it should listen to"
                onChange={(event) => setSettings({ ...settings, owner: event.target.value })}
                onBlur={() => void patch({ owner: settings.owner })}
              />
              <p className="field-hint">It treats this player's requests as priority and follows them by default.</p>
            </div>
          </div>

          {/* -------------------------------------------------- behaviour */}
          <div className="panel panel-pad" style={{ gridColumn: '1 / -1' }}>
            <div className="section-title">Behaviour</div>

            <SettingRow
              name="Act on its own"
              description="When nothing has been asked of it, the companion decides what to do — explore, gather, build, or just keep you company."
            >
              <Toggle checked={settings.autonomy} onChange={(value) => void patch({ autonomy: value })} />
            </SettingRow>

            <SettingRow
              name="Think every"
              description="How long it waits while idle before deciding something for itself. Longer is cheaper on a paid API."
            >
              <div className="row gap-12" style={{ width: 240 }}>
                <input
                  className="slider"
                  type="range"
                  min={10}
                  max={300}
                  step={5}
                  value={settings.idleIntervalSec}
                  onChange={(event) => setSettings({ ...settings, idleIntervalSec: Number(event.target.value) })}
                  onMouseUp={() => void patch({ idleIntervalSec: settings.idleIntervalSec })}
                />
                <span className="small bold" style={{ minWidth: 44 }}>
                  {settings.idleIntervalSec}s
                </span>
              </div>
            </SettingRow>

            <div className="field mt-16">
              <label className="field-label">Personality</label>
              <textarea
                className="textarea"
                style={{ minHeight: 100 }}
                value={settings.personality}
                onChange={(event) => setSettings({ ...settings, personality: event.target.value })}
                onBlur={() => void patch({ personality: settings.personality })}
              />
              <p className="field-hint">
                The system prompt. Change it to make the companion a chatty friend, a silent workhorse, or anything
                else. Applies immediately, even while it is running.
              </p>
            </div>

            <div className="divider" />

            <div className="row gap-12 items-start">
              <Zap size={16} style={{ color: 'var(--accent)', marginTop: 2, flexShrink: 0 }} />
              <div className="small muted">
                <strong style={{ color: 'var(--text)' }}>Getting started:</strong> open a singleplayer world and press{' '}
                <em>Open to LAN</em>, note the port it prints in chat, put that port above, then press Start. The
                companion joins as a second player. It can only use the tools it has been given — it never runs raw
                commands.
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
