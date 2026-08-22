/**
 * Request validation for the IPC surface.
 *
 * `channels.ts` owns the allowlist; this file gives every channel on it a zod
 * schema. Because the map is typed as `Record<IpcChannel, ...>`, adding a
 * channel without a schema is a compile error.
 *
 * The main process refuses to register a handler for a channel that is not in
 * this map, and refuses to run one whose payload fails validation.
 */
import { z } from 'zod'
import { IPC_CHANNELS, EVENT_CHANNELS, type IpcChannel, type EventChannel } from './channels'

export { IPC_CHANNELS, EVENT_CHANNELS }
export type { IpcChannel, EventChannel }

const id = z.string().min(1).max(128)
const path = z.string().min(1).max(4096)

/** Rejects path fragments that try to escape their parent directory. */
export const safeSegment = z
  .string()
  .min(1)
  .max(255)
  .refine((v) => !v.includes('/') && !v.includes('\\') && v !== '.' && v !== '..', {
    message: 'must be a single path segment'
  })

const loaderId = z.enum(['vanilla', 'fabric', 'forge', 'neoforge', 'quilt'])

export const IpcRequestSchemas: Record<IpcChannel, z.ZodTypeAny> = {
  /* ---------------------------------------------------------------- system */
  'app:info': z.void(),
  'app:openExternal': z.object({ url: z.string().url() }),
  'app:openPath': z.object({ path }),
  'app:pickDirectory': z.object({ title: z.string().optional() }).optional(),
  'app:pickFiles': z
    .object({
      title: z.string().optional(),
      extensions: z.array(z.string()).optional(),
      multi: z.boolean().optional()
    })
    .optional(),
  'app:pickSavePath': z.object({
    title: z.string().max(120).optional(),
    defaultName: z.string().max(255).optional(),
    extensions: z.array(z.string().max(16)).max(8).optional()
  }),
  'app:window': z.object({ action: z.enum(['minimize', 'maximize', 'close']) }),
  'app:systemMemory': z.void(),
  /** Renderer-side crash reporting, so a UI failure reaches the log file. */
  'app:reportError': z.object({
    source: z.string().max(64),
    message: z.string().max(2000),
    stack: z.string().max(8000).optional(),
    componentStack: z.string().max(8000).optional()
  }),

  /* -------------------------------------------------------------- settings */
  'settings:get': z.void(),
  'settings:update': z.record(z.string(), z.unknown()),

  /* ------------------------------------------------------------------ auth */
  'auth:begin': z.void(),
  'auth:cancel': z.void(),
  'auth:list': z.void(),
  'auth:setActive': z.object({ accountId: id }),
  'auth:logout': z.object({ accountId: id }),
  'auth:refresh': z.object({ accountId: id }),

  /* ------------------------------------------------------------- versions */
  'versions:manifest': z.object({ refresh: z.boolean().optional() }).optional(),
  'versions:installed': z.void(),
  'versions:loaderVersions': z.object({ loader: loaderId, minecraftVersion: z.string().min(1) }),
  'versions:delete': z.object({ versionId: safeSegment }),

  /* ------------------------------------------------------------ instances */
  'instances:list': z.void(),
  'instances:create': z.object({
    name: z.string().min(1).max(64),
    minecraftVersion: z.string().min(1).max(64),
    loader: loaderId,
    loaderVersion: z.string().max(64).nullable().optional(),
    maxRamMb: z.number().int().min(512).max(65536).optional(),
    iconColor: z.string().max(32).optional()
  }),
  'instances:update': z.object({ id, patch: z.record(z.string(), z.unknown()) }),
  'instances:delete': z.object({ id, deleteFiles: z.boolean() }),
  'instances:duplicate': z.object({ id, name: z.string().min(1).max(64) }),
  'instances:stats': z.object({ id }),
  'instances:openFolder': z.object({ id, sub: z.string().max(64).optional() }),
  'instances:install': z.object({ id }),
  'instances:repair': z.object({ id }),
  'instances:export': z.object({
    id,
    outputPath: path,
    includeWorlds: z.boolean(),
    includeScreenshots: z.boolean()
  }),
  'instances:inspectArchive': z.object({ filePath: path }),
  'instances:import': z.object({ filePath: path, name: z.string().max(64).optional() }),

  /* --------------------------------------------------------------- launch */
  'launch:start': z.object({ instanceId: id, serverAddress: z.string().max(255).optional() }),
  'launch:stop': z.object({ instanceId: id }),
  'launch:state': z.void(),
  'launch:logs': z.object({ instanceId: id, limit: z.number().int().min(1).max(5000).optional() }),

  /* ------------------------------------------------------------ downloads */
  'downloads:state': z.void(),
  'downloads:pause': z.object({ taskId: id }),
  'downloads:resume': z.object({ taskId: id }),
  'downloads:cancel': z.object({ taskId: id }),
  'downloads:retry': z.object({ taskId: id }),

  /* ----------------------------------------------------------------- java */
  'java:list': z.object({ refresh: z.boolean().optional() }).optional(),
  'java:test': z.object({ path }),
  'java:installRuntime': z.object({ majorVersion: z.number().int().min(8).max(64) }),
  'java:recommend': z.object({ minecraftVersion: z.string().min(1) }),

  /* ----------------------------------------------------------------- mods */
  'mods:list': z.object({ instanceId: id }),
  'mods:setEnabled': z.object({ instanceId: id, fileName: safeSegment, enabled: z.boolean() }),
  'mods:delete': z.object({ instanceId: id, fileName: safeSegment }),
  'mods:import': z.object({ instanceId: id, files: z.array(path).min(1).max(200) }),
  'mods:openFolder': z.object({ instanceId: id }),

  /* -------------------------------------------------- resource packs/shaders */
  'content:list': z.object({ instanceId: id, kind: z.enum(['resourcepacks', 'shaderpacks']) }),
  'content:import': z.object({
    instanceId: id,
    kind: z.enum(['resourcepacks', 'shaderpacks']),
    files: z.array(path).min(1).max(200)
  }),
  'content:setEnabled': z.object({
    instanceId: id,
    kind: z.enum(['resourcepacks', 'shaderpacks']),
    fileName: safeSegment,
    enabled: z.boolean()
  }),
  'content:delete': z.object({
    instanceId: id,
    kind: z.enum(['resourcepacks', 'shaderpacks']),
    fileName: safeSegment
  }),
  'content:openFolder': z.object({
    instanceId: id,
    kind: z.enum(['resourcepacks', 'shaderpacks', 'screenshots'])
  }),
  'content:screenshots': z.object({ instanceId: id }),

  /* ------------------------------------------------- modrinth browser */
  'modrinth:search': z.object({
    query: z.string().max(120),
    kind: z.enum(['mod', 'resourcepack', 'shader', 'modpack']),
    gameVersion: z.string().max(64).nullable().optional(),
    loader: z.string().max(32).nullable().optional(),
    offset: z.number().int().min(0).max(5000).optional(),
    limit: z.number().int().min(1).max(50).optional(),
    instanceId: id.nullable().optional()
  }),
  'modrinth:versions': z.object({
    projectId: z.string().min(1).max(64),
    kind: z.enum(['mod', 'resourcepack', 'shader', 'modpack']),
    gameVersion: z.string().max(64).nullable().optional(),
    loader: z.string().max(32).nullable().optional()
  }),
  'modrinth:install': z.object({
    instanceId: id,
    versionId: z.string().min(1).max(64),
    kind: z.enum(['mod', 'resourcepack', 'shader', 'modpack'])
  }),
  'modrinth:project': z.object({ projectId: z.string().min(1).max(64) }),
  'modpack:inspect': z.object({ filePath: path }),
  'modpack:installFile': z.object({ filePath: path, name: z.string().max(64).optional() }),
  'modpack:installModrinth': z.object({ versionId: z.string().min(1).max(64), name: z.string().max(64).optional() }),
  'modpack:installCurseForge': z.object({
    projectId: z.string().min(1).max(32),
    fileId: z.string().min(1).max(32),
    name: z.string().max(64).optional()
  }),
  'mods:checkUpdates': z.object({ instanceId: id }),
  'mods:applyUpdate': z.object({ instanceId: id, update: z.record(z.string(), z.unknown()) }),
  'curseforge:status': z.void(),
  'datapacks:list': z.void(),
  'datapacks:preview': z.object({
    instanceId: id,
    packId: z.string().min(1).max(64),
    options: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
  }),
  'datapacks:install': z.object({
    instanceId: id,
    worldFolder: safeSegment,
    packId: z.string().min(1).max(64),
    options: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
  }),
  'datapacks:installed': z.object({ instanceId: id, worldFolder: safeSegment }),
  'datapacks:remove': z.object({ instanceId: id, worldFolder: safeSegment, fileName: safeSegment }),
  /* ---------------------------------------------------------- companion */
  'companion:list': z.void(),
  'companion:create': z.object({ name: z.string().max(16).optional() }),
  'companion:delete': z.object({ id: z.string().min(1) }),
  'companion:settings': z.object({ id: z.string().min(1) }),
  'companion:updateSettings': z.object({ id: z.string().min(1), patch: z.record(z.string(), z.unknown()) }),
  'companion:start': z.object({ id: z.string().min(1) }),
  'companion:stop': z.object({ id: z.string().min(1) }),
  'companion:instruct': z.object({ id: z.string().min(1), text: z.string().min(1).max(500) }),
  'companion:state': z.object({ id: z.string().min(1) }),
  'companion:states': z.void(),
  'companion:clearMemory': z.object({ id: z.string().min(1) }),
  'companion:testModel': z.object({ id: z.string().min(1) }),
  'companion:listModels': z.object({ id: z.string().min(1) }),

  'host:list': z.void(),
  'host:save': z.object({
    id: z.string().nullable(),
    name: z.string().min(1).max(60),
    minecraftVersion: z.string().min(1).max(40),
    software: z.enum(['vanilla', 'paper', 'purpur', 'fabric', 'forge', 'neoforge']),
    port: z.number().int().min(1024).max(65535),
    onlineMode: z.boolean(),
    reachability: z.enum(['local', 'network', 'anyone']),
    memoryMb: z.number().int().min(512).max(16384),
    motd: z.string().max(59),
    difficulty: z.enum(['peaceful', 'easy', 'normal', 'hard']),
    gameMode: z.enum(['survival', 'creative', 'adventure']),
    maxPlayers: z.number().int().min(1).max(100),
    allowCheats: z.boolean(),
    operators: z.array(z.string().min(1).max(16)).max(20)
  }),
  'host:delete': z.object({ id: z.string().min(1), deleteWorld: z.boolean() }),
  'host:install': z.object({ id: z.string().min(1) }),
  'host:acceptEula': z.object({ id: z.string().min(1) }),
  'host:start': z.object({ id: z.string().min(1) }),
  'host:stop': z.object({ id: z.string().min(1) }),
  'host:command': z.object({ id: z.string().min(1), command: z.string().min(1).max(256) }),
  'host:states': z.void(),
  'host:console': z.object({ id: z.string().min(1) }),
  'host:eulaUrl': z.void(),
  'host:software': z.void(),
  'host:mods': z.object({ id: z.string().min(1) }),
  'host:importMods': z.object({ id: z.string().min(1) }),
  'host:toggleMod': z.object({ id: z.string().min(1), fileName: z.string().min(1).max(255), enabled: z.boolean() }),
  'host:deleteMod': z.object({ id: z.string().min(1), fileName: z.string().min(1).max(255) }),
  'host:installMod': z.object({ id: z.string().min(1), versionId: z.string().min(1).max(64) }),
  'host:joinTargets': z.object({ id: z.string().min(1) }),
  'host:join': z.object({ id: z.string().min(1), instanceId: z.string().min(1) }),
  'host:openFolder': z.object({ id: z.string().min(1) }),
  'host:syncMods': z.object({ id: z.string().min(1), instanceId: z.string().min(1) }),

  'datapacks:export': z.object({
    instanceId: id,
    packId: z.string().min(1).max(64),
    options: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
    outputPath: path
  }),
  'curseforge:search': z.object({
    query: z.string().max(120),
    kind: z.enum(['mod', 'resourcepack', 'shader', 'modpack']),
    gameVersion: z.string().max(64).nullable().optional(),
    loader: z.string().max(32).nullable().optional(),
    offset: z.number().int().min(0).max(5000).optional(),
    limit: z.number().int().min(1).max(50).optional(),
    instanceId: id.nullable().optional()
  }),
  'curseforge:files': z.object({
    projectId: z.string().min(1).max(32),
    kind: z.enum(['mod', 'resourcepack', 'shader', 'modpack']),
    gameVersion: z.string().max(64).nullable().optional(),
    loader: z.string().max(32).nullable().optional()
  }),
  'curseforge:install': z.object({
    instanceId: id,
    projectId: z.string().min(1).max(32),
    fileId: z.string().min(1).max(32),
    kind: z.enum(['mod', 'resourcepack', 'shader', 'modpack'])
  }),

  /* --------------------------------------------------------------- worlds */
  'worlds:list': z.object({ instanceId: id }),
  'worlds:openFolder': z.object({ instanceId: id, folderName: safeSegment.optional() }),
  'worlds:backup': z.object({ instanceId: id, folderName: safeSegment }),
  'worlds:listBackups': z.object({ instanceId: id }),
  'worlds:deleteBackup': z.object({ instanceId: id, fileName: safeSegment }),
  'worlds:delete': z.object({ instanceId: id, folderName: safeSegment }),

  /* -------------------------------------------------------------- servers */
  'servers:list': z.void(),
  'servers:save': z.object({
    id: id.nullable(),
    name: z.string().min(1).max(64),
    address: z.string().min(1).max(255),
    port: z.number().int().min(1).max(65535),
    notedVersion: z.string().max(64).nullable().optional(),
    description: z.string().max(512).nullable().optional(),
    favorite: z.boolean().optional(),
    preferredInstanceId: id.nullable().optional()
  }),
  'servers:delete': z.object({ id }),
  'servers:favorite': z.object({ id, favorite: z.boolean() }),
  'servers:ping': z.object({ id }),
  'servers:pingAll': z.void(),
  'servers:import': z.object({ instanceId: id }),

  /* ---------------------------------------------------------------- skins */
  'skins:list': z.void(),
  'skins:import': z.object({
    filePath: path,
    name: z.string().min(1).max(64),
    variant: z.enum(['classic', 'slim'])
  }),
  'skins:delete': z.object({ id }),
  'skins:favorite': z.object({ id, favorite: z.boolean() }),
  'skins:apply': z.object({ id }),
  'skins:resetToCurrent': z.void()
}
