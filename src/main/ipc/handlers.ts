import { app, BrowserWindow, dialog, shell } from 'electron'
import { totalmem, freemem } from 'node:os'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { handle, assertAllChannelsHandled } from './registry'
import { LauncherError } from '../core/errors'
import { createLogger } from '../core/logger'
import { dataRoot, logsRoot } from '../core/paths'
import { writeBootstrap } from '../core/bootstrap'
import { toast } from '../core/events'

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
  suggestedExportName
} from '../services/instances/transferService'
import { launchInstance, launchStates, recentLogs, stopInstance, isRunning } from '../services/launch/launchService'
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
  listBackups,
  listWorlds,
  savesDir
} from '../services/worlds/worldService'
import {
  checkAllServers,
  checkServer,
  deleteServer,
  getServer,
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
  syncServerModsToInstance,
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
  clearCompanionMemory
} from '../services/companion/companionService'
import { chat as llmChat, listModels, LlmError } from '../companion/llm'
import { getSecret } from '../services/auth/secureStore'
import {
  searchProjects,
  listVersions,
  installVersionToInstance,
  getProjectBody
} from '../services/content/modrinthService'
import {
  inspectModpack,
  installModpackFromFile,
  installModpackFromModrinth,
  installCurseForgeModpack
} from '../services/content/modpackService'
import {
  searchCurseForge,
  listCurseForgeFiles,
  installCurseForgeFile,
  isConfigured as curseForgeConfigured
} from '../services/content/curseforgeService'
import { checkModUpdates, applyModUpdate } from '../services/content/modrinthService'
import {
  listDataPacks,
  buildDataPack,
  installDataPack,
  listInstalledDataPacks,
  removeDataPack,
  exportDataPack
} from '../services/content/datapackService'
import type { ModUpdate, DataPackOptionValues } from '@shared/types'
import type { ContentKindId, ModpackInstallResult } from '@shared/types'
import type { SaveHostedServerInput } from '@shared/types'

/** Announces a finished modpack install, including anything it had to skip. */
function reportModpack(result: ModpackInstallResult): void {
  toast(
    'success',
    `${result.instance.name} is ready`,
    `${result.installedFiles} files and ${result.overrides} config files installed.` +
      (result.skipped.length > 0 ? ` ${result.skipped.length} were skipped as untrusted downloads.` : '')
  )
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
  'github.com'
]

/** True when `hostname` is one of the allowed domains, or a subdomain of one. */
function isAllowedExternalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  return ALLOWED_EXTERNAL_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`))
}

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
    isPackaged: app.isPackaged
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
    return { ...updateSettings(patch), dataDir: dataRoot() }
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

  handle('mods:checkUpdates', async (payload: { instanceId: string }) =>
    await checkModUpdates(getInstance(payload.instanceId))
  )

  handle('mods:applyUpdate', async (payload: { instanceId: string; update: Record<string, unknown> }) => {
    const instance = getInstance(payload.instanceId)
    // The renderer echoes back an update it was given, so re-validate the
    // fields that actually drive a download rather than trusting the shape.
    const update = payload.update as unknown as ModUpdate
    if (typeof update?.newVersionId !== 'string' || typeof update?.fileName !== 'string') {
      throw new LauncherError('INVALID_INPUT', 'malformed update payload')
    }
    await applyModUpdate(instance, update)
    toast('success', `${update.modName} updated`, `Now on ${update.newVersion}.`)
    return true
  })

  /* -------------------------------------------------------- curseforge */

  handle('curseforge:status', () => ({ configured: curseForgeConfigured() }))

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

  handle('worlds:listBackups', async (payload: { instanceId: string }) =>
    await listBackups(getInstance(payload.instanceId))
  )

  handle('worlds:deleteBackup', async (payload: { instanceId: string; fileName: string }) => {
    await deleteBackup(getInstance(payload.instanceId), payload.fileName)
    return true
  })

  handle('worlds:delete', async (payload: { instanceId: string; folderName: string }) => {
    if (isRunning(payload.instanceId)) {
      throw new LauncherError('ALREADY_RUNNING', 'cannot delete a world while the game is running')
    }
    const backup = await deleteWorld(getInstance(payload.instanceId), payload.folderName)
    toast('info', 'World deleted', `A backup was kept: ${backup.fileName}`)
    return backup
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

  handle('companion:start', (payload: { id: string }) => startCompanion(payload.id))
  handle('companion:stop', (payload: { id: string }) => stopCompanion(payload.id))
  handle('companion:state', (payload: { id: string }) => getCompanionState(payload.id))

  handle('companion:instruct', (payload: { id: string; text: string }) => {
    instructCompanion(payload.id, payload.text)
    return true
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

  handle('host:join', async (payload: { id: string; instanceId: string }) => {
    const server = getHostedServer(payload.id)
    if (!isHostedServerRunning(payload.id)) {
      throw new LauncherError('NOT_FOUND', 'that server is not running', {
        title: 'Start the server first',
        message: 'The game would have nothing to connect to.',
        actions: ['Press Start, wait for it to say ready, then Join']
      })
    }
    return await launchInstance({ instanceId: payload.instanceId, serverAddress: serverAddress(server) })
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
