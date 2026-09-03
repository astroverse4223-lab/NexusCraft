import { useCallback, useEffect, useState } from 'react'
import { RotateCw, Users } from 'lucide-react'
import type { LauncherErrorPayload } from '@shared/types'
import { api, toPayload } from '../api'
import { ErrorView, SettingRow, Spinner, Toggle } from './ui'

/**
 * Restarting a server on a schedule.
 *
 * A modded server that has been up for days leaks memory and slows down, and
 * the restart that fixes it usually happens by hand, at the worst moment,
 * because somebody finally noticed. Doing it deliberately at a quiet hour turns
 * that into twenty planned seconds.
 */

interface Schedule {
  enabled: boolean
  intervalHours: number
  warnMinutes: number
  skipIfPlayers: boolean
  nextAt: number | null
}

export function RestartSchedule({ serverId }: { serverId: string }): JSX.Element {
  const [schedule, setSchedule] = useState<Schedule | null>(null)
  const [error, setError] = useState<LauncherErrorPayload | null>(null)

  const load = useCallback(async () => {
    try {
      setSchedule(await api.host.restartSettings(serverId))
    } catch (err) {
      setError(toPayload(err))
    }
  }, [serverId])

  useEffect(() => {
    void load()
  }, [load])

  async function patch(update: Partial<Schedule>): Promise<void> {
    if (!schedule) return
    setSchedule({ ...schedule, ...update })
    try {
      setSchedule(await api.host.setRestartSettings(serverId, update))
    } catch (err) {
      setError(toPayload(err))
      await load()
    }
  }

  if (!schedule) {
    return (
      <div className="panel panel-pad row gap-12 muted">
        <Spinner /> Loading the restart schedule…
      </div>
    )
  }

  return (
    <div className="panel panel-pad col gap-12">
      <div className="row gap-8">
        <RotateCw size={16} className="dim" />
        <strong className="flex-1">Scheduled restarts</strong>
        {schedule.enabled && schedule.nextAt && (
          <span className="pill" title={new Date(schedule.nextAt).toLocaleString()}>
            next {new Date(schedule.nextAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>

      {error && <ErrorView error={error} onDismiss={() => setError(null)} compact />}

      <SettingRow
        name="Restart on a timer"
        description="Stops and starts the server automatically. The clock runs from when it last started, so a manual restart resets it."
      >
        <Toggle checked={schedule.enabled} onChange={(value) => void patch({ enabled: value })} />
      </SettingRow>

      {schedule.enabled && (
        <>
          <SettingRow name="Every" description="Hours between restarts.">
            <div className="row gap-12" style={{ width: 220 }}>
              <input
                className="slider"
                type="range"
                min={1}
                max={48}
                step={1}
                value={schedule.intervalHours}
                onChange={(event) => setSchedule({ ...schedule, intervalHours: Number(event.target.value) })}
                onMouseUp={() => void patch({ intervalHours: schedule.intervalHours })}
              />
              <span className="small bold" style={{ minWidth: 46 }}>
                {schedule.intervalHours}h
              </span>
            </div>
          </SettingRow>

          <SettingRow
            name="Warn players"
            description="Minutes of notice given in chat before it goes down. Zero restarts without warning."
          >
            <div className="row gap-12" style={{ width: 220 }}>
              <input
                className="slider"
                type="range"
                min={0}
                max={15}
                step={1}
                value={schedule.warnMinutes}
                onChange={(event) => setSchedule({ ...schedule, warnMinutes: Number(event.target.value) })}
                onMouseUp={() => void patch({ warnMinutes: schedule.warnMinutes })}
              />
              <span className="small bold" style={{ minWidth: 46 }}>
                {schedule.warnMinutes === 0 ? 'none' : `${schedule.warnMinutes}m`}
              </span>
            </div>
          </SettingRow>

          <SettingRow
            name="Skip while anyone is playing"
            description="Postpones to the next interval rather than interrupting a session. Leave this on unless the server is only for you."
          >
            <Toggle checked={schedule.skipIfPlayers} onChange={(value) => void patch({ skipIfPlayers: value })} />
          </SettingRow>

          <p className="field-hint row gap-8" style={{ alignItems: 'flex-start' }}>
            <Users size={12} style={{ flexShrink: 0, marginTop: 3 }} />
            <span>
              Players get a countdown in chat, then a final warning 30 seconds out. The world is saved by the normal
              shutdown, and a snapshot is taken as well if you have backups on stop enabled above.
            </span>
          </p>
        </>
      )}
    </div>
  )
}
