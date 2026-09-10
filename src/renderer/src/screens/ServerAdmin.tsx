import { Ban, Gavel, LogOut, MicOff, ShieldCheck, Clock } from 'lucide-react'
import { type JSX, useEffect, useRef, useState } from 'react'
import type { LauncherErrorPayload } from '@shared/types'
import { api, toPayload } from '../api'
import { ErrorView, Spinner } from '../components/ui'

/**
 * Running the server without joining it.
 *
 * Everything here already existed as a command somebody had to remember and
 * type into a console window - mute, tempban, warn, the lot. What was missing
 * was a list of who is actually on and a button beside each name, which is the
 * difference between moderating a server and knowing that you could.
 *
 * Nothing is invented: every button sends the command the plugin already has,
 * so what happens here and what happens in chat are the same thing.
 */

/** The ranks the plugin knows, in the order they climb. */
const RANKS = ['PLAYER', 'VIP', 'MVP', 'ADMIN', 'OWNER']

/** Events the plugin can fire on demand. */
const EVENTS = [
  { id: 'airdrop', label: 'Airdrop' },
  { id: 'happyhour', label: 'Double money' },
  { id: 'meteors', label: 'Meteors' },
  { id: 'horde', label: 'Horde' }
]

/** How long a punishment lasts, in the form the plugin reads. */
const SPANS = [
  { label: '10 minutes', value: '10m' },
  { label: 'An hour', value: '1h' },
  { label: 'A day', value: '1d' },
  { label: 'A week', value: '7d' },
  { label: 'For good', value: 'forever' }
]

export function ServerAdmin({
  serverId,
  players,
  running,
  show
}: {
  serverId: string
  players: string[]
  running: boolean

  /**
   * Which half to draw.
   *
   * Dealing with a person and running the server are different jobs done at
   * different moments, and stacked together they were ten panels of scrolling
   * with the thing you wanted somewhere in the middle.
   */
  show: 'players' | 'controls'
}): JSX.Element {
  const [error, setError] = useState<LauncherErrorPayload | null>(null)
  const [said, setSaid] = useState<string | null>(null)

  const [span, setSpan] = useState('1h')
  const [why, setWhy] = useState('')

  /** Who is about to be banned, so it takes two clicks rather than one. */
  const [confirming, setConfirming] = useState<string | null>(null)

  const [announcement, setAnnouncement] = useState('')

  const [punished, setPunished] = useState<
    { kind: string; name: string; by: string; reason: string; at: number; until: number }[]
  >([])

  /** Everybody the server has seen, so somebody who left can still be dealt with. */
  const [known, setKnown] = useState<string[]>([])
  const [who, setWho] = useState('')

  const [amount, setAmount] = useState(1000)

  /** The Discord webhook, and whether it has just been saved. */
  const [webhook, setWebhook] = useState('')
  const [savingHook, setSavingHook] = useState(false)
  const [hookDone, setHookDone] = useState<string | null>(null)
  const [rank, setRank] = useState('VIP')
  const [key, setKey] = useState('common')

  const refresh = async (): Promise<void> => {
    try {
      setPunished(await api.host.punishments(serverId))
    } catch {
      setPunished([])
    }

    try {
      setKnown(await api.host.knownPlayers(serverId))
    } catch {
      setKnown([])
    }
  }

  useEffect(() => {
    if (show === 'players') void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId, running, show])

  const run = async (command: string, tell: string): Promise<void> => {
    try {
      await api.host.command(serverId, command)
      setSaid(tell)

      // The plugin writes punishments.yml as it goes, so the list is only ever
      // one read behind - and a ban that does not appear looks like one that
      // did not happen.
      setTimeout(() => void refresh(), 400)
    } catch (err) {
      setError(toPayload(err))
    }
  }

  /**
   * Writes the webhook into the plugin's config and tells the server.
   *
   * Worth a box rather than an instruction to edit a YAML file, because the
   * failure mode is silent: the plugin logs one line and gives up, so a url
   * with a character missing looks exactly like a feed that was never turned
   * on.
   */
  const saveWebhook = async (): Promise<void> => {
    setSavingHook(true)
    setHookDone(null)

    try {
      const result = await api.host.discordWebhook(serverId, webhook.trim())

      setHookDone(
        webhook.trim() === ''
          ? 'Feed turned off.'
          : result.told
            ? 'Saved, and the server is posting to it now.'
            : 'Saved. It starts posting when the server does.'
      )
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setSavingHook(false)
    }
  }

  const reason = (): string => why.trim() || 'No reason given'

  if (!running) {
    return (
      <div className="panel panel-pad col gap-8">
        <div className="section-title">{show === 'players' ? 'Players' : 'Controls'}</div>
        <p className="small muted">
          {show === 'players'
            ? 'The server is stopped. Start it to see who is on and what they are doing.'
            : 'The server is stopped. Every button here sends a command to a running server.'}
        </p>
      </div>
    )
  }

  return (
    <div className="col gap-16">
      {error && <ErrorView error={error} onDismiss={() => setError(null)} />}

      {show === 'players' && (
        <>
          <div className="panel panel-pad col gap-12">
            <div className="row gap-8" style={{ alignItems: 'center' }}>
              <div className="section-title" style={{ flex: 1 }}>
                Who is on
              </div>
              <span className="tiny dim">{players.length} online</span>
            </div>

            {players.length === 0 ? (
              <p className="small muted">Nobody is connected.</p>
            ) : (
              <>
                <div className="row gap-8 wrap" style={{ alignItems: 'flex-end' }}>
                  <div className="field" style={{ width: 140 }}>
                    <label className="field-label">How long</label>
                    <select className="select" value={span} onChange={(e) => setSpan(e.target.value)}>
                      {SPANS.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="field" style={{ flex: '1 1 220px' }}>
                    <label className="field-label">Reason</label>
                    <input
                      className="input"
                      value={why}
                      placeholder="what they did — they will be told this"
                      onChange={(e) => setWhy(e.target.value.slice(0, 120))}
                    />
                  </div>
                </div>

                <div className="col gap-8">
                  {players.map((name) => (
                    <div key={name} className="row gap-8 wrap" style={{ alignItems: 'center' }}>
                      <img
                        src={`https://mc-heads.net/avatar/${encodeURIComponent(name)}/24`}
                        alt=""
                        width={24}
                        height={24}
                        style={{ borderRadius: 4, imageRendering: 'pixelated' }}
                        onError={(e) => {
                          ;(e.currentTarget as HTMLImageElement).style.visibility = 'hidden'
                        }}
                      />

                      <span className="small" style={{ flex: '1 1 120px' }}>
                        {name}
                      </span>

                      <button
                        className="btn btn-sm"
                        title="Warn them"
                        onClick={() => void run(`warn ${name} ${reason()}`, `Warned ${name}.`)}
                      >
                        <Gavel size={13} /> Warn
                      </button>

                      <button
                        className="btn btn-sm"
                        title="Stop them talking"
                        onClick={() => void run(`mute ${name} ${span} ${reason()}`, `Muted ${name} for ${span}.`)}
                      >
                        <MicOff size={13} /> Mute
                      </button>

                      <button
                        className="btn btn-sm"
                        title="Disconnect them — they can come straight back"
                        onClick={() => void run(`kick ${name} ${reason()}`, `Kicked ${name}.`)}
                      >
                        <LogOut size={13} /> Kick
                      </button>

                      {/*
                       * Two clicks, deliberately.
                       *
                       * Every other button here is reversible in a moment; this one
                       * ends somebody's time on the server, and the row is a line of
                       * near-identical buttons where the wrong one is easy to hit.
                       */}
                      {confirming === name ? (
                        <>
                          <button
                            className="btn btn-sm danger"
                            onClick={() => {
                              void run(`tempban ${name} ${span} ${reason()}`, `Banned ${name} for ${span}.`)
                              setConfirming(null)
                            }}
                          >
                            Ban {name} for {span}?
                          </button>
                          <button className="btn btn-sm" onClick={() => setConfirming(null)}>
                            No
                          </button>
                        </>
                      ) : (
                        <button className="btn btn-sm" title="Ban them" onClick={() => setConfirming(name)}>
                          <Ban size={13} /> Ban
                        </button>
                      )}

                      <button
                        className="btn btn-sm"
                        title="Give them operator"
                        onClick={() => void run(`op ${name}`, `${name} is an operator.`)}
                      >
                        <ShieldCheck size={13} /> Op
                      </button>

                      <button
                        className="btn btn-sm"
                        title="What they have done before"
                        onClick={() => void run(`history ${name}`, `History for ${name} is in the console.`)}
                      >
                        History
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}

            {said && (
              <p className="tiny" style={{ color: 'var(--success)' }}>
                {said}
              </p>
            )}
          </div>

          <div className="panel panel-pad col gap-12">
            <div className="section-title">Say something</div>

            <div className="row gap-8 wrap">
              <input
                className="input"
                style={{ flex: '1 1 260px' }}
                value={announcement}
                placeholder="everyone on the server sees this"
                onChange={(e) => setAnnouncement(e.target.value.slice(0, 200))}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' || !announcement.trim()) return

                  void run(`say ${announcement.trim()}`, 'Said.')
                  setAnnouncement('')
                }}
              />
              <button
                className="btn btn-sm"
                disabled={!announcement.trim()}
                onClick={() => {
                  void run(`say ${announcement.trim()}`, 'Said.')
                  setAnnouncement('')
                }}
              >
                Send
              </button>
            </div>

            <p className="tiny dim">
              Goes out as a server message, not as you. Useful for telling everybody a restart is coming, or that the
              Warden is about to rise.
            </p>
          </div>

          {/* ------------------------------------------------------- discord */}

          <div className="panel panel-pad col gap-12">
            <div className="section-title">Discord</div>

            <p className="small muted">
              Chat, joins, and the big moments &mdash; the Warden rising, somebody finishing the challenge ladder
              &mdash; posted into a channel. It goes one way: your server talks to Discord, not back. That needs no bot
              and no hosting, only a link.
            </p>

            <div className="row gap-8 wrap">
              <input
                className="input"
                style={{ flex: '1 1 320px' }}
                value={webhook}
                type="password"
                placeholder="https://discord.com/api/webhooks/..."
                onChange={(e) => setWebhook(e.target.value.trim())}
              />

              <button className="btn btn-primary btn-sm" disabled={savingHook} onClick={() => void saveWebhook()}>
                {savingHook && <Spinner />} Save
              </button>

              {webhook !== '' && (
                <button
                  className="btn btn-sm"
                  disabled={savingHook}
                  onClick={() => {
                    setWebhook('')
                  }}
                >
                  Clear
                </button>
              )}
            </div>

            {hookDone && (
              <p className="small" style={{ color: 'var(--good, #6ee7a0)', margin: 0 }}>
                {hookDone}
              </p>
            )}

            <details>
              <summary className="small" style={{ cursor: 'pointer' }}>
                Where to get one
              </summary>

              <ol className="small muted" style={{ margin: '8px 0 0', paddingLeft: 20, lineHeight: 1.7 }}>
                <li>
                  In Discord, press <strong>+</strong> down the left, <strong>Create My Own</strong>, then{' '}
                  <strong>For me and my friends</strong>. Name it whatever you like.
                </li>
                <li>
                  Right-click the channel you want the messages in &mdash; <code>#general</code> is fine &mdash; and
                  pick <strong>Edit Channel</strong>.
                </li>
                <li>
                  <strong>Integrations</strong> &rarr; <strong>Webhooks</strong> &rarr; <strong>New Webhook</strong>.
                </li>
                <li>
                  <strong>Copy Webhook URL</strong>, and paste it above.
                </li>
              </ol>

              <p className="tiny dim" style={{ marginTop: 8 }}>
                Anybody with that link can post to the channel, so treat it like a password &mdash; it is kept in the
                server&apos;s own config and never sent anywhere but Discord.
              </p>
            </details>
          </div>

          {/* ------------------------------------------------------ anybody */}

          <div className="panel panel-pad col gap-12">
            <div className="section-title">Anybody else</div>

            <p className="small muted">
              Most moderation happens after somebody has gone &mdash; they say something and log off. Type a name, or
              pick one the server has seen before.
            </p>

            <div className="row gap-8 wrap">
              <input
                className="input"
                style={{ flex: '1 1 200px' }}
                value={who}
                list="known-players"
                placeholder="a player's name"
                onChange={(e) => setWho(e.target.value.trim().slice(0, 16))}
              />
              <datalist id="known-players">
                {known.slice(0, 200).map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>

              <button
                className="btn btn-sm"
                disabled={!who}
                onClick={() => void run(`tempban ${who} ${span} ${reason()}`, `Banned ${who}.`)}
              >
                <Ban size={13} /> Ban
              </button>
              <button
                className="btn btn-sm"
                disabled={!who}
                onClick={() => void run(`mute ${who} ${span} ${reason()}`, `Muted ${who}.`)}
              >
                <MicOff size={13} /> Mute
              </button>
              <button
                className="btn btn-sm"
                disabled={!who}
                onClick={() => void run(`history ${who}`, `History for ${who} is in the console.`)}
              >
                History
              </button>
            </div>

            <div className="row gap-8 wrap" style={{ alignItems: 'flex-end' }}>
              <div className="field" style={{ width: 130 }}>
                <label className="field-label">Money</label>
                <input
                  className="input"
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(Number(e.target.value) || 0)}
                />
              </div>
              <button
                className="btn btn-sm"
                disabled={!who || amount === 0}
                onClick={() => void run(`nexus pay ${who} ${amount}`, `Paid ${who}.`)}
              >
                Pay
              </button>

              <div className="field" style={{ width: 120 }}>
                <label className="field-label">Rank</label>
                <select className="select" value={rank} onChange={(e) => setRank(e.target.value)}>
                  {RANKS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
              <button
                className="btn btn-sm"
                disabled={!who}
                onClick={() => void run(`nexus setrank ${who} ${rank}`, `${who} is now ${rank}.`)}
              >
                Set rank
              </button>

              {/*
               * A key has a tier, and the player has to be on.
               *
               * `givekey` wants <player> <common|rare|legendary>, and refuses
               * outright for anybody offline - so a button that sent only a name
               * would have quietly printed a usage line into the console and
               * looked, from here, exactly like it had worked.
               */}
              <div className="field" style={{ width: 120 }}>
                <label className="field-label">Key</label>
                <select className="select" value={key} onChange={(e) => setKey(e.target.value)}>
                  <option value="common">Common</option>
                  <option value="rare">Rare</option>
                  <option value="legendary">Legendary</option>
                </select>
              </div>
              <button
                className="btn btn-sm"
                disabled={!who || !players.includes(who)}
                title={who && !players.includes(who) ? 'They have to be online for a key' : 'Give them a crate key'}
                onClick={() => void run(`nexus givekey ${who} ${key}`, `Gave ${who} a ${key} key.`)}
              >
                Crate key
              </button>
            </div>
          </div>

          {/* ------------------------------------------------------ the undoing */}

          <div className="panel panel-pad col gap-12">
            <div className="row gap-8" style={{ alignItems: 'center' }}>
              <div className="section-title" style={{ flex: 1 }}>
                Banned and muted
              </div>
              <button className="btn btn-sm" onClick={() => void refresh()}>
                Refresh
              </button>
            </div>

            {punished.length === 0 ? (
              <p className="small muted">Nobody is banned or muted.</p>
            ) : (
              <div className="col gap-8">
                {punished.map((entry, at) => (
                  <div key={entry.name + at} className="row gap-8 wrap" style={{ alignItems: 'center' }}>
                    <span
                      className="tiny"
                      style={{
                        color: entry.kind === 'ban' ? 'var(--danger)' : 'var(--warning)',
                        width: 44
                      }}
                    >
                      {entry.kind}
                    </span>

                    <span className="small" style={{ flex: '1 1 110px' }}>
                      {entry.name}
                    </span>

                    <span className="tiny dim truncate" style={{ flex: '2 1 160px' }}>
                      {entry.reason} &mdash; by {entry.by}
                    </span>

                    <span className="tiny dim">
                      {entry.until === 0 ? 'forever' : 'until ' + new Date(entry.until).toLocaleString()}
                    </span>

                    <button
                      className="btn btn-sm"
                      onClick={() =>
                        void run(
                          `${entry.kind === 'ban' ? 'unban' : 'unmute'} ${entry.name}`,
                          `Lifted the ${entry.kind} on ${entry.name}.`
                        )
                      }
                    >
                      Lift it
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {show === 'controls' && (
        <>
          <div className="panel panel-pad col gap-12">
            <div className="section-title">Run something</div>

            <div className="row gap-6 wrap">
              <button className="btn btn-sm" onClick={() => void run('nexus backup', 'Backing up.')}>
                Back up now
              </button>
              <button className="btn btn-sm" onClick={() => void run('save-all', 'World saved.')}>
                Save the world
              </button>
              <button className="btn btn-sm" onClick={() => void run('nexus startboss', 'The Warden is rising.')}>
                Start the boss
              </button>
              <button className="btn btn-sm" onClick={() => void run('nexus chatgame', 'Asked a question.')}>
                Chat game
              </button>
              <button className="btn btn-sm" onClick={() => void run('nexus pack', 'Re-read the resource pack.')}>
                Reload the pack
              </button>
              <button className="btn btn-sm" onClick={() => void run('nexus npcs', 'Greeters put back.')}>
                Put the bots back
              </button>
            </div>

            <div className="section-title">Fire an event</div>

            <div className="row gap-6 wrap">
              {EVENTS.map((event) => (
                <button
                  key={event.id}
                  className="btn btn-sm"
                  onClick={() => void run(`nexus event ${event.id}`, `${event.label} started.`)}
                >
                  {event.label}
                </button>
              ))}
            </div>

            <div className="section-title">The world</div>

            <div className="row gap-6 wrap">
              <button className="btn btn-sm" onClick={() => void run('time set day', 'Daytime.')}>
                Day
              </button>
              <button className="btn btn-sm" onClick={() => void run('time set night', 'Night.')}>
                Night
              </button>
              <button className="btn btn-sm" onClick={() => void run('weather clear', 'Clear skies.')}>
                Clear
              </button>
              <button className="btn btn-sm" onClick={() => void run('weather rain', 'Raining.')}>
                Rain
              </button>
              <button
                className="btn btn-sm"
                onClick={() => void run('whitelist on', 'Whitelist on - only listed players can join.')}
              >
                Whitelist on
              </button>
              <button
                className="btn btn-sm"
                onClick={() => void run('whitelist off', 'Whitelist off - anybody can join.')}
              >
                Whitelist off
              </button>
            </div>

            <p className="tiny dim">
              Time and weather apply to the world the console counts as default, which is the hub. Everything else is
              server-wide.
            </p>
          </div>

          <Restarts serverId={serverId} />
        </>
      )}
    </div>
  )
}

/**
 * A restart with warning, rather than a stop that surprises people.
 *
 * The countdown runs here in the app rather than on the server, which is
 * honest about what it is: if you close the launcher the restart does not
 * happen - but then neither does the server, since it dies with the launcher
 * anyway. Nothing is lost that was not already going.
 */
function Restarts({ serverId }: { serverId: string }): JSX.Element {
  const [minutes, setMinutes] = useState(5)
  const [left, setLeft] = useState<number | null>(null)
  const [error, setError] = useState<LauncherErrorPayload | null>(null)

  /** Where to shout, in seconds remaining. */
  const MARKS = [300, 120, 60, 30, 10, 5]

  const stopper = useRef<(() => void) | null>(null)

  const begin = (): void => {
    let seconds = Math.max(1, minutes) * 60
    setLeft(seconds)

    const said = new Set<number>()

    const timer = setInterval(() => {
      seconds -= 1
      setLeft(seconds)

      for (const mark of MARKS) {
        if (seconds > mark || said.has(mark)) continue

        said.add(mark)

        const when = mark >= 60 ? `${Math.round(mark / 60)} minute${mark === 60 ? '' : 's'}` : `${mark} seconds`

        void api.host.command(serverId, `say Server restarting in ${when}.`).catch(() => undefined)
        break
      }

      if (seconds > 0) return

      clearInterval(timer)
      setLeft(null)

      void (async () => {
        try {
          await api.host.command(serverId, 'say Restarting now. Back in a moment.')
          await api.host.stop(serverId)
          await api.host.start(serverId)
        } catch (err) {
          setError(toPayload(err))
        }
      })()
    }, 1000)

    /*
     * Kept in a ref, not a variable.
     *
     * A local is rebuilt every render and the countdown re-renders once a
     * second, so the handle to the running timer was thrown away immediately
     * and "call it off" had nothing to call off.
     */
    stopper.current = () => {
      clearInterval(timer)
      setLeft(null)
      void api.host.command(serverId, 'say The restart has been called off.').catch(() => undefined)
    }
  }

  return (
    <div className="panel panel-pad col gap-12">
      {error && <ErrorView error={error} onDismiss={() => setError(null)} />}

      <div className="section-title">Restart</div>

      {left === null ? (
        <div className="row gap-8 wrap" style={{ alignItems: 'flex-end' }}>
          <div className="field" style={{ width: 120 }}>
            <label className="field-label">In how long</label>
            <input
              className="input"
              type="number"
              min={1}
              max={120}
              value={minutes}
              onChange={(e) => setMinutes(Number(e.target.value) || 5)}
            />
          </div>

          <button className="btn btn-sm" onClick={begin}>
            <Clock size={14} /> Warn and restart
          </button>
        </div>
      ) : (
        <div className="row gap-8" style={{ alignItems: 'center' }}>
          <span className="small">
            Restarting in {Math.floor(left / 60)}m {String(left % 60).padStart(2, '0')}s
          </span>
          <button className="btn btn-sm" onClick={() => stopper.current?.()}>
            Call it off
          </button>
        </div>
      )}

      <p className="tiny dim">
        Everybody is told at five minutes, two, one, thirty seconds, ten and five. Leave this tab open — the countdown
        runs in the launcher, and closing it stops the server anyway.
      </p>
    </div>
  )
}
