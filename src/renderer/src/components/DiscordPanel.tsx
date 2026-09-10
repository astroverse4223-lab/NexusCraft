import { type JSX, useState } from 'react'
import type { LauncherErrorPayload } from '@shared/types'
import { api, toPayload } from '../api'
import { ErrorView, Spinner } from '../components/ui'

/**
 * Turning the Discord feed on, without anybody opening a YAML file.
 *
 * It lives beside the website and the vote links rather than with moderation,
 * because it answers the same question those do: how anybody hears about this
 * server when they are not already in it. And unlike everything on the
 * moderation panel it is not a command sent to a running server - it writes a
 * setting - so it must stay reachable while the server is stopped, which is
 * exactly when somebody sets this up for the first time.
 */
export function DiscordPanel({ serverId }: { serverId: string }): JSX.Element {
  const [webhook, setWebhook] = useState('')
  const [saving, setSaving] = useState(false)
  const [said, setSaid] = useState<string | null>(null)
  const [error, setError] = useState<LauncherErrorPayload | null>(null)

  /**
   * Writes it into the plugin's config and tells the server if it is up.
   *
   * Worth a box rather than an instruction to edit a file, because the failure
   * is silent: the plugin logs one line when a post fails and then gives up,
   * so a url with a character missing looks exactly like a feed nobody ever
   * turned on.
   */
  const save = async (): Promise<void> => {
    setSaving(true)
    setSaid(null)
    setError(null)

    try {
      const result = await api.host.discordWebhook(serverId, webhook.trim())

      setSaid(
        webhook.trim() === ''
          ? 'Feed turned off.'
          : result.told
            ? 'Saved, and the server is posting to it now.'
            : 'Saved. It starts posting when the server does.'
      )
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="panel panel-pad col gap-12">
      {error && <ErrorView error={error} onDismiss={() => setError(null)} />}

      <div className="section-title">Discord</div>

      <p className="small muted">
        Chat, joins, and the big moments &mdash; the Warden rising, somebody finishing the challenge ladder &mdash;
        posted into a channel. It goes one way: your server talks to Discord, not back. No bot and nothing to host, only
        a link.
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

        <button className="btn btn-primary btn-sm" disabled={saving} onClick={() => void save()}>
          {saving && <Spinner />} Save
        </button>

        {webhook !== '' && (
          <button className="btn btn-sm" disabled={saving} onClick={() => setWebhook('')}>
            Clear
          </button>
        )}
      </div>

      {said && (
        <p className="small" style={{ color: 'var(--good, #6ee7a0)', margin: 0 }}>
          {said}
        </p>
      )}

      <details>
        <summary className="small" style={{ cursor: 'pointer' }}>
          Where to get one
        </summary>

        <ol className="small muted" style={{ margin: '8px 0 0', paddingLeft: 20, lineHeight: 1.7 }}>
          <li>
            In Discord, press <strong>+</strong> down the left, <strong>Create My Own</strong>, then{' '}
            <strong>For me and my friends</strong>. It can stay private &mdash; a webhook works in a server with only
            you in it.
          </li>
          <li>
            Right-click the channel you want the messages in &mdash; <code>#general</code> is fine &mdash; and pick{' '}
            <strong>Edit Channel</strong>.
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
  )
}
