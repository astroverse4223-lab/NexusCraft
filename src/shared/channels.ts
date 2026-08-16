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
