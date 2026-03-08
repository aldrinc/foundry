import { createContext, useContext, onMount, onCleanup, type JSX } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { commands } from "@zulip/desktop/bindings"

export type PresenceStatus = "active" | "idle" | "offline"

interface PresenceStore {
  presences: Record<string, PresenceStatus>
}

export interface PresenceContextValue {
  store: PresenceStore
  getPresence: (email: string) => PresenceStatus
}

const PresenceContext = createContext<PresenceContextValue>()

export function PresenceProvider(props: { orgId: string; children: JSX.Element }) {
  const [store, setStore] = createStore<PresenceStore>({ presences: {} })
  let pollTimer: ReturnType<typeof setInterval> | undefined

  const fetchPresence = async () => {
    try {
      const result = await commands.getRealmPresence(props.orgId)
      if (result.status === "ok" && result.data.presences) {
        setStore(produce(s => {
          const newPresences: Record<string, PresenceStatus> = {}
          for (const [email, data] of Object.entries(result.data.presences)) {
            if (!data || typeof data !== "object") continue
            const aggregated = (data as any)?.aggregated
            if (aggregated?.status) {
              newPresences[email] = aggregated.status as PresenceStatus
            } else {
              // Parse individual client presences
              let bestStatus: PresenceStatus = "offline"
              for (const [, client] of Object.entries(data as Record<string, any>)) {
                if (client?.status === "active") bestStatus = "active"
                else if (client?.status === "idle" && bestStatus !== "active") bestStatus = "idle"
              }
              newPresences[email] = bestStatus
            }
          }
          s.presences = newPresences
        }))
      }
    } catch {
      // Non-critical
    }
  }

  const sendActivePresence = () => {
    commands.updatePresence(props.orgId, "active").catch(() => {})
  }

  onMount(() => {
    void fetchPresence()
    sendActivePresence()

    // Poll every 60 seconds
    pollTimer = setInterval(() => {
      void fetchPresence()
    }, 60000)

    // Update presence on window focus
    const handleFocus = () => sendActivePresence()
    window.addEventListener("focus", handleFocus)

    onCleanup(() => {
      if (pollTimer) clearInterval(pollTimer)
      window.removeEventListener("focus", handleFocus)
    })
  })

  const ctx: PresenceContextValue = {
    get store() { return store },
    getPresence(email: string): PresenceStatus {
      return store.presences[email] || "offline"
    },
  }

  return (
    <PresenceContext.Provider value={ctx}>
      {props.children}
    </PresenceContext.Provider>
  )
}

export function usePresence(): PresenceContextValue {
  const ctx = useContext(PresenceContext)
  if (!ctx) throw new Error("usePresence must be used within PresenceProvider")
  return ctx
}
