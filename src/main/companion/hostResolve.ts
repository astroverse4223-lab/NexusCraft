/**
 * Works out which address a companion should actually dial.
 *
 * A companion stores the host it was pointed at. That is right for a server on
 * someone else's machine and quietly wrong for one running on this one: the
 * saved value is a LAN address handed out by whichever router was plugged in
 * that day, and moving to a different network changes it. The server keeps
 * running, the companion keeps dialling the old address, and the only symptom
 * is "192.168.22.12:25565 never answered" — which reads like the server is
 * down when it is listening perfectly well one interface over.
 *
 * Loopback does not have that problem. It is the same machine either way, no
 * router involved, so it survives every network change. Whenever the saved
 * address turns out to be this machine, loopback is what gets used.
 */
import { networkInterfaces } from 'node:os'

/** Every IPv4 address currently bound to a real interface on this machine. */
export function ownAddresses(): string[] {
  const found: string[] = []
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4') found.push(entry.address)
    }
  }
  return found
}

/** Names and addresses that already mean "this machine". */
export function isLoopback(host: string): boolean {
  const name = host.trim().toLowerCase()
  return name === 'localhost' || name === '127.0.0.1' || name === '::1' || name === '0.0.0.0'
}

/** RFC1918 — the ranges a home or office router hands out. */
export function isPrivateAddress(host: string): boolean {
  return (
    /^192\.168\.\d{1,3}\.\d{1,3}$/.test(host) ||
    /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(host)
  )
}

export interface HostResolution {
  /** The address to dial. */
  host: string
  /** Why it changed, for the log and the event feed. Null when it did not. */
  note: string | null
  /** True when the saved value should be corrected on disk. */
  persist: boolean
}

export interface ResolveInput {
  /** The host saved on the companion. */
  host: string
  /** The port it is dialling. */
  port: number
  /** This machine's current addresses. */
  own: string[]
  /** Ports this launcher is hosting a server on right now. */
  hostedPorts: number[]
}

/**
 * Decides what to dial.
 *
 * Deliberately conservative: a private address that is not ours and has no
 * matching local server is left exactly as it is, because that is how you point
 * a companion at a friend's server on the same LAN, and silently redirecting
 * that to loopback would connect it to the wrong world.
 */
export function resolveHost({ host, port, own, hostedPorts }: ResolveInput): HostResolution {
  const trimmed = host.trim()

  if (!trimmed || isLoopback(trimmed)) {
    return { host: trimmed || 'localhost', note: null, persist: false }
  }

  // The saved address is one this machine holds right now. Same box, so
  // loopback reaches it and keeps reaching it after the next network change.
  if (own.includes(trimmed)) {
    return {
      host: '127.0.0.1',
      note: `${trimmed} is this machine, so the companion connected over loopback instead — that keeps working when the network changes.`,
      persist: true
    }
  }

  // A private address that is not ours any more. If this launcher is hosting a
  // server on that very port, the saved address is a stale copy of our own from
  // a previous network rather than a genuine other machine.
  if (isPrivateAddress(trimmed) && hostedPorts.includes(port)) {
    return {
      host: '127.0.0.1',
      note: `${trimmed} is not an address on this machine any more — it looks like a saved address from a different network. Connected to the server hosted here on port ${port} instead.`,
      persist: true
    }
  }

  return { host: trimmed, note: null, persist: false }
}

/**
 * The message shown when a connection times out.
 *
 * The old wording blamed the port and the firewall, which sent people hunting
 * through Windows Defender for a server that was running the whole time. When
 * the address is simply not this machine's any more, say that instead.
 */
export function unreachableAdvice(host: string, port: number, own: string[]): string {
  const where = `${host}:${port}`

  if (!isLoopback(host) && isPrivateAddress(host) && !own.includes(host)) {
    const mine = own.filter((address) => isPrivateAddress(address))
    const now = mine.length ? ` This machine is ${mine.join(' and ')} now.` : ''
    return (
      `${where} never answered, and that address does not belong to this machine any more —` +
      ` it is left over from a different network.${now}` +
      ` Set the companion's server to localhost if the world is hosted here.`
    )
  }

  return `${where} never answered. Check the port and whether a firewall is blocking it.`
}
