import { createSocket } from 'node:dgram'
import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os'
import { request as httpRequest, get as httpGet } from 'node:http'
import { URL } from 'node:url'
import { createLogger } from '../../core/logger'
import { LauncherError } from '../../core/errors'

/**
 * Asking the router to open a port, so friends outside the house can join.
 *
 * Every home router speaks UPnP's Internet Gateway Device profile, and it is
 * how games have opened their own ports for twenty years: a multicast search
 * finds the gateway, and a SOAP call asks it to forward a port to this machine.
 * It is written directly against the protocol rather than pulling in a library,
 * because the whole of it is one search, one description fetch and three calls.
 *
 * Nothing here opens anything on its own. Opening a port is a change to someone
 * else's network and is only ever done when explicitly asked.
 */

const log = createLogger('upnp')

const SSDP_ADDRESS = '239.255.255.250'
const SSDP_PORT = 1900
const DISCOVERY_MS = 4_000

/** Services that can forward a port, in the order they are worth trying. */
const WAN_SERVICES = [
  'urn:schemas-upnp-org:service:WANIPConnection:1',
  'urn:schemas-upnp-org:service:WANPPPConnection:1'
]

export interface Gateway {
  /** Where SOAP calls go. */
  controlUrl: string
  /** Which of the WAN services this gateway offers. */
  serviceType: string
  /** The router's own address on this network. */
  routerAddress: string
  /** What the router calls itself, for the interface to show. */
  description: string
}

export interface ForwardingStatus {
  /** Whether a gateway that can forward ports was found at all. */
  available: boolean
  /** Whether this port is currently forwarded to this machine. */
  open: boolean
  /** The address people outside the network would connect to, once known. */
  externalAddress: string | null
  /** What the router calls itself. */
  router: string | null
  /** Why forwarding is unavailable, when it is. */
  reason: string | null
}

/* ------------------------------------------------------------- discovery */

/**
 * The likely router address for each network this machine is on.
 *
 * Node will not tell us the default gateway, but it does give the address and
 * netmask of every interface, and the router is the first host on its own
 * subnet on essentially every home network. Worth deriving, because a search
 * sent straight to the router gets its answer back through a firewall that
 * would drop the multicast one.
 */
function likelyRouters(): string[] {
  const found = new Set<string>()

  for (const entry of Object.values(networkInterfaces()).flat()) {
    if (!entry || entry.family !== 'IPv4' || entry.internal) continue

    const address = entry.address.split('.').map(Number)
    const mask = entry.netmask.split('.').map(Number)
    if (address.length !== 4 || mask.length !== 4) continue

    // The network address, then the first host on it.
    const network = address.map((octet, index) => octet & mask[index])
    network[3] += 1
    found.add(network.join('.'))
  }

  return [...found]
}

/**
 * Multicasts a search for the internet gateway, from every network this machine
 * is on.
 *
 * A socket left to choose for itself sends multicast out whichever interface
 * Windows considers default, and that is very often the wrong one: a VPN tunnel,
 * a Hyper-V switch, WSL's virtual adapter. The search then goes somewhere no
 * router is listening and the launcher reports, quite wrongly, that the router
 * will not forward ports — on a network whose router was perfectly willing.
 *
 * So one socket is bound per address and the search sent from each. Whichever
 * answers first is the gateway, because the interface that reaches a router is
 * by definition the one facing it.
 */
async function findGatewayLocation(): Promise<{ location: string; server: string } | null> {
  const interfaces = Object.values(networkInterfaces())
    .flat()
    .filter((entry): entry is NetworkInterfaceInfo => Boolean(entry) && entry!.family === 'IPv4' && !entry!.internal)
    .map((entry) => entry.address)

  // The unbound socket stays in the list: on a simple network it is all that is
  // needed, and it costs nothing to ask.
  const sources: Array<string | undefined> = [undefined, ...interfaces]
  const routers = likelyRouters()

  return await new Promise((resolve) => {
    const sockets: ReturnType<typeof createSocket>[] = []
    let settled = false

    const finish = (value: { location: string; server: string } | null): void => {
      if (settled) return
      settled = true
      for (const socket of sockets) {
        try {
          socket.close()
        } catch {
          /* already closed */
        }
      }
      resolve(value)
    }

    const search = (target: string): Buffer =>
      Buffer.from(
        'M-SEARCH * HTTP/1.1\r\n' +
          `HOST: ${SSDP_ADDRESS}:${SSDP_PORT}\r\n` +
          'MAN: "ssdp:discover"\r\n' +
          'MX: 2\r\n' +
          `ST: ${target}\r\n\r\n`
      )

    for (const address of sources) {
      const socket = createSocket({ type: 'udp4', reuseAddr: true })
      sockets.push(socket)

      // One dead interface must not stop the others being tried.
      socket.on('error', () => {
        try {
          socket.close()
        } catch {
          /* already closed */
        }
      })

      socket.on('message', (message) => {
        const text = message.toString()
        const location = /LOCATION:\s*(\S+)/i.exec(text)
        if (!location) return
        const server = /SERVER:\s*(.+)/i.exec(text)
        finish({ location: location[1], server: (server?.[1] ?? '').trim() })
      })

      try {
        socket.bind(address ? { address, port: 0 } : { port: 0 }, () => {
          const targets = [
            'urn:schemas-upnp-org:device:InternetGatewayDevice:1',
            ...WAN_SERVICES
          ]

          /*
           * Ask the group, and ask the router directly.
           *
           * The multicast search is the standard one, but its answer arrives
           * from the router's own address while the request went to the
           * multicast group — so a stateful firewall sees an unsolicited packet
           * and drops it, and the launcher concludes there is no router at all.
           * A search sent straight to the router is answered by the same host it
           * was sent to, which every firewall lets back through.
           */
          for (const target of targets) {
            try {
              socket.send(search(target), SSDP_PORT, SSDP_ADDRESS)
            } catch {
              /* this interface cannot reach the multicast group */
            }

            for (const router of routers) {
              try {
                socket.send(search(target), SSDP_PORT, router)
              } catch {
                /* not reachable from this interface */
              }
            }
          }
        })
      } catch {
        /* binding to that address failed; the others carry on */
      }
    }

    setTimeout(() => finish(null), DISCOVERY_MS)
  })
}

/** Fetches a URL as text, with a short leash — this is all on the LAN. */
async function fetchText(url: string, timeoutMs = 5_000): Promise<string> {
  return await new Promise((resolve, reject) => {
    const req = httpGet(url, (response) => {
      let body = ''
      response.on('data', (chunk) => (body += chunk))
      response.on('end', () => resolve(body))
    })
    req.on('error', reject)
    req.setTimeout(timeoutMs, () => {
      req.destroy()
      reject(new Error('the router did not answer in time'))
    })
  })
}

/**
 * Finds the gateway and the service on it that forwards ports.
 *
 * The device description lists its services in no guaranteed order, so the
 * control URL is taken from the same block as the service type rather than by
 * position — matching them separately pairs the wrong two on some routers.
 */
export async function discoverGateway(): Promise<Gateway | null> {
  const found = await findGatewayLocation()
  if (!found) return null

  let description: string
  try {
    description = await fetchText(found.location)
  } catch (err) {
    log.warn(`found a UPnP gateway but could not read its description: ${(err as Error).message}`)
    return null
  }

  for (const serviceType of WAN_SERVICES) {
    // Each <service> block holds its own type and control URL together.
    for (const block of description.split(/<service>/i).slice(1)) {
      if (!block.includes(serviceType)) continue
      const control = /<controlURL>([^<]+)<\/controlURL>/i.exec(block)
      if (!control) continue

      return {
        controlUrl: new URL(control[1].trim(), found.location).toString(),
        serviceType,
        routerAddress: new URL(found.location).hostname,
        description: found.server || 'UPnP router'
      }
    }
  }

  return null
}

/* ------------------------------------------------------------------ SOAP */

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

async function callService(
  gateway: Gateway,
  action: string,
  args: Array<[string, string]> = []
): Promise<{ status: number; body: string }> {
  const payload = args.map(([key, value]) => `<${key}>${escapeXml(value)}</${key}>`).join('')
  const envelope =
    '<?xml version="1.0"?>' +
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" ' +
    's:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">' +
    `<s:Body><u:${action} xmlns:u="${gateway.serviceType}">${payload}</u:${action}></s:Body>` +
    '</s:Envelope>'

  const url = new URL(gateway.controlUrl)

  return await new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml; charset="utf-8"',
          SOAPAction: `"${gateway.serviceType}#${action}"`,
          'Content-Length': Buffer.byteLength(envelope)
        }
      },
      (response) => {
        let body = ''
        response.on('data', (chunk) => (body += chunk))
        response.on('end', () => resolve({ status: response.statusCode ?? 0, body }))
      }
    )

    req.on('error', reject)
    req.setTimeout(8_000, () => {
      req.destroy()
      reject(new Error('the router did not answer in time'))
    })
    req.end(envelope)
  })
}

/** The message a router puts inside a SOAP fault, when it bothers to. */
function faultReason(body: string): string {
  const described = /<errorDescription>([^<]+)</i.exec(body)
  if (described) return described[1]
  const code = /<errorCode>([^<]+)</i.exec(body)
  return code ? `the router refused it (UPnP error ${code[1]})` : 'the router refused it'
}

/* ---------------------------------------------------------------- asking */

/** The address people outside the network would use, if the router knows it. */
export async function externalAddress(gateway: Gateway): Promise<string | null> {
  try {
    const { body } = await callService(gateway, 'GetExternalIPAddress')
    const found = /<NewExternalIPAddress>([^<]*)</i.exec(body)
    const address = found?.[1]?.trim()
    return address ? address : null
  } catch {
    return null
  }
}

/** Whether this port is already forwarded, and to whom. */
async function existingMapping(gateway: Gateway, port: number): Promise<string | null> {
  try {
    const { status, body } = await callService(gateway, 'GetSpecificPortMappingEntry', [
      ['NewRemoteHost', ''],
      ['NewExternalPort', String(port)],
      ['NewProtocol', 'TCP']
    ])
    if (status !== 200) return null
    const client = /<NewInternalClient>([^<]*)</i.exec(body)
    return client?.[1]?.trim() ?? null
  } catch {
    return null
  }
}

/**
 * Asks the router to send a port to this machine.
 *
 * The lease is deliberately finite. A permanent mapping outlives the launcher,
 * the server, and any memory of having made it — leaving a port open on someone's
 * router indefinitely is not a thing to do quietly. It is renewed while the
 * server runs and lapses on its own if the launcher dies without tidying up.
 */
export async function openPort(
  gateway: Gateway,
  port: number,
  internalAddress: string,
  label: string
): Promise<void> {
  const { status, body } = await callService(gateway, 'AddPortMapping', [
    ['NewRemoteHost', ''],
    ['NewExternalPort', String(port)],
    ['NewProtocol', 'TCP'],
    ['NewInternalPort', String(port)],
    ['NewInternalClient', internalAddress],
    ['NewEnabled', '1'],
    ['NewPortMappingDescription', label.slice(0, 60)],
    ['NewLeaseDuration', String(PORT_LEASE_SECONDS)]
  ])

  if (status === 200) return

  /*
   * Some routers reject any lease but a permanent one, answering 402 or 725.
   * Falling back keeps those working, and the mapping is still removed when the
   * server stops.
   */
  const retry = await callService(gateway, 'AddPortMapping', [
    ['NewRemoteHost', ''],
    ['NewExternalPort', String(port)],
    ['NewProtocol', 'TCP'],
    ['NewInternalPort', String(port)],
    ['NewInternalClient', internalAddress],
    ['NewEnabled', '1'],
    ['NewPortMappingDescription', label.slice(0, 60)],
    ['NewLeaseDuration', '0']
  ])
  if (retry.status === 200) return

  throw new LauncherError('NETWORK_ERROR', `could not open port ${port}: ${faultReason(body)}`, {
    title: 'The router would not open the port',
    message: `Your router answered, but refused to forward port ${port}. ${faultReason(body)}.`,
    actions: [
      'Check UPnP is enabled in the router settings',
      'Another device may already be using that port — try a different one',
      'Forward the port by hand in the router if it will not do it automatically'
    ]
  })
}

/** Takes the forwarding away again. Never throws — this runs during shutdown. */
export async function closePort(gateway: Gateway, port: number): Promise<boolean> {
  try {
    const { status } = await callService(gateway, 'DeletePortMapping', [
      ['NewRemoteHost', ''],
      ['NewExternalPort', String(port)],
      ['NewProtocol', 'TCP']
    ])
    return status === 200
  } catch (err) {
    log.warn(`could not close port ${port}: ${(err as Error).message}`)
    return false
  }
}

/** How long a mapping lasts before the router drops it of its own accord. */
export const PORT_LEASE_SECONDS = 43_200 // twelve hours

/** Everything the interface needs to describe the state of forwarding. */
export async function forwardingStatus(port: number, internalAddress: string): Promise<ForwardingStatus> {
  const gateway = await discoverGateway()
  if (!gateway) {
    return {
      available: false,
      open: false,
      externalAddress: null,
      router: null,
      reason:
        'No router on this network offered to forward ports. UPnP is often switched off by default — it can ' +
        'usually be turned on in the router settings.'
    }
  }

  const [external, mappedTo] = await Promise.all([
    externalAddress(gateway),
    existingMapping(gateway, port)
  ])

  return {
    available: true,
    open: mappedTo === internalAddress,
    externalAddress: external,
    router: gateway.description,
    reason: null
  }
}
