// @refresh reload

import { render } from "solid-js/web"
import { type Platform, PlatformProvider } from "@zulip/app/context/platform"
import { App } from "@zulip/app/app"
import { open as shellOpen } from "@tauri-apps/plugin-shell"
import { type as ostype } from "@tauri-apps/plugin-os"
import { isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { Store } from "@tauri-apps/plugin-store"
import type { AsyncStorageWithFlush } from "@zulip/app/context/platform"
import { createMenu } from "./menu"
import "./styles.css"

const root = document.getElementById("root")

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
    async openFilePickerDialog(opts) {
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

    // Notifications
    async notify(title, description) {
      const granted = await isPermissionGranted().catch(() => false)
      const permission = granted ? "granted" : await requestPermission().catch(() => "denied" as const)
      if (permission !== "granted") return

      const win = getCurrentWindow()
      const focused = await win.isFocused().catch(() => document.hasFocus())
      if (focused) return

      const notification = new Notification(title, {
        body: description ?? "",
        icon: "https://zulip.com/static/images/logo/zulip-icon-128x128.png",
        silent: true,
      })

      notification.addEventListener("click", () => {
        void win.show().catch(() => undefined)
        void win.unminimize().catch(() => undefined)
        void win.setFocus().catch(() => undefined)
      })
    },
  }
}

// Menu trigger bridge (connects native menu to SolidJS commands)
let menuTrigger = null as null | ((id: string) => void)
createMenu((id) => {
  menuTrigger?.(id)
})

// Render the app
render(() => {
  const platform = createPlatform()

  return (
    <PlatformProvider value={platform}>
      <App
        onCommandReady={(trigger) => {
          menuTrigger = trigger
        }}
      />
    </PlatformProvider>
  )
}, root!)
