import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, ShieldCheck } from 'lucide-react'
import type { LauncherErrorPayload } from '@shared/types'
import { api, toPayload, type ModAutoUpdateSettings } from '../api'
import { ErrorView, SettingRow, Spinner, Toggle } from './ui'
import { formatRelative } from '../format'

/**
 * Keeping mods current without being asked.
 *
 * This sits in Settings rather than in Mods & Packs on purpose. The manual
 * updater lives per-instance, because that is where you act on it; the
 * schedule is one decision for the whole launcher, and burying it inside one
 * instance's tab is how the manual updater itself went unnoticed.
 */
export function ModAutoUpdate(): JSX.Element {
  const [settings, setSettings] = useState<ModAutoUpdateSettings | null>(null)
  const [error, setError] = useState<LauncherErrorPayload | null>(null)
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setSettings(await api.mods.autoUpdateSettings())
    } catch (err) {
      setError(toPayload(err))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function patch(update: Partial<Omit<ModAutoUpdateSettings, 'lastCheck'>>): Promise<void> {
    if (!settings) return
    setSettings({ ...settings, ...update })
    try {
      setSettings(await api.mods.setAutoUpdateSettings(update))
    } catch (err) {
      setError(toPayload(err))
      await load()
    }
  }

  async function checkNow(): Promise<void> {
    setChecking(true)
    setResult(null)
    try {
      const sweep = await api.mods.checkAllNow()
      const skipped = sweep.skipped > 0 ? `, ${sweep.skipped} skipped while running` : ''
      setResult(
        sweep.found === 0
          ? `Everything is up to date across ${sweep.checked} instance${sweep.checked === 1 ? '' : 's'}${skipped}.`
          : `${sweep.found} update${sweep.found === 1 ? '' : 's'} found` +
            (sweep.installed > 0 ? `, ${sweep.installed} installed` : '') +
            (sweep.heldBack > 0 ? `, ${sweep.heldBack} held for review` : '') +
            `${skipped}.`
      )
      await load()
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setChecking(false)
    }
  }

  if (!settings) {
    return (
      <div className="panel panel-pad row gap-12 muted">
        <Spinner /> Loading mod update settings…
      </div>
    )
  }

  return (
    <div className="panel panel-pad col gap-12">
      <div className="row gap-8">
        <RefreshCw size={16} className="dim" />
        <strong className="flex-1">Mod updates</strong>
        {settings.lastCheck && (
          <span className="pill" title={new Date(settings.lastCheck).toLocaleString()}>
            checked {formatRelative(settings.lastCheck)}
          </span>
        )}
      </div>

      {error && <ErrorView error={error} onDismiss={() => setError(null)} compact />}

      <SettingRow
        name="Check automatically"
        description="Looks for newer versions of your installed mods in the background. Checking never changes a file."
      >
        <div className="tabs">
          {(
            [
              ['off', 'Off'],
              ['notify', 'Tell me'],
              ['install', 'Install']
            ] as const
          ).map(([mode, label]) => (
            <button
              key={mode}
              className={`tab ${settings.mode === mode ? 'active' : ''}`}
              onClick={() => void patch({ mode })}
            >
              {label}
            </button>
          ))}
        </div>
      </SettingRow>

      {settings.mode !== 'off' && (
        <>
          <SettingRow name="How often" description="Hours between checks. A check runs shortly after startup too.">
            <div className="row gap-12" style={{ width: 220 }}>
              <input
                className="slider"
                type="range"
                min={1}
                max={72}
                step={1}
                value={settings.everyHours}
                onChange={(event) => setSettings({ ...settings, everyHours: Number(event.target.value) })}
                onMouseUp={() => void patch({ everyHours: settings.everyHours })}
              />
              <span className="small bold" style={{ minWidth: 46 }}>
                {settings.everyHours}h
              </span>
            </div>
          </SettingRow>

          {settings.mode === 'install' && (
            <SettingRow
              name="Hold back risky updates"
              description="Major version jumps and beta builds wait for you in Mods & Packs instead of installing on their own. These are the ones that break worlds and configs."
            >
              <Toggle checked={settings.reviewRisky} onChange={(value) => void patch({ reviewRisky: value })} />
            </SettingRow>
          )}
        </>
      )}

      <div className="row gap-12">
        <button className="btn" disabled={checking} onClick={() => void checkNow()}>
          {checking ? <Spinner /> : <RefreshCw size={15} />} Check every instance now
        </button>
        {result && <span className="small dim">{result}</span>}
      </div>

      <p className="field-hint row gap-8" style={{ alignItems: 'flex-start' }}>
        <ShieldCheck size={12} style={{ flexShrink: 0, marginTop: 3 }} />
        <span>
          Updates are found by hashing each jar and asking Modrinth what is newer, so mods installed from
          CurseForge are never included — there is no equivalent lookup for them. An instance that is running is
          left alone rather than having jars swapped underneath it, and anything installed automatically can be
          undone from Mods &amp; Packs.
        </span>
      </p>
    </div>
  )
}
