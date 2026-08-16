import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  ArrowRight,
  Check,
  Copy,
  ExternalLink,
  Gamepad2,
  KeyRound,
  Loader2,
  Package,
  ShieldCheck,
  Sparkles
} from 'lucide-react'
import type { LauncherErrorPayload, LoaderId, VersionSummary } from '@shared/types'
import { api, isCancellation, toPayload } from '../api'
import { useStore, activeAccount } from '../store/useStore'
import { ErrorView, ProgressBar, Spinner } from '../components/ui'
import { DeviceCodePanel } from '../components/DeviceCodePanel'
import { LogoLockup } from '../components/Logo'
import { SkinBody } from '../components/SkinView'
import { formatBytes, formatEta, formatSpeed, LOADER_LABELS } from '../format'

type Step = 'welcome' | 'signin' | 'ownership' | 'version' | 'installing' | 'done'

const STEP_ORDER: Step[] = ['welcome', 'signin', 'ownership', 'version', 'installing', 'done']

/**
 * The first-run path: welcome, sign in, confirm the account owns the game,
 * choose a version, install it, play. Each step does real work — nothing here
 * is a placeholder.
 */
export function Onboarding(): JSX.Element {
  const [step, setStep] = useState<Step>('welcome')
  const [error, setError] = useState<LauncherErrorPayload | null>(null)

  const account = useStore(activeAccount)
  const signingIn = useStore((s) => s.signingIn)
  const setSigningIn = useStore((s) => s.setSigningIn)
  const deviceCode = useStore((s) => s.deviceCode)
  const authProgress = useStore((s) => s.authProgress)
  const settings = useStore((s) => s.settings)
  const patchSettings = useStore((s) => s.patchSettings)
  const refreshInstances = useStore((s) => s.refreshInstances)
  const navigate = useStore((s) => s.navigate)
  const downloads = useStore((s) => s.downloads)

  const [manifest, setManifest] = useState<VersionSummary[] | null>(null)
  const [latestRelease, setLatestRelease] = useState<string>('')
  const [chosenVersion, setChosenVersion] = useState<string>('')
  const [chosenLoader, setChosenLoader] = useState<LoaderId>('vanilla')
  const [instanceName, setInstanceName] = useState('My first instance')
  const [installing, setInstalling] = useState(false)
  const [createdInstanceId, setCreatedInstanceId] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const stepIndex = STEP_ORDER.indexOf(step)
  const download = Object.values(downloads).find((d) => d.active || d.phase === 'error') ?? null

  /* Skip straight past sign-in when a session was restored at startup. */
  useEffect(() => {
    if (step === 'signin' && account) setStep('ownership')
  }, [account, step])

  /* Load the version list as soon as we know the user is signed in. */
  useEffect(() => {
    if (step !== 'version' || manifest) return
    void (async () => {
      try {
        const info = await api.versions.manifest()
        setManifest(info.versions)
        setLatestRelease(info.latestRelease)
        setChosenVersion(info.latestRelease)
      } catch (err) {
        setError(toPayload(err))
      }
    })()
  }, [step, manifest])

  const releases = useMemo(
    () => (manifest ?? []).filter((v) => v.type === 'release').slice(0, 40),
    [manifest]
  )

  async function startSignIn(): Promise<void> {
    setError(null)
    setSigningIn(true)
    try {
      await api.auth.begin()
      setStep('ownership')
    } catch (err) {
      // Superseded or cancelled sign-ins are expected, not errors.
      if (!isCancellation(err)) setError(toPayload(err))
    } finally {
      setSigningIn(false)
    }
  }

  async function createAndInstall(): Promise<void> {
    setError(null)
    setInstalling(true)
    setStep('installing')
    try {
      const instance = await api.instances.create({
        name: instanceName.trim() || `Minecraft ${chosenVersion}`,
        minecraftVersion: chosenVersion,
        loader: chosenLoader
      })
      setCreatedInstanceId(instance.id)
      await api.instances.install(instance.id)
      await patchSettings({ selectedInstanceId: instance.id })
      await refreshInstances()
      setStep('done')
    } catch (err) {
      setError(toPayload(err))
      setStep('version')
    } finally {
      setInstalling(false)
    }
  }

  async function finish(): Promise<void> {
    await patchSettings({ onboardingComplete: true })
    navigate('play')
  }

  async function launchNow(): Promise<void> {
    await patchSettings({ onboardingComplete: true })
    navigate('play')
    if (createdInstanceId) {
      try {
        await api.launch.start(createdInstanceId)
      } catch (err) {
        setError(toPayload(err))
      }
    }
  }

  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '100%', padding: '10px 0 30px' }}>
      <div style={{ width: '100%', maxWidth: 760 }}>
        {/* progress rail */}
        <div className="row gap-8 mb-24" style={{ justifyContent: 'center' }}>
          {STEP_ORDER.slice(0, 5).map((entry, index) => (
            <div
              key={entry}
              style={{
                height: 3,
                width: 52,
                borderRadius: 99,
                background: index <= stepIndex ? 'var(--accent)' : 'rgba(255,255,255,0.1)',
                boxShadow: index <= stepIndex ? '0 0 12px var(--accent-glow)' : undefined,
                transition: 'background 0.4s ease, box-shadow 0.4s ease'
              }}
            />
          ))}
        </div>

        <motion.div
          key={step}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          className="panel"
          style={{ padding: 34, background: 'rgba(12,17,26,0.66)' }}
        >
          {step === 'welcome' && (
            <div className="col gap-24">
              <LogoLockup size={58} />
              <div>
                <h1 style={{ fontSize: 32 }}>A better way to play Minecraft</h1>
                <p className="muted mt-8" style={{ maxWidth: '56ch' }}>
                  NexusCraft manages separate instances, mod loaders, Java runtimes and worlds — and launches the real
                  game with your own Microsoft account.
                </p>
              </div>

              <div className="col gap-12">
                <Feature
                  icon={<Package size={17} />}
                  title="Isolated instances"
                  text="Every setup gets its own mods, worlds and settings. Nothing bleeds between them."
                />
                <Feature
                  icon={<ShieldCheck size={17} />}
                  title="Official Microsoft sign-in"
                  text="You sign in on Microsoft's own page. NexusCraft never sees or stores your password."
                />
                <Feature
                  icon={<Sparkles size={17} />}
                  title="Handles the boring parts"
                  text="Java runtimes, libraries, assets and mod loaders are installed and verified for you."
                />
              </div>

              <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} onClick={() => setStep('signin')}>
                Get started <ArrowRight size={16} />
              </button>
            </div>
          )}

          {step === 'signin' && (
            <div className="col gap-20">
              <StepHeading
                icon={<KeyRound size={20} />}
                eyebrow="Step 1"
                title="Sign in with Microsoft"
                text="Minecraft: Java Edition accounts are Microsoft accounts. You will finish signing in on Microsoft's own website."
              />

              {!settings?.clientId && (
                <ErrorView
                  error={{
                    code: 'AUTH_NOT_CONFIGURED',
                    title: 'This build needs an Azure client ID first',
                    message:
                      'NexusCraft identifies itself to Microsoft with an Azure application (client) ID. This build does not have one yet. It is free to create and is not a secret.',
                    actions: [
                      'Open Settings → Account and paste your client ID',
                      'The README has step-by-step instructions under "Configuring Microsoft authentication"'
                    ],
                    detail: null
                  }}
                  compact
                />
              )}

              {deviceCode ? (
                <DeviceCodePanel prompt={deviceCode} />
              ) : (
                <button
                  className="btn btn-primary"
                  style={{ alignSelf: 'flex-start', padding: '12px 22px' }}
                  disabled={signingIn || !settings?.clientId}
                  onClick={() => void startSignIn()}
                >
                  {signingIn ? <Spinner /> : <MicrosoftMark />}
                  {signingIn ? 'Waiting for Microsoft…' : 'Sign in with Microsoft'}
                </button>
              )}

              {signingIn && (
                <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => void api.auth.cancel()}>
                  Cancel sign-in
                </button>
              )}

              {error && <ErrorView error={error} onRetry={() => void startSignIn()} onDismiss={() => setError(null)} />}
            </div>
          )}

          {step === 'ownership' && account && (
            <div className="col gap-20">
              <StepHeading
                icon={<ShieldCheck size={20} />}
                eyebrow="Step 2"
                title="Checking your Minecraft access"
                text="NexusCraft asked Mojang whether this account can play Java Edition."
              />

              <div className="row gap-20 items-start">
                <SkinBody skinDataUrl={account.skinDataUrl} variant={account.skinVariant} height={170} dramatic />
                <div className="col gap-12 flex-1">
                  <div>
                    <div className="field-label">Signed in as</div>
                    <div style={{ fontSize: 22, fontFamily: 'var(--font-display)', fontWeight: 650 }}>
                      {account.username}
                    </div>
                    {account.gamertag && <div className="small muted">Xbox gamertag: {account.gamertag}</div>}
                  </div>

                  {account.ownsMinecraft ? (
                    <div className="pill success" style={{ alignSelf: 'flex-start', padding: '5px 12px' }}>
                      <Check size={13} />
                      {account.entitlementSource === 'game_pass'
                        ? 'Java Edition through Game Pass'
                        : 'Owns Minecraft: Java Edition'}
                    </div>
                  ) : (
                    <div className="pill danger" style={{ alignSelf: 'flex-start' }}>
                      No Java Edition access on this account
                    </div>
                  )}
                </div>
              </div>

              <div className="row gap-10">
                <button className="btn btn-primary" disabled={!account.ownsMinecraft} onClick={() => setStep('version')}>
                  Continue <ArrowRight size={16} />
                </button>
                <button className="btn" onClick={() => void api.auth.logout(account.id).then(() => setStep('signin'))}>
                  Use a different account
                </button>
              </div>
            </div>
          )}

          {step === 'version' && (
            <div className="col gap-20">
              <StepHeading
                icon={<Gamepad2 size={20} />}
                eyebrow="Step 3"
                title="Choose what to install"
                text="Pick a Minecraft version and, if you want mods, a loader. You can add more instances later."
              />

              {!manifest ? (
                <div className="row gap-12 muted">
                  <Spinner /> Loading versions from Mojang…
                </div>
              ) : (
                <>
                  <div className="field">
                    <label className="field-label">Instance name</label>
                    <input
                      className="input"
                      value={instanceName}
                      maxLength={64}
                      onChange={(event) => setInstanceName(event.target.value)}
                    />
                  </div>

                  <div className="row gap-12">
                    <div className="field flex-1">
                      <label className="field-label">Minecraft version</label>
                      <select
                        className="select"
                        value={chosenVersion}
                        onChange={(event) => setChosenVersion(event.target.value)}
                      >
                        {releases.map((version) => (
                          <option key={version.id} value={version.id}>
                            {version.id}
                            {version.id === latestRelease ? '  (latest)' : ''}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="field flex-1">
                      <label className="field-label">Mod loader</label>
                      <select
                        className="select"
                        value={chosenLoader}
                        onChange={(event) => setChosenLoader(event.target.value as LoaderId)}
                      >
                        {(['vanilla', 'fabric', 'forge', 'neoforge', 'quilt'] as LoaderId[]).map((loader) => (
                          <option key={loader} value={loader}>
                            {LOADER_LABELS[loader]}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <p className="field-hint">
                    {chosenLoader === 'vanilla'
                      ? 'Vanilla is the unmodified game. Choose a loader if you plan to install mods.'
                      : `${LOADER_LABELS[chosenLoader]} will be downloaded and installed for Minecraft ${chosenVersion}.`}
                  </p>

                  <button
                    className="btn btn-primary"
                    style={{ alignSelf: 'flex-start' }}
                    disabled={!chosenVersion || installing}
                    onClick={() => void createAndInstall()}
                  >
                    Install and continue <ArrowRight size={16} />
                  </button>
                </>
              )}

              {error && <ErrorView error={error} onDismiss={() => setError(null)} />}
            </div>
          )}

          {step === 'installing' && (
            <div className="col gap-20">
              <StepHeading
                icon={<Loader2 size={20} />}
                eyebrow="Step 4"
                title="Installing Minecraft"
                text="Downloading the client, libraries, assets and a matching Java runtime. This only happens once per version."
              />

              {download ? (
                <div className="col gap-12">
                  <div className="row between small">
                    <span className="bold">{download.label}</span>
                    <span className="muted">
                      {download.completedFiles} / {download.totalFiles} files
                    </span>
                  </div>
                  <ProgressBar
                    value={download.totalBytes > 0 ? download.downloadedBytes / download.totalBytes : 0}
                    indeterminate={download.totalBytes === 0}
                  />
                  <div className="row between tiny dim">
                    <span className="truncate" style={{ maxWidth: '48%' }}>
                      {download.currentFile}
                    </span>
                    <span>
                      {formatSpeed(download.speedBps)} · {formatBytes(download.downloadedBytes)} of{' '}
                      {formatBytes(download.totalBytes)} · {formatEta(download.etaSeconds)} left
                    </span>
                  </div>
                </div>
              ) : (
                <div className="row gap-12 muted">
                  <Spinner /> Preparing…
                </div>
              )}
            </div>
          )}

          {step === 'done' && (
            <div className="col gap-20">
              <StepHeading
                icon={<Check size={20} />}
                eyebrow="All set"
                title="You are ready to play"
                text="Your instance is installed and verified. The Play screen is where you launch it from now on."
              />
              <div className="row gap-10">
                <button className="btn btn-primary" onClick={() => void launchNow()}>
                  Launch Minecraft <ArrowRight size={16} />
                </button>
                <button className="btn" onClick={() => void finish()}>
                  Go to the launcher
                </button>
              </div>
            </div>
          )}
        </motion.div>
      </div>
    </div>
  )
}

function StepHeading({
  icon,
  eyebrow,
  title,
  text
}: {
  icon: JSX.Element
  eyebrow: string
  title: string
  text: string
}): JSX.Element {
  return (
    <div className="row gap-16 items-start">
      <div
        style={{
          width: 42,
          height: 42,
          borderRadius: 13,
          display: 'grid',
          placeItems: 'center',
          background: 'var(--accent-dim)',
          color: 'var(--accent)',
          flexShrink: 0
        }}
      >
        {icon}
      </div>
      <div>
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'var(--accent)'
          }}
        >
          {eyebrow}
        </div>
        <h2 className="mt-8">{title}</h2>
        <p className="muted small mt-8" style={{ maxWidth: '58ch' }}>
          {text}
        </p>
      </div>
    </div>
  )
}

function Feature({ icon, title, text }: { icon: JSX.Element; title: string; text: string }): JSX.Element {
  return (
    <div className="row gap-12 items-start">
      <div
        style={{
          width: 34,
          height: 34,
          borderRadius: 11,
          display: 'grid',
          placeItems: 'center',
          background: 'var(--panel-strong)',
          border: '1px solid var(--border)',
          color: 'var(--accent)',
          flexShrink: 0
        }}
      >
        {icon}
      </div>
      <div>
        <div style={{ fontWeight: 600 }}>{title}</div>
        <div className="small muted">{text}</div>
      </div>
    </div>
  )
}

/** The Microsoft four-square mark, drawn inline so nothing loads remotely. */
export function MicrosoftMark({ size = 15 }: { size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 23 23" aria-hidden>
      <rect x="1" y="1" width="10" height="10" fill="#f25022" />
      <rect x="12" y="1" width="10" height="10" fill="#7fba00" />
      <rect x="1" y="12" width="10" height="10" fill="#00a4ef" />
      <rect x="12" y="12" width="10" height="10" fill="#ffb900" />
    </svg>
  )
}
