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
  'app:window': z.object({ action: z.enum(['minimize', 'maximize', 'close']) }),
  'app:systemMemory': z.void(),

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
