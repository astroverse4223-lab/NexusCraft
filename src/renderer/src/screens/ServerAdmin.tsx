import { Ban, Gavel, LogOut, MicOff, ShieldCheck, Clock } from 'lucide-react'
import { type JSX, useRef, useState } from 'react'
import type { LauncherErrorPayload } from '@shared/types'
import { api, toPayload } from '../api'
import { ErrorView } from '../components/ui'

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
  running
}: {
  serverId: string
  players: string[]
  running: boolean
}): JSX.Element {
  const [error, setError] = useState<LauncherErrorPayload | null>(null)
  const [said, setSaid] = useState<string | null>(null)

  const [span, setSpan] = useState('1h')
  const [why, setWhy] = useState('')

  /** Who is about to be banned, so it takes two clicks rather than one. */
  const [confirming, setConfirming] = useState<string | null>(null)

  const [announcement, setAnnouncement] = useState('')

  const run = async (command: string, tell: string): Promise<void> => {
    try {
      await api.host.command(serverId, command)
      setSaid(tell)
    } catch (err) {
      setError(toPayload(err))
    }
  }

  const reason = (): string => why.trim() || 'No reason given'

  if (!running) {
    return (
      <div className="panel panel-pad col gap-8">
        <div className="section-title">Moderation</div>
        <p className="small muted">
          The server is stopped. Start it to see who is on and what they are doing.
        </p>
      </div>
    )
  }

  return (
    <div className="col gap-16">
      {error && <ErrorView error={error} onDismiss={() => setError(null)} />}

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
                    onClick={() =>
                      void run(`mute ${name} ${span} ${reason()}`, `Muted ${name} for ${span}.`)
                    }
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
                          void run(
                            `tempban ${name} ${span} ${reason()}`,
                            `Banned ${name} for ${span}.`
                          )
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
                    <button
                      className="btn btn-sm"
                      title="Ban them"
                      onClick={() => setConfirming(name)}
                    >
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

        {said && <p className="tiny" style={{ color: 'var(--success)' }}>{said}</p>}
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
          Goes out as a server message, not as you. Useful for telling everybody a restart is
          coming, or that the Warden is about to rise.
        </p>
      </div>

      <Restarts serverId={serverId} />
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

        const when =
          mark >= 60 ? `${Math.round(mark / 60)} minute${mark === 60 ? '' : 's'}` : `${mark} seconds`

        void api.host
          .command(serverId, `say Server restarting in ${when}.`)
          .catch(() => undefined)
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
        Everybody is told at five minutes, two, one, thirty seconds, ten and five. Leave this
        tab open — the countdown runs in the launcher, and closing it stops the server anyway.
      </p>
    </div>
  )
}
