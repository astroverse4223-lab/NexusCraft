/**
 * The channel allowlist, deliberately free of any dependency.
 *
 * The preload script runs in a sandboxed context where `require` is limited to
 * Electron's own modules, so it cannot import anything that pulls in a library.
 * Keeping the channel names here — and the zod schemas in `ipc.ts` — lets the
 * preload import the allowlist without dragging a validation library into the
 * sandbox.
 */

export const IPC_CHANNELS = [
  /* system */
  'app:info',
  'app:openExternal',
  'app:openPath',
  'app:pickDirectory',
  'app:pickFiles',
  'app:pickSavePath',
  'app:window',
  'app:systemMemory',
  'app:reportError',

  /* settings */
  'settings:get',
  'settings:update',

  /* auth */
  'auth:begin',
  'auth:cancel',
  'auth:list',
  'auth:setActive',
  'auth:logout',
  'auth:refresh',

  /* versions */
  'versions:manifest',
  'versions:installed',
  'versions:loaderVersions',
  'versions:delete',

  /* instances */
  'instances:list',
  'instances:create',
  'instances:update',
  'instances:delete',
  'instances:duplicate',
  'instances:stats',
  'instances:openFolder',
  'instances:install',
  'instances:repair',
  'instances:export',
  'instances:inspectArchive',
  'instances:import',

  /* launch */
  'launch:start',
  'launch:stop',
  'launch:state',
  'launch:logs',

  /* downloads */
  'downloads:state',
  'downloads:pause',
  'downloads:resume',
  'downloads:cancel',
  'downloads:retry',

  /* java */
  'java:list',
  'java:test',
  'java:installRuntime',
  'java:recommend',

  /* mods */
  'mods:list',
  'mods:setEnabled',
  'mods:delete',
  'mods:import',
  'mods:openFolder',

  /* resource packs and shaders */
  'content:list',
  'content:import',
  'content:setEnabled',
  'content:delete',
  'content:openFolder',
  'content:screenshots',

  /* modrinth content browser */
  'modrinth:search',
  'modrinth:versions',
  'modrinth:install',
  'modrinth:project',
  'modpack:inspect',
  'modpack:installFile',
  'modpack:installModrinth',
  'modpack:installCurseForge',
  'mods:checkUpdates',
  'mods:applyUpdate',
  'curseforge:verify',
  'curseforge:search',
  'curseforge:files',
  'curseforge:install',
  'curseforge:status',
  'datapacks:list',
  'datapacks:preview',
  'datapacks:install',
  'datapacks:installed',
  'datapacks:remove',
  'datapacks:export',

  /* AI companion */
  'companion:list',
  'companion:create',
  'companion:delete',
  'companion:settings',
  'companion:updateSettings',
  'companion:start',
  'companion:stop',
  'companion:instruct',
  'companion:state',
  'companion:states',
  'companion:clearMemory',
  'companion:testModel',
  'companion:listModels',

  /* self-hosted servers */
  'host:share',
  'host:forwardStatus',
  'host:openPort',
  'host:closePort',
  'host:list',
  'host:save',
  'host:delete',
  'host:install',
  'host:acceptEula',
  'host:start',
  'host:stop',
  'host:command',
  'host:states',
  'host:console',
  'host:eulaUrl',
  'host:software',
  'host:mods',
  'host:importMods',
  'host:toggleMod',
  'host:deleteMod',
  'host:installMod',
  'host:joinTargets',
  'host:join',
  'host:openFolder',
  'host:syncMods',

  /* worlds */
  'worlds:list',
  'worlds:openFolder',
  'worlds:backup',
  'worlds:listBackups',
  'worlds:deleteBackup',
  'worlds:delete',

  /* servers */
  'servers:list',
  'servers:save',
  'servers:delete',
  'servers:favorite',
  'servers:ping',
  'servers:pingAll',
  'servers:import',

  /* skins */
  'skins:list',
  'skins:import',
  'skins:delete',
  'skins:favorite',
  'skins:apply',
  'skins:resetToCurrent'
] as const

export type IpcChannel = (typeof IPC_CHANNELS)[number]

export const EVENT_CHANNELS = [
  'companion:event',
  'companion:status',
  'companion:memory',
  'companion:list',
  'host:changed',
  'host:state',
  'host:console',
  'auth:progress',
  'auth:device-code',
  'auth:accounts-changed',
  'download:progress',
  'launch:state',
  'launch:log',
  'instances:changed',
  'servers:status',
  'settings:changed',
  'toast'
] as const

export type EventChannel = (typeof EVENT_CHANNELS)[number]
