import { useEffect, useState } from 'react'
import { Volume2, VolumeX } from 'lucide-react'
import { availableVoices, hush, type VoiceSettings } from './companionVoice'

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

          {voices.length === 0 && (
            <span className="tiny dim">no speech voices installed on this PC</span>
          )}
        </>
      )}
    </div>
  )
}
