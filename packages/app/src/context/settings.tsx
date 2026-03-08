import { createContext, useContext, createSignal, onMount, type JSX } from "solid-js"
import { createStore, reconcile, unwrap } from "solid-js/store"
import { commands } from "@zulip/desktop/bindings"
import type { DesktopSettings, DesktopCapabilities } from "@zulip/desktop/bindings"
import {
  buildServerSettingsPatch,
  mergeServerSettings,
  ZULIP_SYNCED_KEYS,
} from "./settings-sync"

// ── Settings shape with defaults ────────────────────────────────────

export interface AppSettings {
  // Local-only (persist to disk only)
  theme: string
  fontSize: string
  homeView: string
  animateImages: string
  language: string
  startAtLogin: boolean
  startMinimized: boolean
  showTray: boolean
  quitOnClose: boolean
  autoUpdate: boolean
  betaUpdates: boolean
  spellcheck: boolean
  customCSS: string
  downloadLocation: string
  useSystemProxy: boolean
  manualProxy: boolean
  pacUrl: string
  proxyRules: string
  bypassRules: string

  // Zulip server-synced (persist to disk + PATCH /api/v1/settings)
  enterSends: boolean
  timeFormat24h: boolean
  sendTyping: boolean
  sendReadReceipts: boolean
  showAvailability: boolean
  emailVisibility: string
  desktopNotifs: boolean
  notifSound: boolean
  muteAllSounds: boolean
  dmNotifs: boolean
  mentionNotifs: boolean
  channelNotifs: boolean
  followedTopics: boolean
  wildcardMentions: string
}

const DEFAULTS: AppSettings = {
  // Local
  theme: "foundry",
  fontSize: "normal",
  homeView: "inbox",
  animateImages: "always",
  language: "en",
  startAtLogin: false,
  startMinimized: false,
  showTray: true,
  quitOnClose: false,
  autoUpdate: true,
  betaUpdates: false,
  spellcheck: true,
  customCSS: "",
  downloadLocation: "",
  useSystemProxy: true,
  manualProxy: false,
  pacUrl: "",
  proxyRules: "",
  bypassRules: "",

  // Zulip-synced
  enterSends: true,
  timeFormat24h: false,
  sendTyping: true,
  sendReadReceipts: true,
  showAvailability: true,
  emailVisibility: "admins",
  desktopNotifs: true,
  notifSound: true,
  muteAllSounds: false,
  dmNotifs: true,
  mentionNotifs: true,
  channelNotifs: false,
  followedTopics: true,
  wildcardMentions: "default",
}

// ── Desktop-synced keys ──────────────────────────────────────────────

const DESKTOP_SYNCED_KEYS = new Set<keyof AppSettings>([
  "startAtLogin", "startMinimized", "showTray", "quitOnClose",
  "autoUpdate", "betaUpdates", "spellcheck", "customCSS",
  "downloadLocation", "useSystemProxy", "manualProxy",
  "pacUrl", "proxyRules", "bypassRules",
])

// ── Context type ────────────────────────────────────────────────────

export interface SettingsContextValue {
  store: AppSettings
  setSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void
  loaded: () => boolean
  capabilities: () => DesktopCapabilities | null
}

const SETTINGS_KEY = "app_settings"

const SettingsContext = createContext<SettingsContextValue>()

// ── Provider ────────────────────────────────────────────────────────

export function SettingsProvider(props: { orgId: string; children: JSX.Element }) {
  const [store, setStore] = createStore<AppSettings>({ ...DEFAULTS })
  const [loaded, setLoaded] = createSignal(false)
  const [caps, setCaps] = createSignal<DesktopCapabilities | null>(null)
  let persistTimer: ReturnType<typeof setTimeout> | undefined
  let desktopSyncTimer: ReturnType<typeof setTimeout> | undefined

  // Load settings from persistent store on mount, then merge server + desktop settings
  onMount(async () => {
    // Step 1: Load locally persisted settings
    try {
      const result = await commands.getConfig(SETTINGS_KEY)
      if (result.status === "ok" && result.data) {
        const saved: Partial<AppSettings> = JSON.parse(result.data)
        setStore(reconcile({ ...DEFAULTS, ...saved }))
      }
    } catch {
      // Use defaults if loading fails
    }

    // Step 2: Load native desktop settings (take precedence for platform keys)
    try {
      const dsResult = await commands.getDesktopSettings()
      if (dsResult.status === "ok") {
        const ds = dsResult.data
        setStore("startAtLogin", ds.start_at_login)
        setStore("startMinimized", ds.start_minimized)
        setStore("showTray", ds.show_tray)
        setStore("quitOnClose", ds.quit_on_close)
        setStore("autoUpdate", ds.auto_update)
        setStore("betaUpdates", ds.beta_updates)
        setStore("spellcheck", ds.spellcheck)
        setStore("customCSS", ds.custom_css)
        setStore("downloadLocation", ds.download_location)
        setStore("useSystemProxy", ds.use_system_proxy)
        setStore("manualProxy", ds.manual_proxy)
        setStore("pacUrl", ds.pac_url)
        setStore("proxyRules", ds.proxy_rules)
        setStore("bypassRules", ds.bypass_rules)
      }
    } catch {
      // Non-critical — local settings are fine
    }

    // Step 3: Load desktop capabilities for feature gating
    try {
      setCaps(await commands.getDesktopCapabilities())
    } catch {
      // Non-critical
    }

    setLoaded(true)

    // Step 4: Fetch server settings and merge Zulip-synced keys
    // (runs after UI is visible — non-blocking)
    try {
      const result = await commands.getZulipSettings(props.orgId)
      if (result.status === "ok" && result.data) {
        const serverData = JSON.parse(result.data)
        setStore(reconcile(mergeServerSettings({ ...unwrap(store) }, serverData)))
        // Persist merged settings locally
        schedulePersist()
      }
    } catch {
      // Server fetch failure is non-critical — local settings are fine
    }
  })

  /** Update a single setting: reactive store + disk + optional API sync */
  const setSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setStore(key as any, value as any)

    // Debounced local persistence (500 ms)
    schedulePersist()

    // If this key should sync to the Zulip server, fire-and-forget
    if (ZULIP_SYNCED_KEYS.has(key)) {
      syncToZulip(key, value)
    }

    // If this key is a desktop platform setting, sync to native contract
    if (DESKTOP_SYNCED_KEYS.has(key)) {
      scheduleDesktopSync()
    }
  }

  const schedulePersist = () => {
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(async () => {
      try {
        const data = JSON.stringify(unwrap(store))
        await commands.setConfig(SETTINGS_KEY, data)
      } catch {
        // Non-critical — settings will re-default on next load
      }
    }, 500)
  }

  const syncToZulip = async (key: keyof AppSettings, value: unknown) => {
    try {
      const patch = buildServerSettingsPatch(key, value as never)
      if (!patch) return
      const settings = JSON.stringify(patch)

      await commands.updateZulipSettings(props.orgId, settings)
    } catch {
      // API sync failure is non-critical
    }
  }

  /** Debounced sync of desktop settings to native contract (250ms) */
  const scheduleDesktopSync = () => {
    if (desktopSyncTimer) clearTimeout(desktopSyncTimer)
    desktopSyncTimer = setTimeout(async () => {
      try {
        const ds: DesktopSettings = {
          start_at_login: store.startAtLogin,
          start_minimized: store.startMinimized,
          show_tray: store.showTray,
          quit_on_close: store.quitOnClose,
          auto_update: store.autoUpdate,
          beta_updates: store.betaUpdates,
          spellcheck: store.spellcheck,
          custom_css: store.customCSS,
          download_location: store.downloadLocation,
          use_system_proxy: store.useSystemProxy,
          manual_proxy: store.manualProxy,
          pac_url: store.pacUrl,
          proxy_rules: store.proxyRules,
          bypass_rules: store.bypassRules,
        }
        await commands.setDesktopSettings(ds)
      } catch {
        // Non-critical — native settings sync failure
      }
    }, 250)
  }

  const ctx: SettingsContextValue = {
    get store() { return store },
    setSetting,
    loaded,
    capabilities: caps,
  }

  return (
    <SettingsContext.Provider value={ctx}>
      {props.children}
    </SettingsContext.Provider>
  )
}

// ── Hook ────────────────────────────────────────────────────────────

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider")
  return ctx
}
