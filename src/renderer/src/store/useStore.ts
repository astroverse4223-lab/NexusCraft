import { type ResourcePackDraft, emptyDraft } from '@shared/resourcePacks'
import { create } from 'zustand'
import type { AdvancementPack } from '@shared/advancements'
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
  ModUpdate,
  ServerStatus
} from '@shared/types'
import type { BannerDesign } from '@shared/banners'
import type { FireworkDesign, ItemDesign, LogoDesign, MotdDesign, RecipePack, LootPack } from '@shared/creations'
import { api, subscribe, toPayload, type AppInfo } from '../api'

export type Route =
  | 'home'
  | 'play'
  | 'instances'
  | 'versions'
  | 'mods'
  | 'servers'
  | 'discover'
  | 'blueprints'
  | 'host'
  | 'worlds'
  | 'skins'
  | 'settings'
  | 'account'
  | 'companion'
  | 'generators'

/**
 * A mod update check, held outside the view that started it.
 *
 * Kept per instance because that is how the check is scoped, and because
 * somebody who starts one, switches instance to start another, and comes back
 * should find both of them where they left them.
 */
export interface ModUpdateCheck {
  checking: boolean
  updates: ModUpdate[] | null
  error: LauncherErrorPayload | null
  /** When the last finished check completed, for "checked 2m ago". */
  at: number | null
}

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
  modChecks: Record<string, ModUpdateCheck>
  sweeping: boolean
  sweepResult: string | null

  /*
   * What is on the drawing boards, kept out here rather than in the screens.
   *
   * Both are unmounted the moment another tab is opened, so anything held in a
   * component is gone by the time the user comes back - which is exactly what
   * happened: a banner someone had spent a while getting right vanished on a
   * trip to the Servers tab and came back as a plain white flag.
   */
  bannerDesign: BannerDesign | null
  bannerTitle: string
  bannerTagline: string
  /** The icon being edited, as raw RGBA. 64x64x4, or null before anything is drawn. */
  iconPixels: Uint8ClampedArray | null
  iconName: string

  /*
   * The Generators tab's five designs, and which one is open.
   *
   * Out here for the same reason as the banner: the screen is unmounted the
   * moment another tab is opened, so a design held in the component is gone by
   * the time anybody comes back to it. Null means "not designed yet", which the
   * screen turns into its own starting point.
   */
  genSection: string
  genPrompt: string
  genMotd: MotdDesign | null
  genLogo: LogoDesign | null
  genFirework: FireworkDesign | null
  genItem: ItemDesign | null
  genRecipes: RecipePack | null
  genLoot: LootPack | null
  genAdvancements: AdvancementPack | null

  /*
   * Map art, kept out here rather than in the tab.
   *
   * The tab unmounts the moment you look at anything else, and a converted
   * picture is a minute of somebody's work - losing it on a stray click is
   * the same complaint the generators had.
   */
  /*
   * The resource pack being put together.
   *
   * Out here for the same reason the map art is: the tab unmounts the moment
   * you look at anything else, and a pack with six panorama faces and a dozen
   * textures in it is a long evening's work to lose to a stray click.
   */
  resourcePack: ResourcePackDraft

  mapArt: {
    image: string | null
    across: number
    down: number
    dither: boolean
    commands: string[]
  }

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

  checkModUpdates: (instanceId: string) => Promise<void>
  checkAllModUpdates: () => Promise<void>
  removeModUpdate: (instanceId: string, fileName: string) => void
  dismissModCheckError: (instanceId: string) => void
  dismissSweepResult: () => void
  setBannerDesign: (design: BannerDesign | null) => void
  setBannerText: (patch: { title?: string; tagline?: string }) => void
  setIconPixels: (pixels: Uint8ClampedArray | null) => void
  setIconName: (name: string) => void
  setGenSection: (section: string) => void
  setGenPrompt: (prompt: string) => void
  setGenMotd: (design: MotdDesign) => void
  setGenLogo: (design: LogoDesign) => void
  setGenFirework: (design: FireworkDesign) => void
  setGenItem: (design: ItemDesign) => void
  setGenRecipes: (pack: RecipePack) => void
  setGenLoot: (pack: LootPack) => void
  setGenAdvancements: (pack: AdvancementPack) => void
  setMapArt: (next: Partial<State['mapArt']>) => void
  setResourcePack: (next: Partial<ResourcePackDraft>) => void
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
  modChecks: {},
  sweeping: false,
  sweepResult: null,
  bannerDesign: null,
  bannerTitle: '',
  bannerTagline: '',
  iconPixels: null,
  iconName: '',
  genSection: 'motd',
  genPrompt: '',
  genMotd: null,
  genLogo: null,
  genFirework: null,
  genItem: null,
  genRecipes: null,
  genLoot: null,
  genAdvancements: null,
  mapArt: { image: null, across: 1, down: 1, dither: true, commands: [] },
  resourcePack: emptyDraft(),
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

      applyTheme(settings.theme)
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
      applyTheme(settings.theme)
      applyAccent(settings.accentColor)
    } catch (err) {
      get().showError(err)
    }
  },

  async patchSettings(patch) {
    try {
      const settings = await api.settings.update(patch)
      set({ settings })
      if (patch.theme) applyTheme(settings.theme)
      if (patch.accentColor || patch.theme) applyAccent(settings.accentColor)
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

  /**
   * Starts a check and leaves the answer in the store.
   *
   * Nothing in here touches component state, which is the entire point: the
   * view that started it can unmount and remount freely, and the result lands
   * in the same place either way.
   */
  async checkModUpdates(instanceId: string) {
    const already = get().modChecks[instanceId]

    // Already running for this instance. Starting a second would double the
    // work and race the first one's result.
    if (already?.checking) return

    set((state) => ({
      modChecks: {
        ...state.modChecks,
        [instanceId]: {
          checking: true,
          updates: already?.updates ?? null,
          error: null,
          at: already?.at ?? null
        }
      }
    }))

    try {
      const updates = await api.mods.checkUpdates(instanceId)

      set((state) => ({
        modChecks: {
          ...state.modChecks,
          [instanceId]: { checking: false, updates, error: null, at: Date.now() }
        }
      }))

      /*
       * Said out loud, because the person who started this may be looking at
       * a different screen by now - which is exactly the case that was broken.
       */
      if (updates.length === 0) {
        get().pushToast({ kind: 'success', title: 'Everything is up to date' })
      } else {
        get().pushToast({
          kind: 'info',
          title: `${updates.length} update${updates.length === 1 ? '' : 's'} available`,
          message: 'Mods & packs, on the Installed tab.'
        })
      }
    } catch (err) {
      set((state) => ({
        modChecks: {
          ...state.modChecks,
          [instanceId]: {
            checking: false,
            updates: already?.updates ?? null,
            error: toPayload(err),
            at: null
          }
        }
      }))
    }
  },

  /** The same, for the sweep across every instance. */
  async checkAllModUpdates() {
    if (get().sweeping) return
    set({ sweeping: true, sweepResult: null })

    try {
      const sweep = await api.mods.checkAllNow()
      const skipped = sweep.skipped > 0 ? `, ${sweep.skipped} skipped while running` : ''

      set({
        sweepResult:
          sweep.found === 0
            ? `Everything is up to date across ${sweep.checked} instance${sweep.checked === 1 ? '' : 's'}${skipped}.`
            : `${sweep.found} update${sweep.found === 1 ? '' : 's'} found across ${sweep.checked} instances` +
              (sweep.installed > 0 ? `, ${sweep.installed} installed` : '') +
              (sweep.heldBack > 0 ? `, ${sweep.heldBack} held for review` : '') +
              `${skipped}.`
      })

      // This instance may well have been one of them.
      const focused = get().focusedInstanceId
      if (focused) await get().checkModUpdates(focused)
    } catch (err) {
      get().showError(err)
    } finally {
      set({ sweeping: false })
    }
  },

  /**
   * Drops one update from the list once it has been applied.
   *
   * Filtered in here rather than in the component, because updates are applied
   * one after another in a loop and every iteration of that loop would
   * otherwise be filtering the same list captured when the component rendered.
   */
  removeModUpdate(instanceId: string, fileName: string) {
    set((state) => {
      const current = state.modChecks[instanceId]
      if (!current?.updates) return {}

      return {
        modChecks: {
          ...state.modChecks,
          [instanceId]: {
            ...current,
            updates: current.updates.filter((u) => u.fileName !== fileName)
          }
        }
      }
    })
  },

  setBannerDesign(design) {
    set({ bannerDesign: design })
  },

  setBannerText(patch) {
    set((state) => ({
      bannerTitle: patch.title ?? state.bannerTitle,
      bannerTagline: patch.tagline ?? state.bannerTagline
    }))
  },

  setIconPixels(pixels) {
    set({ iconPixels: pixels })
  },

  setIconName(name) {
    set({ iconName: name })
  },

  setGenSection(section) {
    set({ genSection: section })
  },

  setGenPrompt(prompt) {
    set({ genPrompt: prompt })
  },

  setGenMotd(design) {
    set({ genMotd: design })
  },

  setGenLogo(design) {
    set({ genLogo: design })
  },

  setGenFirework(design) {
    set({ genFirework: design })
  },

  setGenItem(design) {
    set({ genItem: design })
  },

  setGenRecipes(pack) {
    set({ genRecipes: pack })
  },

  setGenLoot(pack) {
    set({ genLoot: pack })
  },

  setGenAdvancements(pack) {
    set({ genAdvancements: pack })
  },

  setMapArt(next) {
    set((state) => ({ mapArt: { ...state.mapArt, ...next } }))
  },

  setResourcePack(next) {
    set((state) => ({ resourcePack: { ...state.resourcePack, ...next } }))
  },

  dismissSweepResult() {
    set({ sweepResult: null })
  },

  dismissModCheckError(instanceId: string) {
    set((state) => {
      const current = state.modChecks[instanceId]
      if (!current) return {}
      return {
        modChecks: { ...state.modChecks, [instanceId]: { ...current, error: null } }
      }
    })
  },

  setSigningIn(value) {
    set({ signingIn: value, deviceCode: value ? get().deviceCode : null })
  }
}))

/** Writes the accent colour into the CSS custom properties the theme reads. */
/**
 * Puts the theme on the root element, where the stylesheet is watching for it.
 *
 * Only the name: every colour a theme changes is a token redefined under
 * `[data-theme]` in the stylesheet, so nothing here needs to know what any of
 * them are. The default theme has no attribute at all, so a fresh install and
 * a stylesheet with no themes in it look the same.
 */
export function applyTheme(theme: string): void {
  const root = document.documentElement

  if (!theme || theme === 'nexus') delete root.dataset.theme
  else root.dataset.theme = theme
}

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
