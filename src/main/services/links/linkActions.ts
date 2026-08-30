import type { ParsedLink } from './deepLinks'
import { parseDeepLink } from './deepLinks'
import { createLogger } from '../../core/logger'
import { emit, toast } from '../../core/events'
import { createInstance, listInstances } from '../instances/instanceService'
import { installModpackFromModrinth, installCurseForgeModpack } from '../content/modpackService'
import { launchInstance } from '../launch/launchService'
import { saveServer, listServers } from '../servers/serverService'
import type { Instance, LoaderId } from '@shared/types'

const log = createLogger('link-actions')

/**
 * What a `nexuscraft://` link actually does once it arrives.
 *
 * Everything here is a composition of things the launcher already does when
 * asked through its own interface — install a pack, save a server, launch an
 * instance at an address. A link is a shortcut into those, never a new power.
 *
 * Nothing runs silently: each action ends in a toast saying what happened, and
 * a join asks before it launches, because a link that starts Minecraft without
 * a word is a link nobody should click.
 */

/** Waiting for the user to confirm, held in the main process until answered. */
let pendingInvite: Extract<ParsedLink, { kind: 'join' }> | null = null

export function takePendingInvite(): Extract<ParsedLink, { kind: 'join' }> | null {
  const invite = pendingInvite
  pendingInvite = null
  return invite
}

export function currentPendingInvite(): Extract<ParsedLink, { kind: 'join' }> | null {
  return pendingInvite
}

/**
 * Handles a link.
 *
 * Installs happen immediately — the user pressed a button that said "install",
 * and the result is a new instance they can ignore. A join is different: it
 * launches the game, so it is offered to the interface as a prompt instead.
 */
export async function handleDeepLink(raw: string): Promise<void> {
  const link = parseDeepLink(raw)
  if (!link) {
    log.warn(`ignored an unusable link: ${raw.slice(0, 120)}`)
    toast('warning', 'That link was not understood', 'NexusCraft only opens its own install and invite links.')
    return
  }

  log.info(`handling a ${link.kind} link`)

  switch (link.kind) {
    case 'modpack-modrinth': {
      toast('info', 'Installing a modpack', 'Started from a link. This can take a few minutes.')
      const result = await installModpackFromModrinth(link.versionId)
      toast('success', `${result.instance.name} is ready`, 'Installed from a link.')
      return
    }

    case 'modpack-curseforge': {
      toast('info', 'Installing a modpack', 'Started from a link. This can take a few minutes.')
      const result = await installCurseForgeModpack(link.projectId, link.fileId)
      toast('success', `${result.instance.name} is ready`, 'Installed from a link.')
      return
    }

    case 'mod-modrinth': {
      // A single mod needs a target instance, which only the user can choose.
      emit('link:install-mod', { versionId: link.versionId })
      return
    }

    case 'join': {
      pendingInvite = link
      emit('link:invite', {
        host: link.host,
        port: link.port,
        name: link.name,
        minecraftVersion: link.minecraftVersion,
        loader: link.loader,
        packVersionId: link.packVersionId
      })
      return
    }
  }
}

/**
 * Accepts an invite: makes sure there is a client that can join, saves the
 * server, and launches straight into it.
 *
 * Building the client is the part that matters. An invite carries the version,
 * the loader and — when the host has one — the modpack, so the launcher can
 * arrive with a matching client rather than failing at the handshake with a
 * message about registry data.
 */
export async function acceptInvite(invite: {
  host: string
  port: number
  name?: string | null
  minecraftVersion?: string | null
  loader?: string | null
  packVersionId?: string | null
  /** Use this instance instead of matching or building one. */
  instanceId?: string | null
}): Promise<{ instance: Instance; address: string }> {
  const address = `${invite.host}:${invite.port}`
  const serverName = invite.name?.trim() || invite.host

  // Remember it either way, so the invite is not the only route back.
  const known = listServers().find(
    (server) => server.address.toLowerCase() === invite.host.toLowerCase() && server.port === invite.port
  )
  if (!known) {
    saveServer({
      id: null,
      name: serverName.slice(0, 64),
      address: invite.host,
      port: invite.port,
      notedVersion: invite.minecraftVersion ?? null,
      description: 'Added from an invite link'
    })
  }

  const instances = listInstances()

  if (invite.instanceId) {
    const chosen = instances.find((entry) => entry.id === invite.instanceId)
    if (chosen) {
      await launchInstance({ instanceId: chosen.id, serverAddress: address })
      return { instance: chosen, address }
    }
  }

  const loader = normaliseLoader(invite.loader)

  /*
   * A pack the host named is the strongest signal available: installing it
   * gives a client with the same mods at the same versions, which is the only
   * thing that reliably works on a modded server.
   */
  if (invite.packVersionId) {
    const existing = instances.find(
      (entry) =>
        entry.minecraftVersion === invite.minecraftVersion &&
        (!loader || entry.loader === loader)
    )
    if (!existing) {
      toast('info', 'Setting up to join', 'Installing the modpack this server runs. This can take a few minutes.')
      const result = await installModpackFromModrinth(invite.packVersionId, serverName)
      await launchInstance({ instanceId: result.instance.id, serverAddress: address })
      return { instance: result.instance, address }
    }
  }

  // Otherwise anything already matching, else a fresh instance.
  let instance = instances.find(
    (entry) =>
      (!invite.minecraftVersion || entry.minecraftVersion === invite.minecraftVersion) &&
      (!loader || entry.loader === loader)
  )

  if (!instance) {
    if (!invite.minecraftVersion) {
      // Without a version there is nothing to build, so the user has to pick.
      throw new Error('This invite did not say which Minecraft version the server runs. Pick an instance to join with.')
    }
    instance = await createInstance({
      name: `${serverName} (client)`.slice(0, 64),
      minecraftVersion: invite.minecraftVersion,
      loader: loader ?? 'vanilla'
    })
    toast('info', 'Made a client for this server', `${instance.name} — matching ${invite.minecraftVersion}.`)
  }

  await launchInstance({ instanceId: instance.id, serverAddress: address })
  return { instance, address }
}

/** Maps whatever a link said into a loader the launcher knows, or null. */
function normaliseLoader(value: string | null | undefined): LoaderId | null {
  const lower = value?.toLowerCase()
  if (lower === 'fabric' || lower === 'forge' || lower === 'neoforge' || lower === 'quilt' || lower === 'vanilla') {
    return lower
  }
  return null
}
