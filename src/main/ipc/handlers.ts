import { app, BrowserWindow, dialog, shell } from 'electron'
import { totalmem, freemem } from 'node:os'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { handle, assertAllChannelsHandled } from './registry'
import { checkCurseForgeUpdates, applyCurseForgeUpdate } from '../services/content/curseforgeUpdates'
import { hollowStatus, installHollow } from '../services/content/hollowInstall'
import { toolSetSizes } from '../companion/tools'
import { setMicrophoneWanted } from '../index'
import {
  modUpdateSettings,
  setModUpdateSettings,
  sweepForModUpdates,
  type ModUpdateSettings
} from '../services/content/modUpdateScheduler'
import { LauncherError } from '../core/errors'
import { createLogger } from '../core/logger'
import { dataRoot, logsRoot } from '../core/paths'
import { writeBootstrap } from '../core/bootstrap'
import { toast } from '../core/events'
import { writeDiagnostics } from '../services/support/diagnostics'

import { getSettings, updateSettings, recommendedRamMb } from '../services/settings/settingsService'
import {
  beginSignIn,
  cancelSignIn,
  getActiveAccount,
  listAccounts,
  logout,
  refreshAccount,
  setActiveAccount
} from '../services/auth/accountService'
import { isEncryptionAvailable } from '../services/auth/secureStore'
import {
  getManifestInfo,
  listInstalledVersionIds,
  deleteVersion,
  resolveVersion
} from '../services/minecraft/versionService'
import { listLoaderVersions } from '../services/loaders/loaderService'
import {
  createInstance,
  deleteInstance,
  duplicateInstance,
  findInstance,
  getInstance,
  instanceStats,
  listInstances,
  updateInstance,
  ensureInstanceLayout
} from '../services/instances/instanceService'
import { installInstance, repairInstance } from '../services/instances/installService'
import {
  exportInstance,
  importInstance,
  inspectInstanceArchive,
} from '../services/instances/transferService'
import { launchInstance, launchStates, recentLogs, stopInstance, isRunning } from '../services/launch/launchService'
import { autopsyAvailable, diagnoseWithModel } from '../services/launch/crashAutopsy'
import { activeTasks, getTask } from '../services/downloads/downloadManager'
import {
  detectJavaInstallations,
  probeJava,
  installManagedRuntime,
  componentForMajor
} from '../services/java/javaService'
import { createTask } from '../services/downloads/downloadManager'
import { analyseMods, deleteMod, importMods, modsDir, setModEnabled } from '../services/mods/modService'
import {
  contentDir,
  deleteContent,
  importContent,
  listContent,
  listScreenshots,
  setContentEnabled,
  type ContentKind
} from '../services/content/contentService'
import {
  backupWorld,
  deleteBackup,
  deleteWorld,
  importWorldArchive,
  listBackups,
  listWorlds,
  restoreBackup,
  savesDir,
  worldMap
} from '../services/worlds/worldService'
import { rankInstancesForServer } from '../services/servers/joinMatch'
import {
  serverRestartSettings,
  setServerRestartSettings,
  nextRestartAt
} from '../services/servers/restartScheduler'
import {
  findForeignInstances,
  importForeignInstance,
  type ForeignInstance
} from '../services/instances/launcherImport'
import {
  catalogue as directoryCatalogue,
  categories as directoryCategories,
  cachedDirectoryStatuses,
  loadRemoteCatalogue,
  lookupAddress,
  pingDirectoryServer,
  refreshDirectory
} from '../services/servers/directoryService'
import {
  checkAllServers,
  checkServer,
  deleteServer,
  importFromInstance,
  listServers,
  recordJoin,
  saveServer,
  setFavorite,
  cachedStatuses
} from '../services/servers/serverService'
import { applySkin, deleteSkin, favoriteSkin, importSkin, listSkins, resetSkin } from '../services/skins/skinService'
import { instanceSubdir } from '../services/instances/instanceService'
import {
  MINECRAFT_EULA_URL,
  acceptEula,
  allHostedServerStates,
  deleteHostedServer,
  getHostedServerConsole,
  installHostedServer,
  listHostedServers,
  listServerSoftware,
  listServerMods,
  importServerMods,
  setServerModEnabled,
  deleteServerMod,
  installServerModFromModrinth,
  instancesThatCanJoin,
  isHostedServerRunning,
  getHostedServer,
  hostedServerDir,
  serverAddress,
  connectAddress,
  serverModTarget,
  shareDetails,
  syncServerModsToInstance,
  serverUsesPlugins,
  saveHostedServer,
  sendHostedServerCommand,
  startHostedServer,
  stopHostedServer
} from '../services/servers/hostService'
import { splitAddress } from '../services/minecraft/argumentBuilder'
import {
  listCompanions,
  allCompanionStates,
  createCompanion,
  deleteCompanion,
  getCompanion,
  updateCompanion,
  startCompanion,
  stopCompanion,
  instructCompanion,
  getCompanionState,
  clearCompanionMemory,
  setCameraEnabled,
  interruptCompanion,
  companionUsage,
  resetUsage,
  listBuilds,
  undoBuild as undoCompanionBuild,
  rememberImport,
  listImports,
  getImport,
  buildWithCompanion
} from '../services/companion/companionService'
import { deploySteward, dismissSteward, stewardsFor } from '../services/companion/stewardService'
import {
  listCrews,
  createCrew,
  updateCrew,
  deleteCrew,
  startCrew,
  stopCrew,
  crewNotes,
  clearCrewNotes
} from '../services/companion/crewService'
import {
  backupHostedServer,
  deleteServerBackup,
  listServerBackups,
  restoreServerBackup,
  serverBackupSettings,
  setServerBackupSettings
} from '../services/backup/backupScheduler'
import { chat as llmChat, listModels, LlmError } from '../companion/llm'
import { getSecret } from '../services/auth/secureStore'
import {
  searchProjects,
  listVersions,
  installVersionToInstance,
  installVersionToDir,
  getProjectBody
} from '../services/content/modrinthService'
import {
  inspectModpack,
  installModpackFromFile,
  installModpackFromModrinth,
  installCurseForgeModpack
} from '../services/content/modpackService'
import { exportInstanceAsPack } from '../services/content/packExport'
import {
  listSnapshots,
  createSnapshot,
  restoreSnapshot,
  deleteSnapshot,
  diffSnapshot
} from '../services/instances/snapshotService'
import {
  tunnelSettings,
  setTunnelSettings,
  tunnelState,
  startTunnel,
  stopTunnel
} from '../services/servers/tunnelService'
import { buildJoinLink } from '../services/links/deepLinks'
import { acceptInvite, currentPendingInvite, takePendingInvite } from '../services/links/linkActions'
import {
  installModpackAsServerFromFile,
  installModpackAsServerFromModrinth,
  installModpackAsServerFromCurseForge
} from '../services/content/modpackServer'
import {
  searchCurseForge,
  listCurseForgeFiles,
  installCurseForgeFile,
  installCurseForgeFileToDir,
  isConfigured as curseForgeConfigured,
  verifyApiKey as verifyCurseForgeKey
} from '../services/content/curseforgeService'
import { ROUTINES } from '../companion/routines'
import { BLUEPRINT_LIBRARY, findLibraryBlueprint } from '../companion/build/library'
import { blueprintSize, billOfMaterials } from '../companion/build/blueprint'
import { loadSchematic } from '../companion/build/schematic'
import {
  exportBlueprint,
  safeFileName,
  schematicsDir,
  structuresDir,
  serverWorldName
} from '../companion/build/schematicExport'
import { randomUUID } from 'node:crypto'
import { clearPresence, showIdlePresence } from '../services/presence/presenceService'
import {
  discoverGateway,
  openPort,
  closePort,
  forwardingStatus,
  keepPortOpen,
  stopKeepingPortOpen
} from '../services/servers/portForwarding'
import {
  checkModUpdates,
  applyModUpdate,
  modChangelog,
  listRollbacks,
  rollbackModUpdate
} from '../services/content/modrinthService'
import {
  listDataPacks,
  buildDataPack,
  installDataPack,
  listInstalledDataPacks,
  removeDataPack,
  exportDataPack
} from '../services/content/datapackService'
import type { CrashFix, ModUpdate, DataPackOptionValues, DirectoryCompatibility } from '@shared/types'
import type { ContentKindId, LoaderId, ModpackInstallResult } from '@shared/types'
import type { SaveHostedServerInput, ModpackServerInstallResult } from '@shared/types'

/** Announces a finished modpack install, including anything it had to skip. */
function reportModpack(result: ModpackInstallResult): void {
  toast(
    'success',
    `${result.instance.name} is ready`,
    `${result.installedFiles} files and ${result.overrides} config files installed.` +
      (result.skipped.length > 0 ? ` ${result.skipped.length} were skipped as untrusted downloads.` : '')
  )
}

/**
 * Announces a pack installed as a server.
 *
 * This says more than the instance version because more was decided on the
 * user's behalf: a client-only mod that was turned off is a change they did not
 * ask for and would otherwise discover by wondering where their minimap went.
 */
function reportModpackServer(result: ModpackServerInstallResult): void {
  const notes: string[] = [`${result.installedFiles} files and ${result.overrides} config files installed.`]
  if (result.clientOnlyMods.length > 0) {
    notes.push(
      `${result.clientOnlyMods.length} client-only mod${result.clientOnlyMods.length === 1 ? '' : 's'} ` +
        `turned off (${result.clientOnlyMods.slice(0, 3).join(', ')}${result.clientOnlyMods.length > 3 ? '…' : ''}).`
    )
  }
  if (result.skipped.length > 0) {
    notes.push(`${result.skipped.length} could not be downloaded automatically.`)
  }
  notes.push('Accept the EULA on the server to start it.')
  toast('success', `${result.server.name} is ready to host`, notes.join(' '))
}

const log = createLogger('handlers')

function mainWindow(): BrowserWindow | null {
  return BrowserWindow.getAllWindows()[0] ?? null
}

/**
 * Domains the launcher will open in the user's browser.
 *
 * Matching is on the registrable domain and its subdomains, not on an exact
 * host list. Microsoft moves sign-in between hosts — the device code page is
 * `www.microsoft.com/devicelogin` on some tenants and `microsoft.com/devicelogin`
 * on others — and an exact-host list silently breaks sign-in when it does.
 */
const ALLOWED_EXTERNAL_DOMAINS = [
  // Microsoft identity and account surfaces used by the sign-in flow
  'microsoft.com',
  'microsoftonline.com',
  'live.com',
  'xbox.com',
  'aka.ms',
  'azure.com',
  // Mojang / Minecraft
  'minecraft.net',
  'mojang.com',
  // Mod ecosystem
  'fabricmc.net',
  'quiltmc.org',
  'minecraftforge.net',
  'neoforged.net',
  'modrinth.com',
  'curseforge.com',
  'github.com',
  // Where to get the relay agent the launcher can drive, for people whose
  // router cannot forward a port at all.
  'playit.gg'
]

/** True when `hostname` is one of the allowed domains, or a subdomain of one. */
function isAllowedExternalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  return ALLOWED_EXTERNAL_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`))
}

/**
 * Refuses content a server has no way to use.
 *
 * Resource packs and shaders are drawn by the client; a server that was handed
 * one filed it away in `mods/` and loaded nothing, which looks like an install
 * that worked and a mod that does not function.
 */
function assertServerCanUse(kind: ContentKindId, serverName: string): void {
  if (kind === 'mod' || kind === 'modpack') return

  const what = kind === 'resourcepack' ? 'Resource packs' : 'Shaders'
  throw new LauncherError('INVALID_INPUT', `a server cannot use a ${kind}`, {
    title: `A server cannot use that`,
    message: `${what} are drawn by the game on each player's own machine, so installing one into "${serverName}" would do nothing.`,
    actions: [`Install it into the instance you play with instead`]
  })
}

/** The most recent scan for other launchers' instances, kept between calls. */
let foreignFound: ForeignInstance[] = []

export function registerIpcHandlers(): void {
  /* ------------------------------------------------------------- system */

  handle('app:info', () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
    platform: process.platform,
    arch: process.arch,
    dataDir: dataRoot(),
    logsDir: logsRoot(),
    secureStorage: isEncryptionAvailable(),
    isPackaged: app.isPackaged,
    /*
     * True when this copy was pointed at a throwaway data directory. Such a
     * window is empty by design and otherwise indistinguishable from the real
     * launcher, which has already caused one "where did all my instances go".
     */
    scratchData: Boolean(process.env.NEXUSCRAFT_DATA_DIR?.trim())
  }))

  handle('app:openExternal', async (payload: { url: string }) => {
    const url = new URL(payload.url)
    if (url.protocol !== 'https:') {
      throw new LauncherError('INVALID_INPUT', `refused non-https url`, {
        title: 'That link was blocked',
        message: 'NexusCraft only opens secure https links.',
        actions: []
      })
    }
    if (!isAllowedExternalHost(url.hostname)) {
      throw new LauncherError('INVALID_INPUT', `refused external host ${url.hostname}`, {
        title: 'That link was blocked',
        message: `NexusCraft only opens links to sites it knows: Microsoft, Mojang, and the mod loader projects. It refused to open ${url.hostname}.`,
        actions: ['Copy the address and open it yourself if you trust it']
      })
    }
    await shell.openExternal(url.toString())
    return true
  })

  handle('app:openPath', async (payload: { path: string }) => {
    // Confine folder opening to the launcher's own data directory.
    const root = dataRoot()
    const resolved = join(payload.path)
    if (!resolved.startsWith(root)) {
      throw new LauncherError('INVALID_INPUT', 'path is outside the data directory')
    }
    if (!existsSync(resolved)) throw new LauncherError('NOT_FOUND', 'that folder does not exist yet')
    const error = await shell.openPath(resolved)
    if (error) throw new LauncherError('UNKNOWN', error)
    return true
  })

  handle('app:pickDirectory', async (payload: { title?: string } | undefined) => {
    const window = mainWindow()
    if (!window) return null
    const result = await dialog.showOpenDialog(window, {
      title: payload?.title ?? 'Choose a folder',
      properties: ['openDirectory', 'createDirectory']
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  handle(
    'app:pickFiles',
    async (payload: { title?: string; extensions?: string[]; multi?: boolean } | undefined) => {
      const window = mainWindow()
      if (!window) return []
      const result = await dialog.showOpenDialog(window, {
        title: payload?.title ?? 'Choose files',
        properties: payload?.multi === false ? ['openFile'] : ['openFile', 'multiSelections'],
        filters: payload?.extensions?.length
          ? [{ name: 'Supported files', extensions: payload.extensions }]
          : undefined
      })
      return result.canceled ? [] : result.filePaths
    }
  )

  handle(
    'app:pickSavePath',
    async (payload: { title?: string; defaultName?: string; extensions?: string[] }) => {
      const window = mainWindow()
      if (!window) return null
      const result = await dialog.showSaveDialog(window, {
        title: payload.title ?? 'Save as',
        defaultPath: payload.defaultName,
        filters: payload.extensions?.length
          ? [{ name: 'Supported files', extensions: payload.extensions }]
          : undefined
      })
      return result.canceled ? null : (result.filePath ?? null)
    }
  )

  handle('app:window', (payload: { action: 'minimize' | 'maximize' | 'close' }) => {
    const window = mainWindow()
    if (!window) return false
    switch (payload.action) {
      case 'minimize':
        window.minimize()
        break
      case 'maximize':
        if (window.isMaximized()) window.unmaximize()
        else window.maximize()
        break
      case 'close':
        window.close()
        break
    }
    return true
  })

  handle(
    'app:reportError',
    (payload: { source: string; message: string; stack?: string; componentStack?: string }) => {
      // A crash in the UI used to leave nothing but a blank window. Routing it
      // into the same log as everything else makes it diagnosable.
      log.error(
        `renderer failure [${payload.source}]: ${payload.message}` +
          (payload.stack ? `\n  stack: ${payload.stack}` : '') +
          (payload.componentStack ? `\n  components: ${payload.componentStack}` : '')
      )
      return true
    }
  )

  /**
   * Gathers everything needed to diagnose a problem into one zip.
   *
   * Deliberately a file the user can open and read before sending it anywhere:
   * it is plain text, and everything in it has been through the log redactor.
   */
  handle(
    'app:diagnostics',
    async (payload: { outputPath: string; instanceId?: string; note?: string }) => {
      const result = await writeDiagnostics(payload.outputPath, {
        instanceId: payload.instanceId,
        note: payload.note
      })
      toast(
        'success',
        'Diagnostics saved',
        `${result.files} files, ${(result.bytes / 1024).toFixed(0)} KB. Open it to see exactly what it contains.`
      )
      return result
    }
  )

  handle('app:systemMemory', () => {
    const recommended = recommendedRamMb()
    return {
      totalMb: Math.floor(totalmem() / 1024 / 1024),
      freeMb: Math.floor(freemem() / 1024 / 1024),
      ...recommended
    }
  })

  /* ----------------------------------------------------------- settings */

  handle('settings:get', () => ({ ...getSettings(), dataDir: dataRoot() }))

  handle('settings:update', (patch: Record<string, unknown>) => {
    // Moving the data directory can only take effect on the next start.
    if (typeof patch.dataDir === 'string' && patch.dataDir !== dataRoot()) {
      writeBootstrap({ dataDir: patch.dataDir })
      toast('info', 'Data folder updated', 'Restart NexusCraft for the new location to take effect.')
      delete patch.dataDir
    }

    const next = updateSettings(patch)

    // Turning presence off should take effect now, not at the next launch.
    if (patch.discordPresence === false) clearPresence()
    else if (patch.discordPresence === true) void showIdlePresence()

    return { ...next, dataDir: dataRoot() }
  })

  /* --------------------------------------------------------------- auth */

  handle('auth:begin', async () => await beginSignIn())
  handle('auth:cancel', () => {
    cancelSignIn()
    return true
  })
  handle('auth:list', () => listAccounts())
  handle('auth:setActive', (payload: { accountId: string }) => setActiveAccount(payload.accountId))
  handle('auth:logout', (payload: { accountId: string }) => {
    logout(payload.accountId)
    return true
  })
  handle('auth:refresh', async (payload: { accountId: string }) => await refreshAccount(payload.accountId))

  /* ----------------------------------------------------------- versions */

  handle('versions:manifest', async (payload: { refresh?: boolean } | undefined) =>
    await getManifestInfo(payload?.refresh ?? false)
  )

  handle('versions:installed', async () => {
    const ids = await listInstalledVersionIds()
    const details = await Promise.all(
      ids.map(async (id) => {
        try {
          const version = await resolveVersion(id)
          return {
            id,
            type: version.type,
            javaMajor: version.javaVersion?.majorVersion ?? null,
            releaseTime: version.releaseTime ?? null,
            isLoaderProfile: (version.resolvedBaseId ?? id) !== id
          }
        } catch {
          return { id, type: 'unknown', javaMajor: null, releaseTime: null, isLoaderProfile: false }
        }
      })
    )
    return details
  })

  handle(
    'versions:loaderVersions',
    async (payload: { loader: 'vanilla' | 'fabric' | 'forge' | 'neoforge' | 'quilt'; minecraftVersion: string }) =>
      await listLoaderVersions(payload.loader, payload.minecraftVersion)
  )

  handle('versions:delete', async (payload: { versionId: string }) => {
    const inUse = listInstances().some(
      (i) => i.resolvedVersionId === payload.versionId || i.minecraftVersion === payload.versionId
    )
    if (inUse) {
      throw new LauncherError('INVALID_INPUT', 'version is in use', {
        title: 'That version is still in use',
        message: 'At least one instance uses this version. Remove or change those instances first.',
        actions: ['Open the Instances screen and change the version', 'Or delete the instances that use it']
      })
    }
    await deleteVersion(payload.versionId)
    return true
  })

  /* ---------------------------------------------------------- instances */

  handle('instances:list', () => listInstances())
  handle('instances:create', async (payload: Parameters<typeof createInstance>[0]) => await createInstance(payload))
  handle('instances:update', (payload: { id: string; patch: Record<string, unknown> }) =>
    updateInstance(payload.id, payload.patch)
  )
  handle('instances:delete', async (payload: { id: string; deleteFiles: boolean }) => {
    if (isRunning(payload.id)) throw new LauncherError('ALREADY_RUNNING', 'cannot delete a running instance')
    await deleteInstance(payload.id, payload.deleteFiles)
    return true
  })
  handle('instances:duplicate', async (payload: { id: string; name: string }) =>
    await duplicateInstance(payload.id, payload.name)
  )
  handle('instances:stats', async (payload: { id: string }) => await instanceStats(payload.id))

  handle('instances:openFolder', async (payload: { id: string; sub?: string }) => {
    const instance = getInstance(payload.id)
    await ensureInstanceLayout(instance)
    const target = payload.sub ? instanceSubdir(instance, payload.sub) : instance.gameDir
    const error = await shell.openPath(target)
    if (error) throw new LauncherError('UNKNOWN', error)
    return true
  })

  handle('instances:install', async (payload: { id: string }) => await installInstance(payload.id))
  handle('instances:repair', async (payload: { id: string }) => await repairInstance(payload.id))

  handle(
    'instances:export',
    async (payload: { id: string; outputPath: string; includeWorlds: boolean; includeScreenshots: boolean }) => {
      const instance = getInstance(payload.id)
      const exported = await exportInstance(payload.id, payload.outputPath, {
        includeWorlds: payload.includeWorlds,
        includeScreenshots: payload.includeScreenshots
      })
      toast('success', `${instance.name} exported`, `${exported.entries} files written.`)
      return exported
    }
  )

  handle('instances:inspectArchive', async (payload: { filePath: string }) =>
    await inspectInstanceArchive(payload.filePath)
  )

  handle('instances:import', async (payload: { filePath: string; name?: string }) =>
    await importInstance(payload.filePath, payload.name)
  )

  /* -------------------------------------------------- instance snapshots */

  handle('instances:snapshots', async (payload: { id: string }) => await listSnapshots(payload.id))

  handle('instances:snapshot', async (payload: { id: string; name: string; note?: string }) => {
    const snapshot = await createSnapshot(payload.id, payload.name, payload.note ?? '')
    toast(
      'success',
      `Snapshot "${snapshot.name}" taken`,
      snapshot.linked
        ? `${snapshot.files} files, using almost no extra disk.`
        : `${snapshot.files} files copied (${(snapshot.bytes / 1024 / 1024).toFixed(0)} MB — this drive does not support hard links).`
    )
    return snapshot
  })

  handle('instances:restoreSnapshot', async (payload: { id: string; snapshotId: string }) => {
    const snapshot = await restoreSnapshot(payload.id, payload.snapshotId)
    toast('success', `Restored "${snapshot.name}"`, 'What was there before was snapshotted first.')
    return snapshot
  })

  handle('instances:deleteSnapshot', async (payload: { id: string; snapshotId: string }) => {
    await deleteSnapshot(payload.id, payload.snapshotId)
    return true
  })

  handle('instances:diffSnapshot', async (payload: { id: string; snapshotId: string }) =>
    await diffSnapshot(payload.id, payload.snapshotId)
  )

  handle(
    'instances:exportPack',
    async (payload: {
      id: string
      outputPath: string
      name?: string
      version?: string
      summary?: string
      includeConfigs?: boolean
      includeWorlds?: boolean
    }) => {
      const instance = getInstance(payload.id)
      const result = await exportInstanceAsPack(instance, payload.outputPath, {
        name: payload.name,
        version: payload.version,
        summary: payload.summary,
        includeConfigs: payload.includeConfigs,
        includeWorlds: payload.includeWorlds
      })

      const detail =
        `${result.linked} mod${result.linked === 1 ? '' : 's'} linked to Modrinth, ` +
        `${result.overrides} file${result.overrides === 1 ? '' : 's'} bundled.` +
        (result.unmatched.length > 0
          ? ` ${result.unmatched.length} jar${result.unmatched.length === 1 ? ' was' : 's were'} not on Modrinth and shipped as copies.`
          : '')

      toast('success', `${instance.name} exported as a modpack`, detail)
      return result
    }
  )

  /**
   * Instances belonging to other launchers on this machine.
   *
   * The scan result is held so an import can refer to an entry by id without
   * the renderer having to hand back a folder path it was given — which would
   * be a path the main process then had to re-validate.
   */
  handle('instances:findForeign', async () => {
    foreignFound = await findForeignInstances()
    return foreignFound
  })

  handle('instances:importForeign', async (payload: { id: string; name?: string }) => {
    const entry = foreignFound.find((candidate) => candidate.id === payload.id)
    if (!entry) {
      throw new LauncherError('NOT_FOUND', 'that instance was not in the last scan', {
        title: 'Scan again first',
        message: 'The list of importable instances is from a scan that has since been replaced.',
        actions: ['Press Scan and try again']
      })
    }

    const result = await importForeignInstance(entry, payload.name)
    toast(
      'success',
      `${result.name} imported`,
      `Copied ${result.copiedFolders.join(', ') || 'nothing'}. Game files are downloaded fresh on first launch.`
    )
    return result
  })

  /* ------------------------------------------------------------- launch */

  handle('launch:start', async (payload: { instanceId: string; serverAddress?: string }) => {
    const state = await launchInstance({ instanceId: payload.instanceId, serverAddress: payload.serverAddress })
    // Record the join against the saved server, if this launch targeted one.
    if (payload.serverAddress) noteServerJoin(payload.serverAddress)
    return state
  })
  handle('launch:stop', (payload: { instanceId: string }) => {
    stopInstance(payload.instanceId)
    return true
  })
  handle('launch:state', () => launchStates())
  handle('launch:logs', (payload: { instanceId: string; limit?: number }) =>
    recentLogs(payload.instanceId, payload.limit ?? 500)
  )

  handle('launch:autopsyAvailable', async () => ({ available: await autopsyAvailable() }))

  handle('launch:autopsy', async (payload: { instanceId: string }) => {
    const instance = getInstance(payload.instanceId)
    const state = launchStates().find((entry) => entry.instanceId === payload.instanceId)
    return await diagnoseWithModel(instance, state?.crash ?? null)
  })

  /**
   * Carries out one of the autopsy's fixes.
   *
   * Deliberately narrow: each branch is something the launcher already exposes
   * as a button elsewhere. A model suggesting a change is not the same as a
   * model being allowed to make one, so anything outside this list stays advice.
   */
  handle('launch:applyFix', async (payload: { instanceId: string; fix: CrashFix }) => {
    const instance = getInstance(payload.instanceId)
    const { fix } = payload

    switch (fix.kind) {
      case 'disable-mod': {
        if (!fix.modFileName) throw new LauncherError('INVALID_INPUT', 'no mod named')
        await setModEnabled(instance, fix.modFileName, false)
        toast('success', 'Mod disabled', `${fix.modFileName} is turned off. Try launching again.`)
        return { applied: 'disable-mod' }
      }

      case 'update-mod': {
        if (!fix.modFileName) throw new LauncherError('INVALID_INPUT', 'no mod named')
        const updates = await checkModUpdates(instance)
        const match = updates.find((update) => update.fileName === fix.modFileName)
        if (!match) {
          throw new LauncherError('NOT_FOUND', 'no newer build', {
            title: 'There is no newer build of that mod',
            message: `Modrinth has nothing newer than the ${fix.modFileName} you already have for this version.`,
            actions: ['Try disabling it instead', 'Or check the mod page for a build matching this Minecraft version']
          })
        }
        await applyModUpdate(instance, match)
        toast('success', `${match.modName} updated`, `Now on ${match.newVersion}. Try launching again.`)
        return { applied: 'update-mod' }
      }

      case 'more-memory':
      case 'less-memory': {
        const recommended = recommendedRamMb()
        const current = instance.java.maxRamMb
        const step = 1024
        const next =
          fix.kind === 'more-memory'
            ? Math.min(current + step, recommended.ceiling)
            : Math.max(current - step, 1024)

        if (next === current) {
          throw new LauncherError('INVALID_INPUT', 'memory already at the limit', {
            title: 'Memory is already as far as it goes',
            message:
              fix.kind === 'more-memory'
                ? `This instance already has ${current} MB, which is the most this machine can safely give it.`
                : `This instance is already at ${current} MB; lowering it further would not leave enough to start.`,
            actions: ['Try one of the other fixes']
          })
        }

        updateInstance(instance.id, { java: { ...instance.java, maxRamMb: next } })
        toast('success', 'Memory changed', `${instance.name} now has ${next} MB. Try launching again.`)
        return { applied: fix.kind, maxRamMb: next }
      }

      case 'repair': {
        await repairInstance(instance.id)
        toast('success', 'Instance repaired', 'Missing and damaged files were downloaded again.')
        return { applied: 'repair' }
      }

      default:
        // 'manual' is advice; there is nothing for the launcher to do.
        return { applied: 'manual' }
    }
  })

  /* ---------------------------------------------------------- downloads */

  handle('downloads:state', () => activeTasks())
  handle('downloads:pause', (payload: { taskId: string }) => {
    getTask(payload.taskId)?.pause()
    return true
  })
  handle('downloads:resume', (payload: { taskId: string }) => {
    getTask(payload.taskId)?.resume()
    return true
  })
  handle('downloads:cancel', (payload: { taskId: string }) => {
    getTask(payload.taskId)?.cancel()
    return true
  })
  handle('downloads:retry', async (payload: { taskId: string }) => {
    const task = getTask(payload.taskId)
    if (!task) throw new LauncherError('NOT_FOUND', 'that download is no longer tracked')
    task.retryFailed()
    await task.run()
    task.markDone()
    return true
  })

  /* --------------------------------------------------------------- java */

  handle('java:list', async (payload: { refresh?: boolean } | undefined) =>
    await detectJavaInstallations(payload?.refresh ?? false)
  )

  handle('java:test', async (payload: { path: string }) => {
    const probed = await probeJava(payload.path)
    if (!probed) {
      throw new LauncherError('JAVA_NOT_FOUND', `not a usable java executable: ${payload.path}`, {
        title: 'That is not a working Java runtime',
        message: 'NexusCraft could not run that file to ask its version. Pick the java.exe inside a JRE or JDK "bin" folder.',
        actions: ['Browse to something like C:\\Program Files\\Java\\jdk-21\\bin\\java.exe']
      })
    }
    return probed
  })

  handle('java:installRuntime', async (payload: { majorVersion: number }) => {
    const component = componentForMajor(payload.majorVersion)
    const task = createTask({ label: `Java ${payload.majorVersion}`, phase: 'java-runtime' })
    const path = await installManagedRuntime(component, task)
    task.markDone()
    await detectJavaInstallations(true)
    toast('success', 'Java installed', `Java ${payload.majorVersion} is ready to use.`)
    return { path, component }
  })

  handle('java:recommend', async (payload: { minecraftVersion: string }) => {
    try {
      const version = await resolveVersion(payload.minecraftVersion)
      return {
        majorVersion: version.javaVersion?.majorVersion ?? null,
        component: version.javaVersion?.component ?? null
      }
    } catch {
      return { majorVersion: null, component: null }
    }
  })

  /* --------------------------------------------------------------- mods */

  handle('mods:list', async (payload: { instanceId: string }) => await analyseMods(getInstance(payload.instanceId)))

  handle('mods:setEnabled', async (payload: { instanceId: string; fileName: string; enabled: boolean }) => {
    await setModEnabled(getInstance(payload.instanceId), payload.fileName, payload.enabled)
    return true
  })

  handle('mods:delete', async (payload: { instanceId: string; fileName: string }) => {
    await deleteMod(getInstance(payload.instanceId), payload.fileName)
    return true
  })

  handle('mods:import', async (payload: { instanceId: string; files: string[] }) => {
    const count = await importMods(getInstance(payload.instanceId), payload.files)
    return { imported: count }
  })

  handle('mods:openFolder', async (payload: { instanceId: string }) => {
    const error = await shell.openPath(modsDir(getInstance(payload.instanceId)))
    if (error) throw new LauncherError('UNKNOWN', error)
    return true
  })

  /* ------------------------------------------------ resource packs / shaders */

  handle('content:list', async (payload: { instanceId: string; kind: ContentKind }) =>
    await listContent(getInstance(payload.instanceId), payload.kind)
  )

  handle('content:import', async (payload: { instanceId: string; kind: ContentKind; files: string[] }) => {
    const count = await importContent(getInstance(payload.instanceId), payload.kind, payload.files)
    return { imported: count }
  })

  handle(
    'content:setEnabled',
    async (payload: { instanceId: string; kind: ContentKind; fileName: string; enabled: boolean }) => {
      await setContentEnabled(getInstance(payload.instanceId), payload.kind, payload.fileName, payload.enabled)
      return true
    }
  )

  handle('content:delete', async (payload: { instanceId: string; kind: ContentKind; fileName: string }) => {
    await deleteContent(getInstance(payload.instanceId), payload.kind, payload.fileName)
    return true
  })

  handle(
    'content:openFolder',
    async (payload: { instanceId: string; kind: 'resourcepacks' | 'shaderpacks' | 'screenshots' }) => {
      const instance = getInstance(payload.instanceId)
      const dir =
        payload.kind === 'screenshots'
          ? instanceSubdir(instance, 'screenshots')
          : contentDir(instance, payload.kind)
      const error = await shell.openPath(dir)
      if (error) throw new LauncherError('UNKNOWN', error)
      return true
    }
  )

  handle('content:screenshots', async (payload: { instanceId: string }) =>
    await listScreenshots(getInstance(payload.instanceId))
  )

  /* ----------------------------------------------------------- modrinth */

  handle(
    'modrinth:search',
    async (payload: {
      query: string
      kind: ContentKindId
      gameVersion?: string | null
      loader?: string | null
      offset?: number
      limit?: number
      instanceId?: string | null
    }) =>
      await searchProjects({
        query: payload.query,
        kind: payload.kind,
        gameVersion: payload.gameVersion,
        loader: payload.loader,
        offset: payload.offset,
        limit: payload.limit,
        instance: payload.instanceId ? findInstance(payload.instanceId) : null
      })
  )

  handle(
    'modrinth:versions',
    async (payload: { projectId: string; kind: ContentKindId; gameVersion?: string | null; loader?: string | null }) =>
      await listVersions(payload.projectId, payload.kind, payload.gameVersion, payload.loader)
  )

  handle('modrinth:install', async (payload: { instanceId: string; versionId: string; kind: ContentKindId }) => {
    const instance = getInstance(payload.instanceId)
    const result = await installVersionToInstance(instance, payload.versionId, payload.kind)

    const total = result.installed.length + result.dependencies.length
    if (total === 0 && result.skipped.length > 0) {
      toast('info', 'Already installed', `${result.skipped[0]} is already in this instance.`)
    } else {
      toast(
        'success',
        `Added to ${instance.name}`,
        result.dependencies.length > 0
          ? `${result.installed.join(', ')} plus ${result.dependencies.length} required dependenc${result.dependencies.length === 1 ? 'y' : 'ies'}.`
          : result.installed.join(', ')
      )
    }
    return result
  })

  handle('modrinth:project', async (payload: { projectId: string }) => await getProjectBody(payload.projectId))

  handle('modpack:inspect', async (payload: { filePath: string }) => await inspectModpack(payload.filePath))

  handle('modpack:installFile', async (payload: { filePath: string; name?: string }) => {
    const result = await installModpackFromFile(payload.filePath, payload.name)
    reportModpack(result)
    return result
  })

  handle('modpack:installModrinth', async (payload: { versionId: string; name?: string }) => {
    const result = await installModpackFromModrinth(payload.versionId, payload.name)
    reportModpack(result)
    return result
  })

  /* ------------------------------------------------------- mod updates */

  /*
   * Both catalogues, one list.
   *
   * A player does not think of a mod as "a Modrinth mod"; they think of it as
   * out of date. Checking one site and silently ignoring the other made the
   * updater look complete while never mentioning half the pack.
   *
   * Run together rather than in sequence: each is a network round trip over a
   * whole mods folder, and doing them one after the other doubles the wait for
   * no benefit. A failure on one side is not allowed to lose the other's
   * results, which is why this settles rather than rejecting.
   */
  handle('mods:checkUpdates', async (payload: { instanceId: string }) => {
    const instance = getInstance(payload.instanceId)
    const [modrinth, curseforge] = await Promise.allSettled([
      checkModUpdates(instance),
      checkCurseForgeUpdates(instance)
    ])

    if (modrinth.status === 'rejected') {
      log.warn(`Modrinth update check failed: ${String(modrinth.reason)}`)
    }
    if (curseforge.status === 'rejected') {
      log.warn(`CurseForge update check failed: ${String(curseforge.reason)}`)
    }

    const found = [
      ...(modrinth.status === 'fulfilled' ? modrinth.value : []),
      ...(curseforge.status === 'fulfilled' ? curseforge.value : [])
    ]

    // The same jar can be on both sites. Modrinth is listed first and wins,
    // so an update is never offered twice for one file.
    const seen = new Set<string>()
    return found.filter((update) => {
      if (seen.has(update.fileName)) return false
      seen.add(update.fileName)
      return true
    })
  })

  handle('mods:applyUpdate', async (payload: { instanceId: string; update: Record<string, unknown> }) => {
    const instance = getInstance(payload.instanceId)
    // The renderer echoes back an update it was given, so re-validate the
    // fields that actually drive a download rather than trusting the shape.
    const update = payload.update as unknown as ModUpdate
    if (typeof update?.newVersionId !== 'string' || typeof update?.fileName !== 'string') {
      throw new LauncherError('INVALID_INPUT', 'malformed update payload')
    }
    // Routed on where it came from. Absent means Modrinth, which is what every
    // update stored before CurseForge was added.
    if (update.source === 'curseforge') await applyCurseForgeUpdate(instance, update)
    else await applyModUpdate(instance, update)
    toast('success', `${update.modName} updated`, `Now on ${update.newVersion}. The old jar is kept so you can undo this.`)
    return true
  })

  handle('mods:changelog', async (payload: { instanceId: string; update: Record<string, unknown> }) => {
    getInstance(payload.instanceId)
    const update = payload.update as unknown as ModUpdate
    if (typeof update?.newVersionId !== 'string') {
      throw new LauncherError('INVALID_INPUT', 'malformed update payload')
    }
    return await modChangelog(update)
  })

  handle('mods:autoUpdateSettings', () => modUpdateSettings())

  handle('mods:setAutoUpdateSettings', (payload: { patch: Partial<ModUpdateSettings> }) =>
    setModUpdateSettings(payload.patch)
  )

  /*
   * The manual "check everything now" behind the settings. Runs the same sweep
   * the timer does, so what you see here is exactly what it would have done.
   */
  handle('mods:hollowStatus', async (payload: { instanceId: string }) =>
    await hollowStatus(getInstance(payload.instanceId))
  )

  handle('mods:installHollow', async (payload: { instanceId: string }) => {
    const instance = getInstance(payload.instanceId)
    const result = await installHollow(instance)
    toast(
      result.warning ? 'warning' : 'success',
      'Hollow installed',
      result.warning ??
        (result.model
          ? `Configured to use ${result.model} on your local Ollama.`
          : 'Installed. Check config/hollow.properties for the model.')
    )
    return result
  })

  handle('mods:checkAllNow', async () => await sweepForModUpdates('checked by hand'))

  handle('mods:rollbacks', async (payload: { instanceId: string }) =>
    await listRollbacks(getInstance(payload.instanceId))
  )

  handle('mods:rollback', async (payload: { instanceId: string; fileName: string }) => {
    const entry = await rollbackModUpdate(getInstance(payload.instanceId), payload.fileName)
    toast('success', `${entry.modName} rolled back`, `Back on ${entry.fromVersion ?? 'the previous build'}.`)
    return entry
  })

  /* -------------------------------------------------------- curseforge */

  /* ------------------------------------------------------- port forwarding */

  /*
   * Mods for a server, from the same places instances get them.
   *
   * A server takes exactly the same jars an instance does, so this hands the
   * existing installer the server's mods folder rather than teaching it about
   * servers. Dependencies are resolved the same way, which is the part that
   * makes dropping jars in by hand miserable.
   */
  handle(
    'host:installModrinth',
    async (payload: { id: string; versionId: string; kind: ContentKindId }) => {
      const server = getHostedServer(payload.id)
      assertServerCanUse(payload.kind, server.name)
      const target = serverModTarget(server)

      const result = await installVersionToDir(
        { dir: target.dir, taskId: server.id, loader: target.loader, minecraftVersion: target.minecraftVersion },
        payload.versionId,
        payload.kind
      )

      const total = result.installed.length + result.dependencies.length
      if (total === 0 && result.skipped.length > 0) {
        toast('info', 'Already on the server', `${result.skipped[0]} is already there.`)
      } else {
        toast(
          'success',
          `Added to ${server.name}`,
          result.dependencies.length > 0
            ? `${result.installed.join(', ')} plus ${result.dependencies.length} required dependenc${result.dependencies.length === 1 ? 'y' : 'ies'}. Restart the server to load it.`
            : `${result.installed.join(', ')}. Restart the server to load it.`
        )
      }
      return result
    }
  )

  handle(
    'host:installCurseForge',
    async (payload: { id: string; projectId: string; fileId: string; kind: ContentKindId }) => {
      const server = getHostedServer(payload.id)
      assertServerCanUse(payload.kind, server.name)
      const target = serverModTarget(server)

      const result = await installCurseForgeFileToDir(
        { dir: target.dir, taskId: server.id },
        payload.projectId,
        payload.fileId,
        server.name
      )

      toast('success', `Added to ${server.name}`, `${result.installed.join(', ')}. Restart the server to load it.`)
      return result
    }
  )

  handle('host:share', async (payload: { id: string }) => await shareDetails(payload.id))

  handle('host:forwardStatus', async (payload: { id: string }) => {
    const server = getHostedServer(payload.id)
    const [host] = connectAddress(server).split(':')
    return await forwardingStatus(server.port, host)
  })

  /**
   * Opens the server's port on the router.
   *
   * Refused while the server does not verify players with Mojang, unless the
   * caller says it understands. Those two settings are each reasonable alone
   * and dangerous together: an unverified server reachable from the internet
   * can be joined by anyone, under any name they care to type, including the
   * owner's or an operator's.
   */
  handle('host:openPort', async (payload: { id: string; acceptUnverified?: boolean }) => {
    const server = getHostedServer(payload.id)

    if (!server.onlineMode && !payload.acceptUnverified) {
      throw new LauncherError('INVALID_INPUT', 'refusing to expose an unverified server', {
        title: 'This server does not check who joins',
        message:
          `"${server.name}" has "Verify players with Mojang" switched off, which is what lets an AI companion ` +
          'join without its own Minecraft account. Opening it to the internet as well means anyone who finds ' +
          'the address can join under any name they like — including yours, or an operator\'s.',
        actions: [
          'Turn "Verify players with Mojang" back on, and forward the port',
          'Or keep it off and play over your local network only',
          'The launcher will still do it if you confirm you understand'
        ]
      })
    }

    const gateway = await discoverGateway()
    if (!gateway) {
      throw new LauncherError('NETWORK_ERROR', 'no UPnP gateway on this network', {
        title: 'No router offered to forward the port',
        message:
          'Nothing on this network answered a UPnP search. Routers often ship with it switched off.',
        actions: [
          'Turn on UPnP in the router settings and try again',
          `Or forward TCP port ${server.port} to this machine by hand`
        ]
      })
    }

    const [host] = connectAddress(server).split(':')
    const label = `NexusCraft — ${server.name}`
    await openPort(gateway, server.port, host, label)
    log.info(`opened port ${server.port} for "${server.name}" via ${gateway.description}`)

    // The mapping is asked for with a twelve-hour lease rather than a permanent
    // one, so it has to be renewed or an overnight server quietly goes dark.
    keepPortOpen(server.port, host, label)

    return await forwardingStatus(server.port, host)
  })

  handle('host:closePort', async (payload: { id: string }) => {
    const server = getHostedServer(payload.id)
    stopKeepingPortOpen(server.port)

    const gateway = await discoverGateway()
    if (!gateway) return { closed: false }

    const closed = await closePort(gateway, server.port)
    if (closed) log.info(`closed port ${server.port} for "${server.name}"`)
    return { closed }
  })

  handle('curseforge:status', () => ({ configured: curseForgeConfigured() }))

  /*
   * Whether a key actually works, asked of CurseForge itself. Saving one used
   * to report success regardless, so a key that was never going to work looked
   * accepted until a search failed much later for reasons the settings screen
   * had not mentioned.
   */
  handle('curseforge:verify', async (payload: { key?: string } | undefined) =>
    await verifyCurseForgeKey(payload?.key)
  )

  /* --------------------------------------------------------- data packs */

  handle('datapacks:list', () => listDataPacks())

  handle(
    'datapacks:preview',
    async (payload: { instanceId: string; packId: string; options: DataPackOptionValues }) => {
      const built = await buildDataPack(getInstance(payload.instanceId), payload.packId, payload.options)
      // The generated files are returned verbatim so the user can read exactly
      // what will be written before installing it.
      return {
        fileName: built.fileName,
        packFormat: built.packFormat,
        formatSource: built.formatSource,
        files: built.files
      }
    }
  )

  handle(
    'datapacks:install',
    async (payload: { instanceId: string; worldFolder: string; packId: string; options: DataPackOptionValues }) => {
      const instance = getInstance(payload.instanceId)
      const result = await installDataPack(instance, payload.worldFolder, payload.packId, payload.options)
      toast(
        'success',
        'Data pack installed',
        `${result.fileName} added to ${result.world}. Reload or reopen the world to activate it.`
      )
      return result
    }
  )

  handle('datapacks:installed', async (payload: { instanceId: string; worldFolder: string }) =>
    await listInstalledDataPacks(getInstance(payload.instanceId), payload.worldFolder)
  )

  handle('datapacks:remove', async (payload: { instanceId: string; worldFolder: string; fileName: string }) => {
    await removeDataPack(getInstance(payload.instanceId), payload.worldFolder, payload.fileName)
    return true
  })

  handle(
    'datapacks:export',
    async (payload: {
      instanceId: string
      packId: string
      options: DataPackOptionValues
      outputPath: string
    }) => {
      const result = await exportDataPack(
        getInstance(payload.instanceId),
        payload.packId,
        payload.options,
        payload.outputPath
      )
      toast('success', 'Data pack exported', payload.outputPath)
      return result
    }
  )

  handle(
    'curseforge:search',
    async (payload: {
      query: string
      kind: ContentKindId
      gameVersion?: string | null
      loader?: string | null
      offset?: number
      limit?: number
      instanceId?: string | null
    }) =>
      await searchCurseForge({
        query: payload.query,
        kind: payload.kind,
        gameVersion: payload.gameVersion,
        loader: payload.loader,
        offset: payload.offset,
        limit: payload.limit,
        instance: payload.instanceId ? findInstance(payload.instanceId) : null
      })
  )

  handle(
    'curseforge:files',
    async (payload: { projectId: string; kind: ContentKindId; gameVersion?: string | null; loader?: string | null }) =>
      await listCurseForgeFiles(payload.projectId, payload.kind, payload.gameVersion, payload.loader)
  )

  handle(
    'curseforge:install',
    async (payload: { instanceId: string; projectId: string; fileId: string; kind: ContentKindId }) => {
      const instance = getInstance(payload.instanceId)
      const result = await installCurseForgeFile(instance, payload.projectId, payload.fileId, payload.kind)
      if (result.installed.length > 0) {
        toast('success', `Added to ${instance.name}`, result.installed.join(', '))
      } else if (result.skipped.length > 0) {
        toast('info', 'Already installed', result.skipped.join(', '))
      }
      return result
    }
  )

  handle(
    'modpack:serverFromFile',
    async (payload: { filePath: string; name?: string; port?: number; memoryMb?: number }) => {
      const result = await installModpackAsServerFromFile(payload.filePath, {
        name: payload.name,
        port: payload.port,
        memoryMb: payload.memoryMb
      })
      reportModpackServer(result)
      return result
    }
  )

  handle(
    'modpack:serverFromModrinth',
    async (payload: { versionId: string; name?: string; port?: number; memoryMb?: number }) => {
      const result = await installModpackAsServerFromModrinth(payload.versionId, {
        name: payload.name,
        port: payload.port,
        memoryMb: payload.memoryMb
      })
      reportModpackServer(result)
      return result
    }
  )

  handle(
    'modpack:serverFromCurseForge',
    async (payload: { projectId: string; fileId: string; name?: string; port?: number; memoryMb?: number }) => {
      const result = await installModpackAsServerFromCurseForge(payload.projectId, payload.fileId, {
        name: payload.name,
        port: payload.port,
        memoryMb: payload.memoryMb
      })
      reportModpackServer(result)
      return result
    }
  )

  handle('modpack:installCurseForge', async (payload: { projectId: string; fileId: string; name?: string }) => {
    const result = await installCurseForgeModpack(payload.projectId, payload.fileId, payload.name)
    reportModpack(result)
    return result
  })

  /* ------------------------------------------------------------- worlds */

  handle('worlds:list', async (payload: { instanceId: string }) => await listWorlds(getInstance(payload.instanceId)))

  handle('worlds:openFolder', async (payload: { instanceId: string; folderName?: string }) => {
    const instance = getInstance(payload.instanceId)
    const root = savesDir(instance)
    const target = payload.folderName ? join(root, payload.folderName) : root
    if (!existsSync(target)) throw new LauncherError('NOT_FOUND', 'that folder does not exist')
    const error = await shell.openPath(target)
    if (error) throw new LauncherError('UNKNOWN', error)
    return true
  })

  handle('worlds:backup', async (payload: { instanceId: string; folderName: string }) => {
    const instance = getInstance(payload.instanceId)
    if (isRunning(payload.instanceId)) {
      throw new LauncherError('ALREADY_RUNNING', 'cannot back up while the game is running', {
        title: 'Close Minecraft first',
        message: 'Backing up a world while the game has it open can capture a half-written save.',
        actions: ['Quit Minecraft, then back up the world']
      })
    }
    const backup = await backupWorld(instance, payload.folderName)
    toast('success', 'Backup created', backup.fileName)
    return backup
  })

  /** A top-down map of a world, read from its region files. */
  handle('worlds:map', async (payload: { instanceId: string; folderName: string }) => {
    const map = await worldMap(getInstance(payload.instanceId), payload.folderName)
    if (!map) {
      throw new LauncherError('NOT_FOUND', 'no region data', {
        title: 'Nothing to map yet',
        message: 'This world has no generated region files — play in it a little first.',
        actions: []
      })
    }
    return map
  })

  handle('worlds:listBackups', async (payload: { instanceId: string }) =>
    await listBackups(getInstance(payload.instanceId))
  )

  handle('worlds:deleteBackup', async (payload: { instanceId: string; fileName: string }) => {
    await deleteBackup(getInstance(payload.instanceId), payload.fileName)
    return true
  })

  handle('worlds:restore', async (payload: { instanceId: string; fileName: string }) => {
    if (isRunning(payload.instanceId)) {
      throw new LauncherError('ALREADY_RUNNING', 'cannot restore while the game is running', {
        title: 'Close Minecraft first',
        message: 'Replacing a world Minecraft has open would corrupt the save it writes on exit.',
        actions: ['Quit Minecraft, then restore the backup']
      })
    }
    const world = await restoreBackup(getInstance(payload.instanceId), payload.fileName)
    toast('success', `${world.name} restored`, 'The world it replaced was backed up first.')
    return world
  })

  handle('worlds:import', async (payload: { instanceId: string; filePath: string }) => {
    const world = await importWorldArchive(getInstance(payload.instanceId), payload.filePath)
    toast('success', `${world.name} imported`, 'It is in your world list, ready to play.')
    return world
  })

  handle('worlds:delete', async (payload: { instanceId: string; folderName: string }) => {
    if (isRunning(payload.instanceId)) {
      throw new LauncherError('ALREADY_RUNNING', 'cannot delete a world while the game is running')
    }
    const backup = await deleteWorld(getInstance(payload.instanceId), payload.folderName)
    toast('info', 'World deleted', `A backup was kept: ${backup.fileName}`)
    return backup
  })

  /* -------------------------------------------------- public directory */

  /*
   * The Discover screen. Note what is and is not served here: the catalogue is
   * a list of entries, and every live figure beside one comes from an actual
   * ping. Nothing is reported online that did not answer.
   */
  handle('directory:list', async () => {
    let source: 'bundled' | 'remote' = 'bundled'
    try {
      source = (await loadRemoteCatalogue()).source
    } catch (err) {
      // A broken custom feed must not empty the screen — fall back and say so.
      log.warn(`custom server directory failed, using the built-in list: ${(err as Error).message}`)
      toast('warning', 'Could not load your server list', 'Showing the built-in list instead.')
    }
    return {
      servers: directoryCatalogue(),
      categories: directoryCategories(),
      statuses: cachedDirectoryStatuses(),
      source
    }
  })

  handle('directory:refresh', async (payload: { force?: boolean } | undefined) =>
    await refreshDirectory(payload?.force ?? false)
  )

  handle('directory:ping', async (payload: { id: string }) => await pingDirectoryServer(payload.id))

  handle('directory:lookup', async (payload: { address: string }) => await lookupAddress(payload.address))

  /** Copies a directory entry into the user's own saved server list. */
  handle('directory:add', (payload: { name: string; address: string; port: number }) => {
    const existing = listServers().find(
      (server) => server.address.toLowerCase() === payload.address.toLowerCase() && server.port === payload.port
    )
    if (existing) {
      toast('info', 'Already saved', `${existing.name} is already in your servers.`)
      return existing
    }
    const saved = saveServer({
      id: null,
      name: payload.name,
      address: payload.address,
      port: payload.port
    })
    toast('success', `${saved.name} saved`, 'Find it on the Servers screen.')
    return saved
  })

  /**
   * Whether each already-pinged server can be joined, keyed by its id.
   *
   * Worked out from the statuses the live ping already produced rather than by
   * pinging again — the whole point is that the Discover list can show this on
   * every card at once without another round of network traffic.
   */
  handle('directory:compatibility', () => {
    const instances = listInstances()
    const result: Record<string, DirectoryCompatibility> = {}

    for (const status of cachedDirectoryStatuses()) {
      if (status.online !== true) continue

      const { candidates, serverVersions } = rankInstancesForServer(status, instances)
      result[status.serverId] = {
        ok: candidates.length > 0,
        instanceName: candidates[0]?.instance.name ?? null,
        serverVersions: serverVersions.slice(0, 6),
        reason:
          candidates.length > 0
            ? null
            : serverVersions.length === 0
              ? 'it did not say which version it runs'
              : `needs ${serverVersions[0]}`
      }
    }

    return result
  })

  /** Which instances could join a given server, best first. */
  handle('directory:joinTargets', async (payload: { address: string; port: number }) => {
    const status = await lookupAddress(`${payload.address}:${payload.port}`).then(
      (found) => found.status,
      () => null
    )
    const { candidates, serverVersions } = rankInstancesForServer(status, listInstances())
    return {
      serverVersions,
      protocol: status?.protocol ?? null,
      versionName: status?.versionName ?? null,
      candidates: candidates.map((c) => ({ instance: c.instance, reason: c.reason }))
    }
  })

  /**
   * Joins a public server.
   *
   * The version the server speaks decides which instance launches. An earlier
   * version of this took whichever instance happened to be selected, which
   * meant every server in the Discover list opened the same modpack — and a
   * client on the wrong version fails with "Outdated server" or a registry
   * mismatch that names no cause. An explicit choice from the user is still
   * honoured as-is; only the automatic pick is version-matched.
   */
  handle('directory:join', async (payload: { address: string; port: number; instanceId?: string }) => {
    const instances = listInstances()
    if (instances.length === 0) {
      throw new LauncherError('NOT_FOUND', 'no instances exist', {
        title: 'There is no instance to join with',
        message: 'Joining a server means launching Minecraft, and no instance has been created yet.',
        actions: ['Open the Instances screen and create one', 'Then come back and press Join']
      })
    }

    const address = `${payload.address}:${payload.port}`

    // An instance the user named is used as given — they may know something
    // about the server that a ping does not say.
    if (payload.instanceId) {
      const chosen = instances.find((i) => i.id === payload.instanceId)
      if (!chosen) throw new LauncherError('NOT_FOUND', 'that instance no longer exists')
      return await launchInstance({ instanceId: chosen.id, serverAddress: address })
    }

    // Otherwise ask the server what it speaks and match against it.
    const status = await lookupAddress(address).then(
      (found) => found.status,
      () => null
    )

    if (status?.online !== true) {
      throw new LauncherError('NETWORK_ERROR', 'the server did not answer a ping', {
        title: 'That server is not answering',
        message:
          status?.error ??
          'The launcher could not reach it just now, so it cannot tell which version to join with.',
        actions: ['Press Refresh and try again', 'Check the address is still right']
      })
    }

    const { candidates, serverVersions } = rankInstancesForServer(status, instances)

    if (candidates.length === 0) {
      const have = [...new Set(instances.map((i) => i.minecraftVersion))].sort().join(', ')

      /*
       * Two different failures, and they need different words.
       *
       * Either the server named a version and nothing here matches it, or it
       * would not say what it speaks at all — which is what a proxy does when
       * asked with the conventional "any version" handshake. Printing its
       * self-description as though it were a Minecraft version produced
       * "Nothing installed can join a Velocity 1.7.2-26.2 server", which names
       * a proxy rather than a version and tells the reader nothing.
       */
      if (serverVersions.length === 0) {
        throw new LauncherError('INVALID_INPUT', 'the server did not report a usable version', {
          title: `${payload.address} did not say which version it runs`,
          message:
            (status.versionName ? `It answered "${status.versionName}", which names its software rather than a ` +
              'Minecraft version. ' : '') +
            'Without a version the launcher cannot tell which of your instances would work, and guessing wrong ' +
            'fails during connection with an error that does not explain itself.',
          actions: [
            'Pick an instance yourself with the "Join with" selector, then press Join',
            'Most large servers accept a wide range of versions, so your newest instance is a good first try'
          ]
        })
      }

      const wanted = serverVersions[0]
      throw new LauncherError('INVALID_INPUT', `no instance matches protocol ${status.protocol ?? '?'}`, {
        title: `Nothing installed can join a ${wanted} server`,
        message:
          `${payload.address} is running Minecraft ${wanted}` +
          (status.versionName ? ` (it calls itself "${status.versionName}")` : '') +
          `, and the instances on this machine are ${have || 'none'}. Joining with the wrong version fails ` +
          'during connection with an error that does not say why, so the launcher stopped here instead.',
        actions: [
          `Create an instance on ${wanted} and press Join again`,
          'Or pick an instance yourself with the selector next to Join'
        ]
      })
    }

    const best = candidates[0]
    log.info(
      `joining ${payload.address} (${serverVersions[0] ?? 'unknown'}) with "${best.instance.name}" — ${best.reason}`
    )

    return await launchInstance({ instanceId: best.instance.id, serverAddress: address })
  })

  /* ------------------------------------------------------------ servers */

  handle('servers:list', () => ({ servers: listServers(), statuses: cachedStatuses() }))
  handle('servers:save', (payload: Parameters<typeof saveServer>[0]) => saveServer(payload))
  handle('servers:delete', (payload: { id: string }) => {
    deleteServer(payload.id)
    return true
  })
  handle('servers:favorite', (payload: { id: string; favorite: boolean }) => setFavorite(payload.id, payload.favorite))
  handle('servers:ping', async (payload: { id: string }) => await checkServer(payload.id))
  handle('servers:pingAll', async () => await checkAllServers())
  handle('servers:import', async (payload: { instanceId: string }) => {
    const count = await importFromInstance(getInstance(payload.instanceId))
    if (count > 0) toast('success', 'Servers imported', `${count} server${count === 1 ? '' : 's'} added.`)
    else toast('info', 'Nothing new to import', 'Every server in that instance is already saved.')
    return { imported: count }
  })

  /* -------------------------------------------------------------- skins */

  handle('skins:list', () => listSkins())
  handle('skins:import', async (payload: { filePath: string; name: string; variant: 'classic' | 'slim' }) =>
    await importSkin(payload.filePath, payload.name, payload.variant)
  )
  handle('skins:delete', async (payload: { id: string }) => {
    await deleteSkin(payload.id)
    return true
  })
  handle('skins:favorite', (payload: { id: string; favorite: boolean }) => favoriteSkin(payload.id, payload.favorite))

  handle('skins:apply', async (payload: { id: string }) => {
    const account = getActiveAccount()
    if (!account) throw new LauncherError('TOKEN_EXPIRED', 'no active account')
    await applySkin(account, payload.id)
    // Pull the profile again so the UI shows the skin Mojang now reports.
    const updated = await refreshAccount(account.id)
    toast('success', 'Skin applied', 'Your new skin is live on your Minecraft profile.')
    return updated
  })

  handle('skins:resetToCurrent', async () => {
    const account = getActiveAccount()
    if (!account) throw new LauncherError('TOKEN_EXPIRED', 'no active account')
    await resetSkin(account)
    const updated = await refreshAccount(account.id)
    toast('success', 'Skin reset', 'Your profile is back to the default skin.')
    return updated
  })

  /* ---------------------------------------------------------- companion */

  handle('companion:toolSizes', () => toolSetSizes())

  handle('companion:setMicrophone', (payload: { wanted: boolean }) => {
    setMicrophoneWanted(payload.wanted)
    return { wanted: payload.wanted }
  })

  handle('companion:list', () => listCompanions())
  handle('companion:states', () => allCompanionStates())
  handle('companion:create', (payload: { name?: string }) => createCompanion(payload.name))

  handle('companion:delete', (payload: { id: string }) => {
    deleteCompanion(payload.id)
    toast('info', 'Companion removed')
    return true
  })

  handle('companion:settings', (payload: { id: string }) => getCompanion(payload.id))

  handle('companion:updateSettings', (payload: { id: string; patch: Record<string, unknown> }) =>
    updateCompanion(payload.id, payload.patch as never)
  )

  /*
   * The scripted workers on offer. Listed from the routines themselves so the
   * interface never drifts out of step with what actually exists.
   */
  handle('companion:routines', () =>
    ROUTINES.map((routine) => ({
      id: routine.id,
      label: routine.label,
      description: routine.description,
      needs: routine.needs
    }))
  )

  handle('companion:start', (payload: { id: string }) => startCompanion(payload.id))
  handle('companion:stop', (payload: { id: string }) => stopCompanion(payload.id))
  handle('companion:state', (payload: { id: string }) => getCompanionState(payload.id))

  handle('companion:instruct', (payload: { id: string; text: string }) => {
    instructCompanion(payload.id, payload.text)
    return true
  })

  handle('companion:camera', (payload: { id: string; on: boolean }) => {
    setCameraEnabled(payload.id, payload.on)
    return true
  })

  /** The structures on offer: bundled ones, plus anything imported this session. */
  handle('companion:interrupt', (payload: { id: string }) => {
    interruptCompanion(payload.id)
    return true
  })

  /** What each companion has spent on model calls. */
  handle('companion:usage', () => companionUsage())

  handle('companion:resetUsage', (payload: { id?: string } | undefined) => {
    resetUsage(payload?.id)
    return true
  })

  /** Builds that can still be taken back out. */
  handle('companion:builds', () => listBuilds())

  handle('companion:undoBuild', (payload: { buildId: string; companionId?: string }) => {
    undoCompanionBuild(payload.buildId, payload.companionId)
    toast('info', 'Undoing the build', 'The companion is removing what it placed.')
    return true
  })

  handle('companion:blueprints', () => {
    const bundled = BLUEPRINT_LIBRARY.map((entry) => {
      const size = blueprintSize(entry.blueprint)
      const bill = [...billOfMaterials(entry.blueprint)].sort((a, b) => b[1] - a[1])
      return {
        id: entry.id,
        name: entry.blueprint.name,
        blurb: entry.blurb,
        width: size.width,
        height: size.height,
        depth: size.depth,
        blocks: bill.reduce((total, [, count]) => total + count, 0),
        materials: bill.slice(0, 12).map(([block, count]) => ({ block, count }))
      }
    })
    return [...bundled, ...listImports()]
  })

  /**
   * Reads a WorldEdit-style schematic off disk.
   *
   * The file is parsed and summarised here rather than handed to the bot,
   * because a player wants to see what a downloaded structure is — how big,
   * what it costs, what was lost on the way in — before a companion starts
   * placing several thousand blocks in their world.
   */
  handle('companion:importSchematic', async (payload: { filePath: string }) => {
    const name = payload.filePath.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') ?? 'Imported structure'
    const loaded = await loadSchematic(payload.filePath, name)

    const id = `import:${randomUUID()}`
    const summary = {
      id,
      name: loaded.info.name,
      blurb: `Imported — ${loaded.info.width}x${loaded.info.height}x${loaded.info.length}, ${loaded.info.blockCount} blocks`,
      width: loaded.info.width,
      height: loaded.info.height,
      depth: loaded.info.length,
      blocks: loaded.info.blockCount,
      materials: loaded.info.materials.slice(0, 12),
      imported: true,
      notes: loaded.info.notes
    }
    rememberImport(id, loaded.blueprint, summary)

    toast('success', `${summary.name} imported`, `${summary.blocks} blocks. Pick a companion and press Build.`)
    return summary
  })

  /** Tells a running companion to build one of them. */
  handle('companion:build', (payload: { id: string; blueprintId: string }) => {
    const imported = getImport(payload.blueprintId)
    if (imported) {
      buildWithCompanion(payload.id, imported.blueprint, imported.summary.name)
      return true
    }

    const entry = findLibraryBlueprint(payload.blueprintId)
    if (!entry) throw new LauncherError('NOT_FOUND', `no blueprint called ${payload.blueprintId}`)

    buildWithCompanion(payload.id, entry.blueprint, entry.blueprint.name)
    return true
  })

  /**
   * Writes a blueprint into an instance's `schematics/` folder.
   *
   * That is where Litematica's browser looks, so the file is already listed
   * when the game opens — the copying-files-around step is the one that makes
   * this feel like homework rather than a feature.
   */
  handle(
    'blueprints:export',
    async (payload: {
      blueprintId: string
      instanceId?: string
      serverId?: string
      format: 'schem' | 'nbt'
    }) => {
      const imported = getImport(payload.blueprintId)
      const entry = imported ? null : findLibraryBlueprint(payload.blueprintId)
      if (!imported && !entry) {
        throw new LauncherError('NOT_FOUND', `no blueprint called ${payload.blueprintId}`)
      }

      const blueprint = (imported?.blueprint ?? entry?.blueprint) as Parameters<typeof exportBlueprint>[0]
      const name = imported?.summary.name ?? entry?.blueprint.name ?? 'structure'
      const fileName = `${safeFileName(name)}.${payload.format}`

      /*
       * A hosted server: the file goes into that server's own world, because
       * that is where a structure block on it reads from. Writing into the
       * client instance instead leaves the block reporting an unknown name.
       */
      if (payload.serverId) {
        const server = getHostedServer(payload.serverId)
        const root = hostedServerDir(payload.serverId)
        const world = await serverWorldName(root)
        const target = join(structuresDir(join(root, world)), fileName)
        // Stamped with the server's own version, not a hardcoded one.
        const written = await exportBlueprint(blueprint, target, payload.format, server.minecraftVersion)

        toast(
          'success',
          `${name} sent to ${server.name}`,
          payload.format === 'nbt'
            ? `Place a structure block, set it to Load, and enter "${safeFileName(name).toLowerCase()}".`
            : 'Saved into the server world. Note that a structure block only reads .nbt.'
        )
        return written
      }

      if (!payload.instanceId) throw new LauncherError('INVALID_INPUT', 'no export target given')

      const instance = getInstance(payload.instanceId)
      await ensureInstanceLayout(instance)
      const target = join(schematicsDir(instance.gameDir), fileName)
      const written = await exportBlueprint(blueprint, target, payload.format, instance.minecraftVersion)

      toast(
        'success',
        `${name} exported`,
        payload.format === 'schem'
          ? `In game press M, load it, then Execute Operation → Paste Schematic in World. Loading alone only shows a hologram — it places no blocks.`
          : `Saved to the instance's schematics folder. For a structure block, export to a server instead.`
      )
      return written
    }
  )

  /**
   * Installs Litematica and its library into an instance.
   *
   * The launcher cannot draw a ghost projection inside Minecraft — that needs
   * code in the game's own renderer — so it does the next best thing and sets
   * up the mod that can, matched to the instance's version and loader.
   */
  handle('blueprints:setupLitematica', async (payload: { instanceId: string }) => {
    const instance = getInstance(payload.instanceId)

    if (instance.loader === 'vanilla') {
      throw new LauncherError('INVALID_INPUT', 'litematica needs a mod loader', {
        title: 'That instance has no mod loader',
        message:
          `Litematica is a client mod, so it needs Fabric, Forge or NeoForge. "${instance.name}" is vanilla.`,
        actions: ['Make a Fabric instance on the same Minecraft version', 'Then set Litematica up on that one']
      })
    }

    const installed: string[] = []
    const missing: string[] = []

    // MaLiLib first: Litematica does not load without it.
    for (const [label, projectId] of [
      ['MaLiLib', 'GcWjdA9I'],
      ['Litematica', 'bEpr0Arc']
    ] as const) {
      const versions = await listVersions(projectId, 'mod', instance.minecraftVersion, instance.loader)
      if (versions.length === 0) {
        missing.push(label)
        continue
      }
      await installVersionToInstance(instance, versions[0].versionId, 'mod')
      installed.push(`${label} ${versions[0].versionNumber}`)
    }

    if (missing.length > 0 && installed.length === 0) {
      /*
       * Distinguish "not out yet" from "never coming".
       *
       * Asking again without the loader filter separates the two cases, and
       * they need opposite advice. Litematica dropped Forge after 1.16.5 and is
       * Fabric-only on anything modern, so telling a Forge user to wait a few
       * weeks — which an earlier version of this message did — sends them off
       * to check for a build that is never going to appear.
       */
      const anyLoader = await listVersions('bEpr0Arc', 'mod', instance.minecraftVersion, null).catch(() => [])
      const loadersAvailable = [...new Set(anyLoader.flatMap((version) => version.loaders))]

      if (loadersAvailable.length > 0) {
        throw new LauncherError('NOT_FOUND', `litematica has no ${instance.loader} build`, {
          title: `Litematica does not support ${instance.loader} on ${instance.minecraftVersion}`,
          message:
            `There are builds for ${instance.minecraftVersion}, but only for ${loadersAvailable.join(' and ')} — ` +
            `"${instance.name}" is ${instance.loader}. Litematica stopped shipping Forge builds after 1.16.5, and ` +
            'no equivalent projection mod exists for modern Forge.',
          actions: [
            'Export the blueprint as .nbt instead and place it with a structure block — that needs no mods at all',
            'Or have a companion build it, which works on any loader',
            `Litematica would work on a ${loadersAvailable[0]} instance, but a ${loadersAvailable[0]} client cannot join a ${instance.loader} server`
          ]
        })
      }

      throw new LauncherError('NOT_FOUND', 'no litematica build for this version', {
        title: `No Litematica build for Minecraft ${instance.minecraftVersion}`,
        message:
          `${missing.join(' and ')} ${missing.length === 1 ? 'has' : 'have'} no release for this Minecraft version yet. ` +
          'Litematica usually follows a new Minecraft release by a few weeks.',
        actions: [
          'Export as .nbt and use a structure block in the meantime',
          'Or have a companion build it instead'
        ]
      })
    }

    toast(
      'success',
      `Litematica set up on ${instance.name}`,
      `${installed.join(', ')}. Launch the game and press M to open it.`
    )
    return { installed, missing }
  })

  handle('companion:clearMemory', (payload: { id: string }) => {
    clearCompanionMemory(payload.id)
    toast('info', 'Companion memory cleared')
    return true
  })

  handle('companion:listModels', async (payload: { id: string }) => {
    const settings = getCompanion(payload.id)
    const apiKey = getSecret(`companion-llm-key-${payload.id}`) ?? ''
    try {
      return await listModels({ baseUrl: settings.baseUrl, apiKey, model: settings.model, timeoutMs: 20_000 })
    } catch (err) {
      llmFailure(err)
    }
  })

  handle('companion:testModel', async (payload: { id: string }) => {
    // A single cheap round trip, so configuration problems surface here rather
    // than halfway through a Minecraft session.
    const settings = getCompanion(payload.id)
    const apiKey = getSecret(`companion-llm-key-${payload.id}`) ?? ''
    const started = Date.now()

    let reply
    try {
      reply = await llmChat(
        { baseUrl: settings.baseUrl, apiKey, model: settings.model, timeoutMs: 30_000 },
        [
          { role: 'system', content: 'Reply with exactly the word: ready' },
          { role: 'user', content: 'Are you there?' }
        ],
        []
      )
    } catch (err) {
      llmFailure(err)
    }

    return {
      ok: true,
      ms: Date.now() - started,
      model: settings.model,
      reply: (reply.content ?? '').trim().slice(0, 120)
    }
  })

  /* -------------------------------------------------------------- crews */

  handle('crew:list', () => listCrews())

  handle('crew:create', (payload: { name: string; foremanId: string; memberIds: string[] }) => {
    const crew = createCrew(payload.name, payload.foremanId, payload.memberIds)
    toast('success', `Crew "${crew.name}" formed`, `${crew.memberIds.length + 1} companions, one in charge.`)
    return crew
  })

  handle('crew:update', (payload: { id: string; patch: { name?: string; memberIds?: string[] } }) =>
    updateCrew(payload.id, payload.patch)
  )

  handle('crew:delete', (payload: { id: string }) => {
    deleteCrew(payload.id)
    toast('info', 'Crew disbanded', 'The companions themselves are untouched.')
    return true
  })

  handle('crew:start', (payload: { id: string }) => {
    const result = startCrew(payload.id)
    if (result.started.length > 0) {
      toast('success', `${result.started.length} joining`, result.started.join(', '))
    }
    for (const failure of result.failed) {
      toast('warning', `${failure.username} could not start`, failure.reason)
    }
    return result
  })

  handle('crew:stop', (payload: { id: string }) => {
    const stopped = stopCrew(payload.id)
    if (stopped.length > 0) toast('info', `${stopped.length} leaving`, stopped.join(', '))
    return stopped
  })

  handle('crew:notes', (payload: { id: string }) => crewNotes(payload.id))

  handle('crew:clearNotes', (payload: { id: string }) => {
    clearCrewNotes(payload.id)
    return true
  })

  /* ------------------------------------------------------- hosted servers */

  handle('host:list', () => listHostedServers())
  handle('host:states', () => allHostedServerStates())
  handle('host:eulaUrl', () => MINECRAFT_EULA_URL)
  handle('host:software', () => listServerSoftware())

  handle('host:mods', (payload: { id: string }) => listServerMods(payload.id))

  handle('host:importMods', async (payload: { id: string }) => {
    const picked = await dialog.showOpenDialog({
      title: 'Add to the server',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Mod or plugin jars', extensions: ['jar'] }]
    })
    if (picked.canceled || picked.filePaths.length === 0) return 0
    const added = await importServerMods(payload.id, picked.filePaths)
    if (added > 0) toast('success', `Added ${added} file${added === 1 ? '' : 's'}`, 'Restart the server to load them')
    return added
  })

  handle('host:toggleMod', async (payload: { id: string; fileName: string; enabled: boolean }) => {
    await setServerModEnabled(payload.id, payload.fileName, payload.enabled)
    return true
  })

  handle('host:deleteMod', async (payload: { id: string; fileName: string }) => {
    await deleteServerMod(payload.id, payload.fileName)
    return true
  })

  handle('host:installMod', async (payload: { id: string; versionId: string }) => {
    const result = await installServerModFromModrinth(payload.id, payload.versionId)
    toast('success', 'Installed to the server', 'Restart the server to load it')
    return result
  })

  handle('host:openFolder', (payload: { id: string }) => {
    // Opening the folder is the escape hatch for anything the UI cannot do.
    void shell.openPath(hostedServerDir(payload.id))
    return true
  })

  handle('host:syncMods', async (payload: { id: string; instanceId: string }) => {
    const result = await syncServerModsToInstance(payload.id, getInstance(payload.instanceId))
    const message =
      result.copied.length === 0
        ? `${result.instanceName} already had every mod`
        : `Copied ${result.copied.length} mod${result.copied.length === 1 ? '' : 's'} to ${result.instanceName}`
    toast('success', message)
    return result
  })

  handle('host:joinTargets', (payload: { id: string }) =>
    instancesThatCanJoin(getHostedServer(payload.id), listInstances())
  )

  /* ------------------------------------------------- hosted server backups */

  handle('host:backups', async (payload: { id: string }) => await listServerBackups(payload.id))

  handle('host:backup', async (payload: { id: string }) => {
    const info = await backupHostedServer(payload.id)
    toast('success', 'Snapshot taken', `${info.fileName} — ${(info.sizeBytes / 1024 / 1024).toFixed(1)} MB.`)
    return info
  })

  handle('host:restoreBackup', async (payload: { id: string; fileName: string }) => {
    await restoreServerBackup(payload.id, payload.fileName)
    toast('success', 'World restored', 'The world it replaced was snapshotted first. Start the server to play it.')
    return true
  })

  handle('host:deleteBackup', async (payload: { id: string; fileName: string }) => {
    await deleteServerBackup(payload.id, payload.fileName)
    return true
  })

  handle('host:restartSettings', (payload: { id: string }) => ({
    ...serverRestartSettings(payload.id),
    nextAt: nextRestartAt(payload.id)
  }))

  handle(
    'host:setRestartSettings',
    (payload: { id: string; patch: Partial<ReturnType<typeof serverRestartSettings>> }) => ({
      ...setServerRestartSettings(payload.id, payload.patch),
      nextAt: nextRestartAt(payload.id)
    })
  )

  handle('host:backupSettings', (payload: { id: string }) => serverBackupSettings(payload.id))

  /**
   * The invite a host sends a friend.
   *
   * Prefers the public address when the port is open — an invite that only
   * works inside the house is not much of an invite — and says so either way,
   * so the host can see which one they are about to send.
   */
  handle('host:inviteLink', async (payload: { id: string }) => {
    const server = getHostedServer(payload.id)
    const share = await shareDetails(payload.id)
    const address = share.publicAddress ?? share.localAddress
    const [host, portText] = address.split(':')

    const loader =
      server.software === 'fabric' || server.software === 'forge' || server.software === 'neoforge'
        ? server.software
        : 'vanilla'

    return {
      link: buildJoinLink({
        host,
        port: Number(portText) || server.port,
        name: server.name,
        minecraftVersion: server.minecraftVersion,
        loader
      }),
      address,
      isPublic: Boolean(share.publicAddress),
      note: share.publicAddress
        ? share.reachable === false
          ? 'The public address did not answer from this machine, which is normal from inside your own network. Ask your friend to try it.'
          : null
        : 'This link only works for people on your network. Use "Play with friends online" to open the port first.'
    }
  })

  /* --------------------------------------------------------- relay tunnel */

  handle('host:tunnelSettings', (payload: { id: string }) => tunnelSettings(payload.id))

  handle('host:setTunnelSettings', (payload: { id: string; patch: Record<string, unknown> }) =>
    setTunnelSettings(payload.id, payload.patch)
  )

  handle('host:tunnelState', (payload: { id: string }) => tunnelState(payload.id))

  handle('host:startTunnel', (payload: { id: string }) => {
    const server = getHostedServer(payload.id)

    // A relay makes the server reachable by anyone who has the address, which
    // is the same danger as an open port on a server that does not check who
    // joins: anyone can arrive under any name, including an operator's.
    if (!server.onlineMode) {
      throw new LauncherError('INVALID_INPUT', 'refusing to relay an unverified server', {
        title: 'This server does not check who joins',
        message:
          `"${server.name}" has "Verify players with Mojang" switched off. Putting it behind a relay means ` +
          'anyone with the address can join under any name they like — including yours.',
        actions: [
          'Turn "Verify players with Mojang" back on before opening it up',
          'A companion needs it off, so run the companion on a server you keep to your own network'
        ]
      })
    }

    return startTunnel(payload.id, server.port)
  })

  handle('host:stopTunnel', (payload: { id: string }) => stopTunnel(payload.id))

  handle('links:pendingInvite', () => currentPendingInvite())

  handle(
    'links:acceptInvite',
    async (payload: {
      host: string
      port: number
      name?: string | null
      minecraftVersion?: string | null
      loader?: string | null
      packVersionId?: string | null
      instanceId?: string | null
    }) => {
      const result = await acceptInvite(payload)
      // Clear it so a refused-then-accepted invite cannot fire twice.
      takePendingInvite()
      return { instanceId: result.instance.id, instanceName: result.instance.name, address: result.address }
    }
  )

  handle('host:setBackupSettings', (payload: { id: string; patch: Record<string, unknown> }) =>
    setServerBackupSettings(payload.id, payload.patch)
  )

  /* -------------------------------------------------------- server steward */

  handle('host:stewards', (payload: { id: string }) => stewardsFor(payload.id))

  handle('host:deploySteward', (payload: { id: string; companionId?: string }) => {
    const result = deploySteward(payload.id, payload.companionId)
    if (result.warning) {
      toast('info', `${result.companion.username} is assigned`, result.warning)
    } else {
      toast(
        'success',
        `${result.companion.username} is on the server`,
        result.created
          ? 'Set up a model for it on the Companion screen so it can talk.'
          : 'It joins and leaves with the server from now on.'
      )
    }
    return result
  })

  handle('host:dismissSteward', (payload: { companionId: string }) => {
    const companion = dismissSteward(payload.companionId)
    toast('info', `${companion.username} left the server`, 'The companion itself is still set up.')
    return companion
  })

  /**
   * Joins a hosted server, making a client for it if there is not one already.
   *
   * Matching a client to a server by hand is the part that goes wrong: same
   * Minecraft version, same loader, and the same mods in the same builds. Get
   * the last of those wrong — a NeoForge jar where the server has the Forge one
   * — and the connection dies during setup with "failed to synchronise registry
   * data", which says nothing about which mod is at fault.
   *
   * So the launcher does it. An instance that already matches is used as it is;
   * otherwise one is made. Either way the server's own mods are copied in first,
   * which is the only way to be certain the two agree.
   */
  handle('host:join', async (payload: { id: string; instanceId?: string }) => {
    const server = getHostedServer(payload.id)

    if (!isHostedServerRunning(payload.id)) {
      throw new LauncherError('NOT_FOUND', 'that server is not running', {
        title: 'Start the server first',
        message: 'The game would have nothing to connect to.',
        actions: ['Press Start, wait for it to say ready, then Join']
      })
    }

    // Which client loader a server's software needs. Vanilla and the plugin
    // servers take an ordinary client, which is what 'vanilla' means here.
    const loader: LoaderId =
      server.software === 'fabric'
        ? 'fabric'
        : server.software === 'neoforge'
          ? 'neoforge'
          : server.software === 'forge'
            ? 'forge'
            : 'vanilla' 

    // Whatever was asked for, else anything already suitable.
    let instance = payload.instanceId
      ? getInstance(payload.instanceId)
      : listInstances().find(
          (entry) => entry.minecraftVersion === server.minecraftVersion && entry.loader === loader
        )

    if (!instance) {
      log.info(`no client for "${server.name}"; making one on ${server.minecraftVersion} ${loader}`)
      instance = await createInstance({
        name: `${server.name} (client)`,
        minecraftVersion: server.minecraftVersion,
        loader
      })
      toast('info', 'Made a client for this server', `${instance.name} — matching ${server.minecraftVersion} ${loader}.`)
    }

    /*
     * Copy the server's mods across every time, not just when the instance is
     * new. They drift: a mod added to the server after this client was made is
     * exactly the case that breaks the next join.
     */
    if (!serverUsesPlugins(server)) {
      try {
        const synced = await syncServerModsToInstance(server.id, instance)
        if (synced.copied.length > 0) {
          toast(
            'success',
            'Matched the server\'s mods',
            `Copied ${synced.copied.length} into ${instance.name}: ${synced.copied.slice(0, 3).join(', ')}${synced.copied.length > 3 ? '…' : ''}`
          )
        }
      } catch (err) {
        // Worth saying, not worth blocking a join that may work anyway.
        log.warn(`could not copy server mods into "${instance.name}": ${(err as Error).message}`)
      }
    }

    return await launchInstance({ instanceId: instance.id, serverAddress: serverAddress(server) })
  })
  handle('host:console', (payload: { id: string }) => getHostedServerConsole(payload.id))

  handle('host:save', (input: SaveHostedServerInput) => saveHostedServer(input))

  handle('host:delete', async (payload: { id: string; deleteWorld: boolean }) => {
    await deleteHostedServer(payload.id, payload.deleteWorld)
    toast('info', 'Server removed')
    return true
  })

  handle('host:install', (payload: { id: string }) => installHostedServer(payload.id))

  handle('host:acceptEula', (payload: { id: string }) => acceptEula(payload.id))

  handle('host:start', (payload: { id: string }) => startHostedServer(payload.id))

  handle('host:stop', (payload: { id: string }) => stopHostedServer(payload.id))

  handle('host:command', (payload: { id: string; command: string }) => {
    sendHostedServerCommand(payload.id, payload.command)
    return true
  })

  assertAllChannelsHandled()
  log.info(`registered IPC handlers`)
}

/**
 * Turns a model-endpoint failure into something actionable.
 *
 * Providers answer an unknown model name with their own wording, sometimes in
 * their own language — GLM says "模型不存在, 请检查模型代码" — which reached the
 * user as a raw stack trace under "An unexpected problem occurred".
 */
function llmFailure(err: unknown): never {
  if (!(err instanceof LlmError)) throw err

  const message = err.message ?? ''
  const unknownModel =
    err.status === 404 ||
    /模型不存在|model.*(not found|does not exist|not exist)|invalid model|unknown model/i.test(message)

  if (unknownModel) {
    throw new LauncherError('INVALID_INPUT', `the endpoint rejected the model name: ${message}`, {
      title: 'That model name does not exist on this endpoint',
      message:
        'The endpoint answered and your key was accepted, but it does not serve a model by that name. Providers rename and retire models regularly.',
      actions: ['Press "Load models" next to the model box to see what this endpoint offers']
    })
  }

  // GLM answers an out-of-credit call with "余额不足或无可用资源包，请充值".
  const outOfCredit = /余额不足|资源包|请充值|insufficient balance|quota|out of credit|billing/i.test(message)

  if (outOfCredit) {
    throw new LauncherError('INVALID_INPUT', `the endpoint reported no available credit: ${message}`, {
      title: 'That account has no credit for this call',
      message:
        'The endpoint accepted your key but reported an empty balance or no usable plan. A GLM Coding Plan only covers a call when the endpoint and the model both qualify — otherwise the call bills your wallet instead, which is what this message means.',
      actions: [
        'For a Coding Plan, choose the "GLM Coding Plan" provider in Setup',
        'That plan covers only GLM-4.7, GLM-5-Turbo and GLM-5.3',
        'Otherwise top up the wallet, or switch to Ollama which is free and local'
      ]
    })
  }

  if (err.status === 401 || err.status === 403) {
    throw new LauncherError('INVALID_INPUT', `the endpoint rejected the key: ${message}`, {
      title: 'The endpoint rejected your API key',
      message: 'The key was sent but refused.',
      actions: ['Check the key is for this provider', 'GLM keys differ between the Chinese and international endpoints']
    })
  }

  throw new LauncherError('UNKNOWN', message, {
    title: 'The model endpoint returned an error',
    message: message.slice(0, 200),
    actions: ['Press Test to try again', 'Check the endpoint URL in Setup']
  })
}

/**
 * Marks a saved server as joined, matching on the address the game was pointed
 * at. Silently does nothing when the address is not one of the saved servers.
 */
function noteServerJoin(address: string): void {
  const [host, port] = splitAddress(address)
  const match = listServers().find(
    (server) => server.address.toLowerCase() === host.toLowerCase() && server.port === port
  )
  if (match) recordJoin(match.id)
}
