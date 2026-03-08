import { createContext, useContext, createSignal, onMount, type JSX } from "solid-js"
import { createStore, reconcile, unwrap } from "solid-js/store"
import { commands } from "@zulip/desktop/bindings"
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
  theme: "system",
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

// ── Context type ────────────────────────────────────────────────────

export interface SettingsContextValue {
  store: AppSettings
  setSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void
  loaded: () => boolean
}

const SETTINGS_KEY = "app_settings"

const SettingsContext = createContext<SettingsContextValue>()

// ── Provider ────────────────────────────────────────────────────────

export function SettingsProvider(props: { orgId: string; children: JSX.Element }) {
  const [store, setStore] = createStore<AppSettings>({ ...DEFAULTS })
  const [loaded, setLoaded] = createSignal(false)
  let persistTimer: ReturnType<typeof setTimeout> | undefined

  // Load settings from persistent store on mount, then merge server settings
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
    setLoaded(true)

    // Step 2: Fetch server settings and merge Zulip-synced keys
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

  const ctx: SettingsContextValue = {
    get store() { return store },
    setSetting,
    loaded,
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
