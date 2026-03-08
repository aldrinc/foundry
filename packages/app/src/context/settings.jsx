import { createContext, useContext, createSignal, onMount } from "solid-js";
import { createStore, reconcile, unwrap } from "solid-js/store";
import { commands } from "@zulip/desktop/bindings";
import { buildServerSettingsPatch, mergeServerSettings, ZULIP_SYNCED_KEYS, } from "./settings-sync";
const DEFAULTS = {
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
};
const SETTINGS_KEY = "app_settings";
const SettingsContext = createContext();
// ── Provider ────────────────────────────────────────────────────────
export function SettingsProvider(props) {
    const [store, setStore] = createStore({ ...DEFAULTS });
    const [loaded, setLoaded] = createSignal(false);
    let persistTimer;
    // Load settings from persistent store on mount, then merge server settings
    onMount(async () => {
        // Step 1: Load locally persisted settings
        try {
            const result = await commands.getConfig(SETTINGS_KEY);
            if (result.status === "ok" && result.data) {
                const saved = JSON.parse(result.data);
                setStore(reconcile({ ...DEFAULTS, ...saved }));
            }
        }
        catch {
            // Use defaults if loading fails
        }
        setLoaded(true);
        // Step 2: Fetch server settings and merge Zulip-synced keys
        // (runs after UI is visible — non-blocking)
        try {
            const result = await commands.getZulipSettings(props.orgId);
            if (result.status === "ok" && result.data) {
                const serverData = JSON.parse(result.data);
                setStore(reconcile(mergeServerSettings({ ...unwrap(store) }, serverData)));
                // Persist merged settings locally
                schedulePersist();
            }
        }
        catch {
            // Server fetch failure is non-critical — local settings are fine
        }
    });
    /** Update a single setting: reactive store + disk + optional API sync */
    const setSetting = (key, value) => {
        setStore(key, value);
        // Debounced local persistence (500 ms)
        schedulePersist();
        // If this key should sync to the Zulip server, fire-and-forget
        if (ZULIP_SYNCED_KEYS.has(key)) {
            syncToZulip(key, value);
        }
    };
    const schedulePersist = () => {
        if (persistTimer)
            clearTimeout(persistTimer);
        persistTimer = setTimeout(async () => {
            try {
                const data = JSON.stringify(unwrap(store));
                await commands.setConfig(SETTINGS_KEY, data);
            }
            catch {
                // Non-critical — settings will re-default on next load
            }
        }, 500);
    };
    const syncToZulip = async (key, value) => {
        try {
            const patch = buildServerSettingsPatch(key, value);
            if (!patch)
                return;
            const settings = JSON.stringify(patch);
            await commands.updateZulipSettings(props.orgId, settings);
        }
        catch {
            // API sync failure is non-critical
        }
    };
    const ctx = {
        get store() { return store; },
        setSetting,
        loaded,
    };
    return (<SettingsContext.Provider value={ctx}>
      {props.children}
    </SettingsContext.Provider>);
}
// ── Hook ────────────────────────────────────────────────────────────
export function useSettings() {
    const ctx = useContext(SettingsContext);
    if (!ctx)
        throw new Error("useSettings must be used within SettingsProvider");
    return ctx;
}
