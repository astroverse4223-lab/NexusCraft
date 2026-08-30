import { useCallback, useEffect, useState } from 'react'
import { Users } from 'lucide-react'
import type { Instance, LauncherErrorPayload, ServerInvite } from '@shared/types'
import { api, subscribe, toPayload } from '../api'
import { useStore } from '../store/useStore'
import { ErrorView, Modal, Spinner } from './ui'

/**
 * What a friend's invite link looks like when it arrives.
 *
 * An invite launches the game, so it always asks first — a link that starts
 * Minecraft the instant it is clicked is a link nobody should trust. The
 * prompt says exactly what will happen, including whether the launcher has to
 * build a client to make the join work, because that is the part that takes
 * minutes rather than seconds.
 */
export function InvitePrompt(): JSX.Element {
  const pushToast = useStore((s) => s.pushToast)
  const [invite, setInvite] = useState<ServerInvite | null>(null)
  const [instances, setInstances] = useState<Instance[]>([])
  const [chosen, setChosen] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<LauncherErrorPayload | null>(null)

  const open = useCallback(
    async (next: ServerInvite) => {
      setInvite(next)
      setError(null)
      setChosen('')
      try {
        setInstances(await api.instances.list())
      } catch {
        setInstances([])
      }
    },
    []
  )

  useEffect(() => {
    // A link that arrived before this mounted is held in the main process.
    void api.links
      .pendingInvite()
      .then((pending) => {
        if (pending) void open(pending)
      })
      .catch(() => undefined)

    return subscribe('link:invite', (payload: ServerInvite) => void open(payload))
  }, [open])

  // A mod link needs a target instance, which is a different question — send
  // the user to the screen that asks it rather than guessing.
  const navigate = useStore((s) => s.navigate)
  useEffect(
    () =>
      subscribe('link:install-mod', () => {
        pushToast({
          kind: 'info',
          title: 'Pick an instance for that mod',
          message: 'Choose one, then find the mod in Browse.'
        })
        navigate('instances')
      }),
    [navigate, pushToast]
  )

  /** Instances that could plausibly join, best first. */
  const suggestions = instances.filter(
    (instance) =>
      !invite?.minecraftVersion ||
      (instance.minecraftVersion === invite.minecraftVersion &&
        (!invite.loader || instance.loader === invite.loader))
  )

  const willBuild = suggestions.length === 0

  async function accept(): Promise<void> {
    if (!invite) return
    setBusy(true)
    setError(null)
    try {
      const result = await api.links.acceptInvite({
        host: invite.host,
        port: invite.port,
        name: invite.name,
        minecraftVersion: invite.minecraftVersion,
        loader: invite.loader,
        packVersionId: invite.packVersionId,
        instanceId: chosen || null
      })
      pushToast({ kind: 'success', title: `Joining ${result.address}`, message: `Launching ${result.instanceName}.` })
      setInvite(null)
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={Boolean(invite)}
      title={invite?.name ? `Join "${invite.name}"?` : 'Join this server?'}
      subtitle={`${invite?.host}:${invite?.port}`}
      onClose={() => setInvite(null)}
      width={520}
      footer={
        <>
          <button className="btn" onClick={() => setInvite(null)} disabled={busy}>
            Not now
          </button>
          <button className="btn btn-primary" onClick={() => void accept()} disabled={busy}>
            {busy ? <Spinner /> : <Users size={15} />} Join
          </button>
        </>
      }
    >
      {error && <ErrorView error={error} onDismiss={() => setError(null)} compact />}

      <div className="col gap-12">
        <p className="small muted">
          Someone shared an invite to their server. NexusCraft will save it to your server list and launch Minecraft
          straight into it.
        </p>

        {invite?.minecraftVersion && (
          <div className="row gap-8 small">
            <span className="dim" style={{ minWidth: 110 }}>
              Runs
            </span>
            <span>
              Minecraft {invite.minecraftVersion}
              {invite.loader && invite.loader !== 'vanilla' ? ` · ${invite.loader}` : ''}
            </span>
          </div>
        )}

        {invite?.packVersionId && (
          <div className="row gap-8 small">
            <span className="dim" style={{ minWidth: 110 }}>
              Modpack
            </span>
            <span>The host named one — it will be installed if you do not have it.</span>
          </div>
        )}

        {suggestions.length > 0 ? (
          <label className="field">
            <span className="field-label">Join with</span>
            <select className="input" value={chosen} onChange={(event) => setChosen(event.target.value)}>
              <option value="">
                {suggestions[0].name} (best match)
              </option>
              {instances
                .filter((instance) => instance.id !== suggestions[0].id)
                .map((instance) => (
                  <option key={instance.id} value={instance.id}>
                    {instance.name} — {instance.minecraftVersion} {instance.loader}
                  </option>
                ))}
            </select>
          </label>
        ) : (
          <div className="panel panel-pad small muted">
            {willBuild && invite?.minecraftVersion
              ? `You have no instance on ${invite.minecraftVersion}${
                  invite.loader && invite.loader !== 'vanilla' ? ` with ${invite.loader}` : ''
                }, so one will be made and installed first. That can take a few minutes.`
              : 'This invite did not say which version the server runs, so pick an instance to join with from your library first.'}
          </div>
        )}
      </div>
    </Modal>
  )
}
