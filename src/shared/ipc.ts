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
import { CREATION_KINDS } from './types'
import { IPC_CHANNELS, EVENT_CHANNELS, type IpcChannel, type EventChannel } from './channels'

export { IPC_CHANNELS, EVENT_CHANNELS }
export type { IpcChannel, EventChannel }

const id = z.string().min(1).max(128)
const path = z.string().min(1).max(4096)

/*
 * A modpack's own title, which is often long.
 *
 * Capped at 64 characters these refused real packs outright: one called
 * "Cobblemon - Mega Pokemon + Cobblemon Gyms + Cobblemon Friends + Cobblemon MMO
 * RPG + Legendary Cobblemon + Cobblemon Server" runs to 120, was rejected before
 * the main process ever saw it, and surfaced to the user as an internal bug. The
 * installer already shortens whatever it receives into a sensible instance name,
 * so this only has to be generous enough not to lie about what a pack may be
 * called.
 */
const modpackName = z.string().max(256).optional()

/** Rejects path fragments that try to escape their parent directory. */
export const safeSegment = z
  .string()
  .min(1)
  .max(255)
  .refine((v) => !v.includes('/') && !v.includes('\\') && v !== '.' && v !== '..', {
    message: 'must be a single path segment'
  })

const loaderId = z.enum(['vanilla', 'fabric', 'forge', 'neoforge', 'quilt'])

/*
 * A rendered PNG on its way to disk.
 *
 * Generous, because a listing image is a real picture rather than a 20x40
 * banner - but bounded, since this crosses a process boundary and arrives as a
 * string. The prefix is checked here so the main process is never handed a
 * data URL claiming to be something else.
 */
const pngDataUrl = z
  .string()
  .max(12 * 1024 * 1024)
  .refine((v) => v.startsWith('data:image/png;base64,'), {
    message: 'must be a PNG data URL'
  })

/** A dye or pattern name, which the shared banner module then checks properly. */
const bannerWord = z
  .string()
  .min(1)
  .max(48)
  .regex(/^[a-z_]+$/, 'must be a lowercase identifier')

const bannerDesign = z.object({
  name: z.string().max(48),
  base: bannerWord,
  layers: z.array(z.object({ pattern: bannerWord, colour: bannerWord })).max(6)
})

/**
 * Every kind of thing a generator can make.
 *
 * Taken from the same array the TypeScript type is built from, so the two
 * cannot disagree. They did: this was written out separately for `variations`,
 * `creations:list` and `creations:save`, so adding loot updated the type and
 * two of the three schemas - and the third rejected every attempt to save one,
 * which reached the screen as "nothing saved yet".
 */
const creationKind = z.enum(CREATION_KINDS)

/**
 * A resource pack draft, checked in full before any of it is written.
 *
 * What comes through here ends up inside a zip that is then handed out over
 * http to whoever joins the server, so every field is bounded: the counts, the
 * lengths, and the images by the existing png rule.
 */
const resourcePackDraft = z.object({
  name: z.string().min(1).max(64),
  description: z.string().max(256),
  items: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        label: z.string().min(1).max(64),
        base: z.string().min(1).max(64),
        image: pngDataUrl,
        replaces: z.boolean()
      })
    )
    .max(64),
  sounds: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        label: z.string().min(1).max(64),
        event: z.string().min(1).max(96),
        file: path,
        stream: z.boolean()
      })
    )
    .max(32),
  textures: z
    .array(
      z.object({
        // Checked again in the builder, because this one decides where a file
        // lands inside a zip that is then handed to strangers.
        /*
         * Must start with a name, not a separator.
         *
         * Allowing a leading slash let "/etc/passwd" through: every character
         * in it is legal, so the shape has to say a path begins with a segment.
         * It could not have escaped the assets folder - the builder strips the
         * slash - but it would have quietly created textures/etc/passwd.png,
         * and a rule that only half holds is one nobody can reason about.
         */
        path: z
          .string()
          .min(1)
          .max(200)
          .regex(/^[a-z0-9][a-z0-9_-]*(\/[a-z0-9][a-z0-9_-]*)*$/)
          .refine((v) => !v.includes('..'), { message: 'no traversal' }),
        image: pngDataUrl
      })
    )
    /*
     * More than the game has.
     *
     * This was 512, which is thirteen per cent of the 3,855 textures a 26.2
     * jar ships - so "restyle the whole pack", the feature this array exists
     * for, could not be sent at all. Every serve and every autosave was
     * rejected here before reaching a handler, and because the save path
     * carries no cap the pack saved fine and then refused to be used: 3,446
     * textures, 2.87 MB, rejected on the way out.
     *
     * The bound worth having is on the payload, not the count, and 3,446 of
     * them measured 870 bytes each. Four thousand covers the whole vanilla
     * set with room for the versions that add to it.
     */
    .max(4096),
  armour: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        label: z.string().min(1).max(64),
        base: z.string().min(1).max(32),
        body: pngDataUrl,
        legs: pngDataUrl,
        icons: z.object({
          helmet: pngDataUrl,
          chestplate: pngDataUrl,
          leggings: pngDataUrl,
          boots: pngDataUrl
        })
      })
    )
    .max(32)
    /*
     * Defaulted, not required. Every pack saved before armour existed has no
     * such key, and a required field would reject those at the IPC boundary
     * with nothing on screen to say why - which is the exact shape of the bug
     * that made "Build and serve" look dead for a day.
     */
    .default([]),
  panorama: z.array(pngDataUrl).length(6).nullable(),
  logo: pngDataUrl.nullable()
})

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
  'app:diagnostics': z.object({
    outputPath: path,
    instanceId: id.optional(),
    note: z.string().max(500).optional()
  }),
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
  'instances:import': z.object({ filePath: path, name: modpackName }),
  'instances:findForeign': z.void(),
  'instances:importForeign': z.object({ id: z.string().min(1).max(256), name: modpackName }),
  'instances:snapshots': z.object({ id }),
  'instances:snapshot': z.object({ id, name: z.string().min(1).max(60), note: z.string().max(300).optional() }),
  'instances:restoreSnapshot': z.object({ id, snapshotId: id }),
  'instances:deleteSnapshot': z.object({ id, snapshotId: id }),
  'instances:diffSnapshot': z.object({ id, snapshotId: id }),
  'instances:exportPack': z.object({
    id,
    outputPath: path,
    name: z.string().max(120).optional(),
    version: z.string().max(32).optional(),
    summary: z.string().max(400).optional(),
    includeConfigs: z.boolean().optional(),
    includeWorlds: z.boolean().optional()
  }),

  /* --------------------------------------------------------------- launch */
  'launch:start': z.object({ instanceId: id, serverAddress: z.string().max(255).optional() }),
  'launch:stop': z.object({ instanceId: id }),
  'launch:state': z.void(),
  'launch:logs': z.object({ instanceId: id, limit: z.number().int().min(1).max(5000).optional() }),
  'launch:autopsy': z.object({ instanceId: id }),
  'launch:autopsyAvailable': z.void(),
  'launch:applyFix': z.object({
    instanceId: id,
    fix: z.object({
      kind: z.enum(['disable-mod', 'update-mod', 'more-memory', 'less-memory', 'repair', 'manual']),
      label: z.string().max(80),
      detail: z.string().max(300),
      modFileName: safeSegment.nullable()
    })
  }),

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
  'modpack:installFile': z.object({ filePath: path, name: modpackName }),
  'modpack:installModrinth': z.object({ versionId: z.string().min(1).max(64), name: modpackName }),
  /*
   * Hosting a pack rather than playing it. The options mirror what a new server
   * needs and are all optional: left out, the pack's own name is used, the port
   * is the first one free, and the memory is a modded-server default.
   */
  'modpack:serverFromFile': z.object({
    filePath: path,
    name: modpackName,
    port: z.number().int().min(1024).max(65535).optional(),
    memoryMb: z.number().int().min(512).max(65536).optional()
  }),
  'modpack:serverFromModrinth': z.object({
    versionId: z.string().min(1).max(64),
    name: modpackName,
    port: z.number().int().min(1024).max(65535).optional(),
    memoryMb: z.number().int().min(512).max(65536).optional()
  }),
  'modpack:serverFromCurseForge': z.object({
    projectId: z.string().min(1).max(32),
    fileId: z.string().min(1).max(32),
    name: modpackName,
    port: z.number().int().min(1024).max(65535).optional(),
    memoryMb: z.number().int().min(512).max(65536).optional()
  }),
  'modpack:installCurseForge': z.object({
    projectId: z.string().min(1).max(32),
    fileId: z.string().min(1).max(32),
    name: modpackName
  }),
  'mods:checkUpdates': z.object({ instanceId: id }),
  'mods:applyUpdate': z.object({ instanceId: id, update: z.record(z.string(), z.unknown()) }),
  'mods:changelog': z.object({ instanceId: id, update: z.record(z.string(), z.unknown()) }),
  'mods:autoUpdateSettings': z.object({}),
  'mods:setAutoUpdateSettings': z.object({
    patch: z.object({
      mode: z.enum(['off', 'notify', 'install']).optional(),
      everyHours: z.number().int().min(1).max(168).optional(),
      reviewRisky: z.boolean().optional()
    })
  }),
  'mods:checkAllNow': z.object({}),
  'mods:bundledStatus': z.object({ instanceId: id }),
  'voice:status': z.void(),
  /* Downloading the model is the slow part, so it is asked for explicitly. */
  'voice:prepare': z.object({ build: z.enum(['q4', 'q8']).optional() }),
  'voice:speak': z.object({
    text: z.string().min(1).max(400),
    voice: z.string().max(40).optional(),
    build: z.enum(['q4', 'q8']).optional()
  }),
  'voice:serveToGame': z.object({ on: z.boolean() }),
  'mods:installBundled': z.object({ instanceId: id, modId: z.string().min(1).max(64) }),
  'mods:rollbacks': z.object({ instanceId: id }),
  'mods:rollback': z.object({ instanceId: id, fileName: safeSegment }),
  'curseforge:verify': z.object({ key: z.string().optional() }).optional(),
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
  'companion:toolSizes': z.object({}),
  'companion:setMicrophone': z.object({ wanted: z.boolean() }),
  'companion:routines': z.undefined(),
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
  'companion:camera': z.object({ id: z.string().min(1), on: z.boolean() }),
  'companion:interrupt': z.object({ id: z.string().min(1) }),
  'companion:usage': z.void(),
  'companion:resetUsage': z.object({ id: z.string().min(1).optional() }).optional(),
  'companion:builds': z.void(),
  'companion:undoBuild': z.object({
    buildId: z.string().min(1).max(64),
    companionId: z.string().min(1).optional()
  }),
  'companion:blueprints': z.void(),
  'companion:importSchematic': z.object({ filePath: path }),
  'companion:build': z.object({ id: z.string().min(1), blueprintId: z.string().min(1).max(128) }),
  'blueprints:export': z.object({
    blueprintId: z.string().min(1).max(128),
    /** Where it goes: a client instance, or a hosted server's world. */
    instanceId: id.optional(),
    serverId: id.optional(),
    format: z.enum(['schem', 'nbt'])
  }),
  'blueprints:setupLitematica': z.object({ instanceId: id }),
  'companion:testModel': z.object({ id: z.string().min(1) }),
  'companion:listModels': z.object({ id: z.string().min(1) }),

  'crew:list': z.void(),
  'crew:create': z.object({
    name: z.string().min(1).max(40),
    foremanId: z.string().min(1),
    memberIds: z.array(z.string().min(1)).max(8)
  }),
  'crew:update': z.object({
    id: z.string().min(1),
    patch: z.object({
      name: z.string().max(40).optional(),
      memberIds: z.array(z.string().min(1)).max(8).optional()
    })
  }),
  'crew:delete': z.object({ id: z.string().min(1) }),
  'crew:start': z.object({ id: z.string().min(1) }),
  'crew:stop': z.object({ id: z.string().min(1) }),
  'crew:notes': z.object({ id: z.string().min(1) }),
  'crew:clearNotes': z.object({ id: z.string().min(1) }),

  'host:installModrinth': z.object({ id: z.string(), versionId: z.string(), kind: z.string() }),
  'host:installCurseForge': z.object({ id: z.string(), projectId: z.string(), fileId: z.string(), kind: z.string() }),
  'host:share': z.object({ id: z.string() }),
  'host:forwardStatus': z.object({ id: z.string() }),
  'host:openPort': z.object({ id: z.string(), acceptUnverified: z.boolean().optional() }),
  'host:closePort': z.object({ id: z.string() }),
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
    motd: z.string().max(250),
    difficulty: z.enum(['peaceful', 'easy', 'normal', 'hard']),
    gameMode: z.enum(['survival', 'creative', 'adventure']),
    maxPlayers: z.number().int().min(1).max(100),
    allowCheats: z.boolean(),
    operators: z.array(z.string().min(1).max(16)).max(20),

    /*
     * The world and gameplay settings.
     *
     * These were missing, and zod strips whatever a schema does not name — so
     * every one of them was silently discarded on the way through. The settings
     * screen showed them, the form sent them, the server-properties writer
     * expected them, and they never arrived: turn on "allow flight", save,
     * reopen, and it is off again. Spawn protection, view distance, PVP,
     * hardcore and the seed all went the same way, which is also why the
     * companions kept being refused near spawn.
     *
     * Optional, because a form that has never shown a field should not be
     * forced to invent a value for it.
     */
    levelSeed: z.string().max(120).optional(),
    pvp: z.boolean().optional(),
    hardcore: z.boolean().optional(),
    allowFlight: z.boolean().optional(),
    spawnProtection: z.number().int().min(0).max(256).optional(),
    viewDistance: z.number().int().min(2).max(32).optional(),
    simulationDistance: z.number().int().min(2).max(32).optional(),
    spawnMonsters: z.boolean().optional(),
    spawnAnimals: z.boolean().optional(),
    whitelist: z.boolean().optional()
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
  'host:join': z.object({ id: z.string().min(1), instanceId: z.string().min(1).optional() }),
  'host:openFolder': z.object({ id: z.string().min(1) }),
  'host:syncMods': z.object({ id: z.string().min(1), instanceId: z.string().min(1) }),
  'host:deploySteward': z.object({ id: z.string().min(1), companionId: z.string().min(1).optional() }),
  'host:dismissSteward': z.object({ companionId: z.string().min(1) }),
  'host:stewards': z.object({ id: z.string().min(1) }),
  'host:backup': z.object({ id: z.string().min(1) }),
  'host:backups': z.object({ id: z.string().min(1) }),
  'host:restoreBackup': z.object({ id: z.string().min(1), fileName: safeSegment }),
  'host:deleteBackup': z.object({ id: z.string().min(1), fileName: safeSegment }),
  'host:restartSettings': z.object({ id: z.string().min(1) }),
  'host:setRestartSettings': z.object({
    id: z.string().min(1),
    patch: z.object({
      enabled: z.boolean().optional(),
      intervalHours: z.number().int().min(1).max(168).optional(),
      warnMinutes: z.number().int().min(0).max(30).optional(),
      skipIfPlayers: z.boolean().optional()
    })
  }),
  'host:backupSettings': z.object({ id: z.string().min(1) }),
  'host:inviteLink': z.object({ id: z.string().min(1) }),
  'host:tunnelSettings': z.object({ id: z.string().min(1) }),
  'host:setTunnelSettings': z.object({
    id: z.string().min(1),
    patch: z.object({
      agentPath: path.optional(),
      provider: z.enum(['playit', 'custom']).optional(),
      args: z.string().max(500).optional()
    })
  }),
  'host:startTunnel': z.object({ id: z.string().min(1) }),
  'host:stopTunnel': z.object({ id: z.string().min(1) }),
  'host:tunnelState': z.object({ id: z.string().min(1) }),
  'links:pendingInvite': z.void(),
  'links:acceptInvite': z.object({
    host: z.string().min(1).max(255),
    port: z.number().int().min(1).max(65535),
    name: z.string().max(64).nullable().optional(),
    minecraftVersion: z.string().max(32).nullable().optional(),
    loader: z.string().max(16).nullable().optional(),
    packVersionId: z.string().max(64).nullable().optional(),
    instanceId: id.nullable().optional()
  }),
  'host:setBackupSettings': z.object({
    id: z.string().min(1),
    patch: z.object({
      enabled: z.boolean().optional(),
      intervalMinutes: z.number().int().min(5).max(1440).optional(),
      keep: z.number().int().min(1).max(50).optional(),
      onStop: z.boolean().optional()
    })
  }),

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
  'worlds:map': z.object({ instanceId: id, folderName: safeSegment }),
  'worlds:listBackups': z.object({ instanceId: id }),
  'worlds:deleteBackup': z.object({ instanceId: id, fileName: safeSegment }),
  'worlds:restore': z.object({ instanceId: id, fileName: safeSegment }),
  'worlds:import': z.object({ instanceId: id, filePath: path }),
  'worlds:delete': z.object({ instanceId: id, folderName: safeSegment }),

  /* --------------------------------------------------- public directory */
  'directory:list': z.void(),
  'directory:refresh': z.object({ force: z.boolean().optional() }).optional(),
  'directory:ping': z.object({ id: z.string().min(1).max(64) }),
  /* A typed-in address, parsed and bounds-checked in the service. */
  'directory:lookup': z.object({ address: z.string().min(1).max(300) }),
  'directory:add': z.object({
    name: z.string().min(1).max(64),
    address: z.string().min(1).max(255),
    port: z.number().int().min(1).max(65535)
  }),
  'directory:compatibility': z.void(),
  'directory:joinTargets': z.object({
    address: z.string().min(1).max(255),
    port: z.number().int().min(1).max(65535)
  }),
  'directory:join': z.object({
    address: z.string().min(1).max(255),
    port: z.number().int().min(1).max(65535),
    instanceId: id.optional()
  }),

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

  'host:checkOutside': z.object({ id }),

  /* --------------------------------------------------------------- banners */

  'banners:brains': z.void(),
  'banners:design': z.object({
    prompt: z.string().min(1).max(500),
    companionId: id,
    current: z.unknown().optional()
  }),
  'banners:designIcon': z.object({
    prompt: z.string().min(1).max(500),
    companionId: id,
    current: z.unknown().optional()
  }),
  'banners:designMotd': z.object({
    prompt: z.string().min(1).max(500),
    companionId: id,
    current: z.unknown().optional()
  }),
  'banners:designLogo': z.object({
    prompt: z.string().min(1).max(500),
    companionId: id,
    current: z.unknown().optional()
  }),
  'banners:designFirework': z.object({
    prompt: z.string().min(1).max(500),
    companionId: id,
    current: z.unknown().optional()
  }),
  'banners:designItem': z.object({
    prompt: z.string().min(1).max(500),
    companionId: id,
    current: z.unknown().optional()
  }),
  'banners:applyMotd': z.object({
    serverId: id,
    design: z.object({ line1: z.string().max(200), line2: z.string().max(200) })
  }),
  /*
   * The command is built in the renderer from a design it already validated,
   * so what crosses here is checked for shape rather than rebuilt: it must be
   * a give and nothing else, and it may not carry a newline that would turn
   * one console line into two.
   */
  'banners:designRecipes': z.object({
    prompt: z.string().min(1).max(500),
    companionId: id,
    current: z.unknown().optional()
  }),
  /*
   * A wall of maps, as the colour bytes for each one.
   *
   * Bounded at sixteen maps because every one of them is 16384 numbers going
   * across the IPC boundary - a four by four wall is already a quarter of a
   * million, and nobody hangs more than that on a wall.
   */
  'banners:designAdvancements': z.object({
    prompt: z.string().min(1).max(2000),
    companionId: id.optional(),
    current: z.unknown().optional()
  }),
  'banners:installAdvancements': z.object({ serverId: id, pack: z.unknown() }),
  'banners:installAdvancementsWorld': z.object({
    instanceId: id,
    worldFolder: z.string().min(1).max(255),
    pack: z.unknown()
  }),
  'banners:exportAdvancements': z.object({
    path,
    pack: z.unknown(),
    minecraftVersion: z.string().min(1).max(32)
  }),

  'mapart:writeServer': z.object({
    serverId: id,
    tiles: z
      .array(z.array(z.number().int().min(0).max(255)).length(16384))
      .min(1)
      .max(16),
    across: z.number().int().min(1).max(4),
    down: z.number().int().min(1).max(4)
  }),

  'mapart:write': z.object({
    instanceId: id,
    worldFolder: z.string().min(1).max(255),
    tiles: z
      .array(z.array(z.number().int().min(0).max(255)).length(16384))
      .min(1)
      .max(16),
    across: z.number().int().min(1).max(4),
    down: z.number().int().min(1).max(4)
  }),

  /* ------------------------------------------------------- resource packs */

  'resourcepack:build': z.object({
    draft: resourcePackDraft,
    minecraftVersion: z.string().min(1).max(32),
    path
  }),
  'resourcepack:install': z.object({ instanceId: id, draft: resourcePackDraft }),
  'resourcepack:serve': z.object({
    serverId: id,
    draft: resourcePackDraft,
    port: z.number().int().min(1024).max(65535),
    required: z.boolean(),
    address: z.string().max(255).optional()
  }),
  'resourcepack:hostStatus': z.void(),
  'resourcepack:stopHost': z.void(),
  'resourcepack:attach': z.object({
    serverId: id,
    url: z.string().max(2048).startsWith('http'),
    sha1: z.string().regex(/^[0-9a-f]{40}$/),
    required: z.boolean()
  }),
  'resourcepack:detach': z.object({ serverId: id }),
  'resourcepack:openPort': z.object({ port: z.number().int().min(1024).max(65535) }),
  'resourcepack:closePort': z.object({ port: z.number().int().min(1024).max(65535) }),
  'resourcepack:portStatus': z.object({ port: z.number().int().min(1024).max(65535) }),
  'resourcepack:textures': z.object({ minecraftVersion: z.string().min(1).max(32) }),
  'resourcepack:texture': z.object({
    minecraftVersion: z.string().min(1).max(32),
    path: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[a-z0-9][a-z0-9_-]*(\/[a-z0-9][a-z0-9_-]*)*$/)
  }),
  'resourcepack:open': z.object({ file: path }),
  'resourcepack:saveSound': z.object({
    name: z.string().min(1).max(64),

    /*
     * Base64 rather than a Uint8Array, matching how every image in a pack
     * already crosses this boundary. The ceiling is 32MB encoded, which is
     * about 24MB of audio - far longer than any music disc, and short of the
     * point where holding it as a string is the problem.
     */
    base64: z
      .string()
      .min(1)
      .max(32 * 1024 * 1024)
  }),
  'resourcepack:remember': z.object({ draft: resourcePackDraft }),
  'resourcepack:recall': z.void(),
  'banners:designRecipe': z.object({
    prompt: z.string().min(1).max(2000),
    companionId: id.optional(),
    current: z.unknown().optional()
  }),

  /* --------------------------------------------------------- server site */

  'site:config': z.object({ serverId: id }),
  'site:save': z.object({
    config: z.object({
      serverId: id,
      /*
       * Half-typed is a normal state, not a rejected one.
       *
       * These fields save when you click away from them, so demanding a
       * non-empty name meant adding a vote row and then touching anything
       * else was refused outright - the launcher reported "that request was
       * not valid" at somebody who had done nothing wrong. Incomplete rows
       * are accepted here and left off the page when it renders.
       */
      title: z.string().max(64),
      blurb: z.string().max(280),
      joinAddress: z.string().max(255),
      votes: z
        .array(
          z.object({
            name: z.string().max(48),
            /*
             * Empty, or http(s) and nothing else.
             *
             * The page renders these straight into an anchor, so a
             * `javascript:` url would be a script running for whoever opened
             * it. Checked as a real scheme rather than a "starts with http"
             * prefix, which `httpevil:` would have satisfied.
             */
            url: z
              .string()
              .max(2048)
              .refine((v) => v === '' || /^https?:\/\//i.test(v), {
                message: 'must be an http or https link'
              })
          })
        )
        .max(12),
      accent: z.string().regex(/^#[0-9a-fA-F]{6}$/)
    })
  }),
  'site:start': z.object({ serverId: id, port: z.number().int().min(1024).max(65535) }),
  'site:stop': z.void(),
  'site:status': z.void(),
  'site:votifierPort': z.object({
    serverId: id,
    open: z.boolean()
  }),
  'site:votifierInfo': z.object({ serverId: id }),
  /*
   * A hostname, or empty to go back to the machine's own address.
   *
   * Deliberately loose about the shape - a domain can be almost anything - but
   * strict about what it is not: no scheme, no path, no spaces. The check that
   * matters happens against real DNS a moment later.
   */
  'host:setDomain': z.object({
    serverId: id,
    domain: z
      .string()
      .max(253)
      .refine((v) => v === '' || /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(v), {
        message: 'not a hostname'
      })
  }),
  'host:checkDomain': z.object({ serverId: id, domain: z.string().min(1).max(253) }),
  'host:discordWebhook': z.object({
    serverId: id,

    /*
     * Discord's own shape, or empty to turn the feed off.
     *
     * Checked here rather than in the panel because a webhook that is nearly
     * right fails as one swallowed HTTP error in a log nobody reads - the
     * plugin logs once and gives up, deliberately, so a wrong url looks
     * exactly like a feed that is simply switched off.
     */
    url: z
      .string()
      .max(300)
      .refine(
        (v) => v === '' || /^https:\/\/(canary\.|ptb\.)?discord(app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(v),
        { message: 'not a Discord webhook url' }
      )
  }),
  'host:punishments': z.object({ serverId: id }),
  'host:knownPlayers': z.object({ serverId: id }),

  'banners:designLoot': z.object({
    prompt: z.string().min(1).max(2000),
    companionId: id.optional(),
    current: z.unknown().optional()
  }),
  'banners:installLoot': z.object({ serverId: id, pack: z.unknown() }),
  'banners:installLootWorld': z.object({
    instanceId: id,
    worldFolder: z.string().min(1).max(255),
    pack: z.unknown()
  }),
  'banners:exportLoot': z.object({
    path,
    pack: z.unknown(),
    minecraftVersion: z.string().min(1).max(32)
  }),
  'banners:installRecipes': z.object({ serverId: id, pack: z.unknown() }),
  'banners:installRecipesWorld': z.object({
    instanceId: id,
    worldFolder: z.string().min(1).max(255),
    pack: z.unknown()
  }),
  'banners:exportRecipes': z.object({
    path,
    pack: z.unknown(),
    minecraftVersion: z.string().min(1).max(32)
  }),

  'banners:variations': z.object({
    kind: creationKind,
    prompt: z.string().min(1).max(500),
    companionId: id,
    count: z.number().int().min(2).max(6)
  }),

  /* ------------------------------------------------------------- library */

  'creations:list': z.object({
    kind: creationKind.optional()
  }),
  'creations:save': z.object({
    id: id.nullable().optional(),
    kind: creationKind,
    name: z.string().min(1).max(60),
    data: z.unknown(),
    thumbnail: pngDataUrl.nullable().optional()
  }),
  'creations:delete': z.object({ id }),
  'creations:rename': z.object({ id, name: z.string().min(1).max(60) }),

  'banners:giveDesigned': z.object({
    serverId: id,
    command: z
      .string()
      .min(1)
      .max(8000)
      .refine((v) => /^give /.test(v) && !/[\r\n]/.test(v), {
        message: 'must be a single give command'
      })
  }),
  'banners:icon': z.object({ serverId: id, png: pngDataUrl }),
  'banners:save': z.object({ path, png: pngDataUrl }),
  'banners:give': z.object({
    serverId: id,
    /* A selector or a name, both of which the server itself validates. */
    target: z.string().min(1).max(64),
    design: bannerDesign
  }),

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
