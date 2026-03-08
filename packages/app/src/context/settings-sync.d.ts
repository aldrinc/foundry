import type { AppSettings } from "./settings";
export declare const ZULIP_SYNCED_KEYS: Set<keyof AppSettings>;
export declare function mergeServerSettings(current: AppSettings, serverData: Record<string, unknown>): AppSettings;
export declare function buildServerSettingsPatch<K extends keyof AppSettings>(key: K, value: AppSettings[K]): Record<string, unknown> | null;
//# sourceMappingURL=settings-sync.d.ts.map