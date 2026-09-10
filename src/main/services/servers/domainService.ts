import { resolve4, resolveSrv } from 'node:dns/promises'

import type { DomainCheck } from '@shared/types'

/**
 * Checking that a domain somebody bought actually points at their server.
 *
 * Worth doing because every part of this fails quietly. A record that has not
 * propagated, one pointed at the wrong IP, an SRV record with the port missing
 * - all of them look identical from the outside: players type the name and
 * Minecraft says it cannot connect, and there is nothing anywhere that says
 * which of the four things is wrong.
 *
 * Read rather than written. The launcher cannot create a DNS record - that
 * lives at whoever sold the domain - so the honest thing is to say exactly
 * what the record should be and then tell you whether it is.
 */

/** Trims a domain down to the name, dropping any scheme, path or port. */
export function tidyDomain(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/:\d+$/, '')
}

export async function checkDomain(raw: string, expected: string | null, port: number): Promise<DomainCheck> {
  const domain = tidyDomain(raw)

  const addresses = await resolve4(domain).catch(() => [] as string[])

  /*
   * The SRV name Minecraft looks up. It is a separate record from the A one
   * and can point somewhere else entirely, which is what makes a domain work
   * without a port on the end.
   */
  const srvRecords = await resolveSrv(`_minecraft._tcp.${domain}`).catch(() => [])
  const srv = srvRecords.length > 0 ? { target: srvRecords[0].name, port: srvRecords[0].port } : null

  const bare = srv !== null

  if (addresses.length === 0 && !srv) {
    return {
      domain,
      addresses,
      expected,
      srv,
      bare,
      verdict: 'not-found',
      note:
        `Nothing answers for ${domain} yet. Add an A record pointing it at ` +
        `${expected ?? 'your public IP'}, then give it a few minutes - DNS changes are not instant.`
    }
  }

  if (!expected) {
    return {
      domain,
      addresses,
      expected,
      srv,
      bare,
      verdict: 'no-public-ip',
      note:
        `${domain} resolves to ${addresses.join(', ') || 'an SRV target'}, but this machine's ` +
        'public IP could not be worked out, so there is nothing to compare it against.'
    }
  }

  if (addresses.length > 0 && !addresses.includes(expected)) {
    return {
      domain,
      addresses,
      expected,
      srv,
      bare,
      verdict: 'wrong-ip',
      note:
        `${domain} points at ${addresses.join(', ')}, but this machine is ${expected}. ` +
        'Either the A record needs updating, or your provider has given you a new IP since you set it.'
    }
  }

  return {
    domain,
    addresses,
    expected,
    srv,
    bare,
    verdict: 'ok',
    note: bare
      ? `${domain} points here, and the SRV record means players can type just the name.`
      : `${domain} points here. Players type ${domain}:${port} — add an SRV record to drop the port.`
  }
}
