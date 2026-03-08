import { type JSX } from "solid-js";
/**
 * Platform abstraction interface.
 * Enables the same app code to run on desktop (Tauri) and web.
 * Matching Open Code's packages/app/src/context/platform.tsx
 */
export interface Platform {
    platform: "desktop" | "web";
    os?: "macos" | "windows" | "linux";
    version?: string;
    openLink(url: string): void;
    back(): void;
    forward(): void;
    restart(): Promise<void>;
    openDirectoryPickerDialog?(opts?: {
        title?: string;
        multiple?: boolean;
    }): Promise<string | string[] | null>;
    openFilePickerDialog?(opts?: {
        title?: string;
        multiple?: boolean;
    }): Promise<string | string[] | null>;
    notify(title: string, description?: string, href?: string): Promise<void>;
    storage?(name?: string): AsyncStorageWithFlush;
    fetch?: typeof fetch;
    checkUpdate?(): Promise<{
        updateAvailable: boolean;
        version?: string;
    }>;
    update?(): Promise<void>;
}
export interface AsyncStorageWithFlush {
    getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): Promise<void>;
    removeItem(key: string): Promise<void>;
    clear(): Promise<void>;
    key(index: number): Promise<string | undefined>;
    getLength(): Promise<number>;
    flush(): Promise<void>;
}
export declare function PlatformProvider(props: {
    value: Platform;
    children: JSX.Element;
}): JSX.Element;
export declare function usePlatform(): Platform;
//# sourceMappingURL=platform.d.ts.map