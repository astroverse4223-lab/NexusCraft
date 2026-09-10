import { ExternalLink, Globe, Plus, Trash2 } from 'lucide-react'
import { type JSX, useEffect, useState } from 'react'
import type { SiteConfig, SiteStatus } from '@shared/serverSite'
import type { LauncherErrorPayload } from '@shared/types'
import { api, toPayload } from '../api'
import { ErrorView, Spinner } from '../components/ui'

/**
 * The public page for a server, and the votes that come back to it.
 *
 * These are one panel rather than two because they are one job: a server list
 * wants a website before it will take a listing, and the listing is what sends
 * votes - so somebody setting up voting needs both, in this order.
 */

interface Votifier {
  port: number
  token: string
  publicKey: string
  enabled: boolean
}

export function ServerSitePanel({ serverId }: { serverId: string }): JSX.Element {
  const [config, setConfig] = useState<SiteConfig | null>(null)
  const [status, setStatus] = useState<SiteStatus | null>(null)
  const [votifier, setVotifier] = useState<Votifier | null>(null)
  const [votePort, setVotePort] = useState<{ open: boolean; port: number } | null>(null)

  const [port, setPort] = useState(25567)
  const [webPort, setWebPort] = useState<{ open: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<LauncherErrorPayload | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        setConfig(await api.site.config(serverId))
        setStatus(await api.site.status())
        setVotifier(await api.site.votifierInfo(serverId))
      } catch (err) {
        setError(toPayload(err))
      }
    })()
  }, [serverId])

  const change = (next: Partial<SiteConfig>): void => {
    setConfig((was) => (was ? { ...was, ...next } : was))
  }

  const save = async (): Promise<void> => {
    if (!config) return

    try {
      setConfig(await api.site.save(config))
    } catch (err) {
      setError(toPayload(err))
    }
  }

  const start = async (): Promise<void> => {
    if (!config) return

    setBusy(true)
    try {
      await api.site.save(config)
      setStatus(await api.site.start(serverId, port))
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setBusy(false)
    }
  }

  const stop = async (): Promise<void> => {
    try {
      setStatus(await api.site.stop())
    } catch (err) {
      setError(toPayload(err))
    }
  }

  /*
   * The web port opener, here as well as in Make a pack.
   *
   * It is one port doing both jobs, so there is only ever one thing to open -
   * but the button lived only in the other tab, which meant looking at "Web
   * port 25567" with no way to open it and no hint that it was somewhere else.
   */
  const openWebPort = async (open: boolean): Promise<void> => {
    setBusy(true)
    try {
      const result = open
        ? await api.resourcePack.openPort(port)
        : await api.resourcePack.closePort(port)

      setWebPort({ open: result.open })
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setBusy(false)
    }
  }

  const openVotePort = async (open: boolean): Promise<void> => {
    setBusy(true)
    try {
      const result = await api.site.votifierPort(serverId, open)
      setVotePort({ open: result.open, port: result.port })
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setBusy(false)
    }
  }

  if (!config) return <div className="panel panel-pad small muted">Loading…</div>

  return (
    <div className="col gap-16">
      {error && <ErrorView error={error} onDismiss={() => setError(null)} />}

      <div className="panel panel-pad col gap-12">
        <div className="section-title">Website</div>

        <p className="small muted">
          A page anyone can open in a browser: who is on, the leaderboards out of your own
          stats file, and the links people vote through. Server lists will not take a listing
          without one.
        </p>

        <div className="row gap-8 wrap">
          <input
            className="input"
            style={{ flex: '1 1 160px' }}
            value={config.title}
            placeholder="Heading"
            onChange={(e) => change({ title: e.target.value.slice(0, 64) })}
            onBlur={() => void save()}
          />
          <input
            className="input"
            style={{ flex: '2 1 260px' }}
            value={config.blurb}
            placeholder="A sentence under it"
            onChange={(e) => change({ blurb: e.target.value.slice(0, 280) })}
            onBlur={() => void save()}
          />
        </div>

        <div className="row gap-8 wrap">
          <input
            className="input"
            style={{ flex: '1 1 220px' }}
            value={config.joinAddress}
            placeholder="Address players type in, eg play.yourserver.net"
            onChange={(e) => change({ joinAddress: e.target.value.slice(0, 255) })}
            onBlur={() => void save()}
          />
          <input
            type="color"
            className="input"
            style={{ width: 52, padding: 4 }}
            value={config.accent}
            title="Accent colour"
            onChange={(e) => change({ accent: e.target.value })}
            onBlur={() => void save()}
          />
        </div>
      </div>

      {/* --------------------------------------------------------- vote sites */}

      <div className="panel panel-pad col gap-12">
        <div className="row gap-8" style={{ alignItems: 'center' }}>
          <div className="section-title" style={{ flex: 1 }}>
            Vote links
          </div>
          <button
            className="btn btn-sm"
            onClick={() => change({ votes: [...config.votes, { name: '', url: 'https://' }] })}
          >
            <Plus size={14} /> Add a site
          </button>
        </div>

        {config.votes.length === 0 ? (
          <p className="small muted">
            Sign the server up on a list like Minecraft-MP or PlanetMinecraft, then paste your
            vote page here. The buttons appear on the website.
          </p>
        ) : (
          <div className="col gap-8">
            {config.votes.map((site, at) => (
              <div key={at} className="row gap-8" style={{ alignItems: 'center' }}>
                <input
                  className="input"
                  style={{ flex: '1 1 130px' }}
                  value={site.name}
                  placeholder="Site name"
                  onChange={(e) =>
                    change({
                      votes: config.votes.map((v, i) =>
                        i === at ? { ...v, name: e.target.value.slice(0, 48) } : v
                      )
                    })
                  }
                  onBlur={() => void save()}
                />
                <input
                  className="input"
                  style={{ flex: '2 1 240px' }}
                  value={site.url}
                  placeholder="https://…"
                  onChange={(e) =>
                    change({
                      votes: config.votes.map((v, i) =>
                        i === at ? { ...v, url: e.target.value.slice(0, 2048) } : v
                      )
                    })
                  }
                  onBlur={() => void save()}
                />
                <button
                  className="btn btn-sm"
                  title="Take it out"
                  onClick={() => {
                    change({ votes: config.votes.filter((_, i) => i !== at) })
                    void save()
                  }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ---------------------------------------------------------- votifier */}

      {votifier && (
        <div className="panel panel-pad col gap-12">
          <div className="section-title">What the vote sites ask you for</div>

          <p className="small muted">
            Paste these into the listing when you sign up. Your plugin is already listening for
            votes — these are read out of its own files, so they are what it actually expects.
          </p>

          <Field label="Host" value={config.joinAddress || 'your address'} />
          <Field label="Port" value={String(votifier.port)} />
          <Field label="Token (newer sites)" value={votifier.token} />
          <Field label="Public key (older sites)" value={votifier.publicKey} wrap />

          {/*
            * A third port, and the third time this has mattered.
            *
            * The game port, the pack port and this one are all different, and
            * none of them helps the others. A vote site that cannot reach this
            * accepts the vote, tells the player it counted, and the reward
            * never arrives - the one person who could report it is the one who
            * sees nothing wrong.
            */}
          <div className="row gap-8 wrap" style={{ alignItems: 'center' }}>
            {votePort?.open ? (
              <>
                <span className="small">Vote port {votePort.port} is open.</span>
                <button className="btn btn-sm" disabled={busy} onClick={() => void openVotePort(false)}>
                  {busy && <Spinner />} Close it
                </button>
              </>
            ) : (
              <button className="btn btn-sm" disabled={busy} onClick={() => void openVotePort(true)}>
                {busy && <Spinner />} <Globe size={14} /> Open vote port {votifier.port}
              </button>
            )}
          </div>

          <p className="tiny dim">
            This is a third port, separate from the one players join on and the one the resource
            pack is served over. Vote sites connect in to it — unforwarded, they send the vote,
            nothing arrives, and the player is told on the site that it counted.
          </p>

          {!votifier.enabled && (
            <p className="tiny dim">
              Voting is switched off in the plugin config. Turn on <code>voting.enabled</code>{' '}
              and restart the server.
            </p>
          )}
        </div>
      )}

      {/* ------------------------------------------------------------- serve */}

      <div className="panel panel-pad col gap-12">
        <div className="row gap-8 wrap" style={{ alignItems: 'flex-end' }}>
          <div className="field" style={{ width: 120 }}>
            <label className="field-label">Web port</label>
            <input
              className="input"
              type="number"
              value={port}
              onChange={(e) => setPort(Number(e.target.value) || 25567)}
            />
          </div>

          {status?.running ? (
            <button className="btn btn-sm" onClick={() => void stop()}>
              Take the website down
            </button>
          ) : (
            <button className="btn btn-primary" disabled={busy} onClick={() => void start()}>
              {busy && <Spinner />} <Globe size={14} /> Put the website up
            </button>
          )}

          {status?.running && status.url && (
            <a
              className="btn btn-sm"
              href={status.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink size={13} /> Open it
            </a>
          )}

          {webPort?.open ? (
            <button className="btn btn-sm" disabled={busy} onClick={() => void openWebPort(false)}>
              {busy && <Spinner />} Close port {port}
            </button>
          ) : (
            <button className="btn btn-sm" disabled={busy} onClick={() => void openWebPort(true)}>
              {busy && <Spinner />} <Globe size={14} /> Open port {port} to the world
            </button>
          )}
        </div>

        {status?.running && status.url && (
          <div className="row gap-8" style={{ alignItems: 'center' }}>
            <code className="tiny selectable" style={{ flex: 1, wordBreak: 'break-all' }}>
              {status.url}
            </code>
            <button
              className="btn btn-sm"
              onClick={() => void navigator.clipboard.writeText(status.url as string)}
            >
              Copy
            </button>
          </div>
        )}

        <p className="tiny dim">
          The website and the resource pack share this one port, so opening it here opens it for
          both — it is the same button as the one in Make a pack, not a second thing to do. Served
          for as long as the launcher is open, and the page reads your stats file fresh on every
          visit, so it is never out of step with the game.
        </p>
      </div>
    </div>
  )
}

/** One read-only value with a copy button, which is all these ever are. */
function Field({
  label,
  value,
  wrap
}: {
  label: string
  value: string
  wrap?: boolean
}): JSX.Element {
  return (
    <div className="row gap-8" style={{ alignItems: 'center' }}>
      <span className="tiny dim" style={{ width: 140 }}>
        {label}
      </span>
      <code
        className="tiny selectable"
        style={{
          flex: 1,
          wordBreak: wrap ? 'break-all' : 'normal',
          maxHeight: wrap ? 54 : undefined,
          overflow: 'auto'
        }}
      >
        {value || '—'}
      </code>
      <button
        className="btn btn-sm"
        disabled={!value}
        onClick={() => void navigator.clipboard.writeText(value)}
      >
        Copy
      </button>
    </div>
  )
}
