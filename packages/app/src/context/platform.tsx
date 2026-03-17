import { createContext, useContext, type JSX } from "solid-js"

/**
 * Platform abstraction interface.
 * Enables the same app code to run on desktop (Tauri) and web.
 * Matching Open Code's packages/app/src/context/platform.tsx
 */
export interface Platform {
  platform: "desktop" | "web"
  os?: "macos" | "windows" | "linux"
  version?: string
  tauriVersion?: string

  // Navigation
  openLink(url: string): void
  back(): void
  forward(): void
  restart(): Promise<void>

  // Native dialogs (desktop only)
  openDirectoryPickerDialog?(opts?: {
    title?: string
    multiple?: boolean
  }): Promise<string | string[] | null>
  openFilePickerDialog?(opts?: {
    title?: string
    multiple?: boolean
  }): Promise<string | string[] | null>
  onWindowDragDrop?(listener: (event: WindowDragDropEvent) => void | Promise<void>): Promise<() => void>

  // Notifications
  notify(title: string, description?: string, options?: NotifyOptions): Promise<void>

  // Debounced persistent storage
  storage?(name?: string): AsyncStorageWithFlush

  // HTTP fetch (Tauri bypasses CORS)
  fetch?: typeof fetch

  // Auto-update
  checkUpdate?(): Promise<{ updateAvailable: boolean; version?: string }>
  update?(): Promise<void>
}

export interface AsyncStorageWithFlush {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
  clear(): Promise<void>
  key(index: number): Promise<string | undefined>
  getLength(): Promise<number>
  flush(): Promise<void>
}

export interface NotifyOptions {
  href?: string
  silent?: boolean
  showWhenFocused?: boolean
}

export interface WindowDragDropPosition {
  x: number
  y: number
}

export type WindowDragDropEvent =
  | {
      type: "enter"
      paths: string[]
      position: WindowDragDropPosition
    }
  | {
      type: "over"
      position: WindowDragDropPosition
    }
  | {
      type: "drop"
      paths: string[]
      position: WindowDragDropPosition
    }
  | {
      type: "leave"
    }

const PlatformContext = createContext<Platform>()

export function PlatformProvider(props: { value: Platform; children: JSX.Element }) {
  return (
    <PlatformContext.Provider value={props.value}>
      {props.children}
    </PlatformContext.Provider>
  )
}

export function usePlatform(): Platform {
  const ctx = useContext(PlatformContext)
  if (!ctx) throw new Error("usePlatform must be used within PlatformProvider")
  return ctx
}
