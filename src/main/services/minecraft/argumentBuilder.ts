import { delimiter, join } from 'node:path'
import { platform } from 'node:os'
import type { Instance } from '@shared/types'
import type { ArgumentEntry, VersionJson } from './versionTypes'
import { evaluateRules, type FeatureSet } from './rules'
import { assetsRoot } from '../../core/paths'

export interface LaunchContext {
  instance: Instance
  version: VersionJson
  versionId: string
  classpath: string[]
  nativesDir: string
  /** In-memory only. Never logged, never sent to the renderer. */
  accessToken: string
  username: string
  uuid: string
  xuid: string
  clientId: string
  /** Address to join straight away, if the user pressed Join on a server. */
  quickPlayServer?: string | null
}

const LAUNCHER_NAME = 'NexusCraft'
const LAUNCHER_VERSION = '1.0.0'

const IGNORE_LIST_PREFIX = '-DignoreList='

/**
 * Builds the substitution table used by Mojang's argument templates. Values are
 * inserted as single argv entries, so spaces in paths need no quoting.
 */
function placeholders(context: LaunchContext): Record<string, string> {
  const { version, instance } = context
  const assetIndexId = version.assetIndex?.id ?? version.assets ?? 'legacy'
  const isLegacyAssets = version.assets === 'legacy' || version.assets === 'pre-1.6'

  return {
    auth_player_name: context.username,
    version_name: context.versionId,
    game_directory: instance.gameDir,
    assets_root: assetsRoot(),
    game_assets: isLegacyAssets ? join(assetsRoot(), 'virtual', assetIndexId) : assetsRoot(),
    assets_index_name: assetIndexId,
    auth_uuid: context.uuid,
    auth_access_token: context.accessToken,
    auth_session: `token:${context.accessToken}:${context.uuid}`,
    auth_xuid: context.xuid,
    clientid: context.clientId,
    user_type: 'msa',
    version_type: version.type ?? 'release',
    natives_directory: context.nativesDir,
    launcher_name: LAUNCHER_NAME,
    launcher_version: LAUNCHER_VERSION,
    classpath: context.classpath.join(delimiter),
    classpath_separator: delimiter,
    library_directory: join(assetsRoot(), '..', 'libraries'),
    user_properties: '{}',
    resolution_width: String(instance.window.width),
    resolution_height: String(instance.window.height),
    quickPlayPath: '',
    quickPlaySingleplayer: '',
    quickPlayMultiplayer: context.quickPlayServer ?? '',
    quickPlayRealms: ''
  }
}

function substitute(value: string, table: Record<string, string>): string {
  return value.replace(/\$\{([A-Za-z0-9_]+)\}/g, (match, key: string) => table[key] ?? match)
}

/** Flattens a rule-gated argument list down to the entries that apply. */
function expandArguments(entries: ArgumentEntry[], features: FeatureSet, table: Record<string, string>): string[] {
  const out: string[] = []
  for (const entry of entries) {
    if (typeof entry === 'string') {
      out.push(substitute(entry, table))
      continue
    }
    if (!evaluateRules(entry.rules, features)) continue
    const values = Array.isArray(entry.value) ? entry.value : [entry.value]
    for (const value of values) out.push(substitute(value, table))
  }
  return out
}

/**
 * Splits a user-supplied JVM argument string on whitespace while respecting
 * quoted segments, so a path with spaces survives.
 */
export function splitJvmArgs(input: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote: string | null = null

  for (const char of input) {
    if (quote) {
      // Inside a quoted run everything is literal until the matching quote.
      if (char === quote) quote = null
      else current += char
    } else if (char === '"' || char === "'") {
      quote = char
    } else if (/\s/.test(char)) {
      if (current) tokens.push(current)
      current = ''
    } else {
      current += char
    }
  }
  if (current) tokens.push(current)
  return tokens
}

/** Arguments that would break the launch or leak data if a user pasted them in. */
const BLOCKED_USER_JVM_ARGS = [/^-Xmx/i, /^-Xms/i, /^-cp$/i, /^-classpath$/i, /^-jar$/i]

/**
 * Blocked flags whose value is a separate argv entry. Dropping the flag alone
 * would leave its operand behind as a stray argument the JVM cannot parse.
 */
const BLOCKED_WITH_OPERAND = [/^-cp$/i, /^-classpath$/i, /^-jar$/i]

/** Removes blocked user arguments, and the operand of any that take one. */
function filterUserJvmArgs(tokens: string[]): string[] {
  const kept: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (!BLOCKED_USER_JVM_ARGS.some((pattern) => pattern.test(token))) {
      kept.push(token)
      continue
    }
    if (BLOCKED_WITH_OPERAND.some((pattern) => pattern.test(token))) i++
  }
  return kept
}

export interface BuiltArguments {
  args: string[]
  /** Same list with the access token replaced — safe to log or display. */
  safeArgs: string[]
  mainClass: string
}

/**
 * Keeps the Minecraft client jar off Forge's module layer.
 *
 * Forge 1.20.1 launches through BootstrapLauncher, which walks the classpath
 * and turns every entry into a module *except* the ones named in
 * `-DignoreList`. Its own profile ends that list with `${version_name}.jar`,
 * meaning "and the game jar itself".
 *
 * That substitution does not survive a loader profile. `version_name` is the
 * launched id — `1.20.1-forge-47.4.23` — while the jar on the classpath comes
 * from the version it inherits from and is called `1.20.1.jar`. The names do
 * not match, so the game jar is not ignored, gets loaded as an automatic
 * module named `_1._20._1`, and then both it and Forge's patched `minecraft`
 * module export `net.minecraft.data`. The JVM refuses the layer outright:
 *
 *     java.lang.module.ResolutionException: Modules minecraft and _1._20._1
 *     export package net.minecraft.data to module com.google.protobuf
 *
 * The game dies before a single mod loads, and the message names neither the
 * launcher nor the mod, so it reads as the modpack being broken.
 *
 * Changing what `version_name` expands to is not the fix — the game arguments
 * use the same placeholder for `--version`, where the loader id is the correct
 * answer. So the jar's real name is appended to the ignore list instead, which
 * is additive and leaves every other use of the placeholder alone.
 *
 * Only older Forge ships an ignoreList at all; newer Forge and NeoForge have
 * no such argument, and this does nothing for them.
 */
function keepClientJarOffTheModulePath(jvm: string[], version: VersionJson, versionId: string): void {
  const index = jvm.findIndex((arg) => arg.startsWith(IGNORE_LIST_PREFIX))
  if (index === -1) return

  // The same resolution `buildClasspath` uses to find the jar it adds.
  const clientJar = `${version.resolvedBaseId ?? version.inheritsFrom ?? versionId}.jar`

  const entries = jvm[index]
    .slice(IGNORE_LIST_PREFIX.length)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)

  if (entries.includes(clientJar)) return
  entries.push(clientJar)
  jvm[index] = `${IGNORE_LIST_PREFIX}${entries.join(',')}`
}

export function buildLaunchArguments(context: LaunchContext): BuiltArguments {
  const { version, instance } = context
  const table = placeholders(context)

  const features: FeatureSet = {
    is_demo_user: false,
    has_custom_resolution: !instance.window.fullscreen,
    has_quick_plays_support: Boolean(context.quickPlayServer),
    is_quick_play_singleplayer: false,
    is_quick_play_multiplayer: Boolean(context.quickPlayServer),
    is_quick_play_realms: false
  }

  const jvm: string[] = []

  // Heap settings come first so a user argument cannot silently override them.
  jvm.push(`-Xms${instance.java.minRamMb}M`, `-Xmx${instance.java.maxRamMb}M`)

  if (platform() === 'darwin') jvm.push('-XstartOnFirstThread')
  if (platform() === 'win32') {
    // Mitigates a long-standing crash on Windows 10 with older JVMs.
    jvm.push('-XX:HeapDumpPath=MojangTricksIntelDriversForPerformance_javaw.exe_minecraft.exe.heapdump')
  }

  jvm.push(...filterUserJvmArgs(splitJvmArgs(instance.java.jvmArgs)))

  jvm.push(`-Dminecraft.launcher.brand=${LAUNCHER_NAME.toLowerCase()}`)
  jvm.push(`-Dminecraft.launcher.version=${LAUNCHER_VERSION}`)

  // log4j config, when the version ships one.
  const logging = version.logging?.client
  if (logging?.argument && logging.file?.id) {
    const configPath = join(assetsRoot(), 'log_configs', logging.file.id)
    jvm.push(substitute(logging.argument.replace('${path}', configPath), table))
  }

  if (version.arguments?.jvm && version.arguments.jvm.length > 0) {
    jvm.push(...expandArguments(version.arguments.jvm, features, table))
    keepClientJarOffTheModulePath(jvm, version, context.versionId)
  } else {
    // Pre-1.13 versions have no jvm argument list; these are its equivalents.
    jvm.push(`-Djava.library.path=${context.nativesDir}`)
    jvm.push('-cp', context.classpath.join(delimiter))
  }

  const game: string[] = []
  if (version.arguments?.game && version.arguments.game.length > 0) {
    game.push(...expandArguments(version.arguments.game, features, table))
  } else if (version.minecraftArguments) {
    game.push(...version.minecraftArguments.split(/\s+/).map((token) => substitute(token, table)))
  }

  // Window sizing. Modern versions accept these through the feature rules
  // above; adding them unconditionally is harmless and covers older ones.
  if (!instance.window.fullscreen) {
    if (!game.includes('--width')) game.push('--width', String(instance.window.width))
    if (!game.includes('--height')) game.push('--height', String(instance.window.height))
  } else if (!game.includes('--fullscreen')) {
    game.push('--fullscreen')
  }

  // Direct server join. Versions from 1.20 understand --quickPlayMultiplayer;
  // older ones need the legacy --server/--port pair.
  if (context.quickPlayServer && !game.includes('--quickPlayMultiplayer')) {
    const supportsQuickPlay = (version.arguments?.game ?? []).some(
      (entry) => typeof entry !== 'string' && JSON.stringify(entry.value).includes('quickPlayMultiplayer')
    )
    if (supportsQuickPlay) {
      game.push('--quickPlayMultiplayer', context.quickPlayServer)
    } else {
      const [host, port] = splitAddress(context.quickPlayServer)
      game.push('--server', host, '--port', String(port))
    }
  }

  const args = [...jvm, version.mainClass, ...game]
  const safeArgs = args.map((arg) =>
    context.accessToken && arg.includes(context.accessToken) ? arg.replace(context.accessToken, '[redacted]') : arg
  )

  return { args, safeArgs, mainClass: version.mainClass }
}

export function splitAddress(address: string): [string, number] {
  const trimmed = address.trim()
  // IPv6 literals are written [::1]:25565
  const bracketed = trimmed.match(/^\[([^\]]+)\](?::(\d+))?$/)
  if (bracketed) return [bracketed[1], bracketed[2] ? Number(bracketed[2]) : 25565]

  // Only a host with no colons of its own can be carrying a :port suffix —
  // otherwise this is a bare IPv6 literal and the last group is not a port.
  const index = trimmed.lastIndexOf(':')
  if (index > 0 && !trimmed.slice(0, index).includes(':')) {
    const port = Number(trimmed.slice(index + 1))
    if (Number.isInteger(port) && port > 0 && port <= 65535) return [trimmed.slice(0, index), port]
  }
  return [trimmed, 25565]
}
