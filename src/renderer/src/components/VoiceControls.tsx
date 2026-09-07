import { useCallback, useEffect, useState } from 'react'
import { Volume2, VolumeX, Download, Loader2 } from 'lucide-react'
import { api } from '../api'
import { availableVoices, hush, type VoiceSettings, type VoiceEngine } from './companionVoice'

/**
 * Turning the companion's voice on, and choosing it.
 *
 * Kept to a toggle, a voice and a speed. The temptation with speech synthesis
 * is to expose pitch, emphasis and per-companion overrides, and none of that
 * survives contact with a system voice — the meaningful choices are whether it
 * talks, which of the installed voices it uses, and how fast.
 *
 * Stored in the browser rather than the launcher's settings because it is a
 * property of this machine: which voices exist depends on what Windows has
 * installed, and a value synced from another PC would name a voice that is not
 * there.
 */

const STORAGE_KEY = 'companion-voice'

export function loadVoiceSettings(fallback: VoiceSettings): VoiceSettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw ? { ...fallback, ...(JSON.parse(raw) as Partial<VoiceSettings>) } : fallback
  } catch {
    // Private windows and cleared site data both land here; a default voice is
    // never worth failing a screen over.
    return fallback
  }
}

function save(settings: VoiceSettings): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    /* nothing worth doing */
  }
}

export function VoiceControls({
  settings,
  onChange
}: {
  settings: VoiceSettings
  onChange: (next: VoiceSettings) => void
}): JSX.Element {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(availableVoices())

  /*
   * What the neural voice is doing, if anything.
   *
   * Polled only while it is loading. The download is a few hundred megabytes
   * and takes a minute or so, and a progress-less spinner with no end in sight
   * is how people conclude an app has hung — so the state is visible and the
   * size is stated up front rather than discovered.
   */
  const [neural, setNeural] = useState<{
    state: string
    voices?: string[]
    message?: string
    servingToGame: boolean
    builds?: Record<string, { downloadMb: number; typicalMs: number }>
  }>({ state: 'idle', servingToGame: false })

  const refreshNeural = useCallback(async () => {
    try {
      setNeural(await api.voice.status())
    } catch {
      /* the panel still works with a system voice */
    }
  }, [])

  useEffect(() => {
    void refreshNeural()
  }, [refreshNeural])

  useEffect(() => {
    if (neural.state !== 'loading') return
    const timer = setInterval(() => void refreshNeural(), 1500)
    return () => clearInterval(timer)
  }, [neural.state, refreshNeural])

  useEffect(() => {
    /*
     * Chromium fills the voice list asynchronously and returns nothing on the
     * first call, so a dropdown built once at mount is reliably empty. This
     * fires when the list arrives.
     */
    const refresh = (): void => setVoices(availableVoices())
    refresh()
    window.speechSynthesis?.addEventListener('voiceschanged', refresh)
    return () => window.speechSynthesis?.removeEventListener('voiceschanged', refresh)
  }, [])

  function update(patch: Partial<VoiceSettings>): void {
    const next = { ...settings, ...patch }
    if (patch.enabled === false) hush()
    save(next)
    onChange(next)
  }

  return (
    <div className="row gap-12 wrap items-center">
      <button
        className={`btn btn-sm ${settings.enabled ? 'btn-primary' : ''}`}
        onClick={() => update({ enabled: !settings.enabled })}
        title={settings.enabled ? 'Stop reading its lines aloud' : 'Read its lines aloud'}
      >
        {settings.enabled ? <Volume2 size={14} /> : <VolumeX size={14} />}
        {settings.enabled ? 'Voice on' : 'Voice off'}
      </button>

      {settings.enabled && (
        <>
          <select
            className="input"
            style={{ maxWidth: 150 }}
            value={settings.engine}
            onChange={(event) => update({ engine: event.target.value as VoiceEngine })}
            title="Which engine speaks the lines"
          >
            <option value="system">System — instant</option>
            <option value="kokoro">Kokoro — offline</option>
          </select>

          {settings.engine === 'system' ? (
            <select
              className="input"
              style={{ maxWidth: 220 }}
              value={settings.voiceName}
              onChange={(event) => update({ voiceName: event.target.value })}
            >
              <option value="">Automatic (one per companion)</option>
              {voices.map((voice) => (
                <option key={voice.name} value={voice.name}>
                  {voice.name}
                </option>
              ))}
            </select>
          ) : neural.state === 'ready' ? (
            <>
              <select
                className="input"
                style={{ maxWidth: 160 }}
                value={settings.kokoroVoice}
                onChange={(event) => update({ kokoroVoice: event.target.value })}
              >
                {(neural.voices ?? []).map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>

              <label className="row gap-6 items-center tiny dim" title="Let the Hollow mod use this same voice in Minecraft">
                <input
                  type="checkbox"
                  checked={neural.servingToGame}
                  onChange={async (event) => {
                    await api.voice.serveToGame(event.target.checked)
                    void refreshNeural()
                  }}
                />
                also use in Minecraft
              </label>
            </>
          ) : neural.state === 'loading' ? (
            <span className="row gap-6 items-center tiny dim">
              <Loader2 size={13} className="spin" />
              downloading the voice model, once — about{' '}
              {neural.builds?.q4?.downloadMb ?? 300}MB
            </span>
          ) : (
            <button
              className="btn btn-sm"
              onClick={async () => {
                setNeural({ ...neural, state: 'loading' })
                try {
                  await api.voice.prepare('q4')
                } finally {
                  void refreshNeural()
                }
              }}
            >
              <Download size={13} />
              Get the voice (~{neural.builds?.q4?.downloadMb ?? 300}MB, once)
            </button>
          )}

          <div className="row gap-8 items-center">
            <span className="tiny dim">speed</span>
            <input
              className="slider"
              style={{ width: 90 }}
              type="range"
              min={0.6}
              max={1.8}
              step={0.05}
              value={settings.rate}
              onChange={(event) => update({ rate: Number(event.target.value) })}
            />
            <span className="tiny bold" style={{ minWidth: 30 }}>
              {settings.rate.toFixed(2)}×
            </span>
          </div>

          {settings.engine === 'system' && voices.length === 0 && (
            <span className="tiny dim">no speech voices installed on this PC</span>
          )}

          {neural.state === 'failed' && settings.engine === 'kokoro' && (
            <span className="tiny dim">voice model unavailable — {neural.message}</span>
          )}
        </>
      )}
    </div>
  )
}
