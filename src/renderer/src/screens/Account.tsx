import { useState } from 'react'
import { Check, Copy, ExternalLink, LogOut, Plus, RefreshCw, Shield, ShieldCheck, ShieldAlert, UserCircle2 } from 'lucide-react'
import type { Account, LauncherErrorPayload } from '@shared/types'
import { api, isCancellation, toPayload } from '../api'
import { useStore, activeAccount } from '../store/useStore'
import { ConfirmDialog, ErrorView, Spinner } from '../components/ui'
import { SkinBody, SkinFace } from '../components/SkinView'
import { DeviceCodePanel } from '../components/DeviceCodePanel'
import { MicrosoftMark } from './Onboarding'
import { formatRelative } from '../format'

export function AccountScreen(): JSX.Element {
  const accounts = useStore((s) => s.accounts)
  const active = useStore(activeAccount)
  const signingIn = useStore((s) => s.signingIn)
  const setSigningIn = useStore((s) => s.setSigningIn)
  const deviceCode = useStore((s) => s.deviceCode)
  const authProgress = useStore((s) => s.authProgress)
  const settings = useStore((s) => s.settings)
  const info = useStore((s) => s.info)
  const refreshAccounts = useStore((s) => s.refreshAccounts)
  const navigate = useStore((s) => s.navigate)

  const [error, setError] = useState<LauncherErrorPayload | null>(null)
  const [signingOut, setSigningOut] = useState<Account | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  async function signIn(): Promise<void> {
    setError(null)
    setSigningIn(true)
    try {
      await api.auth.begin()
    } catch (err) {
      // Superseded or cancelled sign-ins are expected, not errors.
      if (!isCancellation(err)) setError(toPayload(err))
    } finally {
      setSigningIn(false)
    }
  }

  async function refresh(accountId: string): Promise<void> {
    setRefreshing(true)
    try {
      await api.auth.refresh(accountId)
      await refreshAccounts()
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <>
      <div className="screen-header">
        <div>
          <div className="eyebrow">You</div>
          <h1>Account</h1>
          <p className="subtitle">
            NexusCraft signs in through Microsoft's official OAuth flow. Your password is typed on Microsoft's own page
            and is never seen, requested or stored by this launcher.
          </p>
        </div>
        {accounts.length > 0 && (
          <button className="btn" disabled={signingIn} onClick={() => void signIn()}>
            <Plus size={15} /> Add account
          </button>
        )}
      </div>

      {error && (
        <div className="mb-16">
          <ErrorView error={error} onDismiss={() => setError(null)} />
        </div>
      )}

      {/* device code prompt */}
      {deviceCode && (
        <div className="mb-24">
          <DeviceCodePanel prompt={deviceCode} />
        </div>
      )}

      {/* signed out */}
      {accounts.length === 0 ? (
        <div className="panel panel-pad" style={{ padding: 40, textAlign: 'center' }}>
          <div className="col gap-16" style={{ alignItems: 'center' }}>
            <div
              style={{
                width: 62,
                height: 62,
                borderRadius: 20,
                display: 'grid',
                placeItems: 'center',
                background: 'var(--panel-strong)',
                border: '1px solid var(--border)',
                color: 'var(--text-dim)'
              }}
            >
              <UserCircle2 size={28} />
            </div>
            <h2>No account signed in</h2>
            <p className="muted small" style={{ maxWidth: '52ch' }}>
              Sign in with the Microsoft account that owns Minecraft: Java Edition. NexusCraft will check your licence
              with Mojang and load your profile and skin.
            </p>

            {!settings?.clientId && (
              <div style={{ maxWidth: 560, width: '100%', textAlign: 'left' }}>
                <ErrorView
                  error={{
                    code: 'AUTH_NOT_CONFIGURED',
                    title: 'An Azure client ID is needed first',
                    message:
                      'NexusCraft identifies itself to Microsoft using an Azure application (client) ID. It is free to create, takes a couple of minutes, and is not a secret.',
                    actions: [
                      'Open Settings → Account and paste your client ID',
                      'Follow "Configuring Microsoft authentication" in the README'
                    ],
                    detail: null
                  }}
                  compact
                />
              </div>
            )}

            <button
              className="btn btn-primary"
              style={{ padding: '12px 24px' }}
              disabled={signingIn || !settings?.clientId}
              onClick={() => void signIn()}
            >
              {signingIn ? <Spinner /> : <MicrosoftMark />}
              {signingIn ? 'Waiting for Microsoft…' : 'Sign in with Microsoft'}
            </button>

            {!settings?.clientId && (
              <button className="link small" onClick={() => navigate('settings')}>
                Go to Settings → Account
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          {/* active account */}
          {active && (
            <div className="panel panel-pad mb-24">
              <div className="row gap-24 items-start wrap">
                <SkinBody skinDataUrl={active.skinDataUrl} variant={active.skinVariant} height={220} dramatic />

                <div className="flex-1 col gap-16" style={{ minWidth: 250 }}>
                  <div>
                    <span className="pill accent mb-8">Active account</span>
                    <h1 style={{ fontSize: 30 }}>{active.username}</h1>
                    {active.gamertag && (
                      <p className="muted mt-8">
                        Xbox gamertag: <strong style={{ color: 'var(--text)' }}>{active.gamertag}</strong>
                      </p>
                    )}
                  </div>

                  <div className="col gap-8">
                    <EntitlementBadge account={active} />
                    <div className="row gap-8 small muted">
                      <Shield size={14} />
                      Session valid until {new Date(active.expiresAt).toLocaleTimeString()} — renewed automatically
                    </div>
                    {info && (
                      <div className="row gap-8 small muted">
                        {info.secureStorage ? <ShieldCheck size={14} /> : <ShieldAlert size={14} />}
                        {info.secureStorage
                          ? 'Sign-in token stored encrypted by Windows (DPAPI)'
                          : 'OS encryption unavailable — you will need to sign in again each session'}
                      </div>
                    )}
                  </div>

                  <div className="row gap-8 wrap">
                    <button className="btn" disabled={refreshing} onClick={() => void refresh(active.id)}>
                      {refreshing ? <Spinner /> : <RefreshCw size={14} />} Refresh profile
                    </button>
                    <button className="btn" onClick={() => navigate('skins')}>
                      Manage skin
                    </button>
                    <button
                      className="btn"
                      onClick={() => void api.app.openExternal('https://www.minecraft.net/profile')}
                    >
                      <ExternalLink size={14} /> Minecraft profile
                    </button>
                    <button className="btn btn-danger" onClick={() => setSigningOut(active)}>
                      <LogOut size={14} /> Sign out
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* other accounts */}
          {accounts.length > 1 && (
            <>
              <div className="section-title">Switch account</div>
              <div className="col gap-8 mb-24">
                {accounts
                  .filter((entry) => entry.id !== active?.id)
                  .map((entry) => (
                    <div key={entry.id} className="panel panel-hover row gap-12" style={{ padding: 13 }}>
                      <SkinFace skinDataUrl={entry.skinDataUrl} size={40} radius={11} />
                      <div className="flex-1" style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600 }}>{entry.username}</div>
                        <div className="tiny dim">
                          {entry.gamertag ? `${entry.gamertag} · ` : ''}
                          Added {formatRelative(entry.addedAt)}
                        </div>
                      </div>
                      {!entry.ownsMinecraft && <span className="pill warning">No Java Edition</span>}
                      <button
                        className="btn btn-sm"
                        onClick={() => {
                          void api.auth.setActive(entry.id).then(refreshAccounts).catch((err) => setError(toPayload(err)))
                        }}
                      >
                        Use this account
                      </button>
                      <button className="btn btn-ghost btn-icon" title="Sign out" onClick={() => setSigningOut(entry)}>
                        <LogOut size={15} />
                      </button>
                    </div>
                  ))}
              </div>
            </>
          )}

          <div className="panel panel-pad">
            <div className="section-title">How sign-in works</div>
            <div className="col gap-8 small muted">
              <p>
                NexusCraft uses Microsoft's official OAuth 2.0 flow. You authenticate on Microsoft's own website; the
                launcher only ever receives a short-lived token.
              </p>
              <p>
                That token is exchanged with Xbox Live and then with Mojang's Minecraft services, which is what makes
                multiplayer and your profile work. Your Minecraft licence is checked live against Mojang's entitlement
                API on every sign-in.
              </p>
              <p>
                Only the renewal token is stored, encrypted with Windows DPAPI and tied to your Windows user account. No
                password is ever stored, and access tokens are stripped from every log line.
              </p>
            </div>
          </div>
        </>
      )}

      <ConfirmDialog
        open={Boolean(signingOut)}
        title={`Sign out ${signingOut?.username}?`}
        message="The stored session for this account is deleted. Your instances, worlds and mods are untouched, and you can sign back in at any time."
        confirmLabel="Sign out"
        danger
        busy={busy}
        onConfirm={() => {
          if (!signingOut) return
          setBusy(true)
          void api.auth
            .logout(signingOut.id)
            .then(() => {
              setSigningOut(null)
              return refreshAccounts()
            })
            .catch((err) => setError(toPayload(err)))
            .finally(() => setBusy(false))
        }}
        onCancel={() => setSigningOut(null)}
      />
    </>
  )
}

function EntitlementBadge({ account }: { account: Account }): JSX.Element {
  if (!account.ownsMinecraft) {
    return (
      <div className="pill danger" style={{ alignSelf: 'flex-start', padding: '5px 12px' }}>
        <ShieldAlert size={13} /> No Minecraft: Java Edition on this account
      </div>
    )
  }
  return (
    <div className="pill success" style={{ alignSelf: 'flex-start', padding: '5px 12px' }}>
      <ShieldCheck size={13} />
      {account.entitlementSource === 'game_pass'
        ? 'Java Edition through Game Pass'
        : account.entitlementSource === 'purchase'
          ? 'Minecraft: Java Edition owned'
          : 'Java Edition access confirmed'}
    </div>
  )
}
