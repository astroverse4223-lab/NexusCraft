import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BrowserWindow } from 'electron'
import type { GameLogLine, LaunchStage, LaunchState } from '@shared/types'
import { emit, toast } from '../../core/events'
import { LauncherError } from '../../core/errors'
import { createLogger, redact } from '../../core/logger'
import { getSettings } from '../settings/settingsService'
import { getActiveAccount, getValidMinecraftToken } from '../auth/accountService'
import { ensureInstanceLayout, getInstance, recordPlaySession, updateInstance } from '../instances/instanceService'
import { installLoader, loaderProfileInstalled } from '../loaders/loaderService'
import {
  buildClasspath,
  ensureNativesExtracted,
  installVersion,
  nativesDir,
  resolveVersion,
  verifyInstallation
} from '../minecraft/versionService'
import { buildLaunchArguments } from '../minecraft/argumentBuilder'
import { preferWindowless, resolveJavaForVersion } from '../java/javaService'
import { createTask } from '../downloads/downloadManager'
import { analyseMods } from '../mods/modService'

const log = createLogger('launch')

interface RunningGame {
  instanceId: string
  child: ChildProcess
  startedAt: number
  /** Ring buffer of recent output for the log viewer. */
  logs: GameLogLine[]
  crashHints: string[]
}

const running = new Map<string, RunningGame>()
const states = new Map<string, LaunchState>()

const MAX_LOG_LINES = 2000

function setState(instanceId: string, stage: LaunchStage, message: string, extra: Partial<LaunchState> = {}): void {
  const state: LaunchState = {
    instanceId,
    stage,
    message,
    pid: null,
    startedAt: null,
    exitCode: null,
    crashReport: null,
    ...states.get(instanceId),
    ...extra
  }
  state.stage = stage
  state.message = message
  states.set(instanceId, state)
  emit('launch:state', state)
}

export function launchStates(): LaunchState[] {
  return [...states.values()]
}

export function isRunning(instanceId: string): boolean {
  return running.has(instanceId)
}

export function recentLogs(instanceId: string, limit = 500): GameLogLine[] {
  const game = running.get(instanceId)
  if (game) return game.logs.slice(-limit)
  return (lastLogs.get(instanceId) ?? []).slice(-limit)
}

/** Kept after exit so the user can still read why the game closed. */
const lastLogs = new Map<string, GameLogLine[]>()

function pushLog(game: RunningGame, stream: GameLogLine['stream'], text: string): void {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd()
    if (!line) continue
    const entry: GameLogLine = { instanceId: game.instanceId, stream, line: redact(line), at: Date.now() }
    game.logs.push(entry)
    if (game.logs.length > MAX_LOG_LINES) game.logs.shift()

    // Collect the lines that usually explain a crash.
    if (/Exception|Error|Caused by:|FATAL|Mixin apply failed|incompatible/i.test(line) && game.crashHints.length < 40) {
      game.crashHints.push(line)
    }
    emit('launch:log', entry)
  }
}

/* ------------------------------------------------------------- launching */

export interface LaunchOptions {
  instanceId: string
  /** "host:port" to join immediately. */
  serverAddress?: string | null
}

export async function launchInstance(options: LaunchOptions): Promise<LaunchState> {
  const { instanceId } = options

  if (running.has(instanceId)) {
    throw new LauncherError('ALREADY_RUNNING', `instance ${instanceId} already has a running process`)
  }

  const settings = getSettings()
  const instance = getInstance(instanceId)

  setState(instanceId, 'preparing', 'Preparing your instance', { exitCode: null, crashReport: null })
  await ensureInstanceLayout(instance)

  const account = getActiveAccount()
  if (!account) {
    throw new LauncherError('TOKEN_EXPIRED', 'no active account', {
      title: 'Sign in to play',
      message: 'Minecraft: Java Edition needs a signed-in Microsoft account that owns the game.',
      actions: ['Press "Sign in with Microsoft" on the Account screen']
    })
  }
  if (!account.ownsMinecraft) {
    throw new LauncherError('NO_MINECRAFT_ENTITLEMENT', 'active account has no entitlement')
  }

  const task = createTask({ instanceId, concurrency: settings.maxConcurrentDownloads, label: 'Preparing' })

  try {
    /* 1. resolve the version to launch, installing the loader if needed */
    let versionId = instance.resolvedVersionId
    if (!versionId || !(await loaderProfileInstalled(versionId))) {
      if (instance.loader === 'vanilla') {
        versionId = instance.minecraftVersion
      } else {
        setState(instanceId, 'downloading', 'Installing the mod loader')
        versionId = await installLoader(instance.loader, instance.minecraftVersion, instance.loaderVersion, task)
      }
      updateInstance(instanceId, { resolvedVersionId: versionId })
    }

    /* 2. verify, then download whatever is missing */
    setState(instanceId, 'verifying', 'Checking game files')
    let version = await resolveVersion(versionId)
    const check = await verifyInstallation(versionId).catch(() => ({ missing: ['everything'], version }))

    if (check.missing.length > 0 || !instance.installed) {
      setState(instanceId, 'downloading', 'Downloading game files')
      version = await installVersion(versionId, { task })
      updateInstance(instanceId, { installed: true })
    }

    /* 3. mods that would certainly crash the game */
    if (instance.loader !== 'vanilla') {
      const analysis = await analyseMods(instance)
      const blocking = analysis.filter((mod) =>
        mod.enabled && mod.issues.some((issue) => issue.severity === 'error' && issue.code !== 'unreadable')
      )
      if (blocking.length > 0) {
        const names = blocking.slice(0, 5).map((m) => m.fileName).join(', ')
        throw new LauncherError(
          'MOD_CONFLICT',
          blocking.map((m) => `${m.fileName}: ${m.issues.map((i) => i.message).join('; ')}`).join('\n'),
          {
            title: `${blocking.length} mod${blocking.length === 1 ? '' : 's'} would crash this instance`,
            message: `These mods do not match this instance and Minecraft would fail on startup: ${names}${blocking.length > 5 ? ', …' : ''}`,
            actions: [
              'Open the Mods screen to see what is wrong with each one',
              'Disable or remove the flagged mods',
              'Then press Play again'
            ]
          }
        )
      }
    }

    /* 4. Java */
    setState(instanceId, 'resolving-java', 'Selecting a Java runtime')
    const java = await resolveJavaForVersion(version, instance.java.javaPath, settings.javaPath, task)

    /* 5. arguments */
    setState(instanceId, 'building-args', 'Building launch options')
    await ensureNativesExtracted(versionId, version)
    const classpath = buildClasspath(versionId, version)
    if (classpath.length === 0) {
      throw new LauncherError('MISSING_LIBRARIES', 'classpath resolved to nothing')
    }
    const missingLibraries = classpath.filter((entry) => !existsSync(entry))
    if (missingLibraries.length > 0) {
      throw new LauncherError('MISSING_LIBRARIES', `missing: ${missingLibraries.slice(0, 8).join(', ')}`)
    }

    const accessToken = await getValidMinecraftToken(account.id)

    const built = buildLaunchArguments({
      instance,
      version,
      versionId,
      classpath,
      nativesDir: nativesDir(versionId),
      accessToken,
      username: account.username,
      uuid: account.id,
      xuid: account.xuid ?? '',
      clientId: settings.clientId,
      quickPlayServer: options.serverAddress ?? null
    })

    // Written for support purposes with the token already stripped.
    await writeFile(
      join(instance.gameDir, 'logs', 'nexuscraft-last-launch.txt'),
      [`java: ${java.path}`, `version: ${versionId}`, '', ...built.safeArgs].join('\n'),
      'utf8'
    ).catch(() => undefined)

    /* 6. start the process */
    setState(instanceId, 'starting', 'Starting Minecraft')
    const executable = preferWindowless(java.path)
    log.info(`launching ${instance.name} (${versionId}) with ${executable}`)

    const child = spawn(executable, built.args, {
      cwd: instance.gameDir,
      // A detached child keeps running if the launcher is closed, and lets the
      // launcher stay fully responsive while the game runs.
      detached: false,
      windowsHide: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, APPDATA: process.env.APPDATA }
    })

    const game: RunningGame = { instanceId, child, startedAt: Date.now(), logs: [], crashHints: [] }
    running.set(instanceId, game)

    child.stdout?.on('data', (chunk: Buffer) => pushLog(game, 'stdout', chunk.toString('utf8')))
    child.stderr?.on('data', (chunk: Buffer) => pushLog(game, 'stderr', chunk.toString('utf8')))

    child.on('error', (err) => {
      running.delete(instanceId)
      log.error('failed to start the game process', err)
      setState(instanceId, 'error', 'Minecraft could not be started', { pid: null })
      toast('error', 'Minecraft could not be started', (err as Error).message)
    })

    child.on('exit', (code, signal) => handleExit(game, code, signal))

    pushLog(game, 'launcher', `Started ${instance.name} (${versionId}) — pid ${child.pid}`)
    setState(instanceId, 'running', 'Minecraft is running', { pid: child.pid ?? null, startedAt: game.startedAt })
    task.markDone()

    if (settings.closeLauncherOnLaunch) {
      for (const window of BrowserWindow.getAllWindows()) window.minimize()
    }

    return states.get(instanceId) as LaunchState
  } catch (err) {
    task.cancel()
    const message = err instanceof LauncherError ? err.message : 'Launch failed'
    setState(instanceId, 'error', message)
    throw err
  }
}

function handleExit(game: RunningGame, code: number | null, signal: NodeJS.Signals | null): void {
  const { instanceId } = game
  running.delete(instanceId)
  lastLogs.set(instanceId, game.logs)

  const duration = Date.now() - game.startedAt
  recordPlaySession(instanceId, duration)

  const clean = code === 0 || signal === 'SIGTERM' || signal === 'SIGKILL'
  const crashReport = clean ? null : game.crashHints.slice(0, 12).join('\n') || null

  log.info(`instance ${instanceId} exited with code ${code ?? 'null'} signal ${signal ?? 'none'}`)
  pushLog(game, 'launcher', `Minecraft exited with code ${code ?? 'unknown'}`)

  setState(instanceId, 'exited', clean ? 'Minecraft closed' : 'Minecraft closed unexpectedly', {
    pid: null,
    exitCode: code,
    crashReport
  })

  const settings = getSettings()
  if (settings.restoreOnGameExit) {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed()) continue
      if (window.isMinimized()) window.restore()
      window.show()
      // focus() alone is unreliable on Windows when another app had focus.
      window.moveTop()
      window.focus()
    }
  }

  if (!clean) {
    toast('error', 'Minecraft closed unexpectedly', `Exit code ${code ?? 'unknown'}. Open the log for details.`)
  }
}

/** Asks the game to close, escalating to a hard kill if it ignores us. */
export function stopInstance(instanceId: string): void {
  const game = running.get(instanceId)
  if (!game) return

  log.info(`stopping instance ${instanceId}`)
  game.child.kill('SIGTERM')

  setTimeout(() => {
    if (running.has(instanceId)) {
      log.warn(`instance ${instanceId} ignored SIGTERM; killing`)
      game.child.kill('SIGKILL')
    }
  }, 5000)
}

export function stopAll(): void {
  for (const instanceId of [...running.keys()]) stopInstance(instanceId)
}

export function runningInstanceIds(): string[] {
  return [...running.keys()]
}
