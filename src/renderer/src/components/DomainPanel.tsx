import { type JSX, useState } from 'react'
import { Copy, Globe } from 'lucide-react'
import type { DomainCheck, LauncherErrorPayload } from '@shared/types'
import { api, toPayload } from '../api'
import { ErrorView, Spinner } from '../components/ui'

/**
 * The address players are told to type.
 *
 * Two halves that people reasonably expect to be one. The launcher can set
 * what its own screens hand out - the website, the invite link, the share
 * panel - and it does that with one button. It cannot create a DNS record:
 * that lives at whoever sold the domain, and no amount of wanting changes it.
 *
 * So the second half is the two records written out to copy, and a check that
 * says whether they have taken. Every way this fails is silent and they all
 * look the same from a player's chair - not propagated, wrong IP, missing
 * port, no SRV - which is why guessing is worse than being told.
 */
export function DomainPanel({
  serverId,
  port,
  current
}: {
  serverId: string
  port: number
  current: string | null
}): JSX.Element {
  const [domain, setDomain] = useState(current ?? '')
  const [busy, setBusy] = useState(false)
  const [checking, setChecking] = useState(false)
  const [check, setCheck] = useState<DomainCheck | null>(null)
  const [said, setSaid] = useState<string | null>(null)
  const [error, setError] = useState<LauncherErrorPayload | null>(null)

  const clean = domain.trim().toLowerCase()

  const apply = async (): Promise<void> => {
    setBusy(true)
    setSaid(null)
    setError(null)

    try {
      const result = await api.host.setDomain(serverId, clean)
      setSaid(
        result.address
          ? `Everything now hands out ${result.address}.`
          : 'Back to handing out this machine’s own address.'
      )
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setBusy(false)
    }
  }

  const verify = async (): Promise<void> => {
    if (!clean) return

    setChecking(true)
    setError(null)

    try {
      setCheck(await api.host.checkDomain(serverId, clean))
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setChecking(false)
    }
  }

  const colourFor = (verdict: DomainCheck['verdict']): string =>
    verdict === 'ok' ? 'var(--good, #6ee7a0)' : verdict === 'wrong-ip' ? 'var(--danger)' : 'var(--warning)'

  return (
    <div className="panel panel-pad col gap-12">
      {error && <ErrorView error={error} onDismiss={() => setError(null)} />}

      <div className="section-title">Your own address</div>

      <p className="small muted">
        A domain you own, handed out instead of an IP. Set it here and the website, the invite link and the share panel
        all use it &mdash; they each used to keep their own copy, which agreed right up until one of them was edited.
      </p>

      <div className="row gap-8 wrap">
        <input
          className="input"
          style={{ flex: '1 1 240px' }}
          value={domain}
          placeholder="play.yourserver.net"
          onChange={(e) => setDomain(e.target.value.trim())}
        />

        <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void apply()}>
          {busy && <Spinner />} Use this address
        </button>

        <button className="btn btn-sm" disabled={checking || !clean} onClick={() => void verify()}>
          {checking ? <Spinner /> : <Globe size={14} />} Check the DNS
        </button>
      </div>

      {said && (
        <p className="small" style={{ color: 'var(--good, #6ee7a0)', margin: 0 }}>
          {said}
        </p>
      )}

      {check && (
        <p className="small" style={{ color: colourFor(check.verdict), margin: 0 }}>
          {check.note}
        </p>
      )}

      {/*
        Written out rather than described, because "add an A record" is the
        point at which somebody who has never done it stops.
      */}
      {clean && (
        <div className="col gap-8">
          <span className="tiny dim">
            Add these two at whoever sold you the domain. The first is required; the second is what lets people type the
            name with no port after it.
          </span>

          <div className="col gap-6">
            {[
              {
                what: 'A record',
                name: clean.split('.').length > 2 ? clean.split('.')[0] : '@',
                value: check?.expected ?? 'your public IP'
              },
              {
                what: 'SRV record',
                name: `_minecraft._tcp.${clean.split('.').length > 2 ? clean.split('.')[0] : '@'}`,
                value: `0 0 ${port} ${clean}`
              }
            ].map((row) => (
              <div key={row.what} className="row gap-8 wrap" style={{ alignItems: 'center' }}>
                <span className="tiny dim" style={{ minWidth: 78 }}>
                  {row.what}
                </span>
                <span className="host-address">{row.name}</span>
                <span className="host-address" style={{ flex: '1 1 160px' }}>
                  {row.value}
                </span>
                <button className="btn btn-ghost btn-sm" onClick={() => void navigator.clipboard.writeText(row.value)}>
                  <Copy size={13} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <details>
        <summary className="small" style={{ cursor: 'pointer' }}>
          What a domain does and does not do
        </summary>

        <p className="small muted" style={{ marginTop: 8 }}>
          It does not hide your IP. DNS is public, so anybody can look up where the name points in one command &mdash;
          what a domain buys you is a name people can remember and an address you can move without telling anyone. If
          hiding the IP is the point, the relay above is the thing that does it: players connect to it, and it connects
          to you.
        </p>

        <p className="small muted" style={{ margin: 0 }}>
          Home connections are also handed a new IP from time to time. When that happens the A record is stale and the
          name stops working until it is updated &mdash; which is what &ldquo;Check the DNS&rdquo; is for.
        </p>
      </details>
    </div>
  )
}
