import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  Boxes,
  Coffee,
  ExternalLink,
  FolderOpen,
  Info,
  KeyRound,
  RefreshCw,
  ShieldQuestion
} from 'lucide-react'
import type { JavaInstallation, LauncherErrorPayload } from '@shared/types'
import { api, toPayload, type MemoryInfo } from '../api'
import { useStore } from '../store/useStore'
import { ErrorView, SettingRow, Spinner, Toggle } from '../components/ui'
import { formatRam } from '../format'

const ACCENTS = ['#5eead4', '#818cf8', '#f472b6', '#fbbf24', '#4ade80', '#60a5fa', '#f87171', '#c084fc']

type Tab = 'general' | 'java' | 'appearance' | 'account' | 'content' | 'about'

export function SettingsScreen(): JSX.Element {
  const settings = useStore((s) => s.settings)
  const patch = useStore((s) => s.patchSettings)
  const info = useStore((s) => s.info)
  const pushToast = useStore((s) => s.pushToast)

  const [tab, setTab] = useState<Tab>('general')
  const [memory, setMemory] = useState<MemoryInfo | null>(null)
  const [javas, setJavas] = useState<JavaInstallation[]>([])
  const [error, setError] = useState<LauncherErrorPayload | null>(null)
  const [clientId, setClientId] = useState('')
  const [curseKey, setCurseKey] = useState('')
  const [directoryUrl, setDirectoryUrl] = useState('')
  const [checkingKey, setCheckingKey] = useState(false)
  const [detecting, setDetecting] = useState(false)

  useEffect(() => {
    void api.app.memory().then(setMemory).catch(() => setMemory(null))
    void api.java.list().then(setJavas).catch(() => setJavas([]))
  }, [])

  useEffect(() => {
    if (settings) {
      setClientId(settings.clientId)
      setCurseKey(settings.curseForgeApiKey)
      setDirectoryUrl(settings.directoryUrl)
    }
  }, [settings])

  if (!settings) {
    return (
      <div className="panel panel-pad row gap-12 muted">
        <Spinner /> Loading settings…
      </div>
    )
  }

  return (
    <>
      <div className="screen-header">
        <div>
          <div className="eyebrow">Launcher</div>
          <h1>Settings</h1>
          <p className="subtitle">Defaults for new instances, Java runtimes, appearance and Microsoft sign-in.</p>
        </div>
      </div>

      <div className="tabs mb-24">
        {(
          [
            ['general', 'General'],
            ['java', 'Java & memory'],
            ['appearance', 'Appearance'],
            ['account', 'Sign-in'],
            ['content', 'Content'],
            ['about', 'About']
          ] as Array<[Tab, string]>
        ).map(([key, label]) => (
          <button key={key} className={`tab ${tab === key ? 'active' : ''}`} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-16">
          <ErrorView error={error} onDismiss={() => setError(null)} />
        </div>
      )}

      {tab === 'general' && (
        <div className="panel panel-pad">
          <SettingRow
            name="Keep the launcher open while playing"
            description="Turn this off to minimise NexusCraft when Minecraft starts."
          >
            <Toggle
              checked={!settings.closeLauncherOnLaunch}
              onChange={(value) => void patch({ closeLauncherOnLaunch: !value })}
            />
          </SettingRow>

          <SettingRow
            name="Bring the launcher back when the game closes"
            description="Restores and focuses the launcher window as soon as Minecraft exits."
          >
            <Toggle
              checked={settings.restoreOnGameExit}
              onChange={(value) => void patch({ restoreOnGameExit: value })}
            />
          </SettingRow>

          <SettingRow
            name="Keep running in the tray when the window closes"
            description="Downloads, hosted servers and companions carry on with the window shut. Quit from the tray icon to stop everything."
          >
            <Toggle checked={settings.closeToTray} onChange={(value) => void patch({ closeToTray: value })} />
          </SettingRow>

          <SettingRow
            name="Desktop notifications"
            description="Tells you about crashes and finished downloads while you are in the game or another app."
          >
            <Toggle
              checked={settings.desktopNotifications}
              onChange={(value) => void patch({ desktopNotifications: value })}
            />
          </SettingRow>

          <SettingRow
            name="Show what you are playing in Discord"
            description="Puts the instance name, loader and elapsed time on your Discord profile. Does nothing if Discord is not running."
          >
            <Toggle
              checked={settings.discordPresence}
              onChange={(value) => void patch({ discordPresence: value })}
            />
          </SettingRow>

          <SettingRow
            name="Public server list"
            description="The Discover screen ships with a starter list of public servers. Point this at an https JSON feed to use your own instead — an array of { name, address, port, category, description }."
          >
            <div className="row gap-8" style={{ width: 340 }}>
              <input
                className="input mono"
                value={directoryUrl}
                placeholder="Built-in list"
                onChange={(event) => setDirectoryUrl(event.target.value)}
              />
              <button
                className="btn"
                disabled={directoryUrl.trim() === settings.directoryUrl}
                onClick={() => void patch({ directoryUrl: directoryUrl.trim() })}
              >
                Save
              </button>
            </div>
          </SettingRow>

          <SettingRow
            name="Show snapshots by default"
            description="Include development snapshots in version lists without switching the filter."
          >
            <Toggle checked={settings.showSnapshots} onChange={(value) => void patch({ showSnapshots: value })} />
          </SettingRow>

          <SettingRow
            name="Simultaneous downloads"
            description="Higher values are faster on good connections but can trip aggressive firewalls."
          >
            <div className="row gap-12" style={{ width: 220 }}>
              <input
                className="slider"
                type="range"
                min={1}
                max={16}
                value={settings.maxConcurrentDownloads}
                onChange={(event) => void patch({ maxConcurrentDownloads: Number(event.target.value) })}
              />
              <span className="small bold" style={{ minWidth: 22 }}>
                {settings.maxConcurrentDownloads}
              </span>
            </div>
          </SettingRow>

          <SettingRow name="Data folder" description="Where instances, versions, libraries and runtimes are stored.">
            <div className="row gap-8">
              <button className="btn btn-sm" onClick={() => void api.app.openPath(settings.dataDir)}>
                <FolderOpen size={14} /> Open
              </button>
              <button
                className="btn btn-sm"
                onClick={() => {
                  void api.app.pickDirectory('Choose a data folder').then((dir) => {
                    if (dir) void patch({ dataDir: dir })
                  })
                }}
              >
                Change
              </button>
            </div>
          </SettingRow>

          <p className="field-hint mt-16 mono selectable">{settings.dataDir}</p>
        </div>
      )}

      {tab === 'java' && (
        <>
          <div className="panel panel-pad mb-16">
            <div className="section-title">Default memory for new instances</div>

            <div className="field mb-16">
              <div className="row between">
                <label className="field-label">Maximum heap</label>
                <span className="small bold" style={{ color: 'var(--accent)' }}>
                  {formatRam(settings.defaultMaxRamMb)}
                </span>
              </div>
              <input
                className="slider"
                type="range"
                min={1024}
                max={memory?.ceiling ?? 8192}
                step={512}
                value={settings.defaultMaxRamMb}
                onChange={(event) => void patch({ defaultMaxRamMb: Number(event.target.value) })}
              />
              {memory && (
                <p className="field-hint">
                  This PC has {formatRam(memory.systemMb)} of RAM. NexusCraft will not offer more than{' '}
                  {formatRam(memory.ceiling)} so Windows keeps enough to stay responsive, and recommends{' '}
                  {formatRam(memory.max)}. Allocating far more than Minecraft needs usually causes longer garbage
                  collection pauses, not better performance.
                </p>
              )}
            </div>

            <div className="field">
              <div className="row between">
                <label className="field-label">Minimum heap</label>
                <span className="small muted">{formatRam(settings.defaultMinRamMb)}</span>
              </div>
              <input
                className="slider"
                type="range"
                min={512}
                max={settings.defaultMaxRamMb}
                step={256}
                value={settings.defaultMinRamMb}
                onChange={(event) => void patch({ defaultMinRamMb: Number(event.target.value) })}
              />
            </div>

            <div className="field mt-16">
              <label className="field-label">Default JVM arguments</label>
              <textarea
                className="textarea"
                value={settings.defaultJvmArgs}
                onChange={(event) => void patch({ defaultJvmArgs: event.target.value })}
              />
              <p className="field-hint">
                Applied to new instances. Memory flags are handled by the sliders above and are ignored here.
              </p>
            </div>
          </div>

          <div className="panel panel-pad">
            <div className="row between mb-16">
              <div className="section-title" style={{ margin: 0 }}>
                Java runtimes
              </div>
              <button
                className="btn btn-sm"
                disabled={detecting}
                onClick={() => {
                  setDetecting(true)
                  void api.java
                    .list(true)
                    .then(setJavas)
                    .catch((err) => setError(toPayload(err)))
                    .finally(() => setDetecting(false))
                }}
              >
                {detecting ? <Spinner /> : <RefreshCw size={14} />} Detect again
              </button>
            </div>

            {javas.length === 0 ? (
              <p className="small muted">
                No Java runtime detected. NexusCraft downloads the correct one from Mojang automatically the first time
                you launch a version that needs it.
              </p>
            ) : (
              <div className="col gap-8">
                {javas.map((java) => (
                  <div key={java.path} className="row gap-12">
                    <Coffee size={15} className="dim" />
                    <div className="flex-1" style={{ minWidth: 0 }}>
                      <div className="row gap-8">
                        <span style={{ fontWeight: 600 }}>Java {java.majorVersion}</span>
                        <span className="tiny dim">{java.version}</span>
                        {java.managed && <span className="pill accent">Managed</span>}
                        {settings.javaPath === java.path && <span className="pill">Selected</span>}
                      </div>
                      <div className="tiny dim truncate">{java.path}</div>
                    </div>
                    <button
                      className="btn btn-sm"
                      disabled={settings.javaPath === java.path}
                      onClick={() => void patch({ javaPath: java.path })}
                    >
                      Use
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="divider" />

            <SettingRow
              name="Java override"
              description="Leave empty so NexusCraft picks the runtime each Minecraft version requires. This is almost always what you want."
            >
              <div className="row gap-8">
                {settings.javaPath && (
                  <button className="btn btn-sm" onClick={() => void patch({ javaPath: null })}>
                    Clear
                  </button>
                )}
                <button
                  className="btn btn-sm"
                  onClick={() => {
                    void api.app
                      .pickFiles({ title: 'Select java.exe', extensions: ['exe'], multi: false })
                      .then(async (files) => {
                        if (!files[0]) return
                        try {
                          const probed = await api.java.test(files[0])
                          await patch({ javaPath: probed.path })
                          pushToast({
                            kind: 'success',
                            title: `Java ${probed.majorVersion} selected`,
                            message: probed.vendor
                          })
                        } catch (err) {
                          setError(toPayload(err))
                        }
                      })
                  }}
                >
                  Browse
                </button>
              </div>
            </SettingRow>

            {settings.javaPath && <p className="field-hint mono selectable mt-8">{settings.javaPath}</p>}
          </div>
        </>
      )}

      {tab === 'appearance' && (
        <div className="panel panel-pad">
          <SettingRow name="Animated background" description="Drifting light pools behind the interface.">
            <Toggle
              checked={settings.animatedBackground}
              onChange={(value) => void patch({ animatedBackground: value })}
            />
          </SettingRow>

          <SettingRow name="Particles" description="Slow-rising motes. Turn off to save a little GPU.">
            <Toggle checked={settings.particles} onChange={(value) => void patch({ particles: value })} />
          </SettingRow>

          <SettingRow name="Accent colour" description="Used for highlights, the Play button and progress bars.">
            <div className="row gap-8">
              {ACCENTS.map((color) => (
                <button
                  key={color}
                  aria-label={`Accent ${color}`}
                  onClick={() => void patch({ accentColor: color })}
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 8,
                    background: color,
                    border: settings.accentColor === color ? '2px solid var(--text)' : '2px solid transparent',
                    boxShadow: settings.accentColor === color ? `0 0 12px ${color}88` : undefined
                  }}
                />
              ))}
            </div>
          </SettingRow>
        </div>
      )}

      {tab === 'account' && (
        <div className="panel panel-pad">
          <div className="row gap-12 items-start mb-16">
            <KeyRound size={18} style={{ color: 'var(--accent)', marginTop: 2 }} />
            <div>
              <div style={{ fontWeight: 650 }}>Microsoft authentication</div>
              <p className="small muted mt-8" style={{ maxWidth: '68ch' }}>
                NexusCraft needs an Azure application (client) ID to identify itself to Microsoft. It is free, takes a
                few minutes to create, and is <strong>not</strong> a secret — it is safe to paste here and it is stored
                only on this PC.
              </p>
            </div>
          </div>

          <div className="field">
            <label className="field-label">Azure application (client) ID</label>
            <div className="row gap-8">
              <input
                className="input mono"
                value={clientId}
                placeholder="00000000-0000-0000-0000-000000000000"
                onChange={(event) => setClientId(event.target.value)}
              />
              <button
                className="btn btn-primary"
                disabled={clientId.trim() === settings.clientId}
                onClick={() => {
                  void patch({ clientId: clientId.trim() })
                  pushToast({ kind: 'success', title: 'Client ID saved', message: 'You can now sign in with Microsoft.' })
                }}
              >
                Save
              </button>
            </div>
            <p className="field-hint">
              {settings.clientId ? 'A client ID is configured. Sign-in is available.' : 'No client ID yet — sign-in is disabled until one is set.'}
            </p>
          </div>

          <div className="divider" />

          <div className="field">
            <label className="field-label">Sign-in method</label>
            <select
              className="select"
              value={settings.authFlow}
              onChange={(event) => void patch({ authFlow: event.target.value as 'device-code' | 'browser-redirect' })}
            >
              <option value="device-code">Device code — enter a short code on Microsoft's page</option>
              <option value="browser-redirect">Browser redirect — sign in and return automatically</option>
            </select>
            <p className="field-hint">
              Device code works with any Azure app that allows public client flows. Browser redirect is smoother but
              needs <code className="mono">http://localhost</code> registered as a redirect URI on the mobile and
              desktop platform.
            </p>
          </div>

          <div className="divider" />

          {/* Easy to miss, and the failure it causes looks like a config error
              anywhere else, so it gets its own callout rather than a footnote. */}
          <div
            className="panel panel-pad"
            style={{ borderColor: 'color-mix(in srgb, var(--warning) 32%, transparent)', background: 'color-mix(in srgb, var(--warning) 6%, transparent)' }}
          >
            <div className="row gap-12 items-start">
              <ShieldQuestion size={17} style={{ color: 'var(--warning)', marginTop: 2, flexShrink: 0 }} />
              <div className="flex-1">
                <div style={{ fontWeight: 650 }}>Your app also needs Mojang's approval</div>
                <p className="small muted mt-8">
                  A client ID alone is not enough. Since 2022 Mojang requires every Azure application to be approved
                  before it may use the Minecraft services API. Until it is approved, sign-in gets as far as Xbox Live
                  and then fails with HTTP 403 at the last step. Approval is free and is a one-time step for the
                  application, not for each player.
                </p>
                <div className="row gap-8 mt-16 wrap">
                  <button
                    className="btn btn-sm"
                    onClick={() => void api.app.openExternal('https://aka.ms/mce-reviewappid')}
                  >
                    <ExternalLink size={14} /> Apply for approval
                  </button>
                  <button
                    className="btn btn-sm"
                    onClick={() =>
                      void api.app.openExternal('https://help.minecraft.net/hc/en-us/articles/16254801392141')
                    }
                  >
                    <ExternalLink size={14} /> Mojang's guidance
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="divider" />

          <div className="col gap-8">
            <div className="section-title" style={{ margin: 0 }}>
              Creating a client ID
            </div>
            <ol className="small muted col gap-4" style={{ margin: 0, paddingLeft: 18 }}>
              <li>Open the Azure portal and go to Microsoft Entra ID → App registrations → New registration.</li>
              <li>Give it any name and choose "Personal Microsoft accounts only".</li>
              <li>Open the new app → Authentication → Advanced settings → enable "Allow public client flows".</li>
              <li>For browser redirect, add a platform → Mobile and desktop → tick <code className="mono">http://localhost</code>.</li>
              <li>Copy the Application (client) ID from the Overview page and paste it above.</li>
              <li>Apply for Mojang's approval using that client ID — see the notice above.</li>
            </ol>
            <button
              className="btn btn-sm mt-8"
              style={{ alignSelf: 'flex-start' }}
              onClick={() => void api.app.openExternal('https://portal.azure.com')}
            >
              <ExternalLink size={14} /> Open the Azure portal
            </button>
          </div>
        </div>
      )}

      {tab === 'content' && (
        <div className="panel panel-pad">
          <div className="row gap-12 items-start mb-16">
            <Boxes size={18} style={{ color: 'var(--accent)', marginTop: 2 }} />
            <div>
              <div style={{ fontWeight: 650 }}>Content sources</div>
              <p className="small muted mt-8" style={{ maxWidth: '68ch' }}>
                Modrinth works with no configuration at all. CurseForge additionally requires a free API key, which is
                issued instantly from their developer console and stored only on this PC.
              </p>
            </div>
          </div>

          <div className="field">
            <label className="field-label">CurseForge API key</label>
            <div className="row gap-8">
              <input
                className="input mono"
                type="password"
                value={curseKey}
                placeholder="Optional — leave empty to use Modrinth only"
                onChange={(event) => setCurseKey(event.target.value)}
              />
              <button
                className="btn btn-primary"
                disabled={curseKey.trim() === settings.curseForgeApiKey || checkingKey}
                onClick={() => {
                  const entered = curseKey.trim()

                  /*
                   * Check the key with CurseForge before calling it saved.
                   *
                   * This used to announce success the instant it was clicked,
                   * whatever had been pasted in, so a key that was never going
                   * to work looked accepted — and the first sign of trouble was
                   * a search failing later with a message that said nothing
                   * about the settings screen. Only CurseForge can settle
                   * whether a key works, so it gets asked here.
                   */
                  void (async () => {
                    setCheckingKey(true)
                    try {
                      await patch({ curseForgeApiKey: entered })

                      if (!entered) {
                        pushToast({ kind: 'success', title: 'CurseForge key cleared' })
                        return
                      }

                      const verdict = await api.curseforge.verify(entered)
                      pushToast({
                        kind: verdict.ok ? 'success' : 'error',
                        title: verdict.ok ? 'CurseForge key works' : 'CurseForge would not accept that key',
                        message: verdict.reason
                      })
                    } catch (err) {
                      pushToast({
                        kind: 'error',
                        title: 'Could not check the key',
                        message: (err as Error).message
                      })
                    } finally {
                      setCheckingKey(false)
                    }
                  })()
                }}
              >
                {checkingKey ? 'Checking…' : 'Save'}
              </button>
            </div>
            <p className="field-hint">
              {settings.curseForgeApiKey
                ? 'A key is configured — CurseForge appears in the Discover tab.'
                : 'No key yet. CurseForge search is disabled; Modrinth is unaffected.'}
            </p>
          </div>

          <div className="row gap-8 mt-16">
            <button className="btn btn-sm" onClick={() => void api.app.openExternal('https://console.curseforge.com')}>
              <ExternalLink size={14} /> Get a CurseForge key
            </button>
          </div>

          <div className="divider" />

          <div className="row gap-12 items-start">
            <AlertTriangle size={17} style={{ color: 'var(--warning)', marginTop: 2, flexShrink: 0 }} />
            <p className="small muted">
              CurseForge lets mod authors opt out of third-party downloads. Those mods cannot be installed
              automatically by any launcher, including this one — NexusCraft marks them “Manual only” and links to the
              page so you can download them yourself. Modrinth has no such restriction.
            </p>
          </div>
        </div>
      )}

      {tab === 'about' && info && (
        <div className="panel panel-pad">
          <div className="row gap-12 mb-16">
            <Info size={18} style={{ color: 'var(--accent)' }} />
            <div style={{ fontWeight: 650 }}>NexusCraft Launcher {info.version}</div>
          </div>

          <div className="col gap-8 small">
            <Row label="Electron" value={info.electron} />
            <Row label="Chromium" value={info.chrome} />
            <Row label="Node" value={info.node} />
            <Row label="Platform" value={`${info.platform} ${info.arch}`} />
            <Row label="Build" value={info.isPackaged ? 'Packaged' : 'Development'} />
            <Row label="Secure storage" value={info.secureStorage ? 'Available (DPAPI)' : 'Unavailable'} />
            <Row label="Data folder" value={info.dataDir} />
            <Row label="Logs" value={info.logsDir} />
          </div>

          <div className="row gap-8 mt-16">
            <button className="btn btn-sm" onClick={() => void api.app.openPath(info.logsDir)}>
              <FolderOpen size={14} /> Open logs folder
            </button>
          </div>

          <div className="divider" />

          <p className="small muted">
            NexusCraft is an independent launcher for Minecraft: Java Edition. It is not affiliated with, endorsed by,
            or associated with Mojang Studios or Microsoft. You need to own Minecraft: Java Edition to play. Game files
            are downloaded from Mojang's official servers, and sign-in uses Microsoft's official OAuth service.
          </p>
        </div>
      )}
    </>
  )
}

function Row({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="row between gap-16">
      <span className="dim">{label}</span>
      <span className="mono selectable truncate" style={{ maxWidth: '70%' }}>
        {value}
      </span>
    </div>
  )
}
