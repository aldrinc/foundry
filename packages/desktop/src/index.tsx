// @refresh reload

import { render } from "solid-js/web"
import { App, type AsyncStorageWithFlush, type NotifyOptions, type Platform, PlatformProvider } from "@foundry/app"
import { invoke } from "@tauri-apps/api/core"
import { resolveResource } from "@tauri-apps/api/path"
import { open as shellOpen } from "@tauri-apps/plugin-shell"
import { type as ostype } from "@tauri-apps/plugin-os"
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link"
import { Store } from "@tauri-apps/plugin-store"
import { publishDeepLinks } from "@foundry/app/zulip-auth"
import { createMenu } from "./menu"
import "./styles.css"

const root = document.getElementById("root")
const notificationSoundResourcePath = "notifications/default.wav"
type PickerDialogOptions = {
  title?: string
  multiple?: boolean
}

let notificationSoundPathPromise: Promise<string | undefined> | undefined

function getNotificationSoundPath() {
  notificationSoundPathPromise ??= resolveResource(notificationSoundResourcePath).catch((error) => {
    console.warn("Notification sound unavailable", error)
    return undefined
  })
  return notificationSoundPathPromise
}

async function playNativeNotificationSound() {
  try {
    await invoke("play_notification_sound")
  } catch (error) {
    console.warn("Notification audio playback failed", error)
  }
}

async function initializeDeepLinkHandling() {
  try {
    const current = await getCurrent()
    if (current && current.length > 0) {
      publishDeepLinks(current)
    }

    await onOpenUrl((urls) => {
      publishDeepLinks(urls)
    })
  } catch (error) {
    console.warn("Deep link listener unavailable", error)
  }
}

void initializeDeepLinkHandling()

// Create the Platform abstraction (matching Open Code's pattern)
const createPlatform = (): Platform => {
  const os = (() => {
    try {
      const type = ostype()
      if (type === "macos" || type === "windows" || type === "linux") return type
    } catch {}
    return undefined
  })()

  return {
    platform: "desktop",
    os,

    openLink(url: string) {
      void shellOpen(url).catch(() => undefined)
    },

    back() {
      window.history.back()
    },

    forward() {
      window.history.forward()
    },

    async restart() {
      const { relaunch } = await import("@tauri-apps/plugin-process")
      await relaunch()
    },

    async checkUpdate() {
      try {
        const { check } = await import("@tauri-apps/plugin-updater")
        const update = await check()
        if (!update) return { updateAvailable: false }
        return {
          updateAvailable: true,
          version: update.version,
        }
      } catch (error) {
        console.warn("Updater check unavailable", error)
        return { updateAvailable: false }
      }
    },

    async update() {
      try {
        const { check } = await import("@tauri-apps/plugin-updater")
        const { relaunch } = await import("@tauri-apps/plugin-process")
        const update = await check()
        if (!update) return
        await update.downloadAndInstall()
        await relaunch()
      } catch (error) {
        console.warn("Updater install unavailable", error)
        throw error
      }
    },

    // Debounced persistent storage (250ms batching, matching Open Code)
    storage: (() => {
      const WRITE_DEBOUNCE_MS = 250
      const storeCache = new Map<string, Promise<Store>>()
      const apiCache = new Map<string, AsyncStorageWithFlush>()

      const getStore = (name: string) => {
        const cached = storeCache.get(name)
        if (cached) return cached
        const store = Store.load(name)
        storeCache.set(name, store)
        return store
      }

      const createStorage = (name: string): AsyncStorageWithFlush => {
        const pending = new Map<string, string | null>()
        let timer: ReturnType<typeof setTimeout> | undefined
        let flushing: Promise<void> | undefined

        const flush = async () => {
          if (flushing) return flushing
          flushing = (async () => {
            const store = await getStore(name)
            while (pending.size > 0) {
              const batch = Array.from(pending.entries())
              pending.clear()
              for (const [key, value] of batch) {
                if (value === null) {
                  await store.delete(key).catch(() => undefined)
                } else {
                  await store.set(key, value).catch(() => undefined)
                }
              }
            }
          })().finally(() => { flushing = undefined })
          return flushing
        }

        const schedule = () => {
          if (timer) return
          timer = setTimeout(() => {
            timer = undefined
            void flush()
          }, WRITE_DEBOUNCE_MS)
        }

        return {
          flush,
          getItem: async (key: string) => {
            const next = pending.get(key)
            if (next !== undefined) return next
            const store = await getStore(name)
            const value = await store.get(key).catch(() => null) as string | null | undefined
            if (value === undefined) return null
            return value
          },
          setItem: async (key: string, value: string) => {
            pending.set(key, value)
            schedule()
          },
          removeItem: async (key: string) => {
            pending.set(key, null)
            schedule()
          },
          clear: async () => {
            pending.clear()
            const store = await getStore(name)
            await store.clear().catch(() => undefined)
          },
          key: async (index: number) => {
            const store = await getStore(name)
            return (await store.keys().catch(() => []))[index]
          },
          getLength: async () => {
            const store = await getStore(name)
            return await store.length().catch(() => 0)
          },
        }
      }

      return (name = "default.dat") => {
        const cached = apiCache.get(name)
        if (cached) return cached
        const api = createStorage(name)
        apiCache.set(name, api)
        return api
      }
    })(),

    // File picker dialog
    async openDirectoryPickerDialog(opts?: PickerDialogOptions) {
      const { open } = await import("@tauri-apps/plugin-dialog")
      const result = await open({
        title: opts?.title ?? "Choose folder",
        multiple: opts?.multiple ?? false,
        directory: true,
      })
      if (!result) return null
      if (typeof result === "string") return result
      if (Array.isArray(result)) {
        const files = result as Array<string | { path?: string }>
        return files.map((file) => typeof file === "string" ? file : file.path || "").filter(Boolean)
      }
      return (result as { path?: string }).path ?? null
    },

    // File picker dialog
    async openFilePickerDialog(opts?: PickerDialogOptions) {
      const { open } = await import("@tauri-apps/plugin-dialog")
      const result = await open({
        title: opts?.title ?? "Open file",
        multiple: opts?.multiple ?? false,
      })
      if (!result) return null
      if (typeof result === "string") return result
      if (Array.isArray(result)) {
        const files = result as Array<string | { path?: string }>
        return files.map((file) => typeof file === "string" ? file : file.path || "").filter(Boolean)
      }
      return (result as { path?: string }).path ?? null
    },

    async onWindowDragDrop(listener) {
      const window = getCurrentWindow()
      return window.onDragDropEvent((event) => {
        const payload = event.payload as
          | { type: "enter"; paths: string[]; position: { x: number; y: number } }
          | { type: "over"; position: { x: number; y: number } }
          | { type: "drop"; paths: string[]; position: { x: number; y: number } }
          | { type: "leave" }

        if (payload.type === "enter") {
          void listener({
            type: "enter",
            paths: payload.paths,
            position: {
              x: payload.position.x,
              y: payload.position.y,
            },
          })
          return
        }

        if (payload.type === "over") {
          void listener({
            type: "over",
            position: {
              x: payload.position.x,
              y: payload.position.y,
            },
          })
          return
        }

        if (payload.type === "drop") {
          void listener({
            type: "drop",
            paths: payload.paths,
            position: {
              x: payload.position.x,
              y: payload.position.y,
            },
          })
          return
        }

        void listener({ type: "leave" })
      })
    },

    // Notifications
    async notify(title: string, description?: string, options?: NotifyOptions) {
      try {
        const granted = await isPermissionGranted().catch((err) => {
          console.warn("[Notify] isPermissionGranted failed:", err)
          return false
        })
        const permission = granted ? "granted" : await requestPermission().catch((err) => {
          console.warn("[Notify] requestPermission failed:", err)
          return "denied" as const
        })
        if (permission !== "granted") {
          console.warn("[Notify] Permission not granted:", permission)
          return
        }

        const win = getCurrentWindow()
        const focused = await win.isFocused().catch(() => document.hasFocus())
        const showSystemNotification = options?.showWhenFocused === true || !focused

        const osType = ostype()
        if (!options?.silent && osType === "macos") {
          await playNativeNotificationSound()
        }

        if (!showSystemNotification) {
          return
        }

        const sound = options?.silent || osType === "macos"
          ? undefined
          : await getNotificationSoundPath()
        const silent = osType === "macos" ? true : options?.silent

        console.log("[Notify] Sending notification:", { title, silent, hasSound: !!sound })
        sendNotification({
          title,
          body: description ?? "",
          silent,
          sound,
          extra: options?.href ? { href: options.href } : undefined,
        })
      } catch (err) {
        console.error("[Notify] Unexpected error in notify():", err)
      }
    },
  }
}

// Menu trigger bridge (connects native menu to SolidJS commands)
let menuTrigger = null as null | ((id: string) => void)
createMenu((id: string) => {
  menuTrigger?.(id)
})

// Render the app
render(() => {
  const platform = createPlatform()

  return (
    <PlatformProvider value={platform}>
      <App
        onCommandReady={(trigger: (id: string) => void) => {
          menuTrigger = trigger
        }}
      />
    </PlatformProvider>
  )
}, root!)
