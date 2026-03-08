import { type JSX } from "solid-js";
export interface AppSettings {
    theme: string;
    fontSize: string;
    homeView: string;
    animateImages: string;
    language: string;
    startAtLogin: boolean;
    startMinimized: boolean;
    showTray: boolean;
    quitOnClose: boolean;
    autoUpdate: boolean;
    betaUpdates: boolean;
    spellcheck: boolean;
    customCSS: string;
    downloadLocation: string;
    useSystemProxy: boolean;
    manualProxy: boolean;
    pacUrl: string;
    proxyRules: string;
    bypassRules: string;
    enterSends: boolean;
    timeFormat24h: boolean;
    sendTyping: boolean;
    sendReadReceipts: boolean;
    showAvailability: boolean;
    emailVisibility: string;
    desktopNotifs: boolean;
    notifSound: boolean;
    muteAllSounds: boolean;
    dmNotifs: boolean;
    mentionNotifs: boolean;
    channelNotifs: boolean;
    followedTopics: boolean;
    wildcardMentions: string;
}
export interface SettingsContextValue {
    store: AppSettings;
    setSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
    loaded: () => boolean;
}
export declare function SettingsProvider(props: {
    orgId: string;
    children: JSX.Element;
}): JSX.Element;
export declare function useSettings(): SettingsContextValue;
//# sourceMappingURL=settings.d.ts.map