import { create } from 'zustand'
import type {
  Account,
  AppSettings,
  AuthProgress,
  DeviceCodePrompt,
  DownloadProgress,
  GameLogLine,
  Instance,
  LauncherErrorPayload,
  LaunchState,
  ServerStatus
} from '@shared/types'
import { api, subscribe, toPayload, type AppInfo } from '../api'

export type Route =
  | 'home'
  | 'play'
  | 'instances'
  | 'versions'
  | 'mods'
  | 'servers'
  | 'host'
  | 'worlds'
  | 'skins'
  | 'settings'
  | 'account'
  | 'companion'

export interface ToastItem {
  id: number
  kind: 'info' | 'success' | 'warning' | 'error'
  title: string
  message?: string
}

interface State {
  /* bootstrapping */
  ready: boolean
  bootError: LauncherErrorPayload | null
  info: AppInfo | null

  /* navigation */
  route: Route
  /** Instance whose detail screens (mods/worlds) are being viewed. */
  focusedInstanceId: string | null

  /* data */
  settings: AppSettings | null
  accounts: Account[]
  instances: Instance[]

  /* live state */
  authProgress: AuthProgress
  deviceCode: DeviceCodePrompt | null
  signingIn: boolean
  downloads: Record<string, DownloadProgress>
  launches: Record<string, LaunchState>
  serverStatuses: Record<string, ServerStatus>
  logs: GameLogLine[]
  toasts: ToastItem[]

  /* modal error surface */
  errorModal: LauncherErrorPayload | null

  /* actions */
  boot: () => Promise<void>
  navigate: (route: Route, instanceId?: string | null) => void
  refreshAccounts: () => Promise<void>
  refreshInstances: () => Promise<void>
  refreshSettings: () => Promise<void>
  patchSettings: (patch: Partial<AppSettings>) => Promise<void>
  selectInstance: (id: string | null) => Promise<void>
  pushToast: (toast: Omit<ToastItem, 'id'>) => void
  dismissToast: (id: number) => void
  showError: (err: unknown) => void
  dismissError: () => void
  setSigningIn: (value: boolean) => void
}

let toastCounter = 0

export const useStore = create<State>((set, get) => ({
  ready: false,
  bootError: null,
  info: null,

  route: 'home',
  focusedInstanceId: null,

  settings: null,
  accounts: [],
  instances: [],

  authProgress: { stage: 'idle', message: '' },
  deviceCode: null,
  signingIn: false,
  downloads: {},
  launches: {},
  serverStatuses: {},
  logs: [],
  toasts: [],

  errorModal: null,

  async boot() {
    try {
      const [info, settings, accounts, instances, launches, downloads] = await Promise.all([
        api.app.info(),
        api.settings.get(),
        api.auth.list(),
        api.instances.list(),
        api.launch.states(),
        api.downloads.state()
      ])

      set({
        info,
        settings,
        accounts,
        instances,
        launches: Object.fromEntries(launches.map((l) => [l.instanceId, l])),
        downloads: Object.fromEntries(downloads.map((d) => [d.taskId, d])),
        ready: true,
        // A signed-in user with at least one instance goes straight to Play.
        route: settings.onboardingComplete ? 'play' : 'home'
      })

      applyAccent(settings.accentColor)
      attachEventListeners()
    } catch (err) {
      set({ bootError: toPayload(err), ready: true })
    }
  },

  navigate(route, instanceId) {
    set((state) => ({
      route,
      focusedInstanceId: instanceId === undefined ? state.focusedInstanceId : instanceId
    }))
  },

  async refreshAccounts() {
    try {
      set({ accounts: await api.auth.list() })
    } catch (err) {
      get().showError(err)
    }
  },

  async refreshInstances() {
    try {
      set({ instances: await api.instances.list() })
    } catch (err) {
      get().showError(err)
    }
  },

  async refreshSettings() {
    try {
      const settings = await api.settings.get()
      set({ settings })
      applyAccent(settings.accentColor)
    } catch (err) {
      get().showError(err)
    }
  },

  async patchSettings(patch) {
    try {
      const settings = await api.settings.update(patch)
      set({ settings })
      if (patch.accentColor) applyAccent(settings.accentColor)
    } catch (err) {
      get().showError(err)
    }
  },

  async selectInstance(id) {
    await get().patchSettings({ selectedInstanceId: id })
  },

  pushToast(toast) {
    const id = ++toastCounter
    set((state) => ({ toasts: [...state.toasts, { ...toast, id }] }))
    // Errors stay until dismissed; everything else clears itself.
    if (toast.kind !== 'error') {
      setTimeout(() => get().dismissToast(id), 4800)
    } else {
      setTimeout(() => get().dismissToast(id), 9000)
    }
  },

  dismissToast(id) {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }))
  },

  showError(err) {
    set({ errorModal: toPayload(err) })
  },

  dismissError() {
    set({ errorModal: null })
  },

  setSigningIn(value) {
    set({ signingIn: value, deviceCode: value ? get().deviceCode : null })
  }
}))

/** Writes the accent colour into the CSS custom properties the theme reads. */
export function applyAccent(color: string): void {
  const root = document.documentElement
  root.style.setProperty('--accent', color)
  root.style.setProperty('--accent-dim', hexToRgba(color, 0.16))
  root.style.setProperty('--accent-glow', hexToRgba(color, 0.35))
}

function hexToRgba(hex: string, alpha: number): string {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim())
  if (!match) return `rgba(94, 234, 212, ${alpha})`
  const [, r, g, b] = match
  return `rgba(${parseInt(r, 16)}, ${parseInt(g, 16)}, ${parseInt(b, 16)}, ${alpha})`
}

let listenersAttached = false

/** Wires the main-process event stream into the store exactly once. */
function attachEventListeners(): void {
  if (listenersAttached) return
  listenersAttached = true

  const set = useStore.setState
  const get = useStore.getState

  subscribe('auth:progress', (progress: AuthProgress) => {
    set({ authProgress: progress })
    if (progress.stage === 'done' || progress.stage === 'error' || progress.stage === 'idle') {
      set({ signingIn: false, deviceCode: null })
    }
  })

  subscribe('auth:device-code', (prompt: DeviceCodePrompt) => set({ deviceCode: prompt }))

  subscribe('auth:accounts-changed', (accounts: Account[]) => set({ accounts }))

  subscribe('instances:changed', (instances: Instance[]) => set({ instances }))

  subscribe('settings:changed', (settings: AppSettings) => {
    set({ settings })
    applyAccent(settings.accentColor)
  })

  subscribe('download:progress', (progress: DownloadProgress) => {
    set((state) => {
      const next = { ...state.downloads, [progress.taskId]: progress }
      // Drop finished tasks so the UI does not accumulate stale bars.
      if (!progress.active && (progress.phase === 'done' || progress.phase === 'cancelled')) {
        delete next[progress.taskId]
      }
      return { downloads: next }
    })
  })

  subscribe('launch:state', (state: LaunchState) => {
    set((prev) => ({ launches: { ...prev.launches, [state.instanceId]: state } }))
  })

  subscribe('launch:log', (line: GameLogLine) => {
    set((prev) => {
      const logs = [...prev.logs, line]
      // Bounded so a chatty modpack cannot grow the renderer's memory forever.
      return { logs: logs.length > 1200 ? logs.slice(-1000) : logs }
    })
  })

  subscribe('servers:status', (status: ServerStatus) => {
    set((prev) => ({ serverStatuses: { ...prev.serverStatuses, [status.serverId]: status } }))
  })

  subscribe('toast', (toast: { kind: ToastItem['kind']; title: string; message?: string }) => {
    get().pushToast(toast)
  })
}

/* ------------------------------------------------------------- selectors */

export function activeAccount(state: State): Account | null {
  return state.accounts.find((a) => a.isActive) ?? state.accounts[0] ?? null
}

export function selectedInstance(state: State): Instance | null {
  const id = state.settings?.selectedInstanceId
  if (id) {
    const found = state.instances.find((i) => i.id === id)
    if (found) return found
  }
  return state.instances[0] ?? null
}

export function focusedInstance(state: State): Instance | null {
  if (state.focusedInstanceId) {
    const found = state.instances.find((i) => i.id === state.focusedInstanceId)
    if (found) return found
  }
  return selectedInstance(state)
}

export function activeDownload(state: State): DownloadProgress | null {
  const list = Object.values(state.downloads).filter((d) => d.active || d.paused || d.phase === 'error')
  return list[0] ?? null
}
