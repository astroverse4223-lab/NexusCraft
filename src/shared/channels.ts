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
  'instances:exportPack',
  'instances:snapshots',
  'instances:snapshot',
  'instances:restoreSnapshot',
  'instances:deleteSnapshot',
  'instances:diffSnapshot',

  /* launch */
  'launch:start',
  'launch:stop',
  'launch:state',
  'launch:logs',
  'launch:autopsy',
  'launch:autopsyAvailable',
  'launch:applyFix',

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
  'modpack:serverFromFile',
  'modpack:serverFromModrinth',
  'modpack:serverFromCurseForge',
  'mods:checkUpdates',
  'mods:applyUpdate',
  'mods:changelog',
  'mods:rollbacks',
  'mods:rollback',
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
  'companion:routines',
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
  'companion:blueprints',
  'companion:importSchematic',
  'companion:build',
  'blueprints:export',
  'blueprints:setupLitematica',
  'companion:clearMemory',
  'companion:camera',
  'companion:testModel',
  'companion:listModels',
  'crew:list',
  'crew:create',
  'crew:update',
  'crew:delete',
  'crew:start',
  'crew:stop',
  'crew:notes',
  'crew:clearNotes',

  /* self-hosted servers */
  'host:installModrinth',
  'host:installCurseForge',
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
  'host:deploySteward',
  'host:dismissSteward',
  'host:stewards',
  'host:backup',
  'host:backups',
  'host:restoreBackup',
  'host:deleteBackup',
  'host:backupSettings',
  'host:setBackupSettings',
  'host:inviteLink',
  'host:tunnelSettings',
  'host:setTunnelSettings',
  'host:startTunnel',
  'host:stopTunnel',
  'host:tunnelState',

  /* invite and install links */
  'links:acceptInvite',
  'links:pendingInvite',

  /* worlds */
  'worlds:list',
  'worlds:openFolder',
  'worlds:backup',
  'worlds:listBackups',
  'worlds:deleteBackup',
  'worlds:restore',
  'worlds:import',
  'worlds:delete',

  /* public server directory */
  'directory:list',
  'directory:refresh',
  'directory:ping',
  'directory:lookup',
  'directory:add',
  'directory:join',
  'directory:joinTargets',

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
  'companion:camera',
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
  'directory:status',
  'settings:changed',
  'link:invite',
  'link:install-mod',
  'tunnel:state',
  'toast'
] as const

export type EventChannel = (typeof EVENT_CHANNELS)[number]
